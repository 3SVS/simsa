/**
 * SI 티어 Train B — B-5b S3: B-5b-4 산출물·배포·D1 마이그레이션 + B-5b-5 저장소 push·done·자동 확인(T2).
 *
 *   ① 산출물 계약(Worker) — 상한 · 경로 탈출 거부 · Zod strict · 원본 이름(한글) 보존 · 컨테이너와 같은 상수
 *   ② POST /internal/build-artifact — 잡 토큰(교차 거부) · 413·400 → failed(deploying) · 잡당 한 번 · 테스트 단계만 · 킬스위치
 *   ③ 배포 파이프라인 — 저장소 범위 토큰(repositories 1개·contents write만) · push 모양 · D1 마이그레이션 요청 모양 · 자산 업로드
 *      (해시는 Worker가, 세션 jwt로) · Worker 업로드 metadata · **내용 확인**(200+마커만 성공) · done · 자동 확인 1회(acceptancePlan)
 *      · 실패 경로 전부 failed(deploying, <코드>) · 정지 slug 미배포 · 컨테이너 URL 무시
 *   ④ 컨테이너 — 수집기(실제 파일·실제 프로세스) · 답 해석 · **끝까지(E2E)**: runBuildJob → 실제 Worker 라우트 → done → 영수증 고리(checkRunId)
 *   ⑤ 프로젝트 삭제가 builds/<jobId>/ 도 지운다
 *
 * 네트워크 0: Cloudflare·GitHub·호스팅된 앱·검수 컨테이너는 전부 가짜 fetch/바인딩. 실토큰 모양 없음(FAKE 표식만).
 * Rule 6: 제품명·WBS 제목·소스 파일 이름(`src/client/예약 화면.tsx`)·자산 경로(`/소개 페이지.txt`)·마이그레이션 주석에 한글·공백.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dailyCapsRun } from "./_daily-caps-fake.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "../..");
const REPO_TEMPLATE = path.join(REPO, "templates/simsa-hosted-app");

const run = await import("../builder-container/builder-run.mjs");
const work = await import("../builder-container/builder-work.mjs");
// 새 모듈 — 옛 코드에는 없다(그 경우 해당 테스트가 각자 실패하도록 null).
const collect = await import("../builder-container/artifact-collect.mjs").catch(() => null);
const artifactMod = await import("../dist/workspace/build-artifact.js").catch(() => null);
const deployMod = await import("../dist/workspace/build-deploy.js").catch(() => null);
const provision = await import("../dist/workspace/hosting-provision.js");
const repoMod = await import("../dist/workspace/hosting-repo.js");
const routesMod = await import("../dist/routes/workspace-build-jobs.js");
const { createApp } = await import("../dist/router.js");
const tokenMod = await import("../dist/workspace/build-job-token.js");
const dbMod = await import("../dist/workspace/db.js");
const buildDb = await import("../dist/workspace/build-job-db.js");
// PR #569 S3 검증 결함 2 — 새 모듈(옛 코드에는 없다: 해당 테스트가 각자 실패하도록 null).
const teardownMod = await import("../dist/workspace/hosted-app-teardown.js").catch(() => null);
const stuckMod = await import("../dist/stuck-cleanup.js");

function need(mod, name, what) {
  assert.ok(mod && mod[name] !== undefined, `${what} export ${name} (B-5b S3)`);
  return mod[name];
}

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const APP_PEM = privateKey.export({ type: "pkcs8", format: "pem" });

const ICT = "internal-callback-FAKE-s3";
const KEK = "kek-FAKE-s3-not-a-real-key";
const CF_OPS = "cf-ops-token-FAKE-s3";
const SCOPED = "repo-scoped-token-FAKE-s3";
const ORIGIN = "https://cp.example";
const HOST_ROOT = "simsa.page";
const SLUG = "sogeum-bread-7a3f";
const D1 = "5f0c8a4e-1b2d-4c3e-9f10-2a3b4c5d6e7f";
const PROJECT = "wsp_s3_빵집";
const USER = "uk_빵집 사장님";
const PRODUCT = "동네 빵집 소금빵 예약 (주)빵굽는집";
const ORG = "simsa-hosted";
const APP_URL = `https://${SLUG}.${HOST_ROOT}`;
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");

const DEV_SPEC = {
  meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-10-01T00:00:00.000Z" },
  brief: { productName: PRODUCT, oneLine: "동네 손님이 소금빵을 미리 예약한다", targetUsers: ["동네 손님"], problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
  features: [{ id: "FR-001", title: "예약", description: "빵을 고르고 예약한다", priority: "must" }],
  acceptance: [{ id: "AC-001", featureId: "FR-001", given: "빵 목록", when: "예약하기 누름", then: "예약 확인 화면이 보인다", verifiedBy: "browser" }],
  screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: ["예약하기 버튼"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
  dataModel: [{ name: "reservations", fields: [{ name: "id", type: "text", required: true }], relations: [], ownership: "unknown" }],
  apis: [], nonFunctional: [],
  workBreakdown: [{ id: "WBS-001", title: "예약 화면 — 한글 버튼 '예약하기'", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] }],
  testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "예약하기 누르기"] }], assumptions: [], openQuestions: [],
};

function projectRow() {
  return { id: PROJECT, user_key: USER, title: PRODUCT, idea: "", understood_json: "{}", product_spec_json: "{}", items_json: "[]", built_with_json: null, entry_path: "idea", topic_tags_json: "[]", acquisition_json: null, dev_spec_json: JSON.stringify(DEV_SPEC), region_at_create: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
}

function jobRow(o = {}) {
  return { id: "bj_s3a0000001", project_id: PROJECT, user_key: USER, slug: SLUG, status: "testing", failed_stage: null, error: null, wbs_done: 1, wbs_total: 1, budget_usd: 10, spent_usd: 1.25, d1_id: D1, repo_full_name: `${ORG}/${SLUG}`, commit_sha: null, deployed_url: null, build_exit_code: null, locale: "ko", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...o };
}

const ACTIVE = (r) => !["done", "failed"].includes(r.status);

/**
 * 가짜 D1 — 이 테스트가 지나는 문장만(문구로 가른다). projects = 살아 있는 프로젝트 id(삭제 배치가 지운다).
 * batch는 문장을 차례로 실행한다(프로젝트 삭제 — PR #569 S3 검증 결함 1·2).
 */
function makeDb({ jobs = [jobRow()], checks = [], projects = [PROJECT] } = {}) {
  const db = {
    jobs, events: [], checks, rate: new Map(), sqls: [], batches: [], projects: new Set(projects),
    prepare(sql) {
      const handler = (args) => ({
        async run() {
          db.sqls.push(sql);
          const capped = dailyCapsRun(db.rate, sql, args);
          if (capped) return capped;
          if (sql.startsWith("DELETE FROM workspace_projects WHERE id = ?")) {
            const had = db.projects.delete(args[0]);
            return { meta: { changes: had ? 1 : 0 } };
          }
          if (sql.startsWith("UPDATE build_jobs SET user_key = ?, updated_at = ? WHERE project_id = ?")) {
            const [user_key, updated_at, project_id] = args;
            const rows = jobs.filter((r) => r.project_id === project_id);
            for (const r of rows) Object.assign(r, { user_key, updated_at });
            return { meta: { changes: rows.length } };
          }
          if (sql.startsWith("DELETE FROM build_job_events WHERE job_id IN (SELECT id FROM build_jobs WHERE project_id = ?)")) {
            const ids = new Set(jobs.filter((r) => r.project_id === args[0]).map((r) => r.id));
            const before = db.events.length;
            db.events = db.events.filter((e) => !ids.has(e.job_id));
            return { meta: { changes: before - db.events.length } };
          }
          if (sql.startsWith("DELETE FROM build_jobs WHERE project_id = ?")) {
            let n = 0;
            for (let i = jobs.length - 1; i >= 0; i -= 1) if (jobs[i].project_id === args[0]) { jobs.splice(i, 1); n += 1; }
            return { meta: { changes: n } };
          }
          if (sql.includes("INSERT INTO build_job_events")) {
            const [id, job_id, at, stage, message, meta_json] = args;
            if (sql.includes("SELECT COUNT(*)") && db.events.filter((e) => e.job_id === job_id).length >= Number(args[args.length - 1])) return { meta: { changes: 0 } };
            // 결함 1: 잡 행이 있을 때만(EXISTS 조건이 있는 SQL일 때 흉내 — 옛 SQL에는 없다).
            if (sql.includes("EXISTS (SELECT 1 FROM build_jobs WHERE id = ?)") && !jobs.some((r) => r.id === job_id)) return { meta: { changes: 0 } };
            db.events.push({ id, job_id, at, stage, message, meta: JSON.parse(meta_json) });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET build_exit_code = 0") && sql.includes("status = 'testing' AND build_exit_code IS NULL")) {
            const [updated_at, id] = args;
            const row = jobs.find((r) => r.id === id && r.status === "testing" && r.build_exit_code === null);
            if (row) Object.assign(row, { build_exit_code: 0, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET commit_sha = ?, updated_at = ?")) {
            const [commit_sha, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id && ACTIVE(r));
            if (row) Object.assign(row, { commit_sha, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE build_jobs") && sql.includes("SET status = ?, wbs_done = ?")) {
            const [status, wbs_done, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id && ACTIVE(r));
            if (row) Object.assign(row, { status, wbs_done, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'done'")) {
            const [deployed_url, commit_sha, spent_usd, wbs_done, updated_at, id] = args;
            // 결함 6: WHERE에 `AND build_exit_code = 0`이 있으면 그 조건을 그대로 흉내 낸다(옛 SQL에는 없다).
            const needsClaim = sql.includes("AND build_exit_code = 0");
            const row = jobs.find((r) => r.id === id && ACTIVE(r) && (!needsClaim || r.build_exit_code === 0));
            if (row) Object.assign(row, { status: "done", deployed_url, commit_sha: commit_sha ?? row.commit_sha, spent_usd: Math.max(row.spent_usd, spent_usd), build_exit_code: 0, wbs_done, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'failed'") && sql.includes("build_jobs")) {
            const [failed_stage, error, spent_usd, build_exit_code, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id && ACTIVE(r));
            if (row) Object.assign(row, { status: "failed", failed_stage, error, spent_usd: Math.max(row.spent_usd, spent_usd), build_exit_code: build_exit_code ?? row.build_exit_code, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("INSERT INTO workspace_visual_checks")) {
            const [id, project_id, user_key, target_url, intent, locale, region, envelope_json, source_check_id, created_at] = args;
            db.checks.push({ id, project_id, user_key, target_url, intent, locale, region, envelope_json, source_check_id, created_at, status: "queued" });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE workspace_visual_checks") && sql.includes("SET status = 'failed'")) {
            const id = args[args.length - 1];
            const row = db.checks.find((r) => r.id === id);
            if (row) row.status = "failed";
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          db.sqls.push(sql);
          if (sql.includes("FROM workspace_projects WHERE id = ?")) return db.projects.has(args[0]) ? { ...projectRow(), id: args[0] } : null;
          if (sql.includes("FROM build_jobs WHERE id = ?")) return jobs.find((r) => r.id === args[0]) ?? null;
          if (sql.includes("FROM build_jobs WHERE slug = ? AND project_id != ?")) return jobs.find((r) => r.slug === args[0] && r.project_id !== args[1]) ?? null;
          if (sql.includes("FROM build_jobs WHERE d1_id = ? AND project_id != ?")) return jobs.find((r) => r.d1_id === args[0] && r.project_id !== args[1]) ?? null;
          if (sql.includes("FROM build_jobs WHERE project_id = ? AND user_key != ?")) return jobs.find((r) => r.project_id === args[0] && r.user_key !== args[1]) ?? null;
          if (sql.includes("FROM workspace_visual_checks") && sql.includes("status IN ('queued', 'running')")) return db.checks.find((r) => r.project_id === args[0] && ["queued", "running"].includes(r.status)) ?? null;
          return null;
        },
        async all() {
          db.sqls.push(sql);
          if (sql.includes("FROM build_job_events")) return { results: db.events.filter((e) => e.job_id === args[0]).map((e) => ({ ...e, meta_json: JSON.stringify(e.meta) })) };
          if (sql.includes("SELECT id FROM build_jobs WHERE project_id = ?")) return { results: jobs.filter((r) => r.project_id === args[0]).map((r) => ({ id: r.id })) };
          if (sql.includes("SELECT id, status FROM build_jobs WHERE project_id = ? AND status IN")) return { results: jobs.filter((r) => r.project_id === args[0] && ACTIVE(r)).map((r) => ({ id: r.id, status: r.status })) };
          if (sql.includes("SELECT id, slug, d1_id, repo_full_name FROM build_jobs WHERE project_id = ?")) return { results: jobs.filter((r) => r.project_id === args[0]).map((r) => ({ id: r.id, slug: r.slug, d1_id: r.d1_id, repo_full_name: r.repo_full_name })) };
          if (sql.includes("SELECT DISTINCT b.project_id")) {
            const ids = [...new Set(jobs.filter((r) => r.user_key === args[0] && !db.projects.has(r.project_id)).map((r) => r.project_id))];
            return { results: ids.slice(0, args[1]).map((project_id) => ({ project_id })) };
          }
          if (sql.includes("FROM build_jobs") && sql.includes("updated_at < ?")) {
            const [cutoff, limit] = args;
            const exit0 = sql.includes("build_exit_code = 0");
            return { results: jobs.filter((r) => ACTIVE(r) && r.updated_at < cutoff && (!exit0 || r.build_exit_code === 0)).slice(0, limit).map((r) => ({ id: r.id, status: r.status })) };
          }
          return { results: [] };
        },
      });
      return { bind: (...a) => handler(a), run: () => handler([]).run(), first: () => handler([]).first(), all: () => handler([]).all() };
    },
    async batch(stmts) {
      db.batches.push(stmts.length);
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return db;
}

/** 가짜 R2 — put·get·list·delete. 바이트 값(결함 4: 받은 본문 그대로)은 bytes에 그대로, value에는 UTF-8 텍스트로. */
function makeR2({ failPut = false, onPut = null } = {}) {
  const objects = new Map();
  return {
    objects,
    deleted: [],
    async put(key, value, opts) {
      if (failPut) throw new Error("r2 unavailable (FAKE)");
      if (onPut) await onPut(key);
      const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
      objects.set(key, { value: bytes.toString("utf8"), bytes, opts });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { text: async () => o.value } : null;
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
    async delete(key) {
      this.deleted.push(key);
      objects.delete(key);
    },
  };
}

function makeInspector({ status = 202 } = {}) {
  const payloads = [];
  return {
    payloads,
    idFromName: (n) => ({ n }),
    get: () => ({ fetch: async (_u, init) => { payloads.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: status < 300 }), { status }); } }),
  };
}

function envFor(db, extra = {}) {
  return {
    DB: db, EVIDENCE: makeR2(), INSPECTOR: makeInspector(), INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, PUBLIC_BASE_URL: ORIGIN,
    HOSTING_CF_API_TOKEN: CF_OPS, HOSTING_CF_ACCOUNT_ID: "acc1", HOSTING_ROOT_DOMAIN: HOST_ROOT,
    HOSTING_GH_APP_ID: "4242", HOSTING_GH_APP_PRIVATE_KEY: APP_PEM, HOSTING_GH_ORG: ORG,
    ...extra,
  };
}

/**
 * 가짜 바깥 세상 — Cloudflare API · GitHub API · 호스팅된 앱(<slug>.simsa.page). 요청을 기록한다.
 * opts로 실패를 고른다: d1Fail · assetsFail · uploadFail · page(상태·본문) · health(상태·본문) · scopedPerms · refOk.
 */
function makeWorld(opts = {}) {
  const calls = [];
  const d1 = { queries: [], applied: [...(opts.alreadyApplied ?? [])], deleted: [] };
  const assets = { manifests: [], uploads: [] };
  const scripts = [];
  /** 유저 Worker 스크립트에 일어난 일의 순서(PUT = 업로드 · DELETE = 삭제) — 결함 1·2. */
  const scriptOps = [];
  const gh = { tokenRequests: [], blobs: [], trees: [], commits: [], refs: [], revoked: [], repoDeletes: [] };
  const hosted = { gets: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const cfOk = (result) => json(200, { success: true, errors: [], result });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers ?? {}).get("authorization") ?? "";
    // opts.before: 요청을 처리하기 **전에** 끼어드는 일(삭제·실패 보고·킬스위치 — 경합 재현).
    if (opts.before) await opts.before({ method, host: u.host, path: u.pathname, init });
    calls.push({ method, host: u.host, path: u.pathname, auth });
    if (u.host === "api.cloudflare.com") {
      const p = u.pathname.replace("/client/v4/accounts/acc1", "");
      if (p === `/d1/database/${D1}` && method === "DELETE") {
        d1.deleted.push({ id: D1, auth });
        return cfOk(null);
      }
      if (p === `/d1/database/${D1}/query`) {
        if (opts.hangD1) {
          // 걸린 요청: 신호가 끊을 때까지(없으면 1.5초 뒤 네트워크 오류 — 옛 코드가 영원히 걸리지 않게).
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("hung (FAKE)")), 1500);
            init.signal?.addEventListener("abort", () => { clearTimeout(t); reject(init.signal.reason ?? new Error("aborted")); });
          });
        }
        const sql = JSON.parse(init.body).sql;
        d1.queries.push({ sql, auth });
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS d1_migrations")) return cfOk([{ results: [], success: true }]);
        if (sql.startsWith("SELECT name FROM d1_migrations")) return cfOk([{ results: d1.applied.map((name) => ({ name })), success: true }]);
        if (opts.d1Fail) return json(400, { success: false, errors: [{ code: 7500, message: "near \"CREAT\": syntax error" }], result: null });
        const m = /INSERT INTO d1_migrations \(name\) values \('([^']+)'\);$/.exec(sql);
        if (m) d1.applied.push(m[1]);
        return cfOk([{ results: [], success: true }, { results: [], success: true }]);
      }
      if (p === `/workers/dispatch/namespaces/simsa-hosted/scripts/${SLUG}/assets-upload-session`) {
        const manifest = JSON.parse(init.body).manifest;
        assets.manifests.push({ manifest, auth });
        const hashes = Object.values(manifest).map((v) => v.hash);
        return cfOk({ jwt: "assets-session-jwt-FAKE", buckets: opts.noBuckets ? [] : [hashes] });
      }
      if (p === "/workers/assets/upload") {
        const form = init.body;
        const parts = [];
        for (const [name, value] of form.entries()) parts.push({ name, type: value.type, text: await value.text() });
        assets.uploads.push({ auth, base64: u.searchParams.get("base64"), parts });
        if (opts.assetsFail) return json(500, { success: false, errors: [{ code: 10000, message: "internal" }] });
        return json(201, { success: true, errors: [], result: { jwt: "assets-complete-jwt-FAKE" } });
      }
      if (p === `/workers/dispatch/namespaces/simsa-hosted/scripts/${SLUG}` && method === "PUT") {
        const form = init.body;
        const metadata = JSON.parse(await form.get("metadata").text());
        const modules = [];
        for (const [name, value] of form.entries()) if (name !== "metadata") modules.push({ name, type: value.type, text: await value.text() });
        scripts.push({ metadata, modules, auth });
        if (opts.uploadFail) return json(400, { success: false, errors: [{ code: 10021, message: "Uncaught SyntaxError" }] });
        scriptOps.push("PUT");
        return cfOk({ id: SLUG });
      }
      if (p === `/workers/dispatch/namespaces/simsa-hosted/scripts/${SLUG}` && method === "DELETE") {
        if (opts.scriptDeleteFail) return json(500, { success: false, errors: [{ code: 10013, message: "internal (FAKE)" }] });
        scriptOps.push("DELETE");
        return cfOk(null);
      }
      return json(404, { success: false, errors: [{ code: 7003, message: `unrouted ${method} ${p}` }] });
    }
    if (u.host === "api.github.com") {
      const p = u.pathname;
      if (p === `/orgs/${ORG}/installation`) return json(200, { id: 777 });
      if (p === "/app/installations/777/access_tokens" && method === "POST") {
        const body = JSON.parse(init.body);
        gh.tokenRequests.push({ body, auth });
        return json(201, { token: SCOPED, expires_at: "2030-01-01T00:00:00Z", permissions: opts.scopedPerms ?? { ...body.permissions, metadata: "read" }, repository_selection: "selected", repositories: [{ name: SLUG }] });
      }
      if (p === "/installation/token" && method === "DELETE") { gh.revoked.push(auth); return new Response(null, { status: 204 }); }
      const base = `/repos/${ORG}/${SLUG}`;
      if (p === base && method === "DELETE") {
        gh.repoDeletes.push({ repo: `${ORG}/${SLUG}`, auth });
        return new Response(null, { status: 204 });
      }
      if (p === `${base}/git/ref/heads/main`) return opts.refOk ? json(200, { object: { sha: "parent0000" } }) : json(404, { message: "Not Found" });
      if (p === `${base}/git/blobs`) { const b = JSON.parse(init.body); gh.blobs.push({ ...b, auth }); return json(201, { sha: `blob${gh.blobs.length}` }); }
      if (p === `${base}/git/trees`) { gh.trees.push({ ...JSON.parse(init.body), auth }); return json(201, { sha: "tree0001" }); }
      if (p === `${base}/git/commits`) { gh.commits.push({ ...JSON.parse(init.body), auth }); return json(201, { sha: "c0ffee0123456789abcdef0123456789abcdef01" }); }
      if (p === `${base}/git/refs`) { gh.refs.push({ ...JSON.parse(init.body), auth }); return json(201, { ref: "refs/heads/main" }); }
      if (p === `${base}/git/refs/heads/main`) { gh.refs.push({ ...JSON.parse(init.body), auth, patch: true }); return json(200, {}); }
      return json(404, { message: `unrouted ${method} ${p}` });
    }
    if (u.host === `${SLUG}.${HOST_ROOT}`) {
      hosted.gets.push(u.pathname);
      if (u.pathname === "/api/health") {
        const h = typeof opts.health === "function" ? opts.health(hosted.gets.length) : opts.health ?? { status: 200, body: JSON.stringify({ ok: true, app: "simsa-hosted-app" }) };
        return new Response(h.body, { status: h.status, headers: { "content-type": "application/json" } });
      }
      const pg = typeof opts.page === "function" ? opts.page(hosted.gets.length) : opts.page ?? { status: 200, body: '<!doctype html><html lang="ko"><body><div id="root"></div><script type="module" crossorigin src="/assets/index-AbC123.js"></script></body></html>' };
      return new Response(pg.body, { status: pg.status, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("unrouted", { status: 599 });
  };
  return { fetchImpl, calls, d1, assets, scripts, scriptOps, gh, hosted };
}

/** 컨테이너 builder-run.mjs asciiJson과 같은 규칙(테스트가 둘을 비교) — 본문은 ASCII JSON(결함 4). */
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** 컨테이너가 보내는 모양의 산출물(한글 이름 포함). */
function artifactBody(jobId = "bj_s3a0000001", o = {}) {
  return {
    jobId,
    worker: { mainModule: "worker.js", modules: [{ name: "worker.js", base64: b64('var app = { fetch() {} };\napp.get("/api/health");\nexport default app;\n') }] },
    assets: [
      { path: "/index.html", base64: b64('<!doctype html><script type="module" crossorigin src="/assets/index-AbC123.js"></script>') },
      { path: "/assets/index-AbC123.js", base64: b64('console.log("예약하기");') },
      { path: "/소개 페이지.txt", base64: b64("동네 빵집 소개") },
    ],
    migrations: [
      { name: "0001_init.sql", base64: b64("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY);") },
      { name: "0002_add_reservations.sql", base64: b64("-- 예약 테이블 (소금빵)\nCREATE TABLE reservations (id TEXT PRIMARY KEY, 이름 TEXT);") },
    ],
    source: [
      { path: "src/worker.ts", base64: b64("// Hono\n"), executable: false },
      { path: "src/client/예약 화면.tsx", base64: b64("export const 버튼 = '예약하기';\n"), executable: false },
      { path: "public/logo.png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]).toString("base64"), executable: false },
      { path: "migrations/0002_add_reservations.sql", base64: b64("-- 예약 테이블 (소금빵)\n"), executable: false },
      { path: ".gitignore", base64: b64("node_modules\n"), executable: false },
    ],
    summary: { commits: 3, wbsDone: 1, wbsFailed: [], gateRounds: 0 },
    ...o,
  };
}

/** 이 테스트 전용 라우트 앱: 가짜 바깥 세상 fetch · 대기 없음. */
function routesApp(world, options = {}) {
  return routesMod.createWorkspaceBuildJobRoutes(world.fetchImpl, { sleep: async () => {}, ...options });
}

async function postArtifactTo(app, env, token, body, headers = {}) {
  const res = await app.fetch(new Request(`${ORIGIN}/internal/build-artifact`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === "string" ? body : asciiJson(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const mint = (env, jobId) => tokenMod.mintBuildJobToken(env, jobId);
const eventsOf = (db, jobId = "bj_s3a0000001") => db.events.filter((e) => e.job_id === jobId).map((e) => [e.stage, e.message]);

const createdTmp = [];
async function tmpDir(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `b5bs3-${tag}-`));
  createdTmp.push(d);
  return d;
}
after(async () => {
  await Promise.all(createdTmp.map((d) => fs.rm(d, { recursive: true, force: true })));
});

// ══ ① 산출물 계약(Worker) ══════════════════════════════════════════════════════════════════════════

describe("① 산출물 계약 — 상한 · 경로 탈출 · Zod strict · 한글 이름 보존 (Worker)", () => {
  it("컨테이너 수집기와 Worker가 같은 상한·이름 규칙·경로를 쓴다", () => {
    const W = need(artifactMod, "BUILD_ARTIFACT_LIMITS", "build-artifact.ts");
    assert.ok(collect, "builder-container/artifact-collect.mjs (B-5b-4)");
    assert.deepEqual({ ...collect.ARTIFACT_LIMITS }, { ...W });
    assert.equal(collect.MIGRATION_NAME_RE.toString(), artifactMod.MIGRATION_NAME_RE.toString());
    assert.equal(collect.MODULE_NAME_RE.toString(), artifactMod.MODULE_NAME_RE.toString());
    assert.equal(run.BUILD_ARTIFACT_PATH, routesMod.BUILD_ARTIFACT_PATH);
    assert.equal(run.BUILD_ARTIFACT_PATH, "/internal/build-artifact");
    // 소스 제외 규칙: Worker 재적용 = 컨테이너 스캐폴드 규칙
    for (const name of ["node_modules", "dist", ".env", ".env.local", ".dev.vars", ".npmrc", ".wrangler", ".git", "server.pem", "deploy.key", ".gitignore", ".env.example", "src", "예약 화면.tsx"]) {
      assert.equal(artifactMod.isSourceSegmentExcluded(name), run.isScaffoldExcluded(name), name);
    }
  });

  it("경로 정규화: 한글·공백은 그대로(NFC) · ../·절대·드라이브·빈 조각·.·.git·제어 문자·역슬래시 탈출은 거부", () => {
    const n = need(artifactMod, "normalizeArtifactPath", "build-artifact.ts");
    const nfd = "src/client/예약 화면.tsx".normalize("NFD");
    assert.deepEqual(n(nfd), { ok: true, path: "src/client/예약 화면.tsx" });
    assert.deepEqual(n("src\\client\\App.tsx"), { ok: true, path: "src/client/App.tsx" });
    for (const [raw, reason] of [
      ["../secrets.txt", "dot_segment"], ["src/../../etc/passwd", "dot_segment"], ["..\\..\\x", "dot_segment"], ["./a", "dot_segment"],
      ["/etc/passwd", "absolute"], ["C:/Windows/x", "absolute"], ["~/.ssh/id", "absolute"], ["//server/share", "absolute"],
      ["a//b", "empty_segment"], [".git/config", "git_dir"], ["src/.GIT/hooks/x", "git_dir"], ["a\u0000b", "control_char"], ["a\nb", "control_char"], ["", "empty"],
    ]) {
      const r = n(raw);
      assert.equal(r.ok, false, `${JSON.stringify(raw)} must be refused`);
      assert.equal(r.reason, reason, JSON.stringify(raw));
    }
  });

  it("정상 산출물 → 개수·바이트 · main이 첫 모듈 · 마이그레이션 이름순 · 한글 경로 보존", () => {
    const parse = need(artifactMod, "parseBuildArtifact", "build-artifact.ts");
    const body = artifactBody();
    body.migrations.reverse();
    const r = parse(JSON.stringify(body));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.artifact.migrations.map((m) => m.name), ["0001_init.sql", "0002_add_reservations.sql"]);
    assert.match(r.artifact.migrations[1].sql, /예약 테이블/);
    assert.ok(r.artifact.source.some((f) => f.path === "src/client/예약 화면.tsx"));
    assert.ok(r.artifact.assets.some((f) => f.path === "/소개 페이지.txt"));
    assert.equal(r.artifact.worker.modules[0].name, "worker.js");
    assert.equal(r.artifact.stats.source.count, 5);
    assert.equal(r.artifact.stats.source.bytes, body.source.reduce((s, f) => s + Buffer.from(f.base64, "base64").length, 0));
  });

  it("거절 400: 모르는 키(deployedUrl 포함 — 컨테이너 URL은 받지 않는다) · 모듈 이름(비ASCII·경로) · main 누락 · 마이그레이션 이름 · 제외 경로(.env·node_modules·dist) · 중복 · base64 아님", () => {
    const parse = need(artifactMod, "parseBuildArtifact", "build-artifact.ts");
    const cases = [
      [{ deployedUrl: "https://evil.example" }, /artifact_invalid:.*unknown_key/],
      [{ worker: { mainModule: "worker.js", modules: [{ name: "워커.js", base64: b64("x") }] } }, /artifact_invalid:module_name/],
      [{ worker: { mainModule: "worker.js", modules: [{ name: "../worker.js", base64: b64("x") }] } }, /artifact_invalid:module_name/],
      [{ worker: { mainModule: "main.js", modules: [{ name: "worker.js", base64: b64("x") }] } }, /artifact_invalid:main_module/],
      [{ migrations: [{ name: "0003_예약.sql", base64: b64("x") }] }, /artifact_invalid:migration_name/],
      [{ migrations: [{ name: "0003_x'); DROP TABLE y; --.sql", base64: b64("x") }] }, /artifact_invalid:migration_name/],
      [{ source: [{ path: ".env", base64: b64("SECRET=FAKE") }] }, /artifact_invalid:source_excluded/],
      [{ source: [{ path: "src/.dev.vars", base64: b64("x") }] }, /artifact_invalid:source_excluded/],
      [{ source: [{ path: "node_modules/hono/index.js", base64: b64("x") }] }, /artifact_invalid:source_excluded/],
      [{ source: [{ path: "dist/client/index.html", base64: b64("x") }] }, /artifact_invalid:source_excluded/],
      [{ source: [{ path: "../../etc/passwd", base64: b64("x") }] }, /artifact_invalid:source_path:dot_segment/],
      [{ assets: [{ path: "index.html", base64: b64("x") }] }, /artifact_invalid:assets_path:not_rooted/],
      [{ assets: [{ path: "/../x", base64: b64("x") }] }, /artifact_invalid:assets_path:dot_segment/],
      [{ source: [{ path: "a.txt", base64: b64("1") }, { path: "a.txt", base64: b64("2") }] }, /artifact_invalid:duplicate_path/],
      [{ source: [{ path: "a.txt", base64: "not base64!" }] }, /artifact_invalid:source/],
    ];
    for (const [patch, re] of cases) {
      const r = parse(JSON.stringify(artifactBody(undefined, patch)));
      assert.equal(r.ok, false, JSON.stringify(patch));
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.match(r.error, re, `${JSON.stringify(patch).slice(0, 80)} → ${r.error}`);
    }
    assert.deepEqual([parse("{not json").status, parse("{not json").error], [400, "artifact_invalid:json"]);
  });

  it("거절 413: 개수·바이트 상한(모듈 합계 · 파일 수 · 소스 합계 · 자산 파일 하나) — artifact_too_large:<구역>", () => {
    const parse = need(artifactMod, "parseBuildArtifact", "build-artifact.ts");
    const L = artifactMod.BUILD_ARTIFACT_LIMITS;
    const many = artifactBody(undefined, { source: [1, 2, 3, 4].map((i) => ({ path: `src/파일${i}.ts`, base64: b64("x") })) });
    assert.deepEqual(pick(parse(JSON.stringify(many), { ...L, maxSourceFiles: 3 })), [413, "artifact_too_large:source_count"]);
    const heavySrc = artifactBody(undefined, { source: [{ path: "src/a.ts", base64: b64("123456") }, { path: "src/b.ts", base64: b64("123456") }] });
    assert.deepEqual(pick(parse(JSON.stringify(heavySrc), { ...L, maxSourceBytes: 10 })), [413, "artifact_too_large:source"]);
    const heavyMod = artifactBody(undefined, { worker: { mainModule: "worker.js", modules: [{ name: "worker.js", base64: b64("x".repeat(21)) }] } });
    assert.deepEqual(pick(parse(JSON.stringify(heavyMod), { ...L, maxModuleBytes: 20 })), [413, "artifact_too_large:modules"]);
    const bigAsset = artifactBody(undefined, { assets: [{ path: "/a.js", base64: b64("123456") }] });
    assert.deepEqual(pick(parse(JSON.stringify(bigAsset), { ...L, maxAssetFileBytes: 5 })), [413, "artifact_too_large:assets_file"]);
    assert.deepEqual(pick(parse(JSON.stringify(artifactBody()), { ...L, maxMigrations: 1 })), [413, "artifact_too_large:migrations_count"]);
    // 경계: 정확히 상한이면 통과
    assert.equal(parse(JSON.stringify(heavySrc), { ...L, maxSourceBytes: 12 }).ok, true);
    function pick(r) { return [r.status, r.error]; }
  });

  it("R2 키는 ASCII(builds/<jobId>/artifact.json) — 파일 이름은 키에 넣지 않는다(Rule 6)", () => {
    const key = need(artifactMod, "buildArtifactR2Key", "build-artifact.ts");
    assert.equal(key("bj_s3a0000001"), "builds/bj_s3a0000001/artifact.json");
    assert.throws(() => key("bj/../x"));
    assert.throws(() => key("빌드"));
  });
});

// ══ ② POST /internal/build-artifact ═══════════════════════════════════════════════════════════════

describe("② POST /internal/build-artifact — 인증 · 거절은 failed(deploying) · 잡당 한 번 · 테스트 단계만 · 킬스위치", () => {
  it("인증: 토큰 없음 401 · 전역 콜백 토큰 403 · 다른 잡의 토큰 403(상태 변화 0) · 본문 jobId가 토큰의 잡과 다르면 403(상태 변화 0)", async () => {
    const db = makeDb({ jobs: [jobRow(), jobRow({ id: "bj_s3other001", slug: "other-app-1" })] });
    const env = envFor(db);
    const world = makeWorld();
    const app = routesApp(world);
    assert.equal((await postArtifactTo(app, env, null, artifactBody())).status, 401);
    assert.equal((await postArtifactTo(app, env, ICT, artifactBody())).status, 403);
    const other = await mint(env, "bj_s3other001");
    const cross = await postArtifactTo(app, env, other, artifactBody("bj_s3a0000001"));
    assert.deepEqual([cross.status, cross.body.error], [403, "job_token_mismatch"]);
    // 깨진 본문이어도 다른 잡을 말하면 상태를 바꾸지 않는다
    const crossBad = await postArtifactTo(app, env, other, { ...artifactBody("bj_s3a0000001"), extra: 1 });
    assert.equal(crossBad.status, 403);
    assert.deepEqual(db.jobs.map((j) => [j.status, j.build_exit_code]), [["testing", null], ["testing", null]], "no state change on any auth failure");
    assert.equal(world.calls.length, 0, "no Cloudflare/GitHub call");
    assert.equal(db.events.length, 0);
  });

  it("본문 상한(스트림 계수 — content-length를 믿지 않는다) → 413 + failed(deploying, artifact_too_large:body)", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    const app = routesApp(world);
    const token = await mint(env, "bj_s3a0000001");
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= 28) return controller.close();
        sent += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const res = await app.fetch(new Request(`${ORIGIN}/internal/build-artifact`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: stream, duplex: "half" }), env);
    assert.equal(res.status, 413);
    assert.ok(sent <= 28);
    const j = db.jobs[0];
    assert.deepEqual([j.status, j.failed_stage, j.error], ["failed", "deploying", "artifact_too_large:body"]);
    assert.equal(world.calls.length, 0);
  });

  it("개수 상한 초과 → 413 artifact_too_large + failed(deploying, artifact_too_large:source_count) · 잘못된 모양 → 400 + failed(deploying, artifact_invalid:…)", async () => {
    const L = artifactMod.BUILD_ARTIFACT_LIMITS;
    const db = makeDb({ jobs: [jobRow(), jobRow({ id: "bj_s3a0000002" })] });
    const env = envFor(db);
    const world = makeWorld();
    const app = routesApp(world);
    const many = artifactBody("bj_s3a0000001", { source: Array.from({ length: L.maxSourceFiles + 1 }, (_, i) => ({ path: `src/조각-${i}.ts`, base64: b64("x") })) });
    const r1 = await postArtifactTo(app, env, await mint(env, "bj_s3a0000001"), many);
    assert.deepEqual([r1.status, r1.body.error, r1.body.detail], [413, "artifact_too_large", "artifact_too_large:source_count"]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].failed_stage, db.jobs[0].error], ["failed", "deploying", "artifact_too_large:source_count"]);
    const r2 = await postArtifactTo(app, env, await mint(env, "bj_s3a0000002"), artifactBody("bj_s3a0000002", { source: [{ path: "../../x", base64: b64("x") }] }));
    assert.deepEqual([r2.status, r2.body.error], [400, "artifact_invalid"]);
    assert.deepEqual([db.jobs[1].status, db.jobs[1].failed_stage, db.jobs[1].error], ["failed", "deploying", "artifact_invalid:source_path:dot_segment"]);
    assert.equal(world.calls.length, 0);
  });

  it("테스트 단계를 지나지 않은 잡의 산출물은 받지 않는다(D-4) → 409 artifact_before_tests + failed(deploying)", async () => {
    const db = makeDb({ jobs: [jobRow({ status: "implementing" })] });
    const env = envFor(db);
    const world = makeWorld();
    const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r.status, r.body.error], [409, "artifact_before_tests"]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].error], ["failed", "artifact_before_tests:implementing"]);
    assert.equal(world.calls.length, 0);
  });

  it("킬스위치 BUILD_ENABLED=off → 받지 않고(accepted:false) 잡을 그 단계에서 멈춘다 · push·배포 호출 0", async () => {
    const db = makeDb();
    const env = envFor(db, { BUILD_ENABLED: "off" });
    const world = makeWorld();
    const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r.status, r.body.accepted, r.body.reason], [200, false, "build_disabled"]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].failed_stage, db.jobs[0].error], ["failed", "testing", "build_disabled"]);
    assert.equal(world.calls.length, 0);
    assert.equal(env.EVIDENCE.objects.size, 0);
  });

  it("잡당 한 번: 같은 잡의 두 번째 업로드는 409 artifact_already_received — 두 번 배포하지 않는다 · 끝난 잡은 accepted:false", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    const app = routesApp(world);
    const token = await mint(env, "bj_s3a0000001");
    const first = await postArtifactTo(app, env, token, artifactBody());
    assert.equal(first.body.status, "done", JSON.stringify(first.body));
    const putsAfterFirst = world.scripts.length;
    const second = await postArtifactTo(app, env, token, artifactBody());
    assert.deepEqual([second.status, second.body.accepted], [200, false], "the job is done — not active");
    assert.equal(world.scripts.length, putsAfterFirst);
    // 활성인데 이미 받은 잡(배포 중)도 두 번째는 409
    const db2 = makeDb({ jobs: [jobRow({ build_exit_code: 0, status: "deploying" })] });
    const env2 = envFor(db2);
    const r = await postArtifactTo(routesApp(makeWorld()), env2, await mint(env2, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r.status, r.body.error], [409, "artifact_already_received"]);
    assert.equal(db2.jobs[0].status, "deploying", "the first upload's pipeline still owns the job");
  });

  it("R2 저장 실패 → failed(deploying, artifact_store_failed) · 배포 호출 0 (받은 것을 남기지 못하면 배포하지 않는다)", async () => {
    const db = makeDb();
    const env = envFor(db, { EVIDENCE: makeR2({ failPut: true }) });
    const world = makeWorld();
    const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r.status, r.body.accepted, r.body.status, r.body.error], [200, true, "failed", "artifact_store_failed"]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].failed_stage], ["failed", "deploying"]);
    assert.equal(world.calls.length, 0);
  });
});

// ══ ③ 배포 파이프라인 ════════════════════════════════════════════════════════════════════════════

describe("③ Worker 배포 파이프라인 — push · D1 · 자산 · 업로드 · 내용 확인 · done · 자동 확인", () => {
  it("★성공 끝까지: 저장소 범위 토큰 → push(한글 경로·바이너리) → pushed → D1 마이그레이션 → 자산(해시는 Worker) → Worker 업로드 → 내용 확인 → done → 자동 확인 1회(acceptancePlan)", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    const token = await mint(env, "bj_s3a0000001");
    const r = await postArtifactTo(routesApp(world), env, token, artifactBody());
    assert.deepEqual(r.body, { ok: true, accepted: true, status: "done", autoCheck: { started: true } });
    const job = db.jobs[0];
    assert.deepEqual([job.status, job.deployed_url, job.commit_sha, job.build_exit_code], ["done", APP_URL, "c0ffee0123456789abcdef0123456789abcdef01", 0]);

    // R2: ASCII 키, 한글 원본 경로는 JSON 안에
    const stored = env.EVIDENCE.objects.get("builds/bj_s3a0000001/artifact.json");
    assert.ok(stored, "artifact stored under builds/<jobId>/artifact.json");
    assert.ok([...env.EVIDENCE.objects.keys()].every((k) => /^[\x20-\x7e]+$/.test(k)), "R2 keys are ASCII");
    assert.ok(JSON.parse(stored.value).source.some((f) => f.path === "src/client/예약 화면.tsx"));

    // 저장소 범위 토큰 — repositories 1개 · contents write만 · App JWT로 · push 뒤 폐기
    assert.equal(world.gh.tokenRequests.length, 1);
    assert.deepEqual(world.gh.tokenRequests[0].body, { repositories: [SLUG], permissions: { contents: "write" } });
    assert.match(world.gh.tokenRequests[0].auth, /^Bearer eyJ/, "minted with the App JWT");
    assert.deepEqual(world.gh.revoked, [`Bearer ${SCOPED}`], "the scoped token is revoked after the push");
    // push 모양: blob(base64 그대로 — 바이너리·한글) → tree(원본 경로) → commit(부모 없음) → ref
    assert.ok(world.gh.blobs.every((b) => b.encoding === "base64" && b.auth === `Bearer ${SCOPED}`));
    const png = artifactBody().source.find((f) => f.path === "public/logo.png").base64;
    assert.ok(world.gh.blobs.some((b) => b.content === png), "binary content is pushed byte-exact (no UTF-8 round trip)");
    assert.deepEqual(world.gh.trees[0].tree.map((t) => t.path), ["src/worker.ts", "src/client/예약 화면.tsx", "public/logo.png", "migrations/0002_add_reservations.sql", ".gitignore"]);
    assert.deepEqual(world.gh.commits[0].parents, []);
    assert.match(world.gh.commits[0].message, /Simsa 빌드 bj_s3a0000001: 작업 1개 완료/);
    assert.deepEqual(world.gh.refs[0], { ref: "refs/heads/main", sha: "c0ffee0123456789abcdef0123456789abcdef01", auth: `Bearer ${SCOPED}` });

    // D1: 기록 테이블 → 적용 목록 → 파일마다 SQL + 기록(운영 토큰 · 잡 행의 d1 id)
    const q = world.d1.queries;
    assert.match(q[0].sql, /^CREATE TABLE IF NOT EXISTS d1_migrations\(/);
    assert.equal(q[1].sql, "SELECT name FROM d1_migrations ORDER BY id");
    assert.equal(q[2].sql, "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY);\nINSERT INTO d1_migrations (name) values ('0001_init.sql');");
    assert.match(q[3].sql, /예약 테이블[\s\S]*INSERT INTO d1_migrations \(name\) values \('0002_add_reservations\.sql'\);$/);
    assert.ok(q.every((x) => x.auth === `Bearer ${CF_OPS}`));

    // 자산: 세션(운영 토큰) → 버킷 업로드(세션 jwt — 운영 토큰 아님) · 해시는 Worker가 계산
    const man = world.assets.manifests[0];
    assert.equal(man.auth, `Bearer ${CF_OPS}`);
    assert.deepEqual(Object.keys(man.manifest).sort(), ["/assets/index-AbC123.js", "/index.html", "/소개 페이지.txt"]);
    for (const a of artifactBody().assets) {
      assert.equal(man.manifest[a.path].hash, await provision.assetHash(a.base64, a.path), `${a.path} hash computed by the Worker`);
      assert.equal(man.manifest[a.path].size, Buffer.from(a.base64, "base64").length);
    }
    const up = world.assets.uploads[0];
    assert.equal(up.auth, "Bearer assets-session-jwt-FAKE", "bucket upload uses the session JWT, never the ops token");
    assert.equal(up.base64, "true");
    assert.ok(up.parts.some((p) => p.type.startsWith("text/html") && unb64(p.text).includes("<script")));

    // Worker 업로드: main=worker.js · 호환 날짜·자산 설정 = Worker 상수 · 바인딩 d1(잡 행 id) + ASSETS
    const s = world.scripts[0];
    assert.equal(s.auth, `Bearer ${CF_OPS}`);
    assert.equal(s.metadata.main_module, "worker.js");
    assert.equal(s.metadata.compatibility_date, provision.HOSTED_COMPATIBILITY_DATE);
    assert.deepEqual(s.metadata.bindings, [{ type: "d1", name: "DB", id: D1 }, { type: "assets", name: "ASSETS" }]);
    assert.deepEqual(s.metadata.assets, { jwt: "assets-complete-jwt-FAKE", config: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] } });
    assert.deepEqual(s.modules.map((m) => [m.name, m.type]), [["worker.js", "application/javascript+module"]]);

    // 내용 확인: health → 페이지
    assert.deepEqual(world.hosted.gets, ["/api/health", "/"]);

    // 자동 확인 1회: 배포 주소 + 지시서 AC
    assert.equal(env.INSPECTOR.payloads.length, 1);
    const insp = env.INSPECTOR.payloads[0];
    assert.equal(insp.targetUrl, APP_URL);
    assert.deepEqual(insp.acceptancePlan.map((a) => a.acceptanceId), ["AC-001"]);
    assert.equal(insp.intent, "동네 손님이 소금빵을 미리 예약한다");
    assert.equal(insp.locale, "ko");
    assert.equal(db.checks.length, 1);
    assert.equal(db.checks[0].target_url, APP_URL);

    // 타임라인 — B-8 화면·영수증이 checkRunId로 잇는다
    assert.deepEqual(eventsOf(db), [
      ["testing", "artifact_received"], ["pushed", "repo_pushed"], ["deploying", "deploy_started"], ["deploying", "d1_migrated"],
      ["deploying", "worker_uploaded"], ["done", "deployed"], ["done", "auto_check_started"],
    ]);
    const auto = db.events.find((e) => e.message === "auto_check_started").meta;
    assert.equal(auto.checkRunId, db.checks[0].id);
    assert.deepEqual(auto.acceptanceIds, ["AC-001"]);
    assert.equal(db.events.find((e) => e.message === "deployed").meta.url, APP_URL);

    // 비밀은 어디에도: 응답·이벤트·R2
    const everything = JSON.stringify([r.body, db.events, db.jobs, [...env.EVIDENCE.objects.values()].map((o) => o.value)]);
    for (const secret of [CF_OPS, SCOPED, token, ICT, KEK, "assets-session-jwt-FAKE", "assets-complete-jwt-FAKE"]) assert.ok(!everything.includes(secret), `no ${secret.slice(0, 12)}… in responses/events/storage`);
  });

  it("저장소가 없으면 push를 정직하게 건너뛰고(이벤트) 배포는 계속 — pushed 상태 없음 · commit_sha null", async () => {
    const db = makeDb({ jobs: [jobRow({ repo_full_name: null })] });
    const env = envFor(db);
    const world = makeWorld();
    const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.equal(r.body.status, "done");
    assert.deepEqual([db.jobs[0].status, db.jobs[0].commit_sha], ["done", null]);
    assert.deepEqual(eventsOf(db).slice(0, 3), [["testing", "artifact_received"], ["testing", "push_skipped:no_repo"], ["deploying", "deploy_started"]]);
    assert.equal(world.gh.tokenRequests.length, 0, "no GitHub token is minted without a repository");
  });

  it("저장소 범위 토큰이 요청보다 넓게 오면(administration 등) 쓰지 않고 폐기 · push 건너뜀(scope_not_narrowed) · 배포는 계속", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld({ scopedPerms: { contents: "write", metadata: "read", administration: "write" } });
    const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.equal(r.body.status, "done");
    assert.deepEqual(world.gh.revoked, [`Bearer ${SCOPED}`]);
    assert.equal(world.gh.blobs.length, 0, "an over-broad token is never used");
    assert.ok(eventsOf(db).some(([, m]) => m === "push_skipped:token_gh_error:scope_not_narrowed"));
  });

  it("잡 행의 저장소가 <호스팅 조직>/<slug>가 아니면 push하지 않는다(repo_mismatch)", async () => {
    const db = makeDb({ jobs: [jobRow({ repo_full_name: `${ORG}/someone-else` })] });
    const env = envFor(db);
    const world = makeWorld();
    await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.equal(world.gh.tokenRequests.length, 0);
    assert.ok(eventsOf(db).some(([, m]) => m === "push_skipped:repo_mismatch"));
  });

  it("D1 마이그레이션 실패 → failed(deploying, d1_migration_failed:cf_7500) · Worker 업로드·자동 확인 없음", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld({ d1Fail: true });
    const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r.body.status, r.body.failedStage, r.body.error], ["failed", "deploying", "d1_migration_failed:cf_7500"]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].failed_stage, db.jobs[0].deployed_url], ["failed", "deploying", null]);
    assert.equal(world.scripts.length, 0);
    assert.equal(env.INSPECTOR.payloads.length, 0);
    assert.ok(!JSON.stringify(db.jobs).includes(CF_OPS));
  });

  it("자산 업로드 실패 → failed(deploying, assets_upload_failed:…) · Worker 업로드 실패 → failed(deploying, worker_upload_failed:cf_10021)", async () => {
    for (const [opts, re] of [[{ assetsFail: true }, /^assets_upload_failed:/], [{ uploadFail: true }, /^worker_upload_failed:cf_10021$/]]) {
      const db = makeDb();
      const env = envFor(db);
      const world = makeWorld(opts);
      const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
      assert.equal(r.body.status, "failed");
      assert.match(db.jobs[0].error, re);
      assert.deepEqual([db.jobs[0].failed_stage, db.jobs[0].deployed_url], ["deploying", null]);
      assert.equal(world.hosted.gets.length, 0, "no content check after a failed upload");
    }
  });

  it("★내용 확인: 200 + 마커일 때만 성공 — 빈 페이지·5xx·마커 없음·health가 JSON 아님·ok:false는 실패(상태 코드만 보지 않는다) · 전파 지연은 다시 시도", async () => {
    const cases = [
      [{ page: { status: 503, body: "Service Unavailable" } }, "content_check_failed:page_status_503"],
      [{ page: { status: 200, body: "   " } }, "content_check_failed:page_empty"],
      [{ page: { status: 200, body: "<!doctype html><h1>Hello</h1>" } }, "content_check_failed:page_marker_missing"],
      [{ health: { status: 200, body: "<html>not json</html>" } }, "content_check_failed:health_not_json"],
      [{ health: { status: 200, body: JSON.stringify({ ok: false }) } }, "content_check_failed:health_not_ok"],
      [{ health: { status: 404, body: "Worker not found" } }, "content_check_failed:health_status_404"],
    ];
    for (const [opts, error] of cases) {
      const db = makeDb();
      const env = envFor(db);
      const world = makeWorld(opts);
      const r = await postArtifactTo(routesApp(world), env, await mint(env, "bj_s3a0000001"), artifactBody());
      assert.deepEqual([r.body.status, r.body.error], ["failed", error], JSON.stringify(opts));
      assert.deepEqual([db.jobs[0].status, db.jobs[0].deployed_url], ["failed", null]);
      assert.equal(world.hosted.gets.filter((p) => p === "/api/health").length, 3, "retried for propagation (3 attempts)");
      assert.equal(env.INSPECTOR.payloads.length, 0);
    }
    // 첫 시도 404(전파 전) → 두 번째 성공
    const db = makeDb();
    const env = envFor(db);
    const slept = [];
    const world = makeWorld({ health: (n) => (n === 1 ? { status: 404, body: "not yet" } : { status: 200, body: JSON.stringify({ ok: true }) }) });
    const r = await postArtifactTo(routesApp(world, { sleep: async (ms) => { slept.push(ms); } }), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.equal(r.body.status, "done");
    assert.deepEqual(slept, [2000]);
  });

  it("checkDeployedContent 단독: 본문 읽기 상한 — 거대한 응답도 상한까지만 읽는다", async () => {
    const check = need(deployMod, "checkDeployedContent", "build-deploy.ts");
    let pulled = 0;
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/api/health")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      const stream = new ReadableStream({ pull(c) { pulled += 1; if (pulled > 1000) return c.close(); c.enqueue(new TextEncoder().encode("<p>".repeat(1000))); } });
      return new Response(stream, { status: 200 });
    };
    const r = await check(APP_URL, fetchImpl, { attempts: 1, maxBodyBytes: 16 * 1024 });
    assert.deepEqual([r.ok, r.reason], [false, "page_marker_missing"]);
    assert.ok(pulled < 50, `stopped reading early (${pulled} chunks)`);
  });

  it("정지된 slug(B-7 정지 목록)는 배포하지 않는다 → failed(deploying, slug_suspended) · KV 바인딩(HOSTING_SUSPENDED)이 있으면 그것을 읽는다", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    const r = await postArtifactTo(routesApp(world, { isSuspended: async (slug) => slug === SLUG }), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r.body.status, r.body.error], ["failed", "slug_suspended"]);
    assert.equal(world.scripts.length + world.d1.queries.length + world.assets.manifests.length, 0, "nothing is deployed for a suspended slug");
    // 기본 조회: 바인딩이 있으면 `suspended:<slug>`
    const kvDb = makeDb();
    const kvEnv = envFor(kvDb, { HOSTING_SUSPENDED: { get: async (k) => (k === `suspended:${SLUG}` ? JSON.stringify({ reason: "phishing" }) : null) } });
    const w2 = makeWorld();
    const r2 = await postArtifactTo(routesApp(w2), kvEnv, await mint(kvEnv, "bj_s3a0000001"), artifactBody());
    assert.deepEqual([r2.body.status, r2.body.error], ["failed", "slug_suspended"]);
    // 바인딩이 없으면 건너뛴다(TODO B-7) — 기본 성공 경로(①)가 그 경우
    const check = need(deployMod, "defaultSuspensionCheck", "build-deploy.ts");
    assert.equal(await check({})(SLUG), false);
  });

  it("자동 확인: 검수 킬스위치 off면 건너뛰고 이벤트(auto_check_skipped:inspection_disabled) · done은 그대로", async () => {
    const db = makeDb();
    const env = envFor(db, { INSPECTION_ENABLED: "off" });
    const r = await postArtifactTo(routesApp(makeWorld()), env, await mint(env, "bj_s3a0000001"), artifactBody());
    assert.deepEqual(r.body, { ok: true, accepted: true, status: "done", autoCheck: { started: false, reason: "inspection_disabled" } });
    assert.equal(db.jobs[0].status, "done");
    assert.equal(env.INSPECTOR.payloads.length, 0);
    assert.equal(db.checks.length, 0);
    assert.deepEqual(eventsOf(db).at(-1), ["done", "auto_check_skipped:inspection_disabled"]);
  });

  it("자동 확인: 별도 일일 상한(시스템 시작 — 유저 상한 밖) · 가득이면 daily_capacity · 프로젝트에 진행 중 검수가 있으면 active_check · 디스패치 실패는 런 failed + 슬롯 환급", async () => {
    // 상한 1로 줄이고 두 잡
    const db = makeDb({ jobs: [jobRow(), jobRow({ id: "bj_s3a0000002" })] });
    const env = envFor(db, { BETA_BUILD_AUTO_CHECK_DAILY_LIMIT: "1" });
    const app = routesApp(makeWorld());
    const a = await postArtifactTo(app, env, await mint(env, "bj_s3a0000001"), artifactBody("bj_s3a0000001"));
    assert.equal(a.body.autoCheck.started, true);
    db.checks[0].status = "done"; // 첫 검수가 끝났다
    const b = await postArtifactTo(app, env, await mint(env, "bj_s3a0000002"), artifactBody("bj_s3a0000002"));
    assert.deepEqual(b.body.autoCheck, { started: false, reason: "daily_capacity" });
    assert.equal(env.INSPECTOR.payloads.length, 1);
    // 진행 중 검수
    const db2 = makeDb({ checks: [{ id: "vc_running", project_id: PROJECT, status: "running" }] });
    const env2 = envFor(db2);
    const c = await postArtifactTo(routesApp(makeWorld()), env2, await mint(env2, "bj_s3a0000001"), artifactBody());
    assert.deepEqual(c.body.autoCheck, { started: false, reason: "active_check" });
    // 디스패치 실패
    const db3 = makeDb();
    const env3 = envFor(db3, { INSPECTOR: makeInspector({ status: 503 }) });
    const d = await postArtifactTo(routesApp(makeWorld()), env3, await mint(env3, "bj_s3a0000001"), artifactBody());
    assert.match(d.body.autoCheck.reason, /^dispatch_failed:container returned 503/);
    assert.equal(db3.checks[0].status, "failed");
    assert.equal([...db3.rate.values()].reduce((s, v) => s + v, 0), 0, "the auto-check slot is refunded when nothing was dispatched");
    assert.equal(db3.jobs[0].status, "done", "the build is still done — the check is a separate step");
  });

  it("★컨테이너 URL 무시: build-done에 deployedUrl을 실어 보내도 저장되지 않는다 — 끝난 잡은 accepted:false(기록 0), 활성 잡의 성공 주장은 409 + failed", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    const app = createApp({ fetch: world.fetchImpl });
    const token = await mint(env, "bj_s3a0000001");
    const r = await postArtifactTo(routesApp(world), env, token, artifactBody());
    assert.equal(r.body.status, "done");
    const eventsBefore = db.events.length;
    const res = await app.fetch(new Request(`${ORIGIN}/internal/build-done`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jobId: "bj_s3a0000001", ok: true, stage: "done", deployedUrl: "https://evil.example/phish", wbsDone: 1 }) }), env);
    assert.deepEqual([res.status, (await res.json()).reason], [200, "worker_owned_done"]);
    assert.equal(db.jobs[0].deployed_url, APP_URL, "the Worker's URL stays");
    assert.equal(db.events.length, eventsBefore, "a finished job gets no trace from the container");
    // 활성 잡의 성공 주장
    const db2 = makeDb();
    const env2 = envFor(db2);
    const res2 = await createApp({ fetch: world.fetchImpl }).fetch(new Request(`${ORIGIN}/internal/build-done`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await mint(env2, "bj_s3a0000001")}` }, body: JSON.stringify({ jobId: "bj_s3a0000001", ok: true, deployedUrl: "https://evil.example" }) }), env2);
    assert.equal(res2.status, 409);
    assert.deepEqual([db2.jobs[0].status, db2.jobs[0].error, db2.jobs[0].deployed_url], ["failed", "done_not_worker_owned", null]);
  });
});

// ══ ③-b 공급자 함수 단위 ═══════════════════════════════════════════════════════════════════════════

describe("③-b hosting-provision · hosting-repo 단위 (요청 모양)", () => {
  it("applyD1Migrations: 이미 적용된 것은 건너뛴다 · 이름에 따옴표는 거부(요청 0) · 운영 자격 없으면 not_configured", async () => {
    const world = makeWorld({ alreadyApplied: ["0001_init.sql"] });
    const env = { HOSTING_CF_API_TOKEN: CF_OPS, HOSTING_CF_ACCOUNT_ID: "acc1" };
    const r = await provision.applyD1Migrations(env, D1, [{ name: "0002_add_reservations.sql", sql: "SELECT 1;" }, { name: "0001_init.sql", sql: "SELECT 0;" }], world.fetchImpl);
    assert.deepEqual(r, { ok: true, value: { applied: ["0002_add_reservations.sql"], alreadyApplied: ["0001_init.sql"] } });
    assert.equal(world.d1.queries.length, 3);
    const w2 = makeWorld();
    const bad = await provision.applyD1Migrations(env, D1, [{ name: "0003_x'); DROP TABLE items; --.sql", sql: "" }], w2.fetchImpl);
    assert.deepEqual([bad.ok, bad.message], [false, "invalid_migration_name"]);
    assert.equal(w2.calls.length, 0);
    assert.deepEqual(await provision.applyD1Migrations({}, D1, [{ name: "0001_init.sql", sql: "" }], w2.fetchImpl), { ok: false, error: "not_configured" });
  });

  it("uploadUserWorkerAssets: 버킷이 비면(이미 있는 자산) 세션 jwt가 완료 토큰 · 자산이 없으면 null(자산 없이 배포)", async () => {
    const env = { HOSTING_CF_API_TOKEN: CF_OPS, HOSTING_CF_ACCOUNT_ID: "acc1" };
    const w = makeWorld({ noBuckets: true });
    const r = await provision.uploadUserWorkerAssets(env, { slug: SLUG, files: [{ path: "/index.html", base64: b64("<script src=/a.js></script>"), bytes: 27 }] }, w.fetchImpl);
    assert.deepEqual(r, { ok: true, value: { jwt: "assets-session-jwt-FAKE", uploaded: 0, total: 1 } });
    assert.equal(w.assets.uploads.length, 0);
    assert.deepEqual(await provision.uploadUserWorkerAssets(env, { slug: SLUG, files: [] }, w.fetchImpl), { ok: true, value: null });
  });

  it("buildUploadMetadata: 자산이 있으면 assets:{jwt,config} + ASSETS 바인딩(wrangler와 같은 모양) — 없으면 종전 모양 그대로", () => {
    const base = provision.buildUploadMetadata({ mainModule: "worker.js", compatibilityDate: "2026-09-01", d1Id: D1 });
    assert.deepEqual(base, { main_module: "worker.js", compatibility_date: "2026-09-01", bindings: [{ type: "d1", name: "DB", id: D1 }], tags: ["simsa-hosted"] });
    const withAssets = provision.buildUploadMetadata({ mainModule: "worker.js", compatibilityDate: "2026-09-01", d1Id: D1, assets: { jwt: "j", config: { not_found_handling: "single-page-application" } } });
    assert.deepEqual(withAssets.bindings.at(-1), { type: "assets", name: "ASSETS" });
    assert.deepEqual(withAssets.assets, { jwt: "j", config: { not_found_handling: "single-page-application" } });
  });

  it("Worker 배포 상수 = 템플릿 wrangler.toml(보호 파일)의 compatibility_date · [assets] 설정 · binding", () => {
    const toml = readFileSync(path.join(REPO_TEMPLATE, "wrangler.toml"), "utf8");
    assert.equal(/^compatibility_date = "([^"]+)"$/m.exec(toml)?.[1], provision.HOSTED_COMPATIBILITY_DATE);
    assert.match(toml, new RegExp(`not_found_handling = "${provision.HOSTED_ASSETS_CONFIG.not_found_handling}"`));
    assert.match(toml, /run_worker_first = \["\/api\/\*"\]/);
    assert.deepEqual([...provision.HOSTED_ASSETS_CONFIG.run_worker_first], ["/api/*"]);
    assert.match(toml, new RegExp(`binding = "${provision.HOSTED_ASSETS_BINDING}"`));
    assert.match(toml, /directory = "\.\/dist\/client"/);
    assert.equal(collect.ASSETS_DIR, "dist/client");
    assert.equal(collect.mainModuleNameFromToml(toml), "worker.js");
  });

  it("getRepoScopedInstallationToken: 저장소 이름 규칙 밖이면 요청 0 · 미설정이면 not_configured", async () => {
    const w = makeWorld();
    const env = envFor(makeDb());
    assert.deepEqual((await repoMod.getRepoScopedInstallationToken(env, "../evil", w.fetchImpl)).message, "invalid_repo_name");
    assert.deepEqual(await repoMod.getRepoScopedInstallationToken({ ...env, HOSTING_GH_APP_PRIVATE_KEY: "" }, SLUG, w.fetchImpl), { ok: false, error: "not_configured" });
    assert.equal(w.calls.length, 0);
  });
});

// ══ ④ 컨테이너 ═══════════════════════════════════════════════════════════════════════════════════

/** 게이트를 지난 작업 폴더 흉내: 템플릿 복사 + vite 산출물 + wrangler dry-run outdir(실측 모양) + 모델의 한글 파일·비밀 미끼. */
async function fakeBuiltApp(tag) {
  const workDir = await tmpDir(tag);
  const appDir = path.join(workDir, "app");
  await fs.cp(REPO_TEMPLATE, appDir, { recursive: true, filter: (src) => !/node_modules|[\\/]dist([\\/]|$)/.test(path.relative(REPO_TEMPLATE, src)) });
  await fs.writeFile(path.join(appDir, "src/client/예약 화면.tsx"), "export const 버튼 = '예약하기';\n");
  await fs.writeFile(path.join(appDir, "migrations/0002_add_reservations.sql"), "-- 예약 테이블 (소금빵)\nCREATE TABLE reservations (id TEXT PRIMARY KEY);\n");
  await fs.writeFile(path.join(appDir, ".env"), "SECRET=FAKE-should-not-ship\n");
  await fs.writeFile(path.join(appDir, ".dev.vars"), "X=FAKE\n");
  await fs.mkdir(path.join(appDir, "node_modules/hono"), { recursive: true });
  await fs.writeFile(path.join(appDir, "node_modules/hono/index.js"), "module.exports = {};\n");
  await fs.mkdir(path.join(appDir, "dist/client/assets"), { recursive: true });
  await fs.writeFile(path.join(appDir, "dist/client/index.html"), '<!doctype html><script type="module" crossorigin src="/assets/index-AbC123.js"></script>');
  await fs.writeFile(path.join(appDir, "dist/client/assets/index-AbC123.js"), 'console.log("예약하기");');
  await fs.writeFile(path.join(appDir, "dist/client/소개 페이지.txt"), "동네 빵집");
  const workerOut = path.join(workDir, "artifact", "worker");
  await fs.mkdir(workerOut, { recursive: true });
  await fs.writeFile(path.join(workerOut, "README.md"), 'This folder contains the built output assets for the worker "sogeum-bread-7a3f" generated at 2026-10-01T00:00:00.000Z.');
  await fs.writeFile(path.join(workerOut, "worker.js"), 'var app = {};\napp.get("/api/health");\nexport default app;\n');
  await fs.writeFile(path.join(workerOut, "worker.js.map"), "{}");
  return { workDir, appDir, workerOut };
}

describe("④ 컨테이너 — 수집기 · 답 해석 · 끝까지(E2E)", () => {
  it("수집기(실제 파일): worker.js만(README·map 제외) · vite 자산(한글 경로) · 마이그레이션 이름순 · 소스(한글 파일) — node_modules·dist·.env·.dev.vars는 없다", async () => {
    assert.ok(collect, "artifact-collect.mjs");
    const { appDir, workerOut } = await fakeBuiltApp("collect");
    const r = await collect.collectArtifact({ appDir, workerOutDir: workerOut });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    const a = r.artifact;
    assert.deepEqual(a.worker.modules.map((m) => m.name), ["worker.js"]);
    assert.equal(a.worker.mainModule, "worker.js");
    assert.deepEqual(a.assets.map((x) => x.path).sort(), ["/assets/index-AbC123.js", "/index.html", "/소개 페이지.txt"]);
    assert.deepEqual(a.migrations.map((m) => m.name), ["0001_init.sql", "0002_add_reservations.sql"]);
    const src = a.source.map((f) => f.path);
    assert.ok(src.includes("src/client/예약 화면.tsx") && src.includes("src/worker.ts") && src.includes("wrangler.toml") && src.includes(".gitignore"));
    assert.ok(!src.some((p) => p.startsWith("node_modules/") || p.startsWith("dist/") || p === ".env" || p === ".dev.vars"), src.join(","));
    assert.ok(!JSON.stringify(a).includes(b64("SECRET=FAKE-should-not-ship\n")));
    // Worker 계약을 그대로 통과한다
    const parsed = artifactMod.parseBuildArtifact(JSON.stringify(run.artifactBody({ jobId: "bj_s3a0000001" }, a, { commits: 2, wbsDone: 1, wbsFailed: [], gateRounds: 0 })));
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
  });

  it("수집기: 상한(소스 파일 수) · 마이그레이션 이름 규칙 · 번들 없음은 정직한 오류", async () => {
    const { appDir, workerOut } = await fakeBuiltApp("collect-limits");
    const r = await collect.collectArtifact({ appDir, workerOutDir: workerOut, limits: { ...collect.ARTIFACT_LIMITS, maxSourceFiles: 3 } });
    assert.deepEqual(r, { ok: false, error: "artifact_too_large:source_count" });
    await fs.writeFile(path.join(appDir, "migrations/0003_예약.sql"), "SELECT 1;");
    const r2 = await collect.collectArtifact({ appDir, workerOutDir: workerOut });
    assert.deepEqual(r2, { ok: false, error: "migration_name_invalid:0003_예약.sql" });
    await fs.rm(path.join(appDir, "migrations/0003_예약.sql"));
    const empty = await tmpDir("collect-nobundle");
    assert.deepEqual(await collect.collectArtifact({ appDir, workerOutDir: empty }), { ok: false, error: "worker_bundle_missing" });
    await fs.writeFile(path.join(empty, "README.md"), "only the readme");
    assert.deepEqual(await collect.collectArtifact({ appDir, workerOutDir: empty }), { ok: false, error: "worker_bundle_missing" }, "README.md alone is not a bundle");
  });

  it("수집기 CLI(실제 프로세스 · sandboxExec): stdout JSON 한 줄 → produceArtifact가 읽는다 · 번들 실패는 artifact_bundle_failed:exit_N", async () => {
    const { workDir, appDir } = await fakeBuiltApp("collect-cli");
    const workerOut = path.join(workDir, "artifact", "worker");
    const readme = await fs.readFile(path.join(workerOut, "README.md"), "utf8");
    const exec = async (cmd, args, opts) => {
      if (cmd === "wrangler") {
        assert.deepEqual(args, ["deploy", "--dry-run", "--outdir", workerOut]);
        assert.equal(opts.env.WRANGLER_SEND_METRICS, "false");
        assert.ok(!Object.keys(opts.env).some((k) => /CLOUDFLARE|TOKEN|KEY/.test(k)), "no credentials for the bundle");
        // produceArtifact가 outdir를 먼저 비운다 — wrangler 흉내로 다시 만든다(실측 모양).
        await fs.mkdir(workerOut, { recursive: true });
        await fs.writeFile(path.join(workerOut, "README.md"), readme);
        await fs.writeFile(path.join(workerOut, "worker.js"), 'export default { fetch() { return new Response("/api/health"); } };\n');
        await fs.writeFile(path.join(workerOut, "worker.js.map"), "{}");
        return { ok: true, code: 0, stdout: "--dry-run: exiting now.", stderr: "" };
      }
      return work.sandboxExec(cmd, args, { ...opts, maxOutputBytes: opts.maxOutputBytes });
    };
    const env = work.workEnv(process.env, { offline: true });
    const r = await run.produceArtifact({ appDir, workDir, exec, env, bundleEnvironment: work.bundleEnv(process.env), signal: null });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(r.artifact.worker.mainModule, "worker.js");
    assert.ok(r.artifact.source.some((f) => f.path === "src/client/예약 화면.tsx"));
    const bad = await run.produceArtifact({ appDir, workDir, exec: async () => ({ ok: false, code: 1, stdout: "", stderr: "✘ [ERROR] Could not resolve \"hono\"" }), env, signal: null });
    assert.deepEqual([bad.ok, bad.error], [false, "artifact_bundle_failed:exit_1"]);
    assert.match(bad.log, /Could not resolve/);
  });

  it("Worker 답 해석(interpretArtifactReply): done만 성공 — 실패·거절·5xx·Worker 모양이 아닌 2xx는 전부 failed(deploying 또는 Worker가 준 단계)", () => {
    const i = need(run, "interpretArtifactReply", "builder-run.mjs");
    assert.deepEqual(i({ ok: true, status: 200, json: { ok: true, accepted: true, status: "done" } }), { done: true });
    assert.deepEqual(i({ ok: true, status: 200, json: { ok: true, accepted: true, status: "failed", failedStage: "deploying", error: "d1_migration_failed:cf_7500" } }), { done: false, failedStage: "deploying", error: "d1_migration_failed:cf_7500" });
    assert.deepEqual(i({ ok: true, status: 200, json: { ok: true, accepted: false, reason: "build_disabled" } }), { done: false, failedStage: "deploying", error: "build_disabled" });
    assert.deepEqual(i({ ok: false, status: 413, json: { ok: false, error: "artifact_too_large" } }), { done: false, failedStage: "deploying", error: "artifact_rejected:413:artifact_too_large" });
    assert.deepEqual(i({ ok: false, status: 502, json: null }), { done: false, failedStage: "deploying", error: "artifact_upload_failed:502" });
    assert.deepEqual(i({ ok: false, status: 0, json: null }), { done: false, failedStage: "deploying", error: "artifact_upload_failed:network" });
    assert.deepEqual(i({ ok: true, status: 200, json: { ok: true, transitioned: true } }), { done: false, failedStage: "deploying", error: "artifact_upload_failed:200" });
    assert.deepEqual(i({ ok: true, status: 200, json: "<html>captive</html>" }), { done: false, failedStage: "deploying", error: "artifact_upload_failed:200" });
  });

  it("★끝까지(E2E): 만들기 한 번 → 컨테이너(스캐폴드·WBS·게이트·산출물 — 실제 수집기) → 실제 Worker 라우트(진행·산출물·최종) → push·D1·배포·내용 확인 → done → 자동 확인(영수증 고리)", async () => {
    const db = makeDb({ jobs: [jobRow({ id: "bj_s3e2e00001", status: "queued", wbs_done: 0, spent_usd: 0 })] });
    const env = envFor(db);
    const world = makeWorld();
    const app = createApp({ fetch: world.fetchImpl });
    // 라우트 앱(대기 없음)과 전체 앱을 잇는다: 산출물 경로만 라우트 앱(내용 확인 sleep 없음), 나머지는 전체 앱.
    const routes = routesApp(world);
    const intoWorker = async (url, init = {}) => {
      const req = new Request(String(url), init);
      return (new URL(req.url).pathname === "/internal/build-artifact" ? routes : app).fetch(req, env);
    };
    const jobToken = await mint(env, "bj_s3e2e00001");
    const payload = {
      jobId: "bj_s3e2e00001", kind: "build", slug: SLUG, locale: "ko",
      baseUrl: ORIGIN, callbackUrl: `${ORIGIN}/internal/build-done`, progressUrl: `${ORIGIN}/internal/build-progress`,
      jobToken, budgetUsd: 10,
      spec: { markdown: `# ${PRODUCT}`, wbs: [{ id: "WBS-001", title: "예약 화면 — 한글 버튼 '예약하기'", order: 1, acceptanceIds: ["AC-001"], dependsOn: [], must: true }], productName: PRODUCT },
      hosting: { d1Id: D1 },
      llm: { model: "claude-sonnet-4-6", openaiModel: "gpt-5.4", preferFallback: false },
    };
    let n = 0;
    const exec = async (cmd, args, opts = {}) => {
      const ok = (stdout = "") => ({ ok: true, code: 0, stdout, stderr: "", timedOut: false, aborted: false, error: null });
      if (cmd === "git" && args.includes("rev-parse")) return ok(`${String(++n).padStart(2, "0")}${"cd".repeat(19)}\n`);
      if (cmd === "pnpm" && args[0] === "run" && args[1] === "build") {
        // vite build 흉내 — dist/client
        await fs.mkdir(path.join(opts.cwd, "dist/client/assets"), { recursive: true });
        await fs.writeFile(path.join(opts.cwd, "dist/client/index.html"), '<!doctype html><script type="module" crossorigin src="/assets/index-E2E.js"></script>');
        await fs.writeFile(path.join(opts.cwd, "dist/client/assets/index-E2E.js"), 'console.log("예약하기");');
        return ok();
      }
      if (cmd === "wrangler") {
        const out = args[3];
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(path.join(out, "README.md"), "dry run");
        await fs.writeFile(path.join(out, "worker.js"), 'app.get("/api/health");\nexport default app;\n');
        await fs.writeFile(path.join(out, "worker.js.map"), "{}");
        return ok("--dry-run: exiting now.");
      }
      if (args[0] === run.ARTIFACT_COLLECTOR_ENTRY) {
        const res = await collect.collectArtifact({ appDir: args[2], workerOutDir: args[4] });
        return ok(`${JSON.stringify(res)}\n`);
      }
      return ok();
    };
    const implementWbs = async ({ appDir }) => {
      await fs.writeFile(path.join(appDir, "src/client/App.tsx"), `export function App() { return <main><h1>${PRODUCT}</h1><button type="button">예약하기</button></main>; }\n`);
      await fs.writeFile(path.join(appDir, "src/client/예약 화면.tsx"), "export const 버튼 = '예약하기';\n");
      await fs.writeFile(path.join(appDir, "migrations/0002_add_reservations.sql"), "-- 예약 테이블 (소금빵)\nCREATE TABLE reservations (id TEXT PRIMARY KEY, 이름 TEXT);\n");
      await fs.writeFile(path.join(appDir, ".env"), "SECRET=FAKE-model-wrote-this\n");
      return { status: "done", commitMessage: "feat(WBS-001): 예약 화면" };
    };
    const postCallback = (url, token, body) => run.postCallback(url, token, body, { fetchImpl: intoWorker, retries: 0 });
    const uploadArtifact = (url, token, body, opts) => run.postArtifact(url, token, body, { ...opts, fetchImpl: intoWorker });
    const result = await run.runBuildJob(payload, { workRoot: await tmpDir("e2e"), templateDir: REPO_TEMPLATE, exec, postCallback, uploadArtifact, implementWbs, sandbox: null, log: () => {} });

    // 컨테이너의 최종 보고: done · 주소 없음
    assert.deepEqual([result.ok, result.stage, result.wbsDone, result.artifact.uploaded, "deployedUrl" in result], [true, "done", 1, true, false], JSON.stringify(result).slice(0, 300));
    // server.mjs가 하는 일: 최종 보고를 build-done으로 — 끝난 잡이라 기록 0
    const eventsBefore = db.events.length;
    const fin = await run.postCallback(payload.callbackUrl, jobToken, result, { fetchImpl: intoWorker, retries: 0 });
    assert.deepEqual([fin.status, fin.json.accepted, fin.json.reason], [200, false, "worker_owned_done"]);
    assert.equal(db.events.length, eventsBefore);

    const job = db.jobs[0];
    assert.deepEqual([job.status, job.deployed_url, job.build_exit_code, job.wbs_done], ["done", APP_URL, 0, 1]);
    assert.equal(job.commit_sha, "c0ffee0123456789abcdef0123456789abcdef01");
    assert.deepEqual(eventsOf(db, "bj_s3e2e00001"), [
      ["scaffolding", "scaffold_started"], ["scaffolding", "scaffold_ready"], ["implementing", "wbs_started"], ["implementing", "wbs_done"],
      ["building", "gate_started"], ["testing", "test_started"], ["testing", "gate_passed"], ["testing", "artifact_started"], ["testing", "artifact_ready"],
      ["testing", "artifact_received"], ["pushed", "repo_pushed"], ["deploying", "deploy_started"], ["deploying", "d1_migrated"], ["deploying", "worker_uploaded"],
      ["done", "deployed"], ["done", "auto_check_started"],
    ]);
    // 저장소에 올라간 것: 모델의 한글 파일 · 템플릿 · 마이그레이션 — .env·node_modules·dist 없음
    const tree = world.gh.trees[0].tree.map((t) => t.path);
    assert.ok(tree.includes("src/client/예약 화면.tsx") && tree.includes("src/client/App.tsx") && tree.includes("migrations/0002_add_reservations.sql") && tree.includes("wrangler.toml"), tree.join(","));
    assert.ok(!tree.some((p) => p === ".env" || p.startsWith("node_modules/") || p.startsWith("dist/")), tree.join(","));
    const appBlob = world.gh.blobs[tree.indexOf("src/client/App.tsx")];
    assert.match(unb64(appBlob.content), /예약하기/);
    // 배포된 것: wrangler 번들 · vite 자산 · 두 마이그레이션(한글 주석 포함)
    assert.deepEqual(world.scripts[0].modules.map((m) => m.name), ["worker.js"]);
    assert.deepEqual(Object.keys(world.assets.manifests[0].manifest).sort(), ["/assets/index-E2E.js", "/index.html"]);
    assert.deepEqual(world.d1.applied, ["0001_init.sql", "0002_add_reservations.sql"]);
    // 영수증 고리: 자동 확인 런 id가 이벤트에 · 검수는 배포 주소 + AC-001
    const auto = db.events.find((e) => e.job_id === "bj_s3e2e00001" && e.message === "auto_check_started").meta;
    assert.equal(auto.checkRunId, env.INSPECTOR.payloads[0].runId);
    assert.equal(env.INSPECTOR.payloads[0].targetUrl, APP_URL);
    assert.deepEqual(env.INSPECTOR.payloads[0].acceptancePlan.map((s) => s.acceptanceId), ["AC-001"]);
    // 비밀: 산출물·저장소·타임라인 어디에도 jobToken·운영 토큰·모델이 쓴 .env 내용이 없다
    // (가짜 GitHub가 기록한 요청 헤더의 범위 토큰은 제외 — 내용만 본다)
    const everything = JSON.stringify([db.events, db.jobs, [...env.EVIDENCE.objects.values()].map((o) => o.value), world.gh.blobs.map((b) => b.content), world.gh.commits.map((c) => c.message), result]);
    for (const s of [jobToken, CF_OPS, SCOPED, "FAKE-model-wrote-this", b64("SECRET=FAKE-model-wrote-this\n")]) assert.ok(!everything.includes(s), `leak: ${s.slice(0, 16)}`);
  });
});

// ══ ⑤ 프로젝트 삭제 ═════════════════════════════════════════════════════════════════════════════

describe("⑤ 프로젝트 삭제는 빌드 산출물(builds/<jobId>/)도 지운다", () => {
  it("이 프로젝트의 빌드 잡 접두만 — 다른 프로젝트의 산출물은 그대로", async () => {
    const db = makeDb({ jobs: [jobRow({ id: "bj_s3del00001" }), jobRow({ id: "bj_s3other999", project_id: "wsp_other", slug: "other-app-1", d1_id: "other-d1-0001", repo_full_name: `${ORG}/other-app-1` })], projects: [PROJECT, "wsp_other"] });
    const env = envFor(db);
    const world = makeWorld();
    await env.EVIDENCE.put("builds/bj_s3del00001/artifact.json", "{}");
    await env.EVIDENCE.put("builds/bj_s3other999/artifact.json", "{}");
    await env.EVIDENCE.put(`checks/${USER}/${PROJECT}/vc_1/shot.png`, "x");
    await dbMod.deleteProject(env, PROJECT, USER, { fetch: world.fetchImpl });
    assert.deepEqual([...env.EVIDENCE.objects.keys()], ["builds/bj_s3other999/artifact.json"]);
    assert.ok(env.EVIDENCE.deleted.includes("builds/bj_s3del00001/artifact.json"));
    assert.deepEqual(db.jobs.map((j) => j.id), ["bj_s3other999"], "the other project's build job is untouched");
  });
});

// ══ ⑥ PR #569 S3 검증 결함 1~7 ═══════════════════════════════════════════════════════════════════
//
// 삭제 경합(1) · 삭제 → 호스팅 자원 정리(2) · 바깥 쓰기 직전마다 관문(3) · 산출물 라우트 메모리(4) · 정지 목록 먼저 + fail-closed(5) ·
// done은 산출물 수령 행만 — DB 조건(6) · 산출물 수령 뒤 잡은 Worker 소유 + 파이프라인 마감(7). 전부 가짜 fetch·가짜 D1/R2/KV,
// 실제 SQLite(0068)는 새 SQL의 모양 확인에만. 옛 코드에서 각자 실패한다(PR 코멘트 표).

const JOB = "bj_s3a0000001";
/** 조건에 맞는 첫 요청에서 한 번만 끼어든다(경합 재현). */
const onFirst = (pred, fn) => {
  let fired = false;
  return async (c) => {
    if (fired || !pred(c)) return;
    fired = true;
    await fn(c);
  };
};
const isD1Query = (c) => c.host === "api.cloudflare.com" && c.path.endsWith("/query");
const isScriptPut = (c) => c.host === "api.cloudflare.com" && c.method === "PUT" && c.path.endsWith(`/scripts/${SLUG}`);
const deleteWith = (env, world) => dbMod.deleteProject(env, PROJECT, USER, { fetch: world.fetchImpl });

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const noSqlite = DatabaseSync ? false : "node:sqlite 없음(Node < 22.13) — 미측정";
/** node:sqlite 위의 얇은 D1 어댑터(batch = 트랜잭션). */
function sqliteD1(sqlite) {
  const stmt = (sql, args) => ({
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return {
    prepare: (sql) => ({ bind: (...a) => stmt(sql, a), run: () => stmt(sql, []).run(), first: () => stmt(sql, []).first(), all: () => stmt(sql, []).all() }),
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
function freshSqlite() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(path.join(ROOT, "migrations/0068_build_jobs.sql"), "utf8"));
  sqlite.exec("CREATE TABLE workspace_projects (id TEXT PRIMARY KEY)");
  return sqlite;
}

describe("⑥ PR #569 S3 검증 결함 — 삭제 경합 · 호스팅 정리 · 관문 · 메모리 · 정지 · done 조건 · Worker 소유", () => {
  // ── 결함 1 ──
  it("[결함 1] 프로젝트 삭제 뒤 산출물 POST → 받지 않는다: R2 사본 · push · D1 · 업로드 0", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    const token = await mint(env, JOB);
    await deleteWith(env, world);
    const before = { calls: world.calls.length, commits: world.gh.commits.length, scripts: world.scripts.length };
    const r = await postArtifactTo(routesApp(world), env, token, artifactBody());
    assert.notEqual(r.body?.status, "done", JSON.stringify(r.body));
    assert.ok(r.body?.accepted !== true, `not accepted: ${JSON.stringify(r.body)}`);
    assert.equal(env.EVIDENCE.objects.size, 0, "no R2 copy after the delete");
    assert.deepEqual({ calls: world.calls.length, commits: world.gh.commits.length, scripts: world.scripts.length }, before, "no GitHub / Cloudflare / hosted-app call after the delete");
  });

  it("[결함 1] 프로젝트 행이 이미 없는데 잡이 아직 활성(삭제가 잡을 멈추기 전)이면 → accepted:false(project_deleted) · 잡 failed(testing, project_deleted) · 부수 효과 0", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld();
    db.projects.delete(PROJECT);
    const r = await postArtifactTo(routesApp(world), env, await mint(env, JOB), artifactBody());
    assert.deepEqual([r.status, r.body.accepted, r.body.reason], [200, false, "project_deleted"]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].failed_stage, db.jobs[0].error, db.jobs[0].build_exit_code], ["failed", "testing", "project_deleted", null]);
    assert.equal(env.EVIDENCE.objects.size, 0);
    assert.equal(world.calls.length, 0);
  });

  it("[결함 1] 배포 도중 삭제(첫 D1 쿼리 시점) → 그 뒤 자산·업로드·내용 확인 0 · done 아님 · R2 사본 없음 · 삭제된 잡에 타임라인 없음", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld({ before: onFirst(isD1Query, () => deleteWith(env, world)) });
    const r = await postArtifactTo(routesApp(world), env, await mint(env, JOB), artifactBody());
    assert.deepEqual([r.body.status, r.body.error], ["failed", "project_deleted"], JSON.stringify(r.body));
    assert.deepEqual(world.scriptOps.filter((o) => o === "PUT"), [], "the app is never uploaded after the delete");
    assert.equal(world.assets.manifests.length, 0);
    assert.equal(world.hosted.gets.length, 0);
    assert.equal(env.INSPECTOR.payloads.length, 0);
    assert.equal(env.EVIDENCE.objects.size, 0, "the stored artifact was swept by the delete");
    assert.deepEqual(db.events.filter((e) => e.job_id === JOB), [], "no trace is written for a deleted job");
  });

  it("[결함 1] Worker 업로드 도중 삭제 → 업로드 뒤 방금 올린 Worker를 지운다(마지막 동작이 DELETE) · done 아님 · 자동 확인 0", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld({ before: onFirst(isScriptPut, () => deleteWith(env, world)) });
    const r = await postArtifactTo(routesApp(world), env, await mint(env, JOB), artifactBody());
    assert.deepEqual([r.body.status, r.body.error], ["failed", "project_deleted"], JSON.stringify(r.body));
    assert.ok(world.scriptOps.includes("PUT"), `ops: ${world.scriptOps.join(",")}`);
    assert.equal(world.scriptOps.at(-1), "DELETE", `the public Worker must not outlive the project (ops: ${world.scriptOps.join(",")})`);
    assert.equal(world.hosted.gets.length, 0, "no content check for a deleted project");
    assert.equal(env.INSPECTOR.payloads.length, 0);
  });

  // ── 결함 2 ──
  it("[결함 2] 프로젝트 삭제 → 호스팅 자원 정리: 공개 Worker · 프로젝트 D1 · 조직 저장소(그 저장소 하나 · administration 쓰기만 · 쓰고 폐기) · 잡 행·타임라인 삭제", async () => {
    const db = makeDb({ jobs: [jobRow({ status: "done", deployed_url: APP_URL, build_exit_code: 0, commit_sha: "c0ffee01" })] });
    db.events.push({ id: "bje_1", job_id: JOB, at: "2026-10-01T00:00:00Z", stage: "done", message: "deployed", meta: { url: APP_URL } });
    const env = envFor(db);
    const world = makeWorld();
    await deleteWith(env, world);
    const cf = world.calls.filter((c) => c.host === "api.cloudflare.com");
    assert.deepEqual(
      cf.map((c) => `${c.method} ${c.path.replace("/client/v4/accounts/acc1", "")}`).sort(),
      [`DELETE /d1/database/${D1}`, `DELETE /workers/dispatch/namespaces/simsa-hosted/scripts/${SLUG}`].sort(),
    );
    assert.ok(cf.every((c) => c.auth === `Bearer ${CF_OPS}`), "the ops token lives only in the Worker");
    assert.deepEqual(world.gh.tokenRequests.map((t) => t.body), [{ repositories: [SLUG], permissions: { administration: "write" } }], "a token for that one repository, administration only");
    assert.deepEqual(world.gh.repoDeletes, [{ repo: `${ORG}/${SLUG}`, auth: `Bearer ${SCOPED}` }]);
    assert.deepEqual(world.gh.revoked, [`Bearer ${SCOPED}`], "the delete token is revoked after use");
    assert.deepEqual(db.jobs, [], "build job rows are gone once the hosting is gone");
    assert.deepEqual(db.events, []);
    assert.equal(world.hosted.gets.length, 0);
  });

  it("[결함 2] 정리가 실패하면 잡 행을 삭제 표시(user_key '')로 남기고 5분 크론이 다시 시도해 끝낸다 · 같은 slug를 다른 프로젝트가 쓰면 그 Worker·저장소는 두고 · 프로젝트가 살아 있거나 표시가 없으면 아무것도 지우지 않는다", async () => {
    const sweep = need(teardownMod, "sweepDeletedProjectHosting", "hosted-app-teardown.ts");
    const teardown = need(teardownMod, "teardownHostedAppsForProject", "hosted-app-teardown.ts");
    // ① Worker 삭제 5xx → 행이 남는다(삭제 표시) → 크론이 끝낸다
    const db = makeDb();
    const env = envFor(db);
    await deleteWith(env, makeWorld({ scriptDeleteFail: true }));
    assert.equal(db.jobs.length, 1, "kept as a pointer to what is still live");
    assert.equal(db.jobs[0].user_key, "", "unlinked from the person (privacy §1)");
    const w2 = makeWorld();
    assert.deepEqual(await sweep(env, w2.fetchImpl), { projects: 1, cleaned: 1, failed: 0 });
    assert.deepEqual(w2.scriptOps, ["DELETE"]);
    assert.deepEqual(db.jobs, []);
    assert.deepEqual(await sweep(env, w2.fetchImpl), { projects: 0, cleaned: 0, failed: 0 }, "nothing left to retry");
    // ② 같은 slug·다른 프로젝트
    const db3 = makeDb({ jobs: [jobRow(), jobRow({ id: "bj_s3other999", project_id: "wsp_other", d1_id: "other-d1-0001" })], projects: [PROJECT, "wsp_other"] });
    const w3 = makeWorld();
    await dbMod.deleteProject(envFor(db3), PROJECT, USER, { fetch: w3.fetchImpl });
    assert.deepEqual(w3.scriptOps, [], "a slug another project also uses is not deleted");
    assert.deepEqual(w3.gh.repoDeletes, []);
    assert.equal(w3.d1.deleted.length, 1, "this project's own D1 is deleted");
    assert.deepEqual(db3.jobs.map((j) => j.id), ["bj_s3other999"]);
    // ③ 프로젝트가 살아 있으면 — 삭제 표시가 있어도 — 아무것도 지우지 않는다
    const w4 = makeWorld();
    const r4 = await teardown(envFor(makeDb({ jobs: [jobRow({ user_key: "" })] })), PROJECT, w4.fetchImpl);
    assert.deepEqual([r4.ok, r4.failures], [false, ["project_exists"]]);
    assert.equal(w4.calls.length, 0);
    // ④ 삭제 표시가 없으면(프로젝트 행만 없음) 크론은 건드리지 않는다
    const w5 = makeWorld();
    assert.deepEqual(await sweep(envFor(makeDb({ jobs: [jobRow()], projects: [] })), w5.fetchImpl), { projects: 0, cleaned: 0, failed: 0 });
    assert.equal(w5.calls.length, 0);
  });

  // ── 결함 3 ──
  it("[결함 3] 잡이 배포 도중 다른 이유로 닫히면(스턱 스윕) 또는 킬스위치가 꺼지면 → 그 뒤 자산·업로드·내용 확인 0 · 닫은 쪽의 기록이 남는다", async () => {
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld({ before: onFirst(isD1Query, () => buildDb.markBuildJobFailed(env, JOB, { failedStage: "deploying", error: "stuck_swept (FAKE)" })) });
    const r = await postArtifactTo(routesApp(world), env, await mint(env, JOB), artifactBody());
    assert.deepEqual([r.body.status, r.body.error], ["failed", "stuck_swept (FAKE)"]);
    assert.deepEqual([world.scripts.length, world.assets.manifests.length, world.hosted.gets.length], [0, 0, 0], "a closed job is never uploaded");
    assert.deepEqual([db.jobs[0].status, db.jobs[0].error, db.jobs[0].deployed_url], ["failed", "stuck_swept (FAKE)", null]);
    // 킬스위치 — 같은 시점에 BUILD_ENABLED=off
    const db2 = makeDb();
    const env2 = envFor(db2);
    const w2 = makeWorld({ before: onFirst(isD1Query, async () => { env2.BUILD_ENABLED = "off"; }) });
    const r2 = await postArtifactTo(routesApp(w2), env2, await mint(env2, JOB), artifactBody());
    assert.deepEqual([r2.body.status, r2.body.error], ["failed", "build_disabled"]);
    assert.deepEqual([w2.scripts.length, env2.INSPECTOR.payloads.length], [0, 0]);
    assert.deepEqual([db2.jobs[0].status, db2.jobs[0].failed_stage, db2.jobs[0].error], ["failed", "deploying", "build_disabled"]);
  });

  // ── 결함 7 ──
  it("[결함 7] Worker가 배포하는 도중 컨테이너의 실패 보고(job_aborted — 업로드 대기 초과·마감·드레인) → 기록만(worker_owns_deploy) · 거짓 done 주장도 잡을 닫지 않는다 · 잡은 Worker가 끝까지 done · 자동 확인 1회", async () => {
    const db = makeDb();
    const env = envFor(db);
    const token = await mint(env, JOB);
    const replies = [];
    const world = makeWorld({
      before: onFirst(isD1Query, async () => {
        for (const body of [{ jobId: JOB, ok: false, failedStage: "deploying", error: "job_aborted" }, { jobId: JOB, ok: true, stage: "done" }]) {
          const res = await createApp({ fetch: world.fetchImpl }).fetch(new Request(`${ORIGIN}/internal/build-done`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env);
          replies.push({ status: res.status, body: await res.json() });
        }
      }),
    });
    const r = await postArtifactTo(routesApp(world), env, token, artifactBody());
    assert.deepEqual(replies[0], { status: 200, body: { ok: true, accepted: false, reason: "worker_owns_deploy" } });
    assert.equal(replies[1].status, 409, "a done claim from the container is still refused");
    assert.equal(r.body.status, "done", JSON.stringify(r.body));
    assert.deepEqual([db.jobs[0].status, db.jobs[0].deployed_url], ["done", APP_URL]);
    assert.equal(env.INSPECTOR.payloads.length, 1);
    assert.ok(eventsOf(db).some(([, m]) => m === "container_reported_failure:job_aborted"), JSON.stringify(eventsOf(db)));
  });

  it("[결함 7] 마감: 걸린 바깥 호출은 파이프라인 마감에 끊기고 failed(deploying, deploy_timeout) · 업로드 0 · push 토큰은 그래도 폐기 · Worker 마감 < 컨테이너 업로드 대기", async () => {
    const deadline = need(deployMod, "BUILD_DEPLOY_DEADLINE_MS", "build-deploy.ts");
    assert.ok(deadline < run.ARTIFACT_TIMEOUTS.uploadMs, "the Worker must finish before the container gives up waiting");
    const db = makeDb();
    const env = envFor(db);
    const world = makeWorld({ hangD1: true });
    const t0 = Date.now();
    const r = await postArtifactTo(routesApp(world, { deadlineMs: 300 }), env, await mint(env, JOB), artifactBody());
    assert.deepEqual([r.body.status, r.body.failedStage, r.body.error], ["failed", "deploying", "deploy_timeout"], JSON.stringify(r.body));
    assert.ok(Date.now() - t0 < 1400, "cut by the deadline, not by the hung request");
    assert.deepEqual([world.scripts.length, world.hosted.gets.length], [0, 0]);
    assert.deepEqual([db.jobs[0].status, db.jobs[0].error], ["failed", "deploy_timeout"]);
    assert.deepEqual(world.gh.revoked, [`Bearer ${SCOPED}`], "the push token is revoked outside the deadline");
  });

  it("[결함 7] Worker 소유 잡(산출물 수령 뒤)이 마감+유예보다 오래 활성이면 스턱 스윕이 닫는다(deploy_interrupted) — 살아 있는 배포·산출물 전 잡은 그대로", async () => {
    const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
    const db = makeDb({
      jobs: [
        jobRow({ id: "bj_s3dead0001", status: "deploying", build_exit_code: 0, updated_at: minsAgo(11) }),
        jobRow({ id: "bj_s3live0001", status: "deploying", build_exit_code: 0, updated_at: minsAgo(2) }),
        jobRow({ id: "bj_s3impl0001", status: "implementing", build_exit_code: null, updated_at: minsAgo(11) }),
      ],
    });
    const r = await stuckMod.cleanupStuckBuildJobs(envFor(db));
    assert.deepEqual(r, { swept: 1, errors: 0 });
    assert.deepEqual(db.jobs.map((j) => [j.id, j.status, j.error]), [["bj_s3dead0001", "failed", "deploy_interrupted"], ["bj_s3live0001", "deploying", null], ["bj_s3impl0001", "implementing", null]]);
  });

  // ── 결함 4 ──
  it("[결함 4] 메모리: 상한 근처 본문(한글 파일 이름)을 받는 동안 요청 하나가 붙잡는 라이브 메모리 ≤ 본문 × 3 · ≤ 40 MiB (자식 프로세스 --expose-gc, R2 put 순간)", () => {
    const probe = path.join(HERE, "_b5b-s3-memory-probe.mjs");
    const out = spawnSync(process.execPath, ["--expose-gc", probe, path.join(ROOT, "dist")], { encoding: "utf8", timeout: 120_000 });
    const line = String(out.stdout ?? "").trim().split("\n").filter((l) => l.startsWith('{"bodyBytes"')).at(-1);
    assert.ok(line, `probe output: ${String(out.stdout).slice(-400)} ${String(out.stderr).slice(-400)}`);
    const m = JSON.parse(line);
    assert.equal(m.reply?.error, "artifact_store_failed", "the probe stops at the R2 put (no deploy, no network)");
    assert.ok(m.bodyBytes > 0.8 * artifactMod.BUILD_ARTIFACT_LIMITS.maxBodyBytes, `near the limit (${m.bodyBytes})`);
    const MiB = 1024 * 1024;
    const live = `${(m.deltaBytes / MiB).toFixed(1)} MiB for a ${(m.bodyBytes / MiB).toFixed(1)} MiB body`;
    assert.ok(m.deltaBytes <= 3 * m.bodyBytes, `live ≤ 3 × body: ${live}`);
    assert.ok(m.deltaBytes <= 40 * MiB, `live ≤ 40 MiB (Worker isolate 128 MB is shared): ${live}`);
  });

  it("[결함 4] R2에는 받은 본문 바이트 그대로(재직렬화 없음 · 형식 표지) · 날것 비ASCII 본문은 400 artifact_invalid:non_ascii_body · 컨테이너는 ASCII JSON으로 보낸다(한글은 되살아난다) · 상한은 13 MiB 안", async () => {
    const db = makeDb();
    const env = envFor(db);
    const sent = asciiJson(artifactBody());
    const r = await postArtifactTo(routesApp(makeWorld()), env, await mint(env, JOB), sent);
    assert.equal(r.body.status, "done", JSON.stringify(r.body));
    const stored = env.EVIDENCE.objects.get(`builds/${JOB}/artifact.json`);
    assert.equal(Buffer.compare(stored.bytes, Buffer.from(sent, "utf8")), 0, "stored exactly what was received");
    assert.equal(stored.opts?.customMetadata?.format, "artifact-body-v1");
    // 날것 한글 본문 — 거절 + failed(deploying)
    const db2 = makeDb();
    const env2 = envFor(db2);
    const raw = JSON.stringify(artifactBody());
    assert.ok(/[^\x00-\x7f]/.test(raw), "fixture carries raw Korean");
    const r2 = await postArtifactTo(routesApp(makeWorld()), env2, await mint(env2, JOB), raw);
    assert.deepEqual([r2.status, r2.body.detail], [400, "artifact_invalid:non_ascii_body"]);
    assert.deepEqual([db2.jobs[0].status, db2.jobs[0].failed_stage], ["failed", "deploying"]);
    // 컨테이너: postArtifact 본문은 ASCII · 한글 경로는 JSON.parse로 그대로
    assert.equal(typeof run.asciiJson, "function", "builder-run.mjs asciiJson (B-5b S3 결함 4)");
    assert.equal(run.asciiJson(artifactBody()), sent, "container and test serialize the same way");
    let captured = null;
    await run.postArtifact(`${ORIGIN}/internal/build-artifact`, "t", artifactBody(), { fetchImpl: async (_u, init) => { captured = init.body; return new Response("{}", { status: 200 }); } });
    assert.ok(!/[^\x00-\x7f]/.test(captured), "the container sends ASCII only");
    assert.ok(JSON.parse(captured).source.some((f) => f.path === "src/client/예약 화면.tsx"), "Korean paths survive (Rule 6)");
    // 상한: 구역 합계 × 4/3 < 본문 상한 ≤ 13 MiB · 컨테이너와 같다
    const L = artifactMod.BUILD_ARTIFACT_LIMITS;
    assert.ok(L.maxBodyBytes <= 13 * 1024 * 1024, `maxBodyBytes ${L.maxBodyBytes}`);
    assert.ok(((L.maxModuleBytes + L.maxAssetBytes + L.maxMigrationBytes + L.maxSourceBytes) * 4) / 3 < L.maxBodyBytes);
    assert.deepEqual({ ...collect.ARTIFACT_LIMITS }, { ...L });
  });

  // ── 결함 5 ──
  it("[결함 5] 정지는 push보다 먼저 — 정지된 slug면 GitHub 호출 0 · 정지 목록 조회 오류는 한 번 다시 읽고 그래도 안 되면 fail-closed(suspension_check_failed) · 한 번 오류 뒤 성공이면 진행", async () => {
    const kv = (get) => ({ get });
    const db = makeDb();
    const env = envFor(db, { HOSTING_SUSPENDED: kv(async (k) => (k === `suspended:${SLUG}` ? JSON.stringify({ reason: "phishing" }) : null)) });
    const w = makeWorld();
    const r = await postArtifactTo(routesApp(w), env, await mint(env, JOB), artifactBody());
    assert.deepEqual([r.body.status, r.body.error], ["failed", "slug_suspended"]);
    assert.equal(w.calls.filter((c) => c.host === "api.github.com").length, 0, "no source is committed for a suspended slug");
    assert.equal(w.scripts.length, 0);
    // 조회가 계속 실패 → fail-closed
    let reads = 0;
    const db2 = makeDb();
    const env2 = envFor(db2, { HOSTING_SUSPENDED: kv(async () => { reads += 1; throw new Error("kv unavailable (FAKE)"); }) });
    const w2 = makeWorld();
    const r2 = await postArtifactTo(routesApp(w2), env2, await mint(env2, JOB), artifactBody());
    assert.deepEqual([r2.body.status, r2.body.error], ["failed", "suspension_check_failed"]);
    assert.equal(reads, 2, "read twice before failing closed");
    assert.deepEqual([w2.calls.length, w2.scripts.length], [0, 0]);
    // 한 번 실패 뒤 성공 → 진행(done)
    let n = 0;
    const env3 = envFor(makeDb(), { HOSTING_SUSPENDED: kv(async () => { n += 1; if (n === 1) throw new Error("blip (FAKE)"); return null; }) });
    const r3 = await postArtifactTo(routesApp(makeWorld()), env3, await mint(env3, JOB), artifactBody());
    assert.equal(r3.body.status, "done", JSON.stringify(r3.body));
  });

  it("[결함 5] 빌드 시작(POST /build)에서도 LLM·프로비저닝 전에 정지 목록을 본다 — 정지면 403 slug_suspended · 조회 실패면 503 · 상한 슬롯·D1·저장소·잡 0", async () => {
    const realFetch = globalThis.fetch;
    try {
      for (const [isSuspended, status, error] of [
        [async () => true, 403, "slug_suspended"],
        [async () => { throw new Error("kv down (FAKE)"); }, 503, "suspension_check_failed"],
      ]) {
        const db = makeDb({ jobs: [] });
        const env = envFor(db, { BUILDER: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response("{}", { status: 202 }) }) }, ANTHROPIC_API_KEY: "anthropic-key-FAKE-s3" });
        const world = makeWorld();
        // 프로비저닝 함수의 기본 fetch(전역)도 가짜로 — 옛 코드가 실제 Cloudflare에 닿지 않게.
        globalThis.fetch = world.fetchImpl;
        const app = routesMod.createWorkspaceBuildJobRoutes(world.fetchImpl, { isSuspended });
        const res = await app.fetch(new Request(`${ORIGIN}/workspace/projects/${encodeURIComponent(PROJECT)}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userKey: USER, locale: "ko" }) }), env);
        assert.deepEqual([res.status, (await res.json()).error], [status, error]);
        assert.equal([...db.rate.values()].reduce((s, v) => s + v, 0), 0, "no daily slot consumed");
        assert.equal(world.calls.length, 0, "no namespace / D1 / repository provisioning");
        assert.equal(db.jobs.length, 0);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // ── 결함 6 ──
  it("[결함 6] markBuildJobDone: 산출물을 받지 않은 행(build_exit_code NULL)은 done으로 못 간다 — **DB 조건**(실제 SQLite 0068) · 받은 뒤에는 done", { skip: noSqlite }, async () => {
    const sqlite = freshSqlite();
    const env = { DB: sqliteD1(sqlite) };
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: SLUG, wbsTotal: 1 });
    assert.equal(await buildDb.advanceBuildJob(env, job.id, { status: "testing" }), true);
    const input = { deployedUrl: APP_URL, commitSha: null, spentUsd: 0, buildExitCode: 0, wbsDone: 1 };
    assert.deepEqual(await buildDb.markBuildJobDone(env, job.id, input), { ok: false, reason: "build_not_green" }, "claim was skipped — the row says no artifact was received");
    const mid = await buildDb.getBuildJobById(env, job.id);
    assert.deepEqual([mid.status, mid.deployedUrl, mid.buildExitCode], ["testing", null, null]);
    assert.equal(await buildDb.claimBuildArtifact(env, job.id), true);
    assert.deepEqual(await buildDb.markBuildJobDone(env, job.id, input), { ok: true });
    assert.equal((await buildDb.getBuildJobById(env, job.id)).status, "done");
  });

  it("[결함 1·2·7] 새 문장들이 실제 스키마(0068)에서 돈다 — 활성 잡 멈춤 · 삭제 배치(타임라인 삭제 · user_key 끊기) · 정리 대상 · 공유 확인 · 행 삭제 · 삭제된 잡엔 이벤트 없음 · Worker 소유 스턱 목록 · 프로젝트 존재", { skip: noSqlite }, async () => {
    const sqlite = freshSqlite();
    const env = { DB: sqliteD1(sqlite) };
    sqlite.prepare("INSERT INTO workspace_projects (id) VALUES (?), (?)").run(PROJECT, "wsp_other");
    const a = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: SLUG, wbsTotal: 1, d1Id: D1, repoFullName: `${ORG}/${SLUG}` });
    const b = await buildDb.insertQueuedBuildJob(env, { projectId: "wsp_other", userKey: "uk_다른 사장님", slug: "other-app-1", wbsTotal: 1, d1Id: "other-d1-0001" });
    await buildDb.appendBuildJobEvent(env, a.id, "queued", "repo_ready");
    await buildDb.appendBuildJobEvent(env, b.id, "queued", "repo_ready");
    assert.equal(await need(buildDb, "stopActiveBuildJobsForProject", "build-job-db.ts")(env, PROJECT, "project_deleted"), 1);
    assert.deepEqual([(await buildDb.getBuildJobById(env, a.id)).status, (await buildDb.getBuildJobById(env, b.id)).status], ["failed", "queued"]);
    await env.DB.batch([...need(buildDb, "buildJobDeleteBatchStatements", "build-job-db.ts")(env, PROJECT, "2026-10-01T01:00:00Z"), env.DB.prepare("DELETE FROM workspace_projects WHERE id = ?").bind(PROJECT)]);
    assert.equal(sqlite.prepare("SELECT user_key FROM build_jobs WHERE id = ?").get(a.id).user_key, "");
    const events = (id) => sqlite.prepare("SELECT COUNT(*) AS n FROM build_job_events WHERE job_id = ?").get(id).n;
    assert.deepEqual([events(a.id), events(b.id)], [0, 1]);
    assert.deepEqual(await buildDb.listDeletedProjectsWithBuildJobs(env, 5), [PROJECT]);
    assert.deepEqual(await buildDb.listBuildJobHostingForProject(env, PROJECT), [{ id: a.id, slug: SLUG, d1Id: D1, repoFullName: `${ORG}/${SLUG}` }]);
    assert.equal(await buildDb.hostingResourceSharedWithOtherProject(env, PROJECT, { slug: SLUG }), false);
    assert.equal(await buildDb.hostingResourceSharedWithOtherProject(env, "wsp_x", { d1Id: D1 }), true);
    await buildDb.deleteBuildJobsForProject(env, PROJECT);
    assert.equal(await buildDb.getBuildJobById(env, a.id), null);
    assert.deepEqual(await buildDb.listDeletedProjectsWithBuildJobs(env, 5), []);
    assert.equal(await buildDb.appendBuildJobEvent(env, a.id, "deploying", "d1_migrated"), false, "no trace for a deleted job");
    assert.equal(events(a.id), 0);
    sqlite.prepare("UPDATE build_jobs SET status = 'deploying', build_exit_code = 0, updated_at = ? WHERE id = ?").run("2026-10-01T00:00:00Z", b.id);
    assert.deepEqual((await buildDb.listStuckWorkerOwnedBuildJobs(env, "2026-10-01T00:10:00Z")).map((r) => ({ ...r })), [{ id: b.id, status: "deploying" }]);
    assert.deepEqual(await buildDb.listStuckWorkerOwnedBuildJobs(env, "2026-09-30T23:59:00Z"), []);
    assert.equal(await dbMod.projectExists(env, "wsp_other"), true);
    assert.equal(await dbMod.projectExists(env, PROJECT), false);
  });
});

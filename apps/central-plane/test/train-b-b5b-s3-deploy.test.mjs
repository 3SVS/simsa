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

/** 가짜 D1 — 이 테스트가 지나는 문장만(문구로 가른다). */
function makeDb({ jobs = [jobRow()], checks = [] } = {}) {
  const db = {
    jobs, events: [], checks, rate: new Map(), sqls: [], batches: [],
    prepare(sql) {
      const handler = (args) => ({
        async run() {
          db.sqls.push(sql);
          const capped = dailyCapsRun(db.rate, sql, args);
          if (capped) return capped;
          if (sql.includes("INSERT INTO build_job_events")) {
            const [id, job_id, at, stage, message, meta_json] = args;
            if (sql.includes("SELECT COUNT(*)") && db.events.filter((e) => e.job_id === job_id).length >= Number(args[args.length - 1])) return { meta: { changes: 0 } };
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
            const row = jobs.find((r) => r.id === id && ACTIVE(r));
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
          if (sql.includes("FROM workspace_projects WHERE id = ?")) return args[0] === PROJECT ? projectRow() : null;
          if (sql.includes("FROM build_jobs WHERE id = ?")) return jobs.find((r) => r.id === args[0]) ?? null;
          if (sql.includes("FROM workspace_visual_checks") && sql.includes("status IN ('queued', 'running')")) return db.checks.find((r) => r.project_id === args[0] && ["queued", "running"].includes(r.status)) ?? null;
          return null;
        },
        async all() {
          db.sqls.push(sql);
          if (sql.includes("FROM build_job_events")) return { results: db.events.filter((e) => e.job_id === args[0]).map((e) => ({ ...e, meta_json: JSON.stringify(e.meta) })) };
          if (sql.includes("SELECT id FROM build_jobs WHERE project_id = ?")) return { results: jobs.filter((r) => r.project_id === args[0]).map((r) => ({ id: r.id })) };
          return { results: [] };
        },
      });
      return { bind: (...a) => handler(a), run: () => handler([]).run(), first: () => handler([]).first(), all: () => handler([]).all() };
    },
    async batch(stmts) {
      db.batches.push(stmts.length);
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db;
}

/** 가짜 R2 — put·get·list·delete. */
function makeR2({ failPut = false } = {}) {
  const objects = new Map();
  return {
    objects,
    deleted: [],
    async put(key, value, opts) {
      if (failPut) throw new Error("r2 unavailable (FAKE)");
      objects.set(key, { value: String(value), opts });
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
  const d1 = { queries: [], applied: [...(opts.alreadyApplied ?? [])] };
  const assets = { manifests: [], uploads: [] };
  const scripts = [];
  const gh = { tokenRequests: [], blobs: [], trees: [], commits: [], refs: [], revoked: [] };
  const hosted = { gets: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const cfOk = (result) => json(200, { success: true, errors: [], result });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers ?? {}).get("authorization") ?? "";
    calls.push({ method, host: u.host, path: u.pathname, auth });
    if (u.host === "api.cloudflare.com") {
      const p = u.pathname.replace("/client/v4/accounts/acc1", "");
      if (p === `/d1/database/${D1}/query`) {
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
        return cfOk({ id: SLUG });
      }
      return json(404, { success: false, errors: [{ code: 7003, message: `unrouted ${method} ${p}` }] });
    }
    if (u.host === "api.github.com") {
      const p = u.pathname;
      if (p === `/orgs/${ORG}/installation`) return json(200, { id: 777 });
      if (p === "/app/installations/777/access_tokens" && method === "POST") {
        const body = JSON.parse(init.body);
        gh.tokenRequests.push({ body, auth });
        return json(201, { token: SCOPED, expires_at: "2030-01-01T00:00:00Z", permissions: opts.scopedPerms ?? { contents: "write", metadata: "read" }, repository_selection: "selected", repositories: [{ name: SLUG }] });
      }
      if (p === "/installation/token" && method === "DELETE") { gh.revoked.push(auth); return new Response(null, { status: 204 }); }
      const base = `/repos/${ORG}/${SLUG}`;
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
  return { fetchImpl, calls, d1, assets, scripts, gh, hosted };
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
    body: typeof body === "string" ? body : JSON.stringify(body),
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
    const db = makeDb({ jobs: [jobRow({ id: "bj_s3del00001" }), jobRow({ id: "bj_s3other999", project_id: "wsp_other" })] });
    const env = envFor(db);
    await env.EVIDENCE.put("builds/bj_s3del00001/artifact.json", "{}");
    await env.EVIDENCE.put("builds/bj_s3other999/artifact.json", "{}");
    await env.EVIDENCE.put(`checks/${USER}/${PROJECT}/vc_1/shot.png`, "x");
    await dbMod.deleteProject(env, PROJECT, USER);
    assert.deepEqual([...env.EVIDENCE.objects.keys()], ["builds/bj_s3other999/artifact.json"]);
    assert.ok(env.EVIDENCE.deleted.includes("builds/bj_s3del00001/artifact.json"));
  });
});

/**
 * train-w-service-gates.test.mjs — Train W · W-2 (재정렬 D-7 amend [PILOT]).
 *
 * Contract (서버↔대시보드, #558과 같은 계약):
 *   1. 일일 상한 — userKey당 검수 10/일 · 수리 5/일 (UTC 일, workspace_rate_limit 재사용).
 *      초과 → 429 { ok:false, error:"daily_limit_reached", kind, limit, resetAt }.
 *      verify-sweep(시스템 재검수)은 유저 상한에 세지 않고, 스윕당 최대 10건.
 *   2. 킬스위치 INSPECTION_ENABLED · REPAIR_ENABLED — 정확히 "off"만 꺼짐(미설정 = 켜짐).
 *      판정은 dispatchInspection · dispatchRepairJob 내부의 단일 헬퍼. 꺼져 있으면 라우트는
 *      행을 만들기 전에 503, verify-sweep은 행 없이 summary.skipped_disabled.
 *
 * Pins (과제 테스트 최소 ①~⑦):
 *   ① 11번째 검수 → 429 + kind/limit/resetAt   ② 6번째 수리 → 429
 *   ③ INSPECTION_ENABLED=off → 라우트 503 + 행 0 (REPAIR도 동일)
 *   ④ off에서 verify-sweep → dispatched 0 · 행 0 · skipped_disabled ≥ 1
 *   ⑤ 미설정 / "on" / "OFF" / "" 판정 — 정확히 "off"만 꺼짐 (디스패치 함수 내부 게이트)
 *   ⑥ verify-sweep 스윕당 상한 + 유저 상한과 무관
 *   ⑦ 다른 userKey는 서로의 상한에 영향 없음 (교차 테넌트 포함)
 * 설계 가드(차감 위치): 409·소유권 실패·디스패치 실패는 차감하지 않는다.
 *
 * PR #561 검증 후속 (2026-09-29):
 *   ⑩ 비용 천장 — userKey는 익명·클라이언트 생성이라 userKey 상한만으로는 비용 상한이 아니다.
 *      같은 차감 지점에 네트워크(cf-connecting-ip 해시) 버킷과 서비스 전체 버킷을 더한다.
 *      네트워크 초과 → 429(scope network), 서비스 전체 초과 → 503(error=…_disabled,
 *      reason=daily_capacity — "잠시 멈췄어요", 유저가 다 쓴 게 아니므로 429 문구를 쓰지 않는다).
 *   ⑪ 원자성 — 상한 차감은 문장 하나(UPSERT … WHERE count < ?, 바뀐 행 0 = 가득 참), 진행 중 1개
 *      가드는 삽입 뒤 rowid 순 확인(먼저 들어간 행이 이긴다). 지연 있는 가짜 D1 + 동시 요청으로 고정.
 *   ⑫ 환급 경로 — 행 저장 실패(500)·컨테이너 거절(non-2xx)도 모든 버킷을 돌려준다.
 *
 * Mocks at the seam: 가짜 D1(한 파일에 모든 테이블), 가짜 DO 네임스페이스. 네트워크 없음.
 * 모크 id·행 모양은 프로덕션과 같게: 프로젝트 wsp_, 이벤트 wue_, 0065/0069 컬럼은 null 명시.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { createApp } = await import("../dist/router.js");
const { runVerifySweep, REPAIR_MERGED_EVENT } = await import("../dist/workspace/verify-sweep.js");
const { dispatchInspection } = await import("../dist/routes/workspace-visual-check-runs.js");
const { dispatchRepairJob } = await import("../dist/routes/workspace-repair-jobs.js");
const { encryptToken } = await import("../dist/crypto.js");
const { dailyCapsRun } = await import("./_daily-caps-fake.mjs");

/** The switch module is new in Train W — load lazily so each test fails on its own on old code. */
async function loadSwitches() {
  const mod = await import("../dist/workspace/service-switches.js").catch(() => null);
  assert.ok(mod, "dist/workspace/service-switches.js must exist (Train W single switch helper)");
  return mod;
}

const USER = "uk_owner";
const USER_B = "uk_other_owner";
const PROJECT = "wsp_w";
const PROJECT_B = "wsp_w_b";
const TOKEN = "tok_internal_fake";
const KEK = randomBytes(32).toString("base64");
const GH_TOKEN_ENC = await encryptToken("gho_fakeOauthTokenForTests", KEK);

// ─── Fake D1 (all tables the gated paths touch) ───────────────────────────────
//
// Options (seam knobs, all off by default):
//   delayMs     — every statement awaits this long before it runs (a real D1 round
//                 trip). Each statement is still applied atomically, as SQLite does:
//                 two statements never interleave, but two REQUESTS do.
//   failInserts — table names whose INSERT throws (row-save failure path).
// The rate-limit table accepts BOTH shapes: the old read-then-upsert pair and
// the single-statement conditional upsert (… WHERE count < ?; meta.changes 0 = full).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDb(state, { delayMs = 0, failInserts = [] } = {}) {
  const s = {
    projects: new Map(),
    sources: [],
    checks: [],
    jobs: [],
    repos: [],
    connections: [],
    events: [],
    rate: new Map(), // `${hash}::${bucketKey}` → count
    ...state,
  };
  const pause = () => (delayMs > 0 ? sleep(delayMs) : Promise.resolve());
  const failIf = (table) => {
    if (failInserts.includes(table)) throw new Error(`fake d1: insert into ${table} failed`);
  };
  return {
    state: s,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            await pause();
            // Single-statement conditional upsert + refund (rate-limit.ts consumeDailyCaps):
            // applied atomically; changes 0 when the bucket is already at the limit.
            const capped = dailyCapsRun(s.rate, sql, args);
            if (capped) return capped;
            // workspace_rate_limit (rate-limit.ts, older soft caps): insert-or-increment + refund.
            if (sql.includes("INSERT INTO workspace_rate_limit")) {
              const [hash, key] = args;
              const k = `${hash}::${key}`;
              s.rate.set(k, (s.rate.get(k) ?? 0) + 1);
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE workspace_rate_limit")) {
              const hash = args[args.length - 2];
              const key = args[args.length - 1];
              const k = `${hash}::${key}`;
              const cur = s.rate.get(k) ?? 0;
              if (cur > 0) s.rate.set(k, cur - 1);
              return { meta: { changes: cur > 0 ? 1 : 0 } };
            }
            if (sql.includes("INSERT INTO workspace_visual_checks") && sql.includes("'queued', 'container'")) {
              failIf("workspace_visual_checks");
              const [id, project_id, user_key, target_url, intent, locale, region, envelope_json, source_check_id, created_at, updated_at] = args;
              s.checks.push({
                id, project_id, user_key, target_url, intent,
                decision: "Not Judged", works: null, status: "queued", executor: "container",
                report_json: "{}", agent_prompt: null, evidence_keys_json: "[]",
                locale, region, envelope_json, finding_codes_json: null,
                user_verdict: null, user_verdict_at: null, source_check_id, created_at, updated_at,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("workspace_visual_checks") && sql.includes("SET status = 'failed'")) {
              const [, updated_at, id] = args;
              const row = s.checks.find((r) => r.id === id);
              if (row) { row.status = "failed"; row.updated_at = updated_at; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("DELETE FROM workspace_visual_checks")) {
              const i = s.checks.findIndex((r) => r.id === args[0] && r.status === "queued");
              if (i >= 0) s.checks.splice(i, 1);
              return { meta: { changes: i >= 0 ? 1 : 0 } };
            }
            if (sql.includes("INSERT INTO workspace_repair_jobs")) {
              failIf("workspace_repair_jobs");
              const [id, project_id, user_key, visual_check_id, repo_full_name, branch_name, env_cause, region, created_at, updated_at] = args;
              s.jobs.push({
                id, project_id, user_key, visual_check_id, repo_full_name,
                status: "queued", branch_name, pr_url: null, pr_number: null,
                env_cause, mode: null, changed_files: null, error: null, region,
                verify_check_id: null, resolved: null, created_at, updated_at,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'failed'")) {
              const [error, updated_at, id] = args;
              const row = s.jobs.find((r) => r.id === id);
              if (row) { row.status = "failed"; row.error = error; row.updated_at = updated_at; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("DELETE FROM workspace_repair_jobs")) {
              const i = s.jobs.findIndex((r) => r.id === args[0] && r.status === "queued");
              if (i >= 0) s.jobs.splice(i, 1);
              return { meta: { changes: i >= 0 ? 1 : 0 } };
            }
            if (sql.includes("workspace_repair_jobs") && sql.includes("SET verify_check_id")) {
              const [verifyId, id] = args;
              const row = s.jobs.find((r) => r.id === id);
              if (row) row.verify_check_id = verifyId;
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("INSERT INTO workspace_usage_events")) {
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            await pause();
            if (sql.includes("FROM workspace_rate_limit")) {
              const [hash, key] = args;
              const count = s.rate.get(`${hash}::${key}`);
              return count === undefined ? null : { count };
            }
            if (sql.includes("FROM workspace_projects WHERE id = ?")) return s.projects.get(args[0]) ?? null;
            if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) {
              return s.sources.find((x) => x.id === args[0]) ?? null;
            }
            // Insertion order (rowid): the array order.
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("ORDER BY rowid")) {
              const row = s.checks.find((r) => r.project_id === args[0] && (r.status === "queued" || r.status === "running"));
              return row ? { id: row.id } : null;
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("status IN ('queued', 'running')")) {
              return s.checks.find((r) => r.project_id === args[0] && (r.status === "queued" || r.status === "running")) ?? null;
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE id = ?")) {
              return s.checks.find((r) => r.id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_project_repos WHERE project_id = ?")) {
              return s.repos.find((r) => r.project_id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_github_connections WHERE user_key = ?")) {
              return s.connections.find((r) => r.user_key === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE id = ?")) {
              return s.jobs.find((r) => r.id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("ORDER BY rowid")) {
              const row = s.jobs.find((r) => r.visual_check_id === args[0] && (r.status === "queued" || r.status === "running"));
              return row ? { id: row.id } : null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("status IN ('queued', 'running')")) {
              return s.jobs.find((r) => r.visual_check_id === args[0] && (r.status === "queued" || r.status === "running")) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE visual_check_id = ?")) {
              const list = s.jobs
                .filter((r) => r.visual_check_id === args[0])
                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
              return list[0] ?? null;
            }
            return null;
          },
          async all() {
            await pause();
            if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id = ?")) {
              return { results: s.sources.filter((x) => x.project_id === args[0]) };
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE project_id = ?")) {
              return { results: s.checks.filter((r) => r.project_id === args[0]) };
            }
            if (sql.includes("FROM workspace_usage_events")) {
              return { results: s.events.filter((e) => e.event_type === args[0] && e.created_at > args[1]) };
            }
            return { results: [] };
          },
        };
      }
      return {
        bind(...args) { return handler(args); },
        run() { return handler([]).run(); },
        first() { return handler([]).first(); },
        all() { return handler([]).all(); },
      };
    },
  };
}

/** Sum of every rate bucket (user + network + service) — "nothing is held". */
function totalCharged(db) {
  let n = 0;
  for (const v of db.state.rate.values()) n += v;
  return n;
}

/** Every column getProject() selects — D1 returns NULL (not undefined) for an unset one. */
function projectRow(id, userKey) {
  return {
    id, user_key: userKey, title: "t", idea: "i",
    understood_json: "{}", product_spec_json: "{}", items_json: "[]",
    built_with_json: null, entry_path: null, topic_tags_json: null, acquisition_json: null,
    dev_spec_json: null, region_at_create: null,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function website(projectId, userKey, id = `psrc_${projectId}`) {
  return {
    id, project_id: projectId, user_key: userKey, type: "website",
    reference: `https://${projectId}.example.app/`, label: null, content_type: null,
    size_bytes: null, created_at: "2026-09-01T00:00:00.000Z",
  };
}

function failedCheck(id, projectId = PROJECT, userKey = USER) {
  return {
    id, project_id: projectId, user_key: userKey,
    target_url: `https://${projectId}.example.app/`, intent: "신청서를 끝까지 낼 수 있어야 한다",
    decision: "Needs Fix", works: 0, status: "done", executor: "container",
    report_json: JSON.stringify({ verdict: "작동 안 해요" }),
    agent_prompt: "당신은 이 프로젝트의 코드를 수정하는 개발 에이전트입니다.\n[고칠 문제] 제출 버튼이 반응하지 않음",
    evidence_keys_json: "[]", locale: "ko",
    // 0069 columns (visual-check-db SELECT_COLS) — NULL on a row that never had them.
    region: null, envelope_json: null, finding_codes_json: null,
    user_verdict: null, user_verdict_at: null, source_check_id: null,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function repoRow(projectId = PROJECT, userKey = USER) {
  return {
    id: `wpr_${projectId}`, project_id: projectId, user_key: userKey, github_connection_id: "wgc_1",
    repo_id: "1", repo_full_name: "acme/apply-form", repo_owner: "acme", repo_name: "apply-form",
    default_branch: "main", private: 0, html_url: "https://github.com/acme/apply-form",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function connectionRow(userKey = USER) {
  return {
    id: `wgc_${userKey}`, user_key: userKey, github_user_id: "77", github_login: "acme-user",
    github_name: null, avatar_url: null, access_token_enc: GH_TOKEN_ENC, scopes: "read:user public_repo",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
}

/** Accepting DO namespace stub; `calls` records every container dispatch. */
function acceptingNs(calls) {
  return {
    idFromName: (name) => ({ name }),
    get: () => ({
      async fetch(url, init) {
        calls.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
      },
    }),
  };
}

function makeEnv({ db, inspector, sandbox, vars = {} } = {}) {
  const env = {
    ENVIRONMENT: "test",
    DB: db,
    INTERNAL_CALLBACK_TOKEN: TOKEN,
    CONCLAVE_TOKEN_KEK: KEK,
    ...vars,
  };
  if (inspector) env.INSPECTOR = inspector;
  if (sandbox) env.SANDBOX = sandbox;
  return env;
}

function defaultDb(extra = {}) {
  return makeDb({
    projects: new Map([
      [PROJECT, projectRow(PROJECT, USER)],
      [PROJECT_B, projectRow(PROJECT_B, USER_B)],
    ]),
    sources: [website(PROJECT, USER), website(PROJECT_B, USER_B)],
    ...extra,
  });
}

async function req(env, method, path, body, headers = {}) {
  const app = createApp();
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.fetch(new Request(`http://localhost${path}`, init), env);
  let json = null;
  try { json = await res.clone().json(); } catch { /* non-json */ }
  return { status: res.status, json, headers: res.headers };
}

const runPath = (projectId) => `/workspace/projects/${projectId}/visual-checks/run`;
const repairPath = (projectId, runId) => `/workspace/projects/${projectId}/visual-checks/${runId}/repair`;

/** Simulate the container finishing every in-flight run (frees the one-active-run guard). */
function finishAllChecks(db) {
  for (const r of db.state.checks) if (r.status === "queued" || r.status === "running") r.status = "done";
}
function finishAllJobs(db) {
  for (const j of db.state.jobs) if (j.status === "queued" || j.status === "running") j.status = "done";
}

function nextUtcMidnightIso(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * The server computes resetAt at request time; the test cannot share its clock.
 * Accept the next midnight as seen just BEFORE or just AFTER the request, so a
 * run that straddles UTC midnight is not a false failure (PR #561 review P2).
 */
async function expectResetAtAround(send) {
  const before = nextUtcMidnightIso();
  const res = await send();
  const after = nextUtcMidnightIso();
  assert.ok(
    res.json?.resetAt === before || res.json?.resetAt === after,
    `resetAt ${res.json?.resetAt} must be the next UTC midnight (${before} or ${after})`,
  );
  return res;
}

// ─── ① inspection daily cap ───────────────────────────────────────────────────

test("① 11번째 검수 → 429 daily_limit_reached · kind=inspection · limit=10 · resetAt=다음 UTC 자정 · 행 없음", async () => {
  const calls = [];
  const db = defaultDb();
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  for (let i = 1; i <= 10; i++) {
    const r = await req(env, "POST", runPath(PROJECT), { userKey: USER });
    assert.equal(r.status, 202, `run #${i} should be accepted`);
    assert.equal(r.json.dispatched, true);
    finishAllChecks(db);
  }
  const rowsBefore = db.state.checks.length;
  const r11 = await expectResetAtAround(() => req(env, "POST", runPath(PROJECT), { userKey: USER }));
  assert.equal(r11.status, 429);
  assert.deepEqual(
    { ok: r11.json.ok, error: r11.json.error, kind: r11.json.kind, limit: r11.json.limit },
    { ok: false, error: "daily_limit_reached", kind: "inspection", limit: 10 },
  );
  assert.equal(typeof r11.json.resetAt, "string");
  assert.ok(!Number.isNaN(Date.parse(r11.json.resetAt)), "resetAt must be ISO");
  const retryAfter = Number(r11.headers.get("retry-after"));
  assert.ok(retryAfter >= 60 && retryAfter <= 86400, "Retry-After header in seconds");
  assert.equal(db.state.checks.length, rowsBefore, "the capped request creates no row");
  assert.equal(calls.length, 10, "the container is never called for the capped request");
});

// ─── ② repair daily cap ───────────────────────────────────────────────────────

test("② 6번째 수리 → 429 daily_limit_reached · kind=repair · limit=5 · 잡 행 없음", async () => {
  const calls = [];
  const runs = ["wvc_r1", "wvc_r2", "wvc_r3", "wvc_r4", "wvc_r5", "wvc_r6"].map((id) => failedCheck(id));
  const db = defaultDb({ checks: runs, repos: [repoRow()], connections: [connectionRow()] });
  const env = makeEnv({ db, sandbox: acceptingNs(calls) });
  for (let i = 0; i < 5; i++) {
    const r = await req(env, "POST", repairPath(PROJECT, runs[i].id), { userKey: USER });
    assert.equal(r.status, 202, `repair #${i + 1} should be accepted`);
    assert.equal(r.json.dispatched, true);
    finishAllJobs(db);
  }
  const r6 = await expectResetAtAround(() => req(env, "POST", repairPath(PROJECT, runs[5].id), { userKey: USER }));
  assert.equal(r6.status, 429);
  assert.equal(r6.json.ok, false);
  assert.equal(r6.json.error, "daily_limit_reached");
  assert.equal(r6.json.kind, "repair");
  assert.equal(r6.json.limit, 5);
  assert.equal(db.state.jobs.length, 5, "the capped repair creates no job row");
  assert.equal(calls.length, 5);
});

test("[가드] 검수·수리 상한은 서로 다른 버킷 — 검수 10회를 써도 수리는 된다", async () => {
  const calls = [];
  const db = defaultDb({ checks: [failedCheck("wvc_fix")], repos: [repoRow()], connections: [connectionRow()] });
  const env = makeEnv({ db, inspector: acceptingNs(calls), sandbox: acceptingNs(calls) });
  for (let i = 0; i < 10; i++) {
    const r = await req(env, "POST", runPath(PROJECT), { userKey: USER });
    assert.equal(r.status, 202);
    finishAllChecks(db);
  }
  const repair = await req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER });
  assert.equal(repair.status, 202);
});

// ─── ③ kill switch → route 503 before any row ─────────────────────────────────

test("③ INSPECTION_ENABLED=off → 503 inspection_disabled · 행 0 · 컨테이너 0 · 상한 차감 0", async () => {
  const calls = [];
  const db = defaultDb();
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { INSPECTION_ENABLED: "off" } });
  const r = await req(env, "POST", runPath(PROJECT), { userKey: USER });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { ok: false, error: "inspection_disabled" });
  assert.equal(db.state.checks.length, 0, "no visual-check row");
  assert.equal(calls.length, 0, "no container dispatch");
  assert.equal(db.state.rate.size, 0, "a disabled service charges nothing");
});

test("③ REPAIR_ENABLED=off → 503 repair_disabled · 잡 행 0 · 컨테이너 0 · 상한 차감 0", async () => {
  const calls = [];
  const db = defaultDb({ checks: [failedCheck("wvc_fix")], repos: [repoRow()], connections: [connectionRow()] });
  const env = makeEnv({ db, sandbox: acceptingNs(calls), vars: { REPAIR_ENABLED: "off" } });
  const r = await req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { ok: false, error: "repair_disabled" });
  assert.equal(db.state.jobs.length, 0, "no repair-job row");
  assert.equal(calls.length, 0, "no container dispatch");
  assert.equal(db.state.rate.size, 0);
});

test("[가드] 킬스위치가 꺼져도 소유권 검사가 먼저다 — 남의 프로젝트는 403 (503으로 존재를 흐리지 않음)", async () => {
  const db = defaultDb();
  const env = makeEnv({ db, inspector: acceptingNs([]), vars: { INSPECTION_ENABLED: "off" } });
  const r = await req(env, "POST", runPath(PROJECT), { userKey: USER_B });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "forbidden");
});

test("[가드] ③ 한 스위치는 다른 문을 막지 않는다 — REPAIR off여도 검수는 202, INSPECTION off여도 수리는 202", async () => {
  const calls = [];
  const db1 = defaultDb();
  const env1 = makeEnv({ db: db1, inspector: acceptingNs(calls), vars: { REPAIR_ENABLED: "off" } });
  assert.equal((await req(env1, "POST", runPath(PROJECT), { userKey: USER })).status, 202);

  const db2 = defaultDb({ checks: [failedCheck("wvc_fix")], repos: [repoRow()], connections: [connectionRow()] });
  const env2 = makeEnv({ db: db2, sandbox: acceptingNs(calls), vars: { INSPECTION_ENABLED: "off" } });
  assert.equal((await req(env2, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER })).status, 202);
});

// ─── ④ verify-sweep honors the same switch ────────────────────────────────────

const NOW = Date.parse("2026-09-28T12:00:00Z");
const agoIso = (ms) => new Date(NOW - ms).toISOString();

function mergedEvent(runId, projectId, userKey, i = 0) {
  return {
    id: `wue_${runId}`, user_key: userKey, project_id: projectId,
    event_type: REPAIR_MERGED_EVENT,
    metadata_json: JSON.stringify({ runId }),
    created_at: agoIso(10 * 60_000 + i), // past the 5-minute deploy grace
  };
}

function originRun(id, projectId, userKey) {
  return { ...failedCheck(id, projectId, userKey), created_at: agoIso(3_600_000), updated_at: agoIso(3_600_000) };
}

test("④ INSPECTION_ENABLED=off에서 verify-sweep → dispatched 0 · 새 행 0 · skipped_disabled ≥ 1", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: [originRun("wvc_orig", PROJECT, USER)],
    events: [mergedEvent("wvc_orig", PROJECT, USER)],
  });
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { INSPECTION_ENABLED: "off", PUBLIC_BASE_URL: "https://base" } });
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 0);
  assert.ok((s.skipped_disabled ?? 0) >= 1, `skipped_disabled must count the gated event: ${JSON.stringify(s)}`);
  assert.equal(db.state.checks.length, 1, "no re-inspection row is created while the switch is off");
  assert.equal(calls.length, 0);
});

test("④b 스위치를 다시 켜면 같은 신호가 다음 스윕에서 처리된다(끄는 동안 신호를 소비하지 않음)", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: [originRun("wvc_orig", PROJECT, USER)],
    events: [mergedEvent("wvc_orig", PROJECT, USER)],
  });
  const off = makeEnv({ db, inspector: acceptingNs(calls), vars: { INSPECTION_ENABLED: "off", PUBLIC_BASE_URL: "https://base" } });
  await runVerifySweep(off, { nowMs: NOW });
  const on = makeEnv({ db, inspector: acceptingNs(calls), vars: { PUBLIC_BASE_URL: "https://base" } });
  const s = await runVerifySweep(on, { nowMs: NOW });
  assert.equal(s.dispatched, 1);
  assert.equal(calls.length, 1);
});

// ─── ⑤ switch parsing — exactly "off" turns it off ────────────────────────────

test("⑤ 스위치 해석: 미설정 · \"on\" · \"OFF\" · \"\" · \" off\" → 켜짐, 정확히 \"off\"만 꺼짐", async () => {
  const { inspectionEnabled, repairEnabled } = await loadSwitches();
  const cases = [
    [undefined, true],
    ["on", true],
    ["OFF", true],
    ["", true],
    [" off", true],
    ["Off", true],
    ["off", false],
  ];
  for (const [raw, expected] of cases) {
    const env = raw === undefined ? {} : { INSPECTION_ENABLED: raw, REPAIR_ENABLED: raw };
    assert.equal(inspectionEnabled(env), expected, `INSPECTION_ENABLED=${JSON.stringify(raw)}`);
    assert.equal(repairEnabled(env), expected, `REPAIR_ENABLED=${JSON.stringify(raw)}`);
  }
});

test("⑤ 게이트는 디스패치 함수 안에 있다 — dispatchInspection에 \"off\"면 컨테이너를 부르지 않는다", async () => {
  const args = {
    runId: "wvc_direct", projectId: PROJECT, userKey: USER,
    targetUrl: "https://x.example.app/", intent: "i", locale: "ko", publicBaseUrl: "https://base",
  };
  for (const [raw, shouldCall] of [[undefined, true], ["on", true], ["OFF", true], ["", true], ["off", false]]) {
    const calls = [];
    const env = {
      INSPECTOR: acceptingNs(calls),
      INTERNAL_CALLBACK_TOKEN: TOKEN,
      ...(raw === undefined ? {} : { INSPECTION_ENABLED: raw }),
    };
    const d = await dispatchInspection(env, args);
    assert.equal(d.dispatched, shouldCall, `INSPECTION_ENABLED=${JSON.stringify(raw)}`);
    assert.equal(calls.length, shouldCall ? 1 : 0, `container calls for ${JSON.stringify(raw)}`);
    if (!shouldCall) assert.equal(d.note, "inspection_disabled");
  }
});

test("⑤ 게이트는 디스패치 함수 안에 있다 — dispatchRepairJob에 \"off\"면 컨테이너를 부르지 않는다", async () => {
  const args = {
    jobId: "wrj_direct", projectId: PROJECT, userKey: USER, visualCheckId: "wvc_x",
    repo: "acme/apply-form", githubToken: "gho_fake", branch: "fix/simsa-wvc_x",
    agentPrompt: "p", intent: "i", targetUrl: "https://x.example.app/", decision: "Needs Fix",
    envCause: false, locale: "ko", publicBaseUrl: "https://base",
  };
  for (const [raw, shouldCall] of [[undefined, true], ["on", true], ["OFF", true], ["", true], ["off", false]]) {
    const calls = [];
    const env = {
      SANDBOX: acceptingNs(calls),
      INTERNAL_CALLBACK_TOKEN: TOKEN,
      ...(raw === undefined ? {} : { REPAIR_ENABLED: raw }),
    };
    const d = await dispatchRepairJob(env, args);
    assert.equal(d.dispatched, shouldCall, `REPAIR_ENABLED=${JSON.stringify(raw)}`);
    assert.equal(calls.length, shouldCall ? 1 : 0);
    if (!shouldCall) assert.equal(d.note, "repair_disabled");
  }
});

// ─── ⑥ verify-sweep per-sweep cap, not the user's daily cap ───────────────────

test("⑥ verify-sweep 스윕당 최대 10건 — 신호 12개면 10개만 디스패치, 나머지는 다음 스윕", async () => {
  const calls = [];
  const projects = new Map();
  const checks = [];
  const events = [];
  for (let i = 0; i < 12; i++) {
    const pid = `wsp_sweep_${i}`;
    projects.set(pid, projectRow(pid, USER));
    checks.push(originRun(`wvc_o${i}`, pid, USER));
    events.push(mergedEvent(`wvc_o${i}`, pid, USER, i));
  }
  const db = makeDb({ projects, checks, events });
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { PUBLIC_BASE_URL: "https://base" } });
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 10);
  assert.equal(s.skipped_sweep_cap, 2, JSON.stringify(s));
  assert.equal(calls.length, 10);
  assert.equal(db.state.checks.length, 12 + 10, "only 10 re-inspection rows this sweep");
  assert.equal(db.state.rate.size, 0, "system re-inspections never touch the user's daily bucket");

  // Next sweep picks up the 2 that waited.
  const s2 = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s2.dispatched, 2);
});

test("⑥ 유저가 오늘 검수 10회를 다 써도 verify-sweep 재검수는 나간다(유저 상한에 세지 않음)", async () => {
  const calls = [];
  const PROJECT_B2 = "wsp_w_b2";
  const db = defaultDb({
    checks: [originRun("wvc_orig", PROJECT_B2, USER_B)],
    events: [mergedEvent("wvc_orig", PROJECT_B2, USER_B)],
  });
  db.state.projects.set(PROJECT_B2, projectRow(PROJECT_B2, USER_B));
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { PUBLIC_BASE_URL: "https://base" } });
  for (let i = 0; i < 10; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT_B), { userKey: USER_B })).status, 202);
    finishAllChecks(db);
  }
  assert.equal((await req(env, "POST", runPath(PROJECT_B), { userKey: USER_B })).status, 429, "user B is capped for today");
  const rateBefore = JSON.stringify([...db.state.rate.entries()]);
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 1, `sweep must still dispatch for a capped user: ${JSON.stringify(s)}`);
  assert.equal(JSON.stringify([...db.state.rate.entries()]), rateBefore, "the sweep does not touch the user's bucket");
});

// ─── ⑦ tenant isolation of the counters ───────────────────────────────────────

test("⑦ 다른 userKey는 서로의 상한에 영향 없음 — A가 10회를 다 써도 B는 202", async () => {
  const calls = [];
  const db = defaultDb();
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  for (let i = 0; i < 10; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 202);
    finishAllChecks(db);
  }
  assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 429);
  const b = await req(env, "POST", runPath(PROJECT_B), { userKey: USER_B });
  assert.equal(b.status, 202, "user B keeps a full budget");
  assert.equal(b.json.dispatched, true);
});

test("[가드] ⑦ 교차 테넌트: B가 A의 프로젝트로 요청하면 403이고 A·B 어느 버킷도 차감되지 않는다", async () => {
  const calls = [];
  const db = defaultDb({ checks: [failedCheck("wvc_fix")], repos: [repoRow()], connections: [connectionRow()] });
  const env = makeEnv({ db, inspector: acceptingNs(calls), sandbox: acceptingNs(calls) });
  for (let i = 0; i < 15; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER_B })).status, 403);
    assert.equal((await req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER_B })).status, 403);
  }
  assert.equal(db.state.rate.size, 0, "rejected ownership charges nobody");
  assert.equal(calls.length, 0);
  // A still has the whole day.
  for (let i = 0; i < 10; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 202);
    finishAllChecks(db);
  }
});

// ─── 차감 위치 (설계: 409 뒤 · 실제 디스패치될 때만) ─────────────────────────

test("차감 위치: 409(이미 진행 중)는 차감하지 않는다 — 409 15번 뒤에도 10회가 남아 있다", async () => {
  const calls = [];
  const db = defaultDb();
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 202); // 1 used, stays queued
  for (let i = 0; i < 15; i++) {
    const r = await req(env, "POST", runPath(PROJECT), { userKey: USER });
    assert.equal(r.status, 409);
  }
  finishAllChecks(db);
  for (let i = 2; i <= 10; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 202, `run #${i}`);
    finishAllChecks(db);
  }
  assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 429, "11th real dispatch is capped");
});

test("차감 환급: 디스패치 실패(컨테이너 없음)는 차감을 돌려준다 — 12번 실패 뒤에도 10회가 남아 있다", async () => {
  const db = defaultDb();
  const noInspector = makeEnv({ db });
  for (let i = 0; i < 12; i++) {
    const r = await req(noInspector, "POST", runPath(PROJECT), { userKey: USER });
    assert.equal(r.status, 202);
    assert.equal(r.json.dispatched, false);
  }
  const calls = [];
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  for (let i = 0; i < 10; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 202);
    finishAllChecks(db);
  }
  assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 429);
});

test("차감 환급: 수리 디스패치 실패(샌드박스 없음)도 차감을 돌려준다", async () => {
  const db = defaultDb({ checks: [failedCheck("wvc_fix")], repos: [repoRow()], connections: [connectionRow()] });
  const noSandbox = makeEnv({ db });
  for (let i = 0; i < 7; i++) {
    const r = await req(noSandbox, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER });
    assert.equal(r.status, 202);
    assert.equal(r.json.dispatched, false);
  }
  const calls = [];
  const env = makeEnv({ db, sandbox: acceptingNs(calls) });
  for (let i = 0; i < 5; i++) {
    assert.equal((await req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER })).status, 202);
    finishAllJobs(db);
  }
  assert.equal((await req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER })).status, 429);
});

test("[가드] fail-open: 상한 저장소(D1 rate-limit)가 깨져도 검수는 막히지 않는다", async () => {
  const calls = [];
  const db = defaultDb();
  const base = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql.includes("workspace_rate_limit")) {
      const boom = { async first() { throw new Error("d1 down"); }, async run() { throw new Error("d1 down"); } };
      return { bind: () => boom, ...boom };
    }
    return base(sql);
  };
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  for (let i = 0; i < 12; i++) {
    assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER })).status, 202);
    finishAllChecks(db);
  }
});

// ─── ⑩ 비용 천장: userKey는 익명이다 (PR #561 review P1) ─────────────────────────
//
// userKey는 클라이언트가 만든 UUID다(workspace.ts: "No auth"). 스크립트가 매번 새 userKey로
// 프로젝트→사이트→검수를 반복하면 userKey 상한은 비용 상한이 되지 못한다(eval-run·corpus-run이
// 이미 그 모양으로 프로덕션을 부른다). 같은 차감 지점에 네트워크 버킷과 서비스 전체 버킷을 더한다.

/** N fresh anonymous userKeys, each with its own project + website (a script's loop). */
function anonymousFleet(n, prefix) {
  const projects = new Map();
  const sources = [];
  const checks = [];
  const repos = [];
  const connections = [];
  const users = [];
  for (let i = 0; i < n; i++) {
    const userKey = `uk_${prefix}_${i}`;
    const projectId = `wsp_${prefix}_${i}`;
    const runId = `wvc_${prefix}_${i}`;
    projects.set(projectId, projectRow(projectId, userKey));
    sources.push(website(projectId, userKey));
    checks.push(failedCheck(runId, projectId, userKey));
    repos.push(repoRow(projectId, userKey));
    connections.push(connectionRow(userKey));
    users.push({ userKey, projectId, runId });
  }
  return { projects, sources, checks, repos, connections, users };
}

const ipHeader = (ip) => ({ "cf-connecting-ip": ip });

test("⑩ 기본값: 네트워크·서비스 전체 일일 상한이 있다 (검수 30/300 · 수리 15/50 [PILOT])", async () => {
  const limits = await import("../dist/workspace/beta-limits.js");
  for (const fn of ["inspectionDailyLimitPerIp", "inspectionDailyLimitGlobal", "repairDailyLimitPerIp", "repairDailyLimitGlobal"]) {
    assert.equal(typeof limits[fn], "function", `${fn} must exist`);
  }
  assert.equal(limits.inspectionDailyLimitPerIp({}), 30);
  assert.equal(limits.inspectionDailyLimitGlobal({}), 300);
  assert.equal(limits.repairDailyLimitPerIp({}), 15);
  assert.equal(limits.repairDailyLimitGlobal({}), 50);
  // [PILOT] numbers move without a code change; junk falls back to the default.
  assert.equal(limits.inspectionDailyLimitGlobal({ BETA_INSPECTION_DAILY_LIMIT_GLOBAL: "120" }), 120);
  assert.equal(limits.repairDailyLimitPerIp({ BETA_REPAIR_DAILY_LIMIT_PER_IP: "0" }), 15);
});

test("⑩ 같은 네트워크에서 userKey를 바꿔 가며 검수 → 네트워크 상한에서 429 scope=network · 행 0 · 컨테이너 0 · 다른 네트워크는 영향 없음", async () => {
  const calls = [];
  const fleet = anonymousFleet(4, "net");
  const db = makeDb(fleet);
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { BETA_INSPECTION_DAILY_LIMIT_PER_IP: "3" } });
  const ip = ipHeader("198.51.100.7");
  for (const u of fleet.users.slice(0, 3)) {
    const r = await req(env, "POST", runPath(u.projectId), { userKey: u.userKey }, ip);
    assert.equal(r.status, 202, `${u.userKey} (a fresh anonymous key) is accepted`);
  }
  const last = fleet.users[3];
  const rowsBefore = db.state.checks.length;
  const r4 = await req(env, "POST", runPath(last.projectId), { userKey: last.userKey }, ip);
  assert.equal(r4.status, 429, "a 4th fresh userKey from the same network is capped");
  assert.equal(r4.json.error, "daily_limit_reached");
  assert.equal(r4.json.kind, "inspection");
  assert.equal(r4.json.scope, "network");
  assert.equal(r4.json.limit, 3);
  assert.ok(!Number.isNaN(Date.parse(r4.json.resetAt)));
  assert.equal(db.state.checks.length, rowsBefore, "no row for the capped request");
  assert.equal(calls.length, 3, "no container for the capped request");

  const elsewhere = await req(env, "POST", runPath(last.projectId), { userKey: last.userKey }, ipHeader("203.0.113.9"));
  assert.equal(elsewhere.status, 202, "another network — and the same user's own quota — are untouched");
});

test("⑩ userKey·네트워크를 모두 바꿔도 서비스 전체 상한에서 멈춘다 → 503 inspection_disabled · reason=daily_capacity · 행 0", async () => {
  const calls = [];
  const fleet = anonymousFleet(6, "svc");
  const db = makeDb(fleet);
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { BETA_INSPECTION_DAILY_LIMIT_GLOBAL: "5" } });
  for (let i = 0; i < 5; i++) {
    const u = fleet.users[i];
    const r = await req(env, "POST", runPath(u.projectId), { userKey: u.userKey }, ipHeader(`198.51.100.${i + 1}`));
    assert.equal(r.status, 202);
  }
  const u = fleet.users[5];
  const rowsBefore = db.state.checks.length;
  const r6 = await req(env, "POST", runPath(u.projectId), { userKey: u.userKey }, ipHeader("198.51.100.99"));
  assert.equal(r6.status, 503, "the service-wide ceiling holds whatever key/network the caller rotates");
  // 503 + the "paused" code, not 429: this user did not use anything up — the
  // dashboard's "오늘 확인 횟수를 다 썼어요" would be false here.
  assert.equal(r6.json.ok, false);
  assert.equal(r6.json.error, "inspection_disabled");
  assert.equal(r6.json.reason, "daily_capacity");
  assert.ok(!Number.isNaN(Date.parse(r6.json.resetAt)), "resetAt tells when capacity returns");
  const retryAfter = Number(r6.headers.get("retry-after"));
  assert.ok(retryAfter >= 60 && retryAfter <= 86400);
  assert.equal(db.state.checks.length, rowsBefore);
  assert.equal(calls.length, 5);
});

test("⑩ 뒤 버킷에서 막히면 앞서 잡은 버킷을 돌려준다 — 서비스 상한에 막힌 유저의 개인·네트워크 몫은 줄지 않는다", async () => {
  const calls = [];
  const fleet = anonymousFleet(2, "refund");
  const db = makeDb(fleet);
  const tight = makeEnv({ db, inspector: acceptingNs(calls), vars: { BETA_INSPECTION_DAILY_LIMIT_GLOBAL: "1" } });
  const [a, b] = fleet.users;
  assert.equal((await req(tight, "POST", runPath(a.projectId), { userKey: a.userKey }, ipHeader("198.51.100.1"))).status, 202);
  const charged = totalCharged(db);
  assert.equal((await req(tight, "POST", runPath(b.projectId), { userKey: b.userKey }, ipHeader("198.51.100.2"))).status, 503);
  assert.equal(totalCharged(db), charged, "B's user + network slots taken before the service bucket said no were handed back");

  // Capacity comes back (e.g. the [PILOT] number is raised): B still has all 10.
  const roomy = makeEnv({ db, inspector: acceptingNs(calls) });
  for (let i = 0; i < 10; i++) {
    assert.equal((await req(roomy, "POST", runPath(b.projectId), { userKey: b.userKey }, ipHeader("198.51.100.2"))).status, 202, `B run #${i + 1}`);
    finishAllChecks(db);
  }
});

test("⑩ 수리도 같다 — 네트워크 상한 429(scope network) · 서비스 전체 상한 503 repair_disabled(daily_capacity)", async () => {
  const calls = [];
  const fleet = anonymousFleet(5, "rep");
  const db = makeDb(fleet);
  const env = makeEnv({
    db,
    sandbox: acceptingNs(calls),
    vars: { BETA_REPAIR_DAILY_LIMIT_PER_IP: "2", BETA_REPAIR_DAILY_LIMIT_GLOBAL: "3" },
  });
  const [u0, u1, u2, u3, u4] = fleet.users;
  const net = ipHeader("198.51.100.20");
  assert.equal((await req(env, "POST", repairPath(u0.projectId, u0.runId), { userKey: u0.userKey }, net)).status, 202);
  assert.equal((await req(env, "POST", repairPath(u1.projectId, u1.runId), { userKey: u1.userKey }, net)).status, 202);
  const capped = await req(env, "POST", repairPath(u2.projectId, u2.runId), { userKey: u2.userKey }, net);
  assert.equal(capped.status, 429);
  assert.deepEqual(
    { error: capped.json.error, kind: capped.json.kind, scope: capped.json.scope, limit: capped.json.limit },
    { error: "daily_limit_reached", kind: "repair", scope: "network", limit: 2 },
  );
  assert.equal((await req(env, "POST", repairPath(u3.projectId, u3.runId), { userKey: u3.userKey }, ipHeader("198.51.100.21"))).status, 202);
  const full = await req(env, "POST", repairPath(u4.projectId, u4.runId), { userKey: u4.userKey }, ipHeader("198.51.100.22"));
  assert.equal(full.status, 503);
  assert.equal(full.json.error, "repair_disabled");
  assert.equal(full.json.reason, "daily_capacity");
  assert.equal(db.state.jobs.length, 3, "only the three accepted repairs have rows");
  assert.equal(calls.length, 3);
});

test("⑩ 네트워크 버킷에 저장되는 값은 비밀 키 HMAC — sha256(inspection-daily-ip::ip)가 아니다 (IPv4 전수 대입으로 IP 역산 불가)", async () => {
  const { createHash, createHmac } = await import("node:crypto");
  const calls = [];
  const db = defaultDb();
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  const ip = "198.51.100.77";
  assert.equal((await req(env, "POST", runPath(PROJECT), { userKey: USER }, ipHeader(ip))).status, 202);
  const subkey = createHmac("sha256", Buffer.from(KEK, "utf8")).update("simsa/rate-limit-ip/v1", "utf8").digest();
  const keyed = createHmac("sha256", subkey).update(`inspection-daily-ip::${ip}`, "utf8").digest("hex");
  const unkeyed = createHash("sha256").update(`inspection-daily-ip::${ip}`, "utf8").digest("hex");
  const stored = [...db.state.rate.keys()].map((k) => k.split("::")[0]);
  assert.ok(stored.includes(keyed), "the network slot is stored under the keyed HMAC");
  assert.ok(!stored.includes(unkeyed), "no brute-forceable SHA-256 of the IP");
  assert.ok(!stored.some((h) => h.includes(ip)));
});

test("[가드] ⑩ verify-sweep(시스템 재검수)은 네트워크·서비스 버킷에도 세지 않는다", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: [originRun("wvc_orig", PROJECT, USER)],
    events: [mergedEvent("wvc_orig", PROJECT, USER)],
  });
  const env = makeEnv({ db, inspector: acceptingNs(calls), vars: { PUBLIC_BASE_URL: "https://base", BETA_INSPECTION_DAILY_LIMIT_GLOBAL: "1" } });
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 1);
  assert.equal(db.state.rate.size, 0, "no bucket of any scope is touched by the sweep");
});

// ─── ⑪ 원자성: 동시 요청이 상한·진행 중 1개 가드를 넘지 못한다 (PR #561 review P2) ────────
//
// 가짜 D1에 문장마다 3ms 지연(실 D1 왕복)을 넣고 Promise.all로 동시에 보낸다. 지연이 없으면
// 옛 "읽고 → 증가" 코드도 통과해서 기존 테스트로는 잡히지 않았다.

test("⑪ 같은 userKey로 프로젝트 15개에 동시에 검수 → 정확히 10개만 디스패치 (차감이 문장 하나)", async () => {
  const calls = [];
  const projects = new Map();
  const sources = [];
  const ids = [];
  for (let i = 0; i < 15; i++) {
    const pid = `wsp_conc_${i}`;
    projects.set(pid, projectRow(pid, USER));
    sources.push(website(pid, USER));
    ids.push(pid);
  }
  const db = makeDb({ projects, sources }, { delayMs: 3 });
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  const results = await Promise.all(ids.map((pid) => req(env, "POST", runPath(pid), { userKey: USER })));
  const accepted = results.filter((r) => r.status === 202 && r.json.dispatched === true).length;
  const capped = results.filter((r) => r.status === 429).length;
  assert.equal(accepted, 10, `statuses: ${results.map((r) => r.status).join(",")}`);
  assert.equal(capped, 5);
  assert.equal(calls.length, 10, "the container is started exactly cap times");
});

test("⑪ 한 프로젝트에 검수 15개를 동시에 → 디스패치 1개 · 나머지 409/429 · 진행 중 행 1개 · 남는 차감 1건", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    sources: [website(PROJECT, USER)],
  }, { delayMs: 3 });
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  const results = await Promise.all(Array.from({ length: 15 }, () => req(env, "POST", runPath(PROJECT), { userKey: USER })));
  const accepted = results.filter((r) => r.status === 202 && r.json.dispatched === true);
  assert.equal(accepted.length, 1, `statuses: ${results.map((r) => r.status).join(",")}`);
  for (const r of results) {
    if (r !== accepted[0]) assert.ok(r.status === 409 || r.status === 429, `loser status ${r.status}`);
  }
  const active = db.state.checks.filter((r) => r.status === "queued" || r.status === "running");
  assert.equal(active.length, 1, "one active run per project — the guard holds under concurrency");
  assert.equal(active[0].id, accepted[0].json.check.id);
  assert.equal(calls.length, 1);
  for (const [k, v] of db.state.rate) assert.equal(v, 1, `bucket ${k}: only the one real dispatch stays charged`);
});

test("⑪ 한 런에 수리 8개를 동시에 → 잡 1개 · 컨테이너 1회 · 남는 차감 1건", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: [failedCheck("wvc_fix")],
    repos: [repoRow()],
    connections: [connectionRow()],
  }, { delayMs: 3 });
  const env = makeEnv({ db, sandbox: acceptingNs(calls) });
  const results = await Promise.all(Array.from({ length: 8 }, () => req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER })));
  const accepted = results.filter((r) => r.status === 202 && r.json.dispatched === true);
  assert.equal(accepted.length, 1, `statuses: ${results.map((r) => r.status).join(",")}`);
  for (const r of results) {
    if (r !== accepted[0]) assert.ok(r.status === 409 || r.status === 429, `loser status ${r.status}`);
  }
  assert.equal(db.state.jobs.filter((j) => j.status === "queued" || j.status === "running").length, 1);
  assert.equal(calls.length, 1, "two containers never force-push the same fix branch");
  for (const [k, v] of db.state.rate) assert.equal(v, 1, `bucket ${k}`);
});

test("⑪ 같은 userKey로 런 8개에 수리를 동시에 → 정확히 5개", async () => {
  const calls = [];
  const runs = Array.from({ length: 8 }, (_, i) => failedCheck(`wvc_cr${i}`));
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: runs,
    repos: [repoRow()],
    connections: [connectionRow()],
  }, { delayMs: 3 });
  const env = makeEnv({ db, sandbox: acceptingNs(calls) });
  const results = await Promise.all(runs.map((r) => req(env, "POST", repairPath(PROJECT, r.id), { userKey: USER })));
  assert.equal(results.filter((r) => r.status === 202 && r.json.dispatched === true).length, 5, `statuses: ${results.map((r) => r.status).join(",")}`);
  assert.equal(results.filter((r) => r.status === 429).length, 3);
  assert.equal(calls.length, 5);
});

test("⑪ 실제 SQLite: 차감 문장은 상한에서 아무 행도 바꾸지 않는다 (0026 스키마, node:sqlite)", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite unavailable on this Node version");
    return;
  }
  const { DAILY_SLOT_CONSUME_SQL } = await import("../dist/workspace/rate-limit.js");
  assert.equal(typeof DAILY_SLOT_CONSUME_SQL, "string", "the single-statement consume is exported for this check");
  const { readFileSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0026_workspace_rate_limit.sql", import.meta.url), "utf8"));
  const stmt = db.prepare(DAILY_SLOT_CONSUME_SQL);
  const got = [];
  for (let i = 0; i < 5; i++) got.push(stmt.run("h", "2026-09-29", "t", "t", 3).changes);
  assert.deepEqual(got, [1, 1, 1, 0, 0], "1 changed row while under the limit, 0 once it is full");
  assert.equal(db.prepare("SELECT count FROM workspace_rate_limit").get().count, 3, "never past the limit");
});

// ─── ⑫ 환급 경로 (행 저장 실패 · 컨테이너 거절) — 행동 보존 가드 ──────────────────

function rejectingNs(calls) {
  return {
    idFromName: (name) => ({ name }),
    get: () => ({
      async fetch(url, init) {
        calls.push({ url, body: JSON.parse(init.body) });
        return new Response("container busy", { status: 500 });
      },
    }),
  };
}

test("[가드] ⑫ 검수 행 저장 실패 → 500 save_failed · 모든 버킷 환급 · 컨테이너 0", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    sources: [website(PROJECT, USER)],
  }, { failInserts: ["workspace_visual_checks"] });
  const env = makeEnv({ db, inspector: acceptingNs(calls) });
  const r = await req(env, "POST", runPath(PROJECT), { userKey: USER }, ipHeader("198.51.100.30"));
  assert.equal(r.status, 500);
  assert.equal(r.json.error, "save_failed");
  assert.equal(totalCharged(db), 0, "nothing stays charged");
  assert.equal(calls.length, 0);
});

test("[가드] ⑫ 수리 행 저장 실패 → 500 save_failed · 모든 버킷 환급 · 컨테이너 0", async () => {
  const calls = [];
  const db = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: [failedCheck("wvc_fix")],
    repos: [repoRow()],
    connections: [connectionRow()],
  }, { failInserts: ["workspace_repair_jobs"] });
  const env = makeEnv({ db, sandbox: acceptingNs(calls) });
  const r = await req(env, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER }, ipHeader("198.51.100.31"));
  assert.equal(r.status, 500);
  assert.equal(r.json.error, "save_failed");
  assert.equal(totalCharged(db), 0);
  assert.equal(calls.length, 0);
});

test("[가드] ⑫ 컨테이너가 잡을 거절(500) → dispatched:false · 행 failed · 모든 버킷 환급 (검수·수리)", async () => {
  const calls = [];
  const db1 = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    sources: [website(PROJECT, USER)],
  });
  const env1 = makeEnv({ db: db1, inspector: rejectingNs(calls) });
  const r1 = await req(env1, "POST", runPath(PROJECT), { userKey: USER }, ipHeader("198.51.100.32"));
  assert.equal(r1.status, 202);
  assert.equal(r1.json.dispatched, false);
  assert.match(r1.json.note, /container returned 500/);
  assert.equal(db1.state.checks[0].status, "failed");
  assert.equal(totalCharged(db1), 0);

  const db2 = makeDb({
    projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
    checks: [failedCheck("wvc_fix")],
    repos: [repoRow()],
    connections: [connectionRow()],
  });
  const env2 = makeEnv({ db: db2, sandbox: rejectingNs(calls) });
  const r2 = await req(env2, "POST", repairPath(PROJECT, "wvc_fix"), { userKey: USER }, ipHeader("198.51.100.33"));
  assert.equal(r2.status, 202);
  assert.equal(r2.json.dispatched, false);
  assert.equal(db2.state.jobs[0].status, "failed");
  assert.equal(totalCharged(db2), 0);
  assert.equal(calls.length, 2, "each container was asked once and said no");
});

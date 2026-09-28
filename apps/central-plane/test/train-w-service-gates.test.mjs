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
 * Mocks at the seam: 가짜 D1(한 파일에 모든 테이블), 가짜 DO 네임스페이스. 네트워크 없음.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { createApp } = await import("../dist/router.js");
const { runVerifySweep, REPAIR_MERGED_EVENT } = await import("../dist/workspace/verify-sweep.js");
const { dispatchInspection } = await import("../dist/routes/workspace-visual-check-runs.js");
const { dispatchRepairJob } = await import("../dist/routes/workspace-repair-jobs.js");
const { encryptToken } = await import("../dist/crypto.js");

/** The switch module is new in Train W — load lazily so each test fails on its own on old code. */
async function loadSwitches() {
  const mod = await import("../dist/workspace/service-switches.js").catch(() => null);
  assert.ok(mod, "dist/workspace/service-switches.js must exist (Train W single switch helper)");
  return mod;
}

const USER = "uk_owner";
const USER_B = "uk_other_owner";
const PROJECT = "proj_w";
const PROJECT_B = "proj_w_b";
const TOKEN = "tok_internal_fake";
const KEK = randomBytes(32).toString("base64");
const GH_TOKEN_ENC = await encryptToken("gho_fakeOauthTokenForTests", KEK);

// ─── Fake D1 (all tables the gated paths touch) ───────────────────────────────

function makeDb(state) {
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
  return {
    state: s,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            // workspace_rate_limit (rate-limit.ts): insert-or-increment + refund.
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
              const [id, project_id, user_key, target_url, intent, locale, region, envelope_json, source_check_id, created_at, updated_at] = args;
              s.checks.push({
                id, project_id, user_key, target_url, intent,
                decision: "Not Judged", works: null, status: "queued", executor: "container",
                report_json: "{}", agent_prompt: null, evidence_keys_json: "[]",
                locale, region, envelope_json, source_check_id, created_at, updated_at,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("workspace_visual_checks") && sql.includes("SET status = 'failed'")) {
              const [, updated_at, id] = args;
              const row = s.checks.find((r) => r.id === id);
              if (row) { row.status = "failed"; row.updated_at = updated_at; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("INSERT INTO workspace_repair_jobs")) {
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
            if (sql.includes("FROM workspace_rate_limit")) {
              const [hash, key] = args;
              const count = s.rate.get(`${hash}::${key}`);
              return count === undefined ? null : { count };
            }
            if (sql.includes("FROM workspace_projects WHERE id = ?")) return s.projects.get(args[0]) ?? null;
            if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) {
              return s.sources.find((x) => x.id === args[0]) ?? null;
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

function projectRow(id, userKey) {
  return {
    id, user_key: userKey, title: "t", idea: "i",
    understood_json: "{}", product_spec_json: "{}", items_json: "[]",
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

async function req(env, method, path, body) {
  const app = createApp();
  const init = { method, headers: { "content-type": "application/json" } };
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

function nextUtcMidnightIso() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
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
  const r11 = await req(env, "POST", runPath(PROJECT), { userKey: USER });
  assert.equal(r11.status, 429);
  assert.deepEqual(
    { ok: r11.json.ok, error: r11.json.error, kind: r11.json.kind, limit: r11.json.limit },
    { ok: false, error: "daily_limit_reached", kind: "inspection", limit: 10 },
  );
  assert.equal(typeof r11.json.resetAt, "string");
  assert.ok(!Number.isNaN(Date.parse(r11.json.resetAt)), "resetAt must be ISO");
  assert.equal(r11.json.resetAt, nextUtcMidnightIso(), "resetAt = next UTC midnight (the day bucket boundary)");
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
  const r6 = await req(env, "POST", repairPath(PROJECT, runs[5].id), { userKey: USER });
  assert.equal(r6.status, 429);
  assert.equal(r6.json.ok, false);
  assert.equal(r6.json.error, "daily_limit_reached");
  assert.equal(r6.json.kind, "repair");
  assert.equal(r6.json.limit, 5);
  assert.equal(r6.json.resetAt, nextUtcMidnightIso());
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
    id: `evt_${runId}`, user_key: userKey, project_id: projectId,
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
    const pid = `proj_sweep_${i}`;
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
  const PROJECT_B2 = "proj_w_b2";
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

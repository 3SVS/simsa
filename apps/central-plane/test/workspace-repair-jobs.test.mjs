/**
 * workspace-repair-jobs.test.mjs — Stage 268
 *
 * "[고치기]" repair loop for failed Simsa visual checks:
 *   - POST /workspace/projects/:id/visual-checks/:runId/repair — ownership
 *     chain, repairable gating (done + works!==true + agent_prompt), repo/token
 *     resolution errors, env-cause pre-check, 409 guard, SANDBOX dispatch
 *     payload, fail-fast without the binding (263.1 semantics).
 *   - GET  .../repair — latest job for dashboard polling.
 *   - POST /internal/repair-{running,done} — bearer gate + transitions.
 *   - cleanupStuckRepairJobs — 30-min stuck sweep.
 *   - container pure helpers (validateRepairPayload / redactSecret /
 *     buildRepairPrContent) — token never leaks into PR title/body/brief.
 *
 * Mocks at the seam: fake D1, stub DurableObjectNamespace, REAL AES-GCM crypto
 * (a generated KEK encrypts the stored OAuth token so the route's decrypt path
 * is exercised for real). No network, no containers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { createApp } = await import("../dist/router.js");
const { cleanupStuckRepairJobs } = await import("../dist/stuck-cleanup.js");
const { detectEnvCause, isRunRepairable, normalizeRepoReference } = await import(
  "../dist/routes/workspace-repair-jobs.js"
);
const { encryptToken } = await import("../dist/crypto.js");
const { validateRepairPayload, redactSecret, buildRepairPrContent } = await import(
  "../container/coerce-result.mjs"
);

const USER = "uk_owner";
const OTHER = "uk_intruder";
const PROJECT = "proj_repair";
const OTHER_PROJECT = "proj_other";
const RUN = "wvc_fixme1";
const TOKEN = "tok_internal_secret";
const GH_TOKEN = "gho_userOauthToken12345";
const KEK = randomBytes(32).toString("base64");
const GH_TOKEN_ENC = await encryptToken(GH_TOKEN, KEK);

const AGENT_PROMPT =
  "당신은 이 프로젝트의 코드를 수정하는 개발 에이전트입니다.\n[고칠 문제] 버튼 클릭 후 목록이 비어 있음";
const ENV_PROMPT =
  AGENT_PROMPT + "\n증거: GET https://dead.supabase.co/rest/v1/x (net::ERR_NAME_NOT_RESOLVED)";

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makeDb({ projects = new Map(), checks = [], repos = [], connections = [], sources = [], jobs = [] } = {}) {
  return {
    _jobs: jobs,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO workspace_repair_jobs")) {
              const [id, project_id, user_key, visual_check_id, repo_full_name, branch_name, env_cause, created_at, updated_at] = args;
              jobs.push({
                id, project_id, user_key, visual_check_id, repo_full_name,
                status: "queued", branch_name, pr_url: null, pr_number: null,
                env_cause, error: null, created_at, updated_at,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'running'")) {
              const [updated_at, id] = args;
              const row = jobs.find((r) => r.id === id && (r.status === "queued" || r.status === "running"));
              if (row) { row.status = "running"; row.updated_at = updated_at; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'done'")) {
              const [pr_url, pr_number, branch_name, env_flag, updated_at, id] = args;
              const row = jobs.find((r) => r.id === id);
              if (row) {
                row.status = "done";
                row.pr_url = pr_url ?? row.pr_url;
                row.pr_number = pr_number ?? row.pr_number;
                row.branch_name = branch_name ?? row.branch_name;
                if (env_flag === 1) row.env_cause = 1;
                row.updated_at = updated_at;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'failed'")) {
              const [error, updated_at, id] = args;
              const row = jobs.find((r) => r.id === id);
              if (row) { row.status = "failed"; row.error = error; row.updated_at = updated_at; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            if (sql.includes("FROM workspace_projects WHERE id = ?")) {
              return projects.get(args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE id = ?")) {
              return checks.find((r) => r.id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_project_repos WHERE project_id = ?")) {
              return repos.find((r) => r.project_id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_github_connections WHERE user_key = ?")) {
              return connections.find((r) => r.user_key === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE id = ?")) {
              return jobs.find((r) => r.id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("status IN ('queued', 'running')")) {
              return jobs.find((r) => r.visual_check_id === args[0] && (r.status === "queued" || r.status === "running")) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE visual_check_id = ?")) {
              const list = jobs
                .filter((r) => r.visual_check_id === args[0])
                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
              return list[0] ?? null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id = ?")) {
              return { results: sources.filter((s) => s.project_id === args[0]) };
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("updated_at < ?")) {
              const [cutoff, limit] = args;
              return {
                results: jobs
                  .filter((r) => (r.status === "queued" || r.status === "running") && r.updated_at < cutoff)
                  .slice(0, limit)
                  .map((r) => ({ id: r.id, status: r.status })),
              };
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

function makeProjectRow(id, userKey) {
  return {
    id, user_key: userKey, title: "t", idea: "i",
    understood_json: "{}", product_spec_json: "{}", items_json: "[]",
    created_at: "2026-07-02T00:00:00.000Z", updated_at: "2026-07-02T00:00:00.000Z",
  };
}

function makeCheck(over = {}) {
  return {
    id: RUN, project_id: PROJECT, user_key: USER,
    target_url: "https://golf-now.example.app/", intent: "골퍼가 코스 목록을 볼 수 있어야 한다",
    decision: "Needs Fix", works: 0, status: "done", executor: "container",
    report_json: JSON.stringify({ verdict: "작동 안 해요" }), agent_prompt: AGENT_PROMPT,
    evidence_keys_json: "[]",
    created_at: "2026-07-02T00:00:00.000Z", updated_at: "2026-07-02T00:00:00.000Z",
    ...over,
  };
}

function makeRepoRow(over = {}) {
  return {
    id: "wpr_1", project_id: PROJECT, user_key: USER, github_connection_id: "wgc_1",
    repo_id: "1", repo_full_name: "acme/golf-now", repo_owner: "acme", repo_name: "golf-now",
    default_branch: "main", private: 0, html_url: "https://github.com/acme/golf-now",
    created_at: "2026-07-02T00:00:00.000Z", updated_at: "2026-07-02T00:00:00.000Z",
    ...over,
  };
}

function makeConnection(over = {}) {
  return {
    id: "wgc_1", user_key: USER, github_user_id: "77", github_login: "acme-user",
    github_name: null, avatar_url: null, access_token_enc: GH_TOKEN_ENC, scopes: "read:user public_repo",
    created_at: "2026-07-02T00:00:00.000Z", updated_at: "2026-07-02T00:00:00.000Z",
    ...over,
  };
}

/** Stub SANDBOX DurableObjectNamespace recording idFromName + fetch payloads. */
function makeSandbox(recorder, { status = 202 } = {}) {
  return {
    idFromName(name) {
      recorder.names.push(name);
      return { name };
    },
    get() {
      return {
        async fetch(url, init) {
          recorder.calls.push({ url, body: JSON.parse(init.body) });
          return new Response(JSON.stringify({ status: "accepted" }), { status });
        },
      };
    },
  };
}

function makeEnv({
  checks = [makeCheck()],
  repos = [makeRepoRow()],
  connections = [makeConnection()],
  sources = [],
  jobs = [],
  sandbox,
  token = TOKEN,
  kek = KEK,
} = {}) {
  const env = {
    ENVIRONMENT: "test",
    DB: makeDb({
      projects: new Map([
        [PROJECT, makeProjectRow(PROJECT, USER)],
        [OTHER_PROJECT, makeProjectRow(OTHER_PROJECT, OTHER)],
      ]),
      checks, repos, connections, sources, jobs,
    }),
  };
  if (sandbox) env.SANDBOX = sandbox;
  if (token) env.INTERNAL_CALLBACK_TOKEN = token;
  if (kek) env.CONCLAVE_TOKEN_KEK = kek;
  return env;
}

async function req(env, method, path, body, headers = {}) {
  const app = createApp();
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.fetch(new Request(`http://localhost${path}`, init), env);
  let json = null;
  try { json = await res.clone().json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const REPAIR_PATH = `/workspace/projects/${PROJECT}/visual-checks/${RUN}/repair`;

// ─── ownership chain ──────────────────────────────────────────────────────────

test("repair: unknown project 404 / wrong userKey 403 / missing userKey 400", async () => {
  const env = makeEnv();
  const nope = await req(env, "POST", `/workspace/projects/proj_nope/visual-checks/${RUN}/repair`, { userKey: USER });
  assert.equal(nope.status, 404);
  assert.equal(nope.json.error, "project_not_found");

  const forbidden = await req(env, "POST", REPAIR_PATH, { userKey: OTHER });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, "forbidden");

  const missing = await req(env, "POST", REPAIR_PATH, {});
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, "userKey_required");
});

test("repair: run belonging to another project/user → 404 run_not_found", async () => {
  const env = makeEnv({ checks: [makeCheck({ project_id: OTHER_PROJECT, user_key: OTHER })] });
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "run_not_found");

  const unknown = await req(env, "POST", `/workspace/projects/${PROJECT}/visual-checks/wvc_nope/repair`, { userKey: USER });
  assert.equal(unknown.status, 404);
});

// ─── repairable gating: done + works!==true + agent_prompt ───────────────────

test("repair: run still running / failed → 400 run_not_repairable", async () => {
  for (const status of ["queued", "running", "failed", "uploaded"]) {
    const env = makeEnv({ checks: [makeCheck({ status })] });
    const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
    assert.equal(r.status, 400, `status=${status}`);
    assert.equal(r.json.error, "run_not_repairable");
    assert.match(r.json.message, /고치기/);
  }
});

test("repair: run that WORKS (works=true) → 400 run_not_repairable; works=null is repairable", async () => {
  const works = makeEnv({ checks: [makeCheck({ works: 1 })] });
  const r = await req(works, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "run_not_repairable");

  // works=null (not verified) + prompt present → repairable (fail-fast path,
  // no sandbox in this env, but gating passed: not run_not_repairable).
  const nullWorks = makeEnv({ checks: [makeCheck({ works: null })] });
  const r2 = await req(nullWorks, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r2.status, 202);
});

test("repair: missing agent_prompt → 400 run_not_repairable", async () => {
  const env = makeEnv({ checks: [makeCheck({ agent_prompt: null })] });
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "run_not_repairable");
});

// ─── repo + token resolution ──────────────────────────────────────────────────

test("repair: no linked repo anywhere → 400 github_repo_required with Korean message", async () => {
  const env = makeEnv({ repos: [], sources: [] });
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "github_repo_required");
  assert.match(r.json.message, /저장소/);
});

test("repair: falls back to project_sources github_repo when no workspace repo link", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({
    repos: [],
    sources: [
      { id: "psrc_w", project_id: PROJECT, user_key: USER, type: "website", reference: "https://x.app/", label: null, content_type: null, size_bytes: null, created_at: "2026-07-02T00:00:00.000Z" },
      { id: "psrc_gh", project_id: PROJECT, user_key: USER, type: "github_repo", reference: "https://github.com/acme/golf-now.git", label: null, content_type: null, size_bytes: null, created_at: "2026-07-02T00:00:00.000Z" },
    ],
    sandbox: makeSandbox(recorder),
  });
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.repair.repoFullName, "acme/golf-now");
  assert.equal(recorder.calls[0].body.repo, "acme/golf-now");
});

test("repair: token missing (no connection / no KEK / bad ciphertext) → 400 github_token_required", async () => {
  const noConn = makeEnv({ connections: [] });
  const r1 = await req(noConn, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r1.status, 400);
  assert.equal(r1.json.error, "github_token_required");
  assert.match(r1.json.message, /GitHub/);

  const noKek = makeEnv({ kek: null });
  const r2 = await req(noKek, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r2.status, 400);
  assert.equal(r2.json.error, "github_token_required");

  const tampered = makeEnv({ connections: [makeConnection({ access_token_enc: "not-a-ciphertext" })] });
  const r3 = await req(tampered, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r3.status, 400);
  assert.equal(r3.json.error, "github_token_required");
});

// ─── env-cause pre-check (pure) ───────────────────────────────────────────────

test("detectEnvCause: DNS / connection-refused evidence → true; clean evidence → false", () => {
  assert.equal(detectEnvCause(ENV_PROMPT, "{}"), true);
  assert.equal(detectEnvCause("", JSON.stringify({ findings: [{ evidence: "getaddrinfo ENOTFOUND dead.host" }] })), true);
  assert.equal(detectEnvCause("연결 실패: net::ERR_CONNECTION_REFUSED", "{}"), true);
  assert.equal(detectEnvCause("fetch failed: ECONNREFUSED 127.0.0.1:5432", "{}"), true);
  assert.equal(detectEnvCause(AGENT_PROMPT, JSON.stringify({ verdict: "버튼이 반응 없음" })), false);
  assert.equal(detectEnvCause("", ""), false);
});

test("repair: env-cause run still dispatches but flags envCause on row + payload", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ checks: [makeCheck({ agent_prompt: ENV_PROMPT })], sandbox: makeSandbox(recorder) });
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.dispatched, true, "env-cause must NOT block the repair");
  assert.equal(r.json.repair.envCause, true);
  assert.equal(env.DB._jobs[0].env_cause, 1);
  assert.equal(recorder.calls[0].body.envCause, true);
});

// ─── dispatch + fail-fast + 409 ───────────────────────────────────────────────

test("repair: SANDBOX present → dispatched:true, DO named repair-<jobId>, payload carries job contract (+ decrypted token, never in response)", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ sandbox: makeSandbox(recorder) });
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.dispatched, true);
  assert.equal(r.json.repair.status, "queued");
  assert.equal(r.json.repair.branchName, `fix/simsa-${RUN}`);

  const jobId = r.json.repair.id;
  assert.deepEqual(recorder.names, [`repair-${jobId}`]);
  const payload = recorder.calls[0].body;
  assert.equal(payload.jobType, "simsa_repair");
  assert.equal(payload.jobId, jobId);
  assert.equal(payload.repo, "acme/golf-now");
  assert.equal(payload.githubToken, GH_TOKEN, "container receives the DECRYPTED OAuth token");
  assert.equal(payload.branch, `fix/simsa-${RUN}`);
  assert.equal(payload.agentPrompt, AGENT_PROMPT);
  assert.equal(payload.visualCheckId, RUN);
  assert.equal(payload.callbackToken, TOKEN);
  assert.match(payload.callbackUrl, /\/internal\/repair-done$/);
  assert.match(payload.runningUrl, /\/internal\/repair-running$/);

  // The token must never leak into the HTTP response or the D1 row.
  assert.ok(!JSON.stringify(r.json).includes(GH_TOKEN), "response must not leak the GitHub token");
  assert.ok(!JSON.stringify(env.DB._jobs).includes(GH_TOKEN), "D1 rows must not contain the token");
});

test("repair: SANDBOX absent → row created then FAIL-FAST (dispatched:false, retry not wedged)", async () => {
  const env = makeEnv(); // no sandbox binding
  const r = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.dispatched, false);
  assert.equal(r.json.note, "sandbox_unavailable");
  assert.equal(r.json.repair.status, "failed");
  assert.equal(env.DB._jobs[0].status, "failed");

  // and the user can retry immediately (no repair_already_active wedge)
  const retry = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(retry.status, 202);
});

test("repair: container refuses (500) / callback token missing → fail-fast with note", async () => {
  const recorder = { names: [], calls: [] };
  const refuse = makeEnv({ sandbox: makeSandbox(recorder, { status: 500 }) });
  const r = await req(refuse, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.dispatched, false);
  assert.match(r.json.note, /container returned 500/);
  assert.equal(refuse.DB._jobs[0].status, "failed");

  const noCb = makeEnv({ sandbox: makeSandbox({ names: [], calls: [] }), token: null });
  const r2 = await req(noCb, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(r2.json.dispatched, false);
  assert.equal(r2.json.note, "callback_token_missing");
  assert.equal(noCb.DB._jobs[0].status, "failed");
});

test("repair: one active repair per run → 409 repair_already_active", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ sandbox: makeSandbox(recorder) }); // successful dispatch keeps row queued
  const first = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(first.status, 202);

  const second = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, "repair_already_active");
  assert.equal(second.json.activeJobId, first.json.repair.id);

  // running (not just queued) also blocks
  env.DB._jobs[0].status = "running";
  const third = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  assert.equal(third.status, 409);
});

// ─── /internal/repair-running + /internal/repair-done ────────────────────────

test("internal repair callbacks: 503 when token unset, 401 on wrong/missing bearer", async () => {
  const noToken = makeEnv({ token: null });
  const disabled = await req(noToken, "POST", "/internal/repair-running", { jobId: "x" });
  assert.equal(disabled.status, 503);

  const env = makeEnv();
  for (const path of ["/internal/repair-running", "/internal/repair-done"]) {
    const wrong = await req(env, "POST", path, { jobId: "x", ok: true }, { authorization: "Bearer nope" });
    assert.equal(wrong.status, 401, path);
    const missing = await req(env, "POST", path, { jobId: "x", ok: true });
    assert.equal(missing.status, 401, path);
  }
});

test("internal repair-running: queued → running; unknown jobId 404", async () => {
  const env = makeEnv({ sandbox: makeSandbox({ names: [], calls: [] }) });
  const created = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  const jobId = created.json.repair.id;

  const r = await req(env, "POST", "/internal/repair-running", { jobId }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(r.status, 200);
  assert.equal(r.json.transitioned, true);
  assert.equal(env.DB._jobs[0].status, "running");

  const unknown = await req(env, "POST", "/internal/repair-running", { jobId: "wrj_nope" }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(unknown.status, 404);
});

test("internal repair-done: ok:true stores PR url/number/branch → status done", async () => {
  const env = makeEnv({ sandbox: makeSandbox({ names: [], calls: [] }) });
  const created = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  const jobId = created.json.repair.id;

  const r = await req(
    env, "POST", "/internal/repair-done",
    { jobId, ok: true, prUrl: "https://github.com/acme/golf-now/pull/38", prNumber: 38, branch: `fix/simsa-${RUN}` },
    { authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "done");

  const row = env.DB._jobs[0];
  assert.equal(row.status, "done");
  assert.equal(row.pr_url, "https://github.com/acme/golf-now/pull/38");
  assert.equal(row.pr_number, 38);
  assert.equal(row.branch_name, `fix/simsa-${RUN}`);
});

test("internal repair-done: ok:false stores truncated error → status failed; invalid body 400; unknown 404", async () => {
  const env = makeEnv({ sandbox: makeSandbox({ names: [], calls: [] }) });
  const created = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  const jobId = created.json.repair.id;

  const r = await req(
    env, "POST", "/internal/repair-done",
    { jobId, ok: false, error: "clone failed " + "x".repeat(600) },
    { authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "failed");
  assert.equal(env.DB._jobs[0].status, "failed");
  assert.match(env.DB._jobs[0].error, /clone failed/);
  assert.ok(env.DB._jobs[0].error.length <= 500, "error must be truncated");

  const invalid = await req(env, "POST", "/internal/repair-done", { jobId }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(invalid.status, 400);
  const unknown = await req(env, "POST", "/internal/repair-done", { jobId: "wrj_nope", ok: true }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(unknown.status, 404);
});

// ─── GET latest repair job ────────────────────────────────────────────────────

test("GET repair: latest job for the run (dashboard polling); null when none; ownership enforced", async () => {
  const env = makeEnv({ sandbox: makeSandbox({ names: [], calls: [] }) });

  const empty = await req(env, "GET", `${REPAIR_PATH}?userKey=${USER}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.json.repair, null);

  const created = await req(env, "POST", REPAIR_PATH, { userKey: USER });
  const jobId = created.json.repair.id;
  await req(env, "POST", "/internal/repair-done",
    { jobId, ok: true, prUrl: "https://github.com/acme/golf-now/pull/38", prNumber: 38 },
    { authorization: `Bearer ${TOKEN}` });

  const got = await req(env, "GET", `${REPAIR_PATH}?userKey=${USER}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.repair.id, jobId);
  assert.equal(got.json.repair.status, "done");
  assert.equal(got.json.repair.prUrl, "https://github.com/acme/golf-now/pull/38");
  assert.equal(got.json.repair.prNumber, 38);

  const forbidden = await req(env, "GET", `${REPAIR_PATH}?userKey=${OTHER}`);
  assert.equal(forbidden.status, 403);
  const noKey = await req(env, "GET", REPAIR_PATH);
  assert.equal(noKey.status, 400);
});

// ─── stuck sweep ──────────────────────────────────────────────────────────────

test("stuck sweep: repair jobs stuck in queued|running >30 min → failed; fresh untouched", async () => {
  const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const jobs = [
    { id: "wrj_old_q", project_id: PROJECT, user_key: USER, visual_check_id: RUN, repo_full_name: "acme/golf-now", status: "queued", branch_name: "b", pr_url: null, pr_number: null, env_cause: 0, error: null, created_at: old, updated_at: old },
    { id: "wrj_old_r", project_id: PROJECT, user_key: USER, visual_check_id: "wvc_2", repo_full_name: "acme/golf-now", status: "running", branch_name: "b", pr_url: null, pr_number: null, env_cause: 0, error: null, created_at: old, updated_at: old },
    { id: "wrj_fresh", project_id: PROJECT, user_key: USER, visual_check_id: "wvc_3", repo_full_name: "acme/golf-now", status: "queued", branch_name: "b", pr_url: null, pr_number: null, env_cause: 0, error: null, created_at: fresh, updated_at: fresh },
    { id: "wrj_done", project_id: PROJECT, user_key: USER, visual_check_id: "wvc_4", repo_full_name: "acme/golf-now", status: "done", branch_name: "b", pr_url: "u", pr_number: 1, env_cause: 0, error: null, created_at: old, updated_at: old },
  ];
  const env = makeEnv({ jobs });

  const result = await cleanupStuckRepairJobs(env);
  assert.equal(result.swept, 2);
  assert.equal(result.errors, 0);
  assert.equal(jobs[0].status, "failed");
  assert.match(jobs[0].error, /30 minutes/);
  assert.equal(jobs[1].status, "failed");
  assert.equal(jobs[2].status, "queued", "fresh job must not be swept");
  assert.equal(jobs[3].status, "done", "terminal job must not be touched");
});

// ─── pure helpers ─────────────────────────────────────────────────────────────

test("isRunRepairable / normalizeRepoReference pure cases", () => {
  assert.equal(isRunRepairable({ status: "done", works: false, agentPrompt: "p" }), true);
  assert.equal(isRunRepairable({ status: "done", works: null, agentPrompt: "p" }), true);
  assert.equal(isRunRepairable({ status: "done", works: true, agentPrompt: "p" }), false);
  assert.equal(isRunRepairable({ status: "running", works: false, agentPrompt: "p" }), false);
  assert.equal(isRunRepairable({ status: "done", works: false, agentPrompt: undefined }), false);

  assert.equal(normalizeRepoReference("acme/golf-now"), "acme/golf-now");
  assert.equal(normalizeRepoReference("https://github.com/acme/golf-now.git"), "acme/golf-now");
  assert.equal(normalizeRepoReference("https://github.com/acme/golf-now/"), "acme/golf-now");
  assert.equal(normalizeRepoReference("not a repo"), null);
  assert.equal(normalizeRepoReference("https://gitlab.com/acme/x"), null);
});

test("container helpers: validateRepairPayload + redactSecret", () => {
  const full = {
    jobId: "wrj_1", repo: "acme/golf-now", githubToken: GH_TOKEN, branch: "fix/simsa-x",
    agentPrompt: AGENT_PROMPT, callbackUrl: "https://w/internal/repair-done", callbackToken: TOKEN,
  };
  assert.deepEqual(validateRepairPayload(full), { ok: true });
  const missing = validateRepairPayload({ ...full, githubToken: "", agentPrompt: undefined });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing.sort(), ["agentPrompt", "githubToken"]);
  assert.equal(validateRepairPayload(null).ok, false);

  assert.equal(redactSecret(`clone https://x-access-token:${GH_TOKEN}@github.com failed`, GH_TOKEN),
    "clone https://x-access-token:[REDACTED]@github.com failed");
  assert.equal(redactSecret("plain error", ""), "plain error");
});

test("container helpers: buildRepairPrContent is honest (no auto-fix claim), carries prompt + env warning, never the token", () => {
  const content = buildRepairPrContent({
    intent: "골퍼가 코스 목록을 볼 수 있어야 한다", decision: "Needs Fix",
    targetUrl: "https://golf-now.example.app/", visualCheckId: RUN,
    agentPrompt: ENV_PROMPT, envCause: true, githubToken: GH_TOKEN,
  });
  assert.match(content.title, /^Simsa 수리 시작점: /);
  assert.match(content.body, /자동 적용된 코드 수정이 없습니다/);
  assert.match(content.body, /코드 수정만으로 완전히 해결되지 않을 수 있어요/);
  assert.ok(content.body.includes(ENV_PROMPT), "PR body carries the full agent prompt");
  assert.equal(content.briefFileName, "SIMSA-FIX-BRIEF.md");
  assert.ok(content.briefContent.includes(ENV_PROMPT));
  for (const text of [content.title, content.body, content.briefContent]) {
    assert.ok(!text.includes(GH_TOKEN), "token must never appear in PR content");
  }

  // non-env-cause: no env warning; long intent truncated in title
  const plain = buildRepairPrContent({ intent: "x".repeat(100), agentPrompt: AGENT_PROMPT, envCause: false });
  assert.ok(!/완전히 해결되지 않을 수 있어요/.test(plain.body));
  assert.ok(plain.title.length < 80);
});

/**
 * workspace-visual-check-runs.test.mjs — Stage 263
 *
 * Cloud runner dispatch for Simsa visual checks:
 *   - POST /workspace/projects/:id/visual-checks/run — target resolution
 *     (registered website sources ONLY), ownership, concurrency guard,
 *     graceful degradation without the INSPECTOR binding, DO dispatch payload.
 *   - POST /internal/visual-check-running / -done — bearer-token gate +
 *     queued → running → done|failed transitions.
 *   - cleanupStuckVisualChecks — 30-min stuck sweep.
 *
 * Mocks at the seam: fake D1, stub DurableObjectNamespace. No network, no
 * containers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");
const { cleanupStuckVisualChecks } = await import("../dist/stuck-cleanup.js");

const USER = "uk_owner";
const OTHER = "uk_intruder";
const PROJECT = "proj_vcr";
const OTHER_PROJECT = "proj_other";
const TOKEN = "tok_internal_secret";

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makeDb({ projects = new Map(), sources = [], checks = [] } = {}) {
  return {
    _checks: checks,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO workspace_visual_checks") && sql.includes("'queued', 'container'")) {
              const [id, project_id, user_key, target_url, intent, created_at, updated_at] = args;
              checks.push({
                id, project_id, user_key, target_url, intent,
                decision: "Not Judged", works: null, status: "queued", executor: "container",
                report_json: "{}", agent_prompt: null, evidence_keys_json: "[]",
                created_at, updated_at,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET status = 'running'")) {
              const [updated_at, id] = args;
              const row = checks.find((r) => r.id === id && (r.status === "queued" || r.status === "running"));
              if (row) { row.status = "running"; row.updated_at = updated_at; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("SET status = 'done'")) {
              const [decision, works, report_json, agent_prompt, updated_at, id] = args;
              const row = checks.find((r) => r.id === id);
              if (row) Object.assign(row, { status: "done", decision, works, report_json, agent_prompt, updated_at });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("SET status = 'failed'")) {
              const [errJson, updated_at, id] = args;
              const row = checks.find((r) => r.id === id);
              if (row) {
                row.status = "failed";
                row.decision = "Not Verified";
                if (row.report_json === "{}") row.report_json = errJson;
                row.updated_at = updated_at;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            if (sql.includes("FROM workspace_projects WHERE id = ?")) {
              return projects.get(args[0]) ?? null;
            }
            if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) {
              return sources.find((s) => s.id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("status IN ('queued', 'running')") && sql.includes("project_id = ?")) {
              return checks.find((r) => r.project_id === args[0] && (r.status === "queued" || r.status === "running")) ?? null;
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE id = ?")) {
              return checks.find((r) => r.id === args[0]) ?? null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id = ?")) {
              return { results: sources.filter((s) => s.project_id === args[0]) };
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("updated_at < ?")) {
              const [cutoff, limit] = args;
              return {
                results: checks
                  .filter((r) => (r.status === "queued" || r.status === "running") && r.updated_at < cutoff)
                  .slice(0, limit)
                  .map((r) => ({ id: r.id, status: r.status })),
              };
            }
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE project_id = ?")) {
              return { results: checks.filter((r) => r.project_id === args[0]) };
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

function makeSource(over = {}) {
  return {
    id: "psrc_web1", project_id: PROJECT, user_key: USER, type: "website",
    reference: "https://golf-now.example.app/", label: null, content_type: null,
    size_bytes: null, created_at: "2026-07-02T00:00:00.000Z",
    ...over,
  };
}

/** Stub DurableObjectNamespace recording idFromName + fetch payloads. */
function makeInspector(recorder, { status = 202 } = {}) {
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

function makeEnv({ sources = [makeSource()], checks = [], inspector, token = TOKEN } = {}) {
  const env = {
    ENVIRONMENT: "test",
    DB: makeDb({
      projects: new Map([
        [PROJECT, makeProjectRow(PROJECT, USER)],
        [OTHER_PROJECT, makeProjectRow(OTHER_PROJECT, OTHER)],
      ]),
      sources,
      checks,
    }),
  };
  if (inspector) env.INSPECTOR = inspector;
  if (token) env.INTERNAL_CALLBACK_TOKEN = token;
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

const RUN_PATH = `/workspace/projects/${PROJECT}/visual-checks/run`;

// ─── POST .../visual-checks/run — ownership ───────────────────────────────────

test("run: unknown project → 404 project_not_found", async () => {
  const env = makeEnv();
  const r = await req(env, "POST", `/workspace/projects/proj_nope/visual-checks/run`, { userKey: USER });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "project_not_found");
});

test("run: wrong userKey → 403 forbidden; missing userKey → 400", async () => {
  const env = makeEnv();
  const r = await req(env, "POST", RUN_PATH, { userKey: OTHER });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "forbidden");

  const missing = await req(env, "POST", RUN_PATH, {});
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, "userKey_required");
});

// ─── target resolution (SECURITY: registered website sources only) ───────────

test("run: project with no website source → 400 website_source_required", async () => {
  const env = makeEnv({ sources: [makeSource({ type: "github_repo", reference: "owner/repo" })] });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, targetUrl: "https://golf-now.example.app/" });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "website_source_required");
});

test("run: sourceId of wrong type → 400 invalid_source", async () => {
  const env = makeEnv({ sources: [makeSource({ id: "psrc_gh", type: "github_repo", reference: "owner/repo" })] });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, sourceId: "psrc_gh" });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "invalid_source");
});

test("run: sourceId belonging to another project/user → 400 invalid_source", async () => {
  const env = makeEnv({
    sources: [
      makeSource(),
      makeSource({ id: "psrc_foreign", project_id: OTHER_PROJECT, user_key: OTHER }),
    ],
  });
  const wrongProject = await req(env, "POST", RUN_PATH, { userKey: USER, sourceId: "psrc_foreign" });
  assert.equal(wrongProject.status, 400);
  assert.equal(wrongProject.json.error, "invalid_source");

  const unknown = await req(env, "POST", RUN_PATH, { userKey: USER, sourceId: "psrc_nope" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error, "invalid_source");
});

test("run: malformed / non-http targetUrl → 400 invalid_target_url", async () => {
  const env = makeEnv();
  for (const bad of ["not a url", "ftp://golf-now.example.app/", "javascript:alert(1)"]) {
    const r = await req(env, "POST", RUN_PATH, { userKey: USER, targetUrl: bad });
    assert.equal(r.status, 400, `expected 400 for ${bad}`);
    assert.equal(r.json.error, "invalid_target_url");
  }
});

test("run: targetUrl not matching any registered website source → 400 target_url_not_registered", async () => {
  const env = makeEnv();
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, targetUrl: "https://evil.example.com/" });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "target_url_not_registered");
});

test("run: targetUrl on a registered origin (subpath) is accepted", async () => {
  const env = makeEnv();
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, targetUrl: "https://golf-now.example.app/courses" });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.check.targetUrl, "https://golf-now.example.app/courses");
});

test("run: intent over 1000 chars → 400 invalid_intent; default Korean intent when absent", async () => {
  const env = makeEnv();
  const tooLong = await req(env, "POST", RUN_PATH, { userKey: USER, intent: "x".repeat(1001) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.error, "invalid_intent");

  const ok = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(ok.status, 202);
  assert.match(ok.json.check.intent, /핵심 기능/);
});

// ─── queue row + dispatch ─────────────────────────────────────────────────────

test("run: INSPECTOR absent → row created then FAIL-FAST (dispatched:false, retry not wedged)", async () => {
  const env = makeEnv(); // no inspector binding
  const r = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.dispatched, false);
  assert.equal(r.json.note, "inspector_unavailable");
  // Stage 263.1 (live finding): undispatched rows are failed immediately —
  // nothing consumes 'queued' later, and a queued row wedges the 409 guard.
  assert.equal(r.json.check.status, "failed");
  assert.equal(r.json.check.executor, "container");

  const row = env.DB._checks.find((c) => c.id === r.json.check.id);
  assert.ok(row, "row must be persisted");
  assert.equal(row.status, "failed");
  assert.equal(row.executor, "container");

  // and the user can retry immediately (no run_already_active wedge)
  const retry = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(retry.status, 202);
});

test("run: INSPECTOR bound but callback token missing → row created + dispatched:false", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ inspector: makeInspector(recorder), token: null });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.dispatched, false);
  assert.equal(r.json.note, "callback_token_missing");
  assert.equal(recorder.calls.length, 0, "must not dispatch without the callback token");
  assert.equal(env.DB._checks.length, 1);
  assert.equal(env.DB._checks[0].status, "failed"); // fail-fast, no wedge
});

test("run: INSPECTOR present → dispatched:true, DO named vc-<runId>, payload carries job contract", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ inspector: makeInspector(recorder) });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, intent: "골퍼가 코스 상태를 확인할 수 있어야 한다" });
  assert.equal(r.status, 202);
  assert.equal(r.json.dispatched, true);

  const runId = r.json.check.id;
  assert.deepEqual(recorder.names, [`vc-${runId}`]);
  assert.equal(recorder.calls.length, 1);
  const payload = recorder.calls[0].body;
  assert.equal(payload.runId, runId);
  assert.equal(payload.projectId, PROJECT);
  assert.equal(payload.userKey, USER);
  assert.equal(payload.targetUrl, "https://golf-now.example.app/");
  assert.equal(payload.intent, "골퍼가 코스 상태를 확인할 수 있어야 한다");
  assert.equal(payload.callbackToken, TOKEN);
  assert.match(payload.callbackUrl, /\/internal\/visual-check-done$/);
  assert.match(payload.runningUrl, /\/internal\/visual-check-running$/);
  assert.ok(payload.baseUrl.startsWith("http"), "baseUrl for evidence uploads");
  assert.equal(payload.locale, "ko", "no locale in the request → ko");
});

// The report prose is written by the inspector at run time and stored as-is,
// so the reader's language must ride along with the dispatch. Before this was
// plumbed, an EN reader's report always came back Korean: the container's
// runInspection() defaulted locale to "ko" and the dashboard only ever renders
// the stored report_json.
test("run: locale rides the dispatch payload so the report is written in the reader's language", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ inspector: makeInspector(recorder) });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, locale: "en" });
  assert.equal(r.status, 202);
  assert.equal(recorder.calls[0].body.locale, "en");
});

test("run: an unrecognized locale falls back to ko rather than reaching the container", async () => {
  for (const locale of ["fr", "", 42, null, { evil: true }]) {
    const recorder = { names: [], calls: [] };
    const env = makeEnv({ inspector: makeInspector(recorder) });
    const r = await req(env, "POST", RUN_PATH, { userKey: USER, locale });
    assert.equal(r.status, 202, `locale ${JSON.stringify(locale)} must not break the run`);
    assert.equal(recorder.calls[0].body.locale, "ko", `locale ${JSON.stringify(locale)} → ko`);
  }
});

test("run: container dispatch failure → row failed immediately, dispatched:false with note", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ inspector: makeInspector(recorder, { status: 500 }) });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(r.status, 202);
  assert.equal(r.json.dispatched, false);
  assert.match(r.json.note, /container returned 500/);
  assert.equal(env.DB._checks[0].status, "failed"); // fail-fast (Stage 263.1)
  assert.equal(r.json.check.status, "failed");
});

test("run: concurrency guard — active queued|running run → 409 run_already_active", async () => {
  // Successful dispatch (inspector present) keeps the row queued → guard active.
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ inspector: makeInspector(recorder) });
  const first = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(first.status, 202);

  const second = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, "run_already_active");
  assert.equal(second.json.activeRunId, first.json.check.id);

  // running (not just queued) also blocks
  env.DB._checks[0].status = "running";
  const third = await req(env, "POST", RUN_PATH, { userKey: USER });
  assert.equal(third.status, 409);
});

test("run: sourceId happy path uses the source's own URL", async () => {
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ inspector: makeInspector(recorder) });
  const r = await req(env, "POST", RUN_PATH, { userKey: USER, sourceId: "psrc_web1" });
  assert.equal(r.status, 202);
  assert.equal(r.json.check.targetUrl, "https://golf-now.example.app/");
  assert.equal(r.json.dispatched, true);
});

// ─── /internal/visual-check-running ───────────────────────────────────────────

test("internal running: 503 when token unset, 401 on wrong bearer", async () => {
  const noToken = makeEnv({ token: null });
  const disabled = await req(noToken, "POST", "/internal/visual-check-running", { runId: "x" });
  assert.equal(disabled.status, 503);

  const env = makeEnv();
  const wrong = await req(env, "POST", "/internal/visual-check-running", { runId: "x" }, { authorization: "Bearer nope" });
  assert.equal(wrong.status, 401);
  const missing = await req(env, "POST", "/internal/visual-check-running", { runId: "x" });
  assert.equal(missing.status, 401);
});

test("internal running: queued → running; unknown runId 404", async () => {
  const env = makeEnv({ inspector: makeInspector({ names: [], calls: [] }) }); // dispatched → stays queued
  const created = await req(env, "POST", RUN_PATH, { userKey: USER });
  const runId = created.json.check.id;

  const r = await req(env, "POST", "/internal/visual-check-running", { runId }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(r.status, 200);
  assert.equal(r.json.transitioned, true);
  assert.equal(env.DB._checks[0].status, "running");

  const unknown = await req(env, "POST", "/internal/visual-check-running", { runId: "wvc_nope" }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(unknown.status, 404);
});

// ─── /internal/visual-check-done ──────────────────────────────────────────────

test("internal done: 503 when token unset, 401 on missing/wrong bearer", async () => {
  const noToken = makeEnv({ token: null });
  const disabled = await req(noToken, "POST", "/internal/visual-check-done", { runId: "x", ok: true });
  assert.equal(disabled.status, 503);

  const env = makeEnv();
  const wrong = await req(env, "POST", "/internal/visual-check-done", { runId: "x", ok: true }, { authorization: "Bearer nope" });
  assert.equal(wrong.status, 401);
  const missing = await req(env, "POST", "/internal/visual-check-done", { runId: "x", ok: true });
  assert.equal(missing.status, 401);
});

test("internal done: ok:true updates row (status/decision/works/report/prompt)", async () => {
  const env = makeEnv();
  const created = await req(env, "POST", RUN_PATH, { userKey: USER });
  const runId = created.json.check.id;

  const report = { title: "Simsa 검수 리포트", verdict: "작동 안 해요 — 고쳐야 해요", works: false, findings: [] };
  const r = await req(
    env, "POST", "/internal/visual-check-done",
    { runId, ok: true, decision: "Needs Fix", works: false, report, agentPrompt: "당신은 이 프로젝트의 코드를 수정하는 개발 에이전트입니다." },
    { authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "done");

  const row = env.DB._checks[0];
  assert.equal(row.status, "done");
  assert.equal(row.decision, "Needs Fix");
  assert.equal(row.works, 0);
  assert.deepEqual(JSON.parse(row.report_json), report);
  assert.match(row.agent_prompt, /개발 에이전트/);
});

test("internal done: ok:false stores truncated error → status failed", async () => {
  const env = makeEnv({ inspector: makeInspector({ names: [], calls: [] }) }); // dispatched → stays queued
  const created = await req(env, "POST", RUN_PATH, { userKey: USER });
  const runId = created.json.check.id;

  const r = await req(
    env, "POST", "/internal/visual-check-done",
    { runId, ok: false, error: "inspection timed out after 240s " + "x".repeat(600) },
    { authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "failed");

  const row = env.DB._checks[0];
  assert.equal(row.status, "failed");
  assert.equal(row.decision, "Not Verified");
  const stored = JSON.parse(row.report_json);
  assert.match(stored.error, /inspection timed out/);
  assert.ok(stored.error.length <= 500, "error must be truncated");
});

test("internal done: unknown runId → 404; missing ok flag → 400", async () => {
  const env = makeEnv();
  const unknown = await req(env, "POST", "/internal/visual-check-done", { runId: "wvc_nope", ok: true }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(unknown.status, 404);

  const invalid = await req(env, "POST", "/internal/visual-check-done", { runId: "wvc_x" }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(invalid.status, 400);
});

// ─── stuck sweep ──────────────────────────────────────────────────────────────

test("stuck sweep: queued run older than 30 min → failed; fresh run untouched", async () => {
  const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const checks = [
    {
      id: "wvc_old", project_id: PROJECT, user_key: USER, target_url: "https://golf-now.example.app/",
      intent: "i", decision: "Not Judged", works: null, status: "queued", executor: "container",
      report_json: "{}", agent_prompt: null, evidence_keys_json: "[]", created_at: old, updated_at: old,
    },
    {
      id: "wvc_running_old", project_id: OTHER_PROJECT, user_key: OTHER, target_url: "https://x.example/",
      intent: "i", decision: "Not Judged", works: null, status: "running", executor: "container",
      report_json: "{}", agent_prompt: null, evidence_keys_json: "[]", created_at: old, updated_at: old,
    },
    {
      id: "wvc_fresh", project_id: PROJECT, user_key: USER, target_url: "https://golf-now.example.app/",
      intent: "i", decision: "Not Judged", works: null, status: "queued", executor: "container",
      report_json: "{}", agent_prompt: null, evidence_keys_json: "[]", created_at: fresh, updated_at: fresh,
    },
  ];
  const env = makeEnv({ checks });

  const result = await cleanupStuckVisualChecks(env);
  assert.equal(result.swept, 2);
  assert.equal(result.errors, 0);

  assert.equal(checks[0].status, "failed");
  assert.match(JSON.parse(checks[0].report_json).error, /30 minutes/);
  assert.equal(checks[1].status, "failed");
  assert.equal(checks[2].status, "queued", "fresh run must not be swept");
});

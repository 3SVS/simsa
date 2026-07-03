/**
 * workspace-pr-run-detail.test.mjs
 *
 * Stage 35: PR review run detail endpoints.
 *
 * Tests:
 *  1.  GET /workspace/projects/:id/github/review/runs/:runId: userKey missing → 400
 *  2.  GET /workspace/projects/:id/github/review/runs/:runId: unknown runId → 404
 *  3.  GET /workspace/projects/:id/github/review/runs/:runId: wrong project → 404
 *  4.  GET /workspace/projects/:id/github/review/runs/:runId: returns full detail
 *  5.  GET /workspace/projects/:id/github/review/runs/:runId: parses summary from resultJson
 *  6.  GET /workspace/projects/:id/github/review/runs/:runId: parses results array from resultJson
 *  7.  GET /workspace/projects/:id/github/review/runs/:runId: malformed resultJson → empty results (safe fallback)
 *  8.  GET /workspace/projects/:id/github/review/runs/:runId: selectedItemCount from selectedItemIds
 *  9.  GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId: returns run for matching PR
 * 10.  GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId: rejects mismatched prNumber → 404
 * 11.  GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId: userKey missing → 400
 * 12.  GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId: invalid prNumber → 400
 * 13.  GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId: no repo → 404
 * 14.  getReviewRunById DB helper: returns null for unknown id
 * 15.  getReviewRunById DB helper: returns run for known id
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { getReviewRunById } = await import("../dist/workspace/pr-review-db.js");
const { createApp } = await import("../dist/router.js");

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeMockDb(runs = [], repos = []) {
  return {
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          // Ownership hardening: every project id resolves to a row owned
          // by this file's route-test userKey.
          if (/FROM workspace_projects/.test(sql)) {
            const [pid] = bound;
            return { id: pid, user_key: "uk1", title: "T", idea: "",
              understood_json: null, product_spec_json: "{}", items_json: "[]",
              created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
          }
          // getReviewRunById: WHERE id = ?
          if (/FROM workspace_pr_review_runs\s+WHERE id = /.test(sql)) {
            const [id] = bound;
            return runs.find((r) => r.id === id) ?? null;
          }
          // getProjectRepo: WHERE project_id = ?
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            return repos.find((r) => r.project_id === pid) ?? null;
          }
          return null;
        },
        async run()  { return { meta: { changes: 1 } }; },
        async all()  { return { results: [] }; },
      };
    },
  };
}

function makeRun(overrides = {}) {
  const now = new Date().toISOString();
  const resultJson = JSON.stringify({
    summary: { passed: 2, failed: 1, inconclusive: 0, needsDecision: 0 },
    results: [
      { itemId: "req_001", title: "Feature A", status: "passed", userLabel: "통과", reason: "ok", evidence: ["line 42"], nextAction: "" },
      { itemId: "req_002", title: "Feature B", status: "passed", userLabel: "통과", reason: "ok", evidence: [], nextAction: "" },
      { itemId: "req_003", title: "Feature C", status: "failed", userLabel: "안 맞음", reason: "missing impl", evidence: [], nextAction: "Add handler" },
    ],
  });
  return {
    id: "wprr_test01",
    project_id: "proj1",
    user_key: "uk1",
    repo_full_name: "owner/repo",
    pr_number: 42,
    linked_pr_id: null,
    selected_item_ids_json: '["req_001","req_002","req_003"]',
    status: "failed",
    result_json: resultJson,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeRepo(projectId = "proj1") {
  return {
    id: "wpr_1",
    project_id: projectId,
    user_key: "uk1",
    github_connection_id: "wgc1",
    repo_id: "123",
    repo_full_name: "owner/repo",
    repo_owner: "owner",
    repo_name: "repo",
    default_branch: "main",
    private: 0,
    html_url: "https://github.com/owner/repo",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeEnv(runs = [], repos = []) {
  return {
    DB: makeMockDb(runs, repos),
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: null,
  };
}

async function get(app, env, path) {
  return app.fetch(new Request(`https://example.com${path}`), env);
}

// ─── Project-level endpoint ───────────────────────────────────────────────────

describe("GET /workspace/projects/:id/github/review/runs/:runId", () => {
  it("1 — userKey missing returns 400", async () => {
    const app = createApp();
    const res = await get(app, makeEnv(), "/workspace/projects/proj1/github/review/runs/wprr_test01");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "userKey_required");
  });

  it("2 — unknown runId returns 404", async () => {
    const app = createApp();
    const res = await get(app, makeEnv([], []), "/workspace/projects/proj1/github/review/runs/wprr_unknown?userKey=uk1");
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "run_not_found");
  });

  it("3 — run from wrong project returns 404", async () => {
    const run = makeRun({ project_id: "proj_other" });
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "run_not_found");
  });

  it("4 — returns full run detail", async () => {
    const run = makeRun();
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.projectId, "proj1");
    assert.equal(body.repoFullName, "owner/repo");
    assert.equal(body.prNumber, 42);
    assert.equal(body.run.id, "wprr_test01");
    assert.equal(body.run.status, "failed");
  });

  it("5 — parses summary from resultJson", async () => {
    const run = makeRun();
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/review/runs/wprr_test01?userKey=uk1");
    const body = await res.json();
    assert.equal(body.run.summary.passed, 2);
    assert.equal(body.run.summary.failed, 1);
    assert.equal(body.run.summary.inconclusive, 0);
    assert.equal(body.run.summary.needsDecision, 0);
  });

  it("6 — parses results array from resultJson", async () => {
    const run = makeRun();
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/review/runs/wprr_test01?userKey=uk1");
    const body = await res.json();
    assert.ok(Array.isArray(body.run.results));
    assert.equal(body.run.results.length, 3);
    const failed = body.run.results.find((r) => r.status === "failed");
    assert.equal(failed.itemId, "req_003");
    assert.equal(failed.nextAction, "Add handler");
  });

  it("7 — malformed resultJson returns empty results (safe fallback)", async () => {
    const run = makeRun({ result_json: "not valid json {{{" });
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.deepEqual(body.run.results, []);
    assert.equal(body.run.summary.passed, 0);
  });

  it("8 — selectedItemCount matches selectedItemIds length", async () => {
    const run = makeRun({ selected_item_ids_json: '["a","b","c","d"]' });
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/review/runs/wprr_test01?userKey=uk1");
    const body = await res.json();
    assert.equal(body.run.selectedItemCount, 4);
    assert.deepEqual(body.run.selectedItemIds, ["a", "b", "c", "d"]);
  });
});

// ─── PR-scoped endpoint ───────────────────────────────────────────────────────

describe("GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId", () => {
  it("9 — returns run for matching PR", async () => {
    const run = makeRun();
    const app = createApp();
    const res = await get(app, makeEnv([run], [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.run.id, "wprr_test01");
    assert.equal(body.prNumber, 42);
  });

  it("10 — rejects run from mismatched prNumber → 404", async () => {
    const run = makeRun({ pr_number: 42 });
    const app = createApp();
    // Query PR 99 but run belongs to PR 42
    const res = await get(app, makeEnv([run], [makeRepo()]), "/workspace/projects/proj1/github/pulls/99/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "run_not_found");
  });

  it("11 — userKey missing returns 400", async () => {
    const app = createApp();
    const res = await get(app, makeEnv(), "/workspace/projects/proj1/github/pulls/42/review/runs/wprr_test01");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "userKey_required");
  });

  it("12 — invalid prNumber returns 400", async () => {
    const app = createApp();
    const res = await get(app, makeEnv(), "/workspace/projects/proj1/github/pulls/nope/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_pr_number");
  });

  it("13 — no repo linked returns 404", async () => {
    const run = makeRun();
    const app = createApp();
    const res = await get(app, makeEnv([run], []), "/workspace/projects/proj1/github/pulls/42/review/runs/wprr_test01?userKey=uk1");
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "no_repo_linked");
  });
});

// ─── DB helper unit tests ─────────────────────────────────────────────────────

describe("getReviewRunById DB helper", () => {
  it("14 — returns null for unknown id", async () => {
    const env = makeEnv([]);
    const result = await getReviewRunById(env, "wprr_missing");
    assert.equal(result, null);
  });

  it("15 — returns run for known id", async () => {
    const run = makeRun();
    const env = makeEnv([run]);
    const result = await getReviewRunById(env, "wprr_test01");
    assert.ok(result);
    assert.equal(result.id, "wprr_test01");
    assert.equal(result.projectId, "proj1");
    assert.equal(result.prNumber, 42);
    assert.deepEqual(result.selectedItemIds, ["req_001", "req_002", "req_003"]);
  });
});

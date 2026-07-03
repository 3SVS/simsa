/**
 * workspace-pr-review-history.test.mjs
 *
 * Stage 34: PR review run history endpoints.
 *
 * Tests:
 *  1.  GET /workspace/projects/:id/github/pulls/:number/review/history: userKey missing → 400
 *  2.  GET /workspace/projects/:id/github/pulls/:number/review/history: invalid prNumber → 400
 *  3.  GET /workspace/projects/:id/github/pulls/:number/review/history: no repo → empty runs []
 *  4.  GET /workspace/projects/:id/github/pulls/:number/review/history: returns all runs for PR
 *  5.  GET /workspace/projects/:id/github/pulls/:number/review/history: runs ordered newest first
 *  6.  GET /workspace/projects/:id/github/pulls/:number/review/history: limit param respected
 *  7.  GET /workspace/projects/:id/github/pulls/:number/review/history: includes summary from resultJson
 *  8.  GET /workspace/projects/:id/github/pulls/:number/review/history: includes results from resultJson
 *  9.  GET /workspace/projects/:id/github/pulls/:number/review/history: error run included (no filter)
 * 10.  GET /workspace/projects/:id/github/review-history: userKey missing → 400
 * 11.  GET /workspace/projects/:id/github/review-history: returns all runs for project
 * 12.  GET /workspace/projects/:id/github/review-history: groups runs from multiple PRs
 * 13.  GET /workspace/projects/:id/github/review-history: selectedItemCount included (not results)
 * 14.  GET /workspace/projects/:id/github/review-history: limit param respected
 * 15.  listPRReviewRuns DB helper: returns correct rows
 * 16.  listProjectReviewRuns DB helper: returns rows across PRs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { listPRReviewRuns, listProjectReviewRuns } = await import("../dist/workspace/pr-review-db.js");
const { createApp } = await import("../dist/router.js");

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeMockDb(reviewRuns = [], repos = []) {
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
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            return repos.find((r) => r.project_id === pid) ?? null;
          }
          return null;
        },
        async run() { return { meta: { changes: 1 } }; },
        async all() {
          // listPRReviewRuns: WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
          if (/FROM workspace_pr_review_runs/.test(sql) && /AND repo_full_name/.test(sql) && /AND pr_number/.test(sql)) {
            const [pid, rfn, pnum, lim] = bound;
            const filtered = reviewRuns
              .filter((r) => r.project_id === pid && r.repo_full_name === rfn && r.pr_number === pnum)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, lim ?? 20);
            return { results: filtered };
          }
          // listProjectReviewRuns: WHERE project_id = ?
          if (/FROM workspace_pr_review_runs/.test(sql) && /WHERE project_id/.test(sql)) {
            const [pid, lim] = bound;
            const filtered = reviewRuns
              .filter((r) => r.project_id === pid)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, lim ?? 50);
            return { results: filtered };
          }
          return { results: [] };
        },
      };
    },
  };
}

function makeRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: `wprr_${Math.random().toString(36).slice(2, 8)}`,
    project_id: "proj1",
    user_key: "uk1",
    repo_full_name: "owner/repo",
    pr_number: 42,
    linked_pr_id: null,
    selected_item_ids_json: '["req_001","req_002"]',
    status: "passed",
    result_json: JSON.stringify({
      summary: { passed: 2, failed: 0, inconclusive: 0, needsDecision: 0 },
      results: [
        { itemId: "req_001", title: "Feature A", status: "passed", reason: "ok", evidence: [] },
        { itemId: "req_002", title: "Feature B", status: "passed", reason: "ok", evidence: [] },
      ],
    }),
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

function makeEnv(reviewRuns = [], repos = []) {
  return {
    DB: makeMockDb(reviewRuns, repos),
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: null,
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get(app, env, path) {
  const req = new Request(`https://example.com${path}`);
  return app.fetch(req, env);
}

// ─── Route tests ──────────────────────────────────────────────────────────────

describe("GET /workspace/projects/:id/github/pulls/:number/review/history", () => {
  it("1 — userKey missing returns 400", async () => {
    const app = createApp();
    const res = await get(app, makeEnv(), "/workspace/projects/proj1/github/pulls/42/review/history");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "userKey_required");
  });

  it("2 — invalid prNumber returns 400", async () => {
    const app = createApp();
    const res = await get(app, makeEnv(), "/workspace/projects/proj1/github/pulls/abc/review/history?userKey=uk1");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid_pr_number");
  });

  it("3 — no repo linked returns empty runs", async () => {
    const app = createApp();
    const res = await get(app, makeEnv([], []), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.deepEqual(body.runs, []);
  });

  it("4 — returns all runs for the PR", async () => {
    const runs = [
      makeRun({ id: "wprr_a1", project_id: "proj1", pr_number: 42, created_at: "2026-06-01T10:00:00Z" }),
      makeRun({ id: "wprr_a2", project_id: "proj1", pr_number: 42, created_at: "2026-06-02T10:00:00Z" }),
      makeRun({ id: "wprr_b1", project_id: "proj1", pr_number: 99, created_at: "2026-06-03T10:00:00Z" }), // different PR
    ];
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.runs.length, 2);
    assert.ok(body.runs.every((r) => r.prNumber === 42));
  });

  it("5 — runs ordered newest first (by createdAt)", async () => {
    const runs = [
      makeRun({ id: "wprr_old", project_id: "proj1", pr_number: 42, created_at: "2026-06-01T00:00:00Z" }),
      makeRun({ id: "wprr_new", project_id: "proj1", pr_number: 42, created_at: "2026-06-02T00:00:00Z" }),
    ];
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1");
    const body = await res.json();
    assert.equal(body.runs[0].id, "wprr_new");
    assert.equal(body.runs[1].id, "wprr_old");
  });

  it("6 — limit param is respected", async () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun({ id: `wprr_${i}`, project_id: "proj1", pr_number: 42, created_at: `2026-06-0${i + 1}T00:00:00Z` }),
    );
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1&limit=2");
    const body = await res.json();
    assert.equal(body.runs.length, 2);
  });

  it("7 — includes parsed summary from resultJson", async () => {
    const run = makeRun({ project_id: "proj1", pr_number: 42 });
    const app = createApp();
    const res = await get(app, makeEnv([run], [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1");
    const body = await res.json();
    assert.ok(body.runs[0].summary);
    assert.equal(body.runs[0].summary.passed, 2);
  });

  it("8 — includes full results array from resultJson", async () => {
    const run = makeRun({ project_id: "proj1", pr_number: 42 });
    const app = createApp();
    const res = await get(app, makeEnv([run], [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1");
    const body = await res.json();
    assert.ok(Array.isArray(body.runs[0].results));
    assert.equal(body.runs[0].results.length, 2);
  });

  it("9 — error-status runs are included (no status filter)", async () => {
    const runs = [
      makeRun({ id: "wprr_err", project_id: "proj1", pr_number: 42, status: "error", result_json: null, error_message: "timeout" }),
      makeRun({ id: "wprr_ok", project_id: "proj1", pr_number: 42, status: "passed" }),
    ];
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/pulls/42/review/history?userKey=uk1");
    const body = await res.json();
    assert.equal(body.runs.length, 2);
    const err = body.runs.find((r) => r.id === "wprr_err");
    assert.equal(err.status, "error");
    assert.equal(err.errorMessage, "timeout");
  });
});

describe("GET /workspace/projects/:id/github/review-history", () => {
  it("10 — userKey missing returns 400", async () => {
    const app = createApp();
    const res = await get(app, makeEnv(), "/workspace/projects/proj1/github/review-history");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "userKey_required");
  });

  it("11 — returns all runs for the project", async () => {
    const runs = [
      makeRun({ id: "wprr_1", project_id: "proj1", pr_number: 10 }),
      makeRun({ id: "wprr_2", project_id: "proj1", pr_number: 20 }),
      makeRun({ id: "wprr_3", project_id: "proj2", pr_number: 10 }), // different project
    ];
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.runs.length, 2);
  });

  it("12 — groups runs from multiple PRs within project", async () => {
    const runs = [
      makeRun({ id: "wprr_pr10", project_id: "proj1", pr_number: 10, created_at: "2026-06-01T00:00:00Z" }),
      makeRun({ id: "wprr_pr20", project_id: "proj1", pr_number: 20, created_at: "2026-06-02T00:00:00Z" }),
      makeRun({ id: "wprr_pr10b", project_id: "proj1", pr_number: 10, created_at: "2026-06-03T00:00:00Z" }),
    ];
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    const body = await res.json();
    const prNums = body.runs.map((r) => r.prNumber);
    assert.ok(prNums.includes(10));
    assert.ok(prNums.includes(20));
    // newest first: pr10b (jun3), pr20 (jun2), pr10 (jun1)
    assert.equal(body.runs[0].id, "wprr_pr10b");
  });

  it("13 — selectedItemCount included, results not included", async () => {
    const run = makeRun({ project_id: "proj1", pr_number: 42 });
    const app = createApp();
    const res = await get(app, makeEnv([run], [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    const body = await res.json();
    const r = body.runs[0];
    assert.ok("selectedItemCount" in r, "selectedItemCount should be present");
    assert.equal(r.selectedItemCount, 2); // from selected_item_ids_json '["req_001","req_002"]'
    assert.ok(!("results" in r), "full results array should NOT be in project history");
  });

  it("14 — limit param respected", async () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun({ id: `wprr_${i}`, project_id: "proj1", pr_number: i + 1, created_at: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
    );
    const app = createApp();
    const res = await get(app, makeEnv(runs, [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1&limit=3");
    const body = await res.json();
    assert.equal(body.runs.length, 3);
  });

  // ── Stage 41: rerunAction (quick re-run) ──────────────────────────────────

  function mixedResultsRun(overrides = {}) {
    return makeRun({
      selected_item_ids_json: '["a","b","c","d"]',
      status: "failed",
      result_json: JSON.stringify({
        summary: { passed: 1, failed: 1, inconclusive: 1, needsDecision: 1 },
        results: [
          { itemId: "a", title: "A", status: "passed", reason: "ok" },
          { itemId: "b", title: "B", status: "failed", reason: "x" },
          { itemId: "c", title: "C", status: "inconclusive", reason: "x" },
          { itemId: "d", title: "D", status: "needs_decision", reason: "x" },
        ],
      }),
      ...overrides,
    });
  }

  it("14a — rerunAction exposes recommendedItemIds without full results", async () => {
    const app = createApp();
    const res = await get(app, makeEnv([mixedResultsRun()], [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    const r = (await res.json()).runs[0];
    assert.ok(r.rerunAction, "rerunAction present");
    assert.deepEqual(r.rerunAction.recommendedItemIds, ["b", "c", "d"]);
    assert.equal(r.rerunAction.recommendedItemCount, 3);
    assert.ok(!("results" in r), "full results array should NOT be in the list response");
    assert.equal(r.rerunAction.disabledReason, undefined);
  });

  it("14b — recommendedItemIds exclude passed items", async () => {
    const app = createApp();
    const res = await get(app, makeEnv([mixedResultsRun()], [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    const ids = (await res.json()).runs[0].rerunAction.recommendedItemIds;
    assert.ok(!ids.includes("a"));
  });

  it("14c — all-passed run disables quick re-run (no_remaining_issues)", async () => {
    // default makeRun() has two passed items
    const app = createApp();
    const res = await get(app, makeEnv([makeRun()], [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    const action = (await res.json()).runs[0].rerunAction;
    assert.equal(action.recommendedItemCount, 0);
    assert.deepEqual(action.recommendedItemIds, []);
    assert.equal(action.disabledReason, "no_remaining_issues");
  });

  it("14d — run without stored results → results_unavailable", async () => {
    const app = createApp();
    const noResults = makeRun({ status: "error", result_json: null, error_message: "boom" });
    const res = await get(app, makeEnv([noResults], [makeRepo()]), "/workspace/projects/proj1/github/review-history?userKey=uk1");
    const action = (await res.json()).runs[0].rerunAction;
    assert.equal(action.recommendedItemCount, 0);
    assert.equal(action.disabledReason, "results_unavailable");
  });
});

// ─── DB helper unit tests ─────────────────────────────────────────────────────

describe("listPRReviewRuns DB helper", () => {
  it("15 — returns matching rows for projectId + repo + prNumber", async () => {
    const runs = [
      makeRun({ id: "wprr_m1", project_id: "proj1", pr_number: 7, created_at: "2026-06-01T00:00:00Z" }),
      makeRun({ id: "wprr_m2", project_id: "proj1", pr_number: 7, created_at: "2026-06-02T00:00:00Z" }),
      makeRun({ id: "wprr_x", project_id: "proj1", pr_number: 99 }), // different PR
    ];
    const env = makeEnv(runs);
    const result = await listPRReviewRuns(env, "proj1", "owner/repo", 7);
    assert.equal(result.length, 2);
    // newest first
    assert.equal(result[0].id, "wprr_m2");
    assert.equal(result[1].id, "wprr_m1");
  });
});

describe("listProjectReviewRuns DB helper", () => {
  it("16 — returns all rows for project across PRs", async () => {
    const runs = [
      makeRun({ id: "wprr_a", project_id: "proj1", pr_number: 1 }),
      makeRun({ id: "wprr_b", project_id: "proj1", pr_number: 2 }),
      makeRun({ id: "wprr_c", project_id: "proj9", pr_number: 1 }), // different project
    ];
    const env = makeEnv(runs);
    const result = await listProjectReviewRuns(env, "proj1");
    assert.equal(result.length, 2);
    assert.ok(result.every((r) => r.projectId === "proj1"));
  });
});

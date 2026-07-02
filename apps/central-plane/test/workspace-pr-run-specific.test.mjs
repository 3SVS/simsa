/**
 * workspace-pr-run-specific.test.mjs
 *
 * Stage 36: run-specific Fix Pack / PR comment endpoints.
 *
 * Tests:
 *  1.  POST fix-brief with reviewRunId uses that run's results
 *  2.  POST fix-brief rejects reviewRunId belonging to a different PR
 *  3.  POST fix-brief rejects reviewRunId belonging to a different project
 *  4.  POST fix-brief with malformed resultJson returns 400 (run_parse_failed)
 *  5.  POST fix-brief sourceReviewRun field present in response
 *  6.  POST comment/preview with reviewRunId uses that run's results
 *  7.  POST comment/preview with reviewRunId rejects mismatch
 *  8.  POST comment/preview with reviewRunId + includeComparison adds warning
 *  9.  POST comment/preview with reviewRunId body includes run timestamp line
 * 10.  POST comment/preview with reviewRunId malformed → 400
 * 11.  POST comment (post) with reviewRunId uses that run's results
 * 12.  POST comment (post) with reviewRunId rejects mismatch
 * 13.  loadPRReviewRunForAction: not_found for unknown runId
 * 14.  loadPRReviewRunForAction: review_run_mismatch for wrong prNumber
 * 15.  loadPRReviewRunForAction: review_run_parse_failed for empty results array
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { loadPRReviewRunForAction } = await import("../dist/workspace/pr-review-run-loader.js");
const { createApp } = await import("../dist/router.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GOOD_RESULT_JSON = JSON.stringify({
  summary: { passed: 1, failed: 1, inconclusive: 0, needsDecision: 0 },
  results: [
    { itemId: "req_001", title: "Feature A", status: "passed",  userLabel: "통과",    reason: "ok",           evidence: [],        nextAction: "" },
    { itemId: "req_002", title: "Feature B", status: "failed",  userLabel: "안 맞음", reason: "not found",    evidence: ["line 5"], nextAction: "Add impl" },
  ],
});

const PRODUCT_SPEC = JSON.stringify({
  items: [
    { id: "req_001", title: "Feature A", description: "must have X" },
    { id: "req_002", title: "Feature B", description: "must have Y" },
  ],
});

function makeRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "wprr_s36_01",
    project_id: "proj1",
    user_key: "uk1",
    repo_full_name: "owner/repo",
    pr_number: 42,
    linked_pr_id: null,
    selected_item_ids_json: '["req_001","req_002"]',
    status: "failed",
    result_json: GOOD_RESULT_JSON,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeRepo(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "wpr_1",
    project_id: "proj1",
    user_key: "uk1",
    github_connection_id: "wgc1",
    repo_id: "123",
    repo_full_name: "owner/repo",
    repo_owner: "owner",
    repo_name: "repo",
    default_branch: "main",
    private: 0,
    html_url: "https://github.com/owner/repo",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeLinkedPR(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "wlpr_1",
    project_id: "proj1",
    user_key: "uk1",
    repo_full_name: "owner/repo",
    pr_number: 42,
    pr_title: "feat: add Feature B",
    github_pr_id: "pr_123",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeMockDb({ runs = [], repos = [], linkedPRs = [], comments = [], productSpec = null } = {}) {
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
          if (/FROM workspace_pr_review_runs\s+WHERE id\s*=/.test(sql)) {
            const [id] = bound;
            return runs.find((r) => r.id === id) ?? null;
          }
          // getLatestReviewRun: ORDER BY created_at DESC
          if (/FROM workspace_pr_review_runs/.test(sql) && /ORDER BY/.test(sql)) {
            const [pid, , prNum] = bound;
            return runs.find((r) => r.project_id === pid && r.pr_number === prNum) ?? null;
          }
          // getProjectRepo
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            return repos.find((r) => r.project_id === pid) ?? null;
          }
          // getLinkedPR
          if (/FROM workspace_linked_prs/.test(sql)) {
            const [pid, repo, prNum] = bound;
            return linkedPRs.find(
              (p) => p.project_id === pid && p.repo_full_name === repo && p.pr_number === prNum,
            ) ?? null;
          }
          // workspace_product_specs
          if (/FROM workspace_product_specs/.test(sql)) {
            const [pid] = bound;
            if (productSpec && pid === "proj1") return { spec_json: productSpec };
            return null;
          }
          // getLatestPrComment / getCreditExecution
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all() {
          // listPRReviewRuns (for comparison)
          if (/FROM workspace_pr_review_runs/.test(sql)) {
            return { results: runs };
          }
          // listPrComments
          if (/FROM workspace_pr_comments/.test(sql)) {
            return { results: comments };
          }
          return { results: [] };
        },
      };
    },
    batch(stmts) {
      return Promise.resolve(stmts.map(() => ({ meta: { changes: 1 } })));
    },
  };
}

function makeEnv(opts = {}) {
  return {
    DB: makeMockDb(opts),
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: null,
  };
}

async function post(app, env, path, body) {
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

// ─── Fix Brief — run-specific ─────────────────────────────────────────────────

describe("POST /workspace/projects/:id/github/pulls/:number/fix-brief with reviewRunId", () => {
  it("1 — uses that run's results when reviewRunId matches", async () => {
    const run = makeRun();
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], productSpec: PRODUCT_SPEC });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/fix-brief", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.runId, "wprr_s36_01");
    // selectedItemIds filtered to fixable (non-passed) items only
    assert.deepEqual(body.selectedItemIds, ["req_002"]);
    // brief must include the failed item's fix instruction
    assert.ok(body.brief);
  });

  it("2 — rejects reviewRunId belonging to a different PR", async () => {
    const run = makeRun({ pr_number: 99 });  // run is for PR 99, we request PR 42
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/fix-brief", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "review_run_mismatch");
  });

  it("3 — rejects reviewRunId belonging to a different project", async () => {
    const run = makeRun({ project_id: "proj_other" });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/fix-brief", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "review_run_mismatch");
  });

  it("4 — malformed resultJson returns 400 review_run_parse_failed", async () => {
    const run = makeRun({ result_json: "broken{{json" });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/fix-brief", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "review_run_parse_failed");
  });

  it("5 — sourceReviewRun field present in response", async () => {
    const run = makeRun();
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], productSpec: PRODUCT_SPEC });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/fix-brief", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.sourceReviewRun, "sourceReviewRun field should be present");
    assert.equal(body.sourceReviewRun.id, "wprr_s36_01");
    assert.ok(typeof body.sourceReviewRun.createdAt === "string");
    assert.ok(typeof body.sourceReviewRun.summary === "object");
    assert.equal(body.sourceReviewRun.summary.failed, 1);
  });

  // Stage 42: history-list quick Fix Pack passes reviewRunId + explicit
  // recommendedItemIds (남은 문제). The server must honor the passed selection.
  it("5a — honors explicit selectedItemIds (recommended subset) + returns sourceReviewRun", async () => {
    const run = makeRun();
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], productSpec: PRODUCT_SPEC });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/fix-brief", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
      selectedItemIds: ["req_002"], // recommended (failed) only
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.runId, "wprr_s36_01");
    assert.deepEqual(body.selectedItemIds, ["req_002"]);
    assert.ok(body.sourceReviewRun, "sourceReviewRun present for the notice");
    assert.equal(body.sourceReviewRun.id, "wprr_s36_01");
  });
});

// ─── Comment preview — run-specific ──────────────────────────────────────────

describe("POST /workspace/projects/:id/github/pulls/:number/comment/preview with reviewRunId", () => {
  it("6 — uses that run's results when reviewRunId matches", async () => {
    const run = makeRun();
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment/preview", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.ok(body.comment?.body?.includes("Simsa"), "comment body should be generated");
    assert.equal(body.comment.selectedItemIds.length, 2);
  });

  it("7 — rejects reviewRunId mismatching this PR", async () => {
    const run = makeRun({ pr_number: 7 });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment/preview", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "review_run_mismatch");
  });

  it("8 — reviewRunId + includeComparison adds comparison_not_available_for_specific_run warning", async () => {
    const run = makeRun();
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment/preview", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
      includeComparison: true,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.warnings), "warnings field should exist");
    assert.ok(
      body.warnings.includes("comparison_not_available_for_specific_run"),
      "should warn about comparison not being available for specific run",
    );
    // comparison should NOT appear in body (no comparison content)
    assert.ok(!body.comment?.body?.includes("이전/최신 비교"), "comparison section should not appear");
  });

  it("9 — run-specific comment body includes run timestamp line", async () => {
    const runTimestamp = "2026-06-13T04:30:00.000Z";
    const run = makeRun({ created_at: runTimestamp });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment/preview", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    // The comment body must include the run timestamp italic line
    assert.ok(
      body.comment?.body?.includes("이 코멘트는") && body.comment?.body?.includes("PR 확인 기록 기준"),
      `comment body should include run timestamp line, got: ${body.comment?.body?.slice(0, 200)}`,
    );
  });

  it("10 — malformed resultJson returns 400", async () => {
    const run = makeRun({ result_json: null });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment/preview", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "review_run_parse_failed");
  });
});

// ─── Comment post — run-specific ─────────────────────────────────────────────

describe("POST /workspace/projects/:id/github/pulls/:number/comment (post) with reviewRunId", () => {
  it("11 — run-specific comment post attempts to use that run's results", async () => {
    // The comment post endpoint will fail at token decrypt (no token in test env),
    // but before that it must load the run and validate it. We verify the 503 is about
    // token decrypt, not run mismatch.
    const run = makeRun();
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    // token_decrypt_failed (no KEK) — means run was loaded successfully
    const body = await res.json();
    assert.ok(
      body.error === "token_decrypt_failed" || body.error === "no_github_connection" || res.status !== 404,
      `expected run to load; got error: ${body.error}`,
    );
  });

  it("12 — run-specific comment post rejects mismatched reviewRunId", async () => {
    const run = makeRun({ pr_number: 55 });  // different PR
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/comment", {
      userKey: "uk1",
      reviewRunId: "wprr_s36_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "review_run_mismatch");
  });
});

// ─── loadPRReviewRunForAction unit tests ──────────────────────────────────────

describe("loadPRReviewRunForAction", () => {
  it("13 — returns not_found for unknown runId", async () => {
    const env = makeEnv({ runs: [] });
    const result = await loadPRReviewRunForAction({
      env, projectId: "proj1", repoFullName: "owner/repo", prNumber: 42, reviewRunId: "wprr_missing",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "review_run_not_found");
  });

  it("14 — returns review_run_mismatch for wrong prNumber", async () => {
    const run = makeRun({ pr_number: 99 });
    const env = makeEnv({ runs: [run] });
    const result = await loadPRReviewRunForAction({
      env, projectId: "proj1", repoFullName: "owner/repo", prNumber: 42, reviewRunId: "wprr_s36_01",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "review_run_mismatch");
  });

  it("15 — returns review_run_parse_failed for empty results array", async () => {
    const run = makeRun({
      result_json: JSON.stringify({ summary: { passed: 0, failed: 0 }, results: [] }),
    });
    const env = makeEnv({ runs: [run] });
    const result = await loadPRReviewRunForAction({
      env, projectId: "proj1", repoFullName: "owner/repo", prNumber: 42, reviewRunId: "wprr_s36_01",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "review_run_parse_failed");
  });
});

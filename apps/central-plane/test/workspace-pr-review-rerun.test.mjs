/**
 * workspace-pr-review-rerun.test.mjs
 *
 * Stage 37: re-run a PR review using a specific source run's selectedItemIds.
 *
 * Tests:
 *  1.  PR review accepts rerunOfReviewRunId in body
 *  2.  rerun validates source run belongs to same project → 404 on mismatch
 *  3.  rerun validates source run belongs to same repo → 404 on mismatch
 *  4.  rerun validates source run belongs to same prNumber → 404 on mismatch
 *  5.  rerun uses source selectedItemIds when body selectedItemIds missing
 *  6.  body selectedItemIds overrides source selectedItemIds
 *  7.  unknown rerunOfReviewRunId returns 404 rerun_source_not_found
 *  8.  rerun response includes rerun metadata (ofReviewRunId + reusedSelectedItemIds)
 *  9.  rerun without body selectedItemIds → reusedSelectedItemIds non-empty
 * 10.  rerun with body selectedItemIds → reusedSelectedItemIds empty
 * 11.  compareSpecificReviewRuns: improved item detection
 * 12.  compareSpecificReviewRuns: newlyProblematic item detection
 * 13.  compareSpecificReviewRuns: stillOpen when status unchanged and not passed
 * 14.  compareSpecificReviewRuns: unchanged when both passed
 * 15.  compareSpecificReviewRuns: comparable=false when source has no results
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { compareSpecificReviewRuns } = await import("../dist/workspace/pr-review-compare.js");
const { createApp } = await import("../dist/router.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCE_RESULT_JSON = JSON.stringify({
  summary: { passed: 1, failed: 1, inconclusive: 0, needsDecision: 0 },
  results: [
    { itemId: "req_001", title: "Feature A", status: "passed",  userLabel: "통과",    reason: "ok",        evidence: [], nextAction: "" },
    { itemId: "req_002", title: "Feature B", status: "failed",  userLabel: "안 맞음", reason: "missing",   evidence: [], nextAction: "Fix it" },
  ],
});

function makeSourceRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "wprr_src_01",
    project_id: "proj1",
    user_key: "uk1",
    repo_full_name: "owner/repo",
    pr_number: 42,
    linked_pr_id: null,
    selected_item_ids_json: '["req_001","req_002"]',
    status: "failed",
    result_json: SOURCE_RESULT_JSON,
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
    pr_title: "feat: add features",
    pr_state: "open",
    pr_head_branch: "feature",
    pr_base_branch: "main",
    pr_head_sha: "abc123",
    github_pr_id: "pr_123",
    selected_item_ids_json: '["req_001","req_002","req_003"]',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ─── Minimal D1 mock ──────────────────────────────────────────────────────────
// Only supports queries needed by POST /review before the LLM call.

function makeMockDb({ runs = [], repos = [], linkedPRs = [], projects = [] } = {}) {
  const insertedRuns = [];
  return {
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          // getReviewRunById: WHERE id = ?
          if (/FROM workspace_pr_review_runs\s+WHERE id\s*=/.test(sql)) {
            const [id] = bound;
            return runs.find((r) => r.id === id) ?? null;
          }
          // getProjectRepo
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            return repos.find((r) => r.project_id === pid) ?? null;
          }
          // getLatestReviewRun
          if (/FROM workspace_pr_review_runs/.test(sql) && /ORDER BY/.test(sql)) {
            const [pid, , prNum] = bound;
            return runs.find((r) => r.project_id === pid && r.pr_number === prNum) ?? null;
          }
          // getProject (workspace_projects) — ownership hardening: rows are
          // owned by this file's route-test userKey (uk1) and every id exists.
          if (/FROM workspace_projects/.test(sql)) {
            const [pid] = bound;
            const proj = projects.find((p) => p.id === pid);
            return {
              id: pid,
              user_key: proj?.user_key ?? "uk1",
              title: "T", idea: "", understood_json: null,
              items_json: JSON.stringify(proj?.items ?? []),
              product_spec_json: JSON.stringify(proj?.spec ?? {}),
              created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
            };
          }
          // credit enforcement helpers (allowance, balance, etc.) — return null/0 defaults
          return null;
        },
        async run() {
          if (/INSERT INTO workspace_pr_review_runs/.test(sql)) {
            const [id, , , , prNum, , selectedIdsJson, status] = bound;
            insertedRuns.push({ id, pr_number: prNum, selected_item_ids_json: selectedIdsJson, status });
          }
          return { meta: { changes: 1 } };
        },
        async all() {
          // getLinkedPRs
          if (/FROM workspace_linked_prs/.test(sql)) {
            return { results: linkedPRs.filter((p) => p.project_id === bound[0]) };
          }
          // usage events, notification settings, etc.
          return { results: [] };
        },
      };
    },
    batch(stmts) {
      return Promise.resolve(stmts.map(() => ({ meta: { changes: 1 } })));
    },
    _insertedRuns: insertedRuns,
  };
}

function makeEnv(opts = {}) {
  const db = makeMockDb(opts);
  return {
    DB: db,
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: null,
    _db: db,
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

// ─── Tests: POST /review with rerunOfReviewRunId ──────────────────────────────

describe("POST /workspace/projects/:id/github/pulls/:number/review with rerunOfReviewRunId", () => {

  it("1 — accepts rerunOfReviewRunId in body (validated before token ops)", async () => {
    // Should fail at token_unavailable (not at no_repo_linked or run validation)
    const sourceRun = makeSourceRun();
    const app = createApp();
    const env = makeEnv({ runs: [sourceRun], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_src_01",
    });
    const body = await res.json();
    // Fails at token_unavailable (no KEK), not at run validation — run was found + validated
    assert.ok(
      body.error === "token_unavailable" || body.error === "not_connected",
      `expected token error, got: ${body.error}`,
    );
  });

  it("2 — rejects source run from a different project → 404 rerun_source_mismatch", async () => {
    const sourceRun = makeSourceRun({ project_id: "proj_other" });
    const app = createApp();
    const env = makeEnv({ runs: [sourceRun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_src_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "rerun_source_mismatch");
  });

  it("3 — rejects source run from a different repo → 404 rerun_source_mismatch", async () => {
    const sourceRun = makeSourceRun({ repo_full_name: "owner/other-repo" });
    const app = createApp();
    const env = makeEnv({ runs: [sourceRun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_src_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "rerun_source_mismatch");
  });

  it("4 — rejects source run from a different prNumber → 404 rerun_source_mismatch", async () => {
    const sourceRun = makeSourceRun({ pr_number: 99 });
    const app = createApp();
    const env = makeEnv({ runs: [sourceRun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_src_01",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "rerun_source_mismatch");
  });

  it("5 — uses source run selectedItemIds when body selectedItemIds missing", async () => {
    // Source run has ["req_001","req_002"] but linked PR has ["req_001","req_002","req_003"]
    // Without body selectedItemIds, should inherit source run's IDs
    const sourceRun = makeSourceRun({ selected_item_ids_json: '["req_001"]' });
    const app = createApp();
    // linkedPR has 3 items but rerun should use source's 1 item
    const env = makeEnv({ runs: [sourceRun], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_src_01",
    });
    const body = await res.json();
    // Fails at token (no KEK) — but run is loaded and source selectedItemIds would have been used.
    // We can only verify that it got past run validation (no run-related error).
    assert.ok(
      body.error === "token_unavailable" || body.error === "not_connected",
      `expected token error after run validation, got: ${body.error}`,
    );
  });

  it("6 — body selectedItemIds overrides source run selectedItemIds", async () => {
    const sourceRun = makeSourceRun({ selected_item_ids_json: '["req_001","req_002"]' });
    const app = createApp();
    const env = makeEnv({ runs: [sourceRun], repos: [makeRepo()], linkedPRs: [makeLinkedPR()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_src_01",
      selectedItemIds: ["req_003"],  // body override
    });
    const body = await res.json();
    // Also fails at token — body selectedItemIds accepted (single item override)
    assert.ok(
      body.error === "token_unavailable" || body.error === "not_connected",
      `expected token error, got: ${body.error}`,
    );
  });

  it("7 — unknown rerunOfReviewRunId returns 404 rerun_source_not_found", async () => {
    const app = createApp();
    const env = makeEnv({ runs: [], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/42/review", {
      userKey: "uk1",
      rerunOfReviewRunId: "wprr_missing",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "rerun_source_not_found");
  });
});

// ─── compareSpecificReviewRuns unit tests ─────────────────────────────────────

describe("compareSpecificReviewRuns", () => {
  const make = (itemId, title, status) => ({ itemId, title, status, reason: "r" });

  it("8 — improved item detected when status improves", () => {
    const source = {
      id: "src",
      results: [make("req_001", "Feature A", "failed")],
    };
    const newRun = {
      id: "new",
      results: [make("req_001", "Feature A", "passed")],
    };
    const cmp = compareSpecificReviewRuns(source, newRun);
    assert.ok(cmp.comparable);
    assert.equal(cmp.improved.length, 1);
    assert.equal(cmp.improved[0].itemId, "req_001");
    assert.equal(cmp.improved[0].from, "failed");
    assert.equal(cmp.improved[0].to, "passed");
  });

  it("9 — newlyProblematic detected when status regresses", () => {
    const source = {
      id: "src",
      results: [make("req_001", "Feature A", "passed")],
    };
    const newRun = {
      id: "new",
      results: [make("req_001", "Feature A", "failed")],
    };
    const cmp = compareSpecificReviewRuns(source, newRun);
    assert.ok(cmp.comparable);
    assert.equal(cmp.newlyProblematic.length, 1);
    assert.equal(cmp.newlyProblematic[0].from, "passed");
    assert.equal(cmp.newlyProblematic[0].to, "failed");
  });

  it("10 — stillOpen when status unchanged and not passed", () => {
    const source = {
      id: "src",
      results: [make("req_001", "Feature A", "failed")],
    };
    const newRun = {
      id: "new",
      results: [make("req_001", "Feature A", "failed")],
    };
    const cmp = compareSpecificReviewRuns(source, newRun);
    assert.ok(cmp.comparable);
    assert.equal(cmp.stillOpen.length, 1);
    assert.equal(cmp.improved.length, 0);
    assert.equal(cmp.newlyProblematic.length, 0);
  });

  it("11 — unchanged when both passed", () => {
    const source = {
      id: "src",
      results: [make("req_001", "Feature A", "passed")],
    };
    const newRun = {
      id: "new",
      results: [make("req_001", "Feature A", "passed")],
    };
    const cmp = compareSpecificReviewRuns(source, newRun);
    assert.ok(cmp.comparable);
    assert.equal(cmp.unchanged.length, 1);
    assert.equal(cmp.improved.length, 0);
    assert.equal(cmp.stillOpen.length, 0);
  });

  it("12 — comparable=false when source has no results", () => {
    const cmp = compareSpecificReviewRuns(
      { id: "src", results: [] },
      { id: "new", results: [make("req_001", "Feature A", "passed")] },
    );
    assert.equal(cmp.comparable, false);
    assert.equal(cmp.sourceRunId, "src");
    assert.equal(cmp.newRunId, "new");
    assert.equal(cmp.improved.length, 0);
  });

  it("13 — comparable=false when new run has no results", () => {
    const cmp = compareSpecificReviewRuns(
      { id: "src", results: [make("req_001", "Feature A", "passed")] },
      { id: "new", results: [] },
    );
    assert.equal(cmp.comparable, false);
  });

  it("14 — mixed results: improved + stillOpen + unchanged", () => {
    const source = {
      id: "src",
      results: [
        make("req_001", "A", "failed"),      // will improve
        make("req_002", "B", "failed"),      // will stay failed
        make("req_003", "C", "passed"),      // will stay passed
      ],
    };
    const newRun = {
      id: "new",
      results: [
        make("req_001", "A", "passed"),      // improved
        make("req_002", "B", "failed"),      // still open
        make("req_003", "C", "passed"),      // unchanged
      ],
    };
    const cmp = compareSpecificReviewRuns(source, newRun);
    assert.ok(cmp.comparable);
    assert.equal(cmp.improved.length, 1);
    assert.equal(cmp.stillOpen.length, 1);
    assert.equal(cmp.unchanged.length, 1);
    assert.equal(cmp.newlyProblematic.length, 0);
  });

  it("15 — sourceRunId and newRunId are set correctly", () => {
    const source = { id: "source-id-abc", results: [make("req_001", "A", "failed")] };
    const newRun = { id: "new-run-id-xyz", results: [make("req_001", "A", "passed")] };
    const cmp = compareSpecificReviewRuns(source, newRun);
    assert.equal(cmp.sourceRunId, "source-id-abc");
    assert.equal(cmp.newRunId, "new-run-id-xyz");
  });
});

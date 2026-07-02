/**
 * Stage 38: rerun comparison in PR comment body
 *
 * Tests:
 *  1. Run detail (project-scoped) exposes rerunOfReviewRunId
 *  2. Run detail (PR-scoped) exposes rerunOfReviewRunId
 *  3. Normal run has no rerunOfReviewRunId in detail response
 *  4. comment/preview without reviewRunId + includeRerunComparison → warning
 *  5. comment/preview with reviewRunId but run has no lineage → rerun_source_not_available
 *  6. comment/preview with valid lineage → body contains comparison section
 *  7. comment/preview with valid lineage → improved items shown in body
 *  8. comment/preview: includeComparison + includeRerunComparison → latest_comparison_skipped warning
 *  9. comment/preview without includeRerunComparison → no rerun comparison in body
 * 10. comment/preview: regression run shows new issues in body
 * 11. comment/preview: no rerun warnings when no rerun flags
 * 12. comment/preview: rerun_source_not_available when run has no lineage
 * 13. comment/post without reviewRunId + includeRerunComparison → no error, no rerun section
 * 14. comment/post with valid lineage → body posted contains rerun comparison section
 * 15. comment/post with customBody ignores includeRerunComparison
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { createApp } = await import("../dist/router.js");
const { encryptToken } = await import("../dist/crypto.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeRun(opts = {}) {
  const id = opts.id ?? "run_default";
  const statuses = opts.statuses ?? ["passed"];
  const results = statuses.map((s, i) => ({
    itemId: `item_${i + 1}`,
    title: `항목 ${i + 1}`,
    status: s,
    userLabel: s === "passed" ? "통과" : "안 맞음",
    reason: `이유 ${i + 1}`,
    evidence: [],
    nextAction: s !== "passed" ? `조치 ${i + 1}` : "",
  }));
  const resultJson = JSON.stringify({
    results,
    summary: {
      passed: statuses.filter((s) => s === "passed").length,
      failed: statuses.filter((s) => s === "failed").length,
      inconclusive: statuses.filter((s) => s === "inconclusive").length,
      needsDecision: statuses.filter((s) => s === "needs_decision").length,
    },
  });
  return {
    id,
    project_id: opts.projectId ?? "proj1",
    user_key: "uk1",
    repo_full_name: opts.repoFullName ?? "owner/repo",
    pr_number: opts.prNumber ?? 1,
    linked_pr_id: null,
    selected_item_ids_json: JSON.stringify(results.map((r) => r.itemId)),
    status: opts.status ?? "passed",
    result_json: resultJson,
    error_message: null,
    rerun_of_review_run_id: opts.rerunOfReviewRunId ?? null,
    created_at: opts.createdAt ?? NOW,
    updated_at: opts.updatedAt ?? NOW,
  };
}

function makeRepo(opts = {}) {
  return {
    project_id: opts.projectId ?? "proj1",
    repo_full_name: opts.repoFullName ?? "owner/repo",
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeConnection(userKey = "uk1") {
  return {
    user_key: userKey,
    github_username: "tester",
    access_token_enc: "enc_tok",
    scopes: "public_repo",
    created_at: NOW,
    updated_at: NOW,
  };
}

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function makeMockDb({ runs = [], repos = [], connections = [] } = {}) {
  const insertedComments = [];
  const insertedRuns = [];

  return {
    _insertedComments: insertedComments,
    _insertedRuns: insertedRuns,
    prepare(sql) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          // getReviewRunById: SELECT ... WHERE id = ?
          if (/FROM workspace_pr_review_runs\s+WHERE id\s*=/.test(sql)) {
            const [id] = bound;
            return runs.find((r) => r.id === id) ?? null;
          }
          // getLatestReviewRun: ORDER BY updated_at DESC LIMIT 1
          if (/FROM workspace_pr_review_runs/.test(sql) && /ORDER BY updated_at DESC LIMIT 1/.test(sql)) {
            const [pid, repo, prNum] = bound;
            const filtered = runs.filter(
              (r) => r.project_id === pid && r.repo_full_name === repo && r.pr_number === prNum
            );
            return filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
          }
          // getProjectRepo
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            return repos.find((r) => r.project_id === pid) ?? null;
          }
          // getGitHubConnectionByUserKey
          if (/FROM workspace_github_connections/.test(sql) && /user_key/.test(sql)) {
            const [uk] = bound;
            return connections.find((c) => c.user_key === uk) ?? null;
          }
          // getLatestPostedComment
          if (/FROM workspace_pr_comments/.test(sql) && /status = 'posted'/.test(sql)) {
            return null;
          }
          // Ownership hardening: every project id resolves to a row owned
          // by this file's route-test userKey.
          if (/FROM workspace_projects/.test(sql)) {
            const [pid] = bound;
            return { id: pid, user_key: "uk1", title: "T", idea: "",
              understood_json: null, product_spec_json: "{}", items_json: "[]",
              created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
          }
          // credit queries → null defaults
          return null;
        },
        async run() {
          if (/INSERT INTO workspace_pr_review_runs/.test(sql)) {
            const [id, , , , prNum, , selJson, status, , rerunOfId] = bound;
            insertedRuns.push({ id, pr_number: prNum, selected_item_ids_json: selJson, status, rerun_of_review_run_id: rerunOfId ?? null });
          }
          if (/INSERT INTO workspace_pr_comments/.test(sql)) {
            insertedComments.push({ bound });
          }
          if (/UPDATE workspace_pr_comments/.test(sql)) { /* no-op */ }
          return { meta: { changes: 1 } };
        },
        async all() {
          // getLatestTwoPrReviewRuns: ORDER BY updated_at DESC LIMIT 2
          if (/FROM workspace_pr_review_runs/.test(sql) && /LIMIT 2/.test(sql)) {
            const [pid, repo, prNum] = bound;
            const filtered = runs.filter(
              (r) => r.project_id === pid && r.repo_full_name === repo && r.pr_number === prNum
                && !["running", "queued", "error"].includes(r.status)
            );
            return { results: filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 2) };
          }
          // listPRReviewRuns
          if (/FROM workspace_pr_review_runs/.test(sql) && /LIMIT/.test(sql)) {
            const [pid, repo, prNum] = bound;
            return { results: runs.filter((r) => r.project_id === pid && r.repo_full_name === repo && r.pr_number === prNum) };
          }
          // listProjectReviewRuns
          if (/FROM workspace_pr_review_runs/.test(sql)) {
            const [pid] = bound;
            return { results: runs.filter((r) => r.project_id === pid) };
          }
          // getLinkedPRs
          if (/FROM workspace_linked_prs/.test(sql)) {
            return { results: [] };
          }
          // usage events, notifications, etc.
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
  const db = makeMockDb(opts);
  return {
    DB: db,
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: opts.kek ?? null,
    _db: db,
  };
}

async function makeEnvWithToken(opts = {}) {
  const kek = randomBytes(32).toString("base64");
  const enc = await encryptToken("ghp_faketoken", kek);
  const connections = (opts.connections ?? []).map((c) => ({ ...c, access_token_enc: enc }));
  return { env: makeEnv({ ...opts, connections, kek }), kek };
}

async function get(app, env, path) {
  return app.fetch(new Request(`https://example.com${path}`), env);
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

// ─── Shared fetch stub (GitHub comment post success) ──────────────────────────

function makeGitHubFetch(captureRef = {}) {
  return async (url, init) => {
    try {
      const body = JSON.parse(init?.body ?? "{}");
      captureRef.body = body.body;
    } catch { /* ignored */ }
    return new Response(
      JSON.stringify({ id: 9999, html_url: "https://github.com/owner/repo/issues/1#issuecomment-9999" }),
      { status: 201 }
    );
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Stage 38 — rerun comparison in PR comment body", () => {

  // ── A. Run detail exposes rerunOfReviewRunId ──────────────────────────────

  it("1 — project-scoped run detail exposes rerunOfReviewRunId", async () => {
    const srcRun = makeRun({ id: "src_1", projectId: "proj1", statuses: ["failed"] });
    const rerun  = makeRun({ id: "rerun_1", projectId: "proj1", statuses: ["passed"], rerunOfReviewRunId: "src_1" });
    const app = createApp();
    const env = makeEnv({ runs: [srcRun, rerun], repos: [makeRepo()] });

    const res = await get(app, env, "/workspace/projects/proj1/github/review/runs/rerun_1?userKey=uk1");
    const json = await res.json();
    assert.equal(json.ok, true, `expected ok, got: ${json.error}`);
    assert.equal(json.run.rerunOfReviewRunId, "src_1");
  });

  it("2 — PR-scoped run detail exposes rerunOfReviewRunId", async () => {
    const srcRun = makeRun({ id: "src_2", projectId: "proj1", prNumber: 5, statuses: ["failed"] });
    const rerun  = makeRun({ id: "rerun_2", projectId: "proj1", prNumber: 5, statuses: ["passed"], rerunOfReviewRunId: "src_2" });
    const app = createApp();
    const env = makeEnv({ runs: [srcRun, rerun], repos: [makeRepo()] });

    const res = await get(app, env, "/workspace/projects/proj1/github/pulls/5/review/runs/rerun_2?userKey=uk1");
    const json = await res.json();
    assert.equal(json.ok, true, `expected ok, got: ${json.error}`);
    assert.equal(json.run.rerunOfReviewRunId, "src_2");
  });

  it("3 — normal run has no rerunOfReviewRunId in detail", async () => {
    const run = makeRun({ id: "normal_3", projectId: "proj1", statuses: ["passed"] });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await get(app, env, "/workspace/projects/proj1/github/review/runs/normal_3?userKey=uk1");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.run.rerunOfReviewRunId, undefined);
  });

  // ── B. comment/preview with includeRerunComparison ───────────────────────

  it("4 — preview without reviewRunId + includeRerunComparison → warning", async () => {
    const run = makeRun({ id: "run_4", projectId: "proj1", statuses: ["failed"] });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(
      json.warnings?.includes("rerun_comparison_requires_review_run_id"),
      `expected warning, got: ${JSON.stringify(json.warnings)}`
    );
  });

  it("5 — preview with reviewRunId but run has no lineage → rerun_source_not_available", async () => {
    const run = makeRun({ id: "run_5", projectId: "proj1", statuses: ["failed"] });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "run_5", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(
      json.warnings?.includes("rerun_source_not_available"),
      `expected warning, got: ${JSON.stringify(json.warnings)}`
    );
  });

  it("6 — preview with valid lineage → body contains rerun comparison heading", async () => {
    const src  = makeRun({ id: "src_6", projectId: "proj1", statuses: ["failed", "passed"] });
    const rerun = makeRun({ id: "rerun_6", projectId: "proj1", statuses: ["passed", "passed"], rerunOfReviewRunId: "src_6" });
    const app = createApp();
    const env = makeEnv({ runs: [src, rerun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "rerun_6", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.comment.body.includes("다시 확인 결과 비교"), `body: ${json.comment.body.slice(0, 300)}`);
  });

  it("7 — preview improved item appears in body", async () => {
    const src  = makeRun({ id: "src_7", projectId: "proj1", statuses: ["failed"] });
    const rerun = makeRun({ id: "rerun_7", projectId: "proj1", statuses: ["passed"], rerunOfReviewRunId: "src_7" });
    const app = createApp();
    const env = makeEnv({ runs: [src, rerun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "rerun_7", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.comment.body.includes("좋아진 항목"), `body should list improved items`);
  });

  it("8 — includeComparison + includeRerunComparison → latest_comparison_skipped warning", async () => {
    const src  = makeRun({ id: "src_8", projectId: "proj1", statuses: ["failed"] });
    const rerun = makeRun({ id: "rerun_8", projectId: "proj1", statuses: ["passed"], rerunOfReviewRunId: "src_8" });
    const app = createApp();
    const env = makeEnv({ runs: [src, rerun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "rerun_8", includeRerunComparison: true, includeComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(
      json.warnings?.includes("latest_comparison_skipped_because_rerun_comparison_requested"),
      `expected warning, got: ${JSON.stringify(json.warnings)}`
    );
  });

  it("9 — preview without includeRerunComparison → no rerun section in body", async () => {
    const src  = makeRun({ id: "src_9", projectId: "proj1", statuses: ["failed"] });
    const rerun = makeRun({ id: "rerun_9", projectId: "proj1", statuses: ["passed"], rerunOfReviewRunId: "src_9" });
    const app = createApp();
    const env = makeEnv({ runs: [src, rerun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "rerun_9",
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(
      !json.comment.body.includes("다시 확인 결과 비교"),
      "body should NOT contain rerun comparison section"
    );
  });

  it("10 — regression run shows newly problematic items in body", async () => {
    const src  = makeRun({ id: "src_10", projectId: "proj1", statuses: ["passed", "passed"] });
    const rerun = makeRun({ id: "rerun_10", projectId: "proj1", statuses: ["failed", "passed"], rerunOfReviewRunId: "src_10" });
    const app = createApp();
    const env = makeEnv({ runs: [src, rerun], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "rerun_10", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.comment.body.includes("새로 생긴 문제"), "body should list newly problematic items");
  });

  it("11 — no rerun warnings when no rerun flags used", async () => {
    const run = makeRun({ id: "run_11", projectId: "proj1", statuses: ["passed"] });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "run_11",
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    const rerunWarnings = (json.warnings ?? []).filter((w) => String(w).includes("rerun"));
    assert.equal(rerunWarnings.length, 0, `unexpected rerun warnings: ${JSON.stringify(rerunWarnings)}`);
  });

  it("12 — rerun_source_not_available when run has null lineage", async () => {
    const run = makeRun({ id: "run_12", projectId: "proj1", statuses: ["passed"] });
    const app = createApp();
    const env = makeEnv({ runs: [run], repos: [makeRepo()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment/preview", {
      userKey: "uk1", reviewRunId: "run_12", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.warnings?.includes("rerun_source_not_available"), `got: ${JSON.stringify(json.warnings)}`);
  });

  // ── C. comment/post with includeRerunComparison ───────────────────────────

  it("13 — post without reviewRunId + includeRerunComparison → ok, no rerun section", async () => {
    const run = makeRun({ id: "run_13", projectId: "proj1", statuses: ["failed"] });
    const capture = {};
    const app = createApp({ fetch: makeGitHubFetch(capture) });
    const { env } = await makeEnvWithToken({ runs: [run], repos: [makeRepo()], connections: [makeConnection()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment", {
      userKey: "uk1", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true, `expected ok, got: ${JSON.stringify(json)}`);
    assert.ok(
      !(capture.body ?? "").includes("다시 확인 결과 비교"),
      "no rerun section when no reviewRunId"
    );
  });

  it("14 — post with valid lineage → posted body contains rerun comparison section", async () => {
    const src  = makeRun({ id: "src_14", projectId: "proj1", statuses: ["failed", "passed"] });
    const rerun = makeRun({ id: "rerun_14", projectId: "proj1", statuses: ["passed", "passed"], rerunOfReviewRunId: "src_14" });
    const capture = {};
    const app = createApp({ fetch: makeGitHubFetch(capture) });
    const { env } = await makeEnvWithToken({ runs: [src, rerun], repos: [makeRepo()], connections: [makeConnection()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment", {
      userKey: "uk1", reviewRunId: "rerun_14", includeRerunComparison: true,
    });
    const json = await res.json();
    assert.equal(json.ok, true, `expected ok, got: ${JSON.stringify(json)}`);
    assert.ok((capture.body ?? "").includes("다시 확인 결과 비교"), `body: ${capture.body?.slice(0, 300)}`);
  });

  it("15 — post with customBody ignores includeRerunComparison", async () => {
    const src  = makeRun({ id: "src_15", projectId: "proj1", statuses: ["failed"] });
    const rerun = makeRun({ id: "rerun_15", projectId: "proj1", statuses: ["passed"], rerunOfReviewRunId: "src_15" });
    const capture = {};
    const app = createApp({ fetch: makeGitHubFetch(capture) });
    const { env } = await makeEnvWithToken({ runs: [src, rerun], repos: [makeRepo()], connections: [makeConnection()] });

    const res = await post(app, env, "/workspace/projects/proj1/github/pulls/1/comment", {
      userKey: "uk1", reviewRunId: "rerun_15", includeRerunComparison: true,
      body: "수동으로 작성한 코멘트",
    });
    const json = await res.json();
    assert.equal(json.ok, true, `expected ok, got: ${JSON.stringify(json)}`);
    assert.equal(capture.body, "수동으로 작성한 코멘트");
  });
});

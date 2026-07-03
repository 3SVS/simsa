/**
 * workspace-pr-comment-comparison.test.mjs
 *
 * Stage 16: includeComparison option in preview / post / PATCH endpoints.
 * Tests:
 *   - buildCommentBody: comparison section generation + priority-based omission
 *   - POST /comment/preview: includeComparison=true / false / one run
 *   - POST /comment: includeComparison produces comparison section in body
 *   - POST /comment update_latest: includeComparison reflects in body
 *   - PATCH /comment/:commentId: includeComparison reflects in body
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

function genKek() { return randomBytes(32).toString("base64"); }

const { buildCommentBody } = await import("../dist/workspace/pr-comment.js");
const { createApp } = await import("../dist/router.js");

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const REPO = "myorg/myapp";
const PR_NUMBER = 3;
const PR_TITLE = "feat: improve send flow";

const ITEMS_MIXED = [
  { itemId: "i1", title: "로그인", status: "failed", userLabel: "안 맞음", reason: "JWT 없음", evidence: ["src/auth.ts"], nextAction: "JWT 추가" },
  { itemId: "i2", title: "알림", status: "passed", userLabel: "통과", reason: "구현됨", evidence: [], nextAction: "" },
];
const SUMMARY_MIXED = { failed: 1, inconclusive: 0, needsDecision: 0, passed: 1 };

const COMPARISON_DATA = {
  previousSummary: { passed: 1, failed: 3, inconclusive: 1, needsDecision: 0 },
  latestSummary:   { passed: 4, failed: 1, inconclusive: 0, needsDecision: 0 },
  improved: [{ itemId: "i2", title: "알림", from: "failed", to: "passed", reason: "알림 구현이 확인됐어요." }],
  stillOpen: [{ itemId: "i1", title: "로그인", status: "failed", reason: "JWT 미구현" }],
  newlyProblematic: [],
};

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeDb(extra = {}) {
  const comments = new Map();
  const reviewRuns = new Map();
  const repos = new Map();
  const connections = new Map();
  const prs = new Map();

  const db = {
    _comments: comments,
    _reviewRuns: reviewRuns,
    _repos: repos,
    _connections: connections,
    _prs: prs,
    ...extra,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT INTO workspace_pr_comments")) {
                const [id, projId, userKey, repoFull, prNum, runId, selJson, bodyPrev, status, createdAt, updatedAt] = args;
                comments.set(id, { id, project_id: projId, user_key: userKey, repo_full_name: repoFull, pr_number: prNum, review_run_id: runId, selected_item_ids_json: selJson, body_preview: bodyPrev, status, created_at: createdAt, updated_at: updatedAt, github_comment_id: null, github_comment_url: null, error_message: null });
              }
              if (sql.includes("UPDATE workspace_pr_comments")) {
                const [status, ghId, ghUrl, errMsg, bodyPrev, updatedAt, id] = args;
                const rec = comments.get(id);
                if (rec) { rec.status = status; rec.github_comment_id = ghId; rec.github_comment_url = ghUrl; rec.error_message = errMsg; if (bodyPrev !== null) rec.body_preview = bodyPrev; rec.updated_at = updatedAt; }
              }
              if (sql.includes("INSERT INTO workspace_pr_review_runs")) {
                const [id, projId, userKey, repoFull, prNum, linkedPrId, selJson, status, createdAt, updatedAt] = args;
                reviewRuns.set(id, { id, project_id: projId, user_key: userKey, repo_full_name: repoFull, pr_number: prNum, linked_pr_id: linkedPrId, selected_item_ids_json: selJson, status, created_at: createdAt, updated_at: updatedAt, result_json: null, error_message: null });
              }
              if (sql.includes("UPDATE workspace_pr_review_runs")) {
                const [status, resultJson, errMsg, updatedAt, id] = args;
                const rec = reviewRuns.get(id);
                if (rec) { rec.status = status; rec.result_json = resultJson; rec.error_message = errMsg; rec.updated_at = updatedAt; }
              }
              if (sql.includes("INSERT INTO workspace_project_repos") || (sql.includes("ON CONFLICT") && sql.includes("workspace_project_repos"))) {
                const [id, projId, repoFull, owner, repoName, defBranch, priv, htmlUrl, createdAt, updatedAt] = args;
                repos.set(projId, { id, project_id: projId, repo_full_name: repoFull, repo_owner: owner, repo_name: repoName, default_branch: defBranch, is_private: priv, html_url: htmlUrl, created_at: createdAt, updated_at: updatedAt });
              }
              if (sql.includes("INSERT INTO workspace_github_connections") || (sql.includes("workspace_github_connections") && sql.includes("UPDATE"))) {
                const data2 = extra._connStore ?? connections;
                if (args[0]) data2.set(args[1], { id: args[0], user_key: args[1], github_user_id: args[2], github_login: args[3], github_name: args[4], avatar_url: args[5], access_token_enc: args[6], scopes: args[7], created_at: args[8], updated_at: args[9] });
              }
              if (sql.includes("INSERT INTO workspace_linked_prs") || (sql.includes("ON CONFLICT") && sql.includes("workspace_linked_prs"))) {
                const [id, projId, repoFull, prNum, prTitle2, prState, htmlUrl, headBranch, baseBranch, selJson, updatedAt] = args;
                prs.set(`${projId}:${prNum}`, { id, project_id: projId, repo_full_name: repoFull, pr_number: prNum, pr_title: prTitle2, pr_state: prState, html_url: htmlUrl, pr_head_branch: headBranch, pr_base_branch: baseBranch, selected_item_ids_json: selJson, updated_at: updatedAt });
              }
              if (sql.includes("INSERT INTO workspace_usage_events")) { /* no-op */ }
            },
            async first() {
              if (sql.includes("FROM workspace_pr_review_runs") && !sql.includes("LIMIT 2")) {
                for (const run of reviewRuns.values()) {
                  if (run.project_id === args[0] && run.repo_full_name === args[1] && run.pr_number === args[2]) return run;
                }
                return null;
              }
              if (sql.includes("FROM workspace_project_repos")) {
                return repos.get(args[0]) ?? null;
              }
              if (sql.includes("FROM workspace_github_connections")) {
                const data2 = extra._connStore ?? connections;
                return data2.get(args[0]) ?? null;
              }
              if (sql.includes("FROM workspace_workspace_projects") || sql.includes("FROM workspace_projects")) {
                // Ownership hardening: every project id resolves to a row owned
                // by this file's route-test userKey.
                return { id: args[0], user_key: "user1", title: "T", idea: "",
                  understood_json: null, product_spec_json: "{}", items_json: "[]",
                  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
              }
              if (sql.includes("FROM workspace_pr_comments") && sql.includes("status = 'posted'")) {
                for (const c of comments.values()) {
                  if (c.project_id === args[0] && c.repo_full_name === args[1] && c.pr_number === args[2] && c.status === "posted" && c.github_comment_id) return c;
                }
                return null;
              }
              if (sql.includes("FROM workspace_pr_comments") && sql.includes("WHERE id")) {
                return comments.get(args[0]) ?? null;
              }
              return null;
            },
            async all() {
              if (sql.includes("FROM workspace_linked_prs")) {
                const results = [];
                for (const p of prs.values()) {
                  if (p.project_id === args[0]) results.push(p);
                }
                return { results };
              }
              if (sql.includes("FROM workspace_pr_comments")) {
                const results = [];
                for (const c of comments.values()) {
                  if (c.project_id === args[0] && c.repo_full_name === args[1] && c.pr_number === args[2]) results.push(c);
                }
                return { results: results.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
              }
              // getLatestTwoPrReviewRuns: returns up to 2 completed runs
              if (sql.includes("FROM workspace_pr_review_runs") && sql.includes("LIMIT 2")) {
                const results = [];
                for (const r of reviewRuns.values()) {
                  if (r.project_id === args[0] && r.repo_full_name === args[1] && r.pr_number === args[2]) results.push(r);
                }
                // Filter out running/queued/error, sort desc
                const completed = results
                  .filter((r) => !["running", "queued", "error"].includes(r.status))
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .slice(0, 2);
                return { results: completed };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return db;
}

// ─── Mock env builder ─────────────────────────────────────────────────────────

function makeEnv(db, extra = {}) {
  return {
    DB: db,
    CONCLAVE_TOKEN_KEK: genKek(),
    WORKSPACE_GH_CLIENT_ID: "ghclient",
    WORKSPACE_GH_CLIENT_SECRET: "ghsecret",
    WORKSPACE_GH_REDIRECT_URI: "https://example.com/cb",
    WORKSPACE_GH_DASHBOARD_URL: "https://dashboard.conclave-ai.dev",
    PUBLIC_BASE_URL: "https://example.com",
    ANTHROPIC_API_KEY: "sk-test",
    ...extra,
  };
}

// Encrypt a token for use in tests (real encrypt so decrypt works)
const { encryptToken } = await import("../dist/crypto.js");
async function encToken(kek) {
  return encryptToken("ghp_testtoken123", kek);
}

// Seed a connected user into the DB
async function seedConnection(db, userKey, kek, scopes = "read:user public_repo") {
  const enc = await encToken(kek);
  db._connections.set(userKey, {
    id: `conn_${userKey}`,
    user_key: userKey,
    github_user_id: "99",
    github_login: "testuser",
    github_name: "Test User",
    avatar_url: null,
    access_token_enc: enc,
    scopes,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

// Seed a repo into the DB
function seedRepo(db, projectId, repoFullName = REPO) {
  db._repos.set(projectId, {
    id: `repo_${projectId}`,
    project_id: projectId,
    repo_full_name: repoFullName,
    repo_owner: repoFullName.split("/")[0],
    repo_name: repoFullName.split("/")[1],
    default_branch: "main",
    is_private: 0,
    html_url: `https://github.com/${repoFullName}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

// Seed a linked PR
function seedPR(db, projectId, prNumber = PR_NUMBER, selectedItemIds = ["i1", "i2"]) {
  db._prs.set(`${projectId}:${prNumber}`, {
    id: `pr_${projectId}_${prNumber}`,
    project_id: projectId,
    repo_full_name: REPO,
    pr_number: prNumber,
    pr_title: PR_TITLE,
    pr_state: "open",
    html_url: `https://github.com/${REPO}/pull/${prNumber}`,
    pr_head_branch: "feature",
    pr_base_branch: "main",
    selected_item_ids_json: JSON.stringify(selectedItemIds),
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

// Seed a review run (with optional result JSON)
function seedRun(db, projectId, runId, status = "failed", resultJson = null, updatedAt = "2026-01-01T10:00:00.000Z") {
  db._reviewRuns.set(runId, {
    id: runId,
    project_id: projectId,
    user_key: "user1",
    repo_full_name: REPO,
    pr_number: PR_NUMBER,
    linked_pr_id: null,
    selected_item_ids_json: JSON.stringify(["i1", "i2"]),
    status,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: updatedAt,
    result_json: resultJson,
    error_message: null,
  });
}

const RESULT_JSON_PREV = JSON.stringify({
  summary: { passed: 1, failed: 3, inconclusive: 1, needsDecision: 0 },
  results: [
    { itemId: "i1", title: "로그인", status: "failed", userLabel: "안 맞음", reason: "JWT 없음", evidence: [], nextAction: "" },
    { itemId: "i2", title: "알림", status: "failed", userLabel: "안 맞음", reason: "알림 없음", evidence: [], nextAction: "" },
  ],
});

const RESULT_JSON_LATEST = JSON.stringify({
  summary: { passed: 2, failed: 1, inconclusive: 0, needsDecision: 0 },
  results: [
    { itemId: "i1", title: "로그인", status: "failed", userLabel: "안 맞음", reason: "JWT 없음", evidence: [], nextAction: "" },
    { itemId: "i2", title: "알림", status: "passed", userLabel: "통과", reason: "구현됨", evidence: [], nextAction: "" },
  ],
});

// Mock fetch for GitHub API calls
function mockGitHubFetch(commentId = "gh_cmt_001") {
  return async (url, opts) => {
    if (url.includes("/issues/") && url.includes("/comments") && opts?.method === "POST") {
      return new Response(JSON.stringify({ id: 11111, html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-11111` }), { status: 201 });
    }
    if (url.includes("/issues/comments/") && opts?.method === "PATCH") {
      return new Response(JSON.stringify({ id: commentId, html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-${commentId}` }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
  };
}

// ─── buildCommentBody tests ───────────────────────────────────────────────────

describe("buildCommentBody — comparison section", () => {
  it("without includeComparison produces no comparison header", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
    });
    assert.ok(!body.includes("이전/최신 비교"), "should not contain comparison header");
  });

  it("without comparisonData even with includeComparison=true produces no comparison header", () => {
    const { body, comparisonIncluded } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      // comparisonData omitted
    });
    assert.ok(!body.includes("이전/최신 비교"));
    assert.equal(comparisonIncluded, false);
  });

  it("with includeComparison and comparisonData includes ## 이전/최신 비교 header", () => {
    const { body, comparisonIncluded } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    assert.ok(body.includes("## 이전/최신 비교"), "should contain comparison header");
    assert.equal(comparisonIncluded, true);
  });

  it("includes required disclaimer even with comparison", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    assert.ok(body.includes("전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"), "PR diff disclaimer present");
  });

  it("includes 좋아진 항목 section when improved items exist", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    assert.ok(body.includes("좋아진 항목"), "should include improved section");
    assert.ok(body.includes("알림"), "should include improved item title");
  });

  it("includes 아직 남은 항목 section when stillOpen items exist", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    assert.ok(body.includes("아직 남은 항목"), "should include still-open section");
  });

  it("omits 새로 생긴 문제 section when newlyProblematic is empty", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA, // newlyProblematic is []
    });
    assert.ok(!body.includes("새로 생긴 문제"), "should omit empty section");
  });

  it("includes comparison summary delta numbers", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    // previousSummary.passed=1 → latestSummary.passed=4
    assert.ok(body.includes("1개 → 4개"), "should show delta");
  });

  it("comparisonIncluded=false when comparisonData omitted from fit", () => {
    // Fill the body with huge required content so comparison won't fit
    const hugeItems = Array.from({ length: 300 }, (_, i) => ({
      itemId: `item${i}`,
      title: `항목 ${i} — 이 항목은 매우 긴 설명을 가지고 있어서 전체 body 크기를 늘립니다`.repeat(3),
      status: "failed",
      userLabel: "안 맞음",
      reason: "이유: " + "X".repeat(100),
      evidence: ["src/file.ts"],
      nextAction: "조치: " + "Y".repeat(100),
    }));
    const { comparisonIncluded, body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: hugeItems,
      summary: { failed: 300, inconclusive: 0, needsDecision: 0, passed: 0 },
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    // Either comparisonIncluded=false (dropped) or body fits and comparisonIncluded=true
    // Just assert body length is within limits
    assert.ok(body.length <= 60000, `body exceeds 60000 chars (got ${body.length})`);
    // If comparison was omitted, comparisonIncluded must be false
    if (!body.includes("## 이전/최신 비교")) {
      assert.equal(comparisonIncluded, false);
    }
  });

  it("still includes Simsa footer even with comparison", () => {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeComparison: true,
      comparisonData: COMPARISON_DATA,
    });
    // Stage 92: footer now links to the live Simsa app domain (was conclave-ai.dev).
    assert.ok(body.includes("https://app.trysimsa.com"), "footer links to Simsa app domain");
    assert.ok(body.includes("[Simsa]"), "footer carries the Simsa label");
    assert.ok(!body.includes("conclave-ai.dev"), "footer no longer points to legacy conclave-ai.dev");
  });
});

// ─── Route tests ──────────────────────────────────────────────────────────────

describe("POST /comment/preview — includeComparison", () => {
  it("without includeComparison: body has no comparison section", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run1", "failed", RESULT_JSON_LATEST);

    const app = createApp({ fetch: mockGitHubFetch() });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"] }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(!data.comment.body.includes("이전/최신 비교"), "no comparison section");
  });

  it("with includeComparison=true and two completed runs: body includes comparison section", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    // Seed 2 completed runs (latest run must be the one getLatestReviewRun returns)
    seedRun(db, "proj1", "run_prev", "failed", RESULT_JSON_PREV, "2026-01-01T09:00:00.000Z");
    seedRun(db, "proj1", "run_latest", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    const app = createApp({ fetch: mockGitHubFetch() });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: true }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(data.comment.body.includes("이전/최신 비교"), "should include comparison header");
  });

  it("with includeComparison=true and only one run: warning not_enough_runs, no comparison", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run_only", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    const app = createApp({ fetch: mockGitHubFetch() });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: true }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(!data.comment.body.includes("이전/최신 비교"), "no comparison when only 1 run");
    assert.ok(Array.isArray(data.warnings) && data.warnings.includes("not_enough_runs"), "warning present");
  });
});

describe("POST /comment — includeComparison", () => {
  it("includeComparison=true with two runs posts comment with comparison section", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run_prev", "failed", RESULT_JSON_PREV, "2026-01-01T09:00:00.000Z");
    seedRun(db, "proj1", "run_latest", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    let postedBody = null;
    const mockFetch = async (url, opts) => {
      if (url.includes("/issues/") && opts?.method === "POST") {
        postedBody = JSON.parse(opts.body).body;
        return new Response(JSON.stringify({ id: 22222, html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-22222` }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: true }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(postedBody !== null, "body was posted");
    assert.ok(postedBody.includes("이전/최신 비교"), "comparison section in posted body");
  });

  it("includeComparison=false posts comment without comparison section", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run_prev", "failed", RESULT_JSON_PREV, "2026-01-01T09:00:00.000Z");
    seedRun(db, "proj1", "run_latest", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    let postedBody = null;
    const mockFetch = async (url, opts) => {
      if (url.includes("/issues/") && opts?.method === "POST") {
        postedBody = JSON.parse(opts.body).body;
        return new Response(JSON.stringify({ id: 33333, html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-33333` }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: false }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(!postedBody.includes("이전/최신 비교"), "no comparison section");
  });

  it("update_latest with includeComparison=true patches existing comment with comparison", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run_prev", "failed", RESULT_JSON_PREV, "2026-01-01T09:00:00.000Z");
    seedRun(db, "proj1", "run_latest", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    // Seed an existing posted comment
    db._comments.set("cmt_existing", {
      id: "cmt_existing",
      project_id: "proj1",
      user_key: "user1",
      repo_full_name: REPO,
      pr_number: PR_NUMBER,
      review_run_id: "run_latest",
      selected_item_ids_json: JSON.stringify(["i1", "i2"]),
      body_preview: "old preview",
      status: "posted",
      github_comment_id: "gh_9999",
      github_comment_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-9999`,
      error_message: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    let patchedBody = null;
    const mockFetch = async (url, opts) => {
      if (url.includes("/issues/comments/") && opts?.method === "PATCH") {
        patchedBody = JSON.parse(opts.body).body;
        return new Response(JSON.stringify({ id: "gh_9999", html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-9999` }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: true, mode: "update_latest" }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.updated, true, "should be updated");
    assert.ok(patchedBody !== null, "body was patched");
    assert.ok(patchedBody.includes("이전/최신 비교"), "comparison section in patched body");
  });
});

describe("PATCH /comment/:commentId — includeComparison", () => {
  it("includeComparison=true includes comparison section in updated body", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run_prev", "failed", RESULT_JSON_PREV, "2026-01-01T09:00:00.000Z");
    seedRun(db, "proj1", "run_latest", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    db._comments.set("cmt_patch_test", {
      id: "cmt_patch_test",
      project_id: "proj1",
      user_key: "user1",
      repo_full_name: REPO,
      pr_number: PR_NUMBER,
      review_run_id: "run_latest",
      selected_item_ids_json: JSON.stringify(["i1", "i2"]),
      body_preview: "old",
      status: "posted",
      github_comment_id: "gh_patch_111",
      github_comment_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-gh_patch_111`,
      error_message: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    let patchedBody = null;
    const mockFetch = async (url, opts) => {
      if (url.includes("/issues/comments/") && opts?.method === "PATCH") {
        patchedBody = JSON.parse(opts.body).body;
        return new Response(JSON.stringify({ id: "gh_patch_111", html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-gh_patch_111` }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment/cmt_patch_test", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: true }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(patchedBody !== null, "body was patched");
    assert.ok(patchedBody.includes("이전/최신 비교"), "comparison section in PATCH body");
  });

  it("includeComparison=false: PATCH body has no comparison section", async () => {
    const db = makeDb();
    const env = makeEnv(db);
    await seedConnection(db, "user1", env.CONCLAVE_TOKEN_KEK);
    seedRepo(db, "proj1");
    seedPR(db, "proj1");
    seedRun(db, "proj1", "run_prev", "failed", RESULT_JSON_PREV, "2026-01-01T09:00:00.000Z");
    seedRun(db, "proj1", "run_latest", "failed", RESULT_JSON_LATEST, "2026-01-01T10:00:00.000Z");

    db._comments.set("cmt_no_comp", {
      id: "cmt_no_comp",
      project_id: "proj1",
      user_key: "user1",
      repo_full_name: REPO,
      pr_number: PR_NUMBER,
      review_run_id: "run_latest",
      selected_item_ids_json: JSON.stringify(["i1", "i2"]),
      body_preview: "old",
      status: "posted",
      github_comment_id: "gh_nocomp_222",
      github_comment_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-gh_nocomp_222`,
      error_message: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    let patchedBody = null;
    const mockFetch = async (url, opts) => {
      if (url.includes("/issues/comments/") && opts?.method === "PATCH") {
        patchedBody = JSON.parse(opts.body).body;
        return new Response(JSON.stringify({ id: "gh_nocomp_222", html_url: `https://github.com/${REPO}/pull/${PR_NUMBER}#issuecomment-gh_nocomp_222` }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = new Request("https://example.com/workspace/projects/proj1/github/pulls/3/comment/cmt_no_comp", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "user1", selectedItemIds: ["i1", "i2"], includeComparison: false }),
    });
    const res = await app.fetch(req, env);
    const data = await res.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(!patchedBody.includes("이전/최신 비교"), "no comparison section when not requested");
  });
});

// ─── Stage 49: rerun comparison section shows status transitions ──────────────

describe("buildCommentBody — rerun comparison status transitions", () => {
  const RERUN_DATA = {
    comparable: true,
    sourceRunId: "src",
    newRunId: "cur",
    summaryText: "좋아진 항목 1개, 새로 생긴 문제 1개, 아직 남은 항목 1개, 변화 없음 1개.",
    improved: [{ itemId: "i1", title: "로그인 에러 처리", from: "failed", to: "passed", reason: "ok" }],
    newlyProblematic: [{ itemId: "i2", title: "권한 화면", from: "passed", to: "failed", reason: "regressed", nextAction: "권한 분기 복구" }],
    stillOpen: [
      { itemId: "i3", title: "권한 에러 메시지", status: "inconclusive", reason: "근거 부족", from: "inconclusive", nextAction: "에러 메시지를 사용자 친화적으로 수정하세요." },
      { itemId: "i9", title: "신규 검증", status: "failed", reason: "새 항목", nextAction: "구현 추가" }, // current-only: from undefined
    ],
    unchanged: [{ itemId: "i4", title: "빈 상태 UI", status: "passed", from: "passed" }],
  };

  function rerunBody(extra = {}) {
    const { body } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeRerunComparison: true, rerunComparisonData: RERUN_DATA,
      ...extra,
    });
    return body;
  }

  it("improved item shows 안 맞음 → 통과", () => {
    assert.match(rerunBody(), /로그인 에러 처리: 안 맞음 → 통과/);
  });

  it("newly problematic item shows 통과 → 안 맞음", () => {
    assert.match(rerunBody(), /권한 화면: 통과 → 안 맞음/);
  });

  it("still open item shows 확인 부족 → 확인 부족", () => {
    assert.match(rerunBody(), /권한 에러 메시지: 확인 부족 → 확인 부족/);
  });

  it("current-only still-open item renders 새 항목 → 안 맞음", () => {
    assert.match(rerunBody(), /신규 검증: 새 항목 → 안 맞음/);
  });

  it("unchanged item shows 통과 → 통과", () => {
    assert.match(rerunBody(), /빈 상태 UI: 통과 → 통과/);
  });

  it("nextAction renders as 다음 조치", () => {
    const body = rerunBody();
    assert.match(body, /다음 조치: 에러 메시지를 사용자 친화적으로 수정하세요\./);
  });

  it("empty groups are still omitted", () => {
    const body = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeRerunComparison: true,
      rerunComparisonData: {
        comparable: true, sourceRunId: "s", newRunId: "n",
        summaryText: "좋아진 항목 1개.",
        improved: [{ itemId: "i1", title: "A", from: "failed", to: "passed", reason: "ok" }],
        newlyProblematic: [], stillOpen: [], unchanged: [],
      },
    }).body;
    assert.ok(body.includes("### 좋아진 항목"), "non-empty group present");
    assert.ok(!body.includes("### 새로 생긴 문제"), "empty newlyProblematic omitted");
    assert.ok(!body.includes("### 아직 남은 항목"), "empty stillOpen omitted");
    assert.ok(!body.includes("### 변화 없음"), "empty unchanged omitted");
  });

  it("rerunComparisonIncluded flag is true when section emitted", () => {
    const { rerunComparisonIncluded } = buildCommentBody({
      repoFullName: REPO, prNumber: PR_NUMBER, prTitle: PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
      includeRerunComparison: true, rerunComparisonData: RERUN_DATA,
    });
    assert.equal(rerunComparisonIncluded, true);
  });
});

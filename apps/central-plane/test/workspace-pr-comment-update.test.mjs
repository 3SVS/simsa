/**
 * workspace-pr-comment-update.test.mjs
 *
 * Tests for Stage 14 — PR comment update mode:
 *   - updateGitHubComment (PATCH)
 *   - getLatestPostedComment / getPrCommentById DB helpers
 *   - updatePrComment with bodyPreview
 *   - POST /comment with mode="update_latest"
 *   - PATCH /comment/:commentId
 *   - GET /comments returns latestPostedComment
 *   - insertUsageEvent (non-fatal)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const {
  buildCommentBody, bodyPreview, hasPrCommentScope, updateGitHubComment, postGitHubComment,
} = await import("../dist/workspace/pr-comment.js");
const {
  insertPrComment, updatePrComment, getPrComments,
  getLatestPostedComment, getPrCommentById,
} = await import("../dist/workspace/pr-comment-db.js");
const { insertUsageEvent } = await import("../dist/workspace/usage-events-db.js");
const { createApp } = await import("../dist/router.js");
const { encryptToken } = await import("../dist/crypto.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_REPO = "myorg/myapp";
const PR_NUMBER = 7;
const MOCK_PR_TITLE = "feat: add auth";

const ITEMS_MIXED = [
  { itemId: "i1", title: "로그인", status: "failed", userLabel: "안 맞음", reason: "JWT 없음", evidence: ["src/auth.ts"], nextAction: "JWT 추가" },
  { itemId: "i2", title: "알림", status: "inconclusive", userLabel: "확인 부족", reason: "구현 불명확", evidence: [], nextAction: "알림 파일 확인" },
  { itemId: "i3", title: "결제", status: "needs_decision", userLabel: "결정 필요", reason: "게이트웨이 미결정", evidence: [], nextAction: "결제 게이트웨이 결정" },
  { itemId: "i4", title: "대시보드", status: "passed", userLabel: "통과", reason: "구현됨", evidence: ["src/dash.ts"], nextAction: "" },
];
const SUMMARY_MIXED = { failed: 1, inconclusive: 1, needsDecision: 1, passed: 1 };

// ─── D1 mock (Stage 14 — supports getPrCommentById + getLatestPostedComment) ──

function makeDb(extra = {}) {
  const comments = new Map();
  const reviewRuns = new Map();
  const repos = new Map();
  const connections = new Map();
  const prs = new Map();
  const usageEvents = new Map();

  return {
    _comments: comments,
    _reviewRuns: reviewRuns,
    _repos: repos,
    _connections: connections,
    _prs: prs,
    _usageEvents: usageEvents,
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
                if (rec) {
                  rec.status = status;
                  rec.github_comment_id = ghId;
                  rec.github_comment_url = ghUrl;
                  rec.error_message = errMsg;
                  // bodyPrev null means COALESCE keeps existing
                  if (bodyPrev !== null) rec.body_preview = bodyPrev;
                  rec.updated_at = updatedAt;
                }
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
                repos.set(projId, { id, project_id: projId, repo_full_name: repoFull, owner, repo_name: repoName, default_branch: defBranch, is_private: priv, html_url: htmlUrl, created_at: createdAt, updated_at: updatedAt });
              }
              if (sql.includes("workspace_github_connections")) {
                const data = extra._connStore ?? connections;
                if (args[0]) data.set(args[1], { id: args[0], user_key: args[1], github_user_id: args[2], github_login: args[3], github_name: args[4], avatar_url: args[5], access_token_enc: args[6], scopes: args[7], created_at: args[8], updated_at: args[9] });
              }
              if (sql.includes("workspace_linked_prs")) {
                const [id, projId, repoFull, prNum, prTitle, prState, htmlUrl, headBranch, baseBranch, selJson, updatedAt] = args;
                prs.set(`${projId}:${prNum}`, { id, project_id: projId, repo_full_name: repoFull, pr_number: prNum, pr_title: prTitle, pr_state: prState, html_url: htmlUrl, pr_head_branch: headBranch, pr_base_branch: baseBranch, selected_item_ids_json: selJson, updated_at: updatedAt });
              }
              if (sql.includes("INSERT INTO workspace_usage_events")) {
                const [id, userKey, projId, eventType, metaJson, createdAt] = args;
                usageEvents.set(id, { id, user_key: userKey, project_id: projId, event_type: eventType, metadata_json: metaJson, created_at: createdAt });
              }
            },
            async first() {
              if (sql.includes("FROM workspace_pr_review_runs")) {
                for (const run of reviewRuns.values()) {
                  if (run.project_id === args[0] && run.repo_full_name === args[1] && run.pr_number === args[2]) return run;
                }
                return null;
              }
              if (sql.includes("FROM workspace_project_repos")) {
                return repos.get(args[0]) ?? null;
              }
              if (sql.includes("FROM workspace_github_connections")) {
                const data = extra._connStore ?? connections;
                return data.get(args[0]) ?? null;
              }
              if (sql.includes("FROM workspace_pr_comments")) {
                if (sql.includes("status = 'posted'")) {
                  // getLatestPostedComment
                  const matches = [...comments.values()]
                    .filter((c) => c.project_id === args[0] && c.repo_full_name === args[1] && c.pr_number === args[2] && c.status === "posted" && c.github_comment_id !== null)
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                  return matches[0] ?? null;
                } else {
                  // getPrCommentById — single id arg
                  return comments.get(args[0]) ?? null;
                }
              }
              if (sql.includes("FROM workspace_workspace_projects") || sql.includes("FROM workspace_projects")) {
                // Ownership hardening: every project id resolves to a row owned
                // by this file's route-test userKey.
                return { id: args[0], user_key: "user123", title: "T", idea: "",
                  understood_json: null, product_spec_json: "{}", items_json: "[]",
                  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
              }
              return null;
            },
            async all() {
              if (sql.includes("FROM workspace_pr_comments")) {
                const result = [...comments.values()]
                  .filter((c) => c.project_id === args[0] && c.repo_full_name === args[1] && c.pr_number === args[2])
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                return { results: result };
              }
              if (sql.includes("FROM workspace_linked_prs")) {
                const result = [...prs.values()].filter((p) => p.project_id === args[0]);
                return { results: result };
              }
              return { results: [] };
            },
          };
        },
      };
    },
    ...extra,
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeDb(overrides._dbExtra ?? {}),
    CONCLAVE_TOKEN_KEK: "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdA==",
    ANTHROPIC_API_KEY: undefined,
    WORKSPACE_GH_CLIENT_ID: "test-client-id",
    WORKSPACE_GH_CLIENT_SECRET: "test-secret",
    WORKSPACE_GH_DASHBOARD_URL: "http://localhost:3002",
    PUBLIC_BASE_URL: "http://localhost:8787",
    ...overrides,
  };
}

async function makeEnvWithToken(overrides = {}) {
  const kek = randomBytes(32).toString("base64");
  const enc = await encryptToken("ghp_faketoken", kek);
  const connStore = new Map();
  connStore.set("user123", {
    id: "conn1", user_key: "user123", github_user_id: "42",
    github_login: "tester", github_name: "Test User",
    avatar_url: null, access_token_enc: enc, scopes: "read:user public_repo",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });
  return makeEnv({ ...overrides, CONCLAVE_TOKEN_KEK: kek, _dbExtra: { _connStore: connStore } });
}

function seedRepo(env, projectId = "proj1") {
  env.DB._repos.set(projectId, {
    id: "repo1", project_id: projectId, repo_full_name: MOCK_REPO,
    owner: "myorg", repo_name: "myapp", default_branch: "main",
    is_private: 0, html_url: "https://github.com/myorg/myapp",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });
}

function seedReviewRun(env) {
  const id = "wprr_test01";
  const resultData = JSON.stringify({ results: ITEMS_MIXED, summary: SUMMARY_MIXED });
  env.DB._reviewRuns.set(id, {
    id, project_id: "proj1", user_key: "user123",
    repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
    linked_pr_id: null,
    selected_item_ids_json: JSON.stringify(["i1", "i2", "i3", "i4"]),
    status: "failed", result_json: resultData, error_message: null,
    created_at: "2026-06-12T00:00:00Z", updated_at: "2026-06-12T00:00:00Z",
  });
  env.DB._prs.set(`proj1:${PR_NUMBER}`, {
    id: "lpr1", project_id: "proj1", repo_full_name: MOCK_REPO,
    pr_number: PR_NUMBER, pr_title: MOCK_PR_TITLE, pr_state: "open",
    html_url: `https://github.com/${MOCK_REPO}/pull/${PR_NUMBER}`,
    pr_head_branch: "feat/auth", pr_base_branch: "main",
    selected_item_ids_json: JSON.stringify(["i1", "i2", "i3"]),
    updated_at: "2026-06-12T00:00:00Z",
  });
}

function seedPostedComment(env, id = "wprc_existing1", ghCommentId = "777") {
  env.DB._comments.set(id, {
    id, project_id: "proj1", user_key: "user123",
    repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
    review_run_id: "wprr_test01",
    selected_item_ids_json: JSON.stringify(["i1", "i2"]),
    github_comment_id: ghCommentId,
    github_comment_url: `https://github.com/${MOCK_REPO}/issues/${PR_NUMBER}#issuecomment-${ghCommentId}`,
    body_preview: "기존 코멘트 미리보기",
    status: "posted", error_message: null,
    created_at: "2026-06-12T08:00:00Z", updated_at: "2026-06-12T08:00:00Z",
  });
}

function makeRequest(method, path, body = null) {
  const init = { method, headers: { "content-type": "application/json", origin: "http://localhost:3002" } };
  if (body !== null) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

// ─── Unit: updateGitHubComment ────────────────────────────────────────────────

describe("updateGitHubComment", () => {
  it("returns ok:true with updated id and url on PATCH 200", async () => {
    const mockResp = { id: 777, html_url: "https://github.com/myorg/myapp/issues/7#issuecomment-777" };
    const mockFetch = async () => new Response(JSON.stringify(mockResp), { status: 200 });

    const result = await updateGitHubComment(
      { owner: "myorg", repo: "myapp", githubCommentId: "777", body: "updated body", token: "ghp_fake" },
      mockFetch,
    );
    assert.ok(result.ok, "should succeed");
    assert.equal(result.id, "777");
    assert.ok(result.url.includes("issuecomment-777"));
  });

  it("returns ok:false with status 403 on GitHub auth error", async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ message: "Resource not accessible by integration" }), { status: 403 });

    const result = await updateGitHubComment(
      { owner: "myorg", repo: "myapp", githubCommentId: "777", body: "body", token: "ghp_bad" },
      mockFetch,
    );
    assert.ok(!result.ok);
    assert.equal(result.status, 403);
  });

  it("returns ok:false with status 404 when comment not found", async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });

    const result = await updateGitHubComment(
      { owner: "myorg", repo: "myapp", githubCommentId: "999", body: "body", token: "ghp_fake" },
      mockFetch,
    );
    assert.ok(!result.ok);
    assert.equal(result.status, 404);
  });

  it("handles network error gracefully", async () => {
    const mockFetch = async () => { throw new Error("ECONNREFUSED"); };

    const result = await updateGitHubComment(
      { owner: "myorg", repo: "myapp", githubCommentId: "777", body: "body", token: "ghp_fake" },
      mockFetch,
    );
    assert.ok(!result.ok);
    assert.ok(result.error.includes("network_error"));
  });
});

// ─── DB: getLatestPostedComment + getPrCommentById ────────────────────────────

describe("getLatestPostedComment", () => {
  it("returns null when no posted comments", async () => {
    const env = makeEnv();
    const result = await getLatestPostedComment(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.equal(result, null);
  });

  it("returns the most recent posted comment with github_comment_id", async () => {
    const env = makeEnv();
    // Insert a posted comment directly
    env.DB._comments.set("wprc_p1", {
      id: "wprc_p1", project_id: "proj1", user_key: "user123",
      repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
      review_run_id: null, selected_item_ids_json: "[]",
      github_comment_id: "888",
      github_comment_url: "https://github.com/myorg/myapp/issues/7#issuecomment-888",
      body_preview: "test preview", status: "posted",
      error_message: null, created_at: "2026-06-12T10:00:00Z", updated_at: "2026-06-12T10:00:00Z",
    });

    const result = await getLatestPostedComment(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.ok(result !== null);
    assert.equal(result.githubCommentId, "888");
    assert.equal(result.status, "posted");
  });

  it("ignores draft and error status comments", async () => {
    const env = makeEnv();
    env.DB._comments.set("wprc_draft", {
      id: "wprc_draft", project_id: "proj1", user_key: "user123",
      repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
      review_run_id: null, selected_item_ids_json: "[]",
      github_comment_id: null, github_comment_url: null,
      body_preview: "draft", status: "draft",
      error_message: null, created_at: "2026-06-12T11:00:00Z", updated_at: "2026-06-12T11:00:00Z",
    });

    const result = await getLatestPostedComment(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.equal(result, null);
  });
});

describe("getPrCommentById", () => {
  it("returns null for unknown id", async () => {
    const env = makeEnv();
    const result = await getPrCommentById(env, "wprc_unknown");
    assert.equal(result, null);
  });

  it("returns comment record for known id", async () => {
    const env = makeEnv();
    seedPostedComment(env, "wprc_known", "555");

    const result = await getPrCommentById(env, "wprc_known");
    assert.ok(result !== null);
    assert.equal(result.id, "wprc_known");
    assert.equal(result.githubCommentId, "555");
    assert.equal(result.status, "posted");
  });
});

describe("updatePrComment with bodyPreview", () => {
  it("updates bodyPreview when provided", async () => {
    const env = makeEnv();
    const rec = await insertPrComment(env, {
      projectId: "proj1", userKey: "u1", repoFullName: MOCK_REPO, prNumber: 1,
      selectedItemIds: [], bodyPreview: "original preview", status: "draft",
    });
    await updatePrComment(env, rec.id, { status: "posted", githubCommentId: "42", githubCommentUrl: "https://x", bodyPreview: "updated preview" });
    const comments = await getPrComments(env, "proj1", MOCK_REPO, 1);
    assert.equal(comments[0].bodyPreview, "updated preview");
  });
});

// ─── insertUsageEvent ─────────────────────────────────────────────────────────

describe("insertUsageEvent", () => {
  it("records an event in the mock DB", async () => {
    const env = makeEnv();
    await insertUsageEvent(env, {
      userKey: "user123",
      projectId: "proj1",
      eventType: "workspace_pr_comment_posted",
      metadata: { prNumber: 7 },
    });
    const events = [...env.DB._usageEvents.values()];
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "workspace_pr_comment_posted");
    assert.equal(events[0].user_key, "user123");
  });

  it("is non-fatal — does not throw on DB error", async () => {
    const badEnv = { DB: { prepare: () => { throw new Error("DB down"); } } };
    await assert.doesNotReject(() => insertUsageEvent(badEnv, { userKey: "u", eventType: "workspace_pr_comment_posted" }));
  });
});

// ─── Route: POST /comment with mode="update_latest" ──────────────────────────

describe("POST /comment with mode=update_latest", () => {
  it("updates existing comment when latestPostedComment exists", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);
    seedPostedComment(env, "wprc_existing1", "777");

    const mockFetch = async (url, init) => {
      assert.ok(init.method === "PATCH", "should PATCH, not POST");
      return new Response(JSON.stringify({ id: 777, html_url: `https://github.com/${MOCK_REPO}/issues/${PR_NUMBER}#issuecomment-777` }), { status: 200 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
      mode: "update_latest",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.updated, true, "should indicate update");
  });

  it("falls back to new comment when no existing posted comment", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);
    // no existing posted comment

    let callCount = 0;
    const mockFetch = async (url, init) => {
      callCount++;
      assert.equal(init.method, "POST", "should POST (new comment)");
      return new Response(JSON.stringify({ id: 888, html_url: `https://github.com/${MOCK_REPO}/issues/${PR_NUMBER}#issuecomment-888` }), { status: 201 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
      mode: "update_latest",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.updated, false, "should be new comment");
    assert.equal(callCount, 1);
  });

  it("records workspace_pr_comment_updated usage event on update", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);
    seedPostedComment(env, "wprc_existing1", "777");

    const mockFetch = async () =>
      new Response(JSON.stringify({ id: 777, html_url: `https://github.com/${MOCK_REPO}/issues/${PR_NUMBER}#issuecomment-777` }), { status: 200 });

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
      mode: "update_latest",
    });
    await app.fetch(req, env);

    const events = [...env.DB._usageEvents.values()];
    const updateEvent = events.find((e) => e.event_type === "workspace_pr_comment_updated");
    assert.ok(updateEvent, "should have recorded update event");
  });
});

// ─── Route: PATCH /comment/:commentId ────────────────────────────────────────

describe("PATCH /workspace/projects/:id/github/pulls/:number/comment/:commentId", () => {
  it("updates comment body via PATCH and returns ok:true", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);
    seedPostedComment(env, "wprc_patch1", "999");

    const mockFetch = async (url, init) => {
      assert.ok(url.includes("/comments/999"), "should call comment-specific endpoint");
      assert.equal(init.method, "PATCH");
      return new Response(JSON.stringify({ id: 999, html_url: `https://github.com/${MOCK_REPO}/issues/comments/999` }), { status: 200 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("PATCH", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/wprc_patch1`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.comment.status, "posted");
    assert.ok(data.comment.githubCommentUrl.includes("999"));
  });

  it("returns 404 when comment not in D1", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);

    const app = createApp();
    const req = makeRequest("PATCH", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/wprc_missing`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "comment_not_found");
    assert.equal(resp.status, 404);
  });

  it("returns 400 when comment has no github_comment_id", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    // Insert a draft comment (no github_comment_id)
    env.DB._comments.set("wprc_draft1", {
      id: "wprc_draft1", project_id: "proj1", user_key: "user123",
      repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
      review_run_id: null, selected_item_ids_json: "[]",
      github_comment_id: null, github_comment_url: null,
      body_preview: "draft", status: "draft",
      error_message: null, created_at: "2026-06-12T10:00:00Z", updated_at: "2026-06-12T10:00:00Z",
    });

    const app = createApp();
    const req = makeRequest("PATCH", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/wprc_draft1`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "comment_not_posted");
    assert.equal(resp.status, 400);
  });

  it("returns github_scope_required when scope is insufficient", async () => {
    const env = await makeEnvWithToken();
    // Override scopes — _connStore is spread directly onto DB (not under _dbExtra)
    const conn = env.DB._connStore?.get("user123");
    if (conn) conn.scopes = "read:user";
    seedRepo(env);
    seedPostedComment(env, "wprc_scopetest", "111");

    const app = createApp();
    const req = makeRequest("PATCH", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/wprc_scopetest`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "github_scope_required");
    assert.equal(resp.status, 403);
  });

  it("records workspace_pr_comment_updated usage event", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);
    seedPostedComment(env, "wprc_usage1", "555");

    const mockFetch = async () =>
      new Response(JSON.stringify({ id: 555, html_url: `https://github.com/${MOCK_REPO}/issues/comments/555` }), { status: 200 });

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("PATCH", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/wprc_usage1`, {
      userKey: "user123",
    });
    await app.fetch(req, env);

    const events = [...env.DB._usageEvents.values()];
    const evt = events.find((e) => e.event_type === "workspace_pr_comment_updated");
    assert.ok(evt, "should have recorded usage event");
  });
});

// ─── Route: GET /comments returns latestPostedComment ────────────────────────

describe("GET /comments — latestPostedComment field", () => {
  it("returns latestPostedComment: null when no posted comments", async () => {
    const env = makeEnv();
    seedRepo(env);

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comments?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true);
    assert.equal(data.latestPostedComment, null);
  });

  it("returns latestPostedComment with id and githubCommentUrl when exists", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedPostedComment(env, "wprc_latest1", "321");

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comments?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true);
    assert.ok(data.latestPostedComment !== null, "should have latestPostedComment");
    assert.equal(data.latestPostedComment.id, "wprc_latest1");
    assert.ok(data.latestPostedComment.githubCommentUrl.includes("321"));
  });

  it("returns comments list alongside latestPostedComment", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedPostedComment(env, "wprc_list1", "400");

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comments?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true);
    assert.equal(data.comments.length, 1);
    assert.ok(data.latestPostedComment !== null);
  });
});

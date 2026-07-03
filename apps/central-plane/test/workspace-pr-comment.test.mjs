/**
 * workspace-pr-comment.test.mjs
 *
 * Tests for:
 *   - pr-comment.ts: buildCommentBody, bodyPreview, hasPrCommentScope
 *   - pr-comment-db.ts: CRUD helpers
 *   - Route: POST preview / POST comment / GET comments
 *
 * No network calls — GitHub API is mocked via fetchImpl.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { buildCommentBody, bodyPreview, hasPrCommentScope } = await import("../dist/workspace/pr-comment.js");
const { insertPrComment, updatePrComment, getPrComments } = await import("../dist/workspace/pr-comment-db.js");
const { createApp } = await import("../dist/router.js");

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const MOCK_PR_TITLE = "feat: add auth";
const MOCK_REPO = "myorg/myapp";
const PR_NUMBER = 7;

const ITEMS_MIXED = [
  { itemId: "i1", title: "로그인", status: "failed", userLabel: "안 맞음", reason: "JWT 없음", evidence: ["src/auth.ts"], nextAction: "JWT 추가" },
  { itemId: "i2", title: "알림", status: "inconclusive", userLabel: "확인 부족", reason: "구현 불명확", evidence: [], nextAction: "알림 파일 확인" },
  { itemId: "i3", title: "결제", status: "needs_decision", userLabel: "결정 필요", reason: "게이트웨이 미결정", evidence: [], nextAction: "결제 게이트웨이 결정" },
  { itemId: "i4", title: "대시보드", status: "passed", userLabel: "통과", reason: "구현됨", evidence: ["src/dash.ts"], nextAction: "" },
];
const SUMMARY_MIXED = { failed: 1, inconclusive: 1, needsDecision: 1, passed: 1 };

// English-data variant for locale "en" tests (item text is data, not labels —
// the no-Korean assertion needs the data itself to be Korean-free).
const ITEMS_MIXED_EN = [
  { itemId: "i1", title: "Login", status: "failed", userLabel: "Issue found", reason: "JWT missing", evidence: ["src/auth.ts"], nextAction: "Add JWT" },
  { itemId: "i2", title: "Notifications", status: "inconclusive", userLabel: "Not verified", reason: "Implementation unclear", evidence: [], nextAction: "Check notification files" },
  { itemId: "i3", title: "Payments", status: "needs_decision", userLabel: "Needs decision", reason: "Gateway undecided", evidence: [], nextAction: "Pick a payment gateway" },
  { itemId: "i4", title: "Dashboard", status: "passed", userLabel: "Passed", reason: "Implemented", evidence: ["src/dash.ts"], nextAction: "" },
];

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeDb(extra = {}) {
  const comments = new Map();
  const reviewRuns = new Map();
  const repos = new Map();
  const connections = new Map();
  const prs = new Map();

  return {
    _comments: comments,
    _reviewRuns: reviewRuns,
    _repos: repos,
    _connections: connections,
    _prs: prs,
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
                // Stage 14: args = [status, ghId, ghUrl, errMsg, bodyPrev, updatedAt, id]
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
              if (sql.includes("upsert") || sql.includes("ON CONFLICT") || sql.includes("INSERT INTO workspace_project_repos")) {
                const [id, projId, repoFull, owner, repoName, defBranch, priv, htmlUrl, createdAt, updatedAt] = args;
                repos.set(projId, { id, project_id: projId, repo_full_name: repoFull, owner, repo_name: repoName, default_branch: defBranch, is_private: priv, html_url: htmlUrl, created_at: createdAt, updated_at: updatedAt });
              }
              if (sql.includes("INSERT INTO workspace_github_connections") || sql.includes("workspace_github_connections") && sql.includes("UPDATE")) {
                const data = extra._connStore ?? connections;
                if (args[0]) data.set(args[1], { id: args[0], user_key: args[1], github_user_id: args[2], github_login: args[3], github_name: args[4], avatar_url: args[5], access_token_enc: args[6], scopes: args[7], created_at: args[8], updated_at: args[9] });
              }
              if (sql.includes("INSERT INTO workspace_linked_prs") || sql.includes("ON CONFLICT") && sql.includes("workspace_linked_prs")) {
                const [id, projId, repoFull, prNum, prTitle, prState, htmlUrl, headBranch, baseBranch, selJson, updatedAt] = args;
                prs.set(`${projId}:${prNum}`, { id, project_id: projId, repo_full_name: repoFull, pr_number: prNum, pr_title: prTitle, pr_state: prState, html_url: htmlUrl, pr_head_branch: headBranch, pr_base_branch: baseBranch, selected_item_ids_json: selJson, updated_at: updatedAt });
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
                const result = [...comments.values()].filter(
                  (c) => c.project_id === args[0] && c.repo_full_name === args[1] && c.pr_number === args[2]
                ).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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

// Pre-encrypt a token so the decrypt works consistently
const { encryptToken } = await import("../dist/crypto.js");
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

function seedReviewRun(env, withResults = true, items = ITEMS_MIXED) {
  const id = "wprr_test01";
  const resultData = withResults
    ? JSON.stringify({ results: items, summary: SUMMARY_MIXED })
    : null;
  env.DB._reviewRuns.set(id, {
    id, project_id: "proj1", user_key: "user123",
    repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
    linked_pr_id: null,
    selected_item_ids_json: JSON.stringify(["i1", "i2", "i3", "i4"]),
    status: "failed",
    result_json: resultData,
    error_message: null,
    created_at: "2026-06-12T00:00:00Z",
    updated_at: "2026-06-12T00:00:00Z",
  });
  // Also seed linked PR
  env.DB._prs.set(`proj1:${PR_NUMBER}`, {
    id: "lpr1", project_id: "proj1", repo_full_name: MOCK_REPO,
    pr_number: PR_NUMBER, pr_title: MOCK_PR_TITLE, pr_state: "open",
    html_url: `https://github.com/${MOCK_REPO}/pull/${PR_NUMBER}`,
    pr_head_branch: "feat/auth", pr_base_branch: "main",
    selected_item_ids_json: JSON.stringify(["i1", "i2", "i3"]),
    updated_at: "2026-06-12T00:00:00Z",
  });
}

// ─── Unit tests: buildCommentBody ─────────────────────────────────────────────

describe("buildCommentBody", () => {
  it("includes disclaimer about PR scope", () => {
    const { body } = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
    });
    assert.ok(body.includes("전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"));
  });

  it("includes failed items in 고쳐야 할 항목", () => {
    const { body } = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
    });
    assert.ok(body.includes("안 맞음"));
    assert.ok(body.includes("로그인"));
  });

  it("excludes passed items from 고쳐야 할 항목 section", () => {
    const passedOnly = ITEMS_MIXED.filter((i) => i.status === "passed");
    const { body } = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: passedOnly,
      summary: { failed: 0, inconclusive: 0, needsDecision: 0, passed: 1 },
    });
    assert.ok(body.includes("수정이 필요한 항목이 없습니다"), "passed-only should say no fixable items");
  });

  it("truncates at MAX_COMMENT_CHARS and adds truncation notice", () => {
    const longItem = {
      itemId: "long", title: "긴 항목", status: "failed", userLabel: "안 맞음",
      reason: "x".repeat(70000), evidence: [], nextAction: "수정 필요",
    };
    const { body, truncated } = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: 1, prTitle: "test",
      selectedItems: [longItem], summary: { failed: 1, inconclusive: 0, needsDecision: 0, passed: 0 },
    });
    assert.ok(truncated, "should be truncated");
    assert.ok(body.length <= 60100, "should not exceed limit + small overhead");
    assert.ok(body.includes("잘렸습니다"), "should include truncation notice");
  });
});

// ─── Locale (Stage: EN/KO comment body) ──────────────────────────────────────

describe("buildCommentBody locale", () => {
  it("defaults to Korean when locale is absent", () => {
    const { body } = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED,
    });
    assert.ok(body.includes("PR 확인 결과"));
    assert.ok(body.includes("고쳐야 할 항목"));
    assert.ok(body.includes("❌ 안 맞음"));
  });

  it('locale "ko" matches the default output', () => {
    const opts = {
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED, summary: SUMMARY_MIXED, runTimestamp: "2026-06-12T00:00:00Z",
    };
    const def = buildCommentBody(opts);
    const ko = buildCommentBody({ ...opts, locale: "ko" });
    assert.equal(ko.body, def.body);
  });

  it('locale "en" produces English labels and no Korean characters', () => {
    const { body } = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED_EN, summary: SUMMARY_MIXED,
      runTimestamp: "2026-06-12T00:00:00Z",
      locale: "en",
    });
    assert.ok(body.includes("PR review results"));
    assert.ok(body.includes("| Result | Count |"));
    assert.ok(body.includes("❌ Issue found"));
    assert.ok(body.includes("⚠️ Not verified"));
    assert.ok(body.includes("🟣 Needs decision"));
    assert.ok(body.includes("✅ Passed"));
    assert.ok(body.includes("### Items to fix (3)"));
    assert.ok(body.includes("**Reason:**"));
    assert.ok(body.includes("It does not cover the entire repository or the deployed service as a whole."));
    assert.ok(body.includes("About this comment"));
    assert.ok(!/[가-힣]/.test(body), `EN body must contain no Korean, got: ${body.match(/[^\n]*[가-힣][^\n]*/)?.[0]}`);
  });

  it('locale "en" keeps markdown structure identical to ko (same heading/table shape)', () => {
    const opts = {
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED_EN, summary: SUMMARY_MIXED,
    };
    const en = buildCommentBody({ ...opts, locale: "en" }).body;
    const ko = buildCommentBody({ ...opts, locale: "ko" }).body;
    const shape = (s) => s.split("\n").map((line) => line.replace(/[^#|>\-`*_<]/g, "").trim()).join("\n");
    assert.equal(shape(en), shape(ko));
  });

  it('locale "en" localizes comparison and rerun comparison sections', () => {
    const comparisonData = {
      previousSummary: { passed: 0, failed: 2, inconclusive: 1, needsDecision: 0 },
      latestSummary: { passed: 2, failed: 0, inconclusive: 1, needsDecision: 0 },
      improved: [{ itemId: "i1", title: "Login", from: "failed", to: "passed", reason: "Improved from Issue found to Passed." }],
      stillOpen: [{ itemId: "i2", title: "Notifications", status: "inconclusive", reason: "Still unclear" }],
      newlyProblematic: [],
    };
    const comp = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED_EN, summary: SUMMARY_MIXED,
      includeComparison: true, comparisonData,
      locale: "en",
    });
    assert.ok(comp.comparisonIncluded);
    assert.ok(comp.body.includes("## Previous vs latest comparison"));
    assert.ok(comp.body.includes("### Improved items (1)"));
    assert.ok(comp.body.includes("- Issue found: 2 → 0"));
    assert.ok(!/[가-힣]/.test(comp.body));

    const rerunComparisonData = {
      comparable: true, sourceRunId: "wprr_src", newRunId: "wprr_new",
      improved: [{ itemId: "i1", title: "Login", from: "failed", to: "passed", reason: "Improved from Issue found to Passed." }],
      stillOpen: [{ itemId: "i2", title: "Notifications", status: "inconclusive", reason: "Still unclear", from: "inconclusive", nextAction: "Check notification files" }],
      newlyProblematic: [],
      unchanged: [{ itemId: "i4", title: "Dashboard", status: "passed", from: "passed" }],
      summaryText: "1 improved, 1 still open, 1 unchanged.",
    };
    const rerun = buildCommentBody({
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER, prTitle: MOCK_PR_TITLE,
      selectedItems: ITEMS_MIXED_EN, summary: SUMMARY_MIXED,
      includeRerunComparison: true, rerunComparisonData,
      locale: "en",
    });
    assert.ok(rerun.rerunComparisonIncluded);
    assert.ok(rerun.body.includes("## Re-review comparison"));
    assert.ok(rerun.body.includes("- Login: Issue found → Passed"));
    assert.ok(rerun.body.includes("  - Next action: Check notification files"));
    assert.ok(!/[가-힣]/.test(rerun.body));
  });
});

describe("hasPrCommentScope", () => {
  it("returns true for public_repo scope", () => {
    assert.ok(hasPrCommentScope("read:user public_repo"));
  });
  it("returns true for repo scope", () => {
    assert.ok(hasPrCommentScope("repo"));
  });
  it("returns false for read:user only", () => {
    assert.ok(!hasPrCommentScope("read:user"));
  });
  it("returns false for undefined", () => {
    assert.ok(!hasPrCommentScope(undefined));
  });
});

describe("bodyPreview", () => {
  it("returns full body if short", () => {
    const short = "hello world";
    assert.equal(bodyPreview(short), short);
  });
  it("truncates long body and appends ellipsis", () => {
    const long = "x".repeat(400);
    const result = bodyPreview(long);
    assert.ok(result.endsWith("…"));
    assert.ok(result.length < long.length);
  });
});

// ─── DB tests ─────────────────────────────────────────────────────────────────

describe("pr-comment-db", () => {
  it("insertPrComment → getPrComments round-trip", async () => {
    const env = makeEnv();
    const inserted = await insertPrComment(env, {
      projectId: "proj1", userKey: "user123",
      repoFullName: MOCK_REPO, prNumber: PR_NUMBER,
      reviewRunId: "wprr_abc",
      selectedItemIds: ["i1", "i2"],
      bodyPreview: "미리보기 텍스트",
      status: "draft",
    });
    assert.ok(inserted.id.startsWith("wprc_"));
    assert.equal(inserted.status, "draft");

    const comments = await getPrComments(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].id, inserted.id);
  });

  it("updatePrComment marks posted with githubCommentUrl", async () => {
    const env = makeEnv();
    const rec = await insertPrComment(env, {
      projectId: "proj1", userKey: "u1",
      repoFullName: MOCK_REPO, prNumber: 1,
      selectedItemIds: [], bodyPreview: "test", status: "draft",
    });
    await updatePrComment(env, rec.id, {
      status: "posted",
      githubCommentId: "gh-99",
      githubCommentUrl: "https://github.com/org/repo/issues/1#issuecomment-99",
    });
    const comments = await getPrComments(env, "proj1", MOCK_REPO, 1);
    assert.equal(comments[0].status, "posted");
    assert.equal(comments[0].githubCommentUrl, "https://github.com/org/repo/issues/1#issuecomment-99");
  });
});

// ─── Route tests ──────────────────────────────────────────────────────────────

function makeRequest(method, path, body = null, extra = {}) {
  const init = { method, headers: { "content-type": "application/json", origin: "http://localhost:3002", ...extra }, };
  if (body !== null) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

describe("POST /workspace/projects/:id/github/pulls/:number/comment/preview", () => {
  it("returns ok:true with body and selectedItemIds", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const app = createApp();
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
      selectedItemIds: ["i1", "i2", "i3"],
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(typeof data.comment.body === "string");
    assert.ok(Array.isArray(data.comment.selectedItemIds));
    assert.equal(data.comment.summary.failed, 1);
  });

  it("includes disclaimer in preview body", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const app = createApp();
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.ok(data.ok);
    assert.ok(data.comment.body.includes("전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"));
  });

  it("requires review run — returns no_review_run if missing", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    // no review run seeded

    const app = createApp();
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "no_review_run");
  });

  it('accepts locale "en" and produces an English body with no Korean', async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env, true, ITEMS_MIXED_EN);

    const app = createApp();
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
      locale: "en",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(data.comment.body.includes("It does not cover the entire repository or the deployed service as a whole."));
    assert.ok(data.comment.body.includes("Items to fix"));
    assert.ok(!/[가-힣]/.test(data.comment.body), "EN preview body must contain no Korean");
  });

  it("defaults to Korean when locale is omitted or not en/ko", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const app = createApp();
    // omitted
    const respDefault = await app.fetch(makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
    }), env);
    const dataDefault = await respDefault.json();
    assert.ok(dataDefault.ok);
    assert.ok(dataDefault.comment.body.includes("전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"));

    // unknown value falls back to ko (still accepted — no 400)
    const respBad = await app.fetch(makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
      locale: "fr",
    }), env);
    const dataBad = await respBad.json();
    assert.ok(dataBad.ok);
    assert.ok(dataBad.comment.body.includes("전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"));
  });

  it("excludes passed items from summary", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const app = createApp();
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment/preview`, {
      userKey: "user123",
      selectedItemIds: ["i4"], // passed only
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.ok(data.ok);
    assert.equal(data.comment.summary.failed, 0);
    assert.equal(data.comment.summary.passed, 1);
  });
});

describe("POST /workspace/projects/:id/github/pulls/:number/comment", () => {
  it("posts comment and returns githubCommentUrl on success", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const mockGhResp = { id: 12345, html_url: "https://github.com/myorg/myapp/issues/7#issuecomment-12345" };
    const mockFetch = async (url, init) => {
      if (url.includes("/comments")) {
        return new Response(JSON.stringify(mockGhResp), { status: 201 });
      }
      return new Response("not found", { status: 404 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
      selectedItemIds: ["i1", "i2"],
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.comment.status, "posted");
    assert.ok(data.comment.githubCommentUrl.includes("issuecomment-12345"));
  });

  it('posts an English body to GitHub when locale "en"', async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env, true, ITEMS_MIXED_EN);

    let postedBody = null;
    const mockFetch = async (url, init) => {
      if (url.includes("/comments")) {
        postedBody = JSON.parse(init.body).body;
        return new Response(JSON.stringify({ id: 777, html_url: "https://github.com/myorg/myapp/issues/7#issuecomment-777" }), { status: 201 });
      }
      return new Response("not found", { status: 404 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
      locale: "en",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.ok(typeof postedBody === "string");
    assert.ok(postedBody.includes("PR review results"));
    assert.ok(!/[가-힣]/.test(postedBody), "posted EN body must contain no Korean");
  });

  it("403 from GitHub → returns github_scope_required error", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const mockFetch = async (url) => {
      if (url.includes("/comments")) {
        return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), { status: 403 });
      }
      return new Response("not found", { status: 404 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "github_scope_required");
  });

  it("scope check: returns github_scope_required if connection lacks public_repo", async () => {
    const env = await makeEnvWithToken();
    // Override the connection's scopes to read:user only
    const conn = env.DB._dbExtra?._connStore?.get("user123") ?? [...(env.DB._connStore?.values() ?? [])].find(c => c.user_key === "user123");
    if (conn) conn.scopes = "read:user";
    seedRepo(env);
    seedReviewRun(env);

    const app = createApp();
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
    });
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "github_scope_required");
  });

  it("saves github_comment_url in D1 after successful post", async () => {
    const env = await makeEnvWithToken();
    seedRepo(env);
    seedReviewRun(env);

    const mockFetch = async (url) => {
      if (url.includes("/comments")) {
        return new Response(JSON.stringify({ id: 999, html_url: "https://github.com/myorg/myapp/issues/7#issuecomment-999" }), { status: 201 });
      }
      return new Response("not found", { status: 404 });
    };

    const app = createApp({ fetch: mockFetch });
    const req = makeRequest("POST", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comment`, {
      userKey: "user123",
    });
    await app.fetch(req, env);

    const comments = [...env.DB._comments.values()];
    assert.equal(comments.length, 1);
    assert.equal(comments[0].status, "posted");
    assert.ok(comments[0].github_comment_url.includes("issuecomment-999"));
  });
});

describe("GET /workspace/projects/:id/github/pulls/:number/comments", () => {
  it("returns empty array when no comments exist", async () => {
    const env = makeEnv();
    seedRepo(env);

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comments?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true);
    assert.deepEqual(data.comments, []);
  });

  it("returns list of previously posted comments", async () => {
    const env = makeEnv();
    seedRepo(env);
    // Insert directly into DB mock
    env.DB._comments.set("wprc_abc", {
      id: "wprc_abc", project_id: "proj1", user_key: "user123",
      repo_full_name: MOCK_REPO, pr_number: PR_NUMBER,
      review_run_id: null, selected_item_ids_json: "[]",
      github_comment_id: "555", github_comment_url: "https://github.com/myorg/myapp/issues/7#issuecomment-555",
      body_preview: "미리보기", status: "posted",
      error_message: null, created_at: "2026-06-12T10:00:00Z", updated_at: "2026-06-12T10:00:00Z",
    });

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/comments?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true);
    assert.equal(data.comments.length, 1);
    assert.equal(data.comments[0].status, "posted");
    assert.ok(data.comments[0].githubCommentUrl.includes("issuecomment-555"));
  });
});

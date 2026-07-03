/**
 * Stage 11: PR review DB helpers + review logic + route tests.
 * GitHub API and Anthropic are fully mocked — no network calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { insertReviewRun, updateReviewRun, getLatestReviewRun } = await import("../dist/workspace/pr-review-db.js");
const { reviewPRAgainstItems, deriveRunStatus } = await import("../dist/workspace/pr-review.js");
const { fetchPRFiles, buildDiffSummary, MAX_FILES, MAX_PATCH_CHARS_PER_FILE, MAX_TOTAL_PATCH_CHARS } = await import("../dist/workspace/github-pr.js");
const { createApp } = await import("../dist/router.js");

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeMockDb(extra = {}) {
  const state = {
    reviewRuns: new Map(),
    repos: new Map(),
    connections: new Map(),
    prs: new Map(),
    projects: new Map(),
    ...extra,
  };
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          if (/FROM workspace_pr_review_runs/.test(sql)) {
            const [pid, rfn, pnum] = bound;
            const key = `${pid}::${rfn}::${pnum}`;
            // latest = sort by updated_at
            const matches = [...state.reviewRuns.values()]
              .filter(r => r.project_id === pid && r.repo_full_name === rfn && r.pr_number === pnum)
              .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            return matches[0] ?? null;
          }
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            const entries = [...state.repos.values()].filter(r => r.project_id === pid);
            return entries[0] ?? null;
          }
          if (/FROM workspace_github_connections/.test(sql)) {
            const [uk] = bound;
            const entries = [...state.connections.values()].filter(c => c.user_key === uk);
            return entries[0] ?? null;
          }
          if (/FROM workspace_projects/.test(sql)) {
            const [id] = bound;
            return state.projects.get(id) ?? null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO workspace_pr_review_runs/.test(sql)) {
            const [id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
                   selected_item_ids_json, status, created_at, updated_at] = bound;
            state.reviewRuns.set(id, { id, project_id, user_key, repo_full_name, pr_number,
              linked_pr_id, selected_item_ids_json, status, result_json: null,
              error_message: null, created_at, updated_at });
          }
          if (/UPDATE workspace_pr_review_runs/.test(sql)) {
            const [status, result_json, error_message, updated_at, id] = bound;
            const existing = state.reviewRuns.get(id);
            if (existing) state.reviewRuns.set(id, { ...existing, status, result_json, error_message, updated_at });
          }
          return { success: true };
        },
        async all() {
          if (/FROM workspace_project_pull_requests/.test(sql) && /WHERE project_id/.test(sql)) {
            const [pid] = bound;
            const results = [...state.prs.values()].filter(r => r.project_id === pid);
            return { results };
          }
          return { results: [] };
        },
      };
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeMockDb(),
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: null,
    ...overrides,
  };
}

function addRepo(env, projectId, owner = "testowner", name = "testrepo") {
  env.DB.state.repos.set(projectId, {
    id: "wpr_test", project_id: projectId, user_key: "uk1",
    github_connection_id: "wgc1", repo_id: "123",
    repo_full_name: `${owner}/${name}`, repo_owner: owner, repo_name: name,
    default_branch: "main", private: 0, html_url: `https://github.com/${owner}/${name}`,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}

function addConnection(env, userKey = "uk1") {
  env.DB.state.connections.set(userKey, {
    id: "wgc_test", user_key: userKey, github_user_id: "42", github_login: "testuser",
    github_name: "Test User", avatar_url: null, access_token_enc: "enc_fake",
    scopes: "read:user public_repo",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}

function addLinkedPR(env, projectId, prNumber, selectedItemIds = ["req_001"]) {
  const key = `${projectId}::testowner/testrepo::${prNumber}`;
  env.DB.state.prs.set(key, {
    id: `wpr_${prNumber}`, project_id: projectId, user_key: "uk1",
    repo_full_name: "testowner/testrepo", pr_number: prNumber,
    pr_title: `PR ${prNumber}`, pr_state: "open",
    pr_url: null, pr_head_branch: "feat", pr_base_branch: "main",
    selected_item_ids_json: JSON.stringify(selectedItemIds),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}

function addProject(env, projectId, userKey = "uk1") {
  env.DB.state.projects.set(projectId, {
    id: projectId, user_key: userKey, title: "Test Project",
    idea: "테스트 아이디어", understood_json: null,
    product_spec_json: JSON.stringify({
      productName: "테스트 앱", oneLine: "설명", targetUsers: ["사용자"],
      problem: "문제", included: ["로그인"], excluded: ["결제"],
      userFlow: [], decisions: [], openQuestions: [],
    }),
    items_json: JSON.stringify([
      { id: "req_001", title: "로그인 기능", status: "draft", criteria: ["이메일 입력", "비밀번호 확인"] },
    ]),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
}

// ─── pr-review-db tests ───────────────────────────────────────────────────────

describe("pr-review-db: insertReviewRun", () => {
  it("inserts a run and returns it with wprr_ prefix", async () => {
    const env = makeEnv();
    const run = await insertReviewRun(env, {
      projectId: "proj_1", userKey: "uk1", repoFullName: "owner/repo",
      prNumber: 42, selectedItemIds: ["req_001", "req_002"], status: "running",
    });
    assert.ok(run.id.startsWith("wprr_"), "id should have wprr_ prefix");
    assert.equal(run.projectId, "proj_1");
    assert.equal(run.prNumber, 42);
    assert.deepEqual(run.selectedItemIds, ["req_001", "req_002"]);
    assert.equal(run.status, "running");
  });
});

describe("pr-review-db: updateReviewRun", () => {
  it("updates status and resultJson", async () => {
    const env = makeEnv();
    const run = await insertReviewRun(env, {
      projectId: "p1", userKey: "u1", repoFullName: "o/r",
      prNumber: 1, selectedItemIds: ["a"], status: "running",
    });
    await updateReviewRun(env, run.id, { status: "passed", resultJson: '{"ok":true}' });
    const stored = env.DB.state.reviewRuns.get(run.id);
    assert.equal(stored.status, "passed");
    assert.equal(stored.result_json, '{"ok":true}');
  });
});

describe("pr-review-db: getLatestReviewRun", () => {
  it("returns latest run for project/repo/pr", async () => {
    const env = makeEnv();
    await insertReviewRun(env, {
      projectId: "p2", userKey: "u1", repoFullName: "o/r",
      prNumber: 5, selectedItemIds: ["x"], status: "passed",
    });
    const result = await getLatestReviewRun(env, "p2", "o/r", 5);
    assert.ok(result !== null);
    assert.equal(result.prNumber, 5);
    assert.equal(result.status, "passed");
  });

  it("returns null when no run exists", async () => {
    const env = makeEnv();
    const result = await getLatestReviewRun(env, "nobody", "o/r", 99);
    assert.equal(result, null);
  });
});

// ─── deriveRunStatus tests ────────────────────────────────────────────────────

describe("deriveRunStatus", () => {
  it("returns inconclusive for empty results", () => {
    assert.equal(deriveRunStatus([]), "inconclusive");
  });

  it("returns failed when any item is failed", () => {
    const results = [
      { itemId: "a", status: "passed", title: "A", userLabel: "통과", reason: "", evidence: [], nextAction: "" },
      { itemId: "b", status: "failed", title: "B", userLabel: "안 맞음", reason: "", evidence: [], nextAction: "" },
    ];
    assert.equal(deriveRunStatus(results), "failed");
  });

  it("returns passed when all items are passed or needs_decision", () => {
    const results = [
      { itemId: "a", status: "passed", title: "A", userLabel: "통과", reason: "", evidence: [], nextAction: "" },
      { itemId: "b", status: "needs_decision", title: "B", userLabel: "결정 필요", reason: "", evidence: [], nextAction: "" },
    ];
    assert.equal(deriveRunStatus(results), "passed");
  });

  it("returns inconclusive when mix of passed and inconclusive", () => {
    const results = [
      { itemId: "a", status: "passed", title: "A", userLabel: "통과", reason: "", evidence: [], nextAction: "" },
      { itemId: "b", status: "inconclusive", title: "B", userLabel: "확인 부족", reason: "", evidence: [], nextAction: "" },
    ];
    assert.equal(deriveRunStatus(results), "inconclusive");
  });
});

// ─── reviewPRAgainstItems tests ───────────────────────────────────────────────

const MOCK_SPEC = {
  productName: "테스트 앱", oneLine: "설명", targetUsers: ["사용자"],
  problem: "문제", included: ["로그인"], excluded: ["결제 기능"],
  userFlow: [], decisions: [], openQuestions: ["알림 설정 방식 아직 결정 안 됨"],
};

const MOCK_ITEMS = [
  { id: "req_001", title: "로그인 기능", status: "draft", criteria: ["이메일 입력 검증", "비밀번호 확인"] },
  { id: "req_002", title: "결제 기능", status: "draft", criteria: ["카드 입력"] },
  { id: "req_003", title: "알림 설정", status: "draft", criteria: [] },
];

const MOCK_PR_META = {
  number: 1, title: "feat: 로그인 추가", body: "",
  state: "open", headBranch: "feat/login", baseBranch: "main", headSha: "abc123",
  additions: 50, deletions: 5, changedFiles: 3,
};

const MOCK_PR_FILES = [
  { filename: "src/auth/login.ts", status: "added", additions: 30, deletions: 0, changes: 30, patch: "+export function login() {}" },
];

describe("reviewPRAgainstItems: mock fallback", () => {
  it("returns mock fallback when no API key", async () => {
    const res = await reviewPRAgainstItems({
      productSpec: MOCK_SPEC, items: MOCK_ITEMS,
      prMeta: MOCK_PR_META, prFiles: MOCK_PR_FILES,
    }, undefined);
    assert.equal(res.ok, true);
    assert.equal(res.source, "mock-fallback");
    assert.ok(Array.isArray(res.results));
  });

  it("marks items in excluded list as failed", async () => {
    const res = await reviewPRAgainstItems({
      productSpec: MOCK_SPEC, items: [MOCK_ITEMS[1]], // "결제 기능" is in excluded
      prMeta: MOCK_PR_META, prFiles: MOCK_PR_FILES,
    }, undefined);
    assert.equal(res.results[0].status, "failed");
    assert.equal(res.results[0].userLabel, "안 맞음");
    // Default (no locale) → Korean reason text.
    assert.match(res.results[0].reason, /제외 범위/);
  });

  it("heuristic fallback follows locale: en → English reason text", async () => {
    const res = await reviewPRAgainstItems({
      productSpec: MOCK_SPEC, items: [MOCK_ITEMS[1]],
      prMeta: MOCK_PR_META, prFiles: MOCK_PR_FILES,
      locale: "en",
    }, undefined);
    assert.equal(res.results[0].status, "failed");
    assert.match(res.results[0].reason, /out of scope/i);
    // No Korean characters leak into the English reason.
    assert.ok(!/[가-힣]/.test(res.results[0].reason), "English reason must not contain Hangul");
  });

  it("marks items in openQuestions as needs_decision", async () => {
    const res = await reviewPRAgainstItems({
      productSpec: MOCK_SPEC, items: [MOCK_ITEMS[2]], // "알림 설정" matches openQuestion
      prMeta: MOCK_PR_META, prFiles: MOCK_PR_FILES,
    }, undefined);
    assert.equal(res.results[0].status, "needs_decision");
  });

  it("returns inconclusive for empty items list", async () => {
    const res = await reviewPRAgainstItems({
      productSpec: MOCK_SPEC, items: [],
      prMeta: MOCK_PR_META, prFiles: MOCK_PR_FILES,
    }, undefined);
    assert.deepEqual(res.results, []);
  });
});

// ─── fetchPRFiles: patch truncation ──────────────────────────────────────────

describe("fetchPRFiles: patch limits", () => {
  function makeMockFetchWithFiles(files) {
    let callCount = 0;
    const prMeta = {
      number: 1, title: "T", body: null, state: "open",
      head: { ref: "feat", sha: "abc" }, base: { ref: "main" },
      additions: 10, deletions: 2, changed_files: files.length,
    };
    return async (url) => {
      if (url.includes("/pulls/1") && !url.includes("/files")) {
        return new Response(JSON.stringify(prMeta), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/files")) {
        callCount++;
        if (callCount > 1) return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify(files), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };
  }

  it("truncates per-file patch beyond MAX_PATCH_CHARS_PER_FILE", async () => {
    const longPatch = "+" + "a".repeat(MAX_PATCH_CHARS_PER_FILE + 100);
    const mockFiles = [{ filename: "big.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: longPatch }];
    const mockFetch = makeMockFetchWithFiles(mockFiles);
    const result = await fetchPRFiles("owner", "repo", 1, "token", mockFetch);
    assert.ok(result.files[0].patch.length <= MAX_PATCH_CHARS_PER_FILE + 30); // +30 for truncation marker
    assert.ok(result.warnings.some(w => w.includes("truncated")));
  });

  it("warns when PR has more than MAX_FILES files", async () => {
    const manyFiles = Array.from({ length: MAX_FILES + 5 }, (_, i) => ({
      filename: `file${i}.ts`, status: "modified", additions: 1, deletions: 0, changes: 1,
    }));
    const mockFetch = makeMockFetchWithFiles(manyFiles);
    const result = await fetchPRFiles("owner", "repo", 1, "token", mockFetch);
    assert.equal(result.files.length, MAX_FILES);
    assert.ok(result.warnings.some(w => w.includes("files")));
  });
});

// ─── buildDiffSummary ─────────────────────────────────────────────────────────

describe("buildDiffSummary", () => {
  it("includes filename and patch", () => {
    const files = [{ filename: "src/app.ts", status: "modified", additions: 2, deletions: 1, changes: 3, patch: "+const x = 1;" }];
    const summary = buildDiffSummary(files);
    assert.ok(summary.includes("src/app.ts"));
    assert.ok(summary.includes("+const x = 1;"));
  });

  it("marks binary files with no diff", () => {
    const files = [{ filename: "image.png", status: "added", additions: 0, deletions: 0, changes: 0 }];
    const summary = buildDiffSummary(files);
    assert.ok(summary.includes("binary or no diff"));
  });
});

// ─── Route: start review requires linked repo ─────────────────────────────────

describe("POST /workspace/projects/:id/github/pulls/:number/review", () => {
  it("returns 400 when no repo linked", async () => {
    const env = makeEnv();
    addProject(env, "norepo");
    const app = createApp();
    const req = new Request("http://localhost/workspace/projects/norepo/github/pulls/1/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk1" }),
    });
    const resp = await app.fetch(req, env);
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.ok(body.error === "no_repo_linked");
  });

  it("returns 400 when no selected items (no linked PR, no body itemIds)", async () => {
    const env = makeEnv();
    addRepo(env, "proj_test");
    addProject(env, "proj_test");
    const app = createApp();
    const req = new Request("http://localhost/workspace/projects/proj_test/github/pulls/99/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk1" }),
    });
    const resp = await app.fetch(req, env);
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.ok(body.error === "no_selected_items");
  });

  it("returns 401 when GitHub not connected", async () => {
    const env = makeEnv({ CONCLAVE_TOKEN_KEK: "fake_kek" });
    addRepo(env, "proj_a");
    addLinkedPR(env, "proj_a", 5, ["req_001"]);
    addProject(env, "proj_a", "uk_nobody");
    const app = createApp();
    const req = new Request("http://localhost/workspace/projects/proj_a/github/pulls/5/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_nobody" }),
    });
    const resp = await app.fetch(req, env);
    assert.equal(resp.status, 401);
    const body = await resp.json();
    assert.equal(body.error, "not_connected");
  });

  it("returns 503 when CONCLAVE_TOKEN_KEK is missing", async () => {
    const env = makeEnv({ CONCLAVE_TOKEN_KEK: null });
    addRepo(env, "proj_b");
    addLinkedPR(env, "proj_b", 3, ["req_001"]);
    addProject(env, "proj_b");
    const app = createApp();
    const req = new Request("http://localhost/workspace/projects/proj_b/github/pulls/3/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk1" }),
    });
    const resp = await app.fetch(req, env);
    assert.equal(resp.status, 503);
    const body = await resp.json();
    assert.ok(body.error.includes("token_unavailable"));
  });

  it("inherits selectedItemIds from linked PR when not provided in body", async () => {
    const env = makeEnv({ CONCLAVE_TOKEN_KEK: "fake_kek" });
    addRepo(env, "proj_c");
    addLinkedPR(env, "proj_c", 7, ["req_001"]);
    addConnection(env, "uk1");
    addProject(env, "proj_c");
    // KEK exists but decryption will fail with fake token — expect 503 token error
    const app = createApp();
    const req = new Request("http://localhost/workspace/projects/proj_c/github/pulls/7/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk1" }),
    });
    const resp = await app.fetch(req, env);
    // Will fail at token decrypt stage (503) — confirms selectedItemIds were found from linked PR
    assert.equal(resp.status, 503);
    const body = await resp.json();
    assert.ok(body.error.includes("token_decrypt_failed") || body.error.includes("token_unavailable"));
  });
});

// ─── Route: GET review status ─────────────────────────────────────────────────

describe("GET /workspace/projects/:id/github/pulls/:number/review", () => {
  it("returns null run when no review has been run", async () => {
    const env = makeEnv();
    addRepo(env, "proj_d");
    addProject(env, "proj_d");
    const app = createApp();
    const resp = await app.fetch(
      new Request("http://localhost/workspace/projects/proj_d/github/pulls/1/review?userKey=uk1"),
      env,
    );
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.run, null);
  });

  it("returns null run when no repo linked", async () => {
    const env = makeEnv();
    addProject(env, "norepo");
    const app = createApp();
    const resp = await app.fetch(
      new Request("http://localhost/workspace/projects/norepo/github/pulls/1/review?userKey=uk1"),
      env,
    );
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.run, null);
  });

  it("returns stored run with result", async () => {
    const env = makeEnv();
    addRepo(env, "proj_e");
    addProject(env, "proj_e");
    // Insert a run directly into mock DB
    const runId = "wprr_test001";
    const result = { ok: true, source: "mock-fallback", summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 }, results: [{ itemId: "req_001", title: "로그인", status: "passed", userLabel: "통과", reason: "OK", evidence: [], nextAction: "" }] };
    env.DB.state.reviewRuns.set(runId, {
      id: runId, project_id: "proj_e", user_key: "uk1",
      repo_full_name: "testowner/testrepo", pr_number: 5,
      linked_pr_id: null, selected_item_ids_json: JSON.stringify(["req_001"]),
      status: "passed", result_json: JSON.stringify(result),
      error_message: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const app = createApp();
    const resp = await app.fetch(
      new Request("http://localhost/workspace/projects/proj_e/github/pulls/5/review?userKey=uk1"),
      env,
    );
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.run.status, "passed");
    assert.equal(body.run.results[0].userLabel, "통과");
  });

  it("maps result userLabels correctly", async () => {
    const env = makeEnv();
    addRepo(env, "proj_f");
    addProject(env, "proj_f");
    const runId = "wprr_test002";
    const result = {
      ok: true, source: "mock-fallback",
      summary: { passed: 0, failed: 1, inconclusive: 1, needsDecision: 0 },
      results: [
        { itemId: "r1", title: "항목1", status: "failed", userLabel: "안 맞음", reason: "X", evidence: [], nextAction: "" },
        { itemId: "r2", title: "항목2", status: "inconclusive", userLabel: "확인 부족", reason: "Y", evidence: [], nextAction: "" },
      ],
    };
    env.DB.state.reviewRuns.set(runId, {
      id: runId, project_id: "proj_f", user_key: "uk1",
      repo_full_name: "testowner/testrepo", pr_number: 3,
      linked_pr_id: null, selected_item_ids_json: "[]",
      status: "failed", result_json: JSON.stringify(result),
      error_message: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const app = createApp();
    const resp = await app.fetch(
      new Request("http://localhost/workspace/projects/proj_f/github/pulls/3/review?userKey=uk1"),
      env,
    );
    const body = await resp.json();
    assert.equal(body.run.results[0].userLabel, "안 맞음");
    assert.equal(body.run.results[1].userLabel, "확인 부족");
  });
});

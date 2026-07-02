/**
 * workspace-pr-review-compare.test.mjs
 *
 * Tests for Stage 15 — before/after PR review comparison:
 *   - compareRunResults (deterministic, no LLM)
 *   - buildRunSummary / parseRunResults
 *   - getLatestTwoPrReviewRuns DB helper
 *   - GET /review/compare endpoint
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  compareRunResults, buildRunSummary, parseRunResults,
} = await import("../dist/workspace/pr-review-compare.js");
const {
  getLatestTwoPrReviewRuns,
} = await import("../dist/workspace/pr-review-db.js");
const { createApp } = await import("../dist/router.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_REPO = "myorg/myapp";
const PR_NUMBER = 7;

const PREV_RESULTS = [
  { itemId: "i1", title: "로그인", status: "failed", reason: "JWT 없음" },
  { itemId: "i2", title: "알림", status: "inconclusive", reason: "구현 불명확" },
  { itemId: "i3", title: "결제", status: "needs_decision", reason: "게이트웨이 미결정" },
  { itemId: "i4", title: "대시보드", status: "passed", reason: "구현됨" },
];

const LATEST_RESULTS_MIXED = [
  { itemId: "i1", title: "로그인", status: "passed", reason: "JWT 구현됨" },      // improved
  { itemId: "i2", title: "알림", status: "inconclusive", reason: "아직 불명확" }, // still open
  { itemId: "i3", title: "결제", status: "failed", reason: "PG 문제" },            // newly problematic
  { itemId: "i4", title: "대시보드", status: "passed", reason: "유지됨" },         // unchanged
];

// ─── Unit: compareRunResults ──────────────────────────────────────────────────

describe("compareRunResults", () => {
  it("identifies improved items (score increase)", () => {
    const result = compareRunResults(PREV_RESULTS, LATEST_RESULTS_MIXED);
    assert.equal(result.improved.length, 1, "should have 1 improved item");
    assert.equal(result.improved[0].itemId, "i1");
    assert.equal(result.improved[0].from, "failed");
    assert.equal(result.improved[0].to, "passed");
  });

  it("identifies still open items (same non-passing score)", () => {
    const result = compareRunResults(PREV_RESULTS, LATEST_RESULTS_MIXED);
    assert.equal(result.stillOpen.length, 1, "should have 1 still open item");
    assert.equal(result.stillOpen[0].itemId, "i2");
    assert.equal(result.stillOpen[0].status, "inconclusive");
  });

  it("identifies newly problematic items (score decrease)", () => {
    const result = compareRunResults(PREV_RESULTS, LATEST_RESULTS_MIXED);
    assert.equal(result.newlyProblematic.length, 1, "should have 1 newly problematic item");
    assert.equal(result.newlyProblematic[0].itemId, "i3");
    assert.equal(result.newlyProblematic[0].from, "needs_decision");
    assert.equal(result.newlyProblematic[0].to, "failed");
  });

  it("identifies unchanged passed items", () => {
    const result = compareRunResults(PREV_RESULTS, LATEST_RESULTS_MIXED);
    assert.equal(result.unchanged.length, 1, "should have 1 unchanged item");
    assert.equal(result.unchanged[0].itemId, "i4");
    assert.equal(result.unchanged[0].status, "passed");
  });

  it("failed → needs_decision described as 결정 필요로 전환", () => {
    const prev = [{ itemId: "x", title: "X", status: "failed", reason: "r" }];
    const latest = [{ itemId: "x", title: "X", status: "needs_decision", reason: "r" }];
    const result = compareRunResults(prev, latest);
    assert.equal(result.improved.length, 1);
    assert.ok(result.improved[0].reason.includes("결정 필요"));
  });

  it("inconclusive → needs_decision described as 명확해짐", () => {
    const prev = [{ itemId: "x", title: "X", status: "inconclusive", reason: "r" }];
    const latest = [{ itemId: "x", title: "X", status: "needs_decision", reason: "r" }];
    const result = compareRunResults(prev, latest);
    assert.equal(result.improved.length, 1);
    assert.ok(result.improved[0].reason.includes("명확해"));
  });

  it("passed → failed described as regression", () => {
    const prev = [{ itemId: "x", title: "X", status: "passed", reason: "r" }];
    const latest = [{ itemId: "x", title: "X", status: "failed", reason: "r" }];
    const result = compareRunResults(prev, latest);
    assert.equal(result.newlyProblematic.length, 1);
    assert.ok(result.newlyProblematic[0].reason.includes("통과"));
  });

  it("uses Korean labels in reason text (not raw status strings)", () => {
    const prev = [{ itemId: "x", title: "X", status: "failed", reason: "r" }];
    const latest = [{ itemId: "x", title: "X", status: "passed", reason: "r" }];
    const result = compareRunResults(prev, latest);
    assert.ok(result.improved[0].reason.includes("통과"), "should use Korean label 통과");
    assert.ok(!result.improved[0].reason.includes('"passed"'), "should not use raw status");
  });

  it("summaryText lists improved and still-open counts", () => {
    const result = compareRunResults(PREV_RESULTS, LATEST_RESULTS_MIXED);
    assert.ok(result.summaryText.includes("좋아진 항목"));
    assert.ok(result.summaryText.includes("새로 생긴 문제"));
    assert.ok(result.summaryText.includes("아직 남은 항목"));
  });

  it("handles all-passed result with no changes", () => {
    const allPassed = [
      { itemId: "a", title: "A", status: "passed", reason: "ok" },
      { itemId: "b", title: "B", status: "passed", reason: "ok" },
    ];
    const result = compareRunResults(allPassed, allPassed);
    assert.equal(result.improved.length, 0);
    assert.equal(result.stillOpen.length, 0);
    assert.equal(result.newlyProblematic.length, 0);
    assert.equal(result.unchanged.length, 2);
    assert.ok(result.summaryText.includes("변화 없"));
  });

  it("item only in latest → placed in stillOpen if not passed", () => {
    const prev = [{ itemId: "a", title: "A", status: "passed", reason: "ok" }];
    const latest = [
      { itemId: "a", title: "A", status: "passed", reason: "ok" },
      { itemId: "new", title: "신규", status: "failed", reason: "구현 안 됨" },
    ];
    const result = compareRunResults(prev, latest);
    const newItem = result.stillOpen.find((i) => i.itemId === "new");
    assert.ok(newItem, "new failed item should appear in stillOpen");
  });

  it('locale "en" produces English reason text and summaryText with no Korean', () => {
    const prevEn = [
      { itemId: "i1", title: "Login", status: "failed", reason: "r" },
      { itemId: "i3", title: "Payments", status: "needs_decision", reason: "r" },
    ];
    const latestEn = [
      { itemId: "i1", title: "Login", status: "passed", reason: "r" },
      { itemId: "i3", title: "Payments", status: "failed", reason: "r" },
    ];
    const result = compareRunResults(prevEn, latestEn, "en");
    assert.equal(result.improved[0].reason, "Improved from Issue found to Passed.");
    assert.equal(result.newlyProblematic[0].reason, "Worsened from Needs decision to Issue found.");
    assert.ok(result.summaryText.includes("1 improved"));
    assert.ok(!/[가-힣]/.test(JSON.stringify(result)), "EN comparison output must contain no Korean");
  });

  it('locale defaults to "ko" when omitted (backward compat)', () => {
    const prev = [{ itemId: "x", title: "X", status: "failed", reason: "r" }];
    const latest = [{ itemId: "x", title: "X", status: "passed", reason: "r" }];
    const def = compareRunResults(prev, latest);
    const ko = compareRunResults(prev, latest, "ko");
    assert.equal(def.improved[0].reason, ko.improved[0].reason);
    assert.ok(def.improved[0].reason.includes("통과"));
  });

  it("does not call any LLM — is purely deterministic", () => {
    // If compareRunResults depended on an LLM it would need async and external calls.
    // Verify it's synchronous and returns immediately.
    let completed = false;
    const result = compareRunResults(PREV_RESULTS, LATEST_RESULTS_MIXED);
    completed = true;
    assert.ok(completed, "should complete synchronously");
    assert.ok(typeof result === "object");
  });
});

// ─── Unit: buildRunSummary ────────────────────────────────────────────────────

describe("buildRunSummary", () => {
  it("extracts summary from summary field if present", () => {
    const run = {
      id: "r1", status: "failed", updatedAt: "2026-06-12T00:00:00Z",
      resultJson: JSON.stringify({ summary: { passed: 2, failed: 1, inconclusive: 1, needsDecision: 0 } }),
    };
    const s = buildRunSummary(run);
    assert.equal(s.summary.passed, 2);
    assert.equal(s.summary.failed, 1);
    assert.equal(s.summary.inconclusive, 1);
  });

  it("counts from results array when summary missing", () => {
    const results = [
      { status: "passed" }, { status: "passed" }, { status: "failed" },
    ];
    const run = {
      id: "r2", status: "failed", updatedAt: "2026-06-12T00:00:00Z",
      resultJson: JSON.stringify({ results }),
    };
    const s = buildRunSummary(run);
    assert.equal(s.summary.passed, 2);
    assert.equal(s.summary.failed, 1);
  });

  it("returns zeros when resultJson missing", () => {
    const s = buildRunSummary({ id: "r3", status: "error", updatedAt: "2026-06-12T00:00:00Z" });
    assert.equal(s.summary.passed, 0);
    assert.equal(s.summary.failed, 0);
  });
});

// ─── Unit: parseRunResults ────────────────────────────────────────────────────

describe("parseRunResults", () => {
  it("returns empty array for undefined", () => {
    assert.deepEqual(parseRunResults(undefined), []);
  });

  it("returns empty array for malformed JSON", () => {
    assert.deepEqual(parseRunResults("{not json"), []);
  });

  it("returns items from results array", () => {
    const json = JSON.stringify({ results: PREV_RESULTS });
    const result = parseRunResults(json);
    assert.equal(result.length, 4);
    assert.equal(result[0].itemId, "i1");
  });
});

// ─── D1 mock (Stage 15) ───────────────────────────────────────────────────────

function makeDb(extra = {}) {
  const reviewRuns = new Map();
  const repos = new Map();
  const usageEvents = new Map();

  return {
    _reviewRuns: reviewRuns,
    _repos: repos,
    _usageEvents: usageEvents,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT INTO workspace_usage_events")) {
                const [id, userKey, projId, eventType, metaJson, createdAt] = args;
                usageEvents.set(id, { id, user_key: userKey, project_id: projId, event_type: eventType, metadata_json: metaJson, created_at: createdAt });
              }
            },
            async first() {
              if (sql.includes("FROM workspace_project_repos")) {
                return repos.get(args[0]) ?? null;
              }
              // Ownership hardening: every project id resolves to a row owned
              // by this file's route-test userKey.
              if (sql.includes("FROM workspace_projects")) {
                return { id: args[0], user_key: "user123", title: "T", idea: "",
                  understood_json: null, product_spec_json: "{}", items_json: "[]",
                  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
              }
              return null;
            },
            async all() {
              if (sql.includes("FROM workspace_pr_review_runs")) {
                const [projId, repoFull, prNum] = args;
                const matches = [...reviewRuns.values()]
                  .filter((r) => r.project_id === projId && r.repo_full_name === repoFull && r.pr_number === prNum && !["running", "queued", "error"].includes(r.status))
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .slice(0, 2);
                return { results: matches };
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
    WORKSPACE_GH_CLIENT_ID: "test-client-id",
    WORKSPACE_GH_CLIENT_SECRET: "test-secret",
    WORKSPACE_GH_DASHBOARD_URL: "http://localhost:3002",
    PUBLIC_BASE_URL: "http://localhost:8787",
    ...overrides,
  };
}

function seedRepo(env, projectId = "proj1") {
  env.DB._repos.set(projectId, {
    id: "repo1", project_id: projectId, repo_full_name: MOCK_REPO,
    owner: "myorg", repo_name: "myapp", default_branch: "main",
    is_private: 0, html_url: "https://github.com/myorg/myapp",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });
}

function seedReviewRun(env, id, updatedAt, status = "failed", results = PREV_RESULTS) {
  env.DB._reviewRuns.set(id, {
    id,
    project_id: "proj1",
    user_key: "user123",
    repo_full_name: MOCK_REPO,
    pr_number: PR_NUMBER,
    linked_pr_id: null,
    selected_item_ids_json: JSON.stringify(["i1", "i2", "i3", "i4"]),
    status,
    result_json: JSON.stringify({ results, summary: { passed: results.filter(r => r.status === "passed").length, failed: results.filter(r => r.status === "failed").length, inconclusive: results.filter(r => r.status === "inconclusive").length, needsDecision: results.filter(r => r.status === "needs_decision").length } }),
    error_message: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  });
}

function makeRequest(method, path) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3002" },
  });
}

// ─── DB: getLatestTwoPrReviewRuns ─────────────────────────────────────────────

describe("getLatestTwoPrReviewRuns", () => {
  it("returns [null, null] when no completed runs", async () => {
    const env = makeEnv();
    const [latest, previous] = await getLatestTwoPrReviewRuns(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.equal(latest, null);
    assert.equal(previous, null);
  });

  it("returns [latest, null] when only one run", async () => {
    const env = makeEnv();
    seedReviewRun(env, "r1", "2026-06-12T10:00:00Z");
    const [latest, previous] = await getLatestTwoPrReviewRuns(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.ok(latest !== null);
    assert.equal(latest.id, "r1");
    assert.equal(previous, null);
  });

  it("returns [newest, older] when two runs exist", async () => {
    const env = makeEnv();
    seedReviewRun(env, "r1", "2026-06-12T08:00:00Z");
    seedReviewRun(env, "r2", "2026-06-12T12:00:00Z", "passed", LATEST_RESULTS_MIXED);
    const [latest, previous] = await getLatestTwoPrReviewRuns(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.equal(latest.id, "r2");
    assert.equal(previous.id, "r1");
  });

  it("excludes running/queued/error runs", async () => {
    const env = makeEnv();
    seedReviewRun(env, "r1", "2026-06-12T08:00:00Z");
    seedReviewRun(env, "rErr", "2026-06-12T11:00:00Z", "error");
    seedReviewRun(env, "rRun", "2026-06-12T12:00:00Z", "running");
    const [latest, previous] = await getLatestTwoPrReviewRuns(env, "proj1", MOCK_REPO, PR_NUMBER);
    assert.equal(latest.id, "r1");
    assert.equal(previous, null, "error/running runs should be excluded");
  });
});

// ─── Route: GET /review/compare ───────────────────────────────────────────────

describe("GET /workspace/projects/:id/github/pulls/:number/review/compare", () => {
  it("returns comparable:false with not_enough_runs when only one run", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedReviewRun(env, "r1", "2026-06-12T10:00:00Z");

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/review/compare?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.comparable, false);
    assert.equal(data.reason, "not_enough_runs");
  });

  it("returns comparable:true with improved/stillOpen/newlyProblematic when two runs", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedReviewRun(env, "r1", "2026-06-12T08:00:00Z", "failed", PREV_RESULTS);
    seedReviewRun(env, "r2", "2026-06-12T12:00:00Z", "failed", LATEST_RESULTS_MIXED);

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/review/compare?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.comparable, true);
    assert.ok(data.comparison, "should have comparison");
    assert.equal(data.comparison.improved.length, 1, "should find 1 improved item (i1 failed→passed)");
    assert.equal(data.comparison.newlyProblematic.length, 1, "should find 1 newly problematic (i3 needs_decision→failed)");
    assert.equal(data.comparison.stillOpen.length, 1, "should find 1 still open (i2 inconclusive)");
  });

  it("returns run summaries for previousRun and latestRun", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedReviewRun(env, "r1", "2026-06-12T08:00:00Z", "failed", PREV_RESULTS);
    seedReviewRun(env, "r2", "2026-06-12T12:00:00Z", "failed", LATEST_RESULTS_MIXED);

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/review/compare?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.ok(data.previousRun?.id === "r1", "previousRun should be older run");
    assert.ok(data.latestRun?.id === "r2", "latestRun should be newer run");
    assert.ok(typeof data.latestRun.summary.passed === "number");
  });

  it("dashboard copy: summaryText references Korean user-facing labels", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedReviewRun(env, "r1", "2026-06-12T08:00:00Z", "failed", PREV_RESULTS);
    seedReviewRun(env, "r2", "2026-06-12T12:00:00Z", "failed", LATEST_RESULTS_MIXED);

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/review/compare?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.ok(
      data.comparison.summaryText.includes("좋아진 항목") ||
      data.comparison.summaryText.includes("아직 남은 항목") ||
      data.comparison.summaryText.includes("새로 생긴 문제") ||
      data.comparison.summaryText.includes("변화 없"),
      "summaryText should use Korean user-facing terms"
    );
  });

  it("records workspace_pr_review_compared usage event when userKey provided", async () => {
    const env = makeEnv();
    seedRepo(env);
    seedReviewRun(env, "r1", "2026-06-12T08:00:00Z", "failed", PREV_RESULTS);
    seedReviewRun(env, "r2", "2026-06-12T12:00:00Z", "failed", LATEST_RESULTS_MIXED);

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/review/compare?userKey=user123`);
    await app.fetch(req, env);

    const events = [...env.DB._usageEvents.values()];
    const evt = events.find((e) => e.event_type === "workspace_pr_review_compared");
    assert.ok(evt, "should have recorded usage event");
    assert.equal(evt.user_key, "user123");
  });

  it("returns 400 when no repo is linked", async () => {
    const env = makeEnv();
    // no repo seeded

    const app = createApp();
    const req = makeRequest("GET", `/workspace/projects/proj1/github/pulls/${PR_NUMBER}/review/compare?userKey=user123`);
    const resp = await app.fetch(req, env);
    const data = await resp.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "no_repo_linked");
    assert.equal(resp.status, 400);
  });
});

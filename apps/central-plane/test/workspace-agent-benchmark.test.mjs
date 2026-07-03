/**
 * workspace-agent-benchmark.test.mjs — Stage 65
 *
 * Persisted Multi-Agent Build Benchmark endpoints:
 *  - POST create: success (201), validation, ownership, alignment
 *  - GET list / GET detail: persistence round-trip + ownership
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const USER = "uk_owner";
const PROJECT = "proj_bench";

// ─── Mock D1 ──────────────────────────────────────────────────────────────────

function makeRun(id, { projectId = PROJECT, userKey = USER, prNumber = 1, selectedItemIds = ["i1", "i2"], summary, results = [{ itemId: "i1" }] }) {
  return {
    id,
    project_id: projectId,
    user_key: userKey,
    repo_full_name: "owner/repo",
    pr_number: prNumber,
    linked_pr_id: null,
    selected_item_ids_json: JSON.stringify(selectedItemIds),
    status: "failed",
    result_json: JSON.stringify({ results, summary }),
    error_message: null,
    rerun_of_review_run_id: null,
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
  };
}

function makeDb({ runs = new Map(), benchmarks = [] } = {}) {
  return {
    _benchmarks: benchmarks,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO workspace_agent_benchmarks")) {
              const [id, project_id, user_key, title, created_at, updated_at, candidate_count, winner_candidate_id, no_clear_winner, result_json] = args;
              benchmarks.push({ id, project_id, user_key, title, created_at, updated_at, candidate_count, winner_candidate_id, no_clear_winner, result_json });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            // Ownership hardening: the list route now verifies the project
            // belongs to the caller. The test project is owned by USER.
            if (sql.includes("FROM workspace_projects")) {
              return { id: args[0], user_key: "uk_owner", title: "T", idea: "",
                understood_json: null, product_spec_json: "{}", items_json: "[]",
                created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
            }
            if (sql.includes("FROM workspace_pr_review_runs") && sql.includes("WHERE id = ?")) {
              return runs.get(args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_agent_benchmarks") && sql.includes("WHERE id = ?")) {
              return benchmarks.find((b) => b.id === args[0]) ?? null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM workspace_agent_benchmarks") && sql.includes("WHERE project_id = ?")) {
              const results = benchmarks
                .filter((b) => b.project_id === args[0])
                .map((b) => ({
                  id: b.id,
                  title: b.title,
                  created_at: b.created_at,
                  candidate_count: b.candidate_count,
                  winner_candidate_id: b.winner_candidate_id,
                  no_clear_winner: b.no_clear_winner,
                }));
              return { results };
            }
            return { results: [] };
          },
        };
      }
      return {
        bind(...args) { return handler(args); },
        run() { return handler([]).run(); },
        first() { return handler([]).first(); },
        all() { return handler([]).all(); },
      };
    },
  };
}

function makeEnv(opts = {}) {
  return { ENVIRONMENT: "test", DB: makeDb(opts) };
}

async function req(env, method, path, body) {
  const app = createApp();
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.fetch(new Request(`http://localhost${path}`, init), env);
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

function candidate(id, reviewRunId, over = {}) {
  return { id, label: id, mode: "single_agent", source: "manual", reviewRunId, ...over };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("POST create: success returns 201 with winner + alignment", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 5, failed: 2, inconclusive: 2, needsDecision: 0 } })],
    ["wprr_b", makeRun("wprr_b", { summary: { passed: 7, failed: 1, inconclusive: 1, needsDecision: 0 } })],
  ]);
  const env = makeEnv({ runs });
  const { status, json } = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    title: "Single vs multi",
    candidates: [candidate("c_single", "wprr_a"), candidate("c_multi", "wprr_b", { mode: "multi_agent", source: "codex" })],
  });
  assert.equal(status, 201);
  assert.equal(json.ok, true);
  assert.equal(json.benchmark.candidateCount, 2);
  assert.equal(json.benchmark.winnerCandidateId, "c_multi");
  assert.equal(json.benchmark.noClearWinner, false);
  assert.equal(json.benchmark.result.acceptanceSetAlignment.aligned, true);
});

test("POST create: item-level remaining blockers from the winner + item outcomes", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", {
      summary: { passed: 5, failed: 1 },
      results: [
        { itemId: "i1", title: "Login works", status: "passed" },
        { itemId: "i2", title: "Logout works", status: "failed", evidence: ["No logout endpoint in the diff"] },
      ],
    })],
    ["wprr_b", makeRun("wprr_b", {
      summary: { passed: 8, needsDecision: 1 },
      results: [
        { itemId: "i1", title: "Login works", status: "passed" },
        { itemId: "i2", title: "Logout works", status: "needs_decision" },
      ],
    })],
  ]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_b", { mode: "multi_agent" })],
  });
  assert.equal(status, 201);
  const result = json.benchmark.result;
  assert.equal(result.benchmark, undefined); // sanity: result is the AgentBenchmarkResult itself
  // b wins (score 22 vs 12) → blocker basis is b
  assert.equal(result.blockerBasisCandidateId, "b");
  assert.equal(result.remainingBlockers.length, 1);
  assert.equal(result.remainingBlockers[0].itemId, "i2");
  assert.equal(result.remainingBlockers[0].status, "needs_decision");
  assert.equal(result.remainingBlockers[0].severity, "decision");
  assert.equal(result.remainingBlockers[0].title, "Logout works");
  // passed items are never blockers
  assert.ok(result.remainingBlockers.every((b) => b.status !== "passed"));
  // item outcomes captured per candidate
  assert.equal(result.itemOutcomesByCandidate.a.length, 2);
  assert.equal(result.itemOutcomesByCandidate.b.length, 2);
  // evidence preserved where present (candidate a's failed item)
  const aLogout = result.itemOutcomesByCandidate.a.find((o) => o.itemId === "i2");
  assert.equal(aLogout.evidence, "No logout endpoint in the diff");
});

test("POST create: missing userKey → 400", async () => {
  const env = makeEnv();
  const { status, json } = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_b")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "userKey_required");
});

test("POST create: fewer than 2 candidates → 400", async () => {
  const runs = new Map([["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })]]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "candidate_count_invalid");
});

test("POST create: duplicate candidate ids → 400", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })],
    ["wprr_b", makeRun("wprr_b", { summary: { passed: 2 } })],
  ]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("dup", "wprr_a"), candidate("dup", "wprr_b")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "duplicate_candidate_ids");
});

test("POST create: nonexistent reviewRun → 400", async () => {
  const runs = new Map([["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })]]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_missing")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "review_run_not_found");
});

test("POST create: reviewRun from a different project → 400", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })],
    ["wprr_other", makeRun("wprr_other", { projectId: "proj_other", summary: { passed: 1 } })],
  ]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_other")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "review_run_project_mismatch");
});

test("POST create: reviewRun owned by a different userKey → 403", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })],
    ["wprr_b", makeRun("wprr_b", { userKey: "uk_someone_else", summary: { passed: 1 } })],
  ]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_b")],
  });
  assert.equal(status, 403);
  assert.equal(json.error, "forbidden");
});

test("POST create: misaligned acceptance sets → aligned=false + warning", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { selectedItemIds: ["i1", "i2"], summary: { passed: 3 } })],
    ["wprr_b", makeRun("wprr_b", { selectedItemIds: ["i1", "i3"], summary: { passed: 5 } })],
  ]);
  const { status, json } = await req(makeEnv({ runs }), "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_b")],
  });
  assert.equal(status, 201);
  const alignment = json.benchmark.result.acceptanceSetAlignment;
  assert.equal(alignment.aligned, false);
  assert.equal(alignment.warning, "acceptance_set_mismatch");
  assert.deepEqual(alignment.differingCandidateIds, ["b"]);
});

test("GET list + detail: create then read back (persistence round-trip)", async () => {
  const benchmarks = [];
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 5, failed: 1 } })],
    ["wprr_b", makeRun("wprr_b", { summary: { passed: 8 } })],
  ]);
  const env = makeEnv({ runs, benchmarks });

  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    title: "Round-trip",
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_b", { mode: "multi_agent" })],
  });
  assert.equal(created.status, 201);
  const bid = created.json.benchmark.id;

  const list = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-benchmarks?userKey=${USER}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.benchmarks.length, 1);
  assert.equal(list.json.benchmarks[0].id, bid);
  assert.equal(list.json.benchmarks[0].winnerCandidateId, "b");

  const detail = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-benchmarks/${bid}?userKey=${USER}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.benchmark.id, bid);
  assert.equal(detail.json.benchmark.result.recommendation.winnerCandidateId, "b");
});

test("GET list: missing userKey → 400", async () => {
  const { status, json } = await req(makeEnv(), "GET", `/workspace/projects/${PROJECT}/agent-benchmarks`);
  assert.equal(status, 400);
  assert.equal(json.error, "userKey_required");
});

test("GET detail: unknown benchmark → 404", async () => {
  const { status, json } = await req(makeEnv(), "GET", `/workspace/projects/${PROJECT}/agent-benchmarks/nope?userKey=${USER}`);
  assert.equal(status, 404);
  assert.equal(json.error, "not_found");
});

test("GET detail: different userKey → 403", async () => {
  const benchmarks = [];
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 5 } })],
    ["wprr_b", makeRun("wprr_b", { summary: { passed: 8 } })],
  ]);
  const env = makeEnv({ runs, benchmarks });
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-benchmarks`, {
    userKey: USER,
    candidates: [candidate("a", "wprr_a"), candidate("b", "wprr_b")],
  });
  const bid = created.json.benchmark.id;
  const detail = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-benchmarks/${bid}?userKey=uk_intruder`);
  assert.equal(detail.status, 403);
  assert.equal(detail.json.error, "forbidden");
});

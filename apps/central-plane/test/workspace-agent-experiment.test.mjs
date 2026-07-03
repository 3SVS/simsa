/**
 * workspace-agent-experiment.test.mjs — Stage 72
 *
 * Persisted Manual Multi-Agent Experiment endpoints: create + validation +
 * ownership, list, detail, and candidate PR/review-run linking.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const USER = "uk_owner";
const PROJECT = "proj_exp";

function makeRun(id, { projectId = PROJECT, userKey = USER, summary = {}, results = [] } = {}) {
  return { id, project_id: projectId, user_key: userKey, repo_full_name: "owner/repo", pr_number: 1,
    linked_pr_id: null, selected_item_ids_json: '["i1"]', status: "failed", result_json: JSON.stringify({ results, summary }),
    error_message: null, rerun_of_review_run_id: null, created_at: "2026-06-20T00:00:00Z", updated_at: "2026-06-20T00:00:00Z" };
}

function makeDb({ runs = new Map(), benchmarks = [], experiments = [], candidates = [] } = {}) {
  return {
    _experiments: experiments,
    _candidates: candidates,
    _benchmarks: benchmarks,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO workspace_agent_experiments")) {
              const [id, project_id, user_key, title, template_id, plan_json, created_at, updated_at] = args;
              experiments.push({ id, project_id, user_key, title, template_id, status: "draft", plan_json, created_at, updated_at });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("INSERT INTO workspace_agent_experiment_candidates")) {
              const [id, experiment_id, candidate_id, label, mode, role, suggested_agent, created_at, updated_at] = args;
              candidates.push({ id, experiment_id, candidate_id, label, mode, role, suggested_agent, status: "planned",
                pull_request_number: null, review_run_id: null, benchmark_id: null, created_at, updated_at });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("INSERT INTO workspace_agent_benchmarks")) {
              const [id, project_id, user_key, title, , , candidate_count, winner_candidate_id, no_clear_winner, result_json, source_experiment_id] = args;
              benchmarks.push({ id, project_id, user_key, title, candidate_count, winner_candidate_id, no_clear_winner, result_json, source_experiment_id });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE workspace_agent_experiments") && sql.includes("SET decision_status")) {
              const [decision_status, selected_candidate_id, decision_note, status, decided_at, , id] = args;
              const exp = experiments.find((e) => e.id === id);
              if (exp) { exp.decision_status = decision_status; exp.selected_candidate_id = selected_candidate_id; exp.decision_note = decision_note; exp.status = status; exp.decided_at = decided_at; }
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE workspace_agent_experiments")) {
              const [status, now, id] = args;
              const exp = experiments.find((e) => e.id === id);
              if (exp) { exp.status = status; exp.updated_at = now; }
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE workspace_agent_experiment_candidates") && sql.includes("SET outcome")) {
              const [outcome, outcome_note, status, decided_at, , id] = args;
              const cand = candidates.find((c) => c.id === id);
              if (cand) { cand.outcome = outcome; cand.outcome_note = outcome_note; cand.status = status; cand.decided_at = decided_at; }
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE workspace_agent_experiment_candidates")) {
              const [pr, runId, benchId, status, now, id] = args;
              const cand = candidates.find((c) => c.id === id);
              if (cand) { cand.pull_request_number = pr; cand.review_run_id = runId; cand.benchmark_id = benchId; cand.status = status; cand.updated_at = now; }
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
            if (sql.includes("FROM workspace_agent_experiments") && sql.includes("WHERE id = ?")) {
              return experiments.find((e) => e.id === args[0]) ?? null;
            }
            if (sql.includes("FROM workspace_agent_experiment_candidates") && sql.includes("WHERE id = ?")) {
              return candidates.find((c) => c.id === args[0]) ?? null;
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
            if (sql.includes("FROM workspace_agent_experiments e") && sql.includes("WHERE e.project_id = ?")) {
              const results = experiments.filter((e) => e.project_id === args[0]).map((e) => ({
                id: e.id, title: e.title, template_id: e.template_id, status: e.status, created_at: e.created_at,
                candidate_count: candidates.filter((c) => c.experiment_id === e.id).length,
              }));
              return { results };
            }
            if (sql.includes("FROM workspace_agent_experiment_candidates") && sql.includes("WHERE experiment_id = ?")) {
              return { results: candidates.filter((c) => c.experiment_id === args[0]) };
            }
            return { results: [] };
          },
        };
      }
      return { bind: (...a) => handler(a), run: () => handler([]).run(), first: () => handler([]).first(), all: () => handler([]).all() };
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

const cand = (id, label = id) => ({ id, label, mode: "single_agent", role: "builder", suggestedAgent: "claude_code" });

// ─── Tests ────────────────────────────────────────────────────────────────────

test("POST create: success returns 201 with experiment + candidates", async () => {
  const env = makeEnv();
  const { status, json } = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "Single vs multi", templateId: "multi_agent_split",
    candidates: [cand("a", "Builder A"), { ...cand("b", "Builder B"), mode: "multi_agent", suggestedAgent: "codex" }],
  });
  assert.equal(status, 201);
  assert.equal(json.ok, true);
  assert.equal(json.experiment.status, "draft");
  assert.equal(json.experiment.candidates.length, 2);
  assert.equal(json.experiment.candidates[0].status, "planned");
});

test("POST create: missing userKey → 400", async () => {
  const { status, json } = await req(makeEnv(), "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    title: "x", templateId: "multi_agent_split", candidates: [cand("a"), cand("b")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "userKey_required");
});

test("POST create: invalid templateId → 400", async () => {
  const { status, json } = await req(makeEnv(), "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "nope", candidates: [cand("a")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "invalid_template");
});

test("POST create: duplicate candidate ids → 400", async () => {
  const { status, json } = await req(makeEnv(), "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "multi_agent_split", candidates: [cand("dup"), cand("dup")],
  });
  assert.equal(status, 400);
  assert.equal(json.error, "duplicate_candidate_ids");
});

test("GET list + detail round-trip", async () => {
  const env = makeEnv();
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "Round-trip", templateId: "single_agent_baseline", candidates: [cand("single", "Single builder")],
  });
  const eid = created.json.experiment.id;

  const list = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments?userKey=${USER}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.experiments.length, 1);
  assert.equal(list.json.experiments[0].candidateCount, 1);

  const detail = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments/${eid}?userKey=${USER}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.experiment.candidates.length, 1);
});

test("GET detail: different userKey → 403", async () => {
  const env = makeEnv();
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "single_agent_baseline", candidates: [cand("single")],
  });
  const eid = created.json.experiment.id;
  const detail = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments/${eid}?userKey=uk_other`);
  assert.equal(detail.status, 403);
});

test("PATCH candidate: set PR number → pr_linked", async () => {
  const env = makeEnv();
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "single_agent_baseline", candidates: [cand("single")],
  });
  const eid = created.json.experiment.id;
  const cid = created.json.experiment.candidates[0].id;
  const patched = await req(env, "PATCH", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/candidates/${cid}`, {
    userKey: USER, pullRequestNumber: 7,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.candidate.pullRequestNumber, 7);
  assert.equal(patched.json.candidate.status, "pr_linked");
});

test("PATCH candidate: link review run from same project → reviewed", async () => {
  const runs = new Map([["wprr_ok", makeRun("wprr_ok")]]);
  const env = makeEnv({ runs });
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "single_agent_baseline", candidates: [cand("single")],
  });
  const eid = created.json.experiment.id;
  const cid = created.json.experiment.candidates[0].id;
  const patched = await req(env, "PATCH", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/candidates/${cid}`, {
    userKey: USER, reviewRunId: "wprr_ok",
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.candidate.reviewRunId, "wprr_ok");
  assert.equal(patched.json.candidate.status, "reviewed");
});

test("PATCH candidate: review run from another user → 400 mismatch", async () => {
  const runs = new Map([["wprr_other", makeRun("wprr_other", { userKey: "uk_someone" })]]);
  const env = makeEnv({ runs });
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "single_agent_baseline", candidates: [cand("single")],
  });
  const eid = created.json.experiment.id;
  const cid = created.json.experiment.candidates[0].id;
  const patched = await req(env, "PATCH", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/candidates/${cid}`, {
    userKey: USER, reviewRunId: "wprr_other",
  });
  assert.equal(patched.status, 400);
  assert.equal(patched.json.error, "review_run_mismatch");
});

test("PATCH candidate: unknown candidate → 404", async () => {
  const env = makeEnv();
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "x", templateId: "single_agent_baseline", candidates: [cand("single")],
  });
  const eid = created.json.experiment.id;
  const patched = await req(env, "PATCH", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/candidates/nope`, {
    userKey: USER, pullRequestNumber: 1,
  });
  assert.equal(patched.status, 404);
  assert.equal(patched.json.error, "candidate_not_found");
});

test("GET list: missing userKey → 400", async () => {
  const { status, json } = await req(makeEnv(), "GET", `/workspace/projects/${PROJECT}/agent-experiments`);
  assert.equal(status, 400);
  assert.equal(json.error, "userKey_required");
});

// ─── Stage 73: benchmark from experiment ──────────────────────────────────────

async function createExp(env) {
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER, title: "Exp", templateId: "multi_agent_split",
    candidates: [
      { id: "a", label: "Builder A", mode: "multi_agent", role: "builder", suggestedAgent: "claude_code" },
      { id: "b", label: "Builder B", mode: "multi_agent", role: "builder", suggestedAgent: "codex" },
    ],
  });
  return { eid: created.json.experiment.id, cands: created.json.experiment.candidates };
}

async function link(env, eid, candRowId, runId) {
  return req(env, "PATCH", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/candidates/${candRowId}`, {
    userKey: USER, reviewRunId: runId,
  });
}

test("POST benchmark from experiment: success links benchmark + status", async () => {
  const runs = new Map([
    ["wprr_1", makeRun("wprr_1", { summary: { passed: 5, failed: 2 }, results: [{ itemId: "i1", title: "X", status: "failed" }] })],
    ["wprr_2", makeRun("wprr_2", { summary: { passed: 8 }, results: [{ itemId: "i1", title: "X", status: "passed" }] })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_1");
  await link(env, eid, cands[1].id, "wprr_2");

  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  assert.equal(res.status, 201);
  assert.equal(res.json.benchmark.sourceExperimentId, eid);
  assert.equal(res.json.benchmark.candidateCount, 2);
  assert.equal(res.json.benchmark.winnerCandidateId, "b"); // run2 (score 24) beats run1 (score 9)
  assert.equal(res.json.experiment.status, "benchmarked");
  assert.ok(res.json.experiment.candidates.every((c) => c.status === "benchmarked"));
  assert.ok(res.json.experiment.candidates.every((c) => c.benchmarkId === res.json.benchmark.id));
});

test("POST benchmark from experiment: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, {});
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("POST benchmark from experiment: fewer than 2 linked runs → 400", async () => {
  const runs = new Map([["wprr_1", makeRun("wprr_1", { summary: { passed: 1 } })]]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_1"); // only one linked
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "not_enough_linked_runs");
});

test("POST benchmark from experiment: other user → 403", async () => {
  const runs = new Map([
    ["wprr_1", makeRun("wprr_1", { summary: { passed: 1 } })],
    ["wprr_2", makeRun("wprr_2", { summary: { passed: 2 } })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_1");
  await link(env, eid, cands[1].id, "wprr_2");
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: "uk_intruder" });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "forbidden");
});

// ─── Stage 74: decision ───────────────────────────────────────────────────────

test("POST decision: select a winner → experiment completed + candidate statuses", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER,
    selectedCandidateId: "b",
    decisionStatus: "selected",
    decisionNote: "Use B.",
    candidateOutcomes: [
      { candidateId: "a", outcome: "rejected", note: "Lower pass rate." },
      { candidateId: "b", outcome: "selected", note: "Fewer blockers." },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.experiment.status, "completed");
  assert.equal(res.json.experiment.decisionStatus, "selected");
  assert.equal(res.json.experiment.selectedCandidateId, "b");
  const byId = Object.fromEntries(res.json.experiment.candidates.map((c) => [c.candidateId, c]));
  assert.equal(byId.a.outcome, "rejected");
  assert.equal(byId.a.status, "rejected");
  assert.equal(byId.b.outcome, "selected");
  assert.equal(byId.b.status, "selected");
});

test("POST decision: needs_fix → experiment decision_made", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER,
    decisionStatus: "needs_fix",
    candidateOutcomes: [{ candidateId: "a", outcome: "needs_fix" }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.experiment.status, "decision_made");
});

test("POST decision: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    decisionStatus: "undecided", candidateOutcomes: [],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("POST decision: other user → 403", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: "uk_intruder", decisionStatus: "undecided", candidateOutcomes: [],
  });
  assert.equal(res.status, 403);
});

test("POST decision: unknown candidate id → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, decisionStatus: "selected", candidateOutcomes: [{ candidateId: "zzz", outcome: "selected" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "unknown_candidate");
});

test("POST decision: multiple selected → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "a", outcome: "selected" }, { candidateId: "b", outcome: "selected" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "multiple_selected");
});

test("POST decision: selectedCandidateId must match a selected outcome → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "a", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "b", outcome: "selected" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "selected_mismatch");
});

test("POST decision: note too long → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, decisionStatus: "undecided", decisionNote: "x".repeat(1001), candidateOutcomes: [],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "note_too_long");
});

test("POST decision: invalid decisionStatus → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, decisionStatus: "nope", candidateOutcomes: [],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "invalid_decision_status");
});

// ─── Stage 75: outcome scorecard ──────────────────────────────────────────────

test("GET outcome-scorecard: no benchmark → inconclusive + create_benchmark", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/outcome-scorecard?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.scorecard.quality.grade, "inconclusive");
  assert.equal(res.json.scorecard.nextEvolution.recommendedAction, "create_benchmark");
  assert.equal(res.json.scorecard.signals.hasBenchmark, false);
});

test("GET outcome-scorecard: missing userKey → 400, other user → 403", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const a = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/outcome-scorecard`);
  assert.equal(a.status, 400);
  const b = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/outcome-scorecard?userKey=uk_other`);
  assert.equal(b.status, 403);
});

test("GET outcome-scorecard: with benchmark + selected candidate → graded", async () => {
  const runs = new Map([
    ["wprr_1", makeRun("wprr_1", { summary: { passed: 5, failed: 2 }, results: [{ itemId: "i1", title: "X", status: "failed" }] })],
    ["wprr_2", makeRun("wprr_2", { summary: { passed: 8 }, results: [{ itemId: "i1", title: "X", status: "passed" }] })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_1");
  await link(env, eid, cands[1].id, "wprr_2");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "b", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "b", outcome: "selected" }],
  });
  const res = await req(env, "GET", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/outcome-scorecard?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.scorecard.signals.hasBenchmark, true);
  assert.equal(res.json.scorecard.selectedCandidateId, "b");
  // candidate b: passed 8 / total 8 → passRate 1.0, no critical → strong
  assert.equal(res.json.scorecard.quality.acceptancePassRate, 1);
  assert.equal(res.json.scorecard.quality.grade, "strong");
  assert.equal(res.json.scorecard.nextEvolution.recommendedAction, "accept");
});

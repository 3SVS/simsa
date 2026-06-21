/**
 * workspace-evolution-action-pack.test.mjs — Stage 77
 *
 * Persisted Evolution Action Pack endpoints: server-side canonical pack build,
 * ownership validation, list, detail, and no-token-leakage in pack_json/text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const USER = "uk_owner";
const PROJECT = "proj_exp";

function makeRun(id, { projectId = PROJECT, userKey = USER, summary = {}, results = [] } = {}) {
  return {
    id,
    project_id: projectId,
    user_key: userKey,
    repo_full_name: "owner/repo",
    pr_number: 1,
    linked_pr_id: null,
    selected_item_ids_json: '["i1"]',
    status: "failed",
    result_json: JSON.stringify({ results, summary }),
    error_message: null,
    rerun_of_review_run_id: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
  };
}

function makeDb({
  runs = new Map(),
  benchmarks = [],
  experiments = [],
  candidates = [],
  actionPacks = [],
} = {}) {
  return {
    _actionPacks: actionPacks,
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
            if (sql.includes("INSERT INTO workspace_evolution_action_packs")) {
              const [id, project_id, user_key, experiment_id, benchmark_id, selected_candidate_id, recommended_action, title, pack_json, created_at, updated_at] = args;
              actionPacks.push({
                id, project_id, user_key, experiment_id, benchmark_id, selected_candidate_id,
                recommended_action, title, pack_json, created_at, updated_at,
                followup_status: null,
                followup_pull_request_number: null,
                followup_review_run_id: null,
                followup_benchmark_id: null,
                followup_note: null,
                followed_at: null,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE workspace_evolution_action_packs") && sql.includes("SET followup_status")) {
              const [followup_status, followup_pull_request_number, followup_review_run_id, followup_benchmark_id, followup_note, followed_at, updated_at, id] = args;
              const pack = actionPacks.find((p) => p.id === id);
              if (pack) {
                pack.followup_status = followup_status;
                pack.followup_pull_request_number = followup_pull_request_number;
                pack.followup_review_run_id = followup_review_run_id;
                pack.followup_benchmark_id = followup_benchmark_id;
                pack.followup_note = followup_note;
                pack.followed_at = followed_at;
                pack.updated_at = updated_at;
              }
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
            if (sql.includes("FROM workspace_evolution_action_packs") && sql.includes("WHERE id = ?")) {
              return actionPacks.find((p) => p.id === args[0]) ?? null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM workspace_agent_experiments e") && sql.includes("WHERE e.project_id = ?")) {
              const results = experiments
                .filter((e) => e.project_id === args[0])
                .map((e) => ({
                  id: e.id,
                  title: e.title,
                  template_id: e.template_id,
                  status: e.status,
                  created_at: e.created_at,
                  candidate_count: candidates.filter((c) => c.experiment_id === e.id).length,
                }));
              return { results };
            }
            if (sql.includes("FROM workspace_agent_experiment_candidates") && sql.includes("WHERE experiment_id = ?")) {
              return { results: candidates.filter((c) => c.experiment_id === args[0]) };
            }
            if (sql.includes("FROM workspace_evolution_action_packs") && sql.includes("WHERE project_id = ?") && sql.includes("AND experiment_id = ?")) {
              const results = actionPacks
                .filter((p) => p.project_id === args[0] && p.experiment_id === args[1])
                .map((p) => ({
                  id: p.id,
                  experiment_id: p.experiment_id,
                  recommended_action: p.recommended_action,
                  title: p.title,
                  created_at: p.created_at,
                  followup_status: p.followup_status,
                  followup_pull_request_number: p.followup_pull_request_number,
                  followup_review_run_id: p.followup_review_run_id,
                  followup_benchmark_id: p.followup_benchmark_id,
                  followed_at: p.followed_at,
                }));
              return { results };
            }
            return { results: [] };
          },
        };
      }
      return {
        bind: (...a) => handler(a),
        run: () => handler([]).run(),
        first: () => handler([]).first(),
        all: () => handler([]).all(),
      };
    },
  };
}

function makeEnv(opts = {}) {
  const db = makeDb(opts);
  return { ENVIRONMENT: "test", DB: db, _db: db };
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

async function createExp(env) {
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: USER,
    title: "Exp",
    templateId: "multi_agent_split",
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

const path = (eid, suffix = "") =>
  `/workspace/projects/${PROJECT}/agent-experiments/${eid}/evolution-action-packs${suffix}`;

// ─── POST create ──────────────────────────────────────────────────────────────

test("POST action-pack: no benchmark → create_benchmark pack saved", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", path(eid), { userKey: USER });
  assert.equal(res.status, 201);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.actionPack.recommendedAction, "create_benchmark");
  assert.equal(res.json.actionPack.pack.experimentId, eid);
  assert.equal(res.json.actionPack.pack.focusItemIds.length, 0);
  assert.equal(res.json.actionPack.pack.sections.length, 4);
  // copy text deterministic
  assert.match(res.json.actionPack.text, /^# Conclave Evolution Action Pack/);
});

test("POST action-pack: with benchmark + selected → fix_selected/accept pack saved", async () => {
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

  const res = await req(env, "POST", path(eid), { userKey: USER });
  assert.equal(res.status, 201);
  // Strong outcome (8/8 pass, no critical) → accept.
  assert.equal(res.json.actionPack.recommendedAction, "accept");
  assert.equal(res.json.actionPack.pack.targetCandidateId, "b");
});

test("POST action-pack: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", path(eid), {});
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("POST action-pack: unknown experiment → 404", async () => {
  const env = makeEnv();
  const res = await req(env, "POST", path("nope_xyz"), { userKey: USER });
  assert.equal(res.status, 404);
});

test("POST action-pack: other user → 403", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "POST", path(eid), { userKey: "uk_intruder" });
  assert.equal(res.status, 403);
});

test("POST action-pack: no token/userKey leakage in pack_json/text", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  const saved = env._db._actionPacks[0];
  assert.ok(saved, "expected one saved action pack");
  assert.ok(!saved.pack_json.includes(USER), "pack_json must not contain userKey");
  assert.ok(!saved.pack_json.toLowerCase().includes("userkey"), "pack_json must not mention userKey");
  assert.ok(!saved.pack_json.toLowerCase().includes("token"), "pack_json must not mention token");
});

// ─── GET list ────────────────────────────────────────────────────────────────

test("GET action-pack list: empty initially → 200 with []", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", `${path(eid)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.actionPacks, []);
});

test("GET action-pack list: returns lightweight items", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "POST", path(eid), { userKey: USER });
  const res = await req(env, "GET", `${path(eid)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPacks.length, 2);
  for (const item of res.json.actionPacks) {
    assert.ok(item.id && item.recommendedAction && item.title && item.createdAt);
    assert.equal(item.experimentId, eid);
    // List view must not include pack body.
    assert.equal(item.pack, undefined);
  }
});

test("GET action-pack list: missing userKey → 400, other user → 403", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const a = await req(env, "GET", path(eid));
  assert.equal(a.status, 400);
  const b = await req(env, "GET", `${path(eid)}?userKey=uk_other`);
  assert.equal(b.status, 403);
});

// ─── GET detail ──────────────────────────────────────────────────────────────

test("GET action-pack detail: returns full pack + text", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;

  const res = await req(env, "GET", `${path(eid)}/${apId}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPack.id, apId);
  assert.ok(res.json.actionPack.pack);
  assert.equal(res.json.actionPack.pack.recommendedAction, "create_benchmark");
  assert.match(res.json.actionPack.text, /^# Conclave Evolution Action Pack/);
});

test("GET action-pack detail: pack id from another experiment → 404", async () => {
  const env = makeEnv();
  const { eid: eidA } = await createExp(env);
  const { eid: eidB } = await createExp(env);
  const created = await req(env, "POST", path(eidA), { userKey: USER });
  const apId = created.json.actionPack.id;
  // Trying to fetch eidA's pack under eidB's path → not_found.
  const res = await req(env, "GET", `${path(eidB)}/${apId}?userKey=${USER}`);
  assert.equal(res.status, 404);
});

test("GET action-pack detail: other user → 403", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;
  const res = await req(env, "GET", `${path(eid)}/${apId}?userKey=uk_intruder`);
  assert.equal(res.status, 403);
});

test("GET action-pack detail: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;
  const res = await req(env, "GET", `${path(eid)}/${apId}`);
  assert.equal(res.status, 400);
});

test("GET action-pack detail: unknown pack id → 404", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", `${path(eid)}/weap_missing?userKey=${USER}`);
  assert.equal(res.status, 404);
});

// ─── Stage 78: follow-up tracking ────────────────────────────────────────────

const followupPath = (eid, apId) => `${path(eid)}/${apId}/followup`;

async function createPack(env) {
  const { eid } = await createExp(env);
  const created = await req(env, "POST", path(eid), { userKey: USER });
  return { eid, apId: created.json.actionPack.id };
}

test("POST action-pack: response includes followup snapshot (defaults to not_started)", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const created = await req(env, "POST", path(eid), { userKey: USER });
  assert.equal(created.json.actionPack.followup.status, "not_started");
  assert.equal(created.json.actionPack.followup.pullRequestNumber, undefined);
});

test("GET list: items include followupStatus normalized to not_started", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  const res = await req(env, "GET", `${path(eid)}?userKey=${USER}`);
  assert.equal(res.json.actionPacks[0].followupStatus, "not_started");
});

test("PATCH followup: status only → status updates + followedAt stamped", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), { userKey: USER, status: "copied" });
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPack.followup.status, "copied");
  assert.ok(res.json.actionPack.followup.followedAt, "followedAt should be stamped");
});

test("PATCH followup: status stays not_started → followedAt not stamped", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), { userKey: USER, status: "not_started" });
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPack.followup.status, "not_started");
  assert.equal(res.json.actionPack.followup.followedAt, undefined);
});

test("PATCH followup: PR number persisted", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "in_progress", pullRequestNumber: 42,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPack.followup.pullRequestNumber, 42);
  // Survives reload.
  const list = await req(env, "GET", `${path(eid)}?userKey=${USER}`);
  assert.equal(list.json.actionPacks[0].followupPullRequestNumber, 42);
});

test("PATCH followup: reviewRunId from same project/user → linked", async () => {
  const runs = new Map([["wprr_ok", makeRun("wprr_ok")]]);
  const env = makeEnv({ runs });
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_ok",
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPack.followup.status, "reviewed");
  assert.equal(res.json.actionPack.followup.reviewRunId, "wprr_ok");
});

test("PATCH followup: reviewRunId from another user → 400 mismatch", async () => {
  const runs = new Map([["wprr_other", makeRun("wprr_other", { userKey: "uk_someone" })]]);
  const env = makeEnv({ runs });
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_other",
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "review_run_mismatch");
});

test("PATCH followup: unknown reviewRunId → 400", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_nope",
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "review_run_not_found");
});

test("PATCH followup: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), { status: "copied" });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("PATCH followup: invalid status → 400", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), { userKey: USER, status: "wat" });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "invalid_status");
});

test("PATCH followup: invalid PR number → 400", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "in_progress", pullRequestNumber: -3,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "invalid_pr_number");
});

test("PATCH followup: other user → 403", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: "uk_intruder", status: "copied",
  });
  assert.equal(res.status, 403);
});

test("PATCH followup: unknown action pack → 404", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "PATCH", followupPath(eid, "weap_missing"), {
    userKey: USER, status: "copied",
  });
  assert.equal(res.status, 404);
});

test("PATCH followup: pack id from another experiment → 404", async () => {
  const env = makeEnv();
  const { eid: eidA, apId } = await createPack(env);
  const { eid: eidB } = await createExp(env);
  // Sanity — pack belongs to eidA, not eidB.
  assert.notEqual(eidA, eidB);
  const res = await req(env, "PATCH", followupPath(eidB, apId), {
    userKey: USER, status: "copied",
  });
  assert.equal(res.status, 404);
});

test("PATCH followup: note too long → 400", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "in_progress", note: "x".repeat(1001),
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "note_too_long");
});

test("PATCH followup: note within limit persisted", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "in_progress", note: "Applied the fix_selected pack to Builder B's PR.",
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.actionPack.followup.note, "Applied the fix_selected pack to Builder B's PR.");
});

test("PATCH followup: followedAt is stable across subsequent transitions", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const first = await req(env, "PATCH", followupPath(eid, apId), { userKey: USER, status: "copied" });
  const firstStamp = first.json.actionPack.followup.followedAt;
  assert.ok(firstStamp);
  const second = await req(env, "PATCH", followupPath(eid, apId), { userKey: USER, status: "completed" });
  assert.equal(second.json.actionPack.followup.followedAt, firstStamp);
});

test("GET detail after PATCH: followup persisted across reload", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "in_progress", pullRequestNumber: 7, note: "x",
  });
  const detail = await req(env, "GET", `${path(eid)}/${apId}?userKey=${USER}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.actionPack.followup.status, "in_progress");
  assert.equal(detail.json.actionPack.followup.pullRequestNumber, 7);
  assert.equal(detail.json.actionPack.followup.note, "x");
});

// ─── Stage 79: GET impact ─────────────────────────────────────────────────────

const impactPath = (eid, apId) => `${path(eid)}/${apId}/impact`;

test("GET impact: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "GET", impactPath(eid, apId));
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("GET impact: unknown action pack → 404", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", `${impactPath(eid, "weap_nope")}?userKey=${USER}`);
  assert.equal(res.status, 404);
});

test("GET impact: pack id from another experiment → 404", async () => {
  const env = makeEnv();
  const { eid: eidA, apId } = await createPack(env);
  const { eid: eidB } = await createExp(env);
  assert.notEqual(eidA, eidB);
  const res = await req(env, "GET", `${impactPath(eidB, apId)}?userKey=${USER}`);
  assert.equal(res.status, 404);
});

test("GET impact: other user → 403", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "GET", `${impactPath(eid, apId)}?userKey=uk_intruder`);
  assert.equal(res.status, 403);
});

test("GET impact: no benchmark + no follow-up → inconclusive (missing_followup + missing_before)", async () => {
  const env = makeEnv();
  const { eid, apId } = await createPack(env);
  const res = await req(env, "GET", `${impactPath(eid, apId)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.impact.verdict, "inconclusive");
  assert.ok(res.json.impact.reasons.includes("missing_followup"));
  assert.ok(res.json.impact.reasons.includes("missing_before"));
  assert.equal(res.json.impact.before, null);
  assert.equal(res.json.impact.after, null);
});

test("GET impact: benchmark + follow-up reviewRunId with improvement → improved", async () => {
  // Source benchmark: candidate b has 5/8 pass, 2 failed (critical=2, blockers=3).
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 3 }, results: [{ itemId: "i1", title: "X", status: "passed" }] })],
    ["wprr_b", makeRun("wprr_b", {
      summary: { passed: 5, failed: 2, inconclusive: 1 },
      results: [
        { itemId: "i1", title: "Login", status: "passed" },
        { itemId: "i2", title: "Logout", status: "passed" },
        { itemId: "i3", title: "Share", status: "passed" },
        { itemId: "i4", title: "Perms", status: "passed" },
        { itemId: "i5", title: "Export", status: "passed" },
        { itemId: "i6", title: "Notify", status: "failed" },
        { itemId: "i7", title: "Login2", status: "failed" },
        { itemId: "i8", title: "Share2", status: "inconclusive" },
      ],
    })],
    // Follow-up review run: 7/8 pass, 1 failed.
    ["wprr_followup", makeRun("wprr_followup", {
      summary: { passed: 7, failed: 1 },
      results: [
        { itemId: "i1", title: "Login", status: "passed" },
        { itemId: "i2", title: "Logout", status: "passed" },
        { itemId: "i3", title: "Share", status: "passed" },
        { itemId: "i4", title: "Perms", status: "passed" },
        { itemId: "i5", title: "Export", status: "passed" },
        { itemId: "i6", title: "Notify", status: "passed" },
        { itemId: "i7", title: "Login2", status: "passed" },
        { itemId: "i8", title: "Share2", status: "failed" },
      ],
    })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_a");
  await link(env, eid, cands[1].id, "wprr_b");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "b", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "b", outcome: "selected" }],
  });
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;

  // Link a follow-up review run.
  await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_followup",
  });

  const res = await req(env, "GET", `${impactPath(eid, apId)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.impact.verdict, "improved");
  assert.equal(res.json.impact.before.source, "benchmark");
  assert.equal(res.json.impact.after.source, "review_run");
  assert.equal(res.json.impact.after.sourceId, "wprr_followup");
  assert.ok(res.json.impact.delta.passRateDelta > 0);
  assert.ok(res.json.impact.delta.blockerDelta < 0);
  assert.ok(res.json.impact.reasons.includes("pass_rate_increased"));
  assert.ok(res.json.impact.reasons.includes("blockers_decreased"));
});

test("GET impact: benchmark + follow-up reviewRunId with regression → regressed", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 3 } })],
    ["wprr_b", makeRun("wprr_b", {
      summary: { passed: 7, failed: 0, inconclusive: 1 },
      results: [
        { itemId: "i1", title: "X1", status: "passed" },
        { itemId: "i2", title: "X2", status: "passed" },
        { itemId: "i3", title: "X3", status: "passed" },
        { itemId: "i4", title: "X4", status: "passed" },
        { itemId: "i5", title: "X5", status: "passed" },
        { itemId: "i6", title: "X6", status: "passed" },
        { itemId: "i7", title: "X7", status: "passed" },
        { itemId: "i8", title: "X8", status: "inconclusive" },
      ],
    })],
    ["wprr_followup", makeRun("wprr_followup", {
      summary: { passed: 5, failed: 2, inconclusive: 1 },
      results: [
        { itemId: "i1", title: "X1", status: "passed" },
        { itemId: "i2", title: "X2", status: "passed" },
        { itemId: "i3", title: "X3", status: "passed" },
        { itemId: "i4", title: "X4", status: "passed" },
        { itemId: "i5", title: "X5", status: "passed" },
        { itemId: "i6", title: "X6", status: "failed" },
        { itemId: "i7", title: "X7", status: "failed" },
        { itemId: "i8", title: "X8", status: "inconclusive" },
      ],
    })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_a");
  await link(env, eid, cands[1].id, "wprr_b");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "b", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "b", outcome: "selected" }],
  });
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;
  await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_followup",
  });
  const res = await req(env, "GET", `${impactPath(eid, apId)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.impact.verdict, "regressed");
  assert.ok(res.json.impact.reasons.includes("pass_rate_decreased"));
  assert.ok(res.json.impact.reasons.includes("critical_issues_increased"));
});

test("GET impact: different acceptance set between before benchmark and follow-up run → inconclusive", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })],
    ["wprr_b", makeRun("wprr_b", {
      summary: { passed: 2, failed: 1 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "failed" },
      ],
    })],
    ["wprr_followup", makeRun("wprr_followup", {
      summary: { passed: 3 },
      results: [
        { itemId: "j1", title: "D", status: "passed" },
        { itemId: "j2", title: "E", status: "passed" },
        { itemId: "j3", title: "F", status: "passed" },
      ],
    })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_a");
  await link(env, eid, cands[1].id, "wprr_b");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "b", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "b", outcome: "selected" }],
  });
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;
  await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_followup",
  });
  const res = await req(env, "GET", `${impactPath(eid, apId)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.impact.verdict, "inconclusive");
  assert.ok(res.json.impact.reasons.includes("different_acceptance_set"));
});

test("GET impact: response contains no userKey/token even with full data", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })],
    ["wprr_b", makeRun("wprr_b", { summary: { passed: 2 } })],
    ["wprr_followup", makeRun("wprr_followup", { summary: { passed: 2 } })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_a");
  await link(env, eid, cands[1].id, "wprr_b");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  const created = await req(env, "POST", path(eid), { userKey: USER });
  const apId = created.json.actionPack.id;
  await req(env, "PATCH", followupPath(eid, apId), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_followup",
  });
  const res = await req(env, "GET", `${impactPath(eid, apId)}?userKey=${USER}`);
  const flat = JSON.stringify(res.json);
  assert.ok(!flat.includes(USER), "must not include the userKey value");
  assert.ok(!/uk_/.test(flat), "must not include any uk_ token");
  assert.ok(!/userKey/i.test(flat), "must not even mention userKey");
});

// ─── Stage 80: GET evolution-impact-summary ──────────────────────────────────

const summaryPath = (eid) =>
  `/workspace/projects/${PROJECT}/agent-experiments/${eid}/evolution-impact-summary`;

test("GET summary: missing userKey → 400", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", summaryPath(eid));
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("GET summary: unknown experiment → 404", async () => {
  const env = makeEnv();
  const res = await req(env, "GET", `${summaryPath("wexp_missing")}?userKey=${USER}`);
  assert.equal(res.status, 404);
});

test("GET summary: other user → 403", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", `${summaryPath(eid)}?userKey=uk_intruder`);
  assert.equal(res.status, 403);
});

test("GET summary: no saved action packs → no_followups + no_saved_action_packs", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const res = await req(env, "GET", `${summaryPath(eid)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.actionPackCount, 0);
  assert.equal(res.json.summary.followedPackCount, 0);
  assert.equal(res.json.summary.overallVerdict, "no_followups");
  assert.ok(res.json.summary.reasons.includes("no_saved_action_packs"));
});

test("GET summary: saved packs but no follow-ups → no_followups + no_followups reason", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "POST", path(eid), { userKey: USER });
  const res = await req(env, "GET", `${summaryPath(eid)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.actionPackCount, 2);
  assert.equal(res.json.summary.followedPackCount, 0);
  assert.equal(res.json.summary.overallVerdict, "no_followups");
  assert.ok(res.json.summary.reasons.includes("no_followups"));
});

test("GET summary: mostly_improved when more packs improved than regressed", async () => {
  // Set up an experiment with a real benchmark so before snapshots exist.
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", {
      summary: { passed: 3, failed: 1 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "passed" },
        { itemId: "i4", title: "D", status: "failed" },
      ],
    })],
    ["wprr_b", makeRun("wprr_b", {
      summary: { passed: 2, failed: 2 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "failed" },
        { itemId: "i4", title: "D", status: "failed" },
      ],
    })],
    ["wprr_fu_good", makeRun("wprr_fu_good", {
      summary: { passed: 4 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "passed" },
        { itemId: "i4", title: "D", status: "passed" },
      ],
    })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_a");
  await link(env, eid, cands[1].id, "wprr_b");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "a", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "a", outcome: "selected" }],
  });

  // Pack 1: link a follow-up that improves outcome.
  const p1 = await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, p1.json.actionPack.id), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_fu_good",
  });
  // Pack 2: link a follow-up that does the same (still improved).
  const p2 = await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, p2.json.actionPack.id), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_fu_good",
  });

  const res = await req(env, "GET", `${summaryPath(eid)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.actionPackCount, 2);
  assert.equal(res.json.summary.followedPackCount, 2);
  assert.equal(res.json.summary.verdictCounts.improved, 2);
  assert.equal(res.json.summary.overallVerdict, "mostly_improved");
  assert.ok(res.json.summary.reasons.includes("more_improved_than_regressed"));
});

test("GET summary: recommendedAction breakdown surfaces every action", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  // 3 saved packs from the same experiment without follow-ups (server-built
  // pack will be create_benchmark since no benchmark exists).
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "POST", path(eid), { userKey: USER });
  const res = await req(env, "GET", `${summaryPath(eid)}?userKey=${USER}`);
  assert.equal(res.status, 200);
  const counts = res.json.summary.recommendedActionCounts;
  assert.equal(counts.create_benchmark, 2);
  assert.equal(res.json.summary.recommendedActionVerdicts[0].recommendedAction, "create_benchmark");
  assert.equal(res.json.summary.recommendedActionVerdicts[0].inconclusive, 2);
});

test("GET summary: no userKey/token leakage in response with real data", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, env._db._actionPacks[0].id), {
    userKey: USER, status: "copied",
  });
  const res = await req(env, "GET", `${summaryPath(eid)}?userKey=${USER}`);
  const flat = JSON.stringify(res.json);
  assert.ok(!flat.includes(USER));
  assert.ok(!/uk_/.test(flat));
  assert.ok(!/userKey/i.test(flat));
});

// ─── Stage 81: GET project evolution-learning ───────────────────────────────

const learningPath = (proj = PROJECT) => `/workspace/projects/${proj}/evolution-learning`;

test("GET learning: missing userKey → 400", async () => {
  const env = makeEnv();
  const res = await req(env, "GET", learningPath());
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("GET learning: empty project (no experiments) → not_enough_data", async () => {
  const env = makeEnv();
  const res = await req(env, "GET", `${learningPath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.learning.experimentCount, 0);
  assert.equal(res.json.learning.actionPackCount, 0);
  assert.deepEqual(res.json.learning.topSignals, [{ type: "not_enough_data" }]);
});

test("GET learning: experiments exist but no action packs → not_enough_data", async () => {
  const env = makeEnv();
  await createExp(env);
  await createExp(env);
  const res = await req(env, "GET", `${learningPath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.learning.experimentCount, 2);
  assert.equal(res.json.learning.actionPackCount, 0);
  assert.deepEqual(res.json.learning.topSignals, [{ type: "not_enough_data" }]);
});

test("GET learning: only inconclusive packs → comparablePackCount=0 + not_enough_data", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "POST", path(eid), { userKey: USER });
  const res = await req(env, "GET", `${learningPath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.learning.actionPackCount, 3);
  assert.equal(res.json.learning.comparablePackCount, 0);
  assert.deepEqual(res.json.learning.topSignals, [{ type: "not_enough_data" }]);
});

test("GET learning: action_often_improves emerges across multiple experiments", async () => {
  // Two separate experiments, each yielding a comparable improved pack via a
  // benchmark + follow-up review run. fix_selected fires once per experiment.
  const runs = new Map();
  function addBenchRuns(label) {
    runs.set(`wprr_a_${label}`, makeRun(`wprr_a_${label}`, {
      summary: { passed: 3, failed: 1 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "passed" },
        { itemId: "i4", title: "D", status: "failed" },
      ],
    }));
    runs.set(`wprr_b_${label}`, makeRun(`wprr_b_${label}`, {
      summary: { passed: 2, failed: 2 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "failed" },
        { itemId: "i4", title: "D", status: "failed" },
      ],
    }));
    runs.set(`wprr_fu_${label}`, makeRun(`wprr_fu_${label}`, {
      summary: { passed: 4 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "passed" },
        { itemId: "i4", title: "D", status: "passed" },
      ],
    }));
  }
  addBenchRuns("x");
  addBenchRuns("y");
  addBenchRuns("z");

  const env = makeEnv({ runs });

  async function makeImprovedPack(label) {
    const { eid, cands } = await createExp(env);
    await link(env, eid, cands[0].id, `wprr_a_${label}`);
    await link(env, eid, cands[1].id, `wprr_b_${label}`);
    await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
    await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
      userKey: USER, selectedCandidateId: "a", decisionStatus: "selected",
      candidateOutcomes: [{ candidateId: "a", outcome: "selected" }],
    });
    const created = await req(env, "POST", path(eid), { userKey: USER });
    await req(env, "PATCH", followupPath(eid, created.json.actionPack.id), {
      userKey: USER, status: "reviewed", reviewRunId: `wprr_fu_${label}`,
    });
  }

  await makeImprovedPack("x");
  await makeImprovedPack("y");
  await makeImprovedPack("z");

  const res = await req(env, "GET", `${learningPath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.learning.experimentCount, 3);
  assert.equal(res.json.learning.actionPackCount, 3);
  assert.equal(res.json.learning.followedPackCount, 3);
  assert.equal(res.json.learning.comparablePackCount, 3);
  assert.equal(res.json.learning.verdictCounts.improved, 3);

  const improvesSignal = res.json.learning.topSignals.find((s) => s.type === "action_often_improves");
  assert.ok(improvesSignal, "expected action_often_improves at the project level");
  assert.equal(improvesSignal.recommendedAction, "fix_selected");

  const eff = res.json.learning.recommendedActionEffectiveness.find(
    (x) => x.recommendedAction === "fix_selected",
  );
  assert.equal(eff.total, 3);
  assert.equal(eff.followed, 3);
  assert.equal(eff.comparable, 3);
  assert.equal(eff.improved, 3);
  assert.equal(eff.improvementRate, 1);
});

test("GET learning: other-user's experiments excluded (cross-tenant isolation)", async () => {
  // Use a different `runs` map so links resolve, but create one experiment as
  // owner USER and one as OTHER, then verify only USER's data shows.
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", { summary: { passed: 1 } })],
    ["wprr_b", makeRun("wprr_b", { summary: { passed: 1 } })],
  ]);
  const env = makeEnv({ runs });
  // Owner USER: one experiment + one pack.
  const { eid: eidMine } = await createExp(env);
  await req(env, "POST", path(eidMine), { userKey: USER });
  // A second experiment created by another user in the same project namespace.
  const other = await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: "uk_other",
    title: "Other",
    templateId: "multi_agent_split",
    candidates: [
      { id: "a", label: "Builder A", mode: "multi_agent", role: "builder", suggestedAgent: "claude_code" },
      { id: "b", label: "Builder B", mode: "multi_agent", role: "builder", suggestedAgent: "codex" },
    ],
  });
  await req(env, "POST", path(other.json.experiment.id), { userKey: "uk_other" });
  await req(env, "POST", path(other.json.experiment.id), { userKey: "uk_other" });

  const res = await req(env, "GET", `${learningPath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.learning.experimentCount, 1);
  assert.equal(res.json.learning.actionPackCount, 1);
});

test("GET learning: response contains no userKey/token even with real data", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, env._db._actionPacks[0].id), {
    userKey: USER, status: "copied",
  });
  const res = await req(env, "GET", `${learningPath()}?userKey=${USER}`);
  const flat = JSON.stringify(res.json);
  assert.ok(!flat.includes(USER));
  assert.ok(!/uk_/.test(flat));
  assert.ok(!/userKey/i.test(flat));
});

// ─── Stage 82: GET project evolution-timeline ───────────────────────────────

const timelinePath = (proj = PROJECT) => `/workspace/projects/${proj}/evolution-timeline`;

test("GET timeline: missing userKey → 400", async () => {
  const env = makeEnv();
  const res = await req(env, "GET", timelinePath());
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "userKey_required");
});

test("GET timeline: empty project → eventCount 0, no events, no limitations", async () => {
  const env = makeEnv();
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.timeline.eventCount, 0);
  assert.deepEqual(res.json.timeline.events, []);
  assert.deepEqual(res.json.timeline.limitations, []);
});

test("GET timeline: experiment_created event surfaces with href", async () => {
  const env = makeEnv();
  await createExp(env);
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  const e = res.json.timeline.events.find((ev) => ev.type === "experiment_created");
  assert.ok(e);
  assert.equal(e.title, "Experiment created");
  assert.ok(e.href.startsWith(`/projects/${PROJECT}/experiment?experiment=`));
});

test("GET timeline: action_pack_saved event for each saved pack", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "POST", path(eid), { userKey: USER });
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  const packs = res.json.timeline.events.filter((ev) => ev.type === "action_pack_saved");
  assert.equal(packs.length, 2);
  assert.equal(packs[0].experimentId, eid);
  assert.equal(packs[0].recommendedAction, "create_benchmark");
});

test("GET timeline: followup_recorded event when followedAt is stamped", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  const created = await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, created.json.actionPack.id), {
    userKey: USER, status: "copied",
  });
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  const e = res.json.timeline.events.find((ev) => ev.type === "followup_recorded");
  assert.ok(e);
  assert.equal(e.actionPackId, created.json.actionPack.id);
  assert.equal(e.status, "copied");
});

test("GET timeline: impact_improved end-to-end with benchmark + review-run follow-up", async () => {
  const runs = new Map([
    ["wprr_a", makeRun("wprr_a", {
      summary: { passed: 3, failed: 1 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "passed" },
        { itemId: "i4", title: "D", status: "failed" },
      ],
    })],
    ["wprr_b", makeRun("wprr_b", {
      summary: { passed: 2, failed: 2 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "failed" },
        { itemId: "i4", title: "D", status: "failed" },
      ],
    })],
    ["wprr_fu_good", makeRun("wprr_fu_good", {
      summary: { passed: 4 },
      results: [
        { itemId: "i1", title: "A", status: "passed" },
        { itemId: "i2", title: "B", status: "passed" },
        { itemId: "i3", title: "C", status: "passed" },
        { itemId: "i4", title: "D", status: "passed" },
      ],
    })],
  ]);
  const env = makeEnv({ runs });
  const { eid, cands } = await createExp(env);
  await link(env, eid, cands[0].id, "wprr_a");
  await link(env, eid, cands[1].id, "wprr_b");
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/benchmark`, { userKey: USER });
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments/${eid}/decision`, {
    userKey: USER, selectedCandidateId: "a", decisionStatus: "selected",
    candidateOutcomes: [{ candidateId: "a", outcome: "selected" }],
  });
  const created = await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, created.json.actionPack.id), {
    userKey: USER, status: "reviewed", reviewRunId: "wprr_fu_good",
  });

  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  assert.equal(res.status, 200);
  // All five event types fire: experiment_created, benchmark_created,
  // decision_recorded, action_pack_saved, followup_recorded, impact_improved.
  const types = new Set(res.json.timeline.events.map((e) => e.type));
  assert.ok(types.has("experiment_created"));
  assert.ok(types.has("benchmark_created"));
  assert.ok(types.has("decision_recorded"));
  assert.ok(types.has("action_pack_saved"));
  assert.ok(types.has("followup_recorded"));
  assert.ok(types.has("impact_improved"));
  const impactEvent = res.json.timeline.events.find((e) => e.type === "impact_improved");
  assert.equal(impactEvent.verdict, "improved");
});

test("GET timeline: events sorted by occurredAt DESC", async () => {
  const env = makeEnv();
  const a = await createExp(env);
  const b = await createExp(env);
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  const ids = res.json.timeline.events
    .filter((e) => e.type === "experiment_created")
    .map((e) => e.experimentId);
  // Most-recent experiment first. Since createExp uses Date.now() under the
  // hood, the second one is newer.
  assert.equal(ids[0], b.eid);
  assert.equal(ids[1], a.eid);
});

test("GET timeline: other user's experiments excluded (cross-tenant isolation)", async () => {
  const env = makeEnv();
  await createExp(env);
  await req(env, "POST", `/workspace/projects/${PROJECT}/agent-experiments`, {
    userKey: "uk_other",
    title: "Other", templateId: "multi_agent_split",
    candidates: [
      { id: "a", label: "A", mode: "multi_agent", role: "builder", suggestedAgent: "claude_code" },
      { id: "b", label: "B", mode: "multi_agent", role: "builder", suggestedAgent: "codex" },
    ],
  });
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  const expEvents = res.json.timeline.events.filter((e) => e.type === "experiment_created");
  assert.equal(expEvents.length, 1);
});

test("GET timeline: response contains no userKey/token", async () => {
  const env = makeEnv();
  const { eid } = await createExp(env);
  await req(env, "POST", path(eid), { userKey: USER });
  await req(env, "PATCH", followupPath(eid, env._db._actionPacks[0].id), {
    userKey: USER, status: "copied",
  });
  const res = await req(env, "GET", `${timelinePath()}?userKey=${USER}`);
  const flat = JSON.stringify(res.json);
  assert.ok(!flat.includes(USER));
  assert.ok(!/uk_/.test(flat));
  assert.ok(!/userKey/i.test(flat));
});

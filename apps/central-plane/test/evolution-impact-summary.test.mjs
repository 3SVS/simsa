// Stage 80: pure aggregator turning per-pack EvolutionImpactComparison results
// into an experiment-level summary. The HTTP endpoint wiring is exercised in
// workspace-evolution-action-pack.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

const { buildEvolutionImpactSummary } = await import(
  "../dist/workspace/evolution-impact-summary.js"
);

/** Build a stub EvolutionImpactComparison for the aggregator. */
function compare({ verdict, delta, limitations = [], actionPackId = "weap_x" } = {}) {
  return {
    actionPackId,
    experimentId: "wexp_x",
    projectId: "proj_x",
    recommendedAction: "fix_selected",
    before: null,
    after: null,
    delta: delta ?? null,
    verdict,
    reasons: [],
    limitations,
  };
}

function entry({ verdict, followed = true, recommendedAction = "fix_selected", delta, limitations = [] } = {}) {
  return { comparison: compare({ verdict, delta, limitations }), followed, recommendedAction };
}

const COMMON = { projectId: "proj_x", experimentId: "wexp_x" };

test("no entries → overallVerdict no_followups + no_saved_action_packs", () => {
  const s = buildEvolutionImpactSummary({ ...COMMON, entries: [] });
  assert.equal(s.actionPackCount, 0);
  assert.equal(s.followedPackCount, 0);
  assert.equal(s.overallVerdict, "no_followups");
  assert.ok(s.reasons.includes("no_saved_action_packs"));
  assert.equal(s.averageDelta.passRateDelta, null);
  assert.deepEqual(s.recommendedActionVerdicts, []);
});

test("packs exist but none followed → overallVerdict no_followups + no_followups", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "inconclusive", followed: false }),
      entry({ verdict: "inconclusive", followed: false }),
    ],
  });
  assert.equal(s.actionPackCount, 2);
  assert.equal(s.followedPackCount, 0);
  assert.equal(s.overallVerdict, "no_followups");
  assert.ok(s.reasons.includes("no_followups"));
});

test("mostly_inconclusive when ≥70% inconclusive", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "inconclusive" }),
      entry({ verdict: "inconclusive" }),
      entry({ verdict: "inconclusive" }),
      entry({ verdict: "improved", delta: { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 } }),
    ],
  });
  // 3/4 = 0.75 ≥ 0.7
  assert.equal(s.overallVerdict, "mostly_inconclusive");
  assert.ok(s.reasons.includes("mostly_inconclusive"));
});

test("regressed when regressed > improved", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "regressed", delta: { passRateDelta: -0.1, passedDelta: -1, criticalIssueDelta: 1, notVerifiedDelta: 0, blockerDelta: 1 } }),
      entry({ verdict: "regressed", delta: { passRateDelta: -0.05, passedDelta: -1, criticalIssueDelta: 1, notVerifiedDelta: 0, blockerDelta: 1 } }),
      entry({ verdict: "improved", delta: { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: -1, notVerifiedDelta: 0, blockerDelta: -1 } }),
    ],
  });
  assert.equal(s.overallVerdict, "regressed");
  assert.ok(s.reasons.includes("regressions_detected"));
});

test("mostly_improved when improved > regressed AND improved > 0", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "improved", delta: { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: -1, notVerifiedDelta: 0, blockerDelta: -1 } }),
      entry({ verdict: "improved", delta: { passRateDelta: 0.2, passedDelta: 2, criticalIssueDelta: -2, notVerifiedDelta: -1, blockerDelta: -2 } }),
      entry({ verdict: "unchanged", delta: { passRateDelta: 0, passedDelta: 0, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 } }),
    ],
  });
  assert.equal(s.overallVerdict, "mostly_improved");
  assert.ok(s.reasons.includes("more_improved_than_regressed"));
});

test("mixed when neither improved>regressed nor regressed>improved", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "improved", delta: { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: -1, notVerifiedDelta: 0, blockerDelta: -1 } }),
      entry({ verdict: "regressed", delta: { passRateDelta: -0.05, passedDelta: -1, criticalIssueDelta: 1, notVerifiedDelta: 0, blockerDelta: 1 } }),
      entry({ verdict: "unchanged", delta: { passRateDelta: 0, passedDelta: 0, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 } }),
    ],
  });
  assert.equal(s.overallVerdict, "mixed");
  assert.ok(s.reasons.includes("mixed_results"));
});

test("recommendedAction breakdown counts each action's verdict mix", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "improved", recommendedAction: "fix_selected", delta: { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 } }),
      entry({ verdict: "regressed", recommendedAction: "fix_selected", delta: { passRateDelta: -0.1, passedDelta: -1, criticalIssueDelta: 1, notVerifiedDelta: 0, blockerDelta: 0 } }),
      entry({ verdict: "improved", recommendedAction: "rerun_experiment", delta: { passRateDelta: 0.2, passedDelta: 2, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 } }),
      entry({ verdict: "inconclusive", recommendedAction: "create_benchmark" }),
    ],
  });
  const byAction = Object.fromEntries(s.recommendedActionVerdicts.map((r) => [r.recommendedAction, r]));
  assert.equal(byAction.fix_selected.total, 2);
  assert.equal(byAction.fix_selected.improved, 1);
  assert.equal(byAction.fix_selected.regressed, 1);
  assert.equal(byAction.rerun_experiment.improved, 1);
  assert.equal(byAction.create_benchmark.inconclusive, 1);
  assert.deepEqual(s.recommendedActionCounts, {
    fix_selected: 2,
    rerun_experiment: 1,
    create_benchmark: 1,
  });
  // recommendedActionVerdicts must be sorted alphabetically for determinism.
  assert.deepEqual(
    s.recommendedActionVerdicts.map((r) => r.recommendedAction),
    ["create_benchmark", "fix_selected", "rerun_experiment"],
  );
});

test("average delta is unweighted mean over packs that have a delta; ignores null deltas", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "improved", delta: { passRateDelta: 0.10, passedDelta: 2, criticalIssueDelta: -2, notVerifiedDelta: -1, blockerDelta: -3 } }),
      entry({ verdict: "improved", delta: { passRateDelta: 0.30, passedDelta: 5, criticalIssueDelta: -1, notVerifiedDelta: 0, blockerDelta: -1 } }),
      // Inconclusive with null delta (e.g. missing follow-up) — should be skipped.
      entry({ verdict: "inconclusive", delta: null }),
    ],
  });
  // mean of [0.10, 0.30] = 0.20
  assert.ok(Math.abs(s.averageDelta.passRateDelta - 0.2) < 1e-9);
  // mean of [-2, -1] = -1.5
  assert.equal(s.averageDelta.criticalIssueDelta, -1.5);
  // mean of [-1, 0] = -0.5
  assert.equal(s.averageDelta.notVerifiedDelta, -0.5);
  // mean of [-3, -1] = -2
  assert.equal(s.averageDelta.blockerDelta, -2);
});

test("averageDelta all null when no entry has a delta", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "inconclusive", delta: null }),
      entry({ verdict: "inconclusive", delta: null }),
    ],
  });
  assert.equal(s.averageDelta.passRateDelta, null);
  assert.equal(s.averageDelta.criticalIssueDelta, null);
  assert.equal(s.averageDelta.notVerifiedDelta, null);
  assert.equal(s.averageDelta.blockerDelta, null);
  // Followed but no comparable data → not_enough_comparable_data
  assert.ok(s.reasons.includes("not_enough_comparable_data"));
});

test("limitations are de-duplicated and sorted", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "inconclusive", limitations: ["before_benchmark_other_owner", "pack_json_unreadable"] }),
      entry({ verdict: "inconclusive", limitations: ["pack_json_unreadable"] }),
    ],
  });
  assert.deepEqual(s.limitations, ["before_benchmark_other_owner", "pack_json_unreadable"]);
});

test("summary never includes a userKey or token in any string field", () => {
  const s = buildEvolutionImpactSummary({
    ...COMMON,
    entries: [
      entry({ verdict: "improved", delta: { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 } }),
      entry({ verdict: "regressed", delta: { passRateDelta: -0.1, passedDelta: -1, criticalIssueDelta: 1, notVerifiedDelta: 0, blockerDelta: 1 } }),
    ],
  });
  const flat = JSON.stringify(s);
  assert.ok(!/userKey/i.test(flat));
  assert.ok(!/uk_/.test(flat));
  assert.ok(!/token/i.test(flat));
});

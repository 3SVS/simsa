// Stage 82: pure deterministic project evolution timeline builder.
// HTTP endpoint wiring is exercised in workspace-evolution-action-pack.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

const { buildProjectEvolutionTimeline } = await import(
  "../dist/workspace/project-evolution-timeline.js"
);

const PROJ = "proj_x";

function exp({ id = "wexp_1", title = "Exp", createdAt = "2026-06-10T00:00:00Z", decisionStatus, decidedAt, status = "draft", selectedCandidateId } = {}) {
  return { id, title, createdAt, decisionStatus, decidedAt, status, selectedCandidateId };
}

function bench({ id = "wab_1", title, createdAt = "2026-06-11T00:00:00Z", sourceExperimentId } = {}) {
  return { id, title, createdAt, sourceExperimentId };
}

function pack({
  id = "weap_1",
  experimentId = "wexp_1",
  recommendedAction = "fix_selected",
  title = "Fix the selected candidate",
  createdAt = "2026-06-12T00:00:00Z",
  followup = { status: "not_started" },
  impact,
} = {}) {
  return { id, experimentId, recommendedAction, title, createdAt, followup, impact };
}

function impact(verdict, delta = { passRateDelta: 0.1, passedDelta: 1, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 }) {
  return {
    actionPackId: "weap_1",
    experimentId: "wexp_1",
    projectId: PROJ,
    recommendedAction: "fix_selected",
    before: null,
    after: null,
    delta,
    verdict,
    reasons: [],
    limitations: [],
  };
}

test("empty project → eventCount 0, no events, no limitations", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ, experiments: [], benchmarks: [], actionPacks: [],
  });
  assert.equal(t.eventCount, 0);
  assert.deepEqual(t.events, []);
  assert.deepEqual(t.limitations, []);
});

test("experiment_created event emitted with experiment href", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [exp({ id: "wexp_a", title: "Multi-agent split", createdAt: "2026-06-10T00:00:00Z" })],
    benchmarks: [],
    actionPacks: [],
  });
  assert.equal(t.eventCount, 1);
  assert.equal(t.events[0].type, "experiment_created");
  assert.equal(t.events[0].title, "Experiment created");
  assert.equal(t.events[0].summary, "Multi-agent split");
  assert.equal(t.events[0].experimentId, "wexp_a");
  assert.equal(t.events[0].href, "/projects/proj_x/experiment?experiment=wexp_a");
});

test("decision_recorded event only when decidedAt is set", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [
      exp({ id: "wexp_a", createdAt: "2026-06-10T00:00:00Z", decisionStatus: "selected", decidedAt: "2026-06-15T00:00:00Z" }),
      exp({ id: "wexp_b", createdAt: "2026-06-10T00:00:00Z" }), // no decision
    ],
    benchmarks: [],
    actionPacks: [],
  });
  const decisions = t.events.filter((e) => e.type === "decision_recorded");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].experimentId, "wexp_a");
  assert.equal(decisions[0].status, "selected");
});

test("benchmark_created emitted with benchmark href + experimentId from sourceExperimentId", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [bench({ id: "wab_42", title: "Multi-agent split — benchmark", createdAt: "2026-06-11T00:00:00Z", sourceExperimentId: "wexp_a" })],
    actionPacks: [],
  });
  assert.equal(t.events[0].type, "benchmark_created");
  assert.equal(t.events[0].title, "Benchmark created");
  assert.equal(t.events[0].summary, "Multi-agent split — benchmark");
  assert.equal(t.events[0].benchmarkId, "wab_42");
  assert.equal(t.events[0].experimentId, "wexp_a");
  assert.equal(t.events[0].href, "/projects/proj_x/benchmark/wab_42");
});

test("action_pack_saved emitted with experimentId + recommendedAction", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [pack({ id: "weap_x", experimentId: "wexp_a", recommendedAction: "fix_selected", title: "Fix the selected candidate" })],
  });
  const e = t.events.find((ev) => ev.type === "action_pack_saved");
  assert.ok(e);
  assert.equal(e.actionPackId, "weap_x");
  assert.equal(e.experimentId, "wexp_a");
  assert.equal(e.recommendedAction, "fix_selected");
  assert.equal(e.href, "/projects/proj_x/experiment?experiment=wexp_a");
});

test("followup_recorded ONLY when pack.followup.followedAt exists", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [
      pack({ id: "weap_no", followup: { status: "not_started" } }),
      pack({ id: "weap_yes", followup: { status: "copied", followedAt: "2026-06-13T00:00:00Z" } }),
    ],
  });
  const followups = t.events.filter((ev) => ev.type === "followup_recorded");
  assert.equal(followups.length, 1);
  assert.equal(followups[0].actionPackId, "weap_yes");
  assert.equal(followups[0].status, "copied");
  assert.equal(followups[0].occurredAt, "2026-06-13T00:00:00Z");
});

test("impact_improved emitted alongside followup when impact verdict is improved", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [
      pack({
        followup: { status: "reviewed", reviewRunId: "wprr_fu", followedAt: "2026-06-13T00:00:00Z" },
        impact: impact("improved"),
      }),
    ],
  });
  const e = t.events.find((ev) => ev.type === "impact_improved");
  assert.ok(e, "expected impact_improved event");
  assert.equal(e.verdict, "improved");
  // Anchored to the moment the follow-up was recorded.
  assert.equal(e.occurredAt, "2026-06-13T00:00:00Z");
});

test("impact_regressed maps to regressed verdict", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [pack({ followup: { status: "reviewed", followedAt: "2026-06-13T00:00:00Z" }, impact: impact("regressed") })],
  });
  assert.ok(t.events.find((ev) => ev.type === "impact_regressed"));
});

test("impact_inconclusive emitted when verdict is inconclusive (still has followedAt)", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [pack({ followup: { status: "copied", followedAt: "2026-06-13T00:00:00Z" }, impact: impact("inconclusive", null) })],
  });
  assert.ok(t.events.find((ev) => ev.type === "impact_inconclusive"));
});

test("impact_unchanged emitted when verdict is unchanged", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [pack({ followup: { status: "reviewed", followedAt: "2026-06-13T00:00:00Z" }, impact: impact("unchanged", { passRateDelta: 0, passedDelta: 0, criticalIssueDelta: 0, notVerifiedDelta: 0, blockerDelta: 0 }) })],
  });
  assert.ok(t.events.find((ev) => ev.type === "impact_unchanged"));
});

test("no impact event when pack has no follow-up (followedAt missing)", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [],
    benchmarks: [],
    actionPacks: [
      pack({ followup: { status: "not_started" }, impact: impact("improved") /* defensive — should be ignored */ }),
    ],
  });
  // action_pack_saved emitted but no followup/impact events.
  assert.equal(t.events.filter((ev) => ev.type === "impact_improved").length, 0);
  assert.equal(t.events.filter((ev) => ev.type === "followup_recorded").length, 0);
});

test("events sorted by occurredAt DESC (newest first); ties broken by event id", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [
      exp({ id: "wexp_old", createdAt: "2026-05-01T00:00:00Z" }),
      exp({ id: "wexp_new", createdAt: "2026-06-30T00:00:00Z" }),
      exp({ id: "wexp_mid", createdAt: "2026-06-10T00:00:00Z" }),
    ],
    benchmarks: [],
    actionPacks: [],
  });
  assert.deepEqual(
    t.events.map((e) => e.experimentId),
    ["wexp_new", "wexp_mid", "wexp_old"],
  );
});

test("timeline_truncated limitation when > 50 events; output capped at 50", () => {
  const experiments = [];
  for (let i = 0; i < 60; i += 1) {
    // Stagger timestamps so sort is meaningful.
    const month = (i % 12) + 1;
    const day = (i % 28) + 1;
    experiments.push(
      exp({
        id: `wexp_${i}`,
        title: `Exp ${i}`,
        createdAt: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`,
      }),
    );
  }
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ, experiments, benchmarks: [], actionPacks: [],
  });
  assert.equal(t.events.length, 50);
  assert.equal(t.eventCount, 50);
  assert.ok(t.limitations.includes("timeline_truncated"));
});

test("no userKey/token in any string of the response", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: PROJ,
    experiments: [exp({ title: "uk_owner_test", decisionStatus: "selected", decidedAt: "2026-06-15T00:00:00Z" })],
    benchmarks: [bench({ title: "uk_owner_bench" })],
    actionPacks: [pack({ followup: { status: "copied", followedAt: "2026-06-13T00:00:00Z" }, impact: impact("improved") })],
  });
  const flat = JSON.stringify(t);
  // The helper itself never injects a userKey. The fixture intentionally
  // includes "uk_owner_*" inside experiment/benchmark titles to prove the
  // helper does not filter user-supplied strings — those flow through, but
  // the helper itself emits no userKey field.
  assert.ok(!/userKey/i.test(flat), "must not include the userKey key name");
  assert.ok(!/\btoken\b/i.test(flat), "must not include the token literal");
});

test("href fields are present for every event type and encode unsafe ids", () => {
  const t = buildProjectEvolutionTimeline({
    projectId: "proj/x", // unsafe — verify encoding
    experiments: [exp({ id: "wexp/a", decisionStatus: "selected", decidedAt: "2026-06-15T00:00:00Z" })],
    benchmarks: [bench({ id: "wab/1" })],
    actionPacks: [pack({ id: "weap/p", experimentId: "wexp/a", followup: { status: "copied", followedAt: "2026-06-13T00:00:00Z" }, impact: impact("improved") })],
  });
  for (const e of t.events) {
    assert.ok(e.href, `expected href on ${e.type}`);
    // Slashes inside ids must be encoded so the URL stays parseable.
    assert.ok(!e.href.includes("wexp/a"), "experimentId in href should be encoded");
  }
});

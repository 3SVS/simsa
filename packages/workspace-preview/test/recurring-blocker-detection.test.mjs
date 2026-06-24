// Stage 127 — Recurring Blocker Detection tests. Pure/deterministic; derived-only
// (no cross-project training, no persistence). Blockers are signals, not defects.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecurringBlockerDetectionView,
  BLOCKER_TYPES,
} from "../src/recurring-blocker-detection.mjs";
import { buildAgentRunPlan } from "../src/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/intake-evidence-plan.mjs";
import { buildIntakeAcceptanceMap } from "../src/intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "../src/intake-stage-plan.mjs";

const SEV = ["low", "medium", "high"];
const FORBIDDEN = ["proven root cause", "guaranteed blocker", "verified defect", "model-learned", "production risk confirmed"];

function savedWorkflow(type, rawInput) {
  return {
    workflowRecordId: "wawr_t",
    title: `${type} wf`,
    sourceSummary: `${type} snapshot`,
    acceptanceMap: buildIntakeAcceptanceMap({ type, rawInput }),
    stagePlan: buildIntakeStagePlan({ type, rawInput }),
    agentRunPlan: buildAgentRunPlan({ type, rawInput }),
    evidencePlan: buildIntakeEvidencePlan({ type, rawInput }),
  };
}

function assertView(v) {
  assert.ok(v.title.length > 0);
  assert.ok(v.summary.length > 0);
  assert.ok(SEV.includes(v.confidence));
  assert.ok(v.blockers.length <= 6);
  const ids = new Set();
  for (const b of v.blockers) {
    assert.ok(b.id && !ids.has(b.id));
    ids.add(b.id);
    assert.ok(BLOCKER_TYPES.includes(b.type), `bad type ${b.type}`);
    assert.ok(SEV.includes(b.severity));
    assert.ok(b.title.length > 0 && b.summary.length > 0);
    assert.ok(Array.isArray(b.sourceSignals) && b.sourceSignals.length >= 1);
    assert.ok(Array.isArray(b.relatedAcceptanceAreas));
    assert.ok(Array.isArray(b.relatedEvidenceTypes));
    assert.ok(Array.isArray(b.relatedStageNumbers));
    assert.ok(Array.isArray(b.relatedTaskIds));
    assert.ok(b.suggestedNextAction.length > 0);
  }
  for (const t of BLOCKER_TYPES) assert.ok(Number.isInteger(v.blockerCountByType[t]));
  if (v.blockers.length > 0) assert.ok(BLOCKER_TYPES.includes(v.topBlockerType));
  assert.ok(v.notIncludedYet.length >= 4);
  // No "verified defect / proven / model-learned" claims.
  const blob = JSON.stringify({ ...v, notIncludedYet: [] }).toLowerCase();
  for (const w of FORBIDDEN) assert.ok(!blob.includes(w), `must not contain "${w}"`);
}

test("builds a blocker view for every intake type", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    assertView(buildRecurringBlockerDetectionView(savedWorkflow(type, "some pasted input")));
  }
});

test("detects repeated missing evidence", () => {
  const v = buildRecurringBlockerDetectionView({
    title: "ME", sourceSummary: "s",
    acceptanceMap: { items: [{ title: "A", area: "primary_user_flow", status: "needs_verification" }] },
    stagePlan: { stages: [] },
    agentRunPlan: { tasks: [] },
    evidencePlan: {
      expectations: [
        { id: "e1", acceptanceItemTitle: "A", relatedArea: "primary_user_flow", evidenceTypes: ["walkthrough"], status: "needed", decisionImpact: "not_verified" },
        { id: "e2", acceptanceItemTitle: "B", relatedArea: "onboarding", evidenceTypes: ["walkthrough"], status: "needed", decisionImpact: "not_verified" },
      ],
    },
  });
  assert.ok(v.blockers.some((b) => b.type === "missing_evidence"));
  assertView(v);
});

test("detects not_verified cluster (>=2) and rates many as high", () => {
  const exp = (i) => ({ id: `e${i}`, acceptanceItemTitle: `A${i}`, relatedArea: "primary_user_flow", evidenceTypes: ["review_note"], status: "not_verified", decisionImpact: "not_verified" });
  const v = buildRecurringBlockerDetectionView({
    title: "NV", sourceSummary: "s",
    acceptanceMap: { items: [] }, stagePlan: { stages: [] }, agentRunPlan: { tasks: [] },
    evidencePlan: { expectations: [exp(1), exp(2), exp(3), exp(4)] },
  });
  const nv = v.blockers.find((b) => b.type === "not_verified_cluster");
  assert.ok(nv);
  assert.equal(nv.severity, "high");
});

test("detects release readiness gap (high)", () => {
  const v = buildRecurringBlockerDetectionView({
    title: "REL", sourceSummary: "s",
    acceptanceMap: { items: [{ title: "Release readiness", area: "release_readiness", status: "needs_verification" }] },
    stagePlan: { stages: [{ number: 5, title: "Release", kind: "release" }] },
    agentRunPlan: { tasks: [] },
    evidencePlan: { expectations: [{ id: "e1", acceptanceItemTitle: "Release readiness", relatedArea: "release_readiness", evidenceTypes: ["release_decision_note"], status: "needs_decision", decisionImpact: "defer" }] },
  });
  const rel = v.blockers.find((b) => b.type === "release_readiness_gap");
  assert.ok(rel);
  assert.equal(rel.severity, "high");
});

test("detects fix/rerun cluster", () => {
  const v = buildRecurringBlockerDetectionView({
    title: "FR", sourceSummary: "s",
    acceptanceMap: { items: [] }, stagePlan: { stages: [] }, agentRunPlan: { tasks: [] },
    evidencePlan: {
      expectations: [
        { id: "e1", acceptanceItemTitle: "A", relatedArea: "error_recovery", evidenceTypes: ["fix_summary"], status: "needed", decisionImpact: "fix" },
        { id: "e2", acceptanceItemTitle: "B", relatedArea: "primary_user_flow", evidenceTypes: ["test_result"], status: "not_verified", decisionImpact: "rerun" },
      ],
    },
  });
  assert.ok(v.blockers.some((b) => b.type === "fix_rerun_cluster"));
});

test("detects unclear acceptance scope", () => {
  const v = buildRecurringBlockerDetectionView({
    title: "UN", sourceSummary: "s",
    acceptanceMap: { items: [{ title: "A", area: "product_intent", status: "missing_detail" }] },
    stagePlan: { stages: [] }, agentRunPlan: { tasks: [] },
    evidencePlan: { expectations: [], missingEvidenceQuestions: ["What is the goal?"] },
  });
  assert.ok(v.blockers.some((b) => b.type === "unclear_acceptance_scope"));
});

test("tooling_gap is conservative: tool recommended but no matching evidence + not_verified", () => {
  const v = buildRecurringBlockerDetectionView({
    title: "TG", sourceSummary: "s",
    acceptanceMap: { items: [] }, stagePlan: { stages: [] },
    agentRunPlan: { tasks: [{ id: "task-1", stageNumber: 1, role: "verifier", task: "check", recommendedTool: "browser_check" }] },
    evidencePlan: { expectations: [{ id: "e1", acceptanceItemTitle: "A", relatedArea: "primary_user_flow", evidenceTypes: ["review_note"], status: "not_verified", decisionImpact: "not_verified" }] },
  });
  assert.ok(v.blockers.some((b) => b.type === "tooling_gap"));
  // No tooling gap when matching evidence exists.
  const v2 = buildRecurringBlockerDetectionView({
    title: "TG2", sourceSummary: "s",
    acceptanceMap: { items: [] }, stagePlan: { stages: [] },
    agentRunPlan: { tasks: [{ id: "task-1", stageNumber: 1, role: "verifier", task: "check", recommendedTool: "browser_check" }] },
    evidencePlan: { expectations: [{ id: "e1", acceptanceItemTitle: "A", relatedArea: "primary_user_flow", evidenceTypes: ["screenshot"], status: "not_verified", decisionImpact: "not_verified" }] },
  });
  assert.ok(!v2.blockers.some((b) => b.type === "tooling_gap"));
});

test("returns no blockers for weak/minimal input", () => {
  const v = buildRecurringBlockerDetectionView({ title: "Empty", sourceSummary: "" });
  assert.equal(v.blockers.length, 0);
  assert.equal(v.topBlockerType, undefined);
  assert.equal(v.confidence, "low");
  assertView(v);
});

test("caps blockers at 6", () => {
  // Build input that triggers many types at once.
  const v = buildRecurringBlockerDetectionView({
    title: "MANY", sourceSummary: "s",
    acceptanceMap: { items: [{ title: "Release readiness", area: "release_readiness", status: "missing_detail" }] },
    stagePlan: { stages: [{ number: 5, title: "Release", kind: "release" }] },
    agentRunPlan: { tasks: [{ id: "task-1", stageNumber: 1, role: "verifier", task: "check", recommendedTool: "browser_check" }] },
    evidencePlan: {
      expectations: [
        { id: "e1", acceptanceItemTitle: "Release readiness", relatedArea: "release_readiness", evidenceTypes: ["walkthrough"], status: "not_verified", decisionImpact: "fix" },
        { id: "e2", acceptanceItemTitle: "B", relatedArea: "primary_user_flow", evidenceTypes: ["walkthrough"], status: "not_verified", decisionImpact: "rerun" },
        { id: "e3", acceptanceItemTitle: "C", relatedArea: "onboarding", evidenceTypes: ["walkthrough"], status: "not_verified", decisionImpact: "fix" },
      ],
      missingEvidenceQuestions: ["q1", "q2"],
    },
  });
  assert.ok(v.blockers.length <= 6);
  assert.ok(v.blockers.length >= 4);
});

test("includes notIncludedYet disclaimers (derived only / no training)", () => {
  const v = buildRecurringBlockerDetectionView(savedWorkflow("github_repo", "acme/web-app"));
  const joined = v.notIncludedYet.join(" ").toLowerCase();
  assert.match(joined, /derived from this saved workflow only/);
  assert.match(joined, /no cross-project model or training/);
});

test("handles malformed snapshots without throwing", () => {
  const bad = [null, undefined, 7, "x", { items: "no" }, { expectations: [null, 1, {}] }];
  for (const m of bad) {
    assert.doesNotThrow(() =>
      buildRecurringBlockerDetectionView({
        title: "M", sourceSummary: "",
        acceptanceGraphView: m, acceptanceMap: m, stagePlan: m, agentRunPlan: m,
        evidencePlan: m, decisionOutcomePreview: m, evolutionActionPreview: m,
      }),
    );
  }
});

test("deterministic output for identical input", () => {
  const a = buildRecurringBlockerDetectionView(savedWorkflow("github_repo", "acme/web-app"));
  const b = buildRecurringBlockerDetectionView(savedWorkflow("github_repo", "acme/web-app"));
  assert.deepEqual(a, b);
});

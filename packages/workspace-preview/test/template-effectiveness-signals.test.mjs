// Stage 129 — Template Effectiveness Signals tests. Pure/deterministic; per-
// workflow derived only (no cross-project analytics / training / persistence).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplateEffectivenessSignalsView,
  SIGNAL_TYPES,
  QUALITIES,
} from "../src/template-effectiveness-signals.mjs";
import { buildAcceptanceGraphDerivedView } from "../src/acceptance-graph-derived.mjs";
import { buildRecurringBlockerDetectionView } from "../src/recurring-blocker-detection.mjs";
import { buildAgentToolRecommendationMemoryView } from "../src/agent-tool-recommendation-memory.mjs";
import { buildAgentRunPlan } from "../src/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/intake-evidence-plan.mjs";
import { buildIntakeAcceptanceMap } from "../src/intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "../src/intake-stage-plan.mjs";
import { buildDecisionOutcomeLinkPreview } from "../src/intake-decision-outcome-link.mjs";
import { buildEvolutionActionPackPreview } from "../src/intake-evolution-action-preview.mjs";

const FORBIDDEN = ["proven template", "best-performing template", "statistically validated", "trained effectiveness model", "guaranteed improvement"];

function pipeline(type, rawInput) {
  const acceptanceMap = buildIntakeAcceptanceMap({ type, rawInput });
  const stagePlan = buildIntakeStagePlan({ type, rawInput });
  const agentRunPlan = buildAgentRunPlan({ type, rawInput });
  const evidencePlan = buildIntakeEvidencePlan({ type, rawInput });
  const acceptanceGraphView = buildAcceptanceGraphDerivedView({ title: "g", sourceSummary: "s", acceptanceMap, stagePlan, agentRunPlan, evidencePlan });
  const recurringBlockerDetectionView = buildRecurringBlockerDetectionView({ title: "b", sourceSummary: "s", acceptanceGraphView, acceptanceMap, stagePlan, agentRunPlan, evidencePlan });
  const agentToolMemoryView = buildAgentToolRecommendationMemoryView({ title: "m", sourceSummary: "s", agentRunPlan, evidencePlan, recurringBlockerDetectionView });
  const decisionOutcomePreview = buildDecisionOutcomeLinkPreview({ title: "d", sourceSummary: "s", acceptanceMap, stagePlan, agentRunPlan, evidencePlan });
  const evolutionActionPreview = buildEvolutionActionPackPreview({ title: "a", sourceSummary: "s", acceptanceMap, stagePlan, agentRunPlan, evidencePlan });
  return {
    title: `${type} wf`, sourceSummary: "s",
    acceptanceGraphView, recurringBlockerDetectionView, agentToolMemoryView,
    evidencePlan, stagePlan, decisionOutcomePreview, evolutionActionPreview,
  };
}

function assertView(v) {
  assert.ok(v.title.length > 0);
  assert.ok(v.summary.length > 0);
  assert.ok(["low", "medium", "high"].includes(v.confidence));
  assert.ok(v.signals.length <= 8);
  const ids = new Set();
  for (const s of v.signals) {
    assert.ok(s.id && !ids.has(s.id));
    ids.add(s.id);
    assert.ok(SIGNAL_TYPES.includes(s.type), `bad type ${s.type}`);
    assert.ok(QUALITIES.includes(s.quality), `bad quality ${s.quality}`);
    assert.ok(s.title.length > 0 && s.summary.length > 0);
    assert.ok(typeof s.sourcePattern === "string");
    assert.ok(Array.isArray(s.supportingSignals));
    assert.ok(Array.isArray(s.blockerTypes));
    assert.ok(Array.isArray(s.relatedAcceptanceAreas));
    assert.ok(Array.isArray(s.relatedEvidenceTypes));
    assert.ok(Array.isArray(s.relatedStageNumbers));
    assert.ok(s.suggestedTemplateImprovement.length > 0);
  }
  for (const q of QUALITIES) assert.ok(Number.isInteger(v.qualityCounts[q]));
  assert.equal(
    QUALITIES.reduce((sum, q) => sum + v.qualityCounts[q], 0),
    v.signals.length,
  );
  assert.ok(Array.isArray(v.topNeedsRefinement) && v.topNeedsRefinement.length <= 5);
  assert.ok(v.notIncludedYet.length >= 4);
  const blob = JSON.stringify({ ...v, notIncludedYet: [] }).toLowerCase();
  for (const w of FORBIDDEN) assert.ok(!blob.includes(w), `must not contain "${w}"`);
}

test("builds a template-effectiveness view for every intake type", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    assertView(buildTemplateEffectivenessSignalsView(pipeline(type, "some pasted input")));
  }
});

test("derives the core signal types from a full pipeline", () => {
  const v = buildTemplateEffectivenessSignalsView(pipeline("github_repo", "acme/web-app"));
  const types = new Set(v.signals.map((s) => s.type));
  assert.ok(types.has("acceptance_area_pattern"));
  assert.ok(types.has("evidence_pattern"));
  assert.ok(types.has("stage_pattern"));
});

test("acceptance area with blocker → needs_refinement", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "AR", sourceSummary: "s",
    acceptanceGraphView: { signalSummary: { topAcceptanceAreas: [{ area: "error_recovery", count: 3 }], topEvidenceTypes: [], agentTaskCount: 0 } },
    recurringBlockerDetectionView: { blockers: [{ type: "fix_rerun_cluster", relatedAcceptanceAreas: ["error_recovery"], relatedEvidenceTypes: [], relatedStageNumbers: [] }] },
    evidencePlan: { expectations: [{ relatedArea: "error_recovery", evidenceTypes: ["fix_summary"] }] },
  });
  const sig = v.signals.find((s) => s.type === "acceptance_area_pattern");
  assert.equal(sig.quality, "needs_refinement");
  assert.ok(sig.blockerTypes.includes("fix_rerun_cluster"));
});

test("acceptance area without evidence relation → under_specified", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "AR2", sourceSummary: "s",
    acceptanceGraphView: { signalSummary: { topAcceptanceAreas: [{ area: "onboarding", count: 2 }], topEvidenceTypes: [] } },
    recurringBlockerDetectionView: { blockers: [] },
    evidencePlan: { expectations: [] },
  });
  const sig = v.signals.find((s) => s.type === "acceptance_area_pattern");
  assert.equal(sig.quality, "under_specified");
});

test("evidence pattern strong when tool memory has strong fit", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "EV", sourceSummary: "s",
    acceptanceGraphView: { signalSummary: { topAcceptanceAreas: [], topEvidenceTypes: [{ evidenceType: "screenshot", count: 3 }] } },
    recurringBlockerDetectionView: { blockers: [] },
    agentToolMemoryView: { items: [{ role: "verifier", recommendedTool: "browser_check", toolFit: "strong", expectedEvidenceTypes: ["screenshot"], stageNumbers: [], blockerTypes: [] }] },
    evidencePlan: { expectations: [{ relatedArea: "primary_user_flow", evidenceTypes: ["screenshot"] }] },
  });
  const sig = v.signals.find((s) => s.type === "evidence_pattern");
  assert.equal(sig.quality, "strong_alignment");
});

test("tool pattern needs_refinement when item has blocker types", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "TP", sourceSummary: "s",
    agentToolMemoryView: { items: [{ role: "fixer", recommendedTool: "claude_code", toolFit: "strong", expectedEvidenceTypes: ["commit_link"], stageNumbers: [3], blockerTypes: ["fix_rerun_cluster"] }] },
  });
  const sig = v.signals.find((s) => s.type === "tool_pattern");
  assert.equal(sig.quality, "needs_refinement");
});

test("stage pattern strong when tasks + evidence exist", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "ST", sourceSummary: "s",
    acceptanceGraphView: { signalSummary: { agentTaskCount: 3, topAcceptanceAreas: [], topEvidenceTypes: [] } },
    recurringBlockerDetectionView: { blockers: [] },
    stagePlan: { stages: [{ number: 1 }, { number: 2 }] },
    evidencePlan: { expectations: [{ relatedArea: "primary_user_flow", evidenceTypes: ["review_note"], relatedStageNumbers: [1] }] },
  });
  const sig = v.signals.find((s) => s.type === "stage_pattern");
  assert.equal(sig.quality, "strong_alignment");
});

test("decision pattern conservative (fix recommended → needs_refinement)", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "DE", sourceSummary: "s",
    decisionOutcomePreview: { recommendedDecisionCandidate: "fix", decisionCandidates: [{ type: "fix" }, { type: "accept" }] },
  });
  const sig = v.signals.find((s) => s.type === "decision_pattern");
  assert.equal(sig.quality, "needs_refinement");
});

test("action pattern needs_refinement when unresolved action types present", () => {
  const v = buildTemplateEffectivenessSignalsView({
    title: "AC", sourceSummary: "s",
    evolutionActionPreview: { actions: [{ type: "collect_evidence", relatedAcceptanceItems: ["A"], relatedStageNumbers: [1] }] },
  });
  const sig = v.signals.find((s) => s.type === "action_pattern");
  assert.equal(sig.quality, "needs_refinement");
});

test("quality counts cover all qualities and topNeedsRefinement listed", () => {
  const v = buildTemplateEffectivenessSignalsView(pipeline("github_repo", "acme/billing-api"));
  for (const q of QUALITIES) assert.ok(q in v.qualityCounts);
  // every topNeedsRefinement title belongs to a needs_refinement/under_specified signal
  const refineTitles = new Set(
    v.signals.filter((s) => ["needs_refinement", "under_specified"].includes(s.quality)).map((s) => s.title),
  );
  for (const t of v.topNeedsRefinement) assert.ok(refineTitles.has(t));
});

test("no signals for empty input; low confidence", () => {
  const v = buildTemplateEffectivenessSignalsView({ title: "E", sourceSummary: "" });
  assert.equal(v.signals.length, 0);
  assert.equal(v.confidence, "low");
  assert.equal(v.topNeedsRefinement.length, 0);
  assertView(v);
});

test("includes notIncludedYet disclaimers (derived-only / not validated)", () => {
  const v = buildTemplateEffectivenessSignalsView(pipeline("prd", "Overview: x. User can submit."));
  const joined = v.notIncludedYet.join(" ").toLowerCase();
  assert.match(joined, /derived from this saved workflow only/);
  assert.match(joined, /no template is statistically validated yet/);
});

test("caps signals at 8 (max distinct types is 6, so always <= 6)", () => {
  const v = buildTemplateEffectivenessSignalsView(pipeline("ai_built_app", "AI app with login and sharing"));
  assert.ok(v.signals.length <= 8);
});

test("handles malformed snapshots without throwing", () => {
  const bad = [null, undefined, 7, "x", { signalSummary: "no" }, { items: [null, 1, {}] }];
  for (const m of bad) {
    assert.doesNotThrow(() =>
      buildTemplateEffectivenessSignalsView({
        title: "M", sourceSummary: "",
        acceptanceGraphView: m, recurringBlockerDetectionView: m, agentToolMemoryView: m,
        evidencePlan: m, stagePlan: m, decisionOutcomePreview: m, evolutionActionPreview: m,
      }),
    );
  }
});

test("deterministic output for identical input", () => {
  const a = buildTemplateEffectivenessSignalsView(pipeline("github_repo", "acme/web-app"));
  const b = buildTemplateEffectivenessSignalsView(pipeline("github_repo", "acme/web-app"));
  assert.deepEqual(a, b);
});

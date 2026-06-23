// Stage 114 — deterministic Decision / Outcome Link Preview.
//
// Shows how a SAVED agent workflow record (Stage 112/112B snapshots) + its
// Benchmark Handoff Preview (Stage 113) would eventually connect to a decision
// (accept / fix / rerun / defer / not_verified) and to the outcome concepts from
// Stages 74~76 (outcome decision, outcome quality scorecard, action pack).
//
// This is a PLANNING/PREVIEW layer only. It does NOT save a decision, interpret
// a benchmark result, create an outcome scorecard, generate an action pack, call
// any model/GitHub, or persist anything. Pure + deterministic; snapshot inputs
// are `unknown`, so every accessor is defensive (malformed → conservative
// fallback, never throws). Because no real evidence is collected, the preview is
// deliberately conservative — it defaults to `not_verified`.
import { EVIDENCE_TYPE_LABELS } from "./intake-evidence-plan.mjs";

const DECISION_TYPES = ["accept", "fix", "rerun", "defer", "not_verified"];
const LEVELS = ["low", "medium", "high"];
const CONFIDENCE = ["low", "medium", "high"];

const MAX_ITEMS = 6;
const MAX_EVIDENCE = 6;
const MAX_QUESTIONS = 4;

function asArray(x) {
  return Array.isArray(x) ? x : [];
}
function asObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}
function str(x) {
  return typeof x === "string" ? x : "";
}
function strArr(x) {
  return asArray(x).filter((s) => typeof s === "string" && s.length > 0);
}
function numArr(x) {
  return asArray(x).filter((n) => typeof n === "number" && Number.isFinite(n));
}
function unique(arr) {
  return [...new Set(arr)];
}
function evidenceLabel(type) {
  return EVIDENCE_TYPE_LABELS[type] ?? str(type).replace(/_/g, " ");
}

const DECISION_LABELS = {
  accept: "Accept",
  fix: "Fix",
  rerun: "Rerun",
  defer: "Defer",
  not_verified: "Not verified",
};

const DECISION_RATIONALE = {
  accept: "Use only when required evidence is attached and acceptance items are satisfied.",
  fix: "Use when the workflow identifies issues that can be addressed without restarting the stage.",
  rerun: "Use when a builder/fixer output needs another attempt against the same acceptance items.",
  defer: "Use when the item is valid but should be delayed until more scope or evidence is available.",
  not_verified: "Use when there is not enough evidence to make an acceptance decision.",
};

/** Normalise an Evidence Plan expectation into the fields we need. */
function normalizeExpectation(raw) {
  const e = asObj(raw);
  return {
    acceptanceItemTitle: str(e.acceptanceItemTitle).trim(),
    relatedArea: str(e.relatedArea),
    relatedStageNumbers: numArr(e.relatedStageNumbers),
    evidenceTypes: strArr(e.evidenceTypes),
    status: str(e.status),
    decisionImpact: str(e.decisionImpact),
  };
}

/**
 * @param {{
 *   workflowRecordId?: string,
 *   title: string,
 *   sourceSummary: string,
 *   acceptanceMap?: unknown,
 *   stagePlan?: unknown,
 *   agentRunPlan?: unknown,
 *   evidencePlan?: unknown,
 *   benchmarkHandoffPreview?: unknown,
 * }} input
 * @returns {import("./intake-decision-outcome-link.d.mts").OutcomeLinkPreview}
 */
export function buildDecisionOutcomeLinkPreview(input) {
  const title = str(input?.title).trim() || "Saved workflow";

  const expectations = asArray(asObj(input?.evidencePlan).expectations).map(normalizeExpectation);
  const haveExpectations = expectations.some((e) => e.acceptanceItemTitle.length > 0);
  const missingQuestions = strArr(asObj(input?.evidencePlan).missingEvidenceQuestions);

  const acceptanceItems = unique(
    [
      ...asArray(asObj(input?.acceptanceMap).items)
        .map((it) => str(asObj(it).title).trim())
        .filter(Boolean),
      ...expectations.map((e) => e.acceptanceItemTitle).filter(Boolean),
    ].filter(Boolean),
  );

  const stages = asArray(asObj(input?.stagePlan).stages);
  const allStageNumbers = unique(
    stages.map((s) => asObj(s).number).filter((n) => typeof n === "number"),
  ).sort((a, b) => a - b);

  // Expectations grouped by decision impact.
  const byImpact = (impact) => expectations.filter((e) => e.decisionImpact === impact);
  const fix = byImpact("fix");
  const rerun = byImpact("rerun");
  const defer = byImpact("defer");
  const notVerified = expectations.filter(
    (e) => e.decisionImpact === "not_verified" || e.status === "not_verified" || e.status === "needs_decision",
  );

  // Distinct evidence type labels overall + per area.
  const evidenceTypesIn = (items) =>
    unique(items.flatMap((e) => e.evidenceTypes).map(evidenceLabel)).slice(0, MAX_EVIDENCE);
  const acceptEvidenceSource = expectations.filter(
    (e) => e.relatedArea === "primary_user_flow" || e.relatedArea === "release_readiness",
  );

  const titlesOf = (items) =>
    unique(items.map((e) => e.acceptanceItemTitle).filter(Boolean)).slice(0, MAX_ITEMS);
  const stagesOf = (items) =>
    unique(items.flatMap((e) => e.relatedStageNumbers)).sort((a, b) => a - b);

  const decisionCandidates = [
    {
      type: "accept",
      requiredEvidence:
        evidenceTypesIn(acceptEvidenceSource).length > 0
          ? evidenceTypesIn(acceptEvidenceSource)
          : ["Evidence for the primary flow", "Evidence for release readiness"],
      blockingQuestions: missingQuestions.slice(0, MAX_QUESTIONS),
      relatedAcceptanceItems: acceptanceItems.slice(0, MAX_ITEMS),
      relatedStageNumbers: allStageNumbers,
    },
    {
      type: "fix",
      requiredEvidence:
        evidenceTypesIn(fix).length > 0 ? evidenceTypesIn(fix) : ["Fix summary", "Commit link"],
      blockingQuestions: fix.length
        ? ["Which acceptance item needs a fix, and is the change scoped to one stage?"]
        : [],
      relatedAcceptanceItems: titlesOf(fix),
      relatedStageNumbers: stagesOf(fix),
    },
    {
      type: "rerun",
      requiredEvidence:
        evidenceTypesIn(rerun).length > 0 ? evidenceTypesIn(rerun) : ["Test result", "Build result"],
      blockingQuestions: rerun.length
        ? ["What changed for the next attempt against the same acceptance items?"]
        : [],
      relatedAcceptanceItems: titlesOf(rerun),
      relatedStageNumbers: stagesOf(rerun),
    },
    {
      type: "defer",
      requiredEvidence:
        evidenceTypesIn(defer).length > 0 ? evidenceTypesIn(defer) : ["Release decision note"],
      blockingQuestions: defer.length
        ? ["What scope or evidence must arrive before this item is revisited?"]
        : [],
      relatedAcceptanceItems: titlesOf(defer),
      relatedStageNumbers: stagesOf(defer),
    },
    {
      type: "not_verified",
      requiredEvidence: ["Review note", "Clarification note"],
      blockingQuestions: missingQuestions.slice(0, MAX_QUESTIONS),
      relatedAcceptanceItems: notVerified.length
        ? titlesOf(notVerified)
        : acceptanceItems.slice(0, MAX_ITEMS),
      relatedStageNumbers: notVerified.length ? stagesOf(notVerified) : allStageNumbers,
    },
  ].map((c) => ({
    type: c.type,
    label: DECISION_LABELS[c.type],
    rationale: DECISION_RATIONALE[c.type],
    requiredEvidence: c.requiredEvidence,
    blockingQuestions: c.blockingQuestions,
    relatedAcceptanceItems: c.relatedAcceptanceItems,
    relatedStageNumbers: c.relatedStageNumbers,
  }));

  // Recommended candidate — conservative. No actual evidence is collected, so the
  // honest default is not_verified; only a strong fix/defer signal overrides it.
  let recommendedDecisionCandidate = "not_verified";
  if (fix.length >= 2) recommendedDecisionCandidate = "fix";
  else if (defer.length >= 2) recommendedDecisionCandidate = "defer";

  // ── Scorecard signals (signals for FUTURE linkage, not actual results) ──
  const distinctEvidence = unique(expectations.flatMap((e) => e.evidenceTypes)).length;
  const evidenceCompleteness =
    distinctEvidence >= 6 ? "high" : distinctEvidence >= 3 ? "medium" : "low";

  const coverageCount = acceptanceItems.length;
  const acceptanceCoverage = coverageCount >= 6 ? "high" : coverageCount >= 3 ? "medium" : "low";

  const riskScore = missingQuestions.length + fix.length + rerun.length;
  const unresolvedRisk = riskScore >= 5 ? "high" : riskScore >= 2 ? "medium" : "low";

  const hasReleaseGate =
    strArr(asObj(asObj(input?.stagePlan).releaseGate).checks).length > 0 ||
    stages.some((s) => str(asObj(s).kind) === "release");
  const hasReleaseEvidence = expectations.some((e) => e.relatedArea === "release_readiness");
  // Never "high" — release readiness cannot be confirmed without collected evidence.
  const releaseReadiness = hasReleaseGate && hasReleaseEvidence ? "medium" : "low";

  const confidence =
    haveExpectations && acceptanceItems.length > 0
      ? CONFIDENCE.includes(asObj(input?.acceptanceMap).confidence)
        ? asObj(input?.acceptanceMap).confidence
        : "medium"
      : "low";

  return {
    workflowRecordId: str(input?.workflowRecordId) || undefined,
    title,
    summary:
      "Simsa does not just compare outputs — it prepares the decision criteria needed to accept, fix, rerun, defer, or keep work not verified.",
    recommendedDecisionCandidate,
    decisionCandidates,
    outcomeScorecardSignals: {
      evidenceCompleteness,
      acceptanceCoverage,
      unresolvedRisk,
      releaseReadiness,
    },
    futureOutcomeLinks: [
      "Link the chosen decision candidate to a recorded outcome decision.",
      "Link evidence completeness to an outcome quality scorecard.",
      "Link a fix/rerun recommendation to an evolution action pack.",
      "Link unresolved risk to follow-up tracking.",
    ],
    notIncludedYet: [
      "No final decision is saved in this preview.",
      "No benchmark result is interpreted yet.",
      "No outcome scorecard is created yet.",
      "No action pack is generated yet.",
    ],
    confidence,
  };
}

export { DECISION_TYPES, LEVELS };

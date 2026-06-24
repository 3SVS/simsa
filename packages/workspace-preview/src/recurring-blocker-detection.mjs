// Stage 127 — deterministic Recurring Blocker Detection.
//
// Derives "recurring blocker signals" from a SAVED workflow's snapshots (+ the
// Stage 126 derived graph view + decision/outcome + evolution-action previews).
// First moat signal: surfaces repeated acceptance blockers / evidence gaps from
// workflow STRUCTURE. Pure + deterministic; derived-only — NO cross-project
// model/training, NO graph database, NO persistence, NO new migration. Snapshot
// inputs are `unknown`, so every accessor is defensive (malformed → conservative
// fallback, never throws). Blockers are NOT fabricated when signal is weak.
import { buildAcceptanceGraphDerivedView } from "./acceptance-graph-derived.mjs";

const MAX_BLOCKERS = 6;
const MAX_LIST = 6;
const CONFIDENCE = ["low", "medium", "high"];

const BLOCKER_TYPES = [
  "missing_evidence",
  "not_verified_cluster",
  "release_readiness_gap",
  "fix_rerun_cluster",
  "unclear_acceptance_scope",
  "tooling_gap",
];

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

const NEXT_ACTION = {
  missing_evidence: "Collect the repeated evidence type before making an accept/fix/rerun decision.",
  not_verified_cluster: "Resolve the not-verified items by attaching evidence or marking them as deferred.",
  release_readiness_gap: "Do not treat this workflow as release-ready until release evidence is collected.",
  fix_rerun_cluster: "Create focused fix instructions or rerun the agent against the affected acceptance items.",
  unclear_acceptance_scope: "Clarify the acceptance scope before asking agents to continue implementation.",
  tooling_gap: "Align the recommended tool with the evidence type expected for the task.",
};

const TITLE = {
  missing_evidence: "Repeated missing evidence",
  not_verified_cluster: "Cluster of not-verified items",
  release_readiness_gap: "Release readiness gap",
  fix_rerun_cluster: "Fix / rerun cluster",
  unclear_acceptance_scope: "Unclear acceptance scope",
  tooling_gap: "Tooling / evidence gap",
};

/**
 * @param {{
 *   workflowRecordId?: string, title: string, sourceSummary: string,
 *   acceptanceGraphView?: unknown, acceptanceMap?: unknown, stagePlan?: unknown,
 *   agentRunPlan?: unknown, evidencePlan?: unknown,
 *   decisionOutcomePreview?: unknown, evolutionActionPreview?: unknown,
 * }} input
 * @returns {import("./recurring-blocker-detection.d.mts").RecurringBlockerDetectionView}
 */
export function buildRecurringBlockerDetectionView(input) {
  const title = str(input?.title).trim() || "Saved workflow";

  // Reuse the Stage 126 derived graph view (build it if not supplied).
  const graph =
    asObj(input?.acceptanceGraphView).signalSummary !== undefined
      ? asObj(input?.acceptanceGraphView)
      : buildAcceptanceGraphDerivedView({
          workflowRecordId: str(input?.workflowRecordId),
          title,
          sourceSummary: str(input?.sourceSummary),
          acceptanceMap: input?.acceptanceMap,
          stagePlan: input?.stagePlan,
          agentRunPlan: input?.agentRunPlan,
          evidencePlan: input?.evidencePlan,
          decisionOutcomePreview: input?.decisionOutcomePreview,
          evolutionActionPreview: input?.evolutionActionPreview,
        });
  const signal = asObj(graph.signalSummary);

  // Source snapshots (defensive).
  const items = asArray(asObj(input?.acceptanceMap).items).map(asObj);
  const stages = asArray(asObj(input?.stagePlan).stages).map(asObj);
  const tasks = asArray(asObj(input?.agentRunPlan).tasks).map(asObj);
  const expectations = asArray(asObj(input?.evidencePlan).expectations).map(asObj);
  const missingQuestions = strArr(asObj(input?.evidencePlan).missingEvidenceQuestions);
  const actions = asArray(asObj(input?.evolutionActionPreview).actions).map(asObj);
  const decisions = asArray(asObj(input?.decisionOutcomePreview).decisionCandidates).map(asObj);

  const notVerifiedCount = Number(signal.notVerifiedCount) || 0;
  const evidenceCount = Number(signal.evidenceExpectationCount) || expectations.length;

  // Evidence-type frequency (for repeated missing evidence).
  const evidenceFreq = {};
  for (const e of expectations) {
    for (const t of strArr(e.evidenceTypes)) evidenceFreq[t] = (evidenceFreq[t] ?? 0) + 1;
  }
  const repeatedEvidenceTypes = Object.entries(evidenceFreq)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([t]) => t);

  const stagesOf = (preds) =>
    unique(expectations.filter(preds).flatMap((e) => numArr(e.relatedStageNumbers))).sort(
      (a, b) => a - b,
    );
  const areasOf = (preds) =>
    unique(expectations.filter(preds).map((e) => str(e.relatedArea)).filter(Boolean)).slice(0, MAX_LIST);

  /** @type {Array<Omit<import("./recurring-blocker-detection.d.mts").RecurringBlockerSignal,"id">>} */
  const blockers = [];

  // 1. missing_evidence — same evidence type repeated, or high evidence + not_verified.
  if (repeatedEvidenceTypes.length > 0 || (evidenceCount >= 4 && notVerifiedCount > 0)) {
    blockers.push({
      type: "missing_evidence",
      severity: "medium",
      title: TITLE.missing_evidence,
      summary:
        repeatedEvidenceTypes.length > 0
          ? `The same evidence type(s) recur across acceptance items: ${repeatedEvidenceTypes
              .slice(0, 3)
              .map((t) => t.replace(/_/g, " "))
              .join(", ")}.`
          : "Several acceptance items still require evidence before a decision can be made.",
      sourceSignals: [
        repeatedEvidenceTypes.length > 0
          ? `${repeatedEvidenceTypes.length} repeated evidence type(s)`
          : `${evidenceCount} evidence expectations`,
      ],
      relatedAcceptanceAreas: areasOf(() => true),
      relatedEvidenceTypes: repeatedEvidenceTypes.slice(0, MAX_LIST),
      relatedStageNumbers: stagesOf(() => true),
      relatedTaskIds: [],
      suggestedNextAction: NEXT_ACTION.missing_evidence,
    });
  }

  // 2. not_verified_cluster — notVerifiedCount >= 2.
  if (notVerifiedCount >= 2) {
    const severity = notVerifiedCount >= 4 ? "high" : "medium";
    blockers.push({
      type: "not_verified_cluster",
      severity,
      title: TITLE.not_verified_cluster,
      summary: `${notVerifiedCount} acceptance items remain not verified.`,
      sourceSignals: [`${notVerifiedCount} not_verified items`],
      relatedAcceptanceAreas: areasOf((e) => str(e.status) === "not_verified"),
      relatedEvidenceTypes: [],
      relatedStageNumbers: stagesOf((e) => str(e.status) === "not_verified"),
      relatedTaskIds: [],
      suggestedNextAction: NEXT_ACTION.not_verified_cluster,
    });
  }

  // 3. release_readiness_gap — release area + release stage + unresolved evidence.
  const hasReleaseStage = stages.some((s) => str(s.kind) === "release");
  const releaseEvidence = expectations.filter((e) => str(e.relatedArea) === "release_readiness");
  const releaseUnresolved = releaseEvidence.some(
    (e) => str(e.status) === "not_verified" || str(e.status) === "needed" || str(e.status) === "needs_decision",
  );
  if ((hasReleaseStage || releaseEvidence.length > 0) && releaseUnresolved) {
    blockers.push({
      type: "release_readiness_gap",
      severity: "high",
      title: TITLE.release_readiness_gap,
      summary: "Release readiness appears, but its evidence is not yet collected.",
      sourceSignals: [
        hasReleaseStage ? "release stage present" : "release-readiness evidence present",
        "release evidence unresolved",
      ],
      relatedAcceptanceAreas: ["release_readiness"],
      relatedEvidenceTypes: unique(releaseEvidence.flatMap((e) => strArr(e.evidenceTypes))).slice(0, MAX_LIST),
      relatedStageNumbers: unique(
        stages.filter((s) => str(s.kind) === "release").map((s) => (typeof s.number === "number" ? s.number : null)),
      ).filter((n) => n !== null),
      relatedTaskIds: [],
      suggestedNextAction: NEXT_ACTION.release_readiness_gap,
    });
  }

  // 4. fix_rerun_cluster — multiple fix/rerun signals across decisions/actions/evidence.
  const fixRerunActions = actions.filter((a) =>
    ["create_fix_instructions", "rerun_agent"].includes(str(a.type)),
  );
  const fixRerunImpacts = expectations.filter((e) =>
    ["fix", "rerun"].includes(str(e.decisionImpact)),
  );
  const fixRerunSignalCount = fixRerunActions.length + fixRerunImpacts.length;
  if (fixRerunSignalCount >= 2) {
    blockers.push({
      type: "fix_rerun_cluster",
      severity: fixRerunSignalCount >= 3 ? "high" : "medium",
      title: TITLE.fix_rerun_cluster,
      summary: "Multiple items point to a fix or rerun before they can be accepted.",
      sourceSignals: [`${fixRerunSignalCount} fix/rerun signal(s)`],
      relatedAcceptanceAreas: areasOf((e) => ["fix", "rerun"].includes(str(e.decisionImpact))),
      relatedEvidenceTypes: [],
      relatedStageNumbers: stagesOf((e) => ["fix", "rerun"].includes(str(e.decisionImpact))),
      relatedTaskIds: unique(
        fixRerunActions.flatMap((a) => strArr(a.relatedTaskIds)),
      ).slice(0, MAX_LIST),
      suggestedNextAction: NEXT_ACTION.fix_rerun_cluster,
    });
  }

  // 5. unclear_acceptance_scope — missing questions / missing_detail items / clarify actions.
  const missingDetailItems = items.filter((it) => str(it.status) === "missing_detail");
  const clarifyActions = actions.filter((a) => str(a.type) === "clarify");
  if (missingQuestions.length > 0 || missingDetailItems.length > 0 || clarifyActions.length > 0) {
    blockers.push({
      type: "unclear_acceptance_scope",
      severity: "medium",
      title: TITLE.unclear_acceptance_scope,
      summary: "Unresolved questions or under-specified acceptance items make scope unclear.",
      sourceSignals: [
        missingDetailItems.length > 0 ? `${missingDetailItems.length} item(s) need detail` : null,
        missingQuestions.length > 0 ? `${missingQuestions.length} open question(s)` : null,
        clarifyActions.length > 0 ? `${clarifyActions.length} clarify action(s)` : null,
      ].filter(Boolean),
      relatedAcceptanceAreas: unique(missingDetailItems.map((it) => str(it.area)).filter(Boolean)).slice(0, MAX_LIST),
      relatedEvidenceTypes: [],
      relatedStageNumbers: [],
      relatedTaskIds: [],
      suggestedNextAction: NEXT_ACTION.unclear_acceptance_scope,
    });
  }

  // 6. tooling_gap (conservative) — a tool is recommended but its evidence is not
  // expected anywhere AND there are unresolved items. Only the clearest mismatch.
  const recommendedTools = unique(tasks.map((t) => str(t.recommendedTool)).filter(Boolean));
  const allEvidenceTypes = new Set(Object.keys(evidenceFreq));
  const TOOL_EVIDENCE = {
    browser_check: ["screenshot", "walkthrough"],
    test_run: ["test_result", "build_result"],
    github_pr_review: ["pr_link", "review_note"],
  };
  const toolGaps = recommendedTools.filter((tool) => {
    const expected = TOOL_EVIDENCE[tool];
    return expected && !expected.some((ev) => allEvidenceTypes.has(ev));
  });
  if (toolGaps.length > 0 && notVerifiedCount > 0) {
    blockers.push({
      type: "tooling_gap",
      severity: "low",
      title: TITLE.tooling_gap,
      summary: `Recommended tool(s) (${toolGaps
        .map((t) => t.replace(/_/g, " "))
        .join(", ")}) lack matching expected evidence types.`,
      sourceSignals: [`${toolGaps.length} tool/evidence mismatch(es)`],
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: [],
      relatedStageNumbers: [],
      relatedTaskIds: unique(
        tasks
          .filter((t) => toolGaps.includes(str(t.recommendedTool)))
          .map((t, i) => str(t.id) || `task-${i + 1}`),
      ).slice(0, MAX_LIST),
      suggestedNextAction: NEXT_ACTION.tooling_gap,
    });
  }

  const capped = blockers.slice(0, MAX_BLOCKERS).map((b, i) => ({ id: `blk-${i + 1}`, ...b }));

  const blockerCountByType = Object.fromEntries(BLOCKER_TYPES.map((t) => [t, 0]));
  for (const b of capped) blockerCountByType[b.type] += 1;

  // Top blocker type = highest severity first, then count, then type order.
  const sevRank = { high: 0, medium: 1, low: 2 };
  let topBlockerType;
  if (capped.length > 0) {
    topBlockerType = [...capped].sort(
      (a, b) =>
        sevRank[a.severity] - sevRank[b.severity] ||
        BLOCKER_TYPES.indexOf(a.type) - BLOCKER_TYPES.indexOf(b.type),
    )[0].type;
  }

  const confidence =
    capped.length === 0
      ? "low"
      : capped.some((b) => b.severity === "high")
        ? CONFIDENCE.includes(asObj(input?.acceptanceMap).confidence)
          ? asObj(input?.acceptanceMap).confidence
          : "medium"
        : "low";

  return {
    workflowRecordId: str(input?.workflowRecordId) || undefined,
    title,
    summary:
      "Simsa surfaces repeated acceptance blocker and evidence-gap patterns derived from this saved workflow that may deserve attention before review, release, or rerun.",
    blockers: capped,
    topBlockerType,
    blockerCountByType,
    notIncludedYet: [
      "Blocker signals are derived from this saved workflow only.",
      "No cross-project model or training is used yet.",
      "No blocker is treated as verified without evidence.",
      "No issue is automatically fixed or rerun.",
    ],
    confidence,
  };
}

export { BLOCKER_TYPES };

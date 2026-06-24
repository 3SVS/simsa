// Stage 129 — deterministic Template Effectiveness Signals (per-workflow).
//
// Derives per-workflow "template signals" from the Stage 126 graph view + Stage
// 127 blocker view + Stage 128 agent/tool memory + evidence/stage snapshots. This
// is NOT a trained model and NOT cross-project effectiveness — a derived,
// single-workflow preview only. Pure + deterministic; snapshot inputs are
// `unknown`, so every accessor is defensive (malformed → conservative fallback,
// never throws). Signals are NOT fabricated when source data is insufficient.

const MAX_SIGNALS = 8;
const MAX_LIST = 6;
const CONFIDENCE = ["low", "medium", "high"];

const SIGNAL_TYPES = [
  "acceptance_area_pattern",
  "evidence_pattern",
  "stage_pattern",
  "tool_pattern",
  "decision_pattern",
  "action_pattern",
];
const QUALITIES = [
  "strong_alignment",
  "partial_alignment",
  "needs_refinement",
  "under_specified",
  "unknown",
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

const IMPROVEMENT = {
  acceptance_area_pattern: "Add clearer acceptance criteria for this area and specify required evidence up front.",
  evidence_pattern: "Strengthen this template by pairing each evidence type with a matching review or verification task.",
  stage_pattern: "Ensure each stage has a role, expected evidence, and exit criteria.",
  tool_pattern: "Use this tool pattern only when its expected evidence matches the acceptance item.",
  decision_pattern: "Keep decision templates conservative until evidence is attached.",
  action_pattern: "Convert recurring unresolved items into focused next-action templates.",
};

/**
 * @param {{
 *   workflowRecordId?: string, title: string, sourceSummary: string,
 *   acceptanceGraphView?: unknown, recurringBlockerDetectionView?: unknown,
 *   agentToolMemoryView?: unknown, evidencePlan?: unknown, stagePlan?: unknown,
 *   decisionOutcomePreview?: unknown, evolutionActionPreview?: unknown,
 * }} input
 * @returns {import("./template-effectiveness-signals.d.mts").TemplateEffectivenessSignalsView}
 */
export function buildTemplateEffectivenessSignalsView(input) {
  const title = str(input?.title).trim() || "Saved workflow";

  const graphSignal = asObj(asObj(input?.acceptanceGraphView).signalSummary);
  const topAreas = asArray(graphSignal.topAcceptanceAreas)
    .map(asObj)
    .map((a) => ({ area: str(a.area), count: Number(a.count) || 0 }))
    .filter((a) => a.area);
  const topEvidence = asArray(graphSignal.topEvidenceTypes)
    .map(asObj)
    .map((e) => ({ evidenceType: str(e.evidenceType), count: Number(e.count) || 0 }))
    .filter((e) => e.evidenceType);

  const blockers = asArray(asObj(input?.recurringBlockerDetectionView).blockers).map(asObj);
  const blockerAreas = new Set(blockers.flatMap((b) => strArr(b.relatedAcceptanceAreas)));
  const blockerEvidence = new Set(blockers.flatMap((b) => strArr(b.relatedEvidenceTypes)));
  const blockerStages = new Set(blockers.flatMap((b) => numArr(b.relatedStageNumbers)));
  const blockerTypesAll = unique(blockers.map((b) => str(b.type)).filter(Boolean));
  const hasMissingEvidenceBlocker = blockers.some((b) =>
    ["missing_evidence", "not_verified_cluster"].includes(str(b.type)),
  );

  const memoryItems = asArray(asObj(input?.agentToolMemoryView).items).map(asObj);
  const expectations = asArray(asObj(input?.evidencePlan).expectations).map(asObj);
  const evidenceAreas = new Set(expectations.map((e) => str(e.relatedArea)).filter(Boolean));
  const evidenceTypesPresent = new Set(expectations.flatMap((e) => strArr(e.evidenceTypes)));
  const stages = asArray(asObj(input?.stagePlan).stages).map(asObj);
  const decisions = asArray(asObj(input?.decisionOutcomePreview).decisionCandidates).map(asObj);
  const recommendedDecision = str(asObj(input?.decisionOutcomePreview).recommendedDecisionCandidate);
  const actions = asArray(asObj(input?.evolutionActionPreview).actions).map(asObj);

  const signals = [];
  let seq = 0;
  const add = (type, quality, sig) => {
    if (signals.length >= MAX_SIGNALS) return;
    seq += 1;
    signals.push({
      id: `tpl-${seq}`,
      type,
      quality,
      suggestedTemplateImprovement: IMPROVEMENT[type],
      blockerTypes: [],
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: [],
      relatedStageNumbers: [],
      supportingSignals: [],
      ...sig,
    });
  };

  // 1. acceptance_area_pattern — top areas (one signal for the leading area).
  if (topAreas.length > 0) {
    const lead = topAreas[0];
    const hasEvidence = evidenceAreas.has(lead.area);
    const hasBlocker = blockerAreas.has(lead.area);
    const quality = hasBlocker ? "needs_refinement" : hasEvidence ? "strong_alignment" : "under_specified";
    add("acceptance_area_pattern", quality, {
      title: `Acceptance area: ${lead.area.replace(/_/g, " ")}`,
      summary: `"${lead.area.replace(/_/g, " ")}" is the most frequent acceptance area in this workflow (${lead.count}).`,
      sourcePattern: lead.area,
      supportingSignals: [`${lead.count} occurrence(s)`, hasEvidence ? "has evidence expectations" : "no evidence relation"],
      blockerTypes: hasBlocker ? blockerTypesAll.slice(0, MAX_LIST) : [],
      relatedAcceptanceAreas: [lead.area],
      relatedEvidenceTypes: [],
      relatedStageNumbers: [],
    });
  }

  // 2. evidence_pattern — leading evidence type.
  if (topEvidence.length > 0) {
    const lead = topEvidence[0];
    const memFitForEvidence = memoryItems.filter((m) =>
      strArr(m.expectedEvidenceTypes).includes(lead.evidenceType),
    );
    const hasStrong = memFitForEvidence.some((m) => str(m.toolFit) === "strong");
    const hasPartial = memFitForEvidence.some((m) => str(m.toolFit) === "partial");
    const quality = blockerEvidence.has(lead.evidenceType) || hasMissingEvidenceBlocker
      ? "needs_refinement"
      : hasStrong
        ? "strong_alignment"
        : hasPartial
          ? "partial_alignment"
          : memFitForEvidence.length === 0
            ? "under_specified"
            : "partial_alignment";
    add("evidence_pattern", quality, {
      title: `Evidence pattern: ${lead.evidenceType.replace(/_/g, " ")}`,
      summary: `"${lead.evidenceType.replace(/_/g, " ")}" is the most expected evidence type (${lead.count}).`,
      sourcePattern: lead.evidenceType,
      supportingSignals: [
        `${lead.count} occurrence(s)`,
        memFitForEvidence.length > 0 ? "covered by an agent/tool pairing" : "no agent/tool fit",
      ],
      blockerTypes: blockerEvidence.has(lead.evidenceType) ? blockerTypesAll.slice(0, MAX_LIST) : [],
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: [lead.evidenceType],
      relatedStageNumbers: [],
    });
  }

  // 3. stage_pattern — when multiple stages exist.
  if (stages.length >= 2) {
    const stageNumbers = numArr(stages.map((s) => s.number));
    const hasTasks = (Number(graphSignal.agentTaskCount) || 0) > 0;
    const hasEvidence = expectations.length > 0;
    const overlapsBlocker = stageNumbers.some((n) => blockerStages.has(n));
    const quality = overlapsBlocker
      ? "needs_refinement"
      : hasTasks && hasEvidence
        ? "strong_alignment"
        : "under_specified";
    add("stage_pattern", quality, {
      title: `Stage structure (${stages.length} stages)`,
      summary: "The stage plan defines the review/acceptance sequence for this workflow.",
      sourcePattern: `${stages.length}_stages`,
      supportingSignals: [
        hasTasks ? "stages have agent tasks" : "no agent tasks",
        hasEvidence ? "stages have evidence expectations" : "no evidence expectations",
      ],
      blockerTypes: overlapsBlocker ? blockerTypesAll.slice(0, MAX_LIST) : [],
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: [],
      relatedStageNumbers: unique(stageNumbers).sort((a, b) => a - b).slice(0, MAX_LIST),
    });
  }

  // 4. tool_pattern — from agent/tool memory (leading item).
  if (memoryItems.length > 0) {
    const lead = memoryItems[0];
    const fit = str(lead.toolFit);
    const blk = strArr(lead.blockerTypes);
    const quality = blk.length > 0
      ? "needs_refinement"
      : fit === "strong"
        ? "strong_alignment"
        : fit === "partial"
          ? "partial_alignment"
          : "unknown";
    add("tool_pattern", quality, {
      title: `Tool pattern: ${str(lead.role)}/${str(lead.recommendedTool).replace(/_/g, " ")}`,
      summary: "A role/tool pairing recurs in this workflow with the evidence it is expected to produce.",
      sourcePattern: `${str(lead.role)}|${str(lead.recommendedTool)}`,
      supportingSignals: [`tool fit ${fit || "unknown"}`],
      blockerTypes: blk.slice(0, MAX_LIST),
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: strArr(lead.expectedEvidenceTypes).slice(0, MAX_LIST),
      relatedStageNumbers: numArr(lead.stageNumbers).slice(0, MAX_LIST),
    });
  }

  // 5. decision_pattern — conservative.
  if (decisions.length > 0) {
    const quality = ["fix", "rerun", "defer", "not_verified"].includes(recommendedDecision)
      ? "needs_refinement"
      : recommendedDecision === "accept"
        ? "strong_alignment"
        : "unknown";
    add("decision_pattern", quality, {
      title: `Decision pattern: recommended ${recommendedDecision || "n/a"}`,
      summary: "Decision candidates are derived but no final decision is made; templates should stay conservative.",
      sourcePattern: recommendedDecision || "no_recommendation",
      supportingSignals: [`${decisions.length} decision candidate(s)`],
      blockerTypes: [],
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: [],
      relatedStageNumbers: [],
    });
  }

  // 6. action_pattern — from evolution action preview.
  if (actions.length > 0) {
    const types = unique(actions.map((a) => str(a.type)).filter(Boolean));
    const unresolved = types.some((t) =>
      ["collect_evidence", "create_fix_instructions", "rerun_agent"].includes(t),
    );
    const tiedToItems = actions.some(
      (a) => strArr(a.relatedAcceptanceItems).length > 0 || numArr(a.relatedStageNumbers).length > 0,
    );
    const quality = unresolved ? "needs_refinement" : tiedToItems ? "partial_alignment" : "unknown";
    add("action_pattern", quality, {
      title: `Action pattern (${types.length} type(s))`,
      summary: "Recommended next-action types recur in this workflow and can seed reusable action templates.",
      sourcePattern: types.slice(0, 3).join(","),
      supportingSignals: [`${actions.length} action(s)`, ...types.slice(0, 3).map((t) => t.replace(/_/g, " "))],
      blockerTypes: [],
      relatedAcceptanceAreas: [],
      relatedEvidenceTypes: [],
      relatedStageNumbers: [],
    });
  }

  const capped = signals.slice(0, MAX_SIGNALS);

  const qualityCounts = Object.fromEntries(QUALITIES.map((q) => [q, 0]));
  for (const s of capped) qualityCounts[s.quality] += 1;

  const topNeedsRefinement = capped
    .filter((s) => s.quality === "needs_refinement" || s.quality === "under_specified")
    .map((s) => s.title)
    .slice(0, 5);

  const confidence =
    capped.length === 0
      ? "low"
      : capped.some((s) => s.quality === "strong_alignment")
        ? CONFIDENCE.includes(asObj(input?.acceptanceGraphView).confidence)
          ? asObj(input?.acceptanceGraphView).confidence
          : "medium"
        : "low";

  return {
    workflowRecordId: str(input?.workflowRecordId) || undefined,
    title,
    summary:
      "Simsa derives template/pattern signals from this saved workflow — which acceptance, evidence, stage, tool, decision, and action patterns align well and which need refinement.",
    signals: capped,
    qualityCounts,
    topNeedsRefinement,
    notIncludedYet: [
      "These signals are derived from this saved workflow only.",
      "No template is statistically validated yet.",
      "No cross-project analytics or model training is used.",
      "No template is automatically changed by this preview.",
    ],
    confidence,
  };
}

export { SIGNAL_TYPES, QUALITIES };

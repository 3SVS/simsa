// Stage 115 — deterministic Evolution Action Pack Preview.
//
// Turns the unresolved signals of a SAVED agent workflow record (Stage 112/112B
// snapshots) + its Decision/Outcome Link Preview (Stage 114) into candidate
// next actions. This prepares the future connection to the existing Stage 76~85
// evolution action pack system, but it does NOT persist an action pack, write to
// any evolution table, execute a fix, rerun an agent, collect evidence, call any
// model/GitHub, or mutate central-plane.
//
// Pure + deterministic; snapshot inputs are `unknown`, so every accessor is
// defensive (malformed → conservative fallback, never throws). Because nothing
// is executed or collected, the preview is conservative — its default focus is
// collect_evidence.
import { EVIDENCE_TYPE_LABELS } from "./intake-evidence-plan.mjs";

const ACTION_TYPES = [
  "clarify",
  "collect_evidence",
  "create_fix_instructions",
  "rerun_agent",
  "defer_scope",
  "prepare_release_review",
];
const CONFIDENCE = ["low", "medium", "high"];

// Stable display order (after priority sort, ties break by this index).
const TYPE_ORDER = [
  "create_fix_instructions",
  "rerun_agent",
  "prepare_release_review",
  "collect_evidence",
  "clarify",
  "defer_scope",
];

const MIN_ACTIONS = 3;
const MAX_ACTIONS = 7;
const MAX_ITEMS = 6;
const MAX_EVIDENCE = 6;

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

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

const TITLES = {
  clarify: "Clarify unresolved acceptance details",
  collect_evidence: "Collect the expected evidence",
  create_fix_instructions: "Draft fix instructions",
  rerun_agent: "Rerun the agent task",
  defer_scope: "Defer the item until scope is ready",
  prepare_release_review: "Prepare a release review",
};

const INSTRUCTIONS = {
  clarify:
    "Resolve the open clarification questions for the related acceptance item before planning a fix or rerun.",
  collect_evidence:
    "Collect the expected evidence for the related acceptance item before making an accept/fix/rerun decision.",
  create_fix_instructions:
    "Draft fix instructions for the related acceptance item, focusing only on the unresolved issue and expected evidence.",
  rerun_agent:
    "Rerun the agent task against the same acceptance item and compare the new evidence against the previous expectation.",
  defer_scope:
    "Mark this item as deferred until the missing scope or evidence is available.",
  prepare_release_review:
    "Prepare a release review using the stage plan, evidence expectations, and unresolved risks.",
};

const DEFAULT_EVIDENCE = {
  clarify: ["Clarification note"],
  collect_evidence: ["Review note"],
  create_fix_instructions: ["Fix summary", "Commit link"],
  rerun_agent: ["Test result", "Build result"],
  defer_scope: ["Release decision note"],
  prepare_release_review: ["Release decision note", "Acceptance checklist"],
};

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

function intakeTypeOf(input) {
  return (
    str(asObj(input?.acceptanceMap).intakeType) ||
    str(asObj(input?.evidencePlan).intakeType) ||
    str(asObj(input?.agentRunPlan).intakeType)
  );
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
 *   decisionOutcomePreview?: unknown,
 * }} input
 * @returns {import("./intake-evolution-action-preview.d.mts").EvolutionActionPackPreview}
 */
export function buildEvolutionActionPackPreview(input) {
  const title = str(input?.title).trim() || "Saved workflow";

  const expectations = asArray(asObj(input?.evidencePlan).expectations).map(normalizeExpectation);
  const haveExpectations = expectations.some((e) => e.acceptanceItemTitle.length > 0);
  const missingQuestions = strArr(asObj(input?.evidencePlan).missingEvidenceQuestions);

  const acceptanceItems = asArray(asObj(input?.acceptanceMap).items);
  const missingDetailItems = acceptanceItems
    .map(asObj)
    .filter((it) => str(it.status) === "missing_detail")
    .map((it) => str(it.title).trim())
    .filter(Boolean);

  const stages = asArray(asObj(input?.stagePlan).stages);
  const hasReleaseStage = stages.some((s) => str(asObj(s).kind) === "release");
  const hasReleaseGate =
    strArr(asObj(asObj(input?.stagePlan).releaseGate).checks).length > 0 || hasReleaseStage;

  const byImpact = (impact) => expectations.filter((e) => e.decisionImpact === impact);
  const fix = byImpact("fix");
  const rerun = byImpact("rerun");
  const defer = byImpact("defer");
  const needsEvidence = expectations.filter(
    (e) => e.status === "needed" || e.status === "not_verified" || e.status === "needs_decision",
  );
  const notVerifiedCount = expectations.filter((e) => e.status === "not_verified").length;
  const releaseEvidence = expectations.filter((e) => e.relatedArea === "release_readiness");

  const titlesOf = (items) =>
    unique(items.map((e) => e.acceptanceItemTitle).filter(Boolean)).slice(0, MAX_ITEMS);
  const stagesOf = (items) =>
    unique(items.flatMap((e) => e.relatedStageNumbers)).sort((a, b) => a - b);
  const evidenceOf = (items, type) => {
    const derived = unique(items.flatMap((e) => e.evidenceTypes).map(evidenceLabel));
    return (derived.length > 0 ? derived : DEFAULT_EVIDENCE[type]).slice(0, MAX_EVIDENCE);
  };

  /** @type {Array<Omit<import("./intake-evolution-action-preview.d.mts").EvolutionActionPreviewItem,"id">>} */
  const candidates = [];

  // create_fix_instructions — from fix decision impacts.
  if (fix.length > 0) {
    candidates.push({
      type: "create_fix_instructions",
      title: TITLES.create_fix_instructions,
      priority: "high",
      rationale: `${fix.length} acceptance item(s) carry a fix signal that should become scoped fix instructions.`,
      sourceSignals: [`${fix.length} fix decision impact(s)`],
      relatedAcceptanceItems: titlesOf(fix),
      relatedStageNumbers: stagesOf(fix),
      suggestedInstruction: INSTRUCTIONS.create_fix_instructions,
      expectedEvidence: evidenceOf(fix, "create_fix_instructions"),
    });
  }

  // rerun_agent — from rerun decision impacts.
  if (rerun.length > 0) {
    candidates.push({
      type: "rerun_agent",
      title: TITLES.rerun_agent,
      priority: "high",
      rationale: `${rerun.length} item(s) need another agent attempt against the same acceptance items.`,
      sourceSignals: [`${rerun.length} rerun decision impact(s)`],
      relatedAcceptanceItems: titlesOf(rerun),
      relatedStageNumbers: stagesOf(rerun),
      suggestedInstruction: INSTRUCTIONS.rerun_agent,
      expectedEvidence: evidenceOf(rerun, "rerun_agent"),
    });
  }

  // prepare_release_review — when a release stage/gate or release evidence exists.
  if (hasReleaseGate || releaseEvidence.length > 0) {
    candidates.push({
      type: "prepare_release_review",
      title: TITLES.prepare_release_review,
      priority: releaseEvidence.some((e) => e.status === "not_verified") ? "high" : "medium",
      rationale: "Release readiness appears in the workflow and should be reviewed before sharing.",
      sourceSignals: [
        hasReleaseGate ? "release stage/gate present" : "release-readiness evidence present",
      ],
      relatedAcceptanceItems: titlesOf(releaseEvidence),
      relatedStageNumbers: stagesOf(releaseEvidence),
      suggestedInstruction: INSTRUCTIONS.prepare_release_review,
      expectedEvidence: evidenceOf(releaseEvidence, "prepare_release_review"),
    });
  }

  // collect_evidence — from items that still need evidence (or a baseline).
  if (needsEvidence.length > 0 || haveExpectations) {
    const src = needsEvidence.length > 0 ? needsEvidence : expectations;
    candidates.push({
      type: "collect_evidence",
      title: TITLES.collect_evidence,
      priority: notVerifiedCount >= 3 ? "high" : "medium",
      rationale: `${src.length} acceptance item(s) still need evidence before an accept/fix/rerun decision.`,
      sourceSignals: [`${src.length} item(s) need evidence`],
      relatedAcceptanceItems: titlesOf(src),
      relatedStageNumbers: stagesOf(src),
      suggestedInstruction: INSTRUCTIONS.collect_evidence,
      expectedEvidence: evidenceOf(src, "collect_evidence"),
    });
  }

  // clarify — from missing_detail items or open clarification questions.
  if (missingDetailItems.length > 0 || missingQuestions.length > 0) {
    candidates.push({
      type: "clarify",
      title: TITLES.clarify,
      priority: "medium",
      rationale: "There are unresolved details/questions that block a confident decision.",
      sourceSignals: [
        missingDetailItems.length > 0
          ? `${missingDetailItems.length} item(s) need detail`
          : `${missingQuestions.length} open question(s)`,
      ],
      relatedAcceptanceItems: missingDetailItems.slice(0, MAX_ITEMS),
      relatedStageNumbers: [],
      suggestedInstruction: INSTRUCTIONS.clarify,
      expectedEvidence: DEFAULT_EVIDENCE.clarify,
    });
  }

  // defer_scope — from defer decision impacts.
  if (defer.length > 0) {
    candidates.push({
      type: "defer_scope",
      title: TITLES.defer_scope,
      priority: "medium",
      rationale: `${defer.length} item(s) are valid but should wait for more scope or evidence.`,
      sourceSignals: [`${defer.length} defer decision impact(s)`],
      relatedAcceptanceItems: titlesOf(defer),
      relatedStageNumbers: stagesOf(defer),
      suggestedInstruction: INSTRUCTIONS.defer_scope,
      expectedEvidence: evidenceOf(defer, "defer_scope"),
    });
  }

  // Conservative top-up so a preview always has ≥3 actions.
  const fallbacks = [
    {
      type: "collect_evidence",
      title: TITLES.collect_evidence,
      priority: "medium",
      rationale: "Evidence is needed before any acceptance decision can be made.",
      sourceSignals: ["no evidence collected yet"],
      relatedAcceptanceItems: [],
      relatedStageNumbers: [],
      suggestedInstruction: INSTRUCTIONS.collect_evidence,
      expectedEvidence: DEFAULT_EVIDENCE.collect_evidence,
    },
    {
      type: "clarify",
      title: TITLES.clarify,
      priority: "low",
      rationale: "Clarify the acceptance intent so the workflow can be evaluated.",
      sourceSignals: ["acceptance intent still unclear"],
      relatedAcceptanceItems: [],
      relatedStageNumbers: [],
      suggestedInstruction: INSTRUCTIONS.clarify,
      expectedEvidence: DEFAULT_EVIDENCE.clarify,
    },
    {
      type: "prepare_release_review",
      title: TITLES.prepare_release_review,
      priority: "low",
      rationale: "A release review is the eventual gate once evidence is in place.",
      sourceSignals: ["release review is a downstream step"],
      relatedAcceptanceItems: [],
      relatedStageNumbers: [],
      suggestedInstruction: INSTRUCTIONS.prepare_release_review,
      expectedEvidence: DEFAULT_EVIDENCE.prepare_release_review,
    },
  ];
  for (const f of fallbacks) {
    if (candidates.length >= MIN_ACTIONS) break;
    if (candidates.some((c) => c.type === f.type)) continue;
    candidates.push(f);
  }

  // Sort by priority, then by stable type order; cap at MAX_ACTIONS; assign ids.
  const sorted = candidates
    .slice()
    .sort((a, b) => {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    })
    .slice(0, MAX_ACTIONS)
    .map((a, i) => ({ id: `act-${i + 1}`, ...a }));

  // Recommended focus — default collect_evidence; fix dominates only when strong.
  let recommendedFocus = "collect_evidence";
  if (fix.length >= 2) recommendedFocus = "create_fix_instructions";
  else if (!sorted.some((a) => a.type === "collect_evidence")) {
    recommendedFocus = sorted[0]?.type ?? "collect_evidence";
  }

  // Follow-up questions — base + context-specific by intake type.
  const followUpQuestions = [
    "Which action should be handled first?",
    "What evidence is required before accepting this workflow?",
    "Which unresolved item should become fix instructions?",
    "Should any item be deferred instead of fixed now?",
  ];
  const type = intakeTypeOf(input);
  if (type === "github_repo") followUpQuestions.push("Which commit or PR should carry the fix?");
  else if (type === "product_url")
    followUpQuestions.push("What browser walkthrough or screenshot should be captured?");
  else if (type === "ai_built_app")
    followUpQuestions.push("Which draft area should be fixed before sharing?");
  else if (type === "pull_request")
    followUpQuestions.push("Which acceptance item should the PR prove before review?");

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
      "Simsa does not stop at comparison or decision — it turns unresolved workflow signals into candidate next actions.",
    recommendedFocus,
    actions: sorted,
    followUpQuestions: unique(followUpQuestions).slice(0, 6),
    notIncludedYet: [
      "No action pack is persisted in this preview.",
      "No fix instruction is executed.",
      "No agent is rerun.",
      "No evidence is collected automatically.",
    ],
    confidence,
  };
}

export { ACTION_TYPES };

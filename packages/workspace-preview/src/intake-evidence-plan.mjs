// Stage 111 — deterministic Acceptance Item Evidence Plan.
//
// Connects Acceptance Map items ↔ Stage Plan stages ↔ Agent Run Plan tasks ↔
// the evidence each would need before Simsa can decide accept/fix/rerun/defer/
// not_verified. Pure, in-browser; reuses Stage 106/107/110 helpers. NO evidence
// collection, upload, screenshot, test execution, GitHub call, backend, DB, or
// persistence. This is evidence PLANNING, not verification — nothing here is
// "verified/passed".
import { buildIntakeAcceptanceMap } from "./intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "./intake-stage-plan.mjs";
import { buildAgentRunPlan } from "./intake-agent-run-plan.mjs";

const MIN = 4;
const MAX = 8;

// Acceptance area → expected evidence types.
const AREA_EVIDENCE = {
  product_intent: ["clarification_note", "acceptance_checklist"],
  primary_user_flow: ["walkthrough", "review_note", "screenshot"],
  onboarding: ["screenshot", "walkthrough", "review_note"],
  error_recovery: ["walkthrough", "test_result", "review_note"],
  data_privacy: ["review_note", "acceptance_checklist"],
  implementation_readiness: ["build_result", "test_result", "commit_link"],
  release_readiness: ["release_decision_note", "acceptance_checklist"],
  trust_and_proof: ["screenshot", "review_note"],
  decision_history: ["release_decision_note", "review_note"],
};

// Agent task tool → additional evidence types.
const TOOL_EVIDENCE = {
  github_pr_review: ["pr_link", "review_note"],
  claude_code: ["commit_link", "fix_summary"],
  codex: ["commit_link", "fix_summary"],
  browser_check: ["screenshot", "walkthrough"],
  test_run: ["test_result", "build_result"],
  human_review: ["clarification_note", "review_note"],
  none: [],
};

function unique(arr) {
  return [...new Set(arr)];
}

/** Decision impact from the acceptance area + the related task's next decision. */
function decisionImpact(area, taskDecision) {
  if (area === "error_recovery" || area === "data_privacy") return "fix";
  if (area === "release_readiness" || area === "decision_history") return "defer";
  if (taskDecision === "fix" || taskDecision === "rerun") return taskDecision;
  return "not_verified";
}

/**
 * @param {{ type: import("./intake.d.mts").WorkspaceIntakeType, rawInput: string }} input
 * @returns {import("./intake-evidence-plan.d.mts").IntakeEvidencePlan}
 */
export function buildIntakeEvidencePlan(input) {
  const map = buildIntakeAcceptanceMap(input); // throws on unknown type (by design)
  const stagePlan = buildIntakeStagePlan(input);
  const runPlan = buildAgentRunPlan(input);
  const type = map.intakeType;

  // Build one expectation per acceptance item (clamped to MIN..MAX).
  const items = map.items.slice(0, MAX);
  const expectations = items.map((item, i) => {
    const area = item.area;
    // Stages/tasks whose acceptanceAreas include this item's area.
    const relatedStageNumbers = unique(
      stagePlan.stages
        .filter((s) => s.acceptanceAreas.includes(area))
        .map((s) => s.number),
    );
    const relatedTasks = runPlan.tasks.filter((t) =>
      relatedStageNumbers.includes(t.stageNumber),
    );
    const relatedTaskIds = relatedTasks.map((t) => t.id);
    const toolTypes = relatedTasks.flatMap((t) => TOOL_EVIDENCE[t.recommendedTool] ?? []);
    // Tool-derived evidence first (specific to the actual work), then area
    // defaults; cap at 5 so work-specific types are not truncated away.
    const evidenceTypes = unique([...toolTypes, ...(AREA_EVIDENCE[area] ?? ["review_note"])]).slice(0, 5);
    const taskDecision = relatedTasks[0]?.nextDecision;

    // status: candidate items default not_verified; missing_detail → needed
    const status =
      item.status === "missing_detail"
        ? "needed"
        : area === "release_readiness" || area === "decision_history"
          ? "needs_decision"
          : "not_verified";

    return {
      id: `ev-${i + 1}`,
      acceptanceItemTitle: item.title,
      relatedArea: area,
      relatedStageNumbers,
      relatedTaskIds,
      evidenceTypes,
      status,
      whyNeeded: `Evidence is needed to decide on "${item.title}" before it can be accepted, fixed, or deferred.`,
      decisionImpact: decisionImpact(area, taskDecision),
    };
  });

  // Guarantee minimum count by topping up from generic areas if needed.
  let expanded = expectations;
  if (expanded.length < MIN) {
    const fillers = [
      { area: "primary_user_flow", title: "The primary flow can be completed without unclear states." },
      { area: "release_readiness", title: "Release readiness is checked before sharing with users." },
      { area: "data_privacy", title: "Private data is not exposed unintentionally." },
      { area: "product_intent", title: "The product intent is clear enough to review." },
    ];
    const seen = new Set(expanded.map((e) => e.acceptanceItemTitle));
    for (const f of fillers) {
      if (expanded.length >= MIN) break;
      if (seen.has(f.title)) continue;
      seen.add(f.title);
      expanded = [
        ...expanded,
        {
          id: `ev-${expanded.length + 1}`,
          acceptanceItemTitle: f.title,
          relatedArea: f.area,
          relatedStageNumbers: [],
          relatedTaskIds: [],
          evidenceTypes: unique(AREA_EVIDENCE[f.area] ?? ["review_note"]).slice(0, 4),
          status: "not_verified",
          whyNeeded: `Evidence is needed to decide on "${f.title}" before it can be accepted, fixed, or deferred.`,
          decisionImpact: decisionImpact(f.area),
        },
      ];
    }
  }

  const missingEvidenceQuestions = buildQuestions(type);

  return {
    intakeType: type,
    title: map.title,
    summary:
      "Simsa shows what evidence would be needed before deciding whether to accept, fix, rerun, or defer the work.",
    expectations: expanded,
    missingEvidenceQuestions,
    overallEvidenceStatus: "not_verified",
    confidence: map.confidence,
  };
}

/** @param {import("./intake.d.mts").WorkspaceIntakeType} type */
function buildQuestions(type) {
  const q = [
    "What evidence would prove the primary flow works?",
    "What should be captured before deciding to release?",
    "Which acceptance item needs human review?",
    "What would make this item require a fix or rerun?",
  ];
  if (type === "github_repo")
    q.push("Which build/test result should prove this repo is ready?");
  if (type === "product_url")
    q.push("What screenshot or walkthrough should prove the public surface is clear?");
  if (type === "ai_built_app")
    q.push("What evidence would show the draft is safe to share?");
  if (type === "pull_request")
    q.push("Which PR or commit link proves the changed behavior?");
  return unique(q).slice(0, 6);
}

export const EVIDENCE_STATUS_LABELS = {
  planned: "Planned",
  needed: "Needed",
  not_verified: "Not verified",
  needs_decision: "Needs decision",
};

export const EVIDENCE_TYPE_LABELS = {
  clarification_note: "Clarification note",
  acceptance_checklist: "Acceptance checklist",
  review_note: "Review note",
  screenshot: "Screenshot",
  walkthrough: "Walkthrough",
  test_result: "Test result",
  build_result: "Build result",
  pr_link: "PR link",
  commit_link: "Commit link",
  fix_summary: "Fix summary",
  release_decision_note: "Release decision note",
};

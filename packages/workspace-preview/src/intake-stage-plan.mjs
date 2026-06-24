// Stage 107 — deterministic Stage Plan from the Acceptance Map.
//
// Acceptance Map → ordered review workflow. Pure, in-browser; reuses Stage 106's
// buildIntakeAcceptanceMap. NO backend / AI / fetch / DB / persistence — a
// compact (4–7 stage) preview plan, not saved, not executed.
import { buildIntakeAcceptanceMap } from "./intake-acceptance-map.mjs";

const MIN_STAGES = 4;
const MAX_STAGES = 7;

function unique(arr) {
  return [...new Set(arr)];
}

// Stage templates keyed by a stable id. Each is added to the plan when relevant;
// the always-on set guarantees the 4-stage spine.
function clarifyStage(map) {
  return {
    kind: "clarify",
    status: map.confidence === "low" ? "needs_clarification" : "planned",
    title:
      map.intakeType === "idea"
        ? "Clarify product intent"
        : "Clarify scope and intent",
    goal: "Make the product intent and review scope explicit.",
    acceptanceAreas: ["product_intent"],
    candidateChecks: [
      "The primary user is identified.",
      "The main action is described in user terms.",
      "Open questions are captured.",
    ],
    evidenceToCollect: ["Notes from clarification."],
    exitCriteria: ["The next action is clear."],
  };
}

function acceptanceStage(map) {
  return {
    kind: "acceptance",
    status: "planned",
    title:
      map.intakeType === "prd"
        ? "Convert input into acceptance items"
        : "Draft and confirm acceptance items",
    goal: "Turn the input into specific, reviewable acceptance items.",
    acceptanceAreas: ["primary_user_flow", "onboarding"],
    candidateChecks: [
      "Each acceptance item is specific enough to review.",
      "The flow has a clear success condition.",
    ],
    evidenceToCollect: ["A short acceptance item list."],
    exitCriteria: ["Acceptance items are specific enough to review."],
  };
}

function reviewStage(map) {
  const isApp =
    map.intakeType === "ai_built_app" ||
    map.intakeType === "product_url" ||
    map.intakeType === "github_repo";
  return {
    kind: "review",
    status: "needs_evidence",
    title: "Review the primary flow",
    goal: "Check the main user flow against acceptance items, with evidence.",
    acceptanceAreas: ["primary_user_flow", "error_recovery"],
    candidateChecks: [
      "The main flow can be completed without unclear states.",
      "Empty and error states are handled.",
      ...(isApp ? ["The surface behaves as the input describes."] : []),
    ].slice(0, 4),
    evidenceToCollect: [
      "Screenshot or walkthrough of the main flow.",
      "Review notes showing what was checked.",
    ],
    exitCriteria: ["The primary flow can be reviewed with evidence."],
  };
}

function releaseStage() {
  return {
    kind: "release",
    status: "deferred",
    title: "Verify release readiness",
    goal: "Confirm the work is ready to share with users.",
    acceptanceAreas: ["data_privacy", "release_readiness"],
    candidateChecks: [
      "Private data is not exposed unintentionally.",
      "Release blockers are resolved or accepted.",
    ],
    evidenceToCollect: ["A release readiness checklist."],
    exitCriteria: ["Release blockers are known and decided."],
  };
}

// Context stages by intake type (inserted before the release stage).
function contextStages(map) {
  switch (map.intakeType) {
    case "prd":
      return [
        {
          kind: "clarify",
          status: "needs_clarification",
          title: "Resolve missing product questions",
          goal: "Answer the open questions the PRD leaves unclear.",
          acceptanceAreas: ["product_intent"],
          candidateChecks: [
            "Missing questions are resolved before implementation review.",
            "Each answer is specific enough to act on.",
          ],
          evidenceToCollect: ["Answers to the missing questions."],
          exitCriteria: ["No blocking product questions remain."],
        },
      ];
    case "product_url":
      return [
        {
          kind: "evidence",
          status: "needs_evidence",
          title: "Check CTA and user-journey evidence",
          goal: "Verify the public surface promise against what a visitor can do.",
          acceptanceAreas: ["trust_and_proof"],
          candidateChecks: [
            "The primary CTA explains the next step.",
            "Claims are supported by visible evidence or clear limitations.",
          ],
          evidenceToCollect: ["Walkthrough of the public surface."],
          exitCriteria: ["The surface promise is supported by evidence."],
        },
      ];
    case "github_repo":
      return [
        {
          kind: "evidence",
          status: "needs_evidence",
          title: "Review build/test evidence",
          goal: "Map implementation to product acceptance with build/test evidence.",
          acceptanceAreas: ["implementation_readiness"],
          candidateChecks: [
            "Build and test commands are known.",
            "Main flows map to acceptance items.",
          ],
          evidenceToCollect: ["Build/test result.", "Repo or commit link."],
          exitCriteria: ["Implementation maps to acceptance items with evidence."],
        },
      ];
    case "ai_built_app":
      return [
        {
          kind: "fix",
          status: "planned",
          title: "Fix or rebuild decision",
          goal: "Decide what to keep, fix, rebuild, or verify next.",
          acceptanceAreas: ["primary_user_flow", "error_recovery"],
          candidateChecks: [
            "Keep/fix/rebuild signals are reviewed.",
            "The core flow is verified before further work.",
          ],
          evidenceToCollect: ["Notes on the fix-vs-rebuild decision."],
          exitCriteria: ["A fix-or-rebuild decision is recorded."],
        },
      ];
    case "pull_request":
      return [
        {
          kind: "evidence",
          status: "needs_evidence",
          title: "Map the PR change to an acceptance item",
          goal: "Tie the proposed change to the acceptance item it should prove.",
          acceptanceAreas: ["implementation_readiness", "decision_history"],
          candidateChecks: [
            "The acceptance item the PR proves is identified.",
            "Evidence shows the changed behavior works.",
          ],
          evidenceToCollect: ["PR or commit link.", "Review notes showing what changed."],
          exitCriteria: ["The PR maps to a reviewable acceptance item."],
        },
      ];
    default:
      return [];
  }
}

/**
 * @param {{ type: import("./intake.d.mts").WorkspaceIntakeType, rawInput: string }} input
 * @returns {import("./intake-stage-plan.d.mts").IntakeStagePlan}
 */
export function buildIntakeStagePlan(input) {
  const map = buildIntakeAcceptanceMap(input); // throws on unknown type (by design)

  // Spine (always present) + context stages, then release at the end.
  const ordered = [
    clarifyStage(map),
    acceptanceStage(map),
    ...contextStages(map),
    reviewStage(map),
    releaseStage(),
  ].slice(0, MAX_STAGES);

  // Guarantee the minimum even if something trimmed (shouldn't happen).
  while (ordered.length < MIN_STAGES) {
    ordered.splice(ordered.length - 1, 0, reviewStage(map));
  }

  const stages = ordered.map((s, i) => ({ ...s, number: i + 1 }));

  const recommendedStartStage = pickStartStage(map, stages);

  return {
    intakeType: map.intakeType,
    title: map.title,
    summary: "Simsa turns the acceptance map into an ordered review workflow.",
    stages,
    recommendedStartStage,
    releaseGate: {
      title: "Release gate",
      checks: unique([
        "All non-deferred stages have evidence or an accepted exception.",
        "Private data exposure is checked.",
        "Known release blockers are resolved or explicitly accepted.",
      ]),
    },
    confidence: map.confidence,
  };
}

function pickStartStage(map, stages) {
  if (map.confidence === "low") return 1;
  switch (map.recommendedNextStep) {
    case "clarify_product_intent":
      return 1;
    case "draft_acceptance_items":
      return Math.min(2, stages.length);
    case "review_core_flow": {
      const idx = stages.findIndex((s) => s.kind === "review");
      return idx >= 0 ? idx + 1 : 1;
    }
    case "create_stage_plan":
      return Math.min(2, stages.length);
    case "verify_release_readiness": {
      // release readiness should still be preceded by an evidence/review stage
      const idx = stages.findIndex((s) => s.kind === "evidence" || s.kind === "review");
      return idx >= 0 ? idx + 1 : 1;
    }
    default:
      return 1;
  }
}

export const STAGE_STATUS_LABELS = {
  planned: "Planned",
  needs_clarification: "Needs clarification",
  needs_evidence: "Needs evidence",
  deferred: "Deferred",
};

export const STAGE_KIND_LABELS = {
  clarify: "Clarify",
  acceptance: "Acceptance",
  review: "Review",
  fix: "Fix",
  evidence: "Evidence",
  release: "Release",
};

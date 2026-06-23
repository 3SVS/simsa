// Stage 106 — shared deterministic Acceptance Map.
//
// The bridge between "what the user pasted" and "the staged acceptance workflow
// Simsa will run". Every intake type converges here. Pure, in-browser; reuses
// the Stage 102–105 deterministic helpers. NO backend / AI / fetch / DB /
// persistence — preview only, not saved.
import { buildIntakeDraft } from "./intake.mjs";
import { buildPrdIntakePreview } from "./intake-prd.mjs";
import { buildProductUrlIntakePreview } from "./intake-url.mjs";
import { buildGitHubRepoIntakePreview } from "./intake-github-repo.mjs";
import { buildAiBuiltAppRecoveryPreview } from "./intake-ai-built-app.mjs";

const MIN_ITEMS = 5;
const MAX_ITEMS = 10;

function unique(arr) {
  return [...new Set(arr)];
}

/**
 * Turn a list of acceptance-style strings into map items with statuses.
 * @param {string[]} titles
 * @param {import("./intake-acceptance-map.d.mts").AcceptanceMapArea} area
 * @param {import("./intake-acceptance-map.d.mts").AcceptanceMapItemStatus} status
 * @param {string} rationale
 */
function toItems(titles, area, status, rationale) {
  return unique(titles)
    .filter(Boolean)
    .map((title) => ({ area, title, status, rationale }));
}

// Generic product-quality acceptance items every map can fall back to.
const GENERIC_ITEMS = [
  { area: "primary_user_flow", title: "The primary flow can be completed without unclear states." },
  { area: "onboarding", title: "A first-time user can understand what to do next." },
  { area: "error_recovery", title: "Failed actions show a clear recovery path." },
  { area: "data_privacy", title: "Private data is not exposed unintentionally." },
  { area: "release_readiness", title: "Release readiness is checked before sharing with users." },
];

/** Clamp items to [MIN_ITEMS, MAX_ITEMS], topping up from GENERIC_ITEMS. */
function normalizeItems(items) {
  let out = [];
  const seenTitles = new Set();
  for (const it of items) {
    if (it && it.title && !seenTitles.has(it.title)) {
      seenTitles.add(it.title);
      out.push(it);
    }
  }
  for (const g of GENERIC_ITEMS) {
    if (out.length >= MIN_ITEMS) break;
    if (!seenTitles.has(g.title)) {
      seenTitles.add(g.title);
      out.push({ ...g, status: "candidate", rationale: "Baseline product-quality acceptance item." });
    }
  }
  return out.slice(0, MAX_ITEMS);
}

function areasOf(items, extra = []) {
  return unique([...items.map((i) => i.area), ...extra]);
}

/**
 * @param {{ type: import("./intake.d.mts").WorkspaceIntakeType, rawInput: string }} input
 * @returns {import("./intake-acceptance-map.d.mts").IntakeAcceptanceMap}
 */
export function buildIntakeAcceptanceMap(input) {
  const type = input?.type;
  const rawInput = typeof input?.rawInput === "string" ? input.rawInput : "";
  const draft = buildIntakeDraft(type, rawInput); // throws on unknown type (by design)

  let summary = draft.sourceSummary;
  let items = [];
  let missingQuestions = [];
  let extraAreas = [];
  /** @type {import("./intake-acceptance-map.d.mts").AcceptanceMapNextStep} */
  let recommendedNextStep = "draft_acceptance_items";
  let confidence = "low";

  if (type === "prd") {
    const p = buildPrdIntakePreview(rawInput);
    summary = p.productIntent;
    confidence = p.confidence;
    missingQuestions = p.missingQuestions;
    items = [
      ...toItems(p.candidateAcceptanceItems, "primary_user_flow", "candidate", "Inferred from the PRD/spec."),
    ];
    extraAreas = ["product_intent"];
    recommendedNextStep =
      p.missingQuestions.length >= 5 ? "clarify_product_intent" : "draft_acceptance_items";
  } else if (type === "product_url") {
    const p = buildProductUrlIntakePreview(rawInput);
    summary = p.likelySurface;
    confidence = p.confidence;
    missingQuestions = p.missingQuestions;
    items = [
      ...toItems(p.reviewFocusAreas, "trust_and_proof", "needs_verification", "Surface review focus from the URL shape."),
      ...toItems(p.candidateAcceptanceItems, "primary_user_flow", "candidate", "Inferred from the product surface."),
    ];
    extraAreas = ["product_intent"];
    recommendedNextStep = ["demo", "pricing", "app"].includes(p.pathType)
      ? "verify_release_readiness"
      : "review_core_flow";
  } else if (type === "github_repo") {
    const p = buildGitHubRepoIntakePreview(rawInput);
    summary = `Likely ${p.likelyRepoType} repo (${p.normalizedRepo}).`;
    confidence = p.confidence;
    missingQuestions = p.missingQuestions;
    items = [
      ...toItems(p.reviewFocusAreas, "implementation_readiness", "needs_verification", "Implementation review focus from the repo shape."),
      ...toItems(p.candidateAcceptanceItems, "release_readiness", "candidate", "Inferred from the repo reference."),
    ];
    extraAreas = ["implementation_readiness", "release_readiness"];
    recommendedNextStep = p.likelyRepoType === "app" ? "review_core_flow" : "create_stage_plan";
  } else if (type === "ai_built_app") {
    const p = buildAiBuiltAppRecoveryPreview(rawInput);
    summary = p.currentStateSummary;
    confidence = p.confidence;
    missingQuestions = p.missingQuestions;
    const rationale = p.likelyRisks[0] ?? "Inferred from the described AI-built draft.";
    items = [
      ...toItems(p.recoveryFocusAreas, "primary_user_flow", "needs_verification", rationale),
      ...toItems(p.candidateAcceptanceItems, "primary_user_flow", "candidate", rationale),
    ];
    extraAreas = ["product_intent"];
    recommendedNextStep = mapRecoveryAction(p.recommendedNextAction);
  } else if (type === "pull_request") {
    summary = "A proposed change (pull request) to review against acceptance items.";
    missingQuestions = [
      "What acceptance item should this PR prove?",
      "Which flows could this change affect?",
      "What evidence shows the change is safe to merge?",
      "What should be verified before release?",
    ];
    extraAreas = [
      "primary_user_flow",
      "implementation_readiness",
      "error_recovery",
      "decision_history",
      "release_readiness",
    ];
    items = []; // generic top-up below
    recommendedNextStep = "review_core_flow";
    confidence = rawInput.trim() ? "medium" : "low";
  } else {
    // idea
    missingQuestions = [
      "Who is the primary user?",
      "What is the first action they need to complete?",
      "What counts as a successful outcome?",
      "What needs to be true before sharing this with users?",
    ];
    extraAreas = ["product_intent", "primary_user_flow", "onboarding", "release_readiness"];
    items = [];
    recommendedNextStep = "clarify_product_intent";
    confidence = rawInput.trim().length >= 40 ? "medium" : "low";
  }

  const normalizedItems = normalizeItems(items);

  return {
    intakeType: type,
    title: draft.title,
    summary,
    areas: areasOf(normalizedItems, extraAreas),
    items: normalizedItems,
    missingQuestions: unique(missingQuestions).slice(0, 6),
    recommendedNextStep,
    confidence,
  };
}

/**
 * @param {import("./intake-ai-built-app.d.mts").AiBuiltAppRecommendedAction} action
 * @returns {import("./intake-acceptance-map.d.mts").AcceptanceMapNextStep}
 */
function mapRecoveryAction(action) {
  switch (action) {
    case "create_acceptance_map":
      return "draft_acceptance_items";
    case "review_core_flow":
      return "review_core_flow";
    case "create_fix_stage":
      return "create_stage_plan";
    case "verify_release_readiness":
      return "verify_release_readiness";
    default:
      return "draft_acceptance_items";
  }
}

export const NEXT_STEP_LABELS = {
  clarify_product_intent: "Clarify product intent",
  draft_acceptance_items: "Draft acceptance items",
  create_stage_plan: "Create stage plan",
  review_core_flow: "Review core flow",
  verify_release_readiness: "Verify release readiness",
};

// Type declarations for intake-ai-built-app.mjs
// (Stage 105 — Existing App Recovery Assessment).

export type AiBuiltAppSurface =
  | "landing"
  | "web_app"
  | "dashboard"
  | "mobile"
  | "api"
  | "prototype"
  | "unknown";

export type AiBuiltAppRecommendedAction =
  | "create_acceptance_map"
  | "review_core_flow"
  | "create_fix_stage"
  | "verify_release_readiness";

export type AiBuiltAppFixVsRebuild = {
  likelyKeep: string[];
  likelyFix: string[];
  likelyRebuild: string[];
  needsVerification: string[];
};

export type AiBuiltAppRecoveryPreview = {
  currentStateSummary: string;
  likelyProductSurface: AiBuiltAppSurface;
  recoveryFocusAreas: string[];
  candidateAcceptanceItems: string[];
  likelyRisks: string[];
  fixVsRebuildSignals: AiBuiltAppFixVsRebuild;
  missingQuestions: string[];
  recommendedNextAction: AiBuiltAppRecommendedAction;
  confidence: "low" | "medium" | "high";
};

export function buildAiBuiltAppRecoveryPreview(
  rawInput: string,
): AiBuiltAppRecoveryPreview;
export const SAMPLE_AI_BUILT_APP: string;

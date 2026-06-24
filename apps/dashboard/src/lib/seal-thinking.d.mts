// Stage 161 — types for seal-thinking.mjs.

export type SealThinkingVariant = "compact" | "panel";

export type SealThinkingInput = {
  variant?: SealThinkingVariant | string;
  label?: string;
  stepLabels?: string[];
};

export type SealThinkingDot = { index: number; delayMs: number };

export type SealThinkingA11y = {
  role: "status";
  ariaLive: "polite";
  ariaBusy: true;
};

export type SealThinkingConfig = {
  variant: SealThinkingVariant;
  dotCount: number;
  dots: SealThinkingDot[];
  label: string;
  showVisibleLabel: boolean;
  a11y: SealThinkingA11y;
};

export type SealThinkingLoadingDictionary = {
  mappingAcceptance?: string;
  buildingStagePlan?: string;
  planningEvidence?: string;
  checkingHandoffSafety?: string;
  preparingPreview?: string;
  finalizingReview?: string;
};

export const SEAL_THINKING_VARIANTS: SealThinkingVariant[];
export const DEFAULT_SEAL_LABEL: string;
export function resolveSealThinking(input?: SealThinkingInput): SealThinkingConfig;
export function getDefaultSealThinkingSteps(
  loadingDictionary?: SealThinkingLoadingDictionary | Record<string, unknown>,
): string[];

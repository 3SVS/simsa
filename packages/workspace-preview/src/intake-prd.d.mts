// Type declarations for intake-prd.mjs (Stage 102 — PRD/spec intake preview).

export type PrdIntakePreview = {
  productIntent: string;
  likelyUsers: string[];
  candidateUserFlows: string[];
  candidateAcceptanceItems: string[];
  missingQuestions: string[];
  confidence: "low" | "medium" | "high";
};

export function buildPrdIntakePreview(rawInput: string): PrdIntakePreview;
export const SAMPLE_PRD: string;

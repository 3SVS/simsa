// Type declarations for intake-evolution-action-preview.mjs (Stage 115).

export type EvolutionActionType =
  | "clarify"
  | "collect_evidence"
  | "create_fix_instructions"
  | "rerun_agent"
  | "defer_scope"
  | "prepare_release_review";

export type EvolutionActionPriority = "low" | "medium" | "high";

export type EvolutionActionPreviewItem = {
  id: string;
  type: EvolutionActionType;
  title: string;
  priority: EvolutionActionPriority;
  rationale: string;
  sourceSignals: string[];
  relatedAcceptanceItems: string[];
  relatedStageNumbers: number[];
  suggestedInstruction: string;
  expectedEvidence: string[];
};

export type EvolutionActionPackPreview = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  recommendedFocus: EvolutionActionType;
  actions: EvolutionActionPreviewItem[];
  followUpQuestions: string[];
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
};

export function buildEvolutionActionPackPreview(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  acceptanceMap?: unknown;
  stagePlan?: unknown;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  benchmarkHandoffPreview?: unknown;
  decisionOutcomePreview?: unknown;
}): EvolutionActionPackPreview;

export const ACTION_TYPES: EvolutionActionType[];

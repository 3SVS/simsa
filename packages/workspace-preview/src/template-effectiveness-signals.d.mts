// Type declarations for template-effectiveness-signals.mjs (Stage 129).

export type TemplateSignalType =
  | "acceptance_area_pattern"
  | "evidence_pattern"
  | "stage_pattern"
  | "tool_pattern"
  | "decision_pattern"
  | "action_pattern";

export type TemplateSignalQuality =
  | "strong_alignment"
  | "partial_alignment"
  | "needs_refinement"
  | "under_specified"
  | "unknown";

export type TemplateEffectivenessSignal = {
  id: string;
  type: TemplateSignalType;
  quality: TemplateSignalQuality;
  title: string;
  summary: string;
  sourcePattern: string;
  supportingSignals: string[];
  blockerTypes: string[];
  relatedAcceptanceAreas: string[];
  relatedEvidenceTypes: string[];
  relatedStageNumbers: number[];
  suggestedTemplateImprovement: string;
};

export type TemplateEffectivenessSignalsView = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  signals: TemplateEffectivenessSignal[];
  qualityCounts: Record<TemplateSignalQuality, number>;
  topNeedsRefinement: string[];
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
};

export function buildTemplateEffectivenessSignalsView(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  acceptanceGraphView?: unknown;
  recurringBlockerDetectionView?: unknown;
  agentToolMemoryView?: unknown;
  evidencePlan?: unknown;
  stagePlan?: unknown;
  decisionOutcomePreview?: unknown;
  evolutionActionPreview?: unknown;
}): TemplateEffectivenessSignalsView;

export const SIGNAL_TYPES: TemplateSignalType[];
export const QUALITIES: TemplateSignalQuality[];

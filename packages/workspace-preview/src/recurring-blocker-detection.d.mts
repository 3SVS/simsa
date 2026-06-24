// Type declarations for recurring-blocker-detection.mjs (Stage 127).

export type RecurringBlockerType =
  | "missing_evidence"
  | "not_verified_cluster"
  | "release_readiness_gap"
  | "fix_rerun_cluster"
  | "unclear_acceptance_scope"
  | "tooling_gap";

export type RecurringBlockerSeverity = "low" | "medium" | "high";

export type RecurringBlockerSignal = {
  id: string;
  type: RecurringBlockerType;
  severity: RecurringBlockerSeverity;
  title: string;
  summary: string;
  sourceSignals: string[];
  relatedAcceptanceAreas: string[];
  relatedEvidenceTypes: string[];
  relatedStageNumbers: number[];
  relatedTaskIds: string[];
  suggestedNextAction: string;
};

export type RecurringBlockerDetectionView = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  blockers: RecurringBlockerSignal[];
  topBlockerType?: RecurringBlockerType;
  blockerCountByType: Record<RecurringBlockerType, number>;
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
};

export function buildRecurringBlockerDetectionView(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  acceptanceGraphView?: unknown;
  acceptanceMap?: unknown;
  stagePlan?: unknown;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  decisionOutcomePreview?: unknown;
  evolutionActionPreview?: unknown;
}): RecurringBlockerDetectionView;

export const BLOCKER_TYPES: RecurringBlockerType[];

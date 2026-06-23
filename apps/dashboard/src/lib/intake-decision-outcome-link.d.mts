// Type declarations for intake-decision-outcome-link.mjs (Stage 114).

export type DecisionCandidateType =
  | "accept"
  | "fix"
  | "rerun"
  | "defer"
  | "not_verified";

export type SignalLevel = "low" | "medium" | "high";

export type DecisionCandidate = {
  type: DecisionCandidateType;
  label: string;
  rationale: string;
  requiredEvidence: string[];
  blockingQuestions: string[];
  relatedAcceptanceItems: string[];
  relatedStageNumbers: number[];
};

export type OutcomeLinkPreview = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  recommendedDecisionCandidate: DecisionCandidateType;
  decisionCandidates: DecisionCandidate[];
  outcomeScorecardSignals: {
    evidenceCompleteness: SignalLevel;
    acceptanceCoverage: SignalLevel;
    unresolvedRisk: SignalLevel;
    releaseReadiness: SignalLevel;
  };
  futureOutcomeLinks: string[];
  notIncludedYet: string[];
  confidence: SignalLevel;
};

export function buildDecisionOutcomeLinkPreview(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  acceptanceMap?: unknown;
  stagePlan?: unknown;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  benchmarkHandoffPreview?: unknown;
}): OutcomeLinkPreview;

export const DECISION_TYPES: DecisionCandidateType[];
export const LEVELS: SignalLevel[];

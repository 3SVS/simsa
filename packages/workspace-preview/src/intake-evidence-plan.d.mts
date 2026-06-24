// Type declarations for intake-evidence-plan.mjs (Stage 111).
import type { WorkspaceIntakeType } from "./intake.d.mts";
import type { AcceptanceMapArea } from "./intake-acceptance-map.d.mts";

export type EvidenceStatus =
  | "planned"
  | "needed"
  | "not_verified"
  | "needs_decision";

export type EvidenceType =
  | "clarification_note"
  | "acceptance_checklist"
  | "review_note"
  | "screenshot"
  | "walkthrough"
  | "test_result"
  | "build_result"
  | "pr_link"
  | "commit_link"
  | "fix_summary"
  | "release_decision_note";

export type EvidenceDecisionImpact =
  | "accept"
  | "fix"
  | "rerun"
  | "defer"
  | "not_verified";

export type EvidenceExpectation = {
  id: string;
  acceptanceItemTitle: string;
  relatedArea: AcceptanceMapArea;
  relatedStageNumbers: number[];
  relatedTaskIds: string[];
  evidenceTypes: EvidenceType[];
  status: EvidenceStatus;
  whyNeeded: string;
  decisionImpact: EvidenceDecisionImpact;
};

export type IntakeEvidencePlan = {
  intakeType: WorkspaceIntakeType;
  title: string;
  summary: string;
  expectations: EvidenceExpectation[];
  missingEvidenceQuestions: string[];
  overallEvidenceStatus: EvidenceStatus;
  confidence: "low" | "medium" | "high";
};

export function buildIntakeEvidencePlan(input: {
  type: WorkspaceIntakeType;
  rawInput: string;
}): IntakeEvidencePlan;

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string>;
export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string>;

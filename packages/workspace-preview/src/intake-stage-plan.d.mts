// Type declarations for intake-stage-plan.mjs (Stage 107).
import type { WorkspaceIntakeType } from "./intake.d.mts";
import type { AcceptanceMapArea } from "./intake-acceptance-map.d.mts";

export type IntakeStagePlanStatus =
  | "planned"
  | "needs_clarification"
  | "needs_evidence"
  | "deferred";

export type IntakeStagePlanKind =
  | "clarify"
  | "acceptance"
  | "review"
  | "fix"
  | "evidence"
  | "release";

export type IntakeStagePlanStage = {
  number: number;
  title: string;
  kind: IntakeStagePlanKind;
  status: IntakeStagePlanStatus;
  goal: string;
  acceptanceAreas: AcceptanceMapArea[];
  candidateChecks: string[];
  evidenceToCollect: string[];
  exitCriteria: string[];
};

export type IntakeStagePlan = {
  intakeType: WorkspaceIntakeType;
  title: string;
  summary: string;
  stages: IntakeStagePlanStage[];
  recommendedStartStage: number;
  releaseGate: {
    title: string;
    checks: string[];
  };
  confidence: "low" | "medium" | "high";
};

export function buildIntakeStagePlan(input: {
  type: WorkspaceIntakeType;
  rawInput: string;
}): IntakeStagePlan;

export const STAGE_STATUS_LABELS: Record<IntakeStagePlanStatus, string>;
export const STAGE_KIND_LABELS: Record<IntakeStagePlanKind, string>;

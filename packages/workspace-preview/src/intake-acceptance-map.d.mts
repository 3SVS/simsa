// Type declarations for intake-acceptance-map.mjs (Stage 106).
import type { WorkspaceIntakeType } from "./intake.d.mts";

export type AcceptanceMapArea =
  | "product_intent"
  | "primary_user_flow"
  | "onboarding"
  | "error_recovery"
  | "data_privacy"
  | "implementation_readiness"
  | "release_readiness"
  | "trust_and_proof"
  | "decision_history";

export type AcceptanceMapItemStatus =
  | "candidate"
  | "missing_detail"
  | "needs_verification";

export type AcceptanceMapNextStep =
  | "clarify_product_intent"
  | "draft_acceptance_items"
  | "create_stage_plan"
  | "review_core_flow"
  | "verify_release_readiness";

export type AcceptanceMapItem = {
  area: AcceptanceMapArea;
  title: string;
  status: AcceptanceMapItemStatus;
  rationale: string;
};

export type IntakeAcceptanceMap = {
  intakeType: WorkspaceIntakeType;
  title: string;
  summary: string;
  areas: AcceptanceMapArea[];
  items: AcceptanceMapItem[];
  missingQuestions: string[];
  recommendedNextStep: AcceptanceMapNextStep;
  confidence: "low" | "medium" | "high";
};

export function buildIntakeAcceptanceMap(input: {
  type: WorkspaceIntakeType;
  rawInput: string;
}): IntakeAcceptanceMap;

export const NEXT_STEP_LABELS: Record<AcceptanceMapNextStep, string>;

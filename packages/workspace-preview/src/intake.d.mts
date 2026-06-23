// Type declarations for intake.mjs (Stage 101 — unified intake model).

export type WorkspaceIntakeType =
  | "idea"
  | "prd"
  | "product_url"
  | "github_repo"
  | "pull_request"
  | "ai_built_app";

export type WorkspaceIntakeOutput =
  | "product_understanding"
  | "acceptance_items"
  | "stage_plan"
  | "review_evidence"
  | "decision"
  | "release_readiness";

export type WorkspaceIntakeDraft = {
  type: WorkspaceIntakeType;
  title: string;
  sourceSummary: string;
  rawInput: string;
  expectedOutputs: WorkspaceIntakeOutput[];
};

export type WorkspaceIntakeMeta = {
  type: WorkspaceIntakeType;
  label: string;
  description: string;
  placeholder: string;
  inputHint: string;
};

export const WORKSPACE_INTAKE_TYPES: WorkspaceIntakeType[];
export const INTAKE_OUTPUTS: WorkspaceIntakeOutput[];
export const INTAKE_OUTPUT_LABELS: Record<WorkspaceIntakeOutput, string>;
export const INTAKE_META: Record<WorkspaceIntakeType, WorkspaceIntakeMeta>;

export function isWorkspaceIntakeType(value: unknown): value is WorkspaceIntakeType;
export function buildIntakeDraft(
  type: WorkspaceIntakeType,
  rawInput: string,
): WorkspaceIntakeDraft;

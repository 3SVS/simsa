// Type declarations for intake-agent-run-plan.mjs (Stage 110).
import type { WorkspaceIntakeType } from "./intake.d.mts";

export type AgentRunRole =
  | "builder"
  | "reviewer"
  | "fixer"
  | "verifier"
  | "operator";

export type AgentRunPlanStatus =
  | "planned"
  | "candidate"
  | "needs_evidence"
  | "not_verified"
  | "needs_decision";

export type AgentRunTool =
  | "human_review"
  | "claude_code"
  | "codex"
  | "github_pr_review"
  | "browser_check"
  | "test_run"
  | "none";

export type AgentRunNextDecision =
  | "accept"
  | "fix"
  | "rerun"
  | "defer"
  | "not_verified";

export type AgentRunTask = {
  id: string;
  stageNumber: number;
  stageTitle: string;
  role: AgentRunRole;
  status: AgentRunPlanStatus;
  task: string;
  inputs: string[];
  acceptanceItems: string[];
  expectedEvidence: string[];
  recommendedTool: AgentRunTool;
  nextDecision: AgentRunNextDecision;
};

export type AgentRunPlan = {
  intakeType: WorkspaceIntakeType;
  title: string;
  summary: string;
  tasks: AgentRunTask[];
  primaryRole: AgentRunRole;
  recommendedFirstTaskId: string;
  confidence: "low" | "medium" | "high";
};

export function buildAgentRunPlan(input: {
  type: WorkspaceIntakeType;
  rawInput: string;
}): AgentRunPlan;

export const AGENT_ROLE_LABELS: Record<AgentRunRole, string>;
export const AGENT_TOOL_LABELS: Record<AgentRunTool, string>;
export const AGENT_STATUS_LABELS: Record<AgentRunPlanStatus, string>;
export const AGENT_DECISION_LABELS: Record<AgentRunNextDecision, string>;

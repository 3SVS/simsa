// Type declarations for intake-benchmark-handoff.mjs (Stage 113).
import type { AgentRunRole, AgentRunTool } from "./intake-agent-run-plan.d.mts";

export type BenchmarkHandoffAgentCandidate = {
  role: AgentRunRole;
  label: string;
  recommendedTool: AgentRunTool;
  taskIds: string[];
  stageNumbers: number[];
  expectedEvidence: string[];
};

export type BenchmarkHandoffAcceptanceTarget = {
  acceptanceItemTitle: string;
  area: string;
  stageNumbers: number[];
  evidenceTypes: string[];
  decisionCriteria: string[];
};

export type BenchmarkHandoffPreview = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  benchmarkGoal: string;
  agentCandidates: BenchmarkHandoffAgentCandidate[];
  acceptanceTargets: BenchmarkHandoffAcceptanceTarget[];
  comparisonQuestions: string[];
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
};

export function buildBenchmarkHandoffPreview(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  agentRunPlan: unknown;
  evidencePlan: unknown;
  acceptanceMap?: unknown;
  stagePlan?: unknown;
}): BenchmarkHandoffPreview;

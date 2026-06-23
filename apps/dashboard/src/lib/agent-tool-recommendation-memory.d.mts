// Type declarations for agent-tool-recommendation-memory.mjs (Stage 128).
import type { AgentRunRole } from "./intake-agent-run-plan.d.mts";

export type ToolFitLevel = "strong" | "partial" | "weak" | "unknown";

export type AgentToolMemoryItem = {
  id: string;
  role: AgentRunRole;
  recommendedTool: string;
  toolFit: ToolFitLevel;
  taskIds: string[];
  stageNumbers: number[];
  expectedEvidenceTypes: string[];
  blockerTypes: string[];
  memoryNote: string;
  suggestedFutureUse: string;
};

export type AgentToolRecommendationMemoryView = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  items: AgentToolMemoryItem[];
  topTool?: string;
  topRole?: AgentRunRole;
  evidenceFitSummary: {
    strong: number;
    partial: number;
    weak: number;
    unknown: number;
  };
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
};

export function buildAgentToolRecommendationMemoryView(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  recurringBlockerDetectionView?: unknown;
}): AgentToolRecommendationMemoryView;

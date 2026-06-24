// Type declarations for acceptance-graph-derived.mjs (Stage 126).

export type AcceptanceGraphNodeType =
  | "intake"
  | "acceptance_item"
  | "acceptance_area"
  | "stage"
  | "agent_task"
  | "evidence_expectation"
  | "decision_candidate"
  | "action_preview";

export type AcceptanceGraphEdgeType =
  | "generated_from"
  | "belongs_to"
  | "requires_evidence"
  | "assigned_to_role"
  | "suggests_decision"
  | "creates_action"
  | "blocks_release";

export type AcceptanceGraphNode = {
  id: string;
  type: AcceptanceGraphNodeType;
  label: string;
  summary?: string;
};

export type AcceptanceGraphEdge = {
  id: string;
  type: AcceptanceGraphEdgeType;
  from: string;
  to: string;
  label: string;
};

export type AcceptanceGraphSignalSummary = {
  acceptanceItemCount: number;
  stageCount: number;
  agentTaskCount: number;
  evidenceExpectationCount: number;
  notVerifiedCount: number;
  decisionCandidateCount: number;
  actionPreviewCount: number;
  topAcceptanceAreas: Array<{ area: string; count: number }>;
  topEvidenceTypes: Array<{ evidenceType: string; count: number }>;
};

export type AcceptanceGraphDerivedView = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  nodes: AcceptanceGraphNode[];
  edges: AcceptanceGraphEdge[];
  signalSummary: AcceptanceGraphSignalSummary;
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
};

export function buildAcceptanceGraphDerivedView(input: {
  workflowRecordId?: string;
  title: string;
  sourceSummary: string;
  acceptanceMap?: unknown;
  stagePlan?: unknown;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  decisionOutcomePreview?: unknown;
  evolutionActionPreview?: unknown;
}): AcceptanceGraphDerivedView;

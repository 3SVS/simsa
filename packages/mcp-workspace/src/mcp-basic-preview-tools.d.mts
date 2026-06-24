// Type declarations for mcp-basic-preview-tools.mjs (Stage 136).

export type McpPreviewBoundary = {
  mutatesState: false;
  usesHostedExecution: false;
  requiresPayment: false;
  derivedPreviewOnly: true;
};

export type McpPreviewInput = { type: string; rawInput: string };

export type McpPreviewError = McpPreviewBoundary & {
  ok: false;
  error: "invalid_type" | "missing_input";
  message: string;
};

export type McpPreviewResult = McpPreviewBoundary & {
  ok: true;
  kind:
    | "acceptance_map"
    | "stage_plan"
    | "agent_run_plan"
    | "evidence_plan"
    | "acceptance_graph_summary"
    | "recurring_blockers"
    | "agent_tool_memory"
    | "template_signals";
  preview: unknown;
};

export type McpPreviewResponse = McpPreviewResult | McpPreviewError;

export function previewAcceptanceMap(input: McpPreviewInput): McpPreviewResponse;
export function previewStagePlan(input: McpPreviewInput): McpPreviewResponse;
export function previewAgentRunPlan(input: McpPreviewInput): McpPreviewResponse;
export function previewEvidencePlan(input: McpPreviewInput): McpPreviewResponse;

export type McpGraphPreviewInput = {
  workflowRecordId?: string;
  title?: string;
  sourceSummary?: string;
  acceptanceGraphView?: unknown;
  acceptanceMap?: unknown;
  stagePlan?: unknown;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  decisionOutcomePreview?: unknown;
  evolutionActionPreview?: unknown;
};

export function previewAcceptanceGraphSummary(input: McpGraphPreviewInput): McpPreviewResult;
export function previewRecurringBlockers(input: McpGraphPreviewInput): McpPreviewResult;

export type McpAgentToolMemoryInput = {
  workflowRecordId?: string;
  title?: string;
  sourceSummary?: string;
  agentRunPlan?: unknown;
  evidencePlan?: unknown;
  recurringBlockerDetectionView?: unknown;
};

export type McpTemplateSignalsInput = {
  workflowRecordId?: string;
  title?: string;
  sourceSummary?: string;
  acceptanceGraphView?: unknown;
  recurringBlockerDetectionView?: unknown;
  agentToolMemoryView?: unknown;
  evidencePlan?: unknown;
  stagePlan?: unknown;
  decisionOutcomePreview?: unknown;
  evolutionActionPreview?: unknown;
};

export function previewAgentToolMemory(input: McpAgentToolMemoryInput): McpPreviewResult;
export function previewTemplateSignals(input: McpTemplateSignalsInput): McpPreviewResult;

export type McpHandoffInput = {
  intent?: string;
  intakeType?: string;
  title?: string;
  safeSummary?: string;
  previewKind?: string;
  previewId?: string;
  baseUrl?: string;
};

export type McpHandoffResult = McpPreviewBoundary & {
  ok: true;
  kind: "web_app_handoff_link";
  handoff: import("@conclave-ai/workspace-preview/web-app-handoff-link").WebAppHandoffLink;
};

export function createWebAppHandoffLink(input?: McpHandoffInput): McpHandoffResult;

export const MCP_BASIC_PREVIEW_BOUNDARY: McpPreviewBoundary;

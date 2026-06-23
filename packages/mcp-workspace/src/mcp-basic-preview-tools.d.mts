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
  kind: "acceptance_map" | "stage_plan" | "agent_run_plan" | "evidence_plan";
  preview: unknown;
};

export type McpPreviewResponse = McpPreviewResult | McpPreviewError;

export function previewAcceptanceMap(input: McpPreviewInput): McpPreviewResponse;
export function previewStagePlan(input: McpPreviewInput): McpPreviewResponse;
export function previewAgentRunPlan(input: McpPreviewInput): McpPreviewResponse;
export function previewEvidencePlan(input: McpPreviewInput): McpPreviewResponse;

export const MCP_BASIC_PREVIEW_BOUNDARY: McpPreviewBoundary;

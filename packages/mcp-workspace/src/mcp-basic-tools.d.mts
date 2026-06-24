// Type declarations for mcp-basic-tools.mjs (Stage 135).

export type McpBasicToolName =
  | "preview_acceptance_map"
  | "preview_stage_plan"
  | "preview_agent_run_plan"
  | "preview_evidence_plan"
  | "preview_acceptance_graph_summary"
  | "preview_recurring_blockers"
  | "preview_agent_tool_memory"
  | "preview_template_signals"
  | "create_web_app_handoff_link";

export type McpBasicToolRisk = "low";

export type McpBasicToolDefinition = {
  name: McpBasicToolName;
  purpose: string;
  category: "preview" | "handoff";
  risk: McpBasicToolRisk;
  mutatesState: false;
  requiresPayment: false;
  usesHostedExecution: false;
  requiresConfirmation: false;
  webAppGated: false;
};

export const MCP_BASIC_TOOL_DEFINITIONS: McpBasicToolDefinition[];
export const MCP_BASIC_PROHIBITED_VERBS: string[];

export function listMcpBasicToolDefinitions(): McpBasicToolDefinition[];
export function getMcpBasicToolDefinition(name: string): McpBasicToolDefinition | null;

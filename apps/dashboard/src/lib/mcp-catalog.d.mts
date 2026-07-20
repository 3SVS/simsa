export interface McpTool {
  id: string;
  label: string;
  /** why a non-dev needs this, one plain sentence */
  purpose: string;
  /** the "we never see your token" reassurance */
  authNote: string;
  /** the MCP server name to register it under */
  mcpName: string;
  /** the official remote MCP server URL (agent-agnostic, stable) */
  serverUrl: string;
  docsUrl?: string;
}

export declare const MCP_CATALOG: McpTool[];

export declare function mcpToolById(id: string, locale?: "en" | "ko"): McpTool | null;

export declare function detectMcpTools(locale?: "en" | "ko"): McpTool[];

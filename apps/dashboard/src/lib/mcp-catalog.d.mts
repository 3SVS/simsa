export interface McpTool {
  id: string;
  label: string;
  /** why a non-dev needs this, one plain sentence */
  purpose: string;
  /** how to connect it once, in their editor */
  connectHint: string;
  /** the "we never see your token" reassurance */
  authNote: string;
  /** the exact CLI command the user pastes to connect the tool (Claude Code) */
  connectCommand: string;
  /** the one-time login step after running connectCommand */
  authStep: string;
  docsUrl?: string;
}

export declare const MCP_CATALOG: McpTool[];

export declare function mcpToolById(id: string): McpTool | null;

export declare function detectMcpTools(): McpTool[];

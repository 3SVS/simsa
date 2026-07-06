export type McpSetupStyle = "command" | "settings";

export interface DevAgent {
  id: string;
  label: string;
  mcpStyle: McpSetupStyle;
}

export declare const DEV_AGENTS: DevAgent[];

export declare function agentById(id: string): DevAgent | null;

export declare function agentLabel(id: string): string;

export declare function primaryAgentForTarget(target: string): string;

export declare function buildClaudeMcpAddCommand(mcpName: string, serverUrl: string): string;

export interface McpConnectResolution {
  style: McpSetupStyle;
  agentLabel: string;
  command?: string;
  serverUrl?: string;
}

export declare function resolveMcpConnect(
  agentId: string,
  tool: { mcpName: string; serverUrl: string },
): McpConnectResolution;

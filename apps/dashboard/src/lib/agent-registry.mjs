/**
 * agent-registry.mjs
 *
 * Single source of truth for the coding agents the user can target from the
 * builder pack. The pack's prompt file + all "connect an MCP" instructions must
 * follow the agent the user picked at the start — a Codex user should never be
 * told to run a Claude Code command.
 *
 * MCP setup differs per agent, and only Claude Code's exact CLI command is
 * verified (2026-07). For agents whose exact command we can't verify, we give
 * the STABLE fact — the MCP server URL — and tell the user to add it in that
 * agent's own MCP settings, rather than shipping a wrong command.
 *
 * Pure, no I/O. UI chrome (the sentence wrappers) is i18n'd in the panel; this
 * module returns the structural pieces (label, command string, server url).
 */

/**
 * @typedef {"command" | "settings"} McpSetupStyle
 * @typedef {Object} DevAgent
 * @property {string} id                 // matches the export target id
 * @property {string} label              // brand name, not translated
 * @property {McpSetupStyle} mcpStyle    // "command" = a verified CLI add command; "settings" = add the server URL in-app
 */

/** @type {DevAgent[]} */
export const DEV_AGENTS = [
  { id: "claude_code", label: "Claude Code", mcpStyle: "command" },
  { id: "codex", label: "Codex", mcpStyle: "settings" },
];

/**
 * @param {string} id
 * @returns {DevAgent | null}
 */
export function agentById(id) {
  return DEV_AGENTS.find((a) => a.id === id) ?? null;
}

/**
 * Brand label for an agent id, falling back to the id itself.
 * @param {string} id
 * @returns {string}
 */
export function agentLabel(id) {
  return agentById(id)?.label ?? id;
}

/**
 * The builder-pack target is claude_code | codex | both. The MCP connect
 * instructions need a single concrete agent — for "both" we show Claude Code's
 * (the most common) and note the other in the UI.
 * @param {string} target
 * @returns {string} an agent id
 */
export function primaryAgentForTarget(target) {
  return target === "codex" ? "codex" : "claude_code";
}

/**
 * The exact Claude Code CLI command to add a remote MCP server (verified 2026-07:
 * `claude mcp add --transport http <name> <url>`, then `/mcp` to authenticate).
 * @param {string} mcpName
 * @param {string} serverUrl
 * @returns {string}
 */
export function buildClaudeMcpAddCommand(mcpName, serverUrl) {
  return `claude mcp add --transport http ${mcpName} ${serverUrl}`;
}

/**
 * Resolve how a given agent connects a given MCP server. Returns EITHER a
 * copy-paste `command` (Claude Code) OR a `serverUrl` to add in the agent's
 * settings (everyone else). The panel wraps this with i18n'd, agent-labelled
 * sentences.
 *
 * @param {string} agentId
 * @param {{ mcpName: string, serverUrl: string }} tool
 * @returns {{ style: McpSetupStyle, agentLabel: string, command?: string, serverUrl?: string }}
 */
export function resolveMcpConnect(agentId, tool) {
  const agent = agentById(agentId);
  const label = agent?.label ?? "개발 AI";
  if (agent?.mcpStyle === "command") {
    return { style: "command", agentLabel: label, command: buildClaudeMcpAddCommand(tool.mcpName, tool.serverUrl) };
  }
  return { style: "settings", agentLabel: label, serverUrl: tool.serverUrl };
}

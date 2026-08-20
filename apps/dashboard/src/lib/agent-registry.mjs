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
  // 스택 불가지 P3 (§3-4, D-4): 두 종으로 닫혀 있던 목록 확장. 정확한 CLI
  // 명령이 검증되지 않은 에이전트는 settings 스타일(안전 강등 — 서버 URL을
  // 그 에이전트의 MCP 설정에 추가)로만 안내한다.
  { id: "cursor", label: "Cursor", mcpStyle: "settings" },
  { id: "windsurf", label: "Windsurf", mcpStyle: "settings" },
  { id: "gemini_cli", label: "Gemini CLI", mcpStyle: "settings" },
];
// 목록 밖 도구도 배제하지 않는다(D-3/D-4): resolveMcpConnect는 미지 id에
// settings 스타일(서버 URL을 그 도구의 MCP 설정에 추가)로 안전 강등한다.
// "기타" 칩 UI는 MCP 패널 개편(§3-3)과 함께 붙인다.

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
 * 스택 불가지 P3 (§3-5): builtWith 답 → 수리팩(fix pack) 타깃. 웹 빌더 도구면
 * web_builder(채팅 프롬프트 1장), codex면 codex, 검증된 CLI 계열이면
 * claude_code. 미지/미응답이면 undefined — 서버 기본(both, CLI 양쪽 파일)을
 * 유지해 종전 동작 무회귀.
 * @param {string[] | undefined} builtWithTools
 * @returns {"web_builder" | "codex" | "claude_code" | undefined}
 */
export function fixBriefTargetForBuiltWith(builtWithTools) {
  for (const tool of builtWithTools ?? []) {
    if (tool === "lovable" || tool === "replit" || tool === "v0" || tool === "bolt") return "web_builder";
    if (tool === "codex") return "codex";
    if (tool === "claude-code" || tool === "cursor" || tool === "windsurf") return "claude_code";
  }
  return undefined;
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

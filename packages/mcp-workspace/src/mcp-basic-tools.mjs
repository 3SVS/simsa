// Stage 135 — MCP Basic tool registry skeleton.
//
// Pure metadata for the planned free MCP Basic tools (Stage 133 boundary). This
// is a REGISTRY ONLY — no tool execution, no server wiring, no network, no
// mutation. Every Basic tool is read/preview/handoff, low-risk, mutation-free,
// payment-free, and uses no hosted execution. Runtime implementation arrives in
// Stages 136~139.

/** @type {import("./mcp-basic-tools.d.mts").McpBasicToolDefinition[]} */
export const MCP_BASIC_TOOL_DEFINITIONS = [
  {
    name: "preview_acceptance_map",
    purpose: "Preview the acceptance map derived from an intake input.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_stage_plan",
    purpose: "Preview the staged acceptance/review plan for an intake input.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_agent_run_plan",
    purpose: "Preview the role-based agent run plan derived from the stage plan.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_evidence_plan",
    purpose: "Preview the evidence expectations for the acceptance items.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_acceptance_graph_summary",
    purpose: "Preview the derived acceptance graph summary (nodes/edges/signals).",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_recurring_blockers",
    purpose: "Preview recurring blocker signals derived from the workflow.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_agent_tool_memory",
    purpose: "Preview per-workflow agent/tool recommendation memory.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "preview_template_signals",
    purpose: "Preview template/pattern effectiveness signals for the workflow.",
    category: "preview",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
  {
    name: "create_web_app_handoff_link",
    purpose: "Build a safe-context handoff link to open/save the workflow in the Simsa Web App.",
    category: "handoff",
    risk: "low",
    mutatesState: false,
    requiresPayment: false,
    usesHostedExecution: false,
    requiresConfirmation: false,
    webAppGated: false,
  },
];

/**
 * Action verbs that must never be the LEADING segment of a free Basic tool name
 * (the action verb). A free Basic tool only previews or builds a link — it must
 * not run/execute/post/deploy/etc. (Nouns like "run" inside "agent_run_plan" are
 * fine; only the leading verb is checked — e.g. "run_pr_review" is rejected.)
 */
export const MCP_BASIC_PROHIBITED_VERBS = [
  "run",
  "execute",
  "post",
  "deploy",
  "billing",
  "payment",
  "secret",
  "token",
  "publish",
  "write",
];

export function listMcpBasicToolDefinitions() {
  return MCP_BASIC_TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
}

export function getMcpBasicToolDefinition(name) {
  const found = MCP_BASIC_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  return found ? { ...found } : null;
}

// Stage 136 — MCP Basic preview tool wrappers (intake set).
//
// Pure local wrappers around the shared @conclave-ai/workspace-preview helpers.
// Read/preview only: NO network, central-plane, env, mutation, file write, LLM,
// payment provider, agent execution, or PR-comment posting. Each wrapper returns
// the derived preview plus a small boundary object. Missing input returns a safe
// error object instead of throwing.
import {
  buildIntakeAcceptanceMap,
  buildIntakeStagePlan,
  buildAgentRunPlan,
  buildIntakeEvidencePlan,
  buildAcceptanceGraphDerivedView,
  buildRecurringBlockerDetectionView,
  buildAgentToolRecommendationMemoryView,
  buildTemplateEffectivenessSignalsView,
  buildWebAppHandoffLink,
} from "@conclave-ai/workspace-preview";

const BOUNDARY = {
  mutatesState: false,
  usesHostedExecution: false,
  requiresPayment: false,
  derivedPreviewOnly: true,
};

const INTAKE_TYPES = ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"];

function str(x) {
  return typeof x === "string" ? x : "";
}

/** Validate { type, rawInput }; return a safe error object or null if valid. */
function validate(input) {
  const type = str(input?.type);
  const rawInput = str(input?.rawInput);
  if (!INTAKE_TYPES.includes(type)) {
    return {
      ok: false,
      error: "invalid_type",
      message: `Provide one of: ${INTAKE_TYPES.join(", ")}.`,
      ...BOUNDARY,
    };
  }
  if (!rawInput.trim()) {
    return {
      ok: false,
      error: "missing_input",
      message: "Provide a non-empty input summary to create a preview.",
      ...BOUNDARY,
    };
  }
  return null;
}

function run(builder, kind, input) {
  const bad = validate(input);
  if (bad) return bad;
  const type = str(input.type);
  const rawInput = str(input.rawInput);
  return { ok: true, kind, preview: builder({ type, rawInput }), ...BOUNDARY };
}

/** @param {{type:string,rawInput:string}} input */
export function previewAcceptanceMap(input) {
  return run(buildIntakeAcceptanceMap, "acceptance_map", input);
}

/** @param {{type:string,rawInput:string}} input */
export function previewStagePlan(input) {
  return run(buildIntakeStagePlan, "stage_plan", input);
}

/** @param {{type:string,rawInput:string}} input */
export function previewAgentRunPlan(input) {
  return run(buildAgentRunPlan, "agent_run_plan", input);
}

/** @param {{type:string,rawInput:string}} input */
export function previewEvidencePlan(input) {
  return run(buildIntakeEvidencePlan, "evidence_plan", input);
}

// ── Snapshot-based wrappers (Stage 137) ──────────────────────────────────────
// These accept saved-workflow-like snapshots (the JSON a saved record holds).
// The underlying helpers are fully defensive, so malformed/weak input yields a
// conservative preview rather than a throw.

function asObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

/** Derived acceptance graph summary from saved-workflow-like snapshots. */
export function previewAcceptanceGraphSummary(input) {
  const i = asObj(input);
  const preview = buildAcceptanceGraphDerivedView({
    workflowRecordId: str(i.workflowRecordId) || undefined,
    title: str(i.title) || "Untitled workflow",
    sourceSummary: str(i.sourceSummary) || "MCP Basic preview",
    acceptanceMap: i.acceptanceMap,
    stagePlan: i.stagePlan,
    agentRunPlan: i.agentRunPlan,
    evidencePlan: i.evidencePlan,
    decisionOutcomePreview: i.decisionOutcomePreview,
    evolutionActionPreview: i.evolutionActionPreview,
  });
  return { ok: true, kind: "acceptance_graph_summary", preview, ...BOUNDARY };
}

/** Recurring blocker signals; derives the graph view internally if not given. */
export function previewRecurringBlockers(input) {
  const i = asObj(input);
  const preview = buildRecurringBlockerDetectionView({
    workflowRecordId: str(i.workflowRecordId) || undefined,
    title: str(i.title) || "Untitled workflow",
    sourceSummary: str(i.sourceSummary) || "MCP Basic preview",
    acceptanceGraphView: i.acceptanceGraphView,
    acceptanceMap: i.acceptanceMap,
    stagePlan: i.stagePlan,
    agentRunPlan: i.agentRunPlan,
    evidencePlan: i.evidencePlan,
    decisionOutcomePreview: i.decisionOutcomePreview,
    evolutionActionPreview: i.evolutionActionPreview,
  });
  return { ok: true, kind: "recurring_blockers", preview, ...BOUNDARY };
}

/** Per-workflow agent/tool recommendation memory from saved-workflow snapshots. */
export function previewAgentToolMemory(input) {
  const i = asObj(input);
  const preview = buildAgentToolRecommendationMemoryView({
    workflowRecordId: str(i.workflowRecordId) || undefined,
    title: str(i.title) || "Untitled workflow",
    sourceSummary: str(i.sourceSummary) || "MCP Basic preview",
    agentRunPlan: i.agentRunPlan,
    evidencePlan: i.evidencePlan,
    recurringBlockerDetectionView: i.recurringBlockerDetectionView,
  });
  return { ok: true, kind: "agent_tool_memory", preview, ...BOUNDARY };
}

/** Per-workflow template/pattern effectiveness signals from saved-workflow snapshots. */
export function previewTemplateSignals(input) {
  const i = asObj(input);
  const preview = buildTemplateEffectivenessSignalsView({
    workflowRecordId: str(i.workflowRecordId) || undefined,
    title: str(i.title) || "Untitled workflow",
    sourceSummary: str(i.sourceSummary) || "MCP Basic preview",
    acceptanceGraphView: i.acceptanceGraphView,
    recurringBlockerDetectionView: i.recurringBlockerDetectionView,
    agentToolMemoryView: i.agentToolMemoryView,
    evidencePlan: i.evidencePlan,
    stagePlan: i.stagePlan,
    decisionOutcomePreview: i.decisionOutcomePreview,
    evolutionActionPreview: i.evolutionActionPreview,
  });
  return { ok: true, kind: "template_signals", preview, ...BOUNDARY };
}

/** Build a safe-context handoff link back to the Simsa Web App. */
export function createWebAppHandoffLink(input) {
  const i = asObj(input);
  const handoff = buildWebAppHandoffLink({
    baseUrl: str(i.baseUrl) || undefined,
    intent: str(i.intent) || undefined,
    intakeType: str(i.intakeType) || undefined,
    source: "mcp_basic",
    title: str(i.title) || undefined,
    safeSummary: str(i.safeSummary) || undefined,
    previewKind: str(i.previewKind) || undefined,
    previewId: str(i.previewId) || undefined,
  });
  return { ok: true, kind: "web_app_handoff_link", handoff, ...BOUNDARY };
}

export { BOUNDARY as MCP_BASIC_PREVIEW_BOUNDARY };

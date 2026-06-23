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

export { BOUNDARY as MCP_BASIC_PREVIEW_BOUNDARY };

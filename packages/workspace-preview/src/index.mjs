// @conclave-ai/workspace-preview — public entry.
//
// Pure deterministic preview helpers shared by the dashboard and MCP Basic.
// Stage 136 moved the intake helpers here. Stages 137~138 add the remaining
// derived-signal helpers. Subpath exports (e.g. "@conclave-ai/workspace-preview/
// intake-acceptance-map") are also available.
export {
  WORKSPACE_PREVIEW_PACKAGE,
  WORKSPACE_PREVIEW_SAFETY_RULES,
  getWorkspacePreviewSafetySummary,
} from "./safety.mjs";

export * from "./intake.mjs";
export * from "./intake-prd.mjs";
export * from "./intake-url.mjs";
export * from "./intake-github-repo.mjs";
export * from "./intake-ai-built-app.mjs";
export * from "./intake-acceptance-map.mjs";
export * from "./intake-stage-plan.mjs";
export * from "./intake-agent-run-plan.mjs";
export * from "./intake-evidence-plan.mjs";

// @simsa/workspace-preview — public entry.
//
// Pure deterministic preview helpers shared by the dashboard and MCP Basic.
// Stage 136 moved the intake helpers here. Stages 137~138 add the remaining
// derived-signal helpers. Subpath exports (e.g. "@simsa/workspace-preview/
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
export * from "./acceptance-graph-derived.mjs";
export * from "./recurring-blocker-detection.mjs";
export * from "./intake-benchmark-handoff.mjs";
export * from "./intake-decision-outcome-link.mjs";
export * from "./intake-evolution-action-preview.mjs";
export * from "./agent-tool-recommendation-memory.mjs";
export * from "./template-effectiveness-signals.mjs";
export * from "./web-app-handoff-link.mjs";

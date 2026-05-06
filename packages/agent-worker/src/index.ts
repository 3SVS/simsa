export { ClaudeWorker, WORKER_SYSTEM_PROMPT } from "./worker.js";
export type { ClaudeWorkerOptions } from "./worker.js";
export { buildWorkerPrompt, buildCacheablePrefix } from "./prompts.js";
export {
  REWRITE_TOOL_NAME,
  REWRITE_TOOL_DESCRIPTION,
  REWRITE_TOOL_INPUT_SCHEMA,
  // backward-compat aliases
  PATCH_TOOL_NAME,
  PATCH_TOOL_DESCRIPTION,
  PATCH_TOOL_INPUT_SCHEMA,
} from "./patch-tool.js";
export { parseRewriteToolUse, parsePatchToolUse, looksLikeUnifiedDiff, WorkerParseError } from "./patch-parser.js";
export { actualCost, estimateCallCost, PRICING } from "./pricing.js";
export type { ModelPricing, UsageBreakdown } from "./pricing.js";
export type { AnthropicLike, AnthropicCreateParams, AnthropicResponse } from "./anthropic-types.js";
export type { WorkerContext, WorkerOutcome, FileSnapshot, FileRewrite, WorkerRejectedAttempt } from "./types.js";

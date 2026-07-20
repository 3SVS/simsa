export { ClaudeWorker, WORKER_SYSTEM_PROMPT } from "./worker.js";
export type { ClaudeWorkerOptions } from "./worker.js";
export {
  buildWorkerPrompt,
  buildCacheablePrefix,
  buildEditWorkerPrompt,
  buildEditCacheablePrefix,
  EDIT_WORKER_SYSTEM_PROMPT,
} from "./prompts.js";
export {
  REWRITE_TOOL_NAME,
  REWRITE_TOOL_DESCRIPTION,
  REWRITE_TOOL_INPUT_SCHEMA,
  EDIT_TOOL_NAME,
  EDIT_TOOL_DESCRIPTION,
  EDIT_TOOL_INPUT_SCHEMA,
  // backward-compat aliases
  PATCH_TOOL_NAME,
  PATCH_TOOL_DESCRIPTION,
  PATCH_TOOL_INPUT_SCHEMA,
} from "./patch-tool.js";
export {
  parseRewriteToolUse,
  parseEditToolUse,
  parsePatchToolUse,
  looksLikeUnifiedDiff,
  WorkerParseError,
} from "./patch-parser.js";
export { actualCost, estimateCallCost, PRICING } from "./pricing.js";
export type { ModelPricing, UsageBreakdown } from "./pricing.js";
export type { AnthropicLike, AnthropicCreateParams, AnthropicResponse } from "./anthropic-types.js";
export type {
  WorkerContext,
  WorkerOutcome,
  FileSnapshot,
  FileRewrite,
  WorkerRejectedAttempt,
  FileExcerpt,
  ExcerptRegion,
  FileEdit,
  EditWorkerContext,
  EditWorkerOutcome,
} from "./types.js";

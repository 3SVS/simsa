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
export {
  withOpenAiFallback,
  callOpenAiAsAnthropic,
  fallbackOutputBudget,
  OPENAI_FALLBACK_MODEL,
} from "./openai-fallback.js";
export type { FallbackOptions } from "./openai-fallback.js";
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

// SI 티어 Train B — B4: 빌드 에이전트(다중 턴 tool_use 루프 + 정책).
export { runBuildLoop } from "./build-loop.js";
export type { BuildLoopOptions, BuildLoopOutcome, BuildTask, BuildToolExecutor, CommandResult, DeniedCall } from "./build-loop.js";
export { BUILD_TOOLS, BUILD_SYSTEM_PROMPT } from "./build-tools.js";
export {
  COMMAND_ALLOWLIST, DENIED_SUBCOMMANDS, DEPLOY_CLIS, ALLOWED_ENV_KEYS, BUILD_LIMITS,
  decideCommand, decidePath, findSecretLike, filterEnv,
} from "./build-policy.js";
export type { CommandDecision, PathDecision } from "./build-policy.js";
export type { AnthropicMessage, AnthropicContentBlock } from "./anthropic-types.js";

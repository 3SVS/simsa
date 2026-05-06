import type { AnthropicResponse } from "./anthropic-types.js";
import { REWRITE_TOOL_NAME } from "./patch-tool.js";
import type { WorkerOutcome } from "./types.js";

export class WorkerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerParseError";
  }
}

/**
 * Parse the Claude tool_use response into a WorkerOutcome.
 *
 * Validation rules:
 * - exactly one `submit_rewrite` tool_use block must be present
 * - `commitMessage` is a non-empty string
 * - `rewrites` is an array of `{path: string, content: string}` objects
 *   (may be empty when the worker gives up — we preserve that signal)
 */
export function parseRewriteToolUse(response: AnthropicResponse): Omit<WorkerOutcome, "tokensUsed" | "costUsd"> {
  const toolUse = response.content.find(
    (block): block is Extract<(typeof response.content)[number], { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === REWRITE_TOOL_NAME,
  );
  if (!toolUse) {
    throw new WorkerParseError(
      `Worker: response did not include a ${REWRITE_TOOL_NAME} tool_use block (stop_reason=${response.stop_reason ?? "?"})`,
    );
  }

  const input = toolUse.input as {
    rewrites?: unknown;
    commitMessage?: unknown;
    summary?: unknown;
  };

  if (typeof input.commitMessage !== "string" || input.commitMessage.trim().length === 0) {
    throw new WorkerParseError(`Worker: submit_rewrite.commitMessage must be a non-empty string`);
  }

  if (!Array.isArray(input.rewrites)) {
    throw new WorkerParseError(`Worker: submit_rewrite.rewrites must be an array`);
  }

  for (const entry of input.rewrites) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).path !== "string" ||
      typeof (entry as Record<string, unknown>).content !== "string"
    ) {
      throw new WorkerParseError(
        `Worker: submit_rewrite.rewrites entries must be objects with string path and content fields`,
      );
    }
  }

  const rewrites = (input.rewrites as Array<{ path: string; content: string }>).map((r) => ({
    path: r.path.trim(),
    content: r.content,
  })).filter((r) => r.path.length > 0);

  return {
    rewrites,
    message: (input.commitMessage as string).trim(),
    appliedFiles: rewrites.map((r) => r.path),
  };
}

// Backward-compat alias — callers that imported parsePatchToolUse will
// get the new implementation transparently.
export const parsePatchToolUse = parseRewriteToolUse;

/** @deprecated No longer meaningful with full-file rewrites. Always returns false. */
export function looksLikeUnifiedDiff(_patch: string): boolean {
  return false;
}

/**
 * Tool-use schema that forces Claude to emit full file rewrites.
 * Mirrors the single-tool pattern used by agent-claude's `submit_review`
 * — one tool, `tool_choice: { type: "tool", name }` — so we get reliable
 * structured output without any regex scraping of free-form text.
 *
 * v0.14: replaced submit_patch (unified diff) with submit_rewrite
 * (complete file contents). LLMs cannot reliably produce correct unified
 * diffs (off-by-N hunk headers, hallucinated context lines), but they
 * CAN faithfully reproduce a full file with targeted edits applied.
 * The caller writes the content directly to disk — no `git apply` needed.
 */
export const REWRITE_TOOL_NAME = "submit_rewrite";

export const REWRITE_TOOL_DESCRIPTION =
  "Submit complete new file contents for every file that needs changing to fix the council blockers. Call this exactly once at the end of your analysis.";

export const REWRITE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    rewrites: {
      type: "array",
      description:
        "One entry per file that needs changing. Each entry replaces the ENTIRE file on disk — include every line, not just the changed parts.",
      items: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Repo-relative file path, forward slashes (e.g. `src/Button.tsx`). Must be an existing file shown in the snapshots.",
          },
          content: {
            type: "string",
            description:
              "Complete new file contents. Replaces the file wholesale — copy every unchanged line verbatim, then make targeted edits for the blockers.",
          },
        },
        required: ["path", "content"],
      },
    },
    commitMessage: {
      type: "string",
      description:
        "Single-line commit subject (≤ 72 chars), conventional-commit style where it fits (e.g. `fix(auth): ...`). This becomes the actual git commit message.",
    },
    summary: {
      type: "string",
      description:
        "One-paragraph rationale: which blockers this addresses, which (if any) it could not and why, and any follow-up the reviewer should know about.",
    },
  },
  required: ["rewrites", "commitMessage", "summary"],
} as const;

// Backward-compat aliases so existing consumers that import the old names
// don't break until they migrate.
export const PATCH_TOOL_NAME = REWRITE_TOOL_NAME;
export const PATCH_TOOL_DESCRIPTION = REWRITE_TOOL_DESCRIPTION;
export const PATCH_TOOL_INPUT_SCHEMA = REWRITE_TOOL_INPUT_SCHEMA;

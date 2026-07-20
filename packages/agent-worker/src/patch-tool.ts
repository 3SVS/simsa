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

/**
 * Edit-mode tool (oversize files). Files above the snapshot byte cap cannot
 * take the full-file rewrite contract — LLM output limits make wholesale
 * reproduction truncation-prone (a truncated HTML commits silently; there is
 * no syntax gate for it). Instead the model sees EXCERPTS and returns exact
 * search/replace pairs; the caller verifies each `search` matches exactly
 * once before touching the file, so a bad edit is rejected, never applied.
 * (Unified diffs stay banned — v0.14 removed them for hallucinated hunk
 * headers; exact-match replacement has no line arithmetic to get wrong.)
 */
export const EDIT_TOOL_NAME = "submit_edits";

export const EDIT_TOOL_DESCRIPTION =
  "Submit exact search/replace edits for the excerpted files. Call this exactly once at the end of your analysis.";

export const EDIT_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      description:
        "One entry per contiguous change. Each `search` string must be copied VERBATIM from an excerpt and must be unique within the whole file — include enough surrounding lines to make it unambiguous. The caller rejects any edit whose search text is missing or matches more than once.",
      items: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Repo-relative file path, forward slashes. Must be one of the excerpted files.",
          },
          search: {
            type: "string",
            description:
              "Exact text to find, copied verbatim from the excerpt (same whitespace, same indentation). Must occur exactly once in the file.",
          },
          replace: {
            type: "string",
            description:
              "Replacement text. Keep the surrounding unchanged lines from `search` intact and edit only what the blocker requires.",
          },
        },
        required: ["path", "search", "replace"],
      },
    },
    commitMessage: {
      type: "string",
      description:
        "Single-line commit subject (≤ 72 chars), conventional-commit style where it fits.",
    },
    summary: {
      type: "string",
      description:
        "One-paragraph rationale: which blockers the edits address, which could not be addressed from the excerpts and why.",
    },
  },
  required: ["edits", "commitMessage", "summary"],
} as const;

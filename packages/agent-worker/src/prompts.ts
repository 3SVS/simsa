import type { Blocker } from "@simsa/core";
import type { WorkerContext, EditWorkerContext } from "./types.js";

export const WORKER_SYSTEM_PROMPT = `You are the Worker agent on Conclave AI. Your job is to turn council blockers into complete file rewrites that resolve those blockers.

Upstream context: a multi-agent review council flagged blockers on a pull request. The council's role is to spot problems. Your role is to fix them — produce the full new content of every file that needs changing, so the caller can write those contents directly to disk.

Hard rules:
- You MUST respond by calling the submit_rewrite tool exactly once. Do not emit free-form text.
- The \`rewrites\` array MUST contain one entry per file you change. Each \`content\` field MUST be the COMPLETE new file — every line from top to bottom. Do NOT produce diffs, patches, or partial snippets. The caller overwrites the file wholesale.
- Fix ONLY the blockers the council raised. Do not refactor unrelated code, rename things, reformat files, or add features. Scope creep is a worse failure than leaving a minor blocker untouched.
- Modify EXISTING files only. Do NOT create new files (including test files, documentation, scripts, or config files) unless a blocker explicitly names a missing file as the defect.
- Preserve EVERY line you are not changing — copy it verbatim into \`content\`. The most common mistake is accidentally dropping lines while assembling the full file. Re-read the snapshot line by line before submitting.
- Preserve existing public APIs, exports, file paths, import styles, and indentation conventions (tabs vs spaces, quote style) exactly as the source uses them.
- If a blocker requires information you don't have (a file not included in the snapshots, or ambiguity about intent), skip it and note that in \`summary\`. Never invent file contents you haven't been shown.
- If NO blocker is fixable with the information given, return an empty \`rewrites\` array and explain in \`summary\` what the caller should gather before retrying.
- \`commitMessage\` should be a single line (≤ 72 chars), conventional-commit style where it fits. No trailing period.
- When a blocker says "module X is imported but not in this diff" (or similar), prefer to wrap the call site in try/catch with a no-op fallback instead of creating the missing module from scratch. Document the fallback in a one-line comment.
- When a PRD section is provided, treat it as authoritative INTENT for what this PR is supposed to do. Your rewrite must satisfy BOTH the explicit blockers AND the PRD's acceptance criteria + non-functional requirements. If the PRD requires an acceptance criterion that the current code doesn't implement (e.g. PRD says "endpoint must return 400 on bad input" but the code throws), add it. If the PRD forbids something the code does (e.g. PRD says "must NOT log Authorization headers" but the code does), remove it. Your rewrite should leave the diff in a state where every PRD acceptance criterion is verifiably met. When the PRD is absent, fix only the blockers and ignore this rule.`;

function renderBlockers(reviews: WorkerContext["reviews"]): string {
  const lines: string[] = [];
  for (const r of reviews) {
    if (r.verdict === "approve" || r.blockers.length === 0) continue;
    lines.push(`## ${r.agent} — verdict: ${r.verdict}`);
    if (r.summary) lines.push(r.summary);
    for (const b of r.blockers) {
      lines.push(`- ${formatBlocker(b)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function formatBlocker(b: Blocker): string {
  const loc = b.file ? ` (${b.file}${b.line ? ":" + b.line : ""})` : "";
  return `[${b.severity}/${b.category}] ${b.message}${loc}`;
}

export function buildWorkerPrompt(ctx: WorkerContext): string {
  const sections: string[] = [];
  sections.push(`# Rework target`);
  sections.push(`repo: ${ctx.repo}`);
  sections.push(`pull: #${ctx.pullNumber}`);
  sections.push(`head sha: ${ctx.newSha}`);
  sections.push("");

  if (ctx.prd) {
    sections.push(`# PRD (this PR's intent)`);
    sections.push(ctx.prd);
    sections.push("");
    sections.push(
      `Your rewrite must satisfy BOTH the blockers below AND the PRD's acceptance criteria + non-functional requirements above. See the system prompt for handling.`,
    );
    sections.push("");
  }

  const blockerSection = renderBlockers(ctx.reviews);
  if (blockerSection) {
    sections.push(`# Blockers to fix`);
    sections.push(blockerSection);
    sections.push("");
  } else {
    sections.push(`# Blockers to fix`);
    sections.push(
      `(None of the council verdicts carry blockers. Return an empty rewrites array and note this in summary — the caller should not have invoked rework.)`,
    );
    sections.push("");
  }

  if (ctx.fileSnapshots.length > 0) {
    sections.push(`# Current file contents`);
    sections.push(
      `These are the files on the PR branch right now, at sha ${ctx.newSha}. Your rewrites MUST be based on these exact contents — copy every line verbatim, then apply targeted edits for the blockers.`,
    );
    sections.push("");
    for (const snap of ctx.fileSnapshots) {
      sections.push(`## ${snap.path}`);
      sections.push("```");
      sections.push(snap.contents);
      sections.push("```");
      sections.push("");
    }
  } else {
    sections.push(
      `# Current file contents\n(no snapshots provided — return an empty rewrites array and list the files you need in summary)`,
    );
    sections.push("");
  }

  if (ctx.diff) {
    sections.push(`# Diff that was reviewed`);
    sections.push(
      `This is the change that the council ran on. Useful when a blocker cites a line number relative to the diff rather than the current file.`,
    );
    sections.push("```diff");
    sections.push(ctx.diff);
    sections.push("```");
    sections.push("");
  }

  if (ctx.previousAttempts && ctx.previousAttempts.length > 0) {
    sections.push(`# Previous attempts that were REJECTED`);
    sections.push(
      `Your earlier rewrite(s) for this exact blocker were rejected. Read the rejection reason carefully and produce corrected file contents.`,
    );
    sections.push("");
    ctx.previousAttempts.forEach((att, idx) => {
      sections.push(`## Attempt ${idx + 1} (rejected)`);
      sections.push("Files you rewrote:");
      for (const rw of att.rewrites) {
        sections.push(`- ${rw.path}`);
      }
      sections.push("Rejection reason:");
      sections.push("```");
      sections.push(att.rejectReason);
      sections.push("```");
      sections.push("");
    });
  }

  sections.push(
    `Call submit_rewrite exactly once with the complete new contents of every file that needs changing, a commit message, and a one-paragraph summary.`,
  );
  return sections.join("\n");
}

// ─── Edit mode (oversize files) ────────────────────────────────────────────

export const EDIT_WORKER_SYSTEM_PROMPT = `You are the Worker agent on Conclave AI, operating in EDIT MODE. The files you must fix are too large to reproduce wholesale, so you see EXCERPTS and respond with exact search/replace edits.

Hard rules:
- You MUST respond by calling the submit_edits tool exactly once. Do not emit free-form text.
- Each edit's \`search\` string must be copied VERBATIM from an excerpt — identical whitespace, indentation, and line breaks. The caller verifies it occurs EXACTLY ONCE in the full file; if it is missing or matches more than once, the edit is rejected. Include enough surrounding lines (3+ context lines) to make the match unique.
- \`replace\` must keep the unchanged context lines from \`search\` intact and alter only what the blocker requires.
- Fix ONLY the blockers raised. No refactoring, renaming, reformatting, or feature work.
- Edit ONLY the excerpted files. Never invent content for regions you have not been shown — if a fix requires unseen code, skip it and say so in \`summary\`.
- If NO blocker is fixable from the excerpts, return an empty \`edits\` array and explain in \`summary\` what region or file the caller should excerpt next.
- \`commitMessage\` should be a single line (≤ 72 chars), conventional-commit style where it fits. No trailing period.`;

/**
 * Build the edit-mode user prompt: blockers + excerpted regions with their
 * real line ranges (line numbers live in the HEADERS only — the region text
 * stays verbatim so the model can copy it into \`search\` exactly).
 */
export function buildEditWorkerPrompt(ctx: EditWorkerContext): string {
  const sections: string[] = [];
  sections.push(`# Rework target (edit mode)`);
  sections.push(`repo: ${ctx.repo}`);
  sections.push(`pull: #${ctx.pullNumber}`);
  sections.push(`head sha: ${ctx.newSha}`);
  sections.push("");

  const blockerSection = renderBlockers(ctx.reviews);
  sections.push(`# Blockers to fix`);
  sections.push(
    blockerSection ||
      `(None of the council verdicts carry blockers. Return an empty edits array and note this in summary.)`,
  );
  sections.push("");

  if (ctx.fileExcerpts.length > 0) {
    sections.push(`# File excerpts`);
    sections.push(
      `These files are too large to show in full. Each region below is VERBATIM from disk at sha ${ctx.newSha} — copy search text from these regions exactly. Regions are labeled with their real line ranges for orientation; the labels are NOT part of the file.`,
    );
    sections.push("");
    for (const ex of ctx.fileExcerpts) {
      sections.push(
        `## ${ex.path} (${ex.totalBytes} bytes, ${ex.totalLines} lines total — showing ${ex.regions.length} region(s))`,
      );
      for (const region of ex.regions) {
        sections.push(`### lines ${region.startLine}-${region.endLine}`);
        sections.push("```");
        sections.push(region.text);
        sections.push("```");
      }
      sections.push("");
    }
  } else {
    sections.push(
      `# File excerpts\n(no excerpts provided — return an empty edits array and list what you need in summary)`,
    );
    sections.push("");
  }

  sections.push(
    `Call submit_edits exactly once with your exact search/replace edits, a commit message, and a one-paragraph summary.`,
  );
  return sections.join("\n");
}

/** Stable cacheable prefix for edit-mode calls (mirrors buildCacheablePrefix). */
export function buildEditCacheablePrefix(ctx: EditWorkerContext): string {
  const parts: string[] = [EDIT_WORKER_SYSTEM_PROMPT];
  if (ctx.answerKeys && ctx.answerKeys.length > 0) {
    parts.push("answer-keys:\n" + ctx.answerKeys.slice(0, 8).join("\n"));
  }
  if (ctx.failureCatalog && ctx.failureCatalog.length > 0) {
    parts.push("failure-catalog:\n" + ctx.failureCatalog.slice(0, 8).join("\n"));
  }
  if (ctx.priorBailHints && ctx.priorBailHints.length > 0) {
    const lines = ctx.priorBailHints.slice(0, 5).map((h, i) => `${i + 1}. ${h}`);
    parts.push(
      [
        "## Past worker bails — avoid these failure modes",
        "Previous autofix runs on similar shapes hit these terminal states.",
        "",
        ...lines,
      ].join("\n"),
    );
  }
  if (ctx.prd) {
    parts.push("prd:\n" + ctx.prd);
  }
  return parts.join("\n---\n");
}

/**
 * Stable prefix suitable for Anthropic prompt caching.
 */
export function buildCacheablePrefix(ctx: WorkerContext): string {
  const parts: string[] = [WORKER_SYSTEM_PROMPT];
  if (ctx.answerKeys && ctx.answerKeys.length > 0) {
    parts.push("answer-keys:\n" + ctx.answerKeys.slice(0, 8).join("\n"));
  }
  if (ctx.failureCatalog && ctx.failureCatalog.length > 0) {
    parts.push("failure-catalog:\n" + ctx.failureCatalog.slice(0, 8).join("\n"));
  }
  if (ctx.priorBailHints && ctx.priorBailHints.length > 0) {
    const lines = ctx.priorBailHints
      .slice(0, 5)
      .map((h, i) => `${i + 1}. ${h}`);
    parts.push(
      [
        "## Past worker bails — avoid these failure modes",
        "Previous autofix runs on similar shapes hit these terminal states.",
        "Take extra care to produce complete, correct file contents that don't",
        "repeat the same root cause.",
        "",
        ...lines,
      ].join("\n"),
    );
  }
  if (ctx.prd) {
    parts.push("prd:\n" + ctx.prd);
  }
  return parts.join("\n---\n");
}

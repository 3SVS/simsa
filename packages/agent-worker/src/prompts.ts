import type { Blocker } from "@conclave-ai/core";
import type { WorkerContext } from "./types.js";

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
- When a blocker says "module X is imported but not in this diff" (or similar), prefer to wrap the call site in try/catch with a no-op fallback instead of creating the missing module from scratch. Document the fallback in a one-line comment.`;

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
  return parts.join("\n---\n");
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Blocker,
  BlockerFix,
  FileRewrite,
  ReviewResult,
} from "@conclave-ai/core";
import { isFileDenied } from "@conclave-ai/core";
import type {
  ClaudeWorker,
  FileSnapshot,
  WorkerContext,
  WorkerOutcome,
} from "@conclave-ai/agent-worker";
import { classifyAnthropicError, formatClassifiedReason } from "./anthropic-error-classify.js";

export type WorkerLike = {
  work: (ctx: WorkerContext) => Promise<WorkerOutcome>;
};

export type GitLike = (
  bin: string,
  args: readonly string[],
  opts?: { cwd?: string; input?: string; timeout?: number },
) => Promise<{ stdout: string; stderr?: string; code?: number }>;

export type FileReader = (absPath: string) => Promise<string>;

export interface AutofixWorkerDeps {
  worker: WorkerLike;
  /** Read file content for the snapshot attached to the worker prompt. */
  readFile?: FileReader;
  /** Current working directory (the PR branch checkout). */
  cwd: string;
  /** Override deny-list (defaults to DEFAULT_AUTOFIX_DENY_PATTERNS). */
  denyPatterns?: readonly string[];
  /** stderr sink for progress logs. Default: process.stderr. */
  stderr?: (s: string) => void;
}

export interface BuildPerBlockerContextInput {
  repo: string;
  pullNumber: number;
  newSha: string;
  diff?: string;
  answerKeys?: readonly string[];
  failureCatalog?: readonly string[];
  /** The agent that raised this specific blocker (for prompt context). */
  agent: string;
  blocker: Blocker;
  /**
   * Optional build-failure tail from the previous iteration. When set,
   * we append it to the WorkerContext.reviews[0].summary so the worker
   * sees what broke.
   */
  buildErrorTail?: string;
  /**
   * H3 #13 — auto-tuned hint lines from past `rework-loop-failure`
   * catalog entries. The worker prompt builder splices them into the
   * cache-prefix so the worker sees concrete prior failure shapes.
   */
  priorBailHints?: readonly string[];
}

/**
 * Build a minimal `WorkerContext` focused on a SINGLE blocker.
 */
export function buildPerBlockerContext(
  input: BuildPerBlockerContextInput,
  fileSnapshots: FileSnapshot[],
): WorkerContext {
  const review: ReviewResult = {
    agent: input.agent,
    verdict: "rework",
    summary: input.buildErrorTail
      ? `Previous autofix attempt built but the verification step failed. Do NOT repeat the same edits; adjust based on the failure tail below.\n\n--- build/test failure tail ---\n${input.buildErrorTail}`
      : `Autofix target — fix ONLY the single blocker below.`,
    blockers: [input.blocker],
  };
  const ctx: WorkerContext = {
    repo: input.repo,
    pullNumber: input.pullNumber,
    newSha: input.newSha,
    reviews: [review],
    fileSnapshots,
  };
  if (input.diff !== undefined) ctx.diff = input.diff;
  if (input.answerKeys && input.answerKeys.length > 0) ctx.answerKeys = input.answerKeys;
  if (input.failureCatalog && input.failureCatalog.length > 0) ctx.failureCatalog = input.failureCatalog;
  if (input.priorBailHints && input.priorBailHints.length > 0) ctx.priorBailHints = input.priorBailHints;
  return ctx;
}

/**
 * Run the worker against a single blocker and return a `BlockerFix` entry.
 *
 * v0.14: replaced the patch-validate + git-apply retry loop with a direct
 * full-file-rewrite approach. The worker returns complete file contents;
 * the caller writes them to disk. No `git apply --check` validation or
 * GNU patch fallback needed — apply failures are structurally impossible.
 *
 * This function is intentionally pure w.r.t. the filesystem — it only
 * reads file snapshots and calls the worker LLM. The actual writeFile +
 * git add happens in the autofix.ts apply loop.
 */
export async function runPerBlocker(
  input: BuildPerBlockerContextInput,
  deps: AutofixWorkerDeps,
): Promise<BlockerFix> {
  // Design-domain blockers — skip when there is no `file` field (visual
  // surface with no attributable source). With a `file` set, fall through
  // to the worker; it can rewrite the file to fix contrast / aria props.
  const cat = input.blocker.category?.toLowerCase() ?? "";
  const isDesignDomain =
    cat.startsWith("design") ||
    cat.startsWith("ui-") ||
    cat.startsWith("visual") ||
    cat === "contrast" ||
    cat === "accessibility" ||
    cat === "layout-regression" ||
    cat === "style-drift" ||
    cat === "cropped-text" ||
    cat === "missing-state" ||
    cat === "overflow";
  if (isDesignDomain && !input.blocker.file) {
    return {
      agent: input.agent,
      blocker: input.blocker,
      status: "skipped",
      reason: "design-domain blocker without a file — human visual judgment required",
    };
  }

  // File allowlist — never autofix secrets / env files / keys.
  if (input.blocker.file) {
    const denied = isFileDenied(input.blocker.file, deps.denyPatterns);
    if (denied) {
      return {
        agent: input.agent,
        blocker: input.blocker,
        status: "skipped",
        reason: `file "${input.blocker.file}" matches deny-list (secrets/keys/env)`,
      };
    }
  }

  // Read the snapshot of the file named in the blocker.
  const readOne = deps.readFile ?? ((p: string) => readFile(p, "utf8"));
  const fileSnapshots: FileSnapshot[] = [];
  if (input.blocker.file) {
    const rel = input.blocker.file;
    const abs = path.isAbsolute(rel) ? rel : path.join(deps.cwd, rel);
    try {
      const contents = await readOne(abs);
      fileSnapshots.push({ path: rel, contents });
    } catch {
      // Worker will still run, but with no snapshot — it may decline.
    }
  }

  const ctx = buildPerBlockerContext(input, fileSnapshots);

  let outcome: WorkerOutcome;
  try {
    outcome = await deps.worker.work(ctx);
  } catch (err) {
    const classification = classifyAnthropicError(err);
    return {
      agent: input.agent,
      blocker: input.blocker,
      status: "worker-error",
      reason: formatClassifiedReason(classification),
    };
  }

  if (!outcome.rewrites || outcome.rewrites.length === 0) {
    return {
      agent: input.agent,
      blocker: input.blocker,
      status: "worker-error",
      reason: "worker returned no file rewrites",
      costUsd: outcome.costUsd,
      tokensUsed: outcome.tokensUsed,
    };
  }

  // Deny-list check for every rewrite path the worker produced.
  for (const rw of outcome.rewrites) {
    if (isFileDenied(rw.path, deps.denyPatterns)) {
      return {
        agent: input.agent,
        blocker: input.blocker,
        status: "skipped",
        reason: `worker rewrite touches deny-listed file "${rw.path}"`,
        rewrites: outcome.rewrites,
        appliedFiles: outcome.appliedFiles,
        costUsd: outcome.costUsd,
        tokensUsed: outcome.tokensUsed,
      };
    }
  }

  return {
    agent: input.agent,
    blocker: input.blocker,
    status: "ready",
    rewrites: outcome.rewrites,
    commitMessage: outcome.message,
    appliedFiles: outcome.rewrites.map((r) => r.path),
    costUsd: outcome.costUsd,
    tokensUsed: outcome.tokensUsed,
  };
}

export type { ClaudeWorker };

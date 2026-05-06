import type { ReviewResult } from "@conclave-ai/core";
import type { FileRewrite } from "@conclave-ai/core";

/**
 * Snapshot of a file as it exists on the PR branch right now.
 * The caller (e.g. the `conclave rework` CLI) is responsible for reading
 * these from disk before invoking the worker. The worker itself stays
 * pure — no filesystem side effects — so it's easy to test and so the
 * git/commit logic lives in one place (scm-github / CLI) instead of
 * being split across the LLM layer.
 */
export interface FileSnapshot {
  path: string;
  contents: string;
}

// Re-export so callers can import FileRewrite from this package.
export type { FileRewrite };

/**
 * Feedback from a previous worker attempt that was rejected (e.g. the
 * rewrites did not fix the blocker or a build step caught a regression).
 * Kept for future retry-with-feedback loops; not currently populated by
 * the autofix CLI (v0.14 rewrite path has no apply-level retry).
 */
export interface WorkerRejectedAttempt {
  /** The rewrites the worker emitted on the previous attempt. */
  rewrites: FileRewrite[];
  /** Why the attempt was rejected — e.g. build failure tail or reviewer note. */
  rejectReason: string;
}

/** Everything the worker needs to produce file rewrites. */
export interface WorkerContext {
  repo: string;
  pullNumber: number;
  /** Head commit of the PR branch that the rewrites will be applied on top of. */
  newSha: string;
  /** Council verdicts from the review round that triggered this rework. */
  reviews: ReviewResult[];
  /** Current contents of files the reviewers flagged. */
  fileSnapshots: FileSnapshot[];
  /** The diff that was reviewed (optional — useful when blockers reference context lines). */
  diff?: string;
  answerKeys?: readonly string[];
  failureCatalog?: readonly string[];
  /**
   * Previous attempts on the SAME blocker that were rejected. Empty/undefined
   * on the first call. Reserved for future retry-with-feedback loops.
   */
  previousAttempts?: readonly WorkerRejectedAttempt[];
  /**
   * H3 #13 — auto-tuned hints synthesized from past `rework-loop-failure`
   * catalog entries (one short line each). Populated by the autofix CLI.
   */
  priorBailHints?: readonly string[];
}

/** Result of a worker invocation — ready to write to disk + commit. */
export interface WorkerOutcome {
  /**
   * Full-file rewrites produced by the worker. Each entry replaces a
   * file on the PR branch wholesale. Empty array means the worker gave up.
   */
  rewrites: FileRewrite[];
  /** Commit message subject (single line, conventional-commit style encouraged). */
  message: string;
  /** Convenience: paths of files this rewrite touches (= rewrites[*].path). */
  appliedFiles: string[];
  tokensUsed?: number;
  costUsd?: number;
}

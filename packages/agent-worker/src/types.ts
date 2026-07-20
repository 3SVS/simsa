import type { ReviewResult } from "@simsa/core";
import type { FileRewrite } from "@simsa/core";

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
  /**
   * v0.15 (Phase 3) — PRD/spec for THIS PR. When set, the worker rewrites
   * the file to satisfy BOTH the blocker and the PRD's acceptance criteria
   * + non-functional requirements. Without a PRD, the worker only fixes the
   * blocker; with a PRD, it can also add missing acceptance criteria,
   * change route paths to match spec, drop scope-creep behavior, etc.
   * Loaded by the autofix CLI from `.conclave/prd.md` or `--prd` flag.
   */
  prd?: string;
}

// ─── Edit mode (oversize files) ────────────────────────────────────────────
// Files too large for the full-file rewrite contract (LLM output limits make
// wholesale reproduction truncation-prone) are served as EXCERPTS and fixed
// via exact search/replace edits instead. The caller enforces that each
// `search` matches exactly once before applying — a failed match rejects the
// edit rather than corrupting the file.

/** One verbatim region of an oversize file, selected around evidence tokens. */
export interface ExcerptRegion {
  /** 1-based first line of the region in the real file. */
  startLine: number;
  /** 1-based last line (inclusive). */
  endLine: number;
  /** The region's text EXACTLY as it appears on disk — no line numbers mixed in. */
  text: string;
}

/** Excerpted view of a file that exceeded the snapshot byte cap. */
export interface FileExcerpt {
  path: string;
  /** Size of the full file on disk, for the model's context. */
  totalBytes: number;
  /** Total line count of the full file. */
  totalLines: number;
  regions: ExcerptRegion[];
}

/** One exact-match edit. `search` must occur EXACTLY ONCE in the target file. */
export interface FileEdit {
  path: string;
  /** Verbatim text to find (unique in the file). Copied exactly from an excerpt. */
  search: string;
  /** Replacement text. May be multi-line; empty string deletes the matched text. */
  replace: string;
}

/** Context for an edit-mode invocation (oversize files only). */
export interface EditWorkerContext {
  repo: string;
  pullNumber: number;
  newSha: string;
  reviews: ReviewResult[];
  /** Excerpted views of the oversize files the blockers point at. */
  fileExcerpts: FileExcerpt[];
  answerKeys?: readonly string[];
  failureCatalog?: readonly string[];
  priorBailHints?: readonly string[];
  prd?: string;
}

/** Result of an edit-mode invocation. Empty `edits` means the worker gave up. */
export interface EditWorkerOutcome {
  edits: FileEdit[];
  message: string;
  /** Convenience: unique paths touched by the edits. */
  appliedFiles: string[];
  tokensUsed?: number;
  costUsd?: number;
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

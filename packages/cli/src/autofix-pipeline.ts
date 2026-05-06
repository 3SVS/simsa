import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import {
  BudgetTracker,
  CircuitBreaker,
  CircuitOpenError,
  EfficiencyGate,
  FileSystemMemoryStore,
  LoopDetectedError,
  LoopGuard,
  MetricsRecorder,
  OutcomeWriter,
  dedupeBlockersAcrossAgents,
  extractPriorBailHints,
  isFuzzyDuplicate,
  summarizeAutofixPatches,
  writeReworkLoopFailure,
  type AutofixIteration,
  type AutofixResult,
  type AutofixResultStatus,
  type Blocker,
  type BlockerFix,
  type EpisodicEntry,
  type MemoryStore,
  type ReviewResult,
} from "@conclave-ai/core";
import {
  ClaudeWorker,
  type ClaudeWorkerOptions,
  type WorkerOutcome,
  type WorkerContext,
} from "@conclave-ai/agent-worker";
import { formatFinding, scanPatch, type ScanResult } from "@conclave-ai/secret-guard";
import { fetchPrState, fetchDeployStatus as defaultFetchDeployStatus, fetchPreviewUrl, type DeployStatus, type GhRunner, type PullRequestState } from "@conclave-ai/scm-github";
import { loadConfig, resolveMemoryRoot, type ConclaveConfig } from "./lib/config.js";
import { loadPrd } from "./lib/project-context.js";
import { runPerBlocker, type WorkerLike, type GitLike } from "./lib/autofix-worker.js";
import { renderBailSummary, shouldPostSummary } from "./lib/bail-summary.js";
import {
  buildTerminalReport,
  isAutonomyTerminal,
  type DeployOutcome,
} from "./lib/terminal-report.js";
import { runSpecialHandlers } from "./lib/autofix-handlers/index.js";
import { writeSolutionSidecar } from "./lib/solution-sidecar.js";
import { resolveKey } from "./lib/credentials.js";
import { buildNotifiers } from "./lib/notifier-factory.js";
import { emitProgress } from "./lib/progress-emit.js";
import type { Notifier } from "@conclave-ai/core";
import {
  verify,
  summarizeFailure,
  type BuildResult,
} from "./lib/build-verifier.js";

const execFile = promisify(execFileCallback);

export type Exec = GitLike;

export interface AutofixArgs {
  pr?: number;
  verdictFile?: string;
  budgetUsd: number;
  maxIterations: number;
  buildCmd?: string;
  testCmd?: string;
  autonomy: "l2" | "l3";
  cwd: string;
  dryRun: boolean;
  help: boolean;
  allowSecrets: string[];
  skipSecretGuard: boolean;
  /**
   * v0.10 — the rework cycle this autofix run is closing. autofix
   * embeds `[conclave-rework-cycle:<reworkCycle+1>]` in its commit
   * message so review.yml picks up the next cycle on the re-triggered
   * run. Defaults to 0 (treated as "first attempt").
   *
   * Hard-clamped to AUTONOMY_HARD_CEILING_CYCLES so a malformed
   * dispatch payload can't ratchet the marker past the safety ceiling.
   */
  reworkCycle: number;
  /**
   * v0.15 (Phase 3) — explicit PRD path. When set, the file at this path
   * is loaded and injected into the worker so it produces rewrites that
   * satisfy BOTH the blocker AND the PRD's acceptance criteria. Falls
   * back to `.conclave/prd.md` when absent.
   */
  prd?: string;
}

export const HARD_MAX_ITERATIONS = 3;
export const HARD_MAX_BUDGET_USD = 10;
export const DIFF_BUDGET_LINES = 500;
export const DEFAULT_BUDGET_USD = 3;
export const DEFAULT_MAX_ITERATIONS = 2;
/**
 * Hard ceiling that mirrors core's AUTONOMY_HARD_CEILING_CYCLES — kept
 * as a local constant rather than imported so a malformed/missing
 * cross-package version can't drift the safety bound.
 */
export const REWORK_CYCLE_HARD_CEILING = 5;

export interface AutofixDeps {
  loadConfig?: () => Promise<{ config: ConclaveConfig; configDir: string }>;
  store?: MemoryStore;
  writer?: OutcomeWriter;
  /** Injected worker (tests). */
  worker?: WorkerLike;
  /** Factory used when `worker` is not given (real ClaudeWorker). */
  workerFactory?: (opts: ClaudeWorkerOptions) => WorkerLike;
  /** gh runner. */
  gh?: GhRunner;
  /** git runner — same contract as rework.ts for consistency. */
  git?: GitLike;
  /** Read a file for the per-blocker snapshot. */
  readFile?: (absPath: string) => Promise<string>;
  /** Write a file to disk (used when applying worker rewrites). Defaults to fs.writeFile. */
  writeFile?: (absPath: string, content: string, encoding: string) => Promise<void>;
  /** Load verdict JSON from disk. */
  readVerdictFile?: (absPath: string) => Promise<string>;
  /** Secret-guard scanner override. */
  secretScan?: (patch: string, opts?: { allow?: readonly string[] }) => ScanResult;
  /** Build / test runners. */
  verifier?: {
    build: (cwd: string, explicit?: string) => Promise<BuildResult | null>;
    test: (cwd: string, explicit?: string) => Promise<BuildResult | null>;
  };
  /** Run `conclave review --pr N` and return the verdict. Tests inject a stub. */
  runReview?: (input: {
    prNumber: number;
    cwd: string;
  }) => Promise<{ verdict: "approve" | "rework" | "reject"; reviews: ReviewResult[] }>;
  /**
   * v0.7.1 — spawn `conclave review --pr N --json` as a real subprocess and
   * return its stdout (parsed upstream). Defaults to `defaultSpawnReview`.
   * Tests inject a mock to avoid actually forking.
   */
  spawnReview?: (input: {
    prNumber: number;
    cwd: string;
    timeoutMs?: number;
  }) => Promise<{ stdout: string; stderr: string; code: number }>;
  /**
   * v0.7.1 — read stdin when --verdict - is passed. Defaults to
   * `defaultReadStdin`. Tests inject a mock that returns the verdict body.
   */
  readStdin?: () => Promise<string>;
  /** Run `gh pr merge`. Tests inject a stub. */
  mergePr?: (prNumber: number, cwd: string) => Promise<void>;
  /**
   * v0.13.7 — read deploy preview status for a given commit SHA. Defaults
   * to `fetchDeployStatus` from `@conclave-ai/scm-github` (uses `gh api
   * /repos/.../check-runs`). Tests inject a stub to drive the poll loop
   * without hitting GitHub.
   */
  fetchDeployStatus?: (repo: string, sha: string) => Promise<DeployStatus>;
  /**
   * v0.13.7 — sleep helper used between deploy-status polls. Tests pass a
   * no-op so the post-push wait completes synchronously.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * v0.13.7 — total wait budget for the post-push deploy convergence
   * poll. Default 5 min. Once exceeded, autofix proceeds and lets the
   * next review run regardless — better stale than hung.
   */
  deployWaitTimeoutMs?: number;
  /** v0.13.7 — interval between deploy-status polls. Default 15 s. */
  deployWaitIntervalMs?: number;
  /** Stdout / stderr sinks. */
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Safety guards. */
  loopGuard?: LoopGuard;
  breaker?: CircuitBreaker;
  /**
   * UX-2 / UX-3 — override the progress notifier list. Production code
   * builds them from the config via `buildNotifiers`; tests inject a
   * capture stub so they can assert on emitted stages without a live
   * Telegram bot. When omitted, the production path runs.
   */
  notifiers?: Notifier[];
  /**
   * Override the SPECIAL-HANDLERS layer. Default delegates to the real
   * `runSpecialHandlers` (binary-encoding + AF-4..AF-9 mechanical
   * handlers). Tests inject a stub to drive handler-claim / handler-
   * skip permutations without writing files to disk.
   */
  runSpecialHandlers?: (
    agent: ReviewResult["agent"],
    blocker: Blocker,
    deps: { cwd: string; git: GitLike; log?: (msg: string) => void },
  ) => Promise<{ claimed: boolean; fix?: BlockerFix }>;
}

export const defaultGit: GitLike = async (bin, args, opts) => {
  try {
    const { stdout, stderr } = await execFile(bin, args as string[], {
      ...(opts?.cwd ? { cwd: opts.cwd } : {}),
      ...(opts?.input ? { input: opts.input } : {}),
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
      maxBuffer: 20 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    throw Object.assign(new Error(`${bin} ${args.join(" ")} failed: ${e.stderr ?? e.message}`), {
      stdout: e.stdout ?? "",
      stderr: e.stderr,
      code: e.code,
    });
  }
};

export const defaultGh: GhRunner = async (bin, args, opts) => {
  const { stdout, stderr } = await execFile(bin, args as string[], {
    ...opts,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
};

/** v0.7.1 — default spawn-review runner. Shells out to the same CLI binary
 * the current process is running from. Uses `process.execPath` + the
 * resolved `conclave` script path (from process.argv[1]) so the spawned
 * process inherits exactly this CLI's version + deps. Falls back to the
 * plain `conclave` binary on PATH if argv[1] isn't a conclave entry. */
const SPAWN_REVIEW_DEFAULT_TIMEOUT_MS = 60 * 60_000; // 60 min — review can be slow

/** v0.7.2 — exported for regression-test coverage of the exit-code
 * interpretation layer. Not part of the public API; subject to change
 * across patch versions. */
export async function defaultSpawnReview(input: {
  prNumber: number;
  cwd: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; code: number }> {
  const timeout = input.timeoutMs ?? SPAWN_REVIEW_DEFAULT_TIMEOUT_MS;
  // argv[1] is typically the .js entry point; if it exists and looks like
  // conclave's bin, re-exec it via the same node. Otherwise trust PATH.
  const entry = process.argv[1];
  const isConclaveEntry = typeof entry === "string" && /conclave(\.js)?$/.test(entry);
  // v0.13.2 — pass --no-notify so the spawned verdict-fetch review
  // doesn't push a duplicate verdict message to Telegram. The
  // upstream rework workflow's earlier review already notified.
  const args = ["review", "--pr", String(input.prNumber), "--json", "--no-notify"];
  try {
    const { stdout, stderr } = isConclaveEntry
      ? await execFile(process.execPath, [entry!, ...args], {
          cwd: input.cwd,
          maxBuffer: 20 * 1024 * 1024,
          timeout,
          env: process.env,
        })
      : await execFile("conclave", args, {
          cwd: input.cwd,
          maxBuffer: 20 * 1024 * 1024,
          timeout,
          env: process.env,
        });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: string;
      killed?: boolean;
    };
    // execFile on timeout: killed=true + signal set. Surface as a distinct
    // error body so the caller can render it cleanly.
    if (e.killed || e.signal) {
      throw Object.assign(new Error(`conclave review subprocess timed out after ${timeout}ms`), {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        code: typeof e.code === "number" ? e.code : 124,
        timedOut: true,
      });
    }
    // v0.7.2 fix: `conclave review` deliberately uses non-zero exit codes
    // to signal verdict outcome (0=approve, 1=rework, 2=reject). These
    // are NOT crashes — the subprocess emitted a valid verdict JSON on
    // stdout, and the caller MUST be allowed to parse it. Previously we
    // re-threw for every non-zero code, so autofix's catch block bailed
    // before the exit-code-aware check at the call site could run. Now
    // we only re-throw when the exit code is absent (process aborted /
    // couldn't start) or ≥3 (genuine subprocess crash).
    if (typeof e.code === "number" && e.code >= 0 && e.code < 3) {
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        code: e.code,
      };
    }
    throw Object.assign(new Error(e.stderr ?? e.message), {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message,
      code: typeof e.code === "number" ? e.code : 1,
    });
  }
}

/** v0.7.1 — default stdin reader. Reads process.stdin until EOF. */
export async function defaultReadStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
    // Ensure stream is flowing.
    if (process.stdin.isPaused()) process.stdin.resume();
  });
}

/**
 * Parse a verdict JSON file. Accepts any of:
 *  - episodic-entry shape persisted by `conclave review` (councilVerdict + reviews)
 *  - standalone `{ verdict, reviews }` payload (pre-v0.7.1 hand-written files)
 *  - v0.7.1 `conclave review --json` shape (verdict + agents[])
 *
 * Throws on malformed input.
 */
export function parseVerdictFile(raw: string): {
  verdict: "approve" | "rework" | "reject";
  reviews: ReviewResult[];
  /** v0.11 — optional episodic id from the verdict source. When present,
   * autofix uses it as the progress-streaming anchor so iter-started /
   * iter-done lines accumulate onto the SAME Telegram message that the
   * earlier `conclave review` started. */
  episodicId?: string;
  /** v0.11 — repo + PR for progress payloads. Both optional; the
   * autofix progress emit happily renders without them. */
  repo?: string;
  pullNumber?: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`verdict JSON parse failed: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("verdict file is not a JSON object");
  }
  const p = parsed as {
    verdict?: string;
    councilVerdict?: string;
    reviews?: ReviewResult[];
    agents?: Array<{ id?: string; agent?: string; verdict?: string; blockers?: unknown; summary?: string }>;
    episodicId?: string;
    id?: string; // episodic-entry shape uses `id`
    repo?: string;
    prNumber?: number;
    pullNumber?: number;
  };
  const verdict = (p.councilVerdict ?? p.verdict) as "approve" | "rework" | "reject" | undefined;
  if (!verdict || !["approve", "rework", "reject"].includes(verdict)) {
    throw new Error("verdict file missing 'verdict' / 'councilVerdict' field");
  }
  const episodicId = typeof p.episodicId === "string" ? p.episodicId : (typeof p.id === "string" ? p.id : undefined);
  const repo = typeof p.repo === "string" ? p.repo : undefined;
  const pullNumber =
    typeof p.prNumber === "number" ? p.prNumber : typeof p.pullNumber === "number" ? p.pullNumber : undefined;
  // v0.7.1 --json shape uses `agents` instead of `reviews`. Normalize.
  if (!Array.isArray(p.reviews) && Array.isArray(p.agents)) {
    const reviews: ReviewResult[] = p.agents.map((a) => ({
      agent: (a.id ?? a.agent ?? "unknown") as string,
      verdict: (a.verdict ?? "rework") as "approve" | "rework" | "reject",
      blockers: Array.isArray(a.blockers) ? (a.blockers as ReviewResult["blockers"]) : [],
      summary: typeof a.summary === "string" ? a.summary : "",
    }));
    return {
      verdict,
      reviews,
      ...(episodicId ? { episodicId } : {}),
      ...(repo ? { repo } : {}),
      ...(pullNumber !== undefined ? { pullNumber } : {}),
    };
  }
  if (!Array.isArray(p.reviews)) {
    throw new Error("verdict file missing 'reviews' / 'agents' array");
  }
  return {
    verdict,
    reviews: p.reviews,
    ...(episodicId ? { episodicId } : {}),
    ...(repo ? { repo } : {}),
    ...(pullNumber !== undefined ? { pullNumber } : {}),
  };
}

export async function runAutofix(args: AutofixArgs, deps: AutofixDeps = {}): Promise<{ code: number; result: AutofixResult }> {
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));

  // Clamp — even if parseArgv let something weird through.
  args.maxIterations = Math.min(Math.max(1, args.maxIterations), HARD_MAX_ITERATIONS);
  args.budgetUsd = Math.min(Math.max(0.01, args.budgetUsd), HARD_MAX_BUDGET_USD);

  const loadCfg = deps.loadConfig ?? loadConfig;
  const cfg = await loadCfg();
  const memoryRoot = resolveMemoryRoot(cfg.config, cfg.configDir);
  const git = deps.git ?? defaultGit;
  const gh = deps.gh ?? defaultGh;

  // v0.15 (Phase 3) — load PRD/spec from .conclave/prd.md (or args.prd
  // when set in the future). Worker uses it to produce rewrites that
  // satisfy BOTH blockers AND PRD acceptance criteria.
  const prdLoaded = await loadPrd(cfg.configDir, {
    ...(args.prd ? { explicitPath: args.prd } : {}),
  });
  if (prdLoaded.prd) {
    stderr(
      `autofix: PRD loaded from ${prdLoaded.sourcePath} (${prdLoaded.prd.length} chars) — worker will target spec compliance.\n`,
    );
  }

  // UX-1 — post a unified terminal summary to the PR. Best-effort: a
  // gh failure (e.g., archived PR, missing token) only logs to stderr.
  // Caller passes the AutofixResult-shaped status + iterationsAttempted
  // + cost + remainingBlockers so the renderer can build a consistent
  // body across all bail paths.
  // UX-4 — emit review-finished from any terminal path (NOT just the
  // tail-block). Pre-fix, early-return paths like bailed-build-failed,
  // bailed-tests-failed, bailed-no-patches (mid-iteration) never reached
  // the end-of-function emit, so Telegram never saw the terminal report.
  // Caught LIVE on eventbadge PR #42 rework run #25123387450.
  const emitReviewFinishedIfTerminal = async (
    pr: number | undefined,
    repoSlug: string | undefined,
    statusTag: AutofixResultStatus,
    pushedThisRun: boolean,
    iters: AutofixIteration[],
    remainingBlockers: Blocker[],
    cost: number,
    deployHint: DeployOutcome,
  ): Promise<{ emitted: boolean; deferredForRetry: boolean }> => {
    if (!progressEpisodicId) return { emitted: false, deferredForRetry: false };
    const terminal = isAutonomyTerminal({
      status: statusTag,
      pushedThisRun,
      reworkCycle: args.reworkCycle ?? 0,
      maxCycles: 3,
    });
    if (!terminal) {
      stdout(
        `autofix: NOT emitting review-finished — autonomy not terminal (status=${statusTag}, pushed=${pushedThisRun}, cycle=${args.reworkCycle ?? 0}/3)\n`,
      );
      return { emitted: false, deferredForRetry: false };
    }
    // UX-14 — actively probe deploy state at terminal time. Pre-UX-14 we
    // used a hardcoded mapping (merged → success, build-fail → failure,
    // else → unknown). bailed-no-patches / bailed-max-iter / cycle-ceiling
    // all collapsed to "unknown" even when Vercel had recorded failure
    // on the head commit (eventbadge PR #50). Now probe the GH Checks
    // API + commit statuses (covers Vercel which uses the legacy API)
    // and let probe override the static hint when probe is confident.
    let probedDeploy: DeployOutcome = deployHint;
    const probeFn = deps.fetchDeployStatus ?? defaultFetchDeployStatus;
    if (repoSlug && headSha) {
      try {
        const probe = await probeFn(repoSlug, headSha);
        if (probe !== "unknown") probedDeploy = probe as DeployOutcome;
        stdout(`autofix: deploy probe for ${repoSlug}@${headSha.slice(0, 8)} → ${probe} (hint was ${deployHint}, using ${probedDeploy})\n`);
      } catch (err) {
        stderr(
          `autofix: deploy probe failed (${err instanceof Error ? err.message : String(err)}) — using static hint=${deployHint}\n`,
        );
      }
    }
    const report = buildTerminalReport({
      status: statusTag,
      iterations: iters,
      remainingBlockers,
      totalCostUsd: cost,
      // The user-visible cycle counter is 1-indexed and equals
      // args.reworkCycle (rework.yml dispatches the first rework as
      // cycle=1). When reworkCycle is 0 (legacy / non-rework path)
      // surface as 1 so the report says "1번의 사이클" not "0".
      cyclesRun: Math.max(args.reworkCycle ?? 0, 1),
      deployOutcome: probedDeploy,
    });
    // UX-16 — defer review-finished when only machine-fixable items
    // remain AND we haven't hit the cycle ceiling. Bae's words:
    //   "auto-fix limit reached에 open PR이 아니고 rework이 들어가야지.
    //    또 고쳐서 결국 고쳐질때까지 작동하는게 핵심이잖아"
    //
    // Right — categories like contrast / style-drift / focus-visible /
    // missing-import are exactly what AF-4..AF-9 mechanical handlers
    // cover. If they show up at terminal time it means autofix's
    // pipeline didn't get a chance to run them this cycle (e.g., bail
    // before SPECIAL_HANDLERS fired, or AF-1 dropped them mid-iter).
    // Re-dispatch instead of surfacing them as user-action items.
    //
    // Skip the emit; AF-2 in rework.yml dispatches the next cycle on
    // autofix-step.outcome == 'failure' (caller flips exit code to 1
    // when this returns deferredForRetry=true).
    const currentCycle = args.reworkCycle ?? 0;
    const maxCycles = 3;
    if (report.machineFixableCount > 0 && currentCycle < maxCycles) {
      stdout(
        `autofix: DEFERRING review-finished — ${report.machineFixableCount} machine-fixable item(s) remain at cycle ${currentCycle}/${maxCycles}; AF-2 will dispatch retry\n`,
      );
      return { emitted: false, deferredForRetry: true };
    }
    // UX-15 — surface the live preview URL + PR URL so non-devs can click
    // and see the rendered result directly. Best-effort.
    let previewUrl: string | null = null;
    if (repoSlug && headSha) {
      try {
        previewUrl = await fetchPreviewUrl(repoSlug, headSha);
      } catch { /* best-effort */ }
    }
    const prUrl = repoSlug && typeof pr === "number"
      ? `https://github.com/${repoSlug}/pull/${pr}`
      : undefined;
    stdout(
      `autofix: emitting review-finished (status=${statusTag}, cycles=${report.cyclesRun}, found=${report.totalBlockersFound}, fixed=${report.blockersAutofixed}, outstanding=${report.blockersOutstanding}, machineFixable=${report.machineFixableCount}, recommendation=${report.recommendation}, preview=${previewUrl ? "yes" : "no"})\n`,
    );
    await emitProgress(progressNotifiers, {
      episodicId: progressEpisodicId,
      stage: "review-finished",
      payload: {
        ...report,
        ...(repoSlug ? { repo: repoSlug } : {}),
        ...(typeof pr === "number" ? { pullNumber: pr } : {}),
        ...(previewUrl ? { previewUrl } : {}),
        ...(prUrl ? { prUrl } : {}),
      },
    });
    return { emitted: true, deferredForRetry: false };
  };

  const postBailSummary = async (
    pr: number | undefined,
    repoSlug: string | undefined,
    statusTag: string,
    summaryCtx: { iterationsAttempted: number; totalCostUsd: number; remainingBlockers: Blocker[]; reason?: string },
  ) => {
    if (!pr) return;
    if (!shouldPostSummary(statusTag)) return;
    // Diagnostic — surfaces in CI logs so we can confirm the path fires
    // even when the user only sees a PR comment / no Telegram update.
    stdout(`autofix: posting terminal summary (status=${statusTag}, pr=${pr}, repo=${repoSlug ?? "?"}, episodicId=${progressEpisodicId ?? "<none>"})\n`);
    try {
      const body = renderBailSummary(statusTag, summaryCtx);
      // Pass --repo only when we have it; otherwise let gh infer from
      // git config remote.origin.url. This matches pre-UX-1 behavior
      // (the inline body used `repo!` non-null assertion which gh
      // accepted as an empty string).
      const args = ["pr", "comment", String(pr)];
      if (repoSlug) args.push("--repo", repoSlug);
      args.push("--body", body);
      await gh("gh", args);
    } catch (err) {
      stderr(
        `autofix: terminal-summary PR comment failed (${statusTag}) — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    // UX-2 — also emit to the progress stream so Telegram / Discord /
    // Slack notifiers render the terminal status. Pre-UX-2 the bail
    // summary went only to the PR comment (UX-1), and Bae watching
    // Telegram never saw cycle outcome — the message just stopped
    // updating after "auto fixing 1/3".
    if (progressEpisodicId) {
      stdout(`autofix: emitting autofix-cycle-ended to ${progressNotifiers.length} notifier(s)\n`);
      await emitProgress(progressNotifiers, {
        episodicId: progressEpisodicId,
        stage: "autofix-cycle-ended",
        payload: {
          bailStatus: statusTag,
          iterationsAttempted: summaryCtx.iterationsAttempted,
          totalCostUsd: summaryCtx.totalCostUsd,
          remainingBlockerCount: summaryCtx.remainingBlockers.length,
          ...(summaryCtx.reason ? { reason: summaryCtx.reason } : {}),
          ...(repoSlug ? { repo: repoSlug } : {}),
          ...(typeof pr === "number" ? { pullNumber: pr } : {}),
        },
      });
      stdout(`autofix: autofix-cycle-ended emit completed\n`);
    } else {
      stdout(`autofix: skipping autofix-cycle-ended emit — no progressEpisodicId in scope\n`);
    }
  };
  const readVerdict = deps.readVerdictFile ?? ((p: string) => fs.readFile(p, "utf8"));
  const readStdin = deps.readStdin ?? defaultReadStdin;
  const spawnReview = deps.spawnReview ?? defaultSpawnReview;

  // --- 1. Resolve PR + initial verdict ------------------------------------
  let prNumber = args.pr;
  let repo: string | undefined;
  let headSha: string | undefined;
  let initialReviews: ReviewResult[] = [];
  let initialVerdict: "approve" | "rework" | "reject" | undefined;

  // v0.11 — episodic id from the verdict source. Used as the progress
  // streaming anchor so autofix lines accumulate onto the SAME Telegram
  // message that the upstream `conclave review` started. Undefined ==
  // pre-v0.11 verdict file or autofix run with no progress at all.
  let progressEpisodicId: string | undefined;
  if (args.verdictFile) {
    // v0.7.1 — "-" means read from stdin (lets users pipe `gh api ... |
    // conclave autofix --pr N --verdict -`, sidestepping PowerShell's
    // UTF-16 BOM tempfile bugs).
    const raw = args.verdictFile === "-"
      ? await readStdin()
      : await readVerdict(args.verdictFile);
    if (!raw.trim()) {
      stderr(`autofix: --verdict ${args.verdictFile === "-" ? "stdin" : args.verdictFile} was empty\n`);
      return { code: 2, result: bailResult("bailed-no-patches", "empty verdict input", []) };
    }
    const parsed = parseVerdictFile(raw);
    initialReviews = parsed.reviews;
    initialVerdict = parsed.verdict;
    if (parsed.episodicId) progressEpisodicId = parsed.episodicId;
    // Episodic / --json shape also carries repo / pullNumber / sha.
    try {
      const ep = JSON.parse(raw) as Partial<EpisodicEntry> & { prNumber?: number };
      if (!prNumber && typeof ep.pullNumber === "number") prNumber = ep.pullNumber;
      if (!prNumber && typeof ep.prNumber === "number") prNumber = ep.prNumber;
      if (typeof ep.repo === "string") repo = ep.repo;
      if (typeof ep.sha === "string") headSha = ep.sha;
    } catch { /* best-effort */ }
  }

  if (!prNumber) {
    stderr(`autofix: --pr is required when --verdict does not carry pullNumber\n`);
    return {
      code: 2,
      result: bailResult("bailed-no-patches", "no PR number resolved", []),
    };
  }

  if (!repo || !headSha) {
    const prState: PullRequestState = await fetchPrState("", prNumber, { run: gh }).catch(async () => {
      // Fall back to `gh pr view N` against the current repo.
      const { stdout: out } = await gh("gh", ["pr", "view", String(prNumber), "--json", "state,headRefOid,updatedAt,headRepository,headRepositoryOwner"]);
      const view = JSON.parse(out) as {
        state?: string;
        headRefOid?: string;
        updatedAt?: string;
        headRepository?: { name?: string };
        headRepositoryOwner?: { login?: string };
      };
      const rName = view.headRepository?.name ?? "";
      const rOwner = view.headRepositoryOwner?.login ?? "";
      return {
        repo: rOwner && rName ? `${rOwner}/${rName}` : repo ?? "unknown/unknown",
        prNumber,
        state: (view.state?.toLowerCase() ?? "open") as "open" | "merged" | "closed",
        headSha: view.headRefOid ?? "",
        updatedAt: view.updatedAt ?? new Date().toISOString(),
      };
    });
    if (prState.state !== "open") {
      stderr(`autofix: PR #${prNumber} is ${prState.state}, not open — nothing to autofix\n`);
      return {
        code: 1,
        result: bailResult("bailed-no-patches", `pr is ${prState.state}`, []),
      };
    }
    repo = repo ?? prState.repo;
    headSha = headSha ?? prState.headSha;
  }

  // --- 2. Safety guards ---------------------------------------------------
  const loopGuard = deps.loopGuard ?? new LoopGuard({ threshold: 5, windowMs: 60 * 60_000 });
  const breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 3 });
  const loopKey = `autofix:${repo}#${prNumber}:${headSha}`;
  try {
    loopGuard.check(loopKey);
  } catch (err) {
    if (err instanceof LoopDetectedError) {
      stderr(`autofix: loop guard tripped on ${loopKey} (${err.count} attempts) — human needed\n`);
      return { code: 2, result: bailResult("bailed-loop-guard", `loop guard: ${err.count} attempts`, []) };
    }
    throw err;
  }

  // --- 3. If no verdict given, run review first --------------------------
  //     v0.7.1 — when no DI runReview is injected, we auto-spawn
  //     `conclave review --pr N --json` as a subprocess and parse its
  //     stdout. This closes the UX gap from v0.7.0 (which required a
  //     hand-crafted verdict JSON file). --verdict <file> and
  //     --verdict - (stdin) remain fully supported for CI / air-gapped.
  if (initialVerdict === undefined) {
    if (deps.runReview) {
      const reviewed = await deps.runReview({ prNumber, cwd: args.cwd });
      initialReviews = reviewed.reviews;
      initialVerdict = reviewed.verdict;
    } else {
      stdout(`autofix: no --verdict provided, spawning 'conclave review --pr ${prNumber} --json' to fetch live verdict\n`);
      let spawnResult: { stdout: string; stderr: string; code: number };
      try {
        spawnResult = await spawnReview({ prNumber, cwd: args.cwd });
      } catch (err) {
        const e = err as Error & { stderr?: string; code?: number; timedOut?: boolean };
        // Prefer the subprocess's stderr, but fall back to the Error
        // message (timeout / EPERM / ENOENT leave stderr empty).
        const rawTail = (e.stderr && e.stderr.trim().length > 0 ? e.stderr : e.message ?? "").toString();
        const tail = rawTail.slice(-800);
        stderr(
          `autofix: failed to auto-fetch verdict via 'conclave review --pr ${prNumber} --json' — ${tail}. Pass --verdict <file> manually or fix the review subprocess.\n`,
        );
        return {
          code: 2,
          result: bailResult("bailed-no-patches", `spawn review failed: ${tail.slice(0, 200)}`, []),
        };
      }
      // review exit-code: 0=approve 1=rework 2=reject. We still want to
      // parse stdout in all three cases — the JSON payload is the source
      // of truth for downstream decisions.
      if (spawnResult.code !== 0 && spawnResult.code !== 1 && spawnResult.code !== 2) {
        const tail = (spawnResult.stderr ?? "").toString().slice(-800);
        stderr(
          `autofix: 'conclave review --pr ${prNumber} --json' exited ${spawnResult.code} — ${tail}. Pass --verdict <file> manually or fix the review subprocess.\n`,
        );
        return {
          code: 2,
          result: bailResult("bailed-no-patches", `review subprocess exit ${spawnResult.code}`, []),
        };
      }
      let parsed: ReturnType<typeof parseVerdictFile>;
      try {
        parsed = parseVerdictFile(spawnResult.stdout);
      } catch (err) {
        const msg = (err as Error).message;
        const tail = spawnResult.stdout.slice(0, 400);
        stderr(
          `autofix: 'conclave review --pr ${prNumber} --json' returned unparseable stdout — ${msg}. First 400 chars: ${tail}\n`,
        );
        return {
          code: 2,
          result: bailResult("bailed-no-patches", `review subprocess stdout parse failed: ${msg}`, []),
        };
      }
      initialReviews = parsed.reviews;
      initialVerdict = parsed.verdict;
      if (parsed.episodicId) progressEpisodicId = parsed.episodicId;
      // v0.7.1 --json also carries `sha` / `prNumber` — pick them up to
      // fill in missing loopKey pieces if the gh pr view fallback didn't.
      try {
        const extra = JSON.parse(spawnResult.stdout) as { sha?: string; repo?: string; prNumber?: number };
        if (!headSha && typeof extra.sha === "string") headSha = extra.sha;
        if (!repo && typeof extra.repo === "string") repo = extra.repo;
      } catch { /* best-effort */ }
    }
  }

  if (initialVerdict === "approve") {
    stdout(`autofix: council already approves — nothing to fix\n`);
    return {
      code: 0,
      result: {
        status: "approved",
        iterations: [],
        totalCostUsd: 0,
        finalVerdict: "approve",
        remainingBlockers: [],
        mergeStatus: "not-merged",
      },
    };
  }

  // v0.7.2 — reject is too destructive to autofix. A reject means the
  // council wants the PR closed (not reworked) — blindly feeding that
  // into the fix loop would try to "fix" things like "this whole
  // approach is wrong". Print a clear message and exit non-zero so CI
  // doesn't silently treat reject like a pass, but DON'T error-crash.
  if (initialVerdict === "reject") {
    stdout(
      `autofix: council verdict is REJECT — refusing to autofix (too destructive). ` +
        `Remaining blockers: ${remainingBlockersFrom(initialReviews).length}. ` +
        `Close the PR or re-open a scoped-down one.\n`,
    );
    return {
      code: 1,
      result: {
        status: "bailed-no-patches",
        iterations: [],
        totalCostUsd: 0,
        finalVerdict: "reject",
        remainingBlockers: remainingBlockersFrom(initialReviews),
        mergeStatus: "not-merged",
        reason: "council verdict: reject — autofix refused",
      },
    };
  }

  // --- 4. The loop --------------------------------------------------------
  const worker = deps.worker ?? buildWorker(deps, cfg.config);
  const iterations: AutofixIteration[] = [];
  let totalCost = 0;
  // PIA-5 — set true the first time an iteration successfully pushes a
  // patch. When max-iterations bails the loop afterwards, the run is
  // "deferred-to-next-review" (exit 0) instead of "bailed-max-iterations"
  // (exit 1) because the push itself advances the cycle.
  let anyIterationPushed = false;
  let currentReviews = initialReviews;
  let finalVerdict: "approve" | "rework" | "reject" = initialVerdict;

  // v0.11 — progress streaming. Build notifiers only when we have an
  // episodicId to anchor on (verdict file or auto-spawned review carried
  // it). Without an episodicId, autofix runs WITHOUT streaming — the
  // upstream review's final notifyReview already reported the verdict,
  // and there's no message to edit on. emitProgress no-ops on an empty
  // notifier list, so the per-iteration calls below stay cost-free.
  const progressNotifiers: Notifier[] = progressEpisodicId
    ? (deps.notifiers ?? buildNotifiers(cfg.config))
    : [];

  // H3 #13 — pull rework-loop-failure entries out of the failure-catalog
  // and synthesize prior-bail hints. The worker prompt builder splices
  // them into its cache prefix so successive autofix runs see "this kind
  // of bail happened before; avoid the same root cause." Best-effort:
  // any retrieval failure leaves priorBailHints undefined, the worker
  // falls back to the static prompt, autofix proceeds normally.
  let priorBailHints: string[] | undefined;
  try {
    const memoryForHints = new FileSystemMemoryStore({ root: memoryRoot });
    // Use the first remaining blocker's category + message as the
    // retrieval query — it's the most relevant signal for "what past
    // bails resemble this run". Falls back to the repo string when no
    // blockers (rare for autofix; that case bails immediately anyway).
    const queryPieces: string[] = [repo ?? ""];
    const firstReview = currentReviews[0];
    const firstBlocker = firstReview?.blockers[0];
    if (firstBlocker) {
      queryPieces.push(firstBlocker.category, firstBlocker.message);
    }
    const retrieved = await memoryForHints.retrieve({
      query: queryPieces.join(" "),
      domain: "code",
      ...(repo ? { repo } : {}),
      k: 8,
    });
    const hints = extractPriorBailHints(retrieved.failures);
    if (hints.length > 0) {
      priorBailHints = hints.map((h) => h.text);
      stdout(`autofix: ${hints.length} prior-bail hint(s) injected into worker prompt\n`);
    }
  } catch (err) {
    stderr(
      `autofix: prior-bail hint retrieval failed (non-fatal) — ${(err as Error).message}\n`,
    );
  }

  for (let i = 0; i < args.maxIterations; i += 1) {
    // v0.7 — collect unique (agent, blocker) pairs across the council.
    const targets = dedupeBlockersAcrossAgents(currentReviews);
    if (targets.length === 0) {
      stdout(`autofix: no blockers this iteration — exiting loop\n`);
      break;
    }

    // v0.11 — progress: autofix iter starting. iteration is 1-based for
    // user-facing prose; the internal `i` is 0-based.
    if (progressEpisodicId) {
      const iterationNum = i + 1;
      const startedPayload: NonNullable<Parameters<typeof emitProgress>[1]["payload"]> = {
        iteration: iterationNum,
      };
      if (repo) startedPayload.repo = repo;
      if (typeof prNumber === "number") startedPayload.pullNumber = prNumber;
      await emitProgress(progressNotifiers, {
        episodicId: progressEpisodicId,
        stage: "autofix-iter-started",
        payload: startedPayload,
      });
    }

    const fixes: BlockerFix[] = [];
    let previousBuildErrorTail: string | undefined;
    const prevIter = iterations[iterations.length - 1];
    if (prevIter && !prevIter.verified && (prevIter.buildOk === false || prevIter.testsOk === false)) {
      // Fed back into the next iteration so the worker sees what broke.
      previousBuildErrorTail = prevIter.notes.find((n) => n.startsWith("failure:"))?.slice("failure:".length).trim();
    }

    // --- Per-blocker worker invocations ---------------------------------
    // v0.7.3 — SPECIAL-HANDLER layer runs FIRST. If a handler claims
    //     the blocker, we skip the worker call + git-apply pipeline.
    //     Handler-applied fixes are already staged on disk (e.g. the
    //     binary-encoding handler re-writes the file and `git add`s
    //     it) — they're tracked in `handlerStagedFixes` so the
    //     apply-sequentially loop below can skip them.
    const handlerStagedFixes = new Set<BlockerFix>();
    const blockerTotal = targets.length;
    for (let bIdx = 0; bIdx < targets.length; bIdx += 1) {
      const t = targets[bIdx]!;
      // Budget early-exit — never burn past the cap.
      if (totalCost >= args.budgetUsd) {
        stdout(`autofix: budget ($${args.budgetUsd}) hit mid-iteration — finishing early\n`);
        break;
      }
      // UX-3 — emit per-blocker progress so the user sees concrete work.
      // Pre-UX-3 the only signal was "auto fixing 1/3" (cycle-level); 9
      // blockers in one iteration looked like nothing was happening.
      if (progressEpisodicId) {
        const blockerLabel = `${t.blocker.category ?? "uncategorized"}: ${(t.blocker.message ?? "").slice(0, 60)}`;
        await emitProgress(progressNotifiers, {
          episodicId: progressEpisodicId,
          stage: "autofix-blocker-started",
          payload: {
            iteration: i + 1,
            blockerIndex: bIdx + 1,
            blockerTotal,
            blockerLabel,
            ...(repo ? { repo } : {}),
            ...(typeof prNumber === "number" ? { pullNumber: prNumber } : {}),
          },
        });
      }
      // Try the special-handlers first. These handle blockers the
      // unified-diff pipeline can't (binary files, etc.) and count as
      // successfully-applied fixes when they succeed.
      const runSpecial = deps.runSpecialHandlers ?? runSpecialHandlers;
      const handled = await runSpecial(t.agent, t.blocker, {
        cwd: args.cwd,
        git,
        log: (m) => stdout(m),
      });
      if (handled.claimed && handled.fix) {
        fixes.push(handled.fix);
        if (handled.fix.status === "ready") {
          handlerStagedFixes.add(handled.fix);
        }
        totalCost += handled.fix.costUsd ?? 0;
        if (progressEpisodicId) {
          await emitProgress(progressNotifiers, {
            episodicId: progressEpisodicId,
            stage: "autofix-blocker-done",
            payload: {
              iteration: i + 1,
              blockerIndex: bIdx + 1,
              blockerTotal,
              blockerOutcome: handled.fix.status,
              ...(repo ? { repo } : {}),
              ...(typeof prNumber === "number" ? { pullNumber: prNumber } : {}),
            },
          });
        }
        continue;
      }

      let bfix: BlockerFix;
      try {
        bfix = await breaker.guard("worker", () =>
          runPerBlocker(
            {
              repo: repo!,
              pullNumber: prNumber!,
              newSha: headSha!,
              agent: t.agent,
              blocker: t.blocker,
              ...(previousBuildErrorTail ? { buildErrorTail: previousBuildErrorTail } : {}),
              ...(priorBailHints ? { priorBailHints } : {}),
              ...(prdLoaded.prd ? { prd: prdLoaded.prd } : {}),
            },
            {
              worker,
              cwd: args.cwd,
              ...(deps.readFile ? { readFile: deps.readFile } : {}),
            },
          ),
        );
      } catch (err) {
        if (err instanceof CircuitOpenError) {
          stderr(`autofix: circuit breaker open (until ${new Date(err.openUntil).toISOString()}) — aborting\n`);
          iterations.push(finalizeIteration(i, fixes, false, [`circuit:${err.provider}`]));
          const itTotal = fixes.reduce((n, f) => n + (f.costUsd ?? 0), 0);
          totalCost += itTotal;
          return {
            code: 2,
            result: {
              status: "bailed-circuit",
              iterations,
              totalCostUsd: totalCost,
              finalVerdict,
              remainingBlockers: remainingBlockersFrom(currentReviews),
              mergeStatus: "not-merged",
              reason: err.message,
            },
          };
        }
        throw err;
      }
      fixes.push(bfix);
      totalCost += bfix.costUsd ?? 0;
      // UX-3 — emit per-blocker outcome.
      if (progressEpisodicId) {
        await emitProgress(progressNotifiers, {
          episodicId: progressEpisodicId,
          stage: "autofix-blocker-done",
          payload: {
            iteration: i + 1,
            blockerIndex: bIdx + 1,
            blockerTotal,
            blockerOutcome: bfix.status,
            ...(repo ? { repo } : {}),
            ...(typeof prNumber === "number" ? { pullNumber: prNumber } : {}),
          },
        });
      }
    }

    // --- Secret-guard + file-deny already applied per-patch. Now run
    //     one final secret scan across ALL ready patches for belt-and-
    //     suspenders (a multi-patch combo could sneak through).
    //     v0.7.3 — handler-staged fixes (`ready` + no `patch`) are
    //     already applied in-place on disk, so they're NOT scanned
    //     here. They bypass the unified-diff secret scan because
    //     the only handler today (binary-encoding) only re-encodes
    //     existing file bytes; no new content is introduced.
    // Secret-guard: scan patch content (handlers) or rewrite content (worker).
    const readyFixes = fixes.filter((f) => f.status === "ready" && (f.patch || f.rewrites));
    if (!args.skipSecretGuard) {
      const scanner = deps.secretScan ?? scanPatch;
      for (const rf of readyFixes) {
        if (rf.rewrites) {
          // Scan each rewrite's content as a single "blob".
          for (const rw of rf.rewrites) {
            const scan = scanner(rw.content, { allow: args.allowSecrets });
            if (scan.blocked) {
              rf.status = "secret-block";
              rf.reason = `secret-guard blocked ${rw.path}: ${scan.findings.map((f) => formatFinding(f)).join("; ")}`;
              break;
            }
          }
        } else if (rf.patch) {
          const scan = scanner(rf.patch, { allow: args.allowSecrets });
          if (scan.blocked) {
            rf.status = "secret-block";
            rf.reason = `secret-guard blocked: ${scan.findings.map((f) => formatFinding(f)).join("; ")}`;
          }
        }
      }
    }
    // Handler-staged ready fixes count toward "something got applied"
    // but the file edit is already on disk + staged via `git add`;
    // there is no unified diff to feed `git apply`. The single signal
    // for that lane is `handlerStagedFixes.has(f)` — NOT the absence
    // of `f.patch`. Some handlers (AF-4/5/6/7/8/9) populate `patch`
    // with a comment-header sentinel for human-readable terminal
    // reporting; if we treat those as worker patches and feed them to
    // `git apply`, the apply rejects on "No valid patches in input"
    // and AF-1's partial-restore (`git checkout HEAD -- <file>`)
    // wipes the in-place edit the handler already made — silently
    // reverting the fix and stalling the autonomy loop. Live-caught
    // on eventbadge#57 v19 cycle 1 where AF-5/6/7/8/9 all rewrote
    // AddressSearch.jsx + colorExtractor.js correctly, then got
    // reverted by partial-restore, leaving only AF-4's new-file stub.
    const stillReady = fixes.filter(
      (f) => f.status === "ready" && (f.patch || f.rewrites) && !handlerStagedFixes.has(f),
    );
    const stillReadyHandlerStaged = fixes.filter(
      (f) => f.status === "ready" && handlerStagedFixes.has(f),
    );

    // --- Diff-budget guard (handler sentinel patches only) ---------------
    // Worker rewrites do not produce unified diffs — the diff budget
    // only applies to handler sentinel patch strings (which are tiny
    // comment headers). Worker rewrites bypass this gate by design.
    const patches = stillReady.filter((f) => f.patch && !f.rewrites).map((f) => f.patch!);
    const summary = summarizeAutofixPatches(patches);
    if (summary.totalLines > DIFF_BUDGET_LINES) {
      stderr(
        `autofix: diff budget exceeded — ${summary.totalLines} lines across ${summary.totalFiles} files (limit ${DIFF_BUDGET_LINES}). Stopping for human review.\n`,
      );
      iterations.push(finalizeIteration(i, fixes, false, [`diff-budget:${summary.totalLines}`]));
      return {
        code: 2,
        result: {
          status: "bailed-diff-budget",
          iterations,
          totalCostUsd: totalCost,
          finalVerdict,
          remainingBlockers: remainingBlockersFrom(currentReviews),
          mergeStatus: "not-merged",
          reason: `diff too large (${summary.totalLines} lines)`,
        },
      };
    }

    // --- Dry-run: print + exit -----------------------------------------
    if (args.dryRun) {
      // v0.7.3 — dry-run MUST NOT leave handler-staged edits on disk
      // (binary-encoding handler re-wrote files already). Undo them.
      for (const hf of stillReadyHandlerStaged) {
        for (const f of hf.appliedFiles ?? []) {
          await git("git", ["checkout", "--", f], { cwd: args.cwd }).catch(() => undefined);
        }
      }
      stdout(
        `autofix[dry-run]: ${stillReady.length} patches would apply (${summary.totalLines} lines, ${summary.totalFiles} files)` +
          (stillReadyHandlerStaged.length > 0
            ? ` + ${stillReadyHandlerStaged.length} handler-staged fixes (rolled back for dry-run)`
            : "") +
          `\n`,
      );
      for (const rf of stillReady) {
        if (rf.rewrites) {
          for (const rw of rf.rewrites) {
            stdout(`--- ${rw.path} — ${rf.blocker.category} [full-file-rewrite, ${rw.content.split("\n").length} lines] ---\n`);
          }
        } else {
          stdout(`--- ${rf.blocker.file ?? "(unscoped)"} — ${rf.blocker.category} ---\n${rf.patch}\n`);
        }
      }
      for (const hf of stillReadyHandlerStaged) {
        stdout(
          `--- ${hf.blocker.file ?? "(unscoped)"} — ${hf.blocker.category} [handler] ---\n${hf.commitMessage ?? "(handler-applied)"}\n`,
        );
      }
      const nonReady = fixes.filter((f) => f.status !== "ready");
      for (const nr of nonReady) {
        stdout(`[skipped] ${nr.blocker.category} (${nr.blocker.file ?? "unscoped"}): ${nr.status} — ${nr.reason ?? ""}\n`);
      }
      iterations.push(finalizeIteration(i, fixes, false, ["dry-run"]));
      return {
        code: 0,
        result: {
          status: "dry-run",
          iterations,
          totalCostUsd: totalCost,
          finalVerdict,
          remainingBlockers: remainingBlockersFrom(currentReviews),
          mergeStatus: "not-merged",
        },
      };
    }

    if (stillReady.length === 0 && stillReadyHandlerStaged.length === 0) {
      // v0.13.3 — dump per-blocker disposition so operators can see WHY
      // each blocker dropped out (worker-error / conflict / secret-block /
      // skip with custom reason). Pre-fix the bail line just said
      // "all skipped/conflict" with no breakdown — operators couldn't
      // tell whether the worker errored, the patch contextually
      // mismatched, or secret-guard blocked it.
      stderr(`autofix: no applicable patches this iteration — ${fixes.length} blocker(s) processed, none usable:\n`);
      for (const f of fixes) {
        const reasonTail = (f.reason ?? "").slice(-300);
        stderr(`autofix:   [${f.status}] ${f.blocker.category} @ ${f.blocker.file ?? "<unscoped>"}: ${reasonTail || "(no detail)"}\n`);
      }
      iterations.push(finalizeIteration(i, fixes, false, ["no-ready-patches"]));
      // UX-1 — unified summary.
      await postBailSummary(prNumber, repo, "bailed-no-patches", {
        iterationsAttempted: iterations.length,
        totalCostUsd: totalCost,
        remainingBlockers: remainingBlockersFrom(currentReviews),
        reason: "no applicable patches this iteration",
      });
      // UX-4 — terminal report.
      await emitReviewFinishedIfTerminal(
        prNumber,
        repo,
        "bailed-no-patches",
        anyIterationPushed,
        iterations,
        remainingBlockersFrom(currentReviews),
        totalCost,
        "unknown",
      );
      return {
        code: 1,
        result: {
          status: "bailed-no-patches",
          iterations,
          totalCostUsd: totalCost,
          finalVerdict,
          remainingBlockers: remainingBlockersFrom(currentReviews),
          mergeStatus: "not-merged",
        },
      };
    }

    // --- Apply rewrites (AF-1: partial-apply rescue) --------------------
    //     v0.14: workers produce full-file rewrites instead of unified diffs.
    //     Write contents directly to disk + `git add`. No `git apply` needed
    //     — apply failures are structurally impossible with this approach.
    //
    //     The one-file-per-iteration rule still applies: if an earlier
    //     rewrite (or handler) already modified a file, defer the later
    //     rewrite so the next review cycle regenerates against the updated
    //     file contents.
    const appliedPaths: string[] = [];
    const filesTouchedThisIter = new Set<string>();
    for (const hf of stillReadyHandlerStaged) {
      for (const f of hf.appliedFiles ?? []) filesTouchedThisIter.add(f);
    }
    for (const rf of stillReady) {
      const targetFiles = (rf.appliedFiles ?? []).filter((f) => f.length > 0);
      const conflictingFile = targetFiles.find((f) => filesTouchedThisIter.has(f));
      if (conflictingFile) {
        rf.status = "conflict";
        rf.reason = `deferred: file ${conflictingFile} already modified earlier this iteration; next review cycle will regenerate against current content`;
        stderr(
          `autofix: deferring rewrite for blocker [${rf.blocker.category}] @ ${rf.blocker.file ?? "<unscoped>"} — file already touched this iteration\n`,
        );
        continue;
      }
      if (rf.rewrites) {
        // Full-file rewrite path (worker v0.14+).
        const writeFileFn = deps.writeFile ?? ((p: string, c: string, enc: BufferEncoding) => fs.writeFile(p, c, enc));
        let writeOk = true;
        const writtenPaths: string[] = [];
        for (const rw of rf.rewrites) {
          try {
            const absPath = path.isAbsolute(rw.path) ? rw.path : path.join(args.cwd, rw.path);
            await writeFileFn(absPath, rw.content, "utf8");
            await git("git", ["add", "--", rw.path], { cwd: args.cwd });
            appliedPaths.push(rw.path);
            filesTouchedThisIter.add(rw.path);
            writtenPaths.push(rw.path);
          } catch (writeErr) {
            writeOk = false;
            rf.status = "conflict";
            rf.reason = `failed to write ${rw.path}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`;
            stderr(`autofix: failed to write rewrite for [${rf.blocker.category}] @ ${rw.path} — ${rf.reason}\n`);
            // Restore any files already written in this rf.
            for (const f of writtenPaths) {
              await git("git", ["checkout", "--", f], { cwd: args.cwd }).catch(() => undefined);
            }
            break;
          }
        }
        if (writeOk) {
          stderr(`autofix: applied full-file rewrite for [${rf.blocker.category}] @ ${rf.blocker.file ?? "<unscoped>"}\n`);
        }
      }
    }

    // AF-1 — count fixes that successfully landed on the worktree.
    // Pre-AF-1 we bailed on first conflict; post-AF-1 we proceed if at
    // least one ready fix made it through. Only when ALL fixes failed
    // — including handler-staged in-place edits — do we bail.
    //
    // Bug #2 (sibling of v0.14.19): handler-staged fixes have already
    // written their files to disk + `git add`-ed them BEFORE the apply
    // loop runs. If we only count `stillReady` survivors here, a
    // pathological "all worker patches conflicted, all handler fixes
    // succeeded" case bails AND `git reset --hard HEAD` wipes every
    // handler edit. Since handler-staged commits are exactly the ones
    // most likely to land cleanly (mechanical re-writes, idempotent
    // file rewrites), throwing them away made the loop stall when the
    // mix was code-blockers (worker, conflict-prone) + design-blockers
    // (handler, deterministic). Count handler-staged fixes here too.
    const survivedFixes = stillReady.filter((rf) => rf.status === "ready");
    if (survivedFixes.length === 0 && stillReadyHandlerStaged.length === 0) {
      // Every patch in stillReady ended up conflict — nothing to commit.
      // Reset is defensive: AF-1 partial-restore already cleaned the
      // failed patches' files, but this catches anything we missed.
      await git("git", ["reset", "--hard", "HEAD"], { cwd: args.cwd }).catch(() => undefined);
      const conflicting = fixes.filter((f) => f.status === "conflict");
      stderr(`autofix: every patch this iteration conflicted — ${conflicting.length} fix(es) rejected\n`);
      for (const cf of conflicting) {
        stderr(`autofix:   reject — ${cf.blocker.file ?? "<unknown>"}:\n${cf.reason ?? "(no detail)"}\n`);
      }
      iterations.push(finalizeIteration(i, fixes, false, ["apply-conflict-all"]));
      await postBailSummary(prNumber, repo, "bailed-no-patches", {
        iterationsAttempted: iterations.length,
        totalCostUsd: totalCost,
        remainingBlockers: remainingBlockersFrom(currentReviews),
        reason: "every patch this iteration rejected (apply-conflict on all stillReady fixes)",
      });
      // UX-4 — terminal report.
      await emitReviewFinishedIfTerminal(
        prNumber,
        repo,
        "bailed-no-patches",
        anyIterationPushed,
        iterations,
        remainingBlockersFrom(currentReviews),
        totalCost,
        "unknown",
      );
      return {
        code: 1,
        result: {
          status: "bailed-no-patches",
          iterations,
          totalCostUsd: totalCost,
          finalVerdict,
          remainingBlockers: remainingBlockersFrom(currentReviews),
          mergeStatus: "not-merged",
          reason: "apply-conflict mid-iteration",
        },
      };
    }

    // --- Build verification ---------------------------------------------
    const buildResult = deps.verifier
      ? await deps.verifier.build(args.cwd, args.buildCmd)
      : await verify(args.cwd, "build", { ...(args.buildCmd ? { explicit: args.buildCmd } : {}) });
    const buildOk = buildResult === null ? true : buildResult.success; // null = no detection = trust CI.
    if (buildResult && !buildResult.success) {
      stderr(`autofix: build failed (${buildResult.command}) — reverting\n`);
      await git("git", ["reset", "--hard", "HEAD"], { cwd: args.cwd }).catch(() => undefined);
      const note = `failure: ${summarizeFailure(buildResult)}`;
      iterations.push(
        finalizeIteration(i, fixes, false, [note], {
          buildOk: false,
          buildCommand: buildResult.command,
        }),
      );
      // Feed back into next iteration via previousBuildErrorTail pickup.
      if (i + 1 >= args.maxIterations) {
        // UX-1 — unified summary so the user sees the build-failed
        // terminal state without digging through Actions logs.
        await postBailSummary(prNumber, repo, "bailed-build-failed", {
          iterationsAttempted: iterations.length,
          totalCostUsd: totalCost,
          remainingBlockers: remainingBlockersFrom(currentReviews),
          reason: "build failed after max iterations",
        });
        // UX-4 — terminal report.
        await emitReviewFinishedIfTerminal(
          prNumber,
          repo,
          "bailed-build-failed",
          anyIterationPushed,
          iterations,
          remainingBlockersFrom(currentReviews),
          totalCost,
          "failure",
        );
        return {
          code: 1,
          result: {
            status: "bailed-build-failed",
            iterations,
            totalCostUsd: totalCost,
            finalVerdict,
            remainingBlockers: remainingBlockersFrom(currentReviews),
            mergeStatus: "not-merged",
            reason: "build failed after max iterations",
          },
        };
      }
      continue; // try next iteration with the failure context.
    }

    // --- Test verification ---------------------------------------------
    const testResult = deps.verifier
      ? await deps.verifier.test(args.cwd, args.testCmd)
      : await verify(args.cwd, "test", { ...(args.testCmd ? { explicit: args.testCmd } : {}) });
    const testsOk = testResult === null ? true : testResult.success;
    if (testResult && !testResult.success) {
      stderr(`autofix: tests failed (${testResult.command}) — reverting, will NOT commit\n`);
      await git("git", ["reset", "--hard", "HEAD"], { cwd: args.cwd }).catch(() => undefined);
      const note = `failure: ${summarizeFailure(testResult)}`;
      iterations.push(
        finalizeIteration(i, fixes, false, [note], {
          buildOk: true,
          testsOk: false,
          testCommand: testResult.command,
          ...(buildResult?.command ? { buildCommand: buildResult.command } : {}),
        }),
      );
      if (i + 1 >= args.maxIterations) {
        // UX-1 — unified summary.
        await postBailSummary(prNumber, repo, "bailed-tests-failed", {
          iterationsAttempted: iterations.length,
          totalCostUsd: totalCost,
          remainingBlockers: remainingBlockersFrom(currentReviews),
          reason: "tests failed after max iterations",
        });
        // UX-4 — terminal report.
        await emitReviewFinishedIfTerminal(
          prNumber,
          repo,
          "bailed-tests-failed",
          anyIterationPushed,
          iterations,
          remainingBlockersFrom(currentReviews),
          totalCost,
          "failure",
        );
        return {
          code: 1,
          result: {
            status: "bailed-tests-failed",
            iterations,
            totalCostUsd: totalCost,
            finalVerdict,
            remainingBlockers: remainingBlockersFrom(currentReviews),
            mergeStatus: "not-merged",
            reason: "tests failed after max iterations",
          },
        };
      }
      continue;
    }

    // --- Commit ---------------------------------------------------------
    //     Everything passed — stage + commit one consolidated commit per
    //     iteration. The summary line comes from the first fix's
    //     commitMessage or a generic fallback. v0.7.3 — handler-staged
    //     fixes count toward the commit body/tally alongside patch fixes.
    //
    // v0.10 — embed `[conclave-rework-cycle:N+1]` in the message body so
    // review.yml's cycle extractor (the `git log -1 --pretty=%B HEAD`
    // grep) picks up the next iteration when the push re-triggers the
    // workflow. Skipping the marker on local-dev invocations (cycle=0
    // and not in CI mode) avoids polluting hand-driven autofix runs.
    // We always emit the marker when reworkCycle was passed > 0 OR
    // when the env signal CONCLAVE_AUTONOMY_LOOP=1 is set (the
    // consumer rework workflow sets this, see rework.yml).
    // v0.13.4 — stage ONLY the files autofix actually patched.
    //
    // Pre-fix this used `git add -A` which staged any unrelated
    // working-tree noise — most notably new package-lock.json files
    // created by an upstream dependency-install step in the rework
    // workflow. eventbadge#25 commit 22a0b99 surfaced this: the
    // autofix commit included frontend_old/package-lock.json (3018
    // lines), which the next review correctly flagged as
    // environment/compatibility blocker, blocking loop closure.
    //
    // Build the file list from:
    //   - applyPaths from `git apply --recount` (patches autofix authored)
    //   - appliedFiles from special-handler results (e.g. binary-encoding)
    // Files explicitly added through these channels are exactly what
    // the autofix WANTED to commit; everything else was incidental.
    const filesToStage = new Set<string>();
    for (const p of appliedPaths) filesToStage.add(p);
    for (const hf of stillReadyHandlerStaged) {
      for (const f of hf.appliedFiles ?? []) filesToStage.add(f);
    }
    if (filesToStage.size === 0) {
      // Defense-in-depth: no scoped files identified but stillReady is
      // non-empty. Fall back to staging any modified files git already
      // tracks — still scoped enough that a brand-new pkg-lock.json
      // doesn't sneak in (untracked files require an explicit add).
      stderr("autofix: no scoped files to stage from patches/handlers — falling back to `git add -u` (tracked-only)\n");
      await git("git", ["add", "-u"], { cwd: args.cwd });
    } else {
      await git("git", ["add", "--", ...Array.from(filesToStage)], { cwd: args.cwd });
    }
    const committedFixes = [...stillReady, ...stillReadyHandlerStaged];
    const title =
      committedFixes[0]?.commitMessage ?? `autofix: ${committedFixes.length} blockers (conclave-ai)`;
    const body = committedFixes
      .map((f) => `- [${f.blocker.severity}/${f.blocker.category}] ${f.blocker.message}`)
      .join("\n");
    const inAutonomyLoop =
      args.reworkCycle > 0 || process.env["CONCLAVE_AUTONOMY_LOOP"] === "1";
    const nextCycle = Math.min(args.reworkCycle + 1, REWORK_CYCLE_HARD_CEILING);
    const cycleMarker = inAutonomyLoop ? `\n\n[conclave-rework-cycle:${nextCycle}]` : "";
    const fullMsg = `${title} (conclave-ai)\n\n${body}${cycleMarker}`;
    // v0.16.1 — use the GitHub App noreply format so deploy gates that
    // require commit-author email→GitHub-account matching (e.g. Vercel's
    // "Deployment Blocked: email could not be matched") accept the bot
    // commits. The format <APP_ID>+<APP_SLUG>[bot]@users.noreply.github.com
    // is the canonical address GitHub stamps on commits authored via an
    // installation token.
    await git(
      "git",
      [
        "-c",
        "user.name=conclave-ai-code-council[bot]",
        "-c",
        "user.email=3620556+conclave-ai-code-council[bot]@users.noreply.github.com",
        "commit",
        "-m",
        fullMsg,
        "--author",
        "conclave-ai-code-council[bot] <3620556+conclave-ai-code-council[bot]@users.noreply.github.com>",
      ],
      { cwd: args.cwd },
    );
    let pushedThisRun = false;
    try {
      await git("git", ["push"], { cwd: args.cwd });
      pushedThisRun = true;
    } catch (err) {
      stderr(`autofix: git push warning — ${err instanceof Error ? err.message : String(err)}\n`);
    }
    // PIA-5 — record the push success on a closure-scoped variable the
    // bail-status logic below reads. Captured in the outer scope via
    // anyIterationPushed.
    if (pushedThisRun) anyIterationPushed = true;

    // H3 #11 — write a solution sidecar so the next review cycle can
    // attach the (blocker, patch) pairs to its EpisodicEntry. On merge,
    // recordOutcome promotes them to answer-keys with `solutionPatch`.
    //
    // Semantic of sidecar.cycleNumber: it must equal the
    // episodic.cycleNumber that the NEXT review (consuming this sidecar)
    // will write. The chain:
    //   - review.ts: cycleNumber = (args.reworkCycle ?? 0) + 1
    //   - workflow: extracts cycle N from commit marker [cycle:N],
    //     re-runs review with --rework-cycle N, so review.cycleNumber = N+1
    //   - autofix: nextCycle is the MARKER's cycle (= reworkCycle + 1)
    //   - therefore the consuming review's episodic.cycleNumber = nextCycle + 1
    //
    // Earlier code wrote at `cycleNumber: nextCycle` which silently
    // off-by-one'd every handoff (sidecar key = N, lookup key = N+1).
    // The H3 #11 fullchain audit caught this; production never saw a
    // single solutionPatch make it to an answer-key.
    if (repo && typeof prNumber === "number" && committedFixes.length > 0) {
      try {
        const patches = committedFixes
          .filter((f) => typeof f.patch === "string" && f.patch.trim().length > 0)
          .map((f) => ({
            blockerCategory: f.blocker.category,
            blockerMessage: f.blocker.message,
            ...(f.blocker.file ? { blockerFile: f.blocker.file } : {}),
            ...(f.blocker.line ? { blockerLine: f.blocker.line } : {}),
            hunk: f.patch as string,
            agent: f.agent,
          }));
        if (patches.length > 0) {
          const nextReviewCycleNumber = nextCycle + 1;
          await writeSolutionSidecar(
            {
              memoryRoot,
              repo,
              pullNumber: prNumber,
              cycleNumber: nextReviewCycleNumber,
            },
            patches,
          );
        }
      } catch (err) {
        stderr(
          `autofix: solution-sidecar write failed (non-fatal) — ${(err as Error).message}\n`,
        );
      }
    }

    // v0.13.7 — wait for the deploy preview of the just-pushed commit to
    // converge before yielding to the next review. Without this, a
    // visual review can capture the STALE preview that vercel/netlify
    // hasn't redeployed yet, then flag the same regressions autofix
    // just patched. The poll exits early on success/failure, returns
    // immediately when no deploy platform is attached (fetchDeployStatus
    // → "unknown"), and bounds the total wait at 5 min by default.
    if (repo) {
      let pushedSha = "";
      try {
        const r = await git("git", ["rev-parse", "HEAD"], { cwd: args.cwd });
        pushedSha = r.stdout.trim();
      } catch {
        // If we can't read HEAD we can't poll — skip the wait.
      }
      if (pushedSha) {
        const fetchDS = deps.fetchDeployStatus ?? defaultFetchDeployStatus;
        const sleep = deps.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));
        const totalMs = deps.deployWaitTimeoutMs ?? 5 * 60_000;
        const stepMs = deps.deployWaitIntervalMs ?? 15_000;
        let status: DeployStatus = await fetchDS(repo, pushedSha).catch(() => "unknown");
        if (status === "unknown") {
          stdout(`autofix: no deploy preview detected at ${pushedSha.slice(0, 7)} — skipping deploy wait\n`);
        } else {
          const startMs = Date.now();
          while (status === "pending" && Date.now() - startMs < totalMs) {
            await sleep(stepMs);
            status = await fetchDS(repo, pushedSha).catch(() => "pending");
          }
          if (status === "success") {
            stdout(`autofix: deploy preview ready at ${pushedSha.slice(0, 7)} — re-review can run against fresh URL\n`);
          } else if (status === "failure") {
            stderr(`autofix: deploy preview FAILED at ${pushedSha.slice(0, 7)} — re-review may flag the broken UI\n`);
          } else {
            stderr(`autofix: deploy preview still pending after ${Math.round(totalMs / 60_000)}min at ${pushedSha.slice(0, 7)} — proceeding anyway\n`);
          }
        }
      }
    }

    iterations.push(
      finalizeIteration(
        i,
        fixes,
        true,
        [
          `committed:${committedFixes.length}`,
          ...(stillReadyHandlerStaged.length > 0
            ? [`handler-staged:${stillReadyHandlerStaged.length}`]
            : []),
        ],
        {
          buildOk,
          testsOk,
          ...(buildResult?.command ? { buildCommand: buildResult.command } : {}),
          ...(testResult?.command ? { testCommand: testResult.command } : {}),
        },
      ),
    );

    // v0.11 — progress: autofix iter done (success path). fixesVerified
    // counts only the committed fixes — these passed build + tests +
    // were pushed. Bailing iterations (apply-conflict, build-fail) emit
    // their own done lines via the failure-path emit below.
    if (progressEpisodicId) {
      const iterationNum = i + 1;
      const donePayload: NonNullable<Parameters<typeof emitProgress>[1]["payload"]> = {
        iteration: iterationNum,
        fixesVerified: committedFixes.length,
      };
      if (repo) donePayload.repo = repo;
      if (typeof prNumber === "number") donePayload.pullNumber = prNumber;
      await emitProgress(progressNotifiers, {
        episodicId: progressEpisodicId,
        stage: "autofix-iter-done",
        payload: donePayload,
      });
    }

    // --- Meta-review ----------------------------------------------------
    if (!deps.runReview) {
      // Production code would spawn `conclave review --pr N --json` here.
      // For v0.7, if no stub runner is wired we STOP after the first
      // successful commit and let the CI re-run review on the pushed
      // commit — the L2/L3 final gate still requires Bae's approval in
      // that path.
      stdout(`autofix: committed — awaiting re-review (no inline runReview dep; CI picks up push)\n`);
      break;
    }
    const meta = await deps.runReview({ prNumber: prNumber!, cwd: args.cwd });
    finalVerdict = meta.verdict;
    currentReviews = meta.reviews;
    if (meta.verdict === "approve") break;
    // else loop continues (if iterations remain).
  }

  // --- 5. Terminal verdict ------------------------------------------------
  const reachedMax = iterations.length >= args.maxIterations && finalVerdict !== "approve";
  let status: AutofixResultStatus;
  let mergeStatus: AutofixResult["mergeStatus"] = "not-merged";
  let code = 0;

  if (finalVerdict === "approve") {
    if (args.autonomy === "l3") {
      try {
        if (deps.mergePr) {
          await deps.mergePr(prNumber!, args.cwd);
        } else {
          await gh("gh", ["pr", "merge", String(prNumber), "--repo", repo!, "--squash"]);
        }
        mergeStatus = "merged";
        status = "approved";
        stdout(`autofix: L3 auto-merged PR #${prNumber}\n`);
      } catch (err) {
        mergeStatus = "merge-failed";
        status = "awaiting-approval";
        code = 1;
        stderr(`autofix: L3 merge failed — ${err instanceof Error ? err.message : String(err)} (falling back to awaiting-approval)\n`);
      }
    } else {
      status = "awaiting-approval";
      stdout(`autofix: complete, awaiting Bae approval (L2)\n`);
    }
  } else if (reachedMax) {
    // PIA-5 — distinguish "patch pushed; let next review verify" from
    // "actually stuck". The former is success-shaped (cycle advanced
    // via the push) and exits 0 so GitHub Actions doesn't paint red
    // and Telegram doesn't fire a misleading failure card.
    if (anyIterationPushed) {
      status = "deferred-to-next-review";
      code = 0;
      stdout(
        `autofix: pushed cycle's patch + max-iterations cap reached — deferring verdict to the next review.yml run on the new push (status=deferred-to-next-review, exit 0).\n`,
      );
    } else {
      status = "bailed-max-iterations";
      code = 1;
      stdout(
        `autofix: bailed after ${iterations.length} iterations with NO pushed patch — remaining blockers: ${remainingBlockersFrom(currentReviews).length}\n`,
      );
    }
    // UX-1 — unified summary comment via the shared renderer (replaces
    // pre-UX-1's inline ad-hoc body which only ran for the reachedMax
    // branch).
    await postBailSummary(prNumber, repo, status, {
      iterationsAttempted: iterations.length,
      totalCostUsd: totalCost,
      remainingBlockers: remainingBlockersFrom(currentReviews),
    });
  } else if (totalCost >= args.budgetUsd) {
    status = "bailed-budget";
    code = 1;
    stdout(`autofix: budget exhausted at $${totalCost.toFixed(4)}\n`);
    // UX-1 — unified summary comment.
    await postBailSummary(prNumber, repo, status, {
      iterationsAttempted: iterations.length,
      totalCostUsd: totalCost,
      remainingBlockers: remainingBlockersFrom(currentReviews),
    });
  } else {
    // Terminated early without approve — likely mid-loop break with no
    // new blockers but verdict stayed at rework.
    status = iterations.length === 0 ? "bailed-no-patches" : "awaiting-approval";
  }

  // H3 #12 — when the rework loop bails, persist a failure-catalog entry
  // so the next review (on this or any future PR with similar shape)
  // sees "this kind of thing has stalled before" via the H2 #7 active
  // gate. Best-effort: catalog write failures never propagate — autofix
  // has already done its job (or failed), and the user's verdict stands.
  const finalRemaining = remainingBlockersFrom(currentReviews);
  if (status.startsWith("bailed-") && repo) {
    try {
      const memory = new FileSystemMemoryStore({ root: memoryRoot });
      await writeReworkLoopFailure(memory, {
        repo,
        bailStatus: status,
        iterationsAttempted: iterations.length,
        totalCostUsd: totalCost,
        remainingBlockers: finalRemaining,
        ...(progressEpisodicId ? { episodicId: progressEpisodicId } : {}),
      });
    } catch (err) {
      stderr(`autofix: rework-loop-failure catalog write failed — ${(err as Error).message}\n`);
    }
  }

  // UX-4 — terminal user-facing report at the tail of runAutofix. The
  // early-return bail paths (bailed-build-failed, bailed-tests-failed,
  // bailed-no-patches both variants) call emitReviewFinishedIfTerminal
  // at their respective sites. This tail-block call covers the
  // remaining statuses (approved, awaiting-approval, deferred-to-next-
  // review, bailed-max-iterations, bailed-budget).
  let tailDeploy: DeployOutcome = "unknown";
  if (mergeStatus === "merged") tailDeploy = "success";
  const tailEmit = await emitReviewFinishedIfTerminal(
    prNumber,
    repo,
    status,
    anyIterationPushed,
    iterations,
    finalRemaining,
    totalCost,
    tailDeploy,
  );
  // UX-16 — when emitReviewFinished deferred for AF-2 retry (machine-
  // fixable items remain at non-final cycle), flip exit code so the
  // workflow's "Dispatch next cycle on autofix failure" step fires and
  // re-runs autofix on the next cycle. Without this the tail-block
  // would return code=0 (success-shaped) and AF-2 wouldn't dispatch.
  if (tailEmit.deferredForRetry && code === 0) {
    stdout(
      `autofix: flipping exit code 0 → 1 to trigger AF-2 retry dispatch (UX-16: machine-fixable items remain)\n`,
    );
    code = 1;
  }

  return {
    code,
    result: {
      status,
      iterations,
      totalCostUsd: totalCost,
      finalVerdict,
      remainingBlockers: finalRemaining,
      mergeStatus,
    },
  };
}

function finalizeIteration(
  index: number,
  fixes: BlockerFix[],
  verified: boolean,
  notes: string[],
  extra: Partial<AutofixIteration> = {},
): AutofixIteration {
  const appliedCount = fixes.filter((f) => f.status === "ready").length;
  const costUsd = fixes.reduce((n, f) => n + (f.costUsd ?? 0), 0);
  return {
    index,
    fixes,
    appliedCount,
    verified,
    costUsd,
    notes,
    ...extra,
  };
}

export function remainingBlockersFrom(reviews: readonly ReviewResult[]): Blocker[] {
  // v0.13.14 — match dedupeBlockersAcrossAgents exactly: drop category
  // from the key (agents disagree on taxonomy for the same bug — RC
  // from v0.13.6) and apply the fuzzy ±1-line same-token collapse
  // (RC from v0.13.13). Pre-fix this function still keyed on
  // `category|file|message[:60]` and called blockers "remaining" that
  // the autofix planner had already collapsed into one applied fix —
  // so operators reading the "bailed: N remaining" log saw a confusing
  // count even when the underlying fix had landed cleanly. Live-caught
  // on eventbadge#31 (cli@0.13.13 + core@0.11.14): autofix committed
  // 459fd5e correctly removing the console.log, but the bailed message
  // still said "remaining blockers: 2" because the same bug was reported
  // by Claude+OpenAI with different message-prefix wording.
  const out: Blocker[] = [];
  const accepted: Array<{ agent: string; blocker: Blocker }> = [];
  const seen = new Set<string>();
  for (const r of reviews) {
    for (const b of r.blockers) {
      if (b.severity === "nit") continue;
      const lineKey = typeof b.line === "number" ? String(b.line) : "";
      const key = `${b.file ?? ""}|${lineKey}|${b.message.slice(0, 60)}`;
      if (seen.has(key)) continue;
      if (isFuzzyDuplicate(b, accepted)) continue;
      seen.add(key);
      accepted.push({ agent: r.agent, blocker: b });
      out.push(b);
    }
  }
  return out;
}

function bailResult(status: AutofixResultStatus, reason: string, iterations: AutofixIteration[]): AutofixResult {
  return {
    status,
    iterations,
    totalCostUsd: 0,
    remainingBlockers: [],
    mergeStatus: "not-merged",
    reason,
  };
}

function buildWorker(deps: AutofixDeps, config: ConclaveConfig): WorkerLike {
  const perPrUsd = config.budget?.perPrUsd ?? 0.5;
  const gate = new EfficiencyGate({
    budget: new BudgetTracker({ perPrUsd }),
    metrics: new MetricsRecorder(),
  });
  // v0.7.4 — resolves from env, then stored credentials. Subprocess
  // spawns of `conclave review` inherit this too, so the daily paste of
  // $env:ANTHROPIC_API_KEY is gone once `conclave config` has been run.
  const apiKey = resolveKey("anthropic");
  if (!apiKey) {
    throw new Error(
      "autofix: anthropic key not set — run `conclave config` once, or export ANTHROPIC_API_KEY in CI.",
    );
  }
  const factory = deps.workerFactory ?? ((opts: ClaudeWorkerOptions) => new ClaudeWorker(opts));
  return factory({ apiKey, gate });
}

// Re-exports for tests that need types
export type { WorkerOutcome, WorkerContext };

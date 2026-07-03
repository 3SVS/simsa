import {
  runAutofix,
  parseVerdictFile,
  remainingBlockersFrom,
  defaultSpawnReview,
  defaultGit,
  defaultGh,
  defaultReadStdin,
  HARD_MAX_ITERATIONS,
  HARD_MAX_BUDGET_USD,
  DIFF_BUDGET_LINES,
  DEFAULT_BUDGET_USD,
  DEFAULT_MAX_ITERATIONS,
  REWORK_CYCLE_HARD_CEILING,
  type AutofixArgs,
  type AutofixDeps,
  type Exec,
  type WorkerOutcome,
  type WorkerContext,
} from "../autofix-pipeline.js";
import type { AutofixResult } from "@simsa/core";

// Re-exports — tests + downstream consumers (central-plane, etc.) import
// these from "@simsa/cli/dist/commands/autofix.js". Keeping the
// surface stable lets us split the orchestration body out without
// breaking call sites.
export {
  runAutofix,
  parseVerdictFile,
  remainingBlockersFrom,
  defaultSpawnReview,
  defaultGit,
  defaultGh,
  defaultReadStdin,
  HARD_MAX_ITERATIONS,
  HARD_MAX_BUDGET_USD,
  DIFF_BUDGET_LINES,
  DEFAULT_BUDGET_USD,
  DEFAULT_MAX_ITERATIONS,
  REWORK_CYCLE_HARD_CEILING,
};
export type { AutofixArgs, AutofixDeps, Exec, WorkerOutcome, WorkerContext };

const HELP = `conclave autofix — autonomous fix loop for council blockers (v0.7+)

Usage:
  conclave autofix [--pr N] [--verdict <file|->] [--budget <usd>] [--max-iterations N]
                   [--build-cmd <cmd>] [--test-cmd <cmd>] [--autonomy l2|l3]
                   [--rework-cycle N] [--cwd <dir>] [--dry-run]

Options:
  --pr N                Pull-request number (default: current branch's open PR).
  --verdict <file|->    Pre-existing Council verdict JSON. Pass a file path OR
                        '-' to read the verdict JSON from stdin (v0.7.1).
                        When omitted, autofix automatically spawns
                        'conclave review --pr N --json' as a subprocess and
                        parses its stdout — no hand-crafted verdict file needed.
  --budget <usd>        Hard cap on LLM spend. Default 3, MAX 10.
  --max-iterations N    Max fix→build→review cycles. Default 2, hard max 3.
  --build-cmd <cmd>     Explicit build command (default: auto-detect).
  --test-cmd <cmd>      Explicit test command (default: auto-detect).
  --autonomy l2|l3      l2 (default) — commits fixes, awaits Bae approval.
                        l3 — auto-merges when final verdict is approve.
  --rework-cycle N      v0.10 — current rework cycle number (0 = first attempt).
                        autofix embeds [conclave-rework-cycle:N+1] in the
                        commit it creates so review.yml's cycle extractor
                        picks up the next iteration on the re-triggered run.
                        Required when running inside the consumer-side
                        rework workflow; safe to omit for local invocation.
  --cwd <dir>           Working directory — must be checked out to the PR branch. Default '.'.
  --dry-run             Show which patches would apply; do not touch the filesystem.
  --allow-secret <id>   Allow-list a secret-guard rule id (repeatable).
  --skip-secret-guard   Disable the pre-apply secret scan (strongly discouraged).

Safety rails (all mandatory):
  - LoopGuard (per repo#pr:sha, 5 attempts / 1h window — inherited from v0.4).
  - CircuitBreaker (3 consecutive worker errors trip the circuit).
  - Secret-guard scan runs on every patch before apply (see @simsa/secret-guard).
  - File deny-list: .env* / *.pem / *.key / *secret* / *.credentials*.
  - Diff budget: 500 lines total across all patches per iteration. Tripping STOPS the loop.
  - Tests MUST pass before commit; failures revert the staged changes.
  - Hard max: 3 iterations, $10 budget. No --force override.

Environment:
  ANTHROPIC_API_KEY     required — the worker uses Claude.
`;

export function parseArgv(argv: string[]): AutofixArgs {
  const out: AutofixArgs = {
    budgetUsd: DEFAULT_BUDGET_USD,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    autonomy: "l2",
    cwd: ".",
    dryRun: false,
    help: false,
    allowSecrets: [],
    skipSecretGuard: false,
    reworkCycle: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--skip-secret-guard") out.skipSecretGuard = true;
    else if (a === "--pr" && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1]!, 10);
      if (!Number.isNaN(n)) out.pr = n;
      i += 1;
    } else if (a === "--verdict" && argv[i + 1]) {
      out.verdictFile = argv[i + 1];
      i += 1;
    } else if (a === "--budget" && argv[i + 1]) {
      const v = Number.parseFloat(argv[i + 1]!);
      if (!Number.isNaN(v) && v > 0) {
        out.budgetUsd = Math.min(v, HARD_MAX_BUDGET_USD);
      }
      i += 1;
    } else if (a === "--max-iterations" && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1]!, 10);
      if (!Number.isNaN(n) && n > 0) {
        out.maxIterations = Math.min(n, HARD_MAX_ITERATIONS);
      }
      i += 1;
    } else if (a === "--build-cmd" && argv[i + 1]) {
      out.buildCmd = argv[i + 1];
      i += 1;
    } else if (a === "--test-cmd" && argv[i + 1]) {
      out.testCmd = argv[i + 1];
      i += 1;
    } else if (a === "--autonomy" && argv[i + 1]) {
      const v = argv[i + 1];
      if (v === "l2" || v === "l3") out.autonomy = v;
      i += 1;
    } else if (a === "--cwd" && argv[i + 1]) {
      out.cwd = argv[i + 1]!;
      i += 1;
    } else if (a === "--allow-secret" && argv[i + 1]) {
      out.allowSecrets.push(argv[i + 1]!);
      i += 1;
    } else if (a === "--rework-cycle" && argv[i + 1]) {
      // v0.10 — clamp negative + non-finite to 0; clamp upper end to
      // the hard ceiling. Malformed input never crashes — autofix
      // simply behaves as a "first attempt" and the safety bound is
      // preserved.
      const n = Number.parseInt(argv[i + 1]!, 10);
      if (Number.isFinite(n) && n >= 0) {
        out.reworkCycle = Math.min(n, REWORK_CYCLE_HARD_CEILING);
      }
      i += 1;
    } else if (a === "--prd" && argv[i + 1]) {
      out.prd = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

export async function autofix(argv: string[]): Promise<void> {
  const args = parseArgv(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const { code } = await runAutofix(args);
  if (code !== 0) process.exit(code);
}

export function renderAutofixSummary(result: AutofixResult, repo: string, prNumber: number): string {
  const lines: string[] = [];
  lines.push(`── conclave autofix — ${repo}#${prNumber} ──`);
  lines.push(`  status:         ${result.status}`);
  if (result.finalVerdict) lines.push(`  final verdict:  ${result.finalVerdict}`);
  lines.push(`  iterations:     ${result.iterations.length}`);
  lines.push(`  merge status:   ${result.mergeStatus}`);
  if (result.reason) lines.push(`  reason:         ${result.reason}`);
  for (const it of result.iterations) {
    lines.push(`  iter ${it.index + 1}: ${it.appliedCount}/${it.fixes.length} patches applied, verified=${it.verified}${it.buildCommand ? `, build=${it.buildOk}` : ""}${it.testCommand ? `, tests=${it.testsOk}` : ""}`);
    for (const note of it.notes) lines.push(`    note: ${note}`);
  }
  if (result.remainingBlockers.length > 0) {
    lines.push(`  remaining blockers (${result.remainingBlockers.length}):`);
    for (const b of result.remainingBlockers.slice(0, 5)) {
      lines.push(`    [${b.severity}/${b.category}] ${b.message} ${b.file ? `(${b.file})` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * `conclave audit` — full-project health check (v0.6.0).
 *
 * Unlike `review`, which operates on a PR diff, `audit` walks the
 * current state of the repo, samples high-signal files, batches them
 * into council-sized chunks, and runs each batch through the configured
 * agents in audit mode. Findings are deduped, sorted, and emitted as a
 * GitHub issue (default), stdout, JSON, or both.
 *
 * Core principles:
 *   - Budget is MANDATORY and HARD-CAPPED at $10. Real users will forget.
 *   - Smart about what to audit — categories, recency, --max-files.
 *   - Degrades gracefully — budget exhaustion returns a PARTIAL result,
 *     never a crash.
 */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import {
  BudgetTracker,
  Council,
  EfficiencyGate,
  InMemoryPlainSummaryCache,
  MetricsRecorder,
  generatePlainSummary,
  type Agent,
  type PlainSummary,
  type PlainSummaryBlocker,
  type PlainSummaryLocale,
  type ReviewContext,
  type ReviewResult,
} from "@simsa/core";
import { ClaudeAgent } from "@simsa/agent-claude";
import { DesignAgent } from "@simsa/agent-design";
import { OpenAIAgent } from "@simsa/agent-openai";
import { GeminiAgent } from "@simsa/agent-gemini";
import { loadConfig, resolveMemoryRoot } from "../lib/config.js";
import { FileSystemMemoryStore } from "@simsa/core";
import {
  loadAuditRagContext,
  formatAuditRagTelemetry,
  type AuditRagContext,
} from "../lib/audit-rag.js";
import { loadProjectContext, loadDesignContext } from "../lib/project-context.js";
import {
  discoverAuditFiles,
  buildAuditBatches,
  DEFAULT_UI_SIGNALS,
  type AuditScope,
  type AuditCategory,
  type DiscoveredFile,
  type DiscoveryResult,
  type AuditBatch,
} from "../lib/audit-discovery.js";
import {
  aggregateFindings,
  renderAuditStdout,
  renderAuditJson,
  renderAuditIssueBody,
  type AuditReport,
  type PerBatchResult,
} from "../lib/audit-output.js";
import { ClaudeHaikuPlainSummaryLlm } from "../lib/plain-summary-llm.js";
import { renderPlainSummarySection } from "../lib/output.js";
import { resolveKey } from "../lib/credentials.js";
import {
  parseSpecMarkdown,
  classifySpecFeature,
  buildSpecReport,
  renderSpecStdout,
  renderSpecIssueBody,
} from "../lib/audit-spec.js";

const execFile = promisify(execFileCb);

// Hard ceiling — even if a user passes --budget 50, we clamp to $10.
// Rationale: new users are the audience; guardrail > flexibility.
export const HARD_BUDGET_CEILING_USD = 10;

// Conservative per-call cost estimate used for reservations. Real cost
// usually lands lower (prompt caching). Better to reserve generously and
// release nothing than to under-reserve and over-spend.
const ESTIMATED_COST_PER_BATCH_USD = 0.15;

export type AuditOutputTarget = "issue" | "stdout" | "json" | "both";
export type AuditDomain = "auto" | "code" | "design" | "mixed";

interface ParsedArgs {
  help: boolean;
  scope: AuditScope;
  budgetUsd: number;
  output: AuditOutputTarget;
  maxFiles: number;
  include: string[];
  exclude: string[];
  domain: AuditDomain;
  dryRun: boolean;
  sha?: string;
  tier1Only: boolean;
  cwd?: string;
  jsonPath?: string;
  noPlainSummary: boolean;
  plainSummaryOnly: boolean;
  plainSummaryLocale?: PlainSummaryLocale;
  specPath?: string;
}

const HELP = `conclave audit — full-project health check across the current codebase

Usage:
  conclave audit [options]

Options:
  --scope <set>       "all" (default), "ui", "code", "infra", "docs"
  --budget <usd>      hard cap on LLM spend. default $2, MAX $10
  --output <target>   "issue" (default) | "stdout" | "json" | "both"
  --max-files <N>     cap files reviewed. default 40 (sampling if repo bigger)
  --include <glob>    extra files to include (comma-separated)
  --exclude <glob>    extra files to skip (comma-separated)
  --domain <mode>     "auto" (default) | "code" | "design" | "mixed"
  --dry-run           list files that would be audited without calling LLMs
  --sha <sha>         audit state at a specific commit (default HEAD)
  --tier-1-only       skip tier-2 debate; cheaper, faster, less precise
  --cwd <path>        repo to audit (default: process.cwd())
  --json-out <path>   write JSON to a file (implies --output json if not set)
  --no-plain-summary          Disable the plain-language (non-dev) summary.
  --plain-summary-locale <en|ko>  Override the summary locale (default from config).
  --plain-summary-only        Emit ONLY the plain summary to the issue body.
  --spec <path>       feature-gap mode: classify spec bullets vs codebase
                       (deterministic, no LLM call — hermetic + cheap)

Environment:
  ANTHROPIC_API_KEY   required — primary Claude agent.
  OPENAI_API_KEY      optional — adds OpenAI agent.
  GOOGLE_API_KEY      optional — adds Gemini agent (long-context batches).

Examples:
  conclave audit                                 # default: scope=all, $2 budget, GH issue
  conclave audit --dry-run --scope ui            # preview which files would be audited
  conclave audit --budget 5 --output stdout      # larger budget, print to terminal
  conclave audit --scope code --max-files 20     # quick, cheap scan
  conclave audit --domain design --scope ui      # DesignAgent only
`;

function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    help: false,
    scope: "all",
    budgetUsd: 2,
    output: "issue",
    maxFiles: 40,
    include: [],
    exclude: [],
    domain: "auto",
    dryRun: false,
    tier1Only: false,
    noPlainSummary: false,
    plainSummaryOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--tier-1-only") out.tier1Only = true;
    else if (a === "--no-plain-summary") out.noPlainSummary = true;
    else if (a === "--plain-summary-only") out.plainSummaryOnly = true;
    else if (a === "--plain-summary-locale" && argv[i + 1]) {
      const v = argv[++i]!;
      if (v === "en" || v === "ko") out.plainSummaryLocale = v;
    } else if (a === "--scope" && argv[i + 1]) {
      const v = argv[++i]!;
      if (v === "all" || v === "ui" || v === "code" || v === "infra" || v === "docs") out.scope = v;
    } else if (a === "--budget" && argv[i + 1]) {
      const n = Number.parseFloat(argv[++i]!);
      if (!Number.isNaN(n) && n > 0) out.budgetUsd = n;
    } else if (a === "--output" && argv[i + 1]) {
      const v = argv[++i]!;
      if (v === "issue" || v === "stdout" || v === "json" || v === "both") out.output = v;
    } else if (a === "--max-files" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i]!, 10);
      if (!Number.isNaN(n) && n > 0) out.maxFiles = n;
    } else if (a === "--include" && argv[i + 1]) {
      out.include = argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--exclude" && argv[i + 1]) {
      out.exclude = argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--domain" && argv[i + 1]) {
      const v = argv[++i]!;
      if (v === "auto" || v === "code" || v === "design" || v === "mixed") out.domain = v;
    } else if (a === "--sha" && argv[i + 1]) {
      out.sha = argv[++i]!;
    } else if (a === "--cwd" && argv[i + 1]) {
      out.cwd = argv[++i]!;
    } else if (a === "--json-out" && argv[i + 1]) {
      out.jsonPath = argv[++i]!;
    } else if (a === "--spec" && argv[i + 1]) {
      out.specPath = argv[++i]!;
    }
  }
  return out;
}

async function resolveRepoSlug(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["-C", cwd, "config", "--get", "remote.origin.url"], {
      maxBuffer: 1024 * 1024,
    });
    const url = stdout.trim();
    // match git@github.com:owner/repo(.git)? or https://github.com/owner/repo(.git)?
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    // not a git repo or no origin — fall through
  }
  return path.basename(cwd);
}

async function resolveHeadSha(cwd: string, override?: string): Promise<string> {
  if (override) return override;
  try {
    const { stdout } = await execFile("git", ["-C", cwd, "rev-parse", "HEAD"], {
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "HEAD";
  }
}

function buildAgentsForDomain(
  domain: AuditDomain,
  gate: EfficiencyGate,
): { agents: Agent[]; skipped: string[]; resolvedDomain: "code" | "design" | "mixed" } {
  const skipped: string[] = [];
  const agents: Agent[] = [];
  // auto → mixed for audit (we don't have a diff to sniff from; broadest
  // coverage wins).
  const resolved: "code" | "design" | "mixed" = domain === "auto" ? "mixed" : domain;

  // v0.7.4 — resolveKey checks env, then stored credentials (~/.config/
  // conclave/credentials.json). After `conclave config` the file path is
  // sufficient, so audit runs without the shell re-exporting keys.
  const addClaude = () => {
    const key = resolveKey("anthropic");
    if (key) agents.push(new ClaudeAgent({ apiKey: key, gate }));
    else skipped.push("claude (anthropic key not set — run `conclave config`)");
  };
  const addOpenAI = () => {
    const key = resolveKey("openai");
    if (key) agents.push(new OpenAIAgent({ apiKey: key, gate }));
    else skipped.push("openai (openai key not set — run `conclave config`)");
  };
  const addGemini = () => {
    const key = resolveKey("gemini");
    if (key) agents.push(new GeminiAgent({ apiKey: key, gate }));
    else skipped.push("gemini (gemini key not set — run `conclave config`)");
  };
  const addDesign = () => {
    const key = resolveKey("anthropic");
    if (key) agents.push(new DesignAgent({ apiKey: key, gate }));
    else skipped.push("design (anthropic key not set — run `conclave config`)");
  };

  if (resolved === "code") {
    addClaude();
    addOpenAI();
    addGemini();
  } else if (resolved === "design") {
    addDesign();
  } else {
    // mixed — code agents + design
    addClaude();
    addOpenAI();
    addGemini();
    addDesign();
  }
  return { agents, skipped, resolvedDomain: resolved };
}

/**
 * H1.5 C — `conclave audit --spec <path>` mode.
 *
 * Parses a markdown spec (bullet list of intended features),
 * deterministically classifies each bullet against the codebase as
 * PRESENT / PARTIAL / MISSING, then emits a feature-gap report. No
 * LLM call — fast, free, hermetic.
 *
 * Distinct from defect-mode audit: reports what's NOT built per the
 * spec, not what's broken in what IS built.
 */
async function runSpecAudit(opts: {
  cwd: string;
  specPath: string;
  output: AuditOutputTarget;
  repo: string;
}): Promise<void> {
  const { cwd, specPath, output, repo } = opts;
  const fullSpecPath = path.isAbsolute(specPath) ? specPath : path.resolve(cwd, specPath);
  if (!fs.existsSync(fullSpecPath)) {
    process.stderr.write(`conclave audit --spec: file not found: ${fullSpecPath}\n`);
    process.exitCode = 1;
    return;
  }
  const md = fs.readFileSync(fullSpecPath, "utf8");
  const features = parseSpecMarkdown(md);
  if (features.length === 0) {
    process.stderr.write(`conclave audit --spec: ${specPath} contains no bullet items.\n`);
    return;
  }
  process.stdout.write(
    `conclave audit --spec: ${features.length} feature(s) parsed from ${specPath}\n`,
  );

  const discovery = await discoverAuditFiles({ cwd, scope: "all", maxFiles: 500 });

  const filesIn: { path: string; content: string }[] = [];
  for (const f of discovery.files) {
    const full = path.isAbsolute(f.path) ? f.path : path.join(cwd, f.path);
    try {
      const stat = fs.statSync(full);
      if (stat.size > 200 * 1024) continue;
      const content = fs.readFileSync(full, "utf8");
      filesIn.push({ path: f.path, content });
    } catch {
      // unreadable / not a regular file — skip
    }
  }

  const classifications = features.map((f) => classifySpecFeature(f, filesIn));
  const report = buildSpecReport(specPath, classifications);

  const wantStdout = output === "stdout" || output === "both";
  const wantIssue = output === "issue" || output === "both";
  const wantJson = output === "json";

  if (wantStdout) process.stdout.write(renderSpecStdout(report));
  if (wantJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (wantIssue) {
    const body = renderSpecIssueBody(report);
    const today = new Date().toISOString().slice(0, 10);
    const title = `Conclave Spec Gap — ${today}`;
    try {
      await execFile(
        "gh",
        ["issue", "create", "--title", title, "--body", body, "--repo", repo],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      process.stdout.write(`✓ issue created on ${repo}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `conclave audit --spec: gh issue create failed (${msg.slice(0, 200)}); falling back to stdout\n`,
      );
      if (output === "issue") process.stdout.write(body);
    }
  }

  if (report.missingCount > 0 || report.partialCount > 0) process.exitCode = 1;
}

export async function audit(argv: string[]): Promise<void> {
  const args = parseArgv(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const cwd = path.resolve(args.cwd ?? process.cwd());

  // H1.5 C — spec-mode short-circuits the LLM-driven audit path.
  // No budget reservations, no agents, no batches: just parse spec,
  // classify, render. Same --output semantics so callers can swap
  // between defect-mode and gap-mode without rewiring scripts.
  if (args.specPath) {
    const repo = await resolveRepoSlug(cwd);
    await runSpecAudit({ cwd, specPath: args.specPath, output: args.output, repo });
    return;
  }

  const { config } = await loadConfig(cwd);
  const { budgetUsd, maxFiles, scope } = resolveAuditOptions(args, argv, config);

  // 1. Resolve repo / sha.
  const repo = await resolveRepoSlug(cwd);
  const sha = await resolveHeadSha(cwd, args.sha);

  // 2. Discover files.
  const uiSignals =
    config.autoDetect?.uiSignals && config.autoDetect.uiSignals.length > 0
      ? config.autoDetect.uiSignals
      : DEFAULT_UI_SIGNALS;
  const discovery = await discoverAuditFiles({
    cwd,
    scope,
    maxFiles,
    include: args.include,
    exclude: args.exclude,
    uiSignals,
  });

  process.stdout.write(
    `conclave audit: repo=${repo} sha=${sha.slice(0, 12)} scope=${scope} domain=${args.domain}\n`,
  );
  process.stdout.write(`  ${discovery.reason}\n`);

  // 3. --dry-run: list + exit.
  if (args.dryRun) {
    process.stdout.write(`\nfiles that would be audited (${discovery.files.length}):\n`);
    for (const f of discovery.files) {
      process.stdout.write(`  [${f.category}] ${f.path}  (${f.sizeBytes}b)\n`);
    }
    process.stdout.write(`\n--dry-run — no LLM calls made. Budget remains $${budgetUsd.toFixed(2)}.\n`);
    return;
  }

  if (discovery.files.length === 0) {
    process.stdout.write(`conclave audit: nothing to audit. Exiting clean.\n`);
    return;
  }

  // 4. Build batches.
  const batches = await buildAuditBatches(discovery.files, cwd);
  process.stdout.write(
    `  packed into ${batches.length} batch(es), ${batches.reduce((s, b) => s + b.charCount, 0)} chars total\n`,
  );

  // 5. Wire budget + agents.
  const budget = new BudgetTracker({ perPrUsd: budgetUsd });
  budget.onWarning((spent, cap) => {
    process.stderr.write(
      `conclave audit: budget warning — spent $${spent.toFixed(4)} of $${cap.toFixed(2)} cap\n`,
    );
  });
  const metrics = new MetricsRecorder();
  const gate = new EfficiencyGate({ budget, metrics });

  const { agents, skipped, resolvedDomain } = buildAgentsForDomain(args.domain, gate);
  for (const s of skipped) {
    process.stderr.write(`conclave audit: ${s}\n`);
  }

  // v0.16.7 — RAG: pull domain-filtered answer-keys + failure-catalog
  // once before the batch loop. Audit batches share the same retrieval
  // because the corpus is repo-level, not batch-level. design audits
  // get the bundled design seeds (8 patterns + 8 failures) plus any
  // user-written .conclave/answer-keys/design entries; code audits stay
  // code-domain.
  const ctxDomain: "code" | "design" = resolvedDomain === "design" ? "design" : "code";
  const memoryRoot = resolveMemoryRoot(config, cwd);
  const memoryStore = new FileSystemMemoryStore({ root: memoryRoot });
  const ragContext = await loadAuditRagContext({ memoryStore, repo, domain: ctxDomain });
  const auditAnswerKeys = ragContext.answerKeys;
  const auditFailures = ragContext.failureCatalog;
  const ragTelemetry = formatAuditRagTelemetry(ctxDomain, ragContext);
  if (ragTelemetry) process.stderr.write(ragTelemetry);

  // v0.6.4 — auto-inject project + design context so audit findings can
  // be judged against the repo's stated purpose, not just against
  // generic "what does this file do" heuristics.
  const ctxCfg = config.context;
  const projectCtxLoaded = await loadProjectContext(cwd, {
    ...(ctxCfg?.readmeMaxChars ? { readmeMaxChars: ctxCfg.readmeMaxChars } : {}),
  });
  const designCtxLoaded =
    resolvedDomain === "design" || resolvedDomain === "mixed"
      ? await loadDesignContext(cwd, {
          ...(ctxCfg?.maxDesignReferences !== undefined
            ? { maxReferences: ctxCfg.maxDesignReferences }
            : {}),
          ...(ctxCfg?.maxDesignImageBytes !== undefined
            ? { maxImageBytes: ctxCfg.maxDesignImageBytes }
            : {}),
        })
      : {};
  if (agents.length === 0) {
    process.stderr.write(
      `conclave audit: no agents available. Set at least ANTHROPIC_API_KEY and re-run.\n`,
    );
    process.exit(1);
    return;
  }

  // 6. Council per batch. We don't escalate to tier-2 for audit by
  //    default; a single round across all agents is cheaper and usually
  //    enough. `--tier-1-only` further enforces single-round.
  const { perBatch, budgetExhausted, batchesRun } = await runAuditBatches({
    agents,
    tier1Only: args.tier1Only,
    batches,
    budget,
    repo,
    sha,
    resolvedDomain,
    auditAnswerKeys,
    auditFailures,
    projectCtx: projectCtxLoaded,
    designCtx: designCtxLoaded,
    includeDesignReferences: ctxCfg?.includeDesignReferences ?? true,
  });

  // 7. Aggregate + attribute.
  const report = buildAuditReport({
    discovery,
    perBatch,
    repo,
    sha,
    scope,
    resolvedDomain,
    budgetUsd,
    budgetExhausted,
    batchesRun,
    batchesTotal: batches.length,
    metrics,
    ragContext,
  });
  const findings = report.findings;

  // 7a. v0.6.1 — plain-language summary for non-dev stakeholders. Same
  //     cheap-LLM path as `conclave review`. Failures fall back to the
  //     original audit body.
  const plainCfg = config.output?.plainSummary;
  const plainEnabled =
    !args.noPlainSummary && (plainCfg === undefined ? true : plainCfg.enabled);
  const plainSummary = plainEnabled
    ? await generateAuditPlainSummarySafe({
        locale: args.plainSummaryLocale ?? plainCfg?.locale ?? "en",
        findings,
        discovery,
        repo,
        sha,
      })
    : undefined;

  // 8. Emit per --output.
  await emitAuditOutput({
    args,
    plainCfg,
    plainSummary,
    plainEnabled,
    report,
    repo,
  });

  // Exit code: 0 if no blockers / majors, 1 if rework-worthy, 2 if any
  // blocker. Matches review's contract.
  const hasBlocker = findings.some((f) => f.severity === "blocker");
  const hasMajor = findings.some((f) => f.severity === "major");
  if (hasBlocker) process.exit(2);
  if (hasMajor) process.exit(1);
}

/**
 * Resolves the three CLI options that can be overridden by repo config
 * (`audit.defaultBudgetUsd`, `audit.defaultMaxFiles`, `audit.defaultScope`)
 * and then clamps the budget at the hard ceiling. CLI flags always win
 * over config; the precedence check examines the raw argv so passing
 * the flag's default value explicitly still counts as "user-supplied"
 * and skips the config fallback.
 *
 * Stderr warning fires only on a real clamp — passing budget at or
 * below the ceiling stays silent.
 */
function resolveAuditOptions(
  args: ParsedArgs,
  argv: string[],
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
): { budgetUsd: number; maxFiles: number; scope: AuditScope } {
  const auditCfg = config.audit;

  let budgetUsd = args.budgetUsd;
  if (!argv.includes("--budget") && auditCfg?.defaultBudgetUsd) {
    budgetUsd = auditCfg.defaultBudgetUsd;
  }
  let maxFiles = args.maxFiles;
  if (!argv.includes("--max-files") && auditCfg?.defaultMaxFiles) {
    maxFiles = auditCfg.defaultMaxFiles;
  }
  let scope: AuditScope = args.scope;
  if (!argv.includes("--scope") && auditCfg?.defaultScope) {
    scope = auditCfg.defaultScope;
  }

  if (budgetUsd > HARD_BUDGET_CEILING_USD) {
    process.stderr.write(
      `conclave audit: --budget $${budgetUsd} exceeds hard ceiling — clamping to $${HARD_BUDGET_CEILING_USD}\n`,
    );
    budgetUsd = HARD_BUDGET_CEILING_USD;
  }

  return { budgetUsd, maxFiles, scope };
}

/**
 * Runs the council on every audit batch sequentially, respecting the
 * per-batch budget reservation. Two ways the loop can exit early:
 *   - budget remaining drops below ESTIMATED_COST_PER_BATCH_USD before
 *     a batch starts (pre-check)
 *   - the council itself throws a budget error mid-deliberation
 *     (post-check; the gate raises with /budget/i in the message)
 * Either path sets `budgetExhausted = true` and returns the partial
 * perBatch so the report still emits.
 *
 * Non-budget batch failures (e.g. a single agent crashed, network blip)
 * skip the failing batch with a stderr line and continue — losing one
 * batch is acceptable; aborting the whole audit on a transient is not.
 */
async function runAuditBatches(opts: {
  agents: Agent[];
  tier1Only: boolean;
  batches: AuditBatch[];
  budget: BudgetTracker;
  repo: string;
  sha: string;
  resolvedDomain: AuditDomain;
  auditAnswerKeys: string[];
  auditFailures: string[];
  projectCtx: Awaited<ReturnType<typeof loadProjectContext>>;
  designCtx: Awaited<ReturnType<typeof loadDesignContext>>;
  includeDesignReferences: boolean;
}): Promise<{
  perBatch: PerBatchResult[];
  budgetExhausted: boolean;
  batchesRun: number;
}> {
  const {
    agents,
    tier1Only,
    batches,
    budget,
    repo,
    sha,
    resolvedDomain,
    auditAnswerKeys,
    auditFailures,
    projectCtx,
    designCtx,
    includeDesignReferences,
  } = opts;

  const council = new Council({
    agents,
    maxRounds: tier1Only ? 1 : 2,
    enableDebate: !tier1Only,
  });

  const perBatch: PerBatchResult[] = [];
  let budgetExhausted = false;
  let batchesRun = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i]!;
    if (budget.remainingUsd < ESTIMATED_COST_PER_BATCH_USD) {
      process.stderr.write(
        `conclave audit: budget exhausted after ${batchesRun}/${batches.length} batches — returning partial result\n`,
      );
      budgetExhausted = true;
      break;
    }
    const startedBatch = Date.now();
    const ctx: ReviewContext = {
      diff: b.payload,
      repo,
      pullNumber: 0,
      newSha: sha,
      mode: "audit",
      auditFiles: b.files.map((f) => f.path),
      domain: resolvedDomain === "design" ? "design" : "code",
      answerKeys: auditAnswerKeys,
      failureCatalog: auditFailures,
    };
    if (projectCtx.projectContext) {
      ctx.projectContext = projectCtx.projectContext;
    }
    if (designCtx.designContext) {
      ctx.designContext = designCtx.designContext;
    }
    if (
      designCtx.designReferences &&
      designCtx.designReferences.length > 0 &&
      includeDesignReferences
    ) {
      ctx.designReferences = designCtx.designReferences;
    }
    let outcome;
    try {
      outcome = await council.deliberate(ctx);
    } catch (err) {
      const msg = (err as Error).message;
      if (/budget/i.test(msg)) {
        process.stderr.write(
          `conclave audit: budget exceeded mid-batch (${msg}) — returning partial result\n`,
        );
        budgetExhausted = true;
        break;
      }
      process.stderr.write(`conclave audit: batch ${i + 1} failed — ${msg}\n`);
      continue;
    }
    const batchCost = outcome.results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    perBatch.push({
      batchIndex: i,
      files: b.files,
      results: outcome.results,
      costUsd: batchCost,
      latencyMs: Date.now() - startedBatch,
    });
    batchesRun += 1;
  }

  return { perBatch, budgetExhausted, batchesRun };
}

/**
 * Aggregates per-batch council results into the final AuditReport.
 * Pure-function modulo the metrics summary snapshot — no IO, no
 * stderr. Caller passes the MetricsRecorder so the spent-USD figure
 * comes from the same source the budget guard used.
 */
function buildAuditReport(opts: {
  discovery: DiscoveryResult;
  perBatch: PerBatchResult[];
  repo: string;
  sha: string;
  scope: AuditScope;
  resolvedDomain: AuditDomain;
  budgetUsd: number;
  budgetExhausted: boolean;
  batchesRun: number;
  batchesTotal: number;
  metrics: MetricsRecorder;
  ragContext: AuditRagContext;
}): AuditReport {
  const {
    discovery,
    perBatch,
    repo,
    sha,
    scope,
    resolvedDomain,
    budgetUsd,
    budgetExhausted,
    batchesRun,
    batchesTotal,
    metrics,
    ragContext,
  } = opts;

  const fileToCategory = new Map<string, AuditCategory>();
  for (const f of discovery.files) fileToCategory.set(f.path, f.category);
  const findings = aggregateFindings(perBatch, fileToCategory);

  const perAgentAcc = new Map<
    string,
    { approvedBatches: number; reworkBatches: number; rejectBatches: number }
  >();
  for (const b of perBatch) {
    for (const r of b.results) {
      const acc =
        perAgentAcc.get(r.agent) ?? { approvedBatches: 0, reworkBatches: 0, rejectBatches: 0 };
      if (r.verdict === "approve") acc.approvedBatches += 1;
      else if (r.verdict === "rework") acc.reworkBatches += 1;
      else acc.rejectBatches += 1;
      perAgentAcc.set(r.agent, acc);
    }
  }
  const perAgentVerdict = Array.from(perAgentAcc.entries()).map(([agent, v]) => ({
    agent,
    ...v,
  }));

  return {
    repo,
    sha,
    scope,
    domain: resolvedDomain,
    filesAudited: discovery.files.length,
    filesInScope: discovery.totalMatched,
    sampled: discovery.sampled,
    discoveryReason: discovery.reason,
    findings,
    perAgentVerdict,
    budgetUsd,
    spentUsd: metrics.summary().totalCostUsd,
    budgetExhausted,
    batchesRun,
    batchesTotal,
    metrics: metrics.summary(),
    // v0.16.11 — Sprint D RAG-injection telemetry. Mirrors the values
    // logged to stderr earlier so machine-readable + human-readable
    // outputs agree.
    ragInjection: {
      answerKeysLocal: ragContext.sources.local.answerKeys,
      answerKeysPromoted: ragContext.sources.promoted.answerKeys,
      answerKeysExternal: ragContext.sources.external.answerKeys,
      answerKeysOssPatterns: ragContext.sources.ossPatterns.answerKeys,
      answerKeysSpecUpdates: ragContext.sources.specUpdates.answerKeys,
      answerKeysExternalIntel: ragContext.sources.externalIntel.answerKeys,
      failureCatalogLocal: ragContext.sources.local.failures,
      failureCatalogPromoted: ragContext.sources.promoted.failureCatalog,
      failureCatalogExternal: ragContext.sources.external.failureCatalog,
      failureCatalogOssPatterns: ragContext.sources.ossPatterns.failureCatalog,
      failureCatalogSpecUpdates: ragContext.sources.specUpdates.failureCatalog,
      failureCatalogExternalIntel: ragContext.sources.externalIntel.failureCatalog,
    },
  };
}

/**
 * Routes the AuditReport (and optional plain-language summary) into
 * whichever output target the user asked for. Stdout, JSON, GitHub
 * issue, both — plus the "plain summary only" toggle and the
 * pr-comment delivery rule that appends the plain section to the
 * issue body.
 *
 * The issue-creation path falls back to stdout when `gh issue create`
 * fails, but only if the user didn't already opt into stdout via
 * --output=both — that would double-write (RC audit-2).
 */
async function emitAuditOutput(opts: {
  args: ParsedArgs;
  plainCfg: NonNullable<Awaited<ReturnType<typeof loadConfig>>["config"]["output"]>["plainSummary"];
  plainSummary: PlainSummary | undefined;
  plainEnabled: boolean;
  report: AuditReport;
  repo: string;
}): Promise<void> {
  const { args, plainCfg, plainSummary, plainEnabled, report, repo } = opts;
  const output = args.output;
  const deliveries = plainCfg?.deliveries ?? ["telegram", "pr-comment"];
  const appendPlainToIssue =
    !!plainSummary && plainEnabled && deliveries.includes("pr-comment");
  const plainSection = plainSummary ? renderPlainSummarySection(plainSummary) : "";

  if (output === "stdout" || output === "both") {
    process.stdout.write("\n");
    if (args.plainSummaryOnly && plainSummary) {
      process.stdout.write(plainSection);
    } else {
      process.stdout.write(renderAuditStdout(report));
      if (appendPlainToIssue) process.stdout.write(plainSection);
    }
  }
  if (output === "json" || args.jsonPath) {
    const json = renderAuditJson(report);
    if (args.jsonPath) {
      await fs.promises.mkdir(path.dirname(path.resolve(args.jsonPath)), { recursive: true });
      await fs.promises.writeFile(args.jsonPath, json, "utf8");
      process.stdout.write(`\nconclave audit: wrote JSON to ${args.jsonPath}\n`);
    } else if (output === "json") {
      process.stdout.write(json);
    }
  }
  if (output === "issue" || output === "both") {
    let body = args.plainSummaryOnly && plainSummary ? plainSection.trim() : renderAuditIssueBody(report);
    if (!args.plainSummaryOnly && appendPlainToIssue) body = body + "\n\n" + plainSection.trim();
    const date = new Date().toISOString().slice(0, 10);
    const title = `Conclave Project Audit — ${date}`;
    // RC audit-1: always pass --repo so the issue lands in the right repo
    // even when the user passes --cwd pointing at a different directory than
    // process.cwd(). `repo` is resolved from the --cwd target's git remote.
    try {
      const { stdout } = await execFile(
        "gh",
        ["issue", "create", "--title", title, "--body", body, "--repo", repo],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      process.stdout.write(`\nconclave audit: opened issue — ${stdout.trim()}\n`);
    } catch (err) {
      process.stderr.write(
        `conclave audit: could not open GitHub issue (${(err as Error).message}). Falling back to stdout.\n`,
      );
      // RC audit-2: when output=both we already wrote stdout above; don't
      // double-write on issue-creation failure.
      if (output !== "both") {
        process.stdout.write("\n");
        process.stdout.write(renderAuditStdout(report));
        if (appendPlainToIssue) process.stdout.write(plainSection);
      }
    }
  }
}

/**
 * Wraps the cheap-LLM `generatePlainSummary` call with audit-specific
 * derivation: synthesize a verdict from findings (audit has no single
 * outcome), dedupe blockers into a plain-language friendly shape,
 * collect the discovery category list. Catches any LLM/cache failure
 * and degrades to `undefined` so the audit body still emits.
 */
async function generateAuditPlainSummarySafe(opts: {
  locale: PlainSummaryLocale;
  findings: ReturnType<typeof aggregateFindings>;
  discovery: { files: DiscoveredFile[]; totalMatched: number };
  repo: string;
  sha: string;
}): Promise<PlainSummary | undefined> {
  const { locale, findings, discovery, repo, sha } = opts;
  try {
    const hasBlockerOrMajor = findings.some(
      (f) => f.severity === "blocker" || f.severity === "major",
    );
    const derivedVerdict: "approve" | "rework" | "reject" =
      hasBlockerOrMajor || findings.length > 0 ? "rework" : "approve";

    const blockers: PlainSummaryBlocker[] = [];
    const seen = new Set<string>();
    for (const f of findings) {
      if (f.severity === "nit") continue;
      const sev: "major" | "minor" =
        f.severity === "blocker" || f.severity === "major" ? "major" : "minor";
      const file = f.file;
      const msg = f.message.replace(/\n+/g, " ").slice(0, 220);
      const key = `${sev}|${f.category}|${file ?? ""}|${msg.slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pb: PlainSummaryBlocker = { severity: sev, category: f.category, oneLine: msg };
      if (file) pb.file = file;
      blockers.push(pb);
    }
    const categories = Array.from(new Set(discovery.files.map((f) => f.category)));
    const summary = await generatePlainSummary(
      {
        mode: "audit",
        verdict: derivedVerdict,
        subject: { repo, sha },
        scope: {
          filesAudited: discovery.files.length,
          filesInScope: discovery.totalMatched,
          categories,
        },
        blockers,
        locale,
      },
      {
        llm: new ClaudeHaikuPlainSummaryLlm(),
        cache: new InMemoryPlainSummaryCache(),
      },
    );
    process.stderr.write(`conclave audit: plain summary ready (${locale})\n`);
    return summary;
  } catch (err) {
    process.stderr.write(
      `conclave audit: plain summary generation failed — ${(err as Error).message}\n`,
    );
    return undefined;
  }
}

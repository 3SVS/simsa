import type { Agent, PriorReview, ReviewContext, ReviewResult } from "./agent.js";
import { compact, type CompactableMessage } from "./efficiency/compact.js";

/**
 * Decision #22 — round-to-round prior compaction knobs, shared by
 * `Council` (round 2+ debate priors) and `TieredCouncil` (tier-1 →
 * tier-2 handoff priors). Enabled by default; set `enabled: false`
 * to restore the pre-wiring behavior of passing full prior text.
 */
export interface PriorCompactionOptions {
  /** Default true (decision #22: efficiency capabilities are first-class). */
  enabled?: boolean;
  /** Token budget for the priors' free-text summaries. Default 2000. */
  targetTokens?: number;
}

/** Default summary-token budget for `compactPriorReviews`. ~8KB of text. */
export const DEFAULT_PRIOR_SUMMARY_TARGET_TOKENS = 2000;

/**
 * Decision #22 — run a round's `PriorReview[]` through the efficiency
 * gate's `compact()` before it becomes the next round's `ctx.priors`.
 *
 * Structured fields (agent / verdict / blockers) are never touched —
 * they are the schema-critical debate signal. Only the free-text
 * `summary` bulk is subject to the token budget: each prior's summary
 * becomes one `CompactableMessage`, and when their combined estimate
 * exceeds `targetTokens`, `compact()` keeps as many (newest-last) as
 * fit; the rest lose their `summary` (optional in `PriorReview`, so
 * the result stays schema-valid and prompt renderers degrade
 * gracefully). Under budget → priors pass through untouched.
 */
export async function compactPriorReviews(
  priors: readonly PriorReview[],
  opts: { targetTokens?: number } = {},
): Promise<PriorReview[]> {
  const target = opts.targetTokens ?? DEFAULT_PRIOR_SUMMARY_TARGET_TOKENS;
  const messages: CompactableMessage[] = priors.map((p) => ({
    role: "assistant" as const,
    content: p.summary ?? "",
    tokens: Math.ceil((p.summary ?? "").length / 4),
  }));
  const total = messages.reduce((sum, m) => sum + m.tokens, 0);
  if (total <= target) return [...priors];
  const result = await compact(messages, { targetTokens: target });
  const kept = new Set(result.messages);
  return priors.map((p, i) => {
    const msg = messages[i];
    if (msg && kept.has(msg)) return p;
    // Summary dropped by the compactor — keep the structured signal.
    return { agent: p.agent, verdict: p.verdict, blockers: p.blockers };
  });
}

/**
 * v0.15 — Transient-error retry wrapper for individual agent.review() calls.
 *
 * Phase 2 dogfood (2026-05-06) saw Gemini 503 "Service Unavailable" mid-
 * review on ~1 in 15 PRs from Google's transient capacity pressure. Pre-
 * retry, the council marked the agent as "agent-failure" and excluded it.
 * One retry with brief backoff would have rescued it. Same applies to
 * 429 rate-limit blips, ECONNRESET / ETIMEDOUT, and 5xx upstream errors.
 *
 * Retry policy:
 *   - up to 2 retries (3 total attempts)
 *   - backoff: 1.5s, 4.5s
 *   - retry only on transient errors: 5xx, 429, ECONNRESET, ETIMEDOUT,
 *     ENETUNREACH, EAI_AGAIN, fetch failures
 *   - skip retry on 4xx (other than 429): 401/403/404 are permanent
 *
 * Best-effort: classification heuristics on err.message + err.status, since
 * agents from different SDKs surface errors differently.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  agentId: string,
  opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      if (!isTransientError(err)) break;
      const delay = baseDelayMs * Math.pow(3, attempt);
      process.stderr.write(
        `Council: ${agentId} transient failure (attempt ${attempt + 1}/${maxRetries + 1}) — retrying in ${(delay / 1000).toFixed(1)}s. ${shortError(err)}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

function shortError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  // HTTP status codes — most SDKs surface as "got status: NNN" or "status NNN" or `.status` field.
  const e = err as { status?: number; code?: string };
  if (typeof e.status === "number") {
    if (e.status === 429) return true;
    if (e.status >= 500 && e.status < 600) return true;
    if (e.status >= 400) return false; // permanent 4xx (other than 429)
  }
  // Match status by message text — Gemini SDK does "got status: 503 Service Unavailable"
  if (/\b(50[0-4]|429)\b/.test(msg)) return true;
  // Network-shaped errors regardless of code
  const code = e.code ?? "";
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND"
  ) {
    return true;
  }
  if (
    /timeout/i.test(msg) ||
    /service unavailable/i.test(msg) ||
    /rate.?limit/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /high demand/i.test(msg) ||
    /connection (reset|closed)/i.test(msg)
  ) {
    return true;
  }
  return false;
}

/**
 * H2 #10 — weighted tally shared by Council + TieredCouncil. Exported so
 * tier-2 tally and any future custom council variants can apply the same
 * agent-score-weighted reject demotion.
 *
 * Defaults: weight 1.0 for unknown agents, rejectThreshold 0.5.
 */
export function tallyWeighted(
  results: readonly ReviewResult[],
  agentWeights: ReadonlyMap<string, number>,
  rejectThreshold: number,
): { verdict: "approve" | "rework" | "reject"; consensusReached: boolean } {
  const weightOf = (agent: string): number => {
    const w = agentWeights.get(agent);
    return typeof w === "number" && Number.isFinite(w) ? w : 1.0;
  };
  const allApprove = results.every((r) => r.verdict === "approve");
  if (allApprove) return { verdict: "approve", consensusReached: true };

  const trustedReject = results.some(
    (r) => r.verdict === "reject" && weightOf(r.agent) >= rejectThreshold,
  );
  if (trustedReject) return { verdict: "reject", consensusReached: true };

  // Any other shape — including a low-weight reject — falls to rework.
  return { verdict: "rework", consensusReached: false };
}

export interface CouncilOptions {
  agents: Agent[];
  /** Cap on rounds. Default 3 (per decision #7). */
  maxRounds?: number;
  /** Set `false` to preserve legacy single-round behavior. Default `true`. */
  enableDebate?: boolean;
  /**
   * H2 #10 — agent-score-weighted reject (decision #19). Map of agent
   * id → weight in [0, 1]. Agents missing from the map default to 1.0
   * (unknown / brand new = full vote). When an agent's reject vote
   * carries a weight below `rejectThreshold`, that reject is demoted
   * to a rework signal — strong objection still blocks (any reject
   * with weight ≥ threshold), but a known-noisy reviewer can't
   * single-handedly reject the PR.
   */
  agentWeights?: ReadonlyMap<string, number>;
  /** Minimum weight for a reject vote to count as a hard block. Default 0.5. */
  rejectThreshold?: number;
  /**
   * v0.15 — transient-retry policy applied around each agent.review() call.
   * Defaults to `{ maxRetries: 2, baseDelayMs: 1500 }`. Tests typically
   * pass `{ maxRetries: 0 }` to keep call counts deterministic and fast.
   */
  retry?: { maxRetries?: number; baseDelayMs?: number };
  /**
   * Decision #22 — compact round N's priors before round N+1 sees them.
   * Defaults to `{ enabled: true, targetTokens: 2000 }`; a no-op unless
   * the priors' summaries collectively exceed the token budget, so
   * small debates are byte-identical to the pre-wiring behavior.
   */
  priorCompaction?: PriorCompactionOptions;
}

/**
 * Per-round snapshot — kept in `CouncilOutcome.roundHistory` for
 * observability. Notifiers + UI can render "Round 1 was reject, Round 2
 * flipped to rework after Claude withdrew blocker X" without Council
 * having to expose round-level behavior as a first-class contract.
 */
export interface RoundOutcome {
  round: number;
  results: ReviewResult[];
  verdict: "approve" | "rework" | "reject";
  consensusReached: boolean;
}

export interface CouncilOutcome {
  verdict: "approve" | "rework" | "reject";
  /** 1-indexed count of rounds actually executed (≤ maxRounds). */
  rounds: number;
  /**
   * FINAL-round results. Matches legacy shape so existing consumers
   * (notifiers, memory writer, CLI renderer) keep working without
   * knowing a debate happened.
   */
  results: ReviewResult[];
  consensusReached: boolean;
  /** Per-round detail, newest last. Omitted for legacy 1-round flows. */
  roundHistory?: RoundOutcome[];
  /** `true` if the loop halted on consensus before `maxRounds`. */
  earlyExit?: boolean;
}

/**
 * Council — orchestrates N agents across up to `maxRounds` of review.
 *
 * Round 1: each agent reviews independently. If consensus (all approve
 * OR any reject) → early-exit, return round-1 result.
 *
 * Round 2+: each agent re-reviews with `ctx.priors` populated from the
 * previous round's results. Agents MAY update their verdict based on
 * arguments they missed, or hold firm. Early-exit on consensus still
 * applies. After `maxRounds`, return whatever the last round produced.
 *
 * Agents that ignore `ctx.priors` simply restate their original verdict
 * — harmless; the debate just doesn't move them. Agents that use the
 * field (claude/openai/gemini all render `priors` into their prompts)
 * can actually change their mind on new arguments.
 */
export class Council {
  private readonly agents: Agent[];
  private readonly maxRounds: number;
  private readonly enableDebate: boolean;
  private readonly agentWeights: ReadonlyMap<string, number>;
  private readonly rejectThreshold: number;
  private readonly retry: { maxRetries: number; baseDelayMs: number };
  private readonly priorCompaction: { enabled: boolean; targetTokens: number };

  constructor(opts: CouncilOptions) {
    if (opts.agents.length === 0) {
      throw new Error("Council requires at least one agent");
    }
    this.agents = opts.agents;
    this.maxRounds = opts.maxRounds ?? 3;
    this.enableDebate = opts.enableDebate ?? true;
    this.agentWeights = opts.agentWeights ?? new Map();
    this.rejectThreshold = opts.rejectThreshold ?? 0.5;
    this.retry = {
      maxRetries: opts.retry?.maxRetries ?? 2,
      baseDelayMs: opts.retry?.baseDelayMs ?? 1500,
    };
    this.priorCompaction = {
      enabled: opts.priorCompaction?.enabled ?? true,
      targetTokens: opts.priorCompaction?.targetTokens ?? DEFAULT_PRIOR_SUMMARY_TARGET_TOKENS,
    };
  }

  async deliberate(ctx: ReviewContext): Promise<CouncilOutcome> {
    const roundCap = this.enableDebate ? this.maxRounds : 1;
    const roundHistory: RoundOutcome[] = [];
    let priors: PriorReview[] = [];
    let lastResults: ReviewResult[] = [];
    let lastVerdict: CouncilOutcome["verdict"] = "rework";
    let lastConsensus = false;

    for (let round = 1; round <= roundCap; round++) {
      const roundCtx: ReviewContext = { ...ctx, round };
      if (priors.length > 0) roundCtx.priors = priors;
      // Promise.allSettled — one agent failing (rate-limit, network blip,
      // provider 5xx) must NOT kill the rest of the council. Failed
      // agents drop out of this round; their failure is logged to
      // stderr and their result is synthesized as verdict="rework" with
      // a single blocker so upstream consumers still see the signal.
      //
      // v0.15 — wrap each agent call with a transient-retry helper. Phase
      // 2 dogfood (2026-05-06) repeatedly hit Gemini 503 "Service
      // Unavailable" mid-review for transient Google capacity issues; one
      // retry would have rescued the agent. The helper retries on 5xx +
      // 429 + ECONNRESET / ETIMEDOUT-shaped errors with backoff (1.5s,
      // 4.5s) and skips retry on 4xx-other-than-429 (permanent errors).
      const settled = await Promise.allSettled(
        this.agents.map((a) =>
          withTransientRetry(() => a.review(roundCtx), a.id, this.retry),
        ),
      );
      const results: ReviewResult[] = [];
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") {
          results.push(s.value);
          return;
        }
        const agent = this.agents[i];
        if (!agent) return;
        const err = s.reason instanceof Error ? s.reason : new Error(String(s.reason));
        process.stderr.write(
          `Council: ${agent.id} failed in round ${round} — ${err.message.slice(0, 300)}\n`,
        );
        results.push({
          agent: agent.id,
          verdict: "rework",
          blockers: [
            {
              severity: "major",
              category: "agent-failure",
              message: `${agent.displayName} failed: ${err.message.slice(0, 200)}`,
            },
          ],
          summary: `${agent.displayName} errored during round ${round} and was excluded from the tally.`,
        });
      });
      // Throw only if ALL agents failed — otherwise continue with the survivors.
      const anySucceeded = settled.some((s) => s.status === "fulfilled");
      if (!anySucceeded) {
        const reasons = settled
          .map((s, i) =>
            s.status === "rejected"
              ? `${this.agents[i]?.id ?? "?"}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`
              : null,
          )
          .filter(Boolean)
          .join("; ");
        throw new Error(`Council: all agents failed in round ${round} — ${reasons}`);
      }
      const tally = this.tally(results);
      roundHistory.push({
        round,
        results,
        verdict: tally.verdict,
        consensusReached: tally.consensusReached,
      });
      lastResults = results;
      lastVerdict = tally.verdict;
      lastConsensus = tally.consensusReached;

      if (tally.consensusReached) {
        return {
          verdict: tally.verdict,
          rounds: round,
          results,
          consensusReached: true,
          roundHistory,
          earlyExit: round < roundCap,
        };
      }

      priors = results.map((r) => {
        const p: PriorReview = { agent: r.agent, verdict: r.verdict, blockers: r.blockers };
        if (r.summary) p.summary = r.summary;
        return p;
      });
      // Decision #22 — compact this round's priors before round N+1
      // renders them into prompts. No-op under the token budget.
      if (this.priorCompaction.enabled) {
        priors = await compactPriorReviews(priors, {
          targetTokens: this.priorCompaction.targetTokens,
        });
      }
    }

    return {
      verdict: lastVerdict,
      rounds: roundCap,
      results: lastResults,
      consensusReached: lastConsensus,
      roundHistory,
      earlyExit: false,
    };
  }

  /**
   * Consensus rule (stable across v2.0 per decision #7, weighted per
   * H2 #10):
   *   - All approve → approve, consensus.
   *   - Any reject WITH weight ≥ rejectThreshold → reject, consensus.
   *     One trusted agent flagging a hard block is load-bearing.
   *   - Reject from a low-weight agent → demoted to rework (advisory).
   *   - Otherwise → rework, no consensus.
   */
  private tally(
    results: readonly ReviewResult[],
  ): { verdict: CouncilOutcome["verdict"]; consensusReached: boolean } {
    return tallyWeighted(results, this.agentWeights, this.rejectThreshold);
  }

  get agentCount(): number {
    return this.agents.length;
  }

  get roundLimit(): number {
    return this.maxRounds;
  }

  get debateEnabled(): boolean {
    return this.enableDebate;
  }
}

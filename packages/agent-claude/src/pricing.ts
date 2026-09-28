export interface ModelPricing {
  /** USD per 1M input tokens (non-cached). */
  inputPerMTok: number;
  /** USD per 1M cache-write input tokens. */
  cacheWritePerMTok: number;
  /** USD per 1M cache-read input tokens. */
  cacheReadPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

/**
 * Pricing table for Claude models — official Anthropic API rates, accessed
 * 2026-09-28: https://platform.claude.com/docs/en/about-claude/pricing
 * (same rows as `@simsa/agent-worker` src/pricing.ts, Train L · L-1).
 *
 * The 2026-04 table had haiku-4-5 at $0.25/$1.25 (official $1/$5 — 4× under)
 * and opus-4-7 at $15/$75 (official $5/$25 — 3× over); fixed in PR #562.
 *
 * Cache write (5m) = 1.25× base input, cache read = 0.1× base input (90% off).
 */
export const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    inputPerMTok: 3.0,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
    outputPerMTok: 15.0,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1.0,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
    outputPerMTok: 5.0,
  },
  "claude-opus-4-7": {
    inputPerMTok: 5.0,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
    outputPerMTok: 25.0,
  },
};

/**
 * Token usage in **Anthropic semantics**: `inputTokens` is `usage.input_tokens`,
 * which already EXCLUDES cache writes and reads (total prompt = input +
 * cacheCreation + cacheRead). Do not pass the total prompt size here.
 */
export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/** Compute actual USD cost from an Anthropic API usage breakdown. */
export function actualCost(model: string, usage: UsageBreakdown): number {
  // Own keys only — `PRICING[model]` is truthy for inherited keys ("constructor", "__proto__", …) → NaN cost.
  const p = Object.hasOwn(PRICING, model) ? PRICING[model] : undefined;
  if (!p) throw new Error(`pricing: unknown model "${model}"`);
  // input_tokens already excludes cache tokens — the old `input − cacheWrite − cacheRead`
  // (clamped at 0) dropped the non-cached input from billing whenever the cache hit.
  const baseInput = usage.inputTokens;
  return (
    (Math.max(0, baseInput) * p.inputPerMTok +
      (usage.cacheCreationTokens ?? 0) * p.cacheWritePerMTok +
      (usage.cacheReadTokens ?? 0) * p.cacheReadPerMTok +
      usage.outputTokens * p.outputPerMTok) /
    1_000_000
  );
}

/**
 * Pre-flight USD estimate for budget.reserve(). Pessimistic: assumes no
 * cache read (worst case) and a typical 25% output-to-input ratio.
 */
export function estimateCallCost(model: string, estimatedInputTokens: number, maxOutputTokens: number): number {
  // Own keys only — `PRICING[model]` is truthy for inherited keys ("constructor", "__proto__", …) → NaN cost.
  const p = Object.hasOwn(PRICING, model) ? PRICING[model] : undefined;
  if (!p) throw new Error(`pricing: unknown model "${model}"`);
  return (estimatedInputTokens * p.inputPerMTok + maxOutputTokens * p.outputPerMTok) / 1_000_000;
}

/**
 * beta-limits.ts — TEMPORARY per-user daily abuse caps for the free beta.
 *
 * The managed (our-key) beta is free, so these caps are the only cost defense
 * against a runaway script or a hostile loop. They are deliberately generous —
 * a real user should never hit them:
 *
 *   - PR reviews:        100 / day  (per userKey, UTC day)
 *   - project creations:  20 / day  (per userKey, UTC day; upsert re-saves of
 *                                    an existing owned project are NOT counted)
 *
 * These numbers are a stop-gap, not product policy: after open, re-tune them
 * from the captured cost_meta data (actual per-review spend) and replace with
 * real plan limits. Override per-deploy via env without a code change:
 *   BETA_REVIEW_DAILY_LIMIT / BETA_PROJECT_CREATE_DAILY_LIMIT.
 *
 * Enforcement uses consumeUserDailyLimit (workspace/rate-limit.ts) — same D1
 * table as the hourly limiter, day-bucketed, fail-open on D1 trouble.
 */
import type { Env } from "../env.js";

export const BETA_LIMITS = {
  /** Max PR review executions per userKey per UTC day. */
  reviewsPerDay: 100,
  /** Max NEW project creations per userKey per UTC day. */
  projectCreatesPerDay: 20,
} as const;

/** Daily-bucket names (workspace_rate_limit key prefix). */
export const BETA_REVIEW_DAILY_BUCKET = "beta-review-daily";
export const BETA_PROJECT_CREATE_DAILY_BUCKET = "beta-project-create-daily";

/** Parse a positive-integer env override (invalid/absent → fallback). */
function dailyLimitFromEnv(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Effective daily review cap for this deploy. */
export function betaReviewDailyLimit(env: Pick<Env, "BETA_REVIEW_DAILY_LIMIT">): number {
  return dailyLimitFromEnv(env.BETA_REVIEW_DAILY_LIMIT, BETA_LIMITS.reviewsPerDay);
}

/** Effective daily project-creation cap for this deploy. */
export function betaProjectCreateDailyLimit(
  env: Pick<Env, "BETA_PROJECT_CREATE_DAILY_LIMIT">,
): number {
  return dailyLimitFromEnv(env.BETA_PROJECT_CREATE_DAILY_LIMIT, BETA_LIMITS.projectCreatesPerDay);
}

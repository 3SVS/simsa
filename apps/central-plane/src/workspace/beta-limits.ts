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
 * Train W · W-2 (재정렬 D-7 amend [PILOT], 2026-09-28) adds the two paths that
 * start a container on our bill:
 *
 *   - inspections:  10 / day  (per userKey, UTC day) — POST …/visual-checks/run
 *   - repairs:       5 / day  (per userKey, UTC day) — POST …/:runId/repair
 *
 *   Charged only when a job is really dispatched: the slot is taken after the
 *   ownership + validation + one-active-run (409) checks, and handed back when
 *   the row cannot be saved or the container refuses the job. System-started
 *   re-inspections (verify-sweep) are NOT charged to the user — the sweep has
 *   its own per-sweep ceiling (VERIFY_SWEEP_MAX_DISPATCH in verify-sweep.ts).
 *   Over the cap → 429 dailyLimitReachedBody(). [PILOT]: the numbers may be
 *   tuned before the pilot without a code change (BETA_INSPECTION_DAILY_LIMIT /
 *   BETA_REPAIR_DAILY_LIMIT); the procedure is fixed.
 *
 * These numbers are a stop-gap, not product policy: after open, re-tune them
 * from the captured cost_meta data (actual per-review spend) and replace with
 * real plan limits. Override per-deploy via env without a code change:
 *   BETA_REVIEW_DAILY_LIMIT / BETA_PROJECT_CREATE_DAILY_LIMIT /
 *   BETA_INSPECTION_DAILY_LIMIT / BETA_REPAIR_DAILY_LIMIT.
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
  /** Train W · W-2 [PILOT]: max dispatched inspections per userKey per UTC day. */
  inspectionsPerDay: 10,
  /** Train W · W-2 [PILOT]: max dispatched repair jobs per userKey per UTC day. */
  repairsPerDay: 5,
} as const;

/** Daily-bucket names (workspace_rate_limit key prefix). */
export const BETA_REVIEW_DAILY_BUCKET = "beta-review-daily";
export const BETA_PROJECT_CREATE_DAILY_BUCKET = "beta-project-create-daily";
export const INSPECTION_DAILY_BUCKET = "inspection-daily";
export const REPAIR_DAILY_BUCKET = "repair-daily";

/** Which daily cap a 429 is about (the dashboard picks its copy by this). */
export type DailyLimitKind = "inspection" | "repair";

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

/** Effective daily inspection cap for this deploy (Train W, default 10). */
export function inspectionDailyLimit(env: Pick<Env, "BETA_INSPECTION_DAILY_LIMIT">): number {
  return dailyLimitFromEnv(env.BETA_INSPECTION_DAILY_LIMIT, BETA_LIMITS.inspectionsPerDay);
}

/** Effective daily repair cap for this deploy (Train W, default 5). */
export function repairDailyLimit(env: Pick<Env, "BETA_REPAIR_DAILY_LIMIT">): number {
  return dailyLimitFromEnv(env.BETA_REPAIR_DAILY_LIMIT, BETA_LIMITS.repairsPerDay);
}

/**
 * The 429 body of the Train W contract (server ↔ dashboard #558 readDailyLimit):
 *   { ok:false, error:"daily_limit_reached", kind, limit, resetAt }
 * resetAt is the ISO instant the day bucket rolls over (next UTC midnight); the
 * dashboard renders it in the reader's own clock.
 */
export function dailyLimitReachedBody(
  kind: DailyLimitKind,
  limit: number,
  resetAt: string,
): { ok: false; error: "daily_limit_reached"; kind: DailyLimitKind; limit: number; resetAt: string } {
  return { ok: false, error: "daily_limit_reached", kind, limit, resetAt };
}

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
 *   - inspections:  10 / day per userKey · 30 / day per network · 300 / day service-wide
 *   - repairs:       5 / day per userKey · 15 / day per network ·  20 / day service-wide
 *     (service-wide was 50 until the 2026-09-30 cost review — Bae "1번 권고대로":
 *      a repair attempt averages ~$0.50 and is now capped at $2 per job, so 20/day
 *      bounds the repair path at ~$40/day)
 *     (UTC day; POST …/visual-checks/run and POST …/:runId/repair)
 *
 *   Why three buckets (PR #561 review P1): userKey is an anonymous id the client
 *   makes up (workspace.ts: "No auth"), so the per-userKey cap stops an honest
 *   user's runaway retry, not a loop that mints a new key per call — the eval /
 *   corpus scripts already call production exactly that way. The network bucket
 *   (cf-connecting-ip as a keyed HMAC, 3× the user cap so a shared office/home network
 *   is not punished for one person) raises the bar for a single scripted source;
 *   the service bucket is the actual daily cost ceiling. The kill switches
 *   (service-switches.ts) stay the hard stop.
 *
 *   Charged only when a job is really dispatched: slots are taken after the
 *   ownership + validation + one-active-run (409) checks, atomically, one
 *   statement per bucket (rate-limit.ts consumeDailyCaps), and handed back when
 *   the row cannot be saved, a concurrent start wins, or the container refuses
 *   the job. System-started re-inspections (verify-sweep) are NOT charged to any
 *   bucket — the sweep has its own per-sweep ceiling (verify-sweep.ts).
 *
 *   Responses (dailyCapRejection):
 *     user / network full → 429 { ok:false, error:"daily_limit_reached", kind, limit,
 *                                  resetAt, scope } (+ Retry-After)
 *     service full        → 503 { ok:false, error:"inspection_disabled"|"repair_disabled",
 *                                  reason:"daily_capacity", resetAt } (+ Retry-After)
 *   The service case reuses the "paused" code on purpose: that user used nothing
 *   up, so the 429 copy ("오늘 확인 횟수를 다 썼어요") would be false for them.
 *
 *   [PILOT]: every number may be tuned before the pilot without a code change
 *   (BETA_{INSPECTION,REPAIR}_DAILY_LIMIT[_PER_IP|_GLOBAL]); the procedure is fixed.
 *
 * These numbers are a stop-gap, not product policy: after open, re-tune them
 * from the captured cost_meta data (actual per-review spend) and replace with
 * real plan limits. Override per-deploy via env without a code change:
 *   BETA_REVIEW_DAILY_LIMIT / BETA_PROJECT_CREATE_DAILY_LIMIT /
 *   BETA_INSPECTION_DAILY_LIMIT / BETA_REPAIR_DAILY_LIMIT (+ _PER_IP / _GLOBAL).
 *
 * Enforcement: reviews / project creations use consumeUserDailyLimit (soft,
 * read-then-increment); inspections / repairs use consumeDailyCaps (atomic).
 * Both live in workspace/rate-limit.ts, same D1 table, fail-open on D1 trouble.
 */
import type { Env } from "../env.js";
import type { DailyCap, DailyCapScope } from "./rate-limit.js";
import { INSPECTION_DISABLED, REPAIR_DISABLED } from "./service-switches.js";

export const BETA_LIMITS = {
  /** Max PR review executions per userKey per UTC day. */
  reviewsPerDay: 100,
  /** Max NEW project creations per userKey per UTC day. */
  projectCreatesPerDay: 20,
  /** Train W · W-2 [PILOT]: max dispatched inspections per userKey per UTC day. */
  inspectionsPerDay: 10,
  /** Train W · W-2 [PILOT]: max dispatched repair jobs per userKey per UTC day. */
  repairsPerDay: 5,
  /** [PILOT]: per network (cf-connecting-ip, keyed HMAC) per UTC day — 3× the user cap. */
  inspectionsPerDayPerIp: 30,
  repairsPerDayPerIp: 15,
  /** [PILOT]: service-wide per UTC day — the daily cost ceiling for the container paths. */
  inspectionsPerDayGlobal: 300,
  repairsPerDayGlobal: 20,
} as const;

/** Daily-bucket names (workspace_rate_limit key prefix). */
export const BETA_REVIEW_DAILY_BUCKET = "beta-review-daily";
export const BETA_PROJECT_CREATE_DAILY_BUCKET = "beta-project-create-daily";
export const INSPECTION_DAILY_BUCKET = "inspection-daily";
export const REPAIR_DAILY_BUCKET = "repair-daily";
export const INSPECTION_DAILY_IP_BUCKET = "inspection-daily-ip";
export const REPAIR_DAILY_IP_BUCKET = "repair-daily-ip";
export const INSPECTION_DAILY_GLOBAL_BUCKET = "inspection-daily-global";
export const REPAIR_DAILY_GLOBAL_BUCKET = "repair-daily-global";
/** The one key of a service-wide bucket. */
export const SERVICE_BUCKET_KEY = "all";

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

/** Per-network daily inspection cap (default 30). */
export function inspectionDailyLimitPerIp(env: Pick<Env, "BETA_INSPECTION_DAILY_LIMIT_PER_IP">): number {
  return dailyLimitFromEnv(env.BETA_INSPECTION_DAILY_LIMIT_PER_IP, BETA_LIMITS.inspectionsPerDayPerIp);
}

/** Service-wide daily inspection cap (default 300). */
export function inspectionDailyLimitGlobal(env: Pick<Env, "BETA_INSPECTION_DAILY_LIMIT_GLOBAL">): number {
  return dailyLimitFromEnv(env.BETA_INSPECTION_DAILY_LIMIT_GLOBAL, BETA_LIMITS.inspectionsPerDayGlobal);
}

/** Per-network daily repair cap (default 15). */
export function repairDailyLimitPerIp(env: Pick<Env, "BETA_REPAIR_DAILY_LIMIT_PER_IP">): number {
  return dailyLimitFromEnv(env.BETA_REPAIR_DAILY_LIMIT_PER_IP, BETA_LIMITS.repairsPerDayPerIp);
}

/** Service-wide daily repair cap (default 20 — was 50 before the 2026-09-30 cost review). */
export function repairDailyLimitGlobal(env: Pick<Env, "BETA_REPAIR_DAILY_LIMIT_GLOBAL">): number {
  return dailyLimitFromEnv(env.BETA_REPAIR_DAILY_LIMIT_GLOBAL, BETA_LIMITS.repairsPerDayGlobal);
}

/**
 * The client's network for the per-network bucket: Cloudflare's
 * `cf-connecting-ip` only. `x-forwarded-for` is NOT used — a caller can write
 * that header, and a spoofable key would make the bucket rotatable like userKey.
 * Absent (local dev, tests without the header) → no network bucket; the user
 * and service buckets still apply.
 */
export function clientNetworkKey(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip")?.trim();
  return ip ? ip : null;
}

type DailyCapEnv = Pick<
  Env,
  | "BETA_INSPECTION_DAILY_LIMIT"
  | "BETA_INSPECTION_DAILY_LIMIT_PER_IP"
  | "BETA_INSPECTION_DAILY_LIMIT_GLOBAL"
  | "BETA_REPAIR_DAILY_LIMIT"
  | "BETA_REPAIR_DAILY_LIMIT_PER_IP"
  | "BETA_REPAIR_DAILY_LIMIT_GLOBAL"
>;

/**
 * The caps one dispatch takes a slot from, in order: user → network → service.
 * The order decides which answer a caller gets when several are full (their
 * own quota first — the most specific, most actionable message).
 */
export function dailyCapsFor(
  kind: DailyLimitKind,
  env: DailyCapEnv,
  userKey: string,
  networkKey: string | null,
): DailyCap[] {
  const inspection = kind === "inspection";
  const caps: DailyCap[] = [
    {
      scope: "user",
      bucket: inspection ? INSPECTION_DAILY_BUCKET : REPAIR_DAILY_BUCKET,
      key: userKey,
      limit: inspection ? inspectionDailyLimit(env) : repairDailyLimit(env),
    },
  ];
  if (networkKey) {
    caps.push({
      scope: "network",
      bucket: inspection ? INSPECTION_DAILY_IP_BUCKET : REPAIR_DAILY_IP_BUCKET,
      key: networkKey,
      limit: inspection ? inspectionDailyLimitPerIp(env) : repairDailyLimitPerIp(env),
    });
  }
  caps.push({
    scope: "service",
    bucket: inspection ? INSPECTION_DAILY_GLOBAL_BUCKET : REPAIR_DAILY_GLOBAL_BUCKET,
    key: SERVICE_BUCKET_KEY,
    limit: inspection ? inspectionDailyLimitGlobal(env) : repairDailyLimitGlobal(env),
  });
  return caps;
}

/**
 * The 429 body of the Train W contract (server ↔ dashboard #558 readDailyLimit):
 *   { ok:false, error:"daily_limit_reached", kind, limit, resetAt }
 * resetAt is the ISO instant the day bucket rolls over (next UTC midnight); the
 * dashboard renders it in the reader's own clock. `scope` (added after the
 * PR #561 review) says whose quota ran out — "user" or "network"; clients that
 * do not know the field ignore it.
 */
export function dailyLimitReachedBody(
  kind: DailyLimitKind,
  limit: number,
  resetAt: string,
  scope: Exclude<DailyCapScope, "service"> = "user",
): {
  ok: false;
  error: "daily_limit_reached";
  kind: DailyLimitKind;
  limit: number;
  resetAt: string;
  scope: Exclude<DailyCapScope, "service">;
} {
  return { ok: false, error: "daily_limit_reached", kind, limit, resetAt, scope };
}

export type DailyCapRejection =
  | { status: 429; body: ReturnType<typeof dailyLimitReachedBody>; retryAfterSeconds: number }
  | {
      status: 503;
      body: {
        ok: false;
        error: typeof INSPECTION_DISABLED | typeof REPAIR_DISABLED;
        reason: "daily_capacity";
        resetAt: string;
      };
      retryAfterSeconds: number;
    };

/**
 * Map a full cap to the response. user / network → 429 daily_limit_reached;
 * service → 503 with the kill-switch code ("paused" copy on the dashboard) and
 * reason "daily_capacity" — capacity, not this caller's usage, ran out.
 */
export function dailyCapRejection(
  kind: DailyLimitKind,
  full: { scope: DailyCapScope; limit: number; resetAt: string; retryAfterSeconds: number },
): DailyCapRejection {
  if (full.scope === "service") {
    return {
      status: 503,
      body: {
        ok: false,
        error: kind === "inspection" ? INSPECTION_DISABLED : REPAIR_DISABLED,
        reason: "daily_capacity",
        resetAt: full.resetAt,
      },
      retryAfterSeconds: full.retryAfterSeconds,
    };
  }
  return {
    status: 429,
    body: dailyLimitReachedBody(kind, full.limit, full.resetAt, full.scope),
    retryAfterSeconds: full.retryAfterSeconds,
  };
}

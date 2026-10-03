/**
 * workspace/generation-capacity.ts — 비용 권고 ③ (2026-09-30, D-7 amend [PILOT]):
 * the daily REQUEST-COUNT ceiling of the LLM generation paths.
 *
 * Before this, the idea/spec family had only a per-IP hourly limit (20/h) and the
 * dev-spec generator a per-userKey daily limit (20/day). userKey is a client-made
 * anonymous id and IPs rotate, so a loop that changes both had no daily ceiling at
 * all. Same machinery as the container paths (#561 consumeDailyCaps: one atomic
 * conditional upsert per bucket, refundable; #566 "v1:" stored keys), two buckets per
 * kind, taken in this order:
 *
 *   network share (cf-connecting-ip, keyed HMAC) → service bucket
 *
 *   "generation" → generation-daily-ip (100) → generation-daily-global (500):
 *                  idea-to-spec-draft · check-draft (panel and council) · recommend-answer ·
 *                  unstick · fix-suggestion · document spec-draft · infer-intent · PR review
 *   "dev_spec"   → dev-spec-daily-ip (40)    → dev-spec-daily-global (200): dev-spec generate
 *
 * Why the network share (PR #576 review P1-1 · P1-3): with the service bucket alone, ONE
 * client could empty it — through infer-intent, which has no other limiter, or with
 * concurrent requests (the hourly per-IP limit reads before and counts after the LLM
 * call) — and every user's generation screens answered "paused" until UTC midnight. A
 * request refused by its network share takes nothing from the service bucket
 * (consumeDailyCaps hands the earlier slots back).
 *
 * These are request counts, not dollars (PR #576 review P2-7): one slot is one request
 * whatever it costs. See beta-limits.ts BETA_LIMITS.generationsPerDayGlobal for the
 * known gaps between "N × average cost" and real spend.
 *
 * Placement: after the request's own validation / ownership / plan / per-IP checks,
 * right before the first LLM call — a request that could never have run takes nothing.
 *
 * Full → the route answers WITHOUT calling the LLM:
 *   network share → 429 { ok:false, error:"generation_capacity", reason:"network_daily_limit", scope:"network", resetAt }
 *   service       → 503 { ok:false, error:"generation_capacity", reason:"daily_capacity",      scope:"service", resetAt }
 *   (+ Retry-After). infer-intent keeps its own 200 { ok:true, inferred:null, reason,
 *   scope, resetAt } convention. 429 for the network share follows #561 (that source used
 *   its own share up); 503 for the service bucket because that caller used nothing up —
 *   capacity ran out. The dashboard reads the error code, not the status, and shows the
 *   same honest sentence with the reset time for both.
 *
 * Refund (settle): a request that ENDED IN FAILURE and has no billed LLM call hands its
 * slots back — a vendor outage retried for an hour must not burn today's capacity and
 * then tell everyone "too many requests" after recovery. A billed failure (the model
 * answered, the answer did not parse — the #504 class) KEEPS its slots: that loop costs
 * money and is exactly what a cost ceiling must stop. Every route counts billed calls
 * with its usage sink (anthropicMessages emits one event per vendor answer, usage or
 * not), so `billedCalls: null` ("unknown") is no longer used by any route (PR #576
 * review P1-2) — it still refunds, for a caller that genuinely cannot tell.
 *
 * Fail-open like every limiter here: D1 trouble never blocks a request (rate-limit.ts).
 */
import type { Env } from "../env.js";
import { consumeDailyCaps, type DailyCap } from "./rate-limit.js";
import {
  DEV_SPEC_DAILY_GLOBAL_BUCKET,
  DEV_SPEC_DAILY_IP_BUCKET,
  GENERATION_DAILY_GLOBAL_BUCKET,
  GENERATION_DAILY_IP_BUCKET,
  SERVICE_BUCKET_KEY,
  devSpecDailyLimitGlobal,
  devSpecDailyLimitPerIp,
  generationDailyLimitGlobal,
  generationDailyLimitPerIp,
} from "./beta-limits.js";

export const GENERATION_CAPACITY_ERROR = "generation_capacity" as const;

/** Which bucket pair a generation path draws from. */
export type GenerationKind = "generation" | "dev_spec";

type GenerationCapEnv = Pick<
  Env,
  | "BETA_GENERATION_DAILY_LIMIT_GLOBAL"
  | "BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL"
  | "BETA_GENERATION_DAILY_LIMIT_PER_IP"
  | "BETA_DEV_SPEC_DAILY_LIMIT_PER_IP"
>;

/** The service-scope cap a generation of `kind` takes a slot from. */
export function generationCapacityCap(kind: GenerationKind, env: GenerationCapEnv): DailyCap {
  return kind === "dev_spec"
    ? { scope: "service", bucket: DEV_SPEC_DAILY_GLOBAL_BUCKET, key: SERVICE_BUCKET_KEY, limit: devSpecDailyLimitGlobal(env) }
    : { scope: "service", bucket: GENERATION_DAILY_GLOBAL_BUCKET, key: SERVICE_BUCKET_KEY, limit: generationDailyLimitGlobal(env) };
}

/**
 * The caps one generation takes, in order: the caller's network share (when the edge told
 * us the network — cf-connecting-ip only, see beta-limits.ts clientNetworkKey), then the
 * service bucket.
 */
export function generationCapacityCaps(kind: GenerationKind, env: GenerationCapEnv, networkKey: string | null): DailyCap[] {
  const caps: DailyCap[] = [];
  if (networkKey) {
    caps.push(
      kind === "dev_spec"
        ? { scope: "network", bucket: DEV_SPEC_DAILY_IP_BUCKET, key: networkKey, limit: devSpecDailyLimitPerIp(env) }
        : { scope: "network", bucket: GENERATION_DAILY_IP_BUCKET, key: networkKey, limit: generationDailyLimitPerIp(env) },
    );
  }
  caps.push(generationCapacityCap(kind, env));
  return caps;
}

/** Whose share ran out: this caller's network, or the whole service. */
export type GenerationCapacityScope = "network" | "service";

export type GenerationCapacityBody = {
  ok: false;
  error: typeof GENERATION_CAPACITY_ERROR;
  reason: "daily_capacity" | "network_daily_limit";
  scope: GenerationCapacityScope;
  /** ISO instant the day bucket rolls over (next UTC midnight). */
  resetAt: string;
};

export function generationCapacityBody(resetAt: string, scope: GenerationCapacityScope = "service"): GenerationCapacityBody {
  return {
    ok: false,
    error: GENERATION_CAPACITY_ERROR,
    reason: scope === "network" ? "network_daily_limit" : "daily_capacity",
    scope,
    resetAt,
  };
}

/** How a request that holds a slot ended. billedCalls: LLM calls a vendor answered (null = unknown). */
export type GenerationOutcome = { failed: boolean; billedCalls: number | null };

export type GenerationSlot =
  | {
      limited: false;
      /** Refund when failed and nothing was billed; otherwise keep. Idempotent, fail-open. */
      settle: (outcome: GenerationOutcome) => Promise<void>;
    }
  | {
      limited: true;
      /** 429 = this network's share; 503 = the service bucket. */
      status: 429 | 503;
      scope: GenerationCapacityScope;
      body: GenerationCapacityBody;
      resetAt: string;
      retryAfterSeconds: number;
    };

/**
 * Take one slot from the network share (when known) and the service bucket of `kind`,
 * atomically per bucket (rate-limit.ts consumeDailyCaps). `networkKey` is
 * clientNetworkKey(req) — pass null only where no request exists.
 */
export async function takeGenerationSlot(
  env: Env,
  kind: GenerationKind,
  networkKey: string | null,
  now: Date = new Date(),
): Promise<GenerationSlot> {
  const caps = await consumeDailyCaps(env, generationCapacityCaps(kind, env, networkKey ?? null), now);
  if (caps.limited) {
    const scope: GenerationCapacityScope = caps.scope === "network" ? "network" : "service";
    return {
      limited: true,
      status: scope === "network" ? 429 : 503,
      scope,
      body: generationCapacityBody(caps.resetAt, scope),
      resetAt: caps.resetAt,
      retryAfterSeconds: caps.retryAfterSeconds,
    };
  }
  let settled = false;
  return {
    limited: false,
    settle: async ({ failed, billedCalls }) => {
      if (settled) return;
      settled = true;
      const billed = typeof billedCalls === "number" && billedCalls > 0;
      if (failed && !billed) await caps.refund();
    },
  };
}

/** The answer for a full bucket (429 network share / 503 service), with the route's own (CORS) headers. */
export function generationCapacityResponse(
  slot: { status: 429 | 503; body: GenerationCapacityBody; retryAfterSeconds: number },
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(slot.body), {
    status: slot.status,
    headers: { "content-type": "application/json", "retry-after": String(slot.retryAfterSeconds), ...headers },
  });
}

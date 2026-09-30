/**
 * workspace/generation-capacity.ts — 비용 권고 ③ (2026-09-30, D-7 amend [PILOT]):
 * the SERVICE-WIDE daily ceiling of the LLM generation paths.
 *
 * Before this, the idea/spec family had only a per-IP hourly limit (20/h) and the
 * dev-spec generator a per-userKey daily limit (20/day). userKey is a client-made
 * anonymous id and IPs rotate, so a loop that changes both had no daily cost
 * ceiling at all. Two service buckets (beta-limits.ts), same machinery as the
 * container paths (#561 consumeDailyCaps: one atomic conditional upsert per bucket,
 * refundable; #566 "v1:" stored keys):
 *
 *   "generation" → generation-daily-global (default 500/day): idea-to-spec-draft ·
 *                  check-draft (panel and council) · recommend-answer · unstick ·
 *                  fix-suggestion · document spec-draft · infer-intent
 *   "dev_spec"   → dev-spec-daily-global   (default 200/day): dev-spec generate
 *
 * Placement: after the request's own validation / ownership / plan / per-IP checks,
 * right before the first LLM call — a request that could never have run takes nothing.
 *
 * Full → the route answers WITHOUT calling the LLM:
 *   503 { ok:false, error:"generation_capacity", reason:"daily_capacity", resetAt } + Retry-After
 * (infer-intent keeps its own 200 { ok:true, inferred:null, reason } convention). 503,
 * not 429: this caller used nothing up — capacity ran out.
 *
 * Refund (settle): a request that ENDED IN FAILURE and has no billed LLM call hands its
 * slot back — a vendor outage retried for an hour must not burn today's capacity and
 * then tell everyone "too many requests" after recovery. A billed failure (the model
 * answered, the answer did not parse — the #504 class) KEEPS its slot: that loop costs
 * money and is exactly what a cost ceiling must stop. Paths without a usage collector
 * (recommend / unstick / fix — llm-usage.ts LEDGER_NOT_METERED) cannot tell, so their
 * failures pass `billedCalls: null` and are refunded.
 *
 * Fail-open like every limiter here: D1 trouble never blocks a request (rate-limit.ts).
 */
import type { Env } from "../env.js";
import { consumeDailyCaps, type DailyCap } from "./rate-limit.js";
import {
  DEV_SPEC_DAILY_GLOBAL_BUCKET,
  GENERATION_DAILY_GLOBAL_BUCKET,
  SERVICE_BUCKET_KEY,
  devSpecDailyLimitGlobal,
  generationDailyLimitGlobal,
} from "./beta-limits.js";

export const GENERATION_CAPACITY_ERROR = "generation_capacity" as const;

/** Which service bucket a generation path draws from. */
export type GenerationKind = "generation" | "dev_spec";

type GenerationCapEnv = Pick<Env, "BETA_GENERATION_DAILY_LIMIT_GLOBAL" | "BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL">;

/** The one (service-scope) cap a generation of `kind` takes a slot from. */
export function generationCapacityCap(kind: GenerationKind, env: GenerationCapEnv): DailyCap {
  return kind === "dev_spec"
    ? { scope: "service", bucket: DEV_SPEC_DAILY_GLOBAL_BUCKET, key: SERVICE_BUCKET_KEY, limit: devSpecDailyLimitGlobal(env) }
    : { scope: "service", bucket: GENERATION_DAILY_GLOBAL_BUCKET, key: SERVICE_BUCKET_KEY, limit: generationDailyLimitGlobal(env) };
}

export type GenerationCapacityBody = {
  ok: false;
  error: typeof GENERATION_CAPACITY_ERROR;
  reason: "daily_capacity";
  /** ISO instant the day bucket rolls over (next UTC midnight). */
  resetAt: string;
};

export function generationCapacityBody(resetAt: string): GenerationCapacityBody {
  return { ok: false, error: GENERATION_CAPACITY_ERROR, reason: "daily_capacity", resetAt };
}

/** How a request that holds a slot ended. billedCalls: LLM calls with usage (null = unknown). */
export type GenerationOutcome = { failed: boolean; billedCalls: number | null };

export type GenerationSlot =
  | {
      limited: false;
      /** Refund when failed and nothing was billed; otherwise keep. Idempotent, fail-open. */
      settle: (outcome: GenerationOutcome) => Promise<void>;
    }
  | {
      limited: true;
      body: GenerationCapacityBody;
      resetAt: string;
      retryAfterSeconds: number;
    };

/** Take one slot from the service bucket of `kind` (atomic; see rate-limit.ts consumeDailyCaps). */
export async function takeGenerationSlot(env: Env, kind: GenerationKind, now: Date = new Date()): Promise<GenerationSlot> {
  const caps = await consumeDailyCaps(env, [generationCapacityCap(kind, env)], now);
  if (caps.limited) {
    return {
      limited: true,
      body: generationCapacityBody(caps.resetAt),
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

/** The 503 answer for a full bucket, with the route's own (CORS) headers. */
export function generationCapacityResponse(
  slot: { body: GenerationCapacityBody; retryAfterSeconds: number },
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(slot.body), {
    status: 503,
    headers: { "content-type": "application/json", "retry-after": String(slot.retryAfterSeconds), ...headers },
  });
}

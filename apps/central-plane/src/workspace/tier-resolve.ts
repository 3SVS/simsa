/**
 * tier-resolve.ts — userKey → D-24 티어. plan.ts(라우트)와 project-quota.ts(관문)가 함께 쓴다.
 * 순서·fail-safe는 plan.ts 머리말 참고.
 */
import type { Env } from "../env.js";
import { tierFromGrantPlan, type Tier } from "./entitlements.js";

export async function resolveTier(env: Env, userKey: string | undefined | null): Promise<Tier> {
  const key = (userKey ?? "").trim();
  if (!key) return "free";
  try {
    const grant = await env.DB.prepare(
      `SELECT plan FROM plan_grants WHERE user_key = ? AND revoked_at IS NULL`,
    )
      .bind(key)
      .first<{ plan: string }>();
    if (grant) {
      const tier = tierFromGrantPlan(grant.plan);
      if (tier !== "free") return tier;
    }
  } catch {
    /* table missing or query error → keep checking subscription */
  }
  try {
    const sub = await env.DB.prepare(
      `SELECT id FROM ls_subscriptions WHERE user_key = ? AND status = 'active' LIMIT 1`,
    )
      .bind(key)
      .first<{ id: string }>();
    if (sub) return "pro";
  } catch {
    /* fail-safe to free */
  }
  return "free";
}


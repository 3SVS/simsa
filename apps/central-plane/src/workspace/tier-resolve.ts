/**
 * tier-resolve.ts — userKey → D-24 티어. plan.ts(라우트)와 project-quota.ts(관문)·검수·수리·지시서 상한이 함께 쓴다.
 * 순서·fail-safe는 plan.ts 머리말 참고.
 *
 * ★계정 단위 티어 (2026-10-04, D-24 후속): 티어는 브라우저 키(userKey)만 보면 같은 계정의 다른 기기·브라우저에서
 * 무료로 떨어진다(로그인했는데 플랜이 사라짐). 그래서 이 userKey가 계정에 묶여 있으면(claim:
 * workspaces.legacy_user_key → created_by_auth_user_id, 또는 호출자가 세션으로 안 계정) **그 계정이 claim한 모든
 * userKey의 부여·구독 중 가장 높은 티어**를 쓴다. 순서 free < basic < pro < staff. 마이그레이션 없음(두 열 모두
 * 0048 인덱스). 조회 실패는 그 단계만 건너뛴다 — 무료 쪽으로만 실패한다(올려 주지 않는다).
 */
import type { Env } from "../env.js";
import { tierFromGrantPlan, type Tier } from "./entitlements.js";

const RANK: Readonly<Record<Tier, number>> = { free: 0, basic: 1, pro: 2, staff: 3 };

/** 둘 중 높은 티어. */
export function higherTier(a: Tier, b: Tier): Tier {
  return RANK[b] > RANK[a] ? b : a;
}

/** 이 userKey 하나의 부여·구독 티어(계정은 보지 않는다). */
async function tierOfUserKey(env: Env, key: string): Promise<Tier> {
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

/** 이 userKey를 claim한 계정(workspace-claim.ts). 없거나 실패 → null. */
export async function claimedAccountId(env: Env, userKey: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT "created_by_auth_user_id" AS creator FROM workspaces WHERE legacy_user_key = ? LIMIT 1',
    )
      .bind(userKey)
      .first<{ creator: string | null }>();
    return row?.creator ? String(row.creator) : null;
  } catch {
    return null;
  }
}

/** 계정이 claim한 모든 userKey의 부여·구독 중 가장 높은 티어. 실패 → free. */
export async function tierOfAccount(env: Env, accountId: string): Promise<Tier> {
  let best: Tier = "free";
  try {
    const grants = await env.DB.prepare(
      `SELECT g.plan AS plan FROM plan_grants g
         JOIN workspaces w ON w.legacy_user_key = g.user_key
        WHERE w.created_by_auth_user_id = ? AND g.revoked_at IS NULL`,
    )
      .bind(accountId)
      .all<{ plan: string }>();
    for (const r of grants.results ?? []) best = higherTier(best, tierFromGrantPlan(r.plan));
  } catch {
    /* keep best */
  }
  if (RANK[best] < RANK.pro) {
    try {
      const sub = await env.DB.prepare(
        `SELECT s.id AS id FROM ls_subscriptions s
           JOIN workspaces w ON w.legacy_user_key = s.user_key
          WHERE w.created_by_auth_user_id = ? AND s.status = 'active' LIMIT 1`,
      )
        .bind(accountId)
        .first<{ id: string }>();
      if (sub) best = higherTier(best, "pro");
    } catch {
      /* keep best */
    }
  }
  return best;
}

/**
 * @param opts.accountId 호출자가 이미 안 계정(세션 등). 주면 claim 조회를 건너뛴다. null = "계정 없음"을 확인함.
 */
export async function resolveTier(
  env: Env,
  userKey: string | undefined | null,
  opts: { accountId?: string | null } = {},
): Promise<Tier> {
  const key = (userKey ?? "").trim();
  if (!key) return "free";
  const own = await tierOfUserKey(env, key);
  if (own === "staff") return own;
  const accountId = opts.accountId !== undefined ? opts.accountId : await claimedAccountId(env, key);
  if (!accountId) return own;
  return higherTier(own, await tierOfAccount(env, accountId));
}

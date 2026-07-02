/**
 * workspace/marketplace-entitlement.ts
 *
 * Bridges the GitHub Marketplace subscription state (gh_marketplace_subscriptions,
 * migration 0025, upserted by the marketplace_purchase webhook) to the workspace
 * credit/allowance system.
 *
 * Resolution chain:
 *   userKey → workspace_github_connections.github_user_id
 *           → gh_marketplace_subscriptions.github_account_id
 *           → plan → includedRunsPerMonth
 *
 * Fail-safe by design: ANY error (DB failure, malformed ids) returns null,
 * which callers treat as "no entitlement" — the user falls back to the base
 * free allowance. This module never throws.
 *
 * Read-only. No D1 writes.
 */
import type { Env } from "../env.js";
import { getGitHubConnectionByUserKey } from "./github-db.js";

export type MarketplaceEntitlement = {
  planName: string;
  includedRunsPerMonth: number;
  source: "github_marketplace";
};

/**
 * Plan → included monthly review runs. Keys are lower-cased plan names
 * as they appear in marketplace_purchase.plan.name.
 *
 * Pure + exported for tests. Free plans map to 0 (= no entitlement).
 */
export const PLAN_INCLUDED_RUNS: Readonly<Record<string, number>> = {
  free: 0,
  // $3 entry tier from the GHM listing — a month of light usage, cancel anytime.
  "first-pr pass": 5,
  "first pr pass": 5,
  solo: 30,
  pro: 100,
};

/**
 * Safety net for a NEW paid listing plan that hasn't been added to
 * PLAN_INCLUDED_RUNS yet: a paying user must never be zeroed out just
 * because the mapping table lags the Marketplace listing.
 */
export const UNKNOWN_PAID_PLAN_INCLUDED_RUNS = 30;

/**
 * Map a Marketplace plan to its included monthly review runs.
 * Pure function — case-insensitive on planName.
 *
 * Unknown plan + monthly price > 0  → UNKNOWN_PAID_PLAN_INCLUDED_RUNS (safe default).
 * Unknown plan + no price           → 0 (treated as free).
 */
export function mapPlanToIncludedRuns(planName: string, monthlyPriceCents: number): number {
  const known = PLAN_INCLUDED_RUNS[planName.trim().toLowerCase()];
  if (known !== undefined) return known;
  return monthlyPriceCents > 0 ? UNKNOWN_PAID_PLAN_INCLUDED_RUNS : 0;
}

/**
 * A subscription row grants entitlement while:
 *   - status === 'active', or
 *   - status === 'pending_cancellation' AND the effective date of the
 *     pending change is still in the future (paid-through period).
 * 'cancelled' never grants entitlement.
 *
 * Pure function — exported for tests.
 */
export function isSubscriptionEntitled(
  status: string,
  effectiveDate: string | null | undefined,
  now?: Date,
): boolean {
  if (status === "active") return true;
  if (status !== "pending_cancellation") return false;
  if (!effectiveDate) return true; // no known cutoff yet — keep entitlement
  const cutoff = new Date(effectiveDate).getTime();
  if (Number.isNaN(cutoff)) return true; // unparsable date — fail open for a paying user
  return (now ?? new Date()).getTime() < cutoff;
}

/**
 * Resolve the Marketplace entitlement for a workspace user.
 *
 * Returns null when: no GitHub connection, no subscription row, subscription
 * cancelled / past its pending-cancellation cutoff, plan is free, or any DB
 * error occurs (fail-safe → base free allowance applies).
 */
export async function getMarketplaceEntitlement(
  env: Env,
  userKey: string,
  now?: Date,
): Promise<MarketplaceEntitlement | null> {
  try {
    const connection = await getGitHubConnectionByUserKey(env, userKey);
    if (!connection) return null;

    // workspace_github_connections stores the id as TEXT;
    // gh_marketplace_subscriptions.github_account_id is INTEGER.
    const githubAccountId = Number(connection.githubUserId);
    if (!Number.isFinite(githubAccountId)) return null;

    const row = await env.DB.prepare(
      `SELECT plan_name, plan_monthly_price_cents, status, effective_date
         FROM gh_marketplace_subscriptions
        WHERE github_account_id = ?
        LIMIT 1`,
    )
      .bind(githubAccountId)
      .first<{
        plan_name: string;
        plan_monthly_price_cents: number | null;
        status: string;
        effective_date: string | null;
      }>();

    if (!row) return null;
    if (!isSubscriptionEntitled(row.status, row.effective_date, now)) return null;

    const includedRunsPerMonth = mapPlanToIncludedRuns(
      row.plan_name ?? "",
      Number(row.plan_monthly_price_cents ?? 0),
    );
    if (includedRunsPerMonth <= 0) return null;

    return {
      planName: row.plan_name,
      includedRunsPerMonth,
      source: "github_marketplace",
    };
  } catch (err) {
    console.warn("[marketplace-entitlement] lookup failed (fail-safe → null):", err);
    return null;
  }
}

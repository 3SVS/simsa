/**
 * workspace/allowance-usage.ts
 *
 * Monthly allowance dry-run helper.
 *
 * Stage 22: reads current-period usage count from D1.
 * No writes. Returns null when the event has no allowance rule.
 */
import type { Env } from "../env.js";
import { getMonthlyAllowanceRule, getCurrentAllowancePeriod } from "./allowance-rules.js";

/**
 * Minimal shape an entitlement must provide to raise the monthly allowance.
 * Kept structural (not the full MarketplaceEntitlement) so pure tests can
 * inject `{ includedRunsPerMonth: 30 }` without touching D1.
 */
export type AllowanceEntitlement = {
  includedRunsPerMonth: number;
};

export type AllowanceDryRun = {
  enabled: true;
  eventType: string;
  period: "monthly";
  periodKey: string;
  includedRuns: number;
  usedThisPeriod: number;
  remainingIncludedRuns: number;
  coveredByAllowance: boolean;
  billableUnitsAfterAllowance: number;
};

export async function getAllowanceDryRun({
  env,
  userKey,
  eventType,
  now,
  entitlement,
}: {
  env: Env;
  userKey: string;
  eventType: string;
  now?: Date;
  /**
   * Optional paid-plan entitlement (e.g. GitHub Marketplace).
   * When present, its includedRunsPerMonth is ADDED to the base free
   * allowance. Resolved by the route layer (see marketplace-entitlement.ts);
   * omitted → base free allowance only, so existing callers are unchanged.
   */
  entitlement?: AllowanceEntitlement | null;
}): Promise<AllowanceDryRun | null> {
  const rule = getMonthlyAllowanceRule(eventType);
  if (!rule) return null;

  const entitlementRuns = Math.max(0, Math.floor(entitlement?.includedRunsPerMonth ?? 0));
  const includedRuns = rule.includedRuns + entitlementRuns;

  const { periodKey, periodStart, periodEnd } = getCurrentAllowancePeriod(now);

  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM workspace_usage_events
     WHERE user_key = ? AND event_type = ? AND created_at >= ? AND created_at < ?`,
  )
    .bind(userKey, eventType, periodStart, periodEnd)
    .first<{ count: number }>();

  const usedThisPeriod = result?.count ?? 0;
  const remainingIncludedRuns = Math.max(0, includedRuns - usedThisPeriod);
  const coveredByAllowance = remainingIncludedRuns > 0;
  const billableUnitsAfterAllowance = coveredByAllowance ? 0 : 1;

  return {
    enabled: true,
    eventType,
    period: "monthly",
    periodKey,
    includedRuns,
    usedThisPeriod,
    remainingIncludedRuns,
    coveredByAllowance,
    billableUnitsAfterAllowance,
  };
}

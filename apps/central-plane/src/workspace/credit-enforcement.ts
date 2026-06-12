/**
 * workspace/credit-enforcement.ts
 *
 * Credit enforcement dry-run helper.
 *
 * IMPORTANT: Stage 21 — dry-run only.
 * - actualDebitsEnabled is always false.
 * - wouldBlock=true signals that credit would be insufficient,
 *   but the feature is NEVER blocked and credits are NEVER debited.
 * - No D1 writes happen here.
 */
import type { Env } from "../env.js";
import { getBillingRule } from "./billing-rules.js";
import { getCreditBalance } from "./credits.js";
import type { CreditType } from "./credits.js";
import type { BillingStatus } from "./billing-rules.js";

export type CreditEnforcementDryRun = {
  actualDebitsEnabled: false;
  wouldBlock: boolean;
  billingStatus: BillingStatus;
  eventType: string;
  creditType?: CreditType;
  requiredCredits: number;
  currentBalance: number;
  remainingAfter: number;
  message: string;
};

function buildMessage(
  billingStatus: BillingStatus,
  wouldBlock: boolean,
  requiredCredits: number,
  creditType?: CreditType,
): string {
  if (billingStatus === "included" || billingStatus === "ignored") {
    return "이 기능은 현재 포함 기능으로 분류되어 credit이 필요하지 않습니다.";
  }
  if (billingStatus === "future_billable") {
    return "이 기능은 향후 과금 예정이지만 현재는 무료입니다.";
  }
  // billable_candidate
  const typeLabel = creditType === "review" ? "review credit" : creditType ?? "credit";
  if (wouldBlock) {
    return `${typeLabel}이 부족할 예정이지만, 현재는 테스트 기간이라 실행을 막지 않습니다.`;
  }
  return `이 실행은 ${requiredCredits} ${typeLabel}이 필요할 예정입니다. 현재는 실제 차감하지 않습니다.`;
}

export async function checkCreditEnforcementDryRun({
  env,
  userKey,
  eventType,
}: {
  env: Env;
  userKey: string;
  eventType: string;
}): Promise<CreditEnforcementDryRun> {
  const rule = getBillingRule(eventType);

  // Non-billable: no balance query needed
  if (rule.billingStatus !== "billable_candidate" || !rule.creditType || rule.creditCost <= 0) {
    return {
      actualDebitsEnabled: false,
      wouldBlock: false,
      billingStatus: rule.billingStatus,
      eventType,
      creditType: rule.creditType as CreditType | undefined,
      requiredCredits: 0,
      currentBalance: 0,
      remainingAfter: 0,
      message: buildMessage(rule.billingStatus, false, 0, rule.creditType as CreditType | undefined),
    };
  }

  const creditType = rule.creditType as CreditType;
  const requiredCredits = rule.creditCost;

  // Query balance (non-fatal: treat missing balance as 0)
  let currentBalance = 0;
  try {
    const balanceRow = await getCreditBalance(env, userKey, creditType);
    currentBalance = balanceRow?.balance ?? 0;
  } catch {
    // Balance table may not have a row yet — that's fine, treat as 0
    currentBalance = 0;
  }

  const wouldBlock = currentBalance < requiredCredits;
  const remainingAfter = Math.max(0, currentBalance - requiredCredits);

  return {
    actualDebitsEnabled: false,
    wouldBlock,
    billingStatus: rule.billingStatus,
    eventType,
    creditType,
    requiredCredits,
    currentBalance,
    remainingAfter,
    message: buildMessage(rule.billingStatus, wouldBlock, requiredCredits, creditType),
  };
}

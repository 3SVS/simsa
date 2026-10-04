// D-24 — 새 프로젝트 하루 상한 화면 문장 (docs/simsa-plan-tiers-design-2026-10-03.md).
//
// PURE — no network, no storage. 서버(GET /workspace/quota · 429 project_daily)가 준
// 숫자를 사전 문장으로 바꾼다. 단어는 전부 사전(t.quota · t.visualChecks.resetWhen)에 있다.
//
// D-24.3 [LOCKED]: 막힘은 막다른 길이 아니다 — 막히기 전에 남은 개수를 보여주고,
// 막힌 화면은 ①기존 프로젝트로 계속 ②다시 만들 수 있는 시각 ③플랜 안내 세 갈래를 준다.
// 같은 네트워크의 다른 사람 때문에 막힌 익명 사용자(limitedBy "network")에게는
// "이미 만들었어요"라고 말하지 않는다 — 그건 사실이 아니다. 로그인을 권한다.

import { formatResetAt } from "./daily-limit.mjs";

/** @param {string} tpl @param {Record<string, string>} vars */
function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** @param {unknown} tier @param {{ tierNames: Record<string, string> }} tq */
function tierName(tier, tq) {
  return (typeof tier === "string" && tq.tierNames[tier]) || tq.tierNames.free;
}

/**
 * "오늘 새 프로젝트 1개 중 1개 남았어요". 상한이 없는 수준(장비 등 50 초과)이거나
 * 남은 게 없으면 null — 남은 게 없을 때는 막힘 패널이 대신 말한다.
 * @param {{ limit: number, remaining: number } | null | undefined} quota
 * @param {{ remaining: string }} tq
 * @returns {string | null}
 */
export function quotaRemainingText(quota, tq) {
  if (!quota || !Number.isFinite(quota.limit) || !Number.isFinite(quota.remaining)) return null;
  if (quota.remaining <= 0 || quota.limit > 50) return null;
  return fill(tq.remaining, { n: String(quota.remaining), limit: String(quota.limit) });
}

/**
 * 막힘 패널의 문장들.
 * @param {{ tier: string, limit: number, resetAt: string, limitedBy: string | null }} info
 * @param {Record<string, any>} tq t.quota
 * @param {unknown} resetWords t.visualChecks.resetWhen
 * @param {{ now?: Date, timeZone?: string }} [opts]
 * @returns {{ title: string, body: string, reset: string, showSignIn: boolean }}
 */
export function projectLimitText(info, tq, resetWords, opts = {}) {
  const byNetwork = info.limitedBy === "network";
  const when = formatResetAt(info.resetAt, resetWords, opts);
  return {
    // 2026-10-03 라이브 확인에서 발견: 네트워크 때문에 막힌 사람에게 "이미 만들었어요" 제목이 떴다.
    title: byNetwork && typeof tq.limitTitleNetwork === "string" ? tq.limitTitleNetwork : tq.limitTitle,
    body: byNetwork
      ? tq.limitBodyNetwork
      : fill(tq.limitBody, { tier: tierName(info.tier, tq), limit: String(info.limit) }),
    reset: when ? fill(tq.resetAt, { when }) : tq.resetFallback,
    showSignIn: byNetwork,
  };
}

/**
 * GET /workspace/quota 결과가 "지금 막혔다"를 말하면 패널용 정보로, 아니면 null.
 * @param {{ tier: string, limit: number, remaining: number, resetAt: string, limitedBy: string | null } | null | undefined} quota
 */
export function blockedFromQuota(quota) {
  if (!quota || !(quota.remaining <= 0)) return null;
  return { tier: quota.tier, limit: quota.limit, resetAt: quota.resetAt, limitedBy: quota.limitedBy };
}

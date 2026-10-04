/**
 * D-24 T-4·T-5 — 플랜 티어 상한 화면 계약 (docs/simsa-plan-tiers-design-2026-10-03.md).
 *
 * 서버 계약(central-plane): 429 daily_limit_reached에 tier(+ 수리 월 몫이면 period:"month", resetAt=다음
 * UTC 달) · 로그인 뒤 검수는 402 plan_required(베이직부터).
 * 화면 계약(D-24.3 막힘은 막다른 길이 아니다): 월 몫은 "이번 달" 문장 · 상한·플랜 전용 기능 알림에는
 * "플랜 보기" · 일시 중지(킬스위치)에는 붙이지 않음 · 무료 사용자에게 로그인 뒤 검수는 누르기 전에 말한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readDailyLimit, errorNoticeText } from "../src/lib/daily-limit.mjs";
import { isPlanCapKey, mapRunError, runErrorNotice, runErrorTone } from "../src/lib/visual-check-run-state.mjs";
import { repairErrorNotice, repairErrorTone } from "../src/lib/repair-state.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ko = getDictionary("ko");
const en = getDictionary("en");
const NOW = new Date("2026-10-04T12:00:00Z");

const monthly = {
  ok: false, error: "daily_limit_reached", kind: "repair", limit: 3, scope: "user",
  tier: "free", period: "month", resetAt: "2026-11-01T00:00:00.000Z",
};

describe("서버 본문 읽기", () => {
  it("tier·period를 읽는다(모르는 값은 null)", () => {
    assert.deepEqual(readDailyLimit(monthly), { kind: "repair", limit: 3, resetAt: "2026-11-01T00:00:00.000Z", tier: "free", period: "month" });
    const odd = readDailyLimit({ ...monthly, tier: "enterprise", period: "year" });
    assert.equal(odd.tier, undefined);
    assert.equal(odd.period, undefined);
    assert.deepEqual(Object.keys(readDailyLimit({ ...monthly, tier: undefined, period: undefined })).sort(), ["kind", "limit", "resetAt"], "Train W shape kept");
  });
});

describe("수리 월 몫 — '오늘'이 아니라 '이번 달'", () => {
  it("period month → monthlyLimitReached · 안내 톤", () => {
    const n = repairErrorNotice(monthly);
    assert.deepEqual(n, { errorKey: "monthlyLimitReached", resetAt: "2026-11-01T00:00:00.000Z" });
    assert.equal(repairErrorTone(n.errorKey), "info");
    // 하루 상한은 그대로
    assert.equal(repairErrorNotice({ ...monthly, period: undefined, resetAt: "2026-10-05T00:00:00.000Z" }).errorKey, "dailyLimitReached");
  });

  it("KO/EN 문장 — 다음 달 날짜를 읽는 사람의 시계로", () => {
    const k = errorNoticeText(ko.visualChecks.repair.errors, "monthlyLimitReached", monthly.resetAt, ko.visualChecks.resetWhen, { now: NOW, timeZone: "Asia/Seoul" });
    assert.match(k, /^이번 달 고치기 횟수를 다 썼어요\. /);
    assert.match(k, /11월 1일/);
    assert.doesNotMatch(k, /오늘/);
    const e = errorNoticeText(en.visualChecks.repair.errors, "monthlyLimitReached", monthly.resetAt, en.visualChecks.resetWhen, { now: NOW, timeZone: "Asia/Seoul" });
    assert.match(e, /this month's fixes/);
    assert.match(e, /Nov 1/);
    // resetAt이 없으면 일반 문장
    assert.equal(
      errorNoticeText(ko.visualChecks.repair.errors, "monthlyLimitReached", null, ko.visualChecks.resetWhen),
      "이번 달 고치기 횟수를 다 썼어요. 다음 달에 다시 할 수 있어요.",
    );
  });
});

describe("로그인 뒤 검수 402", () => {
  it("plan_required → planRequired · 안내 톤 · KO/EN 문장", () => {
    assert.equal(mapRunError("plan_required"), "planRequired");
    assert.equal(runErrorNotice({ ok: false, error: "plan_required" }).errorKey, "planRequired");
    assert.equal(runErrorTone("planRequired"), "info");
    assert.match(errorNoticeText(ko.visualChecks.runErrors, "planRequired", null, ko.visualChecks.resetWhen), /베이직 플랜부터/);
    assert.match(errorNoticeText(en.visualChecks.runErrors, "planRequired", null, en.visualChecks.resetWhen), /Basic plan/);
  });
});

describe("'플랜 보기'를 붙이는 알림", () => {
  it("상한·플랜 전용 기능에만 — 일시 중지·이미 진행 중에는 아니다", () => {
    for (const k of ["dailyLimitReached", "monthlyLimitReached", "planRequired"]) assert.equal(isPlanCapKey(k), true, k);
    for (const k of ["inspectionDisabled", "repairDisabled", "runAlreadyActive", "generic", undefined]) assert.equal(isPlanCapKey(k), false, String(k));
  });

  it("사전 — KO/EN 같은 키, EN에 한글 없음", () => {
    for (const k of ["capPlanHint", "limitTitleNetwork"]) {
      assert.ok(ko.quota[k] && en.quota[k], k);
      assert.doesNotMatch(en.quota[k], /[가-힣]/);
    }
    assert.ok(ko.visualChecks.signupNeedsBasic && en.visualChecks.signupNeedsBasic);
    for (const s of [en.visualChecks.runErrors.planRequired, en.visualChecks.repair.errors.monthlyLimitReached, en.visualChecks.repair.errors.monthlyLimitReachedAt, en.visualChecks.signupNeedsBasic]) {
      assert.doesNotMatch(s, /[가-힣]/, s);
    }
  });
});

describe("화면 배선 (소스 계약)", () => {
  const vc = readFileSync(path.join(ROOT, "src/app/projects/[id]/visual-checks/page.tsx"), "utf8");
  const run = readFileSync(path.join(ROOT, "src/app/projects/[id]/visual-checks/[runId]/page.tsx"), "utf8");

  it("무료 사용자에게 로그인 뒤 검수는 비활성 + 베이직 안내 + 플랜 보기, 요청에도 싣지 않는다", () => {
    assert.match(vc, /disabled=\{signupNeedsPlan\}/);
    assert.match(vc, /t\.visualChecks\.signupNeedsBasic/);
    assert.match(vc, /withSignup && signupAvailable && !signupNeedsPlan/);
  });

  it("검수·수리 알림 세 곳 모두 상한일 때 PlanCapHint", () => {
    assert.equal((vc.match(/isPlanCapKey\(notice\.errorKey\) \? <PlanCapHint \/>/g) ?? []).length, 1);
    assert.equal((run.match(/isPlanCapKey\((?:notice|errorNotice)\.errorKey\) \? <PlanCapHint \/>/g) ?? []).length, 2);
  });
});

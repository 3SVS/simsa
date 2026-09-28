/**
 * 관측·판정 순수 함수 — 시나리오 증거 → 상태 머신 분기 A/B/C 판정.
 * 판정 규칙의 정본은 docs/billing/paddle-sandbox-2026-10.md §4 — 이 테스트가 그 표를 고정한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeSubscription,
  summarizeTransaction,
  summarizeAdjustment,
  zeroChargeCheck,
  scheduledChangeDelta,
  koreanRoundTrip,
  decideBranch,
  isSettledSuccess,
  observeReadiness,
  verdictInputsFrom,
} from "../lib/observe.mjs";
import { KO_PROJECT_NAME, fakeId } from "./helpers/fakes.mjs";

const SUB = fakeId("sub", "obs");
const txn = (id, status, grandTotal, origin = "subscription_charge") => ({
  id: fakeId("txn", id),
  status,
  origin,
  subscription_id: SUB,
  currency_code: "USD",
  billed_at: "2026-10-01T00:00:00Z",
  items: [{ price: { id: fakeId("pri", "p") }, quantity: 1 }],
  details: { totals: { subtotal: grandTotal, tax: "0", total: grandTotal, grand_total: grandTotal, fee: "0", earnings: grandTotal } },
  payments: [{ status: "captured", error_code: null, method_details: { card: { last4: "4242" } } }],
});

describe("요약 — 증거에 남길 필드만", () => {
  it("구독 요약: 상태·다음 청구·예약 변경·가격 주기·custom_data(한글)", () => {
    const s = summarizeSubscription({
      id: SUB,
      status: "trialing",
      next_billed_at: "2026-10-31T00:00:00Z",
      scheduled_change: { action: "cancel", effective_at: "2026-10-31T00:00:00Z", resume_at: null },
      items: [{ status: "trialing", price: { id: fakeId("pri", "t"), billing_cycle: { interval: "month", frequency: 1 }, trial_period: { interval: "day", frequency: 30 }, unit_price: { amount: "0", currency_code: "USD" } } }],
      custom_data: { simsa_project_name: KO_PROJECT_NAME },
      management_urls: { cancel: "https://example.invalid/secret-portal" },
    });
    assert.equal(s.status, "trialing");
    assert.equal(s.scheduled_change.action, "cancel");
    assert.equal(s.items[0].unit_amount, "0");
    assert.equal(s.custom_data.simsa_project_name, KO_PROJECT_NAME);
    assert.equal("management_urls" in s, false, "포털 URL 은 요약에 싣지 않는다");
  });
  it("거래 요약: 카드 정보 없이 상태·origin·합계", () => {
    const t = summarizeTransaction(txn("a", "completed", "19900"));
    assert.equal(t.status, "completed");
    assert.equal(t.origin, "subscription_charge");
    assert.equal(t.totals.grand_total, "19900");
    assert.ok(!JSON.stringify(t).includes("4242"));
  });
  it("Adjustment 요약: 상태·합계·payout_totals(수수료 관측)", () => {
    const a = summarizeAdjustment({
      id: fakeId("adj", "a"),
      status: "approved",
      action: "refund",
      type: "full",
      transaction_id: fakeId("txn", "a"),
      totals: { subtotal: "19900", tax: "0", total: "19900", fee: "1045", earnings: "18855", currency_code: "USD" },
      payout_totals: { fee: "1045", earnings: "18855", currency_code: "USD" },
    });
    assert.equal(a.status, "approved");
    assert.equal(a.totals.fee, "1045");
    assert.equal(a.payout_totals.earnings, "18855");
  });
  it("비정상 입력에도 죽지 않는다(외부 경계)", () => {
    assert.equal(summarizeSubscription(null), null);
    assert.equal(summarizeTransaction("x"), null);
    assert.equal(summarizeAdjustment(undefined), null);
  });
});

describe("청구 0 확인(S-B)", () => {
  it("$0 체크아웃 거래만 있으면 ok", () => {
    const r = zeroChargeCheck([txn("checkout", "completed", "0", "web")]);
    assert.deepEqual(r, { ok: true, chargedCount: 0, totalMinor: "0", offenders: [] });
  });
  it("0보다 큰 청구가 하나라도 결제·청구 상태면 실패", () => {
    const r = zeroChargeCheck([txn("checkout", "completed", "0", "web"), txn("renew", "completed", "1900", "subscription_recurring")]);
    assert.equal(r.ok, false);
    assert.equal(r.totalMinor, "1900");
    assert.deepEqual(r.offenders, [fakeId("txn", "renew")]);
  });
  it("draft·canceled 는 청구가 아니다", () => {
    assert.equal(zeroChargeCheck([txn("d", "draft", "19900"), txn("c", "canceled", "19900")]).ok, true);
  });
  it("past_due·billed 는 청구 시도로 센다(돈을 걷으려 한 것)", () => {
    assert.equal(zeroChargeCheck([txn("p", "past_due", "19900")]).ok, false);
    assert.equal(zeroChargeCheck([txn("b", "billed", "19900")]).ok, false);
  });
  it("배열이 아니면 판정 불가(ok:false)", () => {
    assert.equal(zeroChargeCheck(null).ok, false);
  });
});

describe("예약 변경 비교(S-C) · 한글 왕복", () => {
  it("charge 뒤 예약 취소가 사라졌는지", () => {
    const sc = { action: "cancel", effective_at: "2026-10-31T00:00:00Z", resume_at: null };
    assert.deepEqual(scheduledChangeDelta(sc, sc), { before: sc, after: sc, changed: false, removed: false });
    assert.deepEqual(scheduledChangeDelta(sc, null), { before: sc, after: null, changed: true, removed: true });
  });
  it("custom_data 한글 프로젝트명이 그대로 돌아오는지", () => {
    assert.equal(koreanRoundTrip(KO_PROJECT_NAME, KO_PROJECT_NAME).intact, true);
    assert.equal(koreanRoundTrip(KO_PROJECT_NAME, "(ì£¼)í\u008a¸ë£¨").intact, false);
    assert.equal(koreanRoundTrip(KO_PROJECT_NAME, undefined).intact, false);
  });
  it("정산 성공 상태", () => {
    assert.equal(isSettledSuccess("completed"), true);
    assert.equal(isSettledSuccess("paid"), true);
    assert.equal(isSettledSuccess("billed"), false);
    assert.equal(isSettledSuccess("past_due"), false);
  });
});

describe("S-F 관측 시점 · 증거 → 판정 입력", () => {
  it("만료 + 5분 여유가 지나야 ready", () => {
    const exp = "2026-10-01T01:00:00.000Z";
    assert.deepEqual(observeReadiness(exp, new Date("2026-10-01T00:50:00.000Z")), { ready: false, minutesLeft: 15 });
    assert.equal(observeReadiness(exp, new Date("2026-10-01T01:05:00.000Z")).ready, true);
    assert.equal(observeReadiness("garbage").ready, false);
  });
  it("증거 파일 모양 → decideBranch 입력(틀린 모양은 미실행 취급)", () => {
    const inputs = verdictInputsFrom({
      sa: { observations: { directCharge: { httpOk: true, transactionStatus: "completed" } } },
      sb: { observations: { zeroCharge: { ok: true } } },
      catalog: { zeroPriceAccepted: false },
    });
    assert.equal(decideBranch(inputs).branch, "A");
    assert.equal(decideBranch(verdictInputsFrom({ sa: "garbage", sb: null, catalog: null })).branch, "pending");
  });
});

describe("분기 판정 A/B/C (§4 표)", () => {
  const sbOk = { zeroCharge: { ok: true } };
  it("증거 없음 → pending", () => {
    assert.equal(decideBranch({}).branch, "pending");
  });
  it("A: trialing 직접 /charge 2xx + 거래 completed + S-B 청구 0", () => {
    const r = decideBranch({ sa: { directCharge: { httpOk: true, transactionStatus: "completed" } }, sb: sbOk });
    assert.equal(r.branch, "A");
  });
  it("A 후보지만 S-B 미실행 → pending(실패 경로 청구 0 이 확인돼야 works-or-free)", () => {
    const r = decideBranch({ sa: { directCharge: { httpOk: true, transactionStatus: "completed" } } });
    assert.equal(r.branch, "pending");
    assert.match(r.reasons.join(" "), /S-B/);
  });
  it("S-B 에서 청구가 발생했으면 어느 분기든 C", () => {
    const r = decideBranch({ sa: { directCharge: { httpOk: true, transactionStatus: "completed" } }, sb: { zeroCharge: { ok: false } } });
    assert.equal(r.branch, "C");
  });
  it("직접 청구 2xx 인데 거래 미정산 → pending", () => {
    assert.equal(decideBranch({ sa: { directCharge: { httpOk: true, transactionStatus: "billed" } }, sb: sbOk }).branch, "pending");
  });
  it("B: 직접 청구 거부 + $0 가격 허용 + activate($0) 뒤 charge 정산 + 활성화 청구 0", () => {
    const r = decideBranch({
      sa: {
        directCharge: { httpOk: false, errorCode: "some_trialing_error" },
        activateFallback: { activateOk: true, activationBilledMinor: "0", chargeHttpOk: true, transactionStatus: "completed" },
      },
      sb: sbOk,
      catalog: { zeroPriceAccepted: true },
    });
    assert.equal(r.branch, "B");
  });
  it("직접 청구 거부 + activate 경로 미실행 → pending", () => {
    const r = decideBranch({ sa: { directCharge: { httpOk: false } }, sb: sbOk, catalog: { zeroPriceAccepted: true } });
    assert.equal(r.branch, "pending");
  });
  it("C: 직접 청구 거부 + $0 가격 거부(activate 가 $19 를 청구하게 됨)", () => {
    const r = decideBranch({ sa: { directCharge: { httpOk: false } }, sb: sbOk, catalog: { zeroPriceAccepted: false } });
    assert.equal(r.branch, "C");
  });
  it("C: activate 가 0보다 큰 금액을 청구했거나 그 뒤 charge 도 실패", () => {
    const base = { directCharge: { httpOk: false } };
    assert.equal(
      decideBranch({ sa: { ...base, activateFallback: { activateOk: true, activationBilledMinor: "1900", chargeHttpOk: true, transactionStatus: "completed" } }, sb: sbOk, catalog: { zeroPriceAccepted: true } }).branch,
      "C",
    );
    assert.equal(
      decideBranch({ sa: { ...base, activateFallback: { activateOk: true, activationBilledMinor: "0", chargeHttpOk: false } }, sb: sbOk, catalog: { zeroPriceAccepted: true } }).branch,
      "C",
    );
  });
});

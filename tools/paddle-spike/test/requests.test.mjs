/**
 * 요청 본문 빌더 — charge·cancel·scheduled_change 제거·트라이얼 단축·환불 Adjustment·상품·가격.
 * 모양은 docs/billing/paddle-sandbox-2026-10.md §1(공식 문서, 2026-09-28 접근)과 일치해야 한다.
 * 잘못된 입력은 샌드박스에 보내기 전에 throw(쓰레기 엔티티 방지).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPaddleId,
  buildChargeBody,
  buildCancelBody,
  buildRemoveScheduledChangeBody,
  buildTrialNextBilledAtBody,
  buildFullRefundBody,
  buildProductBody,
  buildPriceBody,
  normalizeAmountMinor,
} from "../lib/requests.mjs";
import { PRICES, PRODUCTS, CHECKOUT_VARIANTS, findBySpikeKey, spikeCustomData, SPIKE_TAG, parseCatalog } from "../lib/catalog.mjs";
import { fakeId } from "./helpers/fakes.mjs";

const PRI = fakeId("pri", "build199");
const TXN = fakeId("txn", "paid");
const PRO = fakeId("pro", "build");

describe("charge 본문", () => {
  it("기본 = 즉시 청구 1개", () => {
    assert.deepEqual(buildChargeBody({ priceId: PRI }), {
      effective_from: "immediately",
      items: [{ price_id: PRI, quantity: 1 }],
    });
  });
  it("next_billing_period · on_payment_failure 두 값", () => {
    assert.equal(buildChargeBody({ priceId: PRI, effectiveFrom: "next_billing_period" }).effective_from, "next_billing_period");
    assert.equal(buildChargeBody({ priceId: PRI, onPaymentFailure: "apply_change" }).on_payment_failure, "apply_change");
    assert.equal(buildChargeBody({ priceId: PRI, onPaymentFailure: "prevent_change" }).on_payment_failure, "prevent_change");
  });
  it("잘못된 입력은 보내기 전에 throw", () => {
    assert.throws(() => buildChargeBody({ priceId: "pri_short" }), TypeError);
    assert.throws(() => buildChargeBody({ priceId: fakeId("pro", "x") }), TypeError);
    assert.throws(() => buildChargeBody({ priceId: PRI, effectiveFrom: "now" }), TypeError);
    assert.throws(() => buildChargeBody({ priceId: PRI, quantity: 0 }), TypeError);
    assert.throws(() => buildChargeBody({ priceId: PRI, onPaymentFailure: "retry" }), TypeError);
  });
});

describe("cancel · scheduled_change · 트라이얼 단축", () => {
  it("cancel 기본은 immediately(works-or-free 실패 경로 = 즉시 종료, 청구 0)", () => {
    assert.deepEqual(buildCancelBody(), { effective_from: "immediately" });
    assert.deepEqual(buildCancelBody({ effectiveFrom: "next_billing_period" }), { effective_from: "next_billing_period" });
    assert.throws(() => buildCancelBody({ effectiveFrom: "later" }), TypeError);
  });
  it("예약 변경 제거 = scheduled_change: null", () => {
    assert.deepEqual(buildRemoveScheduledChangeBody(), { scheduled_change: null });
  });
  it("트라이얼 단축: do_not_bill 필수 · 31분 미만 거부", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    assert.deepEqual(buildTrialNextBilledAtBody({ now, nextBilledAt: new Date("2026-10-01T00:35:00.000Z") }), {
      next_billed_at: "2026-10-01T00:35:00.000Z",
      proration_billing_mode: "do_not_bill",
    });
    assert.throws(() => buildTrialNextBilledAtBody({ now, nextBilledAt: new Date("2026-10-01T00:20:00.000Z") }), RangeError);
    assert.throws(() => buildTrialNextBilledAtBody({ now, nextBilledAt: "garbage" }), TypeError);
  });
});

describe("환불 Adjustment 본문", () => {
  it("전액 환불 = action refund · type full · transaction_id · reason", () => {
    assert.deepEqual(buildFullRefundBody({ transactionId: TXN, reason: "spike S-E: full refund observation" }), {
      action: "refund",
      type: "full",
      transaction_id: TXN,
      reason: "spike S-E: full refund observation",
    });
  });
  it("reason 비면·ID 틀리면 throw", () => {
    assert.throws(() => buildFullRefundBody({ transactionId: TXN, reason: "  " }), TypeError);
    assert.throws(() => buildFullRefundBody({ transactionId: fakeId("sub", "x"), reason: "r" }), TypeError);
  });
});

describe("상품·가격 본문", () => {
  it("일회성 가격 = billing_cycle null · trial_period null (/charge 에 쓸 수 있는 유일한 종류)", () => {
    const body = buildPriceBody({ productId: PRO, description: "one-time", amountMinor: "19900" });
    assert.equal(body.billing_cycle, null);
    assert.equal(body.trial_period, null);
    assert.deepEqual(body.unit_price, { amount: "19900", currency_code: "USD" });
  });
  it("트라이얼 가격은 반복 주기가 있어야 한다", () => {
    const ok = buildPriceBody({
      productId: PRO,
      description: "trial",
      amountMinor: "1900",
      billingCycle: { interval: "month", frequency: 1 },
      trialPeriod: { interval: "day", frequency: 30 },
    });
    assert.deepEqual(ok.trial_period, { interval: "day", frequency: 30 });
    assert.throws(
      () => buildPriceBody({ productId: PRO, description: "bad", amountMinor: "1900", trialPeriod: { interval: "day", frequency: 30 } }),
      TypeError,
    );
  });
  it("$0 은 허용(허용 여부 자체는 샌드박스가 판정) · 음수·소수·빈 값 거부", () => {
    assert.equal(normalizeAmountMinor("0"), "0");
    assert.equal(normalizeAmountMinor(2900), "2900");
    for (const bad of ["-1", "19.99", "", "01", null]) assert.throws(() => normalizeAmountMinor(bad), TypeError);
  });
  it("상품 본문 · tax_category 허용 목록", () => {
    assert.deepEqual(buildProductBody({ name: "Build guarantee", customData: { a: 1 } }), {
      name: "Build guarantee",
      tax_category: "standard",
      custom_data: { a: 1 },
    });
    assert.throws(() => buildProductBody({ name: "x", taxCategory: "gambling" }), TypeError);
  });
  it("assertPaddleId 는 26자 형식만", () => {
    assert.equal(assertPaddleId(PRI, "pri"), PRI);
    assert.throws(() => assertPaddleId(PRI + "0", "pri"), TypeError);
    assert.throws(() => assertPaddleId(PRI.toUpperCase(), "pri"), TypeError);
  });
});

describe("카탈로그 — 과제 명세와 일치", () => {
  it("상품 2개: Build guarantee · Repair fee", () => {
    assert.deepEqual(PRODUCTS.map((p) => p.name), ["Build guarantee", "Repair fee"]);
  });
  it("일회성 $199·$29 는 billing_cycle null, 카드 수집 후보 ①$19/월+30일 ②$0/월+30일(probe)", () => {
    const byKey = Object.fromEntries(PRICES.map((p) => [p.key, p]));
    assert.equal(byKey.build_once_199.amountMinor, "19900");
    assert.equal(byKey.build_once_199.billingCycle, null);
    assert.equal(byKey.repair_once_29.amountMinor, "2900");
    assert.equal(byKey.repair_once_29.billingCycle, null);
    assert.equal(byKey.card_trial_19.amountMinor, "1900");
    assert.deepEqual(byKey.card_trial_19.trialPeriod, { interval: "day", frequency: 30 });
    assert.equal(byKey.card_trial_0.amountMinor, "0");
    assert.equal(byKey.card_trial_0.probe, true);
    assert.deepEqual(CHECKOUT_VARIANTS, { trial19: "card_trial_19", trial0: "card_trial_0" });
  });
  it("멱등 키로 찾기 · 다른 스파이크 태그는 무시", () => {
    const list = [
      { id: "a", custom_data: { spike: "other", spike_key: "build_once_199" } },
      { id: "b", custom_data: spikeCustomData("build_once_199") },
    ];
    assert.equal(findBySpikeKey(list, "build_once_199").id, "b");
    assert.equal(findBySpikeKey(list, "nope"), null);
    assert.equal(findBySpikeKey(null, "x"), null);
  });
  it("catalog.json 경계 검증", () => {
    assert.equal(parseCatalog({ spikeTag: "x", products: {}, prices: {} }).ok, false);
    const ok = parseCatalog({ spikeTag: SPIKE_TAG, products: { build_guarantee: PRO }, prices: { card_trial_0: { id: null, status: "rejected" } } });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.catalog.prices.card_trial_0, { id: null, status: "rejected" });
  });
});

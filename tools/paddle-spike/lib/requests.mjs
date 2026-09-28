/**
 * requests.mjs — Paddle Billing API 요청 본문 빌더(순수 함수, 네트워크 없음).
 *
 * 본문 모양은 2026-09-28 접근한 공식 문서 기준(docs/billing/paddle-sandbox-2026-10.md §1):
 *  - POST /subscriptions/{id}/charge        { effective_from, items:[{price_id, quantity}], on_payment_failure? }
 *      effective_from ∈ immediately | next_billing_period (필수), on_payment_failure 기본 prevent_change
 *      items 1~100개, billing_cycle 이 null 인(일회성) 가격만 허용
 *  - POST /subscriptions/{id}/cancel        { effective_from }
 *  - PATCH /subscriptions/{id}              { scheduled_change: null }  → 예약 변경 제거
 *  - PATCH /subscriptions/{id} (trialing)   { next_billed_at, proration_billing_mode: "do_not_bill" }
 *      → 트라이얼 단축/연장. trialing 구독은 items·next_billed_at 만 바꿀 수 있고 do_not_bill 필수
 *  - POST /adjustments                      { action:"refund", type:"full", transaction_id, reason }
 *  - POST /products · POST /prices
 * 잘못된 입력은 요청을 보내기 전에 throw 한다(샌드박스에 쓰레기 엔티티를 남기지 않기 위해).
 */
export const EFFECTIVE_FROM = Object.freeze(["immediately", "next_billing_period"]);
export const ON_PAYMENT_FAILURE = Object.freeze(["prevent_change", "apply_change"]);
export const INTERVALS = Object.freeze(["day", "week", "month", "year"]);
export const TAX_CATEGORIES = Object.freeze([
  "standard",
  "saas",
  "digital-goods",
  "ebooks",
  "implementation-services",
  "professional-services",
  "software-programming-services",
  "training-services",
  "website-hosting",
]);

// Paddle ID 형식: 접두사 + '_' + 소문자·숫자 26자
// (API 레퍼런스 create-price 의 product_id 패턴 ^pro_[a-z\d]{26}$ — 2026-09-28 접근)
const ID_PATTERN = {
  pri: /^pri_[a-z\d]{26}$/,
  pro: /^pro_[a-z\d]{26}$/,
  sub: /^sub_[a-z\d]{26}$/,
  txn: /^txn_[a-z\d]{26}$/,
  ctm: /^ctm_[a-z\d]{26}$/,
  adj: /^adj_[a-z\d]{26}$/,
};

/** @param {unknown} id @param {keyof typeof ID_PATTERN} prefix @param {string} label */
export function assertPaddleId(id, prefix, label = "id") {
  const re = ID_PATTERN[prefix];
  if (typeof id !== "string" || !re || !re.test(id)) {
    throw new TypeError(`${label}: '${prefix}_' 로 시작하는 Paddle ID가 필요합니다`);
  }
  return id;
}

function assertEffectiveFrom(v) {
  if (!EFFECTIVE_FROM.includes(v)) {
    throw new TypeError(`effective_from 은 ${EFFECTIVE_FROM.join(" | ")} 중 하나여야 합니다 (받은 값: ${String(v)})`);
  }
  return v;
}

function assertCycle(v, label) {
  if (v === null) return null;
  if (typeof v !== "object" || v === undefined) throw new TypeError(`${label}: 객체 또는 null`);
  const { interval, frequency } = /** @type {{interval?: unknown, frequency?: unknown}} */ (v);
  if (!INTERVALS.includes(/** @type {string} */ (interval))) throw new TypeError(`${label}.interval 은 ${INTERVALS.join("|")}`);
  if (!Number.isInteger(frequency) || /** @type {number} */ (frequency) < 1) throw new TypeError(`${label}.frequency 는 1 이상의 정수`);
  return { interval, frequency };
}

/** 최소 단위 금액 문자열("19900" = $199.00). "0" 허용 — $0 가격 시도용. */
export function normalizeAmountMinor(v) {
  const s = typeof v === "number" ? String(v) : v;
  if (typeof s !== "string" || !/^(0|[1-9][0-9]{0,11})$/.test(s)) {
    throw new TypeError(`금액은 최소 단위 정수 문자열이어야 합니다(예: "19900"). 받은 값: ${String(v)}`);
  }
  return s;
}

/**
 * 일회 청구 본문.
 * @param {{ priceId: string, quantity?: number, effectiveFrom?: string, onPaymentFailure?: string }} p
 */
export function buildChargeBody(p) {
  const { priceId, quantity = 1, effectiveFrom = "immediately", onPaymentFailure } = p ?? {};
  assertPaddleId(priceId, "pri", "priceId");
  assertEffectiveFrom(effectiveFrom);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new TypeError("quantity 는 1~100 정수");
  /** @type {{ effective_from: string, items: {price_id: string, quantity: number}[], on_payment_failure?: string }} */
  const body = { effective_from: effectiveFrom, items: [{ price_id: priceId, quantity }] };
  if (onPaymentFailure !== undefined) {
    if (!ON_PAYMENT_FAILURE.includes(onPaymentFailure)) {
      throw new TypeError(`on_payment_failure 는 ${ON_PAYMENT_FAILURE.join(" | ")}`);
    }
    body.on_payment_failure = onPaymentFailure;
  }
  return body;
}

/** 취소 본문. 기본 immediately(works-or-free 실패 경로 = 청구 0 즉시 종료). */
export function buildCancelBody(p = {}) {
  const effectiveFrom = p.effectiveFrom ?? "immediately";
  assertEffectiveFrom(effectiveFrom);
  return { effective_from: effectiveFrom };
}

/** 예약된 변경(scheduled_change) 제거. */
export function buildRemoveScheduledChangeBody() {
  return { scheduled_change: null };
}

/**
 * trialing 구독의 트라이얼 단축/연장(next_billed_at 변경). 과거 시각 금지.
 * Paddle 제약: 다음 청구가 30분 이내면 구독 변경 불가 → 최소 31분 뒤를 요구한다.
 * @param {{ nextBilledAt: Date|string, now?: Date }} p
 */
export function buildTrialNextBilledAtBody(p) {
  const now = p?.now instanceof Date ? p.now : new Date();
  const at = p?.nextBilledAt instanceof Date ? p.nextBilledAt : new Date(String(p?.nextBilledAt));
  if (Number.isNaN(at.getTime())) throw new TypeError("nextBilledAt 이 올바른 시각이 아닙니다");
  if (at.getTime() - now.getTime() < 31 * 60 * 1000) {
    throw new RangeError("nextBilledAt 은 지금으로부터 31분 이후여야 합니다(30분 이내면 Paddle이 변경을 막음)");
  }
  return { next_billed_at: at.toISOString(), proration_billing_mode: "do_not_bill" };
}

/**
 * 전액 환불 Adjustment 본문.
 * @param {{ transactionId: string, reason: string }} p
 */
export function buildFullRefundBody(p) {
  assertPaddleId(p?.transactionId, "txn", "transactionId");
  const reason = typeof p?.reason === "string" ? p.reason.trim() : "";
  if (reason === "") throw new TypeError("reason 은 비어 있을 수 없습니다(Paddle 필수 필드)");
  return { action: "refund", type: "full", transaction_id: p.transactionId, reason };
}

/**
 * 상품 본문.
 * @param {{ name: string, taxCategory?: string, description?: string, customData?: Record<string, unknown> }} p
 */
export function buildProductBody(p) {
  const name = typeof p?.name === "string" ? p.name.trim() : "";
  if (name.length < 1 || name.length > 200) throw new TypeError("상품 name 은 1~200자");
  const taxCategory = p.taxCategory ?? "standard";
  if (!TAX_CATEGORIES.includes(taxCategory)) throw new TypeError(`tax_category 가 허용 목록에 없습니다: ${taxCategory}`);
  /** @type {Record<string, unknown>} */
  const body = { name, tax_category: taxCategory };
  if (typeof p.description === "string" && p.description.trim() !== "") body.description = p.description.trim();
  if (p.customData !== undefined) body.custom_data = p.customData;
  return body;
}

/**
 * 가격 본문. billingCycle=null → 일회성(/charge 에 쓸 수 있는 유일한 종류).
 * @param {{ productId: string, description: string, name?: string, amountMinor: string|number, currencyCode?: string,
 *           billingCycle?: {interval: string, frequency: number}|null, trialPeriod?: {interval: string, frequency: number}|null,
 *           customData?: Record<string, unknown> }} p
 */
export function buildPriceBody(p) {
  assertPaddleId(p?.productId, "pro", "productId");
  const description = typeof p.description === "string" ? p.description.trim() : "";
  if (description.length < 2 || description.length > 500) throw new TypeError("가격 description 은 2~500자");
  const currencyCode = p.currencyCode ?? "USD";
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new TypeError("currency_code 는 ISO 4217 세 글자");
  const billingCycle = assertCycle(p.billingCycle ?? null, "billing_cycle");
  const trialPeriod = assertCycle(p.trialPeriod ?? null, "trial_period");
  if (trialPeriod !== null && billingCycle === null) {
    throw new TypeError("trial_period 는 반복(billing_cycle 있는) 가격에만 붙일 수 있습니다");
  }
  /** @type {Record<string, unknown>} */
  const body = {
    product_id: p.productId,
    description,
    unit_price: { amount: normalizeAmountMinor(p.amountMinor), currency_code: currencyCode },
    billing_cycle: billingCycle,
    trial_period: trialPeriod,
  };
  if (typeof p.name === "string" && p.name.trim() !== "") body.name = p.name.trim();
  if (p.customData !== undefined) body.custom_data = p.customData;
  return body;
}

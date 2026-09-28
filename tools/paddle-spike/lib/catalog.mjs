/**
 * catalog.mjs — 스파이크가 샌드박스에 만드는 상품·가격 정의(멱등 키 포함).
 *
 * 멱등성: 모든 엔티티의 custom_data 에 { spike: SPIKE_TAG, spike_key } 를 심고,
 * setup 은 만들기 전에 같은 spike_key 를 찾는다. 두 번 돌려도 새로 만들지 않는다.
 *
 * 상품 표시 관측: 카드 수집용 구독 가격은 'Build guarantee' 상품에 붙인다 — 체크아웃
 * 화면이 "Care 트라이얼"이 아니라 "Build guarantee"로 보이는지가 계획 §1.1 재설계 지점의
 * 하나다(체크아웃 스크린샷으로 확인).
 */
export const SPIKE_TAG = "simsa-paddle-spike-2026-10";

export const PRODUCTS = Object.freeze([
  {
    key: "build_guarantee",
    name: "Build guarantee",
    description: "Simsa sandbox spike — charged only when the build works (works-or-free). Sandbox only.",
    taxCategory: "standard",
  },
  {
    key: "repair_fee",
    name: "Repair fee",
    description: "Simsa sandbox spike — repair beyond the free monthly quota, charged only when re-inspection passes. Sandbox only.",
    taxCategory: "standard",
  },
]);

/**
 * role:
 *  - one_time: /charge 로 청구하는 일회성 가격(billing_cycle null)
 *  - card_on_file: 체크아웃에서 카드를 받기 위한 트라이얼 구독 가격 후보
 * probe=true: 허용 여부 자체가 관측 대상(거부돼도 setup 은 계속, 결과에 rejected 로 기록)
 */
export const PRICES = Object.freeze([
  {
    key: "build_once_199",
    product: "build_guarantee",
    role: "one_time",
    name: "Build guarantee (one-time)",
    description: "Spike: works-or-free build charge $199, one-time",
    amountMinor: "19900",
    billingCycle: null,
    trialPeriod: null,
    probe: false,
  },
  {
    key: "repair_once_29",
    product: "repair_fee",
    role: "one_time",
    name: "Repair fee (one-time)",
    description: "Spike: repair beyond quota $29, one-time",
    amountMinor: "2900",
    billingCycle: null,
    trialPeriod: null,
    probe: false,
  },
  {
    key: "card_trial_19",
    product: "build_guarantee",
    role: "card_on_file",
    name: "Build guarantee — card on file",
    description: "Spike candidate 1: $19/month with 30-day trial (card collected at checkout, never meant to renew)",
    amountMinor: "1900",
    billingCycle: { interval: "month", frequency: 1 },
    trialPeriod: { interval: "day", frequency: 30 },
    probe: false,
  },
  {
    key: "card_trial_0",
    product: "build_guarantee",
    role: "card_on_file",
    name: "Build guarantee — card on file ($0)",
    description: "Spike candidate 2: $0/month with 30-day trial — is a zero recurring price accepted?",
    amountMinor: "0",
    billingCycle: { interval: "month", frequency: 1 },
    trialPeriod: { interval: "day", frequency: 30 },
    probe: true,
  },
]);

/** 체크아웃 변형 이름 → 가격 키. */
export const CHECKOUT_VARIANTS = Object.freeze({ trial19: "card_trial_19", trial0: "card_trial_0" });

export function spikeCustomData(key, extra = {}) {
  return { spike: SPIKE_TAG, spike_key: key, ...extra };
}

/** Paddle 엔티티 목록에서 우리 spike_key 를 가진 것을 찾는다. */
export function findBySpikeKey(list, key) {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (item === null || typeof item !== "object") continue;
    const cd = /** @type {{custom_data?: unknown}} */ (item).custom_data;
    if (cd !== null && typeof cd === "object") {
      const rec = /** @type {Record<string, unknown>} */ (cd);
      if (rec.spike === SPIKE_TAG && rec.spike_key === key) return item;
    }
  }
  return null;
}

/**
 * evidence/catalog.json 모양 확인(외부 파일 경계 — 손으로 고친 파일도 들어올 수 있다).
 * @returns {{ ok: true, catalog: {products: Record<string,string>, prices: Record<string, {id: string|null, status: string}>} } | { ok: false, reason: string }}
 */
export function parseCatalog(raw) {
  if (raw === null || typeof raw !== "object") return { ok: false, reason: "catalog.json 이 객체가 아닙니다" };
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.spikeTag !== SPIKE_TAG) return { ok: false, reason: "spikeTag 불일치 — 다른 스파이크의 카탈로그입니다" };
  if (r.products === null || typeof r.products !== "object") return { ok: false, reason: "products 없음" };
  if (r.prices === null || typeof r.prices !== "object") return { ok: false, reason: "prices 없음" };
  /** @type {Record<string,string>} */
  const products = {};
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (r.products))) {
    if (typeof v === "string") products[k] = v;
  }
  /** @type {Record<string, {id: string|null, status: string}>} */
  const prices = {};
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (r.prices))) {
    if (v === null || typeof v !== "object") continue;
    const pv = /** @type {Record<string, unknown>} */ (v);
    const id = typeof pv.id === "string" ? pv.id : null;
    const status = typeof pv.status === "string" ? pv.status : "unknown";
    prices[k] = { id, status };
  }
  return { ok: true, catalog: { products, prices } };
}

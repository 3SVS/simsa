/**
 * observe.mjs — Paddle 응답에서 증거로 남길 필드만 뽑고(요약), 시나리오 결과로 분기를 판정한다.
 * 전부 순수 함수. 입력은 외부 경계(Paddle JSON)라 타입 가드로만 읽는다 — 모양이 틀려도 죽지 않는다.
 *
 * 판정 규칙 정본: docs/billing/paddle-sandbox-2026-10.md §4. 테스트(test/observe.test.mjs)가 그 표를 고정한다.
 */

/** @param {unknown} v @returns {Record<string, any> | null} */
function obj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, any>} */ (v) : null;
}
const str = (v) => (typeof v === "string" ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);

function pickTotals(t) {
  const o = obj(t);
  if (!o) return null;
  const keys = ["subtotal", "discount", "tax", "total", "credit", "balance", "grand_total", "fee", "earnings", "currency_code"];
  /** @type {Record<string, string|null>} */
  const out = {};
  for (const k of keys) if (k in o) out[k] = o[k] === null ? null : String(o[k]);
  return out;
}

function pickScheduledChange(v) {
  const o = obj(v);
  if (!o) return null;
  return { action: str(o.action), effective_at: str(o.effective_at), resume_at: str(o.resume_at) };
}

export function summarizeSubscription(sub) {
  const s = obj(sub);
  if (!s) return null;
  return {
    id: str(s.id),
    status: str(s.status),
    collection_mode: str(s.collection_mode),
    started_at: str(s.started_at),
    first_billed_at: str(s.first_billed_at),
    next_billed_at: str(s.next_billed_at),
    canceled_at: str(s.canceled_at),
    current_billing_period: obj(s.current_billing_period)
      ? { starts_at: str(s.current_billing_period.starts_at), ends_at: str(s.current_billing_period.ends_at) }
      : null,
    scheduled_change: pickScheduledChange(s.scheduled_change),
    items: arr(s.items).map((it) => {
      const i = obj(it) ?? {};
      const price = obj(i.price) ?? {};
      return {
        status: str(i.status),
        price_id: str(price.id),
        billing_cycle: obj(price.billing_cycle),
        trial_period: obj(price.trial_period),
        unit_amount: obj(price.unit_price) ? str(price.unit_price.amount) : null,
        next_billed_at: str(i.next_billed_at),
      };
    }),
    custom_data: obj(s.custom_data),
  };
}

export function summarizeTransaction(txn) {
  const t = obj(txn);
  if (!t) return null;
  const details = obj(t.details) ?? {};
  return {
    id: str(t.id),
    status: str(t.status),
    origin: str(t.origin),
    subscription_id: str(t.subscription_id),
    created_at: str(t.created_at),
    billed_at: str(t.billed_at),
    currency_code: str(t.currency_code),
    items: arr(t.items).map((it) => {
      const i = obj(it) ?? {};
      return { price_id: obj(i.price) ? str(i.price.id) : str(i.price_id), quantity: typeof i.quantity === "number" ? i.quantity : null };
    }),
    totals: pickTotals(details.totals),
    payout_totals: pickTotals(details.payout_totals),
    payments: arr(t.payments).map((p) => {
      const pay = obj(p) ?? {};
      return { status: str(pay.status), error_code: str(pay.error_code) };
    }),
    custom_data: obj(t.custom_data),
  };
}

export function summarizeAdjustment(adj) {
  const a = obj(adj);
  if (!a) return null;
  return {
    id: str(a.id),
    status: str(a.status),
    action: str(a.action),
    type: str(a.type),
    transaction_id: str(a.transaction_id),
    subscription_id: str(a.subscription_id),
    created_at: str(a.created_at),
    updated_at: str(a.updated_at),
    totals: pickTotals(a.totals),
    payout_totals: pickTotals(a.payout_totals),
  };
}

/** client.request 결과 → 증거용 한 줄(성공이면 요약 함수를 적용). */
export function summarizeResult(res, summarize) {
  const r = obj(res);
  if (!r) return null;
  const err = obj(r.error);
  return {
    ok: r.ok === true,
    status: typeof r.status === "number" ? r.status : null,
    requestId: str(r.requestId),
    request: obj(r.request),
    error: err ? { type: str(err.type), code: str(err.code), detail: str(err.detail) } : null,
    data: r.ok === true && typeof summarize === "function" ? summarize(r.data) : null,
  };
}

const SUCCESS = new Set(["paid", "completed"]);
/** 돈을 걷었거나 걷으려 한 상태(청구 시도). draft·ready·canceled 는 청구가 아니다. */
const CHARGE_ATTEMPTED = new Set(["billed", "paid", "completed", "past_due"]);

export function isSettledSuccess(status) {
  return typeof status === "string" && SUCCESS.has(status);
}

function grandTotalMinor(t) {
  const totals = obj(obj(t)?.details)?.totals;
  const v = obj(totals)?.grand_total ?? obj(totals)?.total;
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  return 0n;
}

/**
 * works-or-free 실패 경로의 핵심 확인: 이 구독에서 0보다 큰 청구(시도 포함)가 하나도 없는가.
 * @param {unknown} transactions Paddle 거래 목록(원본 JSON)
 */
export function zeroChargeCheck(transactions) {
  if (!Array.isArray(transactions)) return { ok: false, chargedCount: 0, totalMinor: "0", offenders: [], reason: "거래 목록 없음 — 판정 불가" };
  let total = 0n;
  /** @type {string[]} */
  const offenders = [];
  for (const t of transactions) {
    const o = obj(t);
    if (!o || !CHARGE_ATTEMPTED.has(String(o.status))) continue;
    const amount = grandTotalMinor(o);
    if (amount > 0n) {
      total += amount;
      offenders.push(String(o.id));
    }
  }
  return { ok: offenders.length === 0, chargedCount: offenders.length, totalMinor: total.toString(), offenders };
}

export function scheduledChangeDelta(before, after) {
  const b = pickScheduledChange(before);
  const a = pickScheduledChange(after);
  const changed = JSON.stringify(b) !== JSON.stringify(a);
  return { before: b, after: a, changed, removed: b !== null && a === null };
}

/**
 * S-F 관측 시점 판단: 단축한 트라이얼 만료 + 여유(기본 5분)가 지났는가.
 * @returns {{ ready: boolean, minutesLeft: number }}
 */
export function observeReadiness(expiresAtIso, now = new Date(), graceMin = 5) {
  const t = typeof expiresAtIso === "string" ? Date.parse(expiresAtIso) : Number.NaN;
  if (Number.isNaN(t)) return { ready: false, minutesLeft: Number.POSITIVE_INFINITY };
  const left = (t + graceMin * 60_000 - now.getTime()) / 60_000;
  return { ready: left <= 0, minutesLeft: Math.max(0, Math.ceil(left)) };
}

/**
 * 증거 파일(S-A.json·S-B.json·catalog.json) → decideBranch 입력. 모양이 틀린 파일은 없는 것으로 친다.
 */
export function verdictInputsFrom({ sa, sb, catalog }) {
  const saObs = obj(obj(sa)?.observations);
  const sbObs = obj(obj(sb)?.observations);
  const zpa = obj(catalog)?.zeroPriceAccepted;
  return {
    sa: saObs ? { directCharge: obj(saObs.directCharge) ?? undefined, activateFallback: obj(saObs.activateFallback) ?? undefined } : undefined,
    sb: sbObs ? { zeroCharge: obj(sbObs.zeroCharge) ?? undefined } : undefined,
    catalog: { zeroPriceAccepted: typeof zpa === "boolean" ? zpa : null },
  };
}

/** 한글 프로젝트명이 custom_data 왕복에서 깨지지 않았는지(규칙 6). */
export function koreanRoundTrip(sent, received) {
  return { sent, received: typeof received === "string" ? received : null, intact: typeof received === "string" && received === sent };
}

/**
 * 상태 머신 분기 판정. 입력은 증거 요약(시나리오 스크립트가 만든 모양).
 * @param {{
 *   sa?: { directCharge?: { httpOk?: boolean, transactionStatus?: string|null, errorCode?: string|null },
 *          activateFallback?: { activateOk?: boolean, activationBilledMinor?: string|null, chargeHttpOk?: boolean, transactionStatus?: string|null } },
 *   sb?: { zeroCharge?: { ok?: boolean } },
 *   catalog?: { zeroPriceAccepted?: boolean|null },
 * }} ev
 * @returns {{ branch: "A"|"B"|"C"|"pending", reasons: string[] }}
 */
export function decideBranch(ev) {
  const reasons = [];
  const e = obj(ev) ?? {};
  const sa = obj(e.sa);
  const direct = obj(sa?.directCharge);
  const sbZero = obj(obj(e.sb)?.zeroCharge);
  const zeroPriceAccepted = obj(e.catalog)?.zeroPriceAccepted;

  if (sbZero && sbZero.ok === false) {
    return { branch: "C", reasons: ["S-B: 즉시 취소했는데 청구가 발생 — 실패 시 $0 이 성립하지 않는다"] };
  }
  if (!direct) return { branch: "pending", reasons: ["S-A 미실행 — trialing 직접 /charge 증거 없음"] };

  if (direct.httpOk === true) {
    if (!isSettledSuccess(direct.transactionStatus)) {
      return { branch: "pending", reasons: [`S-A: /charge 는 수락됐지만 거래가 아직 정산 전(${String(direct.transactionStatus ?? "없음")})`] };
    }
    if (!sbZero) return { branch: "pending", reasons: ["A 후보 — S-B(실패 경로 청구 0) 미실행"] };
    reasons.push("S-A: trialing 구독에 직접 /charge → 거래 정산", "S-B: 즉시 취소 → 청구 0");
    return { branch: "A", reasons };
  }

  reasons.push(`S-A: trialing 직접 /charge 거부(${String(direct.errorCode ?? "코드 없음")})`);
  if (zeroPriceAccepted === false) {
    reasons.push("$0 반복 가격 거부 → activate 가 $19 를 즉시 청구하게 되어 works-or-free 불성립");
    return { branch: "C", reasons };
  }
  const fb = obj(sa?.activateFallback);
  if (!fb) {
    reasons.push("activate($0) 뒤 charge 경로 미실행");
    return { branch: "pending", reasons };
  }
  const activationBilled = typeof fb.activationBilledMinor === "string" && /^\d+$/.test(fb.activationBilledMinor) ? BigInt(fb.activationBilledMinor) : null;
  if (fb.activateOk !== true || activationBilled === null || activationBilled > 0n) {
    reasons.push(`activate 실패 또는 활성화 청구 > 0 (${String(fb.activationBilledMinor)})`);
    return { branch: "C", reasons };
  }
  if (fb.chargeHttpOk !== true) {
    reasons.push("activate 뒤 /charge 도 거부");
    return { branch: "C", reasons };
  }
  if (!isSettledSuccess(fb.transactionStatus)) {
    reasons.push(`activate 뒤 /charge 거래 정산 전(${String(fb.transactionStatus ?? "없음")})`);
    return { branch: "pending", reasons };
  }
  if (!sbZero) {
    reasons.push("B 후보 — S-B 미실행");
    return { branch: "pending", reasons };
  }
  reasons.push("activate($0) → /charge 정산", "S-B: 즉시 취소 → 청구 0");
  return { branch: "B", reasons };
}

/**
 * checkout-events.mjs — Paddle.js eventCallback 로 모은 이벤트에서 필요한 값만 꺼낸다(순수 함수).
 * 이벤트 이름: checkout.loaded · checkout.completed · checkout.closed · checkout.error ·
 * checkout.payment.failed … (developer.paddle.com/paddlejs/events/overview, 2026-09-28 접근).
 * checkout.completed 의 data 는 거래와 비슷한 모양이며 transaction_id 를 담는다(샌드박스에서 확인할 항목).
 */
const TXN_ID = /^txn_[a-z\d]{26}$/;

/** @param {unknown} events @returns {string|null} */
export function extractCompletedTransactionId(events) {
  if (!Array.isArray(events)) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e === null || typeof e !== "object" || e.name !== "checkout.completed") continue;
    const data = e.data !== null && typeof e.data === "object" ? e.data : {};
    const id = typeof data.transaction_id === "string" ? data.transaction_id : typeof data.id === "string" ? data.id : null;
    return id !== null && TXN_ID.test(id) ? id : null;
  }
  return null;
}

/** 실패 관련 이벤트만(스크린샷과 함께 증거로). */
export function failureEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(
    (e) => e !== null && typeof e === "object" && typeof e.name === "string" && /^(checkout\.error|checkout\.payment\.(failed|error)|checkout\.warning)$/.test(e.name),
  );
}

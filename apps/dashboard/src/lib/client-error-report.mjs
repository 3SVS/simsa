/**
 * client-error-report.mjs — G12 신고 게이트 (pure).
 *
 * 전역 오류를 서버로 보내기 전의 결정 로직만 순수하게 분리:
 *  - 세션당 상한(기본 5) — 오류 루프가 신고 폭주가 되지 않게.
 *  - 같은 메시지는 세션에 한 번만 — 렌더 루프 중복 제거.
 *  - 확장프로그램/서드파티 스크립트 오류("Script error." 등 무정보)는 버린다.
 *
 * 내용 프라이버시 계약: 신고 페이로드는 message/stack/path(쿼리 제거는 서버가
 * 한 번 더 강제)만 — 폼 값·입력 내용은 애초에 수집하지 않는다.
 */

export const SESSION_CAP = 5;

/** 무정보/서드파티 노이즈 — 보내봐야 조치 불가한 것들. 매처는 파라미터. */
const NOISE_RE = /^script error\.?$|responded with a status of|extension context invalidated|ResizeObserver loop/i;

/**
 * @param {{ message: string }} err
 * @param {{ sentCount: number, seenMessages: Set<string> }} state  (세션 상태 — 호출측 보관)
 * @returns {boolean} true면 보낸다 (호출측은 state를 갱신할 것)
 */
export function shouldReportClientError(err, state) {
  const msg = (err?.message ?? "").trim();
  if (!msg) return false;
  if (NOISE_RE.test(msg)) return false;
  if (state.sentCount >= SESSION_CAP) return false;
  if (state.seenMessages.has(msg)) return false;
  return true;
}

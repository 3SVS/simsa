/**
 * stack-profile.mjs — 스택 불가지 Phase 1 (D-1, design lock 2026-08-20).
 *
 * 유저가 답한 호스팅/데이터 축을 ExtendedProjectData.stackProfile 패치로
 * 조립한다. 규칙:
 *   - 미응답 축은 키를 만들지 않는다 (빈 답 → `{}` — ext에 아무것도 안 남음).
 *     소비자는 특정 벤더를 조용히 가정하지 말 것 (D-2 중립 기본값).
 *   - "other"일 때만 자유텍스트를 other로 보존한다 (D-3: 모르는 벤더도
 *     버리지 않고 수집 — built-with.ts의 시장 레이더 패턴).
 *   - id는 검증하지 않고 통과시킨다 — 칩 목록의 확장이 이 모듈 수정 없이
 *     가능해야 한다.
 */

/**
 * @param {string | null} hostingId
 * @param {string} hostingOther
 * @param {string | null} dataId
 * @param {string} dataOther
 * @returns {{ stackProfile?: { hosting?: { id: string, other?: string }, data?: { id: string, other?: string } } }}
 */
export function stackProfilePatch(hostingId, hostingOther, dataId, dataOther) {
  const axis = (id, other) =>
    id ? { id, ...(id === "other" && other.trim() ? { other: other.trim() } : {}) } : undefined;
  const hosting = axis(hostingId, hostingOther);
  const data = axis(dataId, dataOther);
  if (!hosting && !data) return {};
  return { stackProfile: { ...(hosting ? { hosting } : {}), ...(data ? { data } : {}) } };
}

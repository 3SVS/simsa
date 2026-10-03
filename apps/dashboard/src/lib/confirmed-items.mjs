// C-A7 (재정렬 D-2 amend) — "유저가 확인한 항목" 목록의 단일 규칙.
//
// 기존 앱 문의 지시서(역추론, source: inferred)는 **이 목록에 든 항목만** "반드시 되어야 할 것(must)"으로
// 삼는다. 목록을 읽는 곳(지시서 화면의 재생성·인터뷰 팩)과 쓰는 곳(맞나요? 카드·인터뷰 회수·항목 화면·
// 아이디어로 항목 만들기·초안 확정)이 **같은 규칙**을 쓰도록 여기 한 곳에 둔다.
//
// ## 두 규칙
//
// 1) 레거시 폴백 — 목록 필드가 **없으면** 지금 항목 전부가 확인된 것이다.
//    이 필드가 생기기 전에는 대시보드의 어떤 경로도 "앱에서 읽었지만 유저가 확인하지 않은 항목"을
//    항목 목록(requirements)에 넣지 않았다: "맞나요?" 카드는 체크를 뺀 항목을 저장하지 않았고, 나머지
//    경로(항목 화면 추가·편집, 아이디어로 항목 만들기, 초안 확정)는 전부 유저가 직접 쓰거나 확정한 것이다.
//    그래서 필드가 없는 옛 프로젝트의 항목은 확인된 것으로 읽는 것이 사실과 맞다. 이렇게 읽지 않으면
//    옛 프로젝트는 재생성 한 번에 must가 0이 되고, 카드는 다시 뜨지 않아(확정 시각이 있으면 숨는다)
//    되돌릴 길도 없다. **빈 배열 []은 "확인된 것 없음"이라는 명시적 값**이므로 폴백하지 않는다.
//
// 2) 유저가 직접 쓴 것은 확인된 것이다 — 항목 화면에서 추가·편집한 항목, 유저의 말(아이디어 문장)에서
//    만든 항목, 유저가 확정 버튼을 누른 초안의 항목. 이것들은 앱에서 읽어낸 추론이 아니므로 D-2 amend의
//    "확인 안 된 추론"으로 분류하면 안 된다(그러면 서버가 should로 강등한다).
//
// PURE — no network, no storage. Mirrors the *.mjs pure-helper convention of this folder.

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    if (typeof x !== "string") continue;
    const id = x.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 지금 유효한 확인 목록. 저장된 목록이 있으면 그것(명시적 [] 포함), 없으면(옛 저장) 지금 항목 id 전부.
 *
 * @param {unknown} confirmedItemIds  ext.intentConfirmedItemIds (없을 수 있음)
 * @param {ReadonlyArray<string>} requirementIds  지금 로컬 항목 id
 * @returns {string[]}
 */
export function effectiveConfirmedItemIds(confirmedItemIds, requirementIds) {
  if (Array.isArray(confirmedItemIds)) return uniqStrings(confirmedItemIds);
  return uniqStrings(requirementIds);
}

/**
 * 유저가 직접 쓰거나 확정한 항목을 확인 목록에 합친다. 결과는 **쓰기 뒤에 남는 항목**으로 좁힌다
 * (사라진 항목 id를 끌고 다니지 않는다).
 *
 * @param {{
 *   confirmedItemIds: unknown,
 *   before: ReadonlyArray<string>,
 *   after: ReadonlyArray<string>,
 *   authored: ReadonlyArray<string>,
 * }} input
 * @returns {string[]}
 */
export function withUserAuthoredItems({ confirmedItemIds, before, after, authored }) {
  const keep = new Set(uniqStrings(after));
  return uniqStrings([...effectiveConfirmedItemIds(confirmedItemIds, before), ...uniqStrings(authored)]).filter((id) =>
    keep.has(id),
  );
}

/**
 * intent-missing.mjs — "맞나요?" 카드의 "빠졌는데 꼭 되어야 하는 것" (2026-10-05).
 *
 * 왜: 앱에서 읽어 낸 항목은 **지금 화면에 보이는 것**뿐이다. 벤치마크 #1 로컬 실측에서 미용실 앱의 추론 항목에
 * "다른 손님은 이미 예약된 시간을 못 고름"·"사장님 관리 화면"이 빠져 있었고, 그래서 기준이 화면 표시만 재다가
 * 고장 난 앱을 "정상"이라 했다. 사용자가 원래 원했던 것을 적을 칸이 있어야 정답지가 완성된다.
 * 사용자가 직접 적은 줄은 사용자가 확인한 기준이다(역추론 지시서의 must가 될 수 있다 — D-2 amend).
 */

export const MAX_MISSING_ITEMS = 8;
export const MAX_MISSING_CHARS = 200;

/** 한 줄에 하나 → 항목. 빈 줄·글머리표 정리, 중복 제거, 상한. id는 user_1… (기존 항목 id와 겹치지 않게). */
export function missingItemsFromText(text, existingIds = []) {
  const taken = new Set(existingIds);
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const title = raw.replace(/^\s*[-*•·\d.)]+\s*/, "").trim().slice(0, MAX_MISSING_CHARS);
    if (title.length < 2 || seen.has(title)) continue;
    seen.add(title);
    let n = out.length + 1;
    while (taken.has(`user_${n}`)) n += 1;
    const id = `user_${n}`;
    taken.add(id);
    out.push({ id, title, criteria: [] });
    if (out.length >= MAX_MISSING_ITEMS) break;
  }
  return out;
}

/**
 * SI 티어 A5.2 — 수용 기준(AC)의 "결과(then)"가 화면에 실제로 보이는지 (순수 함수, 의존성 0).
 *
 * 왜 (라이브 E2E 2026-09-25): 빵집 지시서로 **로그인 화면**(app.trysimsa.com/login)을 검수했더니
 * "오늘의 빵 목록 조회"·"픽업 시간 예약"이 **문제 없음**으로 나왔다. 판정이 "무언가를 눌렀고 화면이
 * 바뀌었다"만 봤기 때문 — AC의 then을 전혀 대조하지 않았다. D-19의 차별점(형식 AC 판정)이 비어 있던 것.
 *
 * 규칙(보수적): then에서 내용어를 뽑고, 그중 **절반 이상**이 동작 후 화면 텍스트에 있어야 "관찰됨".
 * 내용어가 하나도 없으면(전부 기능어) 관찰 불가 → 판정하지 않는다(not_confirmed). 존재는 필요조건이지
 * 충분조건이 아니다 — "문제를 찾지 못했어요"의 근거로만 쓴다(숫자 점수 없음, PRD §5).
 */

const KO_PARTICLES = /(으로써|으로서|에서는|에게서|까지|부터|으로|에서|에게|하고|이나|이며|이고|은|는|이|가|을|를|의|에|와|과|도|만|로|나)$/;
const KO_ENDINGS = /(된다|한다|된다\.|보인다|나타난다|표시된다|있다|없다|된다|하다|되다|된|되는|하는|한|할|수|다)$/;

const KO_STOP = new Set([
  "화면", "페이지", "표시", "보인다", "보이다", "보임", "나타난다", "된다", "한다", "있다", "없다", "수", "할", "한", "그", "이",
  "해당", "사용자", "유저", "선택한", "선택", "선택된", "때", "후", "뒤", "전", "경우", "것", "및", "또는", "모든", "각", "새로운",
  "상태", "정보", "내용", "항목", "결과", "완료", "성공", "확인", "가능", "가능하다", "된", "되는", "안내", "메시지",
]);
const EN_STOP = new Set([
  "the", "and", "for", "are", "is", "be", "shown", "show", "shows", "displayed", "display", "displays", "visible", "appears", "appear",
  "screen", "page", "user", "users", "can", "see", "sees", "with", "that", "this", "their", "they", "will", "should", "into", "from",
  "after", "when", "then", "has", "have", "selected", "item", "items", "list", "message", "info", "information", "state", "status",
  "success", "successfully", "completed", "complete", "confirm", "confirmation",
]);

/** then 문장에서 화면에 나타나야 할 내용어를 뽑는다. */
export function thenTerms(then) {
  const tokens = String(then ?? "")
    .normalize("NFC")
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'“”‘’·•/\\|<>~`@#$%^&*+=_-]+/)
    .filter(Boolean);
  const out = [];
  for (const raw of tokens) {
    if (/[가-힣]/.test(raw)) {
      let t = raw.replace(KO_ENDINGS, "");
      t = t.replace(KO_PARTICLES, "");
      if (!t || KO_STOP.has(t) || KO_STOP.has(raw)) continue;
      out.push(t);
    } else if (/^[a-z0-9]+$/.test(raw)) {
      if (raw.length < 3 || EN_STOP.has(raw) || /^\d+$/.test(raw)) continue;
      out.push(raw);
    }
  }
  return [...new Set(out)].slice(0, 8);
}

/**
 * then의 내용어가 화면 텍스트에 보이는가.
 * @returns {{ observed: boolean, judgeable: boolean, terms: string[], found: string[], missing: string[] }}
 */
export function observeThen(then, bodyText) {
  const terms = thenTerms(then);
  if (terms.length === 0) return { observed: false, judgeable: false, terms, found: [], missing: [] };
  const hay = String(bodyText ?? "").normalize("NFC").toLowerCase();
  const found = terms.filter((t) => hay.includes(t));
  const missing = terms.filter((t) => !hay.includes(t));
  return { observed: found.length * 2 >= terms.length, judgeable: true, terms, found, missing };
}

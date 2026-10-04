// C-A7 (재정렬 2026-09-27 §3 문 (c)) — 인터뷰 회수 결과를 **기존 의도 확정 경로**에 태운다.
//
// 서버(POST …/interview-answer)가 유저가 붙여넣은 AI의 답을 고정 양식으로 회수하면, 이 함수가
// 그것을 "맞나요?" 카드가 확정하는 것과 **같은 자리**로 옮긴다:
//   - INTENT        → productSpec.oneLine   (C0: 확정 oneLine이 다음 검수 intent의 기본값)
//   - MUST          → 항목(requirements) + 확인 목록(intentConfirmedItemIds) — 역추론 지시서의 must
//   - NOT_NEEDED    → productSpec.excluded  (+ 같은 이름의 항목은 확인 목록에서 뺀다)
//   - DIFFERENT_NOW → productSpec.decisions ("지금 앱과 다른 점: …") — 지시서 생성의 문맥
//
// 로컬이 정본이다(대시보드 local-first). 이 결과를 로컬에 저장한 뒤 미러 → 역추론 지시서 생성
// (intent-ruler.ts)으로 이어진다. 못 읽은 칸(unread)은 **건드리지 않는다** — 지어내지 않는다.
//
// PURE — no network, no storage. Mirrors the *.mjs pure-helper convention of this folder.

const DIFF_PREFIX = { ko: "지금 앱과 다른 점: ", en: "Differs from the app now: " };

/** 비교용 정규화(표시값은 원문 그대로 둔다). */
export function normalizeTitle(s) {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?。]+$/, "")
    .toLowerCase();
}

function dedupe(list) {
  const out = [];
  const seen = new Set();
  for (const x of list) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t) continue;
    const k = normalizeTitle(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** 기존 id와 겹치지 않는 다음 인터뷰 항목 id(req_iv_001…). */
function nextIds(existingIds, n) {
  const taken = new Set(existingIds);
  const out = [];
  let k = 1;
  while (out.length < n) {
    const id = `req_iv_${String(k).padStart(3, "0")}`;
    if (!taken.has(id)) {
      out.push(id);
      taken.add(id);
    }
    k += 1;
  }
  return out;
}

/**
 * @param {{
 *   answer: { intent: string | null, must: string[], notNeeded: string[], differentNow: string[], unread?: string[] },
 *   current: {
 *     oneLine?: string | null,
 *     requirements: Array<{ id: string, title: string }>,
 *     productSpec?: Record<string, unknown> | null,
 *     confirmedItemIds?: string[] | null,
 *   },
 *   locale: "ko" | "en",
 * }} input
 */
export function applyInterviewAnswer({ answer, current, locale }) {
  const loc = locale === "en" ? "en" : "ko";
  const reqs = Array.isArray(current?.requirements) ? current.requirements : [];
  const byTitle = new Map(reqs.map((r) => [normalizeTitle(r.title), r.id]));

  const mustTitles = dedupe(answer?.must ?? []);
  const unmatched = mustTitles.filter((t) => !byTitle.has(normalizeTitle(t)));
  const newIds = nextIds(reqs.map((r) => r.id), unmatched.length);
  const newRequirements = unmatched.map((title, i) => ({ id: newIds[i], title }));
  const mustIds = mustTitles.map((t) => byTitle.get(normalizeTitle(t)) ?? newRequirements.find((n) => n.title === t)?.id).filter(Boolean);

  const notNeeded = dedupe(answer?.notNeeded ?? []);
  const notNeededKeys = new Set(notNeeded.map(normalizeTitle));
  const droppedIds = new Set(reqs.filter((r) => notNeededKeys.has(normalizeTitle(r.title))).map((r) => r.id));

  const confirmedItemIds = [...new Set([...(current?.confirmedItemIds ?? []), ...mustIds])].filter((id) => !droppedIds.has(id));

  const intent = typeof answer?.intent === "string" && answer.intent.trim() ? answer.intent.trim() : null;
  const oneLine = intent ?? (typeof current?.oneLine === "string" ? current.oneLine : "");

  const ps = current?.productSpec && typeof current.productSpec === "object" ? current.productSpec : {};
  const prevExcluded = Array.isArray(ps.excluded) ? ps.excluded : [];
  const prevDecisions = Array.isArray(ps.decisions) ? ps.decisions : [];
  const diffs = dedupe(answer?.differentNow ?? []).map((d) => `${DIFF_PREFIX[loc]}${d}`);
  const productSpec = {
    ...ps,
    oneLine,
    excluded: dedupe([...prevExcluded, ...notNeeded]),
    decisions: dedupe([...prevDecisions, ...diffs]),
  };

  return {
    oneLine,
    productSpec,
    newRequirements,
    confirmedItemIds,
    changed: {
      intent: intent !== null,
      mustAdded: newRequirements.length,
      mustMatched: mustIds.length - newRequirements.length,
      notNeeded: notNeeded.length,
      differentNow: diffs.length,
    },
  };
}

/**
 * Train C · C-A7 ② — 문 (c) "내 AI에게 물어보기" 카드: 반영 함수(순수) + 배선(정적) + 사전(KO/EN).
 *
 *  I-1  applyInterviewAnswer: INTENT → oneLine, MUST → 항목·확인 id(기존 항목과 이름이 같으면 그 id),
 *       NOT_NEEDED → excluded(+같은 이름 항목 확인 해제), DIFFERENT_NOW → decisions(접두어) — 한글 데이터
 *  I-2  못 읽은 칸은 건드리지 않는다(의도 없음 → oneLine 유지)
 *  I-3  카드는 기존 앱 문 개요에 인라인으로(모달·오버레이 없음), 회수 → 로컬 반영 → 미러·역추론 지시서 순서
 *  I-4  사전: interviewPack KO/EN 키 동일, 초보자 금칙어 0
 * 각 검사는 고치기 전 코드(카드·함수·사전 없음)에서 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

const { applyInterviewAnswer, normalizeTitle } = await import("../src/lib/interview-apply.mjs");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const current = {
  oneLine: "미용실 예약 앱",
  requirements: [
    { id: "req_001", title: "원하는 날짜를 골라 예약할 수 있다" },
    { id: "req_002", title: "후기를 남길 수 있다" },
  ],
  productSpec: { productName: "(주)트루픽셀 예약 앱", oneLine: "미용실 예약 앱", excluded: ["결제"], decisions: [] },
  confirmedItemIds: ["req_002"],
};

test("I-1: 회수 결과를 '맞나요?' 카드와 같은 자리로 옮긴다", () => {
  const r = applyInterviewAnswer({
    answer: {
      intent: "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것",
      must: ["원하는 날짜를 골라 예약할 수 있다.", "예약 확인 화면에 고른 날짜가 보인다", "예약 확인 화면에 고른 날짜가 보인다"],
      notNeeded: ["후기를 남길 수 있다", "결제"],
      differentNow: ["날짜를 고르는 칸이 없고 항상 오늘로 예약된다"],
    },
    current,
    locale: "ko",
  });
  assert.equal(r.oneLine, "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것");
  assert.equal(r.productSpec.oneLine, r.oneLine);
  assert.equal(r.productSpec.productName, "(주)트루픽셀 예약 앱", "다른 브리프 칸은 그대로");
  // 이름이 같은 기존 항목은 새로 만들지 않고 그 id를 확인한다(끝 마침표·공백 무시)
  assert.deepEqual(r.newRequirements, [{ id: "req_iv_001", title: "예약 확인 화면에 고른 날짜가 보인다" }]);
  // NOT_NEEDED에 같은 이름이 있으면 확인에서 뺀다(req_002)
  assert.deepEqual(r.confirmedItemIds, ["req_001", "req_iv_001"]);
  assert.deepEqual(r.productSpec.excluded, ["결제", "후기를 남길 수 있다"]);
  assert.deepEqual(r.productSpec.decisions, ["지금 앱과 다른 점: 날짜를 고르는 칸이 없고 항상 오늘로 예약된다"]);
  assert.deepEqual(r.changed, { intent: true, mustAdded: 1, mustMatched: 1, notNeeded: 2, differentNow: 1 });
});

test("I-1′: 새 항목 id는 기존 id와 겹치지 않는다(req_iv_001이 이미 있으면 002부터), EN 접두어", () => {
  const r = applyInterviewAnswer({
    answer: { intent: null, must: ["Search works with part of a name"], notNeeded: [], differentNow: ["Search needs the full name"] },
    current: { oneLine: "Cafe finder", requirements: [{ id: "req_iv_001", title: "Show all cafes" }], productSpec: {}, confirmedItemIds: [] },
    locale: "en",
  });
  assert.deepEqual(r.newRequirements, [{ id: "req_iv_002", title: "Search works with part of a name" }]);
  assert.deepEqual(r.productSpec.decisions, ["Differs from the app now: Search needs the full name"]);
});

test("I-2: 못 읽은 칸은 건드리지 않는다 — 의도가 없으면 기존 oneLine 유지, 빈 목록이면 확인도 그대로", () => {
  const r = applyInterviewAnswer({ answer: { intent: null, must: [], notNeeded: [], differentNow: [], unread: ["intent", "must"] }, current, locale: "ko" });
  assert.equal(r.oneLine, "미용실 예약 앱");
  assert.deepEqual(r.confirmedItemIds, ["req_002"]);
  assert.deepEqual(r.newRequirements, []);
  assert.equal(normalizeTitle("  원하는  날짜를 골라 예약할 수 있다. "), "원하는 날짜를 골라 예약할 수 있다");
});

test("I-3: 카드 배선 — 기존 앱 문 개요에 인라인, 모달 없음, 회수 → 로컬 반영 → 미러·지시서", () => {
  const page = read("app/projects/[id]/page.tsx");
  assert.match(page, /import \{ InterviewPackCard \} from "@\/components\/InterviewPackCard"/);
  assert.match(page, /\{entryPath === "code" && <InterviewPackCard projectId=\{id\} \/>\}/);

  const card = read("components/InterviewPackCard.tsx");
  assert.doesNotMatch(card, /role="dialog"|aria-modal|fixed inset-0|Modal|createPortal/, "no modal/overlay");
  const body = card.slice(card.indexOf("async function handleApply()"));
  const parse = body.indexOf("parseInterviewAnswerApi(projectId, getUserKey(), answerText)");
  const apply = body.indexOf("applyInterviewAnswer({");
  const saveP = body.indexOf("saveProject({");
  const saveExt = body.indexOf("saveExtendedProjectData(projectId, {");
  const ruler = body.indexOf("mirrorThenBuildIntentRuler(projectId, loc, applied.confirmedItemIds)");
  assert.ok(parse >= 0 && apply > parse && saveP > apply && saveExt > saveP && ruler > saveExt, "parse → apply → local save → mirror+ruler");
  assert.match(body, /intentConfirmedItemIds: applied\.confirmedItemIds/);
  // 복사 버튼 + 붙여넣기 칸 + 반영 버튼
  assert.match(card, /navigator\.clipboard\.writeText\(prompt\)/);
  assert.match(card, /onChange=\{\(e\) => setAnswerText\(e\.target\.value\)\}/);
  // 못 읽은 부분은 정직하게
  assert.match(card, /c\.unreadLead/);
  // 질문 묶음은 확인 id와 함께 요청한다(역추론 지시서가 아직 없을 때의 요약 재료).
  // 옛 저장은 레거시 폴백으로 읽는다 — train-c-a7-confirmed-items CI-3.
  assert.match(card, /fetchInterviewPack\(projectId, getUserKey\(\), loc, effectiveConfirmedItemIds\(ext\?\.intentConfirmedItemIds, reqIds\)\)/);
});

function keyShape(o) {
  if (typeof o === "string") return "s";
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, keyShape(o[k])]));
}
function strings(o) {
  return typeof o === "string" ? [o] : Object.values(o).flatMap(strings);
}

test("I-4: 사전 interviewPack — KO/EN 같은 키, 초보자 금칙어 0, EN에 한글 0", () => {
  const ko = DICTIONARIES.ko.interviewPack;
  const en = DICTIONARIES.en.interviewPack;
  assert.ok(ko && en);
  assert.deepEqual(keyShape(ko), keyShape(en));
  for (const [loc, d] of [["ko", ko], ["en", en]]) {
    for (const s of strings(d)) {
      assert.deepEqual(devTermHits(s), [], `[${loc}] "${s}"`);
      assert.doesNotMatch(s, /워크스페이스|workspace/i);
    }
  }
  for (const s of strings(en)) assert.doesNotMatch(s, /[가-힣]/, s);
});

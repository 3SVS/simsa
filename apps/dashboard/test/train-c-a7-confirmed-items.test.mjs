/**
 * Train C · C-A7 검증 결함 수정 (PR #577 리뷰 P2-1·P2-2) — "유저가 확인한 항목" 목록의 단일 규칙.
 *
 * 고치기 전(PR #577 head) 결함:
 *  P2-1  이 PR 이전에 "맞나요?"를 확정한 기존 앱 문 프로젝트는 확인 목록 필드가 없다. 지시서 화면이
 *        `ext?.intentConfirmedItemIds`(undefined)를 그대로 보내 서버가 확인 0으로 읽고 must를 전부
 *        should로 강등했다. 카드는 확정 시각이 있으면 다시 뜨지 않으므로 "카드 재확정"으로 복구할 수도 없었다.
 *  P2-2  항목 화면에서 유저가 직접 추가·편집한 항목(item_*)이 확인 목록에 들어가지 않아, 역추론 지시서에서
 *        "앱에서 읽었지만 확인 안 됨"으로 분류되고 should로 강등됐다(아이디어로 항목 만들기·초안 확정도 같은 결함).
 *
 *  CI-1  effectiveConfirmedItemIds: 필드 없음(옛 저장) → 지금 항목 전부 · 명시적 [] → [] · 목록 → 그 목록
 *  CI-2  withUserAuthoredItems: 추가·편집·교체 — 유저가 쓴 것은 확인, "필요 없어요"로 뺀 항목은 그대로 미확인
 *  CI-3  읽는 곳 배선: 지시서 화면·인터뷰 카드가 폴백 규칙으로 확인 목록을 만든다
 *  CI-4  쓰는 곳 배선: 항목 화면(추가·편집·아이디어로 만들기)·앱 화면(아이디어로 만들기)·초안 확정이 확인 목록을 남긴다
 * 각 검사는 고치기 전 코드에서 실패한다(CI-1·CI-2는 모듈 부재, CI-3·CI-4는 배선 부재).
 * 한글 리얼 데이터(Rule 6): "(주)트루픽셀 예약 앱".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

const { effectiveConfirmedItemIds, withUserAuthoredItems } = await import("../src/lib/confirmed-items.mjs");
const { applyInterviewAnswer } = await import("../src/lib/interview-apply.mjs");

// "(주)트루픽셀 예약 앱" — 이 PR 이전에 "맞나요?"에서 두 항목을 남기고 확정한 프로젝트.
const legacyRequirements = [
  { id: "req_001", title: "원하는 날짜를 골라 예약할 수 있다" },
  { id: "req_003", title: "예약 내역을 확인할 수 있다" },
];
const legacyExt = { intentConfirmedAt: "2026-09-20T02:00:00.000Z", productSpec: { oneLine: "미용실 예약 앱" } };

test("CI-1: 필드 없음(옛 저장) → 지금 항목 전부가 확인된 것, 명시적 []은 폴백하지 않는다", () => {
  const ids = legacyRequirements.map((r) => r.id);
  assert.deepEqual(effectiveConfirmedItemIds(legacyExt.intentConfirmedItemIds, ids), ["req_001", "req_003"]);
  // 확정 시각이 없는 옛 기존 앱 프로젝트(카드 "나중에" 뒤 항목 화면에서 직접 쓴 항목)도 같다.
  assert.deepEqual(effectiveConfirmedItemIds(undefined, ["item_mf0a1", "item_mf0a2"]), ["item_mf0a1", "item_mf0a2"]);
  // 새 저장: 명시적 목록은 그대로(중복·빈 값·문자열 아닌 값은 버린다).
  assert.deepEqual(effectiveConfirmedItemIds(["req_003", "req_003", "", 7, " req_001 "], ids), ["req_003", "req_001"]);
  // "확인된 것 없음"이라는 명시적 값 — 폴백하면 확인 안 한 것을 확인한 것으로 바꾸게 된다.
  assert.deepEqual(effectiveConfirmedItemIds([], ids), []);
  assert.deepEqual(effectiveConfirmedItemIds(null, []), []);
});

test("CI-1′: 옛 프로젝트에 인터뷰 답을 반영해도 기존 확인 항목이 사라지지 않는다(폴백이 반영의 바탕)", () => {
  const r = applyInterviewAnswer({
    answer: { intent: "손님이 날짜를 골라 예약하는 것", must: ["예약 확인 화면에 고른 날짜가 보인다"], notNeeded: [], differentNow: [] },
    current: {
      oneLine: "미용실 예약 앱",
      requirements: legacyRequirements,
      productSpec: legacyExt.productSpec,
      confirmedItemIds: effectiveConfirmedItemIds(legacyExt.intentConfirmedItemIds, legacyRequirements.map((q) => q.id)),
    },
    locale: "ko",
  });
  assert.deepEqual(r.confirmedItemIds, ["req_001", "req_003", "req_iv_001"]);
});

test("CI-2: 유저가 직접 쓴 항목은 확인된 것 — 추가·편집·교체, '필요 없어요'로 뺀 항목은 그대로 미확인", () => {
  // 인터뷰가 req_002("후기를 남길 수 있다")를 NOT_NEEDED로 확인에서 뺀 새 프로젝트.
  const before = ["req_001", "req_002", "req_003"];
  const confirmed = ["req_001", "req_003"];
  // 항목 화면 "＋ 추가" — 새 항목만 확인에 더해진다. req_002는 여전히 미확인.
  assert.deepEqual(
    withUserAuthoredItems({ confirmedItemIds: confirmed, before, after: [...before, "item_mf0b7"], authored: ["item_mf0b7"] }),
    ["req_001", "req_003", "item_mf0b7"],
  );
  // 항목 화면 편집 — 유저가 고쳐 쓴 항목은 확인된 것이 된다.
  assert.deepEqual(
    withUserAuthoredItems({ confirmedItemIds: confirmed, before, after: before, authored: ["req_002"] }),
    ["req_001", "req_003", "req_002"],
  );
  // 아이디어 문장으로 항목 만들기(목록 교체) — 사라진 id는 끌고 가지 않는다.
  assert.deepEqual(
    withUserAuthoredItems({ confirmedItemIds: [], before: [], after: ["req_101", "req_102"], authored: ["req_101", "req_102"] }),
    ["req_101", "req_102"],
  );
  // 옛 프로젝트(필드 없음)에 추가 — 폴백 바탕 + 새 항목.
  assert.deepEqual(
    withUserAuthoredItems({ confirmedItemIds: undefined, before: ["req_001", "req_003"], after: ["req_001", "req_003", "item_mf0c1"], authored: ["item_mf0c1"] }),
    ["req_001", "req_003", "item_mf0c1"],
  );
});

test("CI-3: 읽는 곳 — 지시서 재생성·인터뷰 카드가 폴백 규칙으로 확인 목록을 만든다(undefined를 그대로 보내지 않는다)", () => {
  const devSpecPage = read("app/projects/[id]/dev-spec/page.tsx");
  assert.match(devSpecPage, /from "@\/lib\/confirmed-items\.mjs"/);
  assert.match(
    devSpecPage,
    /confirmedItemIds: effectiveConfirmedItemIds\(ext\?\.intentConfirmedItemIds, project!?\.requirements\.map\(\(req\) => req\.id\)\)/,
  );
  assert.doesNotMatch(devSpecPage, /confirmedItemIds: ext\?\.intentConfirmedItemIds,/);

  const card = read("components/InterviewPackCard.tsx");
  assert.match(card, /from "@\/lib\/confirmed-items\.mjs"/);
  assert.doesNotMatch(card, /ext\?\.intentConfirmedItemIds \?\? \[\]/, "옛 저장을 빈 목록으로 읽으면 기존 확인이 사라진다");
  const uses = card.match(/effectiveConfirmedItemIds\(ext\?\.intentConfirmedItemIds,/g) ?? [];
  assert.equal(uses.length, 2, "loadPack(질문 묶음)·handleApply(반영 바탕) 두 곳");
});

test("CI-4: 쓰는 곳 — 유저가 쓰거나 확정한 항목이 확인 목록에 남는다", () => {
  const items = read("app/projects/[id]/items/page.tsx");
  assert.match(items, /from "@\/lib\/confirmed-items\.mjs"/);
  // persist가 authored를 받아 확인 목록을 함께 저장한다.
  assert.match(items, /intentConfirmedItemIds: withUserAuthoredItems\(\{/);
  // 추가(newId)·편집(editingId)·아이디어로 만들기(generated id 전부)가 각각 authored로 넘긴다.
  assert.match(items, /\{ criteria: \{ \[newId\]: criteria \}, notes: \{ \[newId\]: note \} \},\s*\[newId\],/);
  assert.match(items, /\{ criteria: \{ \[editingId\]: criteria \}, notes: \{ \[editingId\]: note \} \},\s*\[editingId\],/);
  assert.match(items, /\{ criteria \},\s*generated\.items\.map\(\(i\) => i\.id\),/);

  const github = read("app/projects/[id]/github/page.tsx");
  assert.match(github, /from "@\/lib\/confirmed-items\.mjs"/);
  assert.match(github, /intentConfirmedItemIds: withUserAuthoredItems\(\{[\s\S]*?authored: generated\.items\.map\(\(i\) => i\.id\)/);

  const draft = read("app/projects/[id]/sources/[sourceId]/draft/page.tsx");
  assert.match(draft, /from "@\/lib\/confirmed-items\.mjs"/);
  assert.match(draft, /intentConfirmedItemIds: withUserAuthoredItems\(\{[\s\S]*?authored: draft\.items\.map\(\(i\) => i\.id\)/);
});

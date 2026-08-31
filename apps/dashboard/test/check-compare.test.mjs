/**
 * check-compare.test.mjs — G3 회귀 감지 (docs/simsa-gap-backlog-2026-07-18.md).
 * regression = 통과→비통과 (가장 아픈 신호), recovered = 비통과→통과.
 * 추가/삭제된 항목은 비교 대상 아님 — 항목을 늘렸다고 회귀 경고가 뜨면 안 된다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCheckComparison } from "../src/lib/check-compare.mjs";

const r = (itemId, status, title) => ({ itemId, status, title: title ?? itemId });

test("passed → failed is a regression with from/to; unchanged items are not", () => {
  const cmp = computeCheckComparison(
    [r("a", "passed"), r("b", "passed"), r("c", "failed")],
    [r("a", "failed", "항목 A"), r("b", "passed"), r("c", "failed")],
  );
  assert.equal(cmp.regressions.length, 1);
  assert.deepEqual(cmp.regressions[0], { itemId: "a", title: "항목 A", from: "passed", to: "failed" });
  assert.equal(cmp.recovered.length, 0);
  assert.equal(cmp.comparedCount, 3);
});

// ★2026-09-01 규칙 정정 (의도한 동작 변경): 종전엔 `통과 → 비통과` 전부를 회귀로
// 셌다. 그런데 "확인 부족"은 **이번에 확인을 못 했다**는 뜻이지 망가졌다는 뜻이
// 아니다. 그걸 회귀로 세면 사용자가 **멀쩡한 수정을 되돌리게** 된다.
// 서버 쪽 run-comparison.ts와 같은 규칙으로 맞췄다.
test("★통과 → 확인 부족/결정 필요는 회귀가 아니라 uncertain이다", () => {
  const cmp = computeCheckComparison(
    [r("a", "passed"), r("b", "passed")],
    [r("a", "inconclusive"), r("b", "needs_decision")],
  );
  assert.equal(cmp.regressions.length, 0, "못 잰 것을 망가졌다고 하지 않는다");
  assert.equal(cmp.uncertain.length, 2);
});

// ★같은 정정의 뒷면: "확인 부족 → 통과"도 고쳐진 것으로 세지 않는다. 원래
// 나쁘다고 판정한 적이 없으므로 "고쳤다"고 말할 근거가 없다.
test("안 맞음 → 통과만 recovered다 (확인 부족 → 통과는 아니다)", () => {
  const cmp = computeCheckComparison(
    [r("a", "failed"), r("b", "inconclusive")],
    [r("a", "passed"), r("b", "passed")],
  );
  assert.deepEqual(cmp.recovered.map((x) => x.itemId), ["a"]);
  assert.equal(cmp.regressions.length, 0);
});

test("added/removed items are ignored — growing the list never scares the user", () => {
  const cmp = computeCheckComparison(
    [r("a", "passed"), r("gone", "passed")],
    [r("a", "passed"), r("new", "failed")],
  );
  assert.equal(cmp.regressions.length, 0);
  assert.equal(cmp.recovered.length, 0);
  assert.equal(cmp.comparedCount, 1);
});

test("failed → inconclusive (sideways move) is neither regression nor recovery", () => {
  const cmp = computeCheckComparison([r("a", "failed")], [r("a", "inconclusive")]);
  assert.equal(cmp.regressions.length, 0);
  assert.equal(cmp.recovered.length, 0);
});

test("null/empty inputs → empty comparison (first run shows nothing)", () => {
  assert.deepEqual(computeCheckComparison(null, [r("a", "passed")]),
    { regressions: [], recovered: [], uncertain: [], comparedCount: 0 });
  assert.deepEqual(computeCheckComparison(undefined, undefined),
    { regressions: [], recovered: [], uncertain: [], comparedCount: 0 });
});

// ─── 2026-09-01: 서버 구현과 규칙이 갈리지 않게 (증거 규칙 R5) ────────────────
//
// 같은 규칙이 클라이언트(check-compare.mjs)와 서버(run-comparison.ts) 양쪽에 있다.
// 갈리면 화면과 리포트가 서로 다른 말을 한다. 그래서 **같은 입력 표**로 양쪽을 잰다.
const PREV = [
  { itemId: "a", status: "passed", title: "A" },
  { itemId: "b", status: "passed", title: "B" },
  { itemId: "c", status: "failed", title: "C" },
];
const NEXT = [
  { itemId: "a", status: "failed", title: "A" },        // 진짜 회귀
  { itemId: "b", status: "inconclusive", title: "B" },  // 불확실 — 회귀 아님
  { itemId: "c", status: "passed", title: "C" },        // 고쳐짐
];

test("★안 맞음으로 바뀐 것만 회귀다 (서버와 같은 규칙)", () => {
  const c = computeCheckComparison(PREV, NEXT);
  assert.equal(c.regressions.length, 1);
  assert.equal(c.regressions[0].itemId, "a");
});

test("★통과 → 확인 부족은 uncertain — 멀쩡한 수정을 되돌리게 하면 안 된다", () => {
  const c = computeCheckComparison(PREV, NEXT);
  assert.equal(c.uncertain.length, 1);
  assert.equal(c.uncertain[0].itemId, "b");
  assert.ok(!c.regressions.some((x) => x.itemId === "b"));
});

test("고쳐진 것은 recovered", () => {
  assert.deepEqual(computeCheckComparison(PREV, NEXT).recovered.map((x) => x.itemId), ["c"]);
});

test("확인 부족 → 통과는 recovered로 세지 않는다 — 나쁘다고 판정한 적이 없다", () => {
  const c = computeCheckComparison([{ itemId: "x", status: "inconclusive" }], [{ itemId: "x", status: "passed" }]);
  assert.equal(c.recovered.length, 0);
});

// ─── 칩과 리포트가 같은 말을 하는가 (2026-09-01) ──────────────────────────────
//
// 8/26에 "문제를 찾지 못했어요"(Conditionally Ready)를 넣었는데 verdictLabel이
// `decision`을 받아놓고 쓰지 않아, **"확인 못 했어요"와 똑같은 칩**으로 나왔다.
// 리포트는 한 말을 하고 칩은 다른 말을 하는 상태였다.
test("★'문제를 찾지 못했어요'와 '확인 필요'는 다른 칩이다", async () => {
  const { verdictLabel } = await import("../src/lib/visual-check-view.mjs");
  const { getDictionary } = await import("../src/i18n/dictionary.mjs");
  const t = getDictionary("ko");

  const noProblems = verdictLabel(null, "Conditionally Ready", t);
  const unknown = verdictLabel(null, "Not Verified", t);

  assert.notEqual(noProblems.label, unknown.label, "둘은 사용자에게 다른 소식이다");
  assert.notEqual(noProblems.tone, unknown.tone, "색도 달라야 한다");
});

test("★'문제를 찾지 못했어요'는 초록(작동 확인)이 아니다", async () => {
  const { verdictLabel } = await import("../src/lib/visual-check-view.mjs");
  const { getDictionary } = await import("../src/i18n/dictionary.mjs");
  const t = getDictionary("ko");
  // 우리는 확인한 게 아니라 못 찾은 것이다 — 확언 칩을 빌려 쓰면 과장이 된다.
  assert.notEqual(verdictLabel(null, "Conditionally Ready", t).tone, "passed");
  assert.equal(verdictLabel(true, "Ready", t).tone, "passed");
});

test("EN도 같은 구분을 지킨다", async () => {
  const { verdictLabel } = await import("../src/lib/visual-check-view.mjs");
  const { getDictionary } = await import("../src/i18n/dictionary.mjs");
  const t = getDictionary("en");
  assert.notEqual(
    verdictLabel(null, "Conditionally Ready", t).label,
    verdictLabel(null, "Not Verified", t).label,
  );
});

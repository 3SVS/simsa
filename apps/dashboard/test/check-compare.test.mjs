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

test("passed → inconclusive/needs_decision also count as regressions", () => {
  const cmp = computeCheckComparison(
    [r("a", "passed"), r("b", "passed")],
    [r("a", "inconclusive"), r("b", "needs_decision")],
  );
  assert.equal(cmp.regressions.length, 2);
  assert.deepEqual(cmp.regressions.map((x) => x.to).sort(), ["inconclusive", "needs_decision"]);
});

test("non-passed → passed is recovered (fixes confirmed working)", () => {
  const cmp = computeCheckComparison(
    [r("a", "failed"), r("b", "inconclusive")],
    [r("a", "passed"), r("b", "passed")],
  );
  assert.equal(cmp.recovered.length, 2);
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
    { regressions: [], recovered: [], comparedCount: 0 });
  assert.deepEqual(computeCheckComparison(undefined, undefined),
    { regressions: [], recovered: [], comparedCount: 0 });
});

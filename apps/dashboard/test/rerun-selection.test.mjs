/**
 * Stage 40: re-run item selection logic.
 *
 * Runs under `node --test` via Node 24 type-stripping of the imported .ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  recommendedRerunItemIds,
  allRerunItemIds,
  nonPassedRerunItemIds,
  canRerun,
  formatSelectedCountMessage,
} from "../src/lib/rerun-selection.ts";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const ITEMS = [
  { itemId: "a", status: "passed" },
  { itemId: "b", status: "failed" },
  { itemId: "c", status: "inconclusive" },
  { itemId: "d", status: "needs_decision" },
  { itemId: "e", status: "passed" },
];

// ─── 추천 선택 / default selection ───────────────────────────────────────────

test("추천 선택 selects failed / inconclusive / needs_decision", () => {
  assert.deepEqual(recommendedRerunItemIds(ITEMS), ["b", "c", "d"]);
});

test("passed items are NOT selected by default (추천 선택)", () => {
  const ids = recommendedRerunItemIds(ITEMS);
  assert.ok(!ids.includes("a"));
  assert.ok(!ids.includes("e"));
});

test("추천 선택 on an all-passed run is empty", () => {
  assert.deepEqual(
    recommendedRerunItemIds([
      { itemId: "x", status: "passed" },
      { itemId: "y", status: "passed" },
    ]),
    [],
  );
});

// ─── 전체 선택 ───────────────────────────────────────────────────────────────

test("전체 선택 selects all items", () => {
  assert.deepEqual(allRerunItemIds(ITEMS), ["a", "b", "c", "d", "e"]);
});

// ─── 통과 제외 ───────────────────────────────────────────────────────────────

test("통과 제외 excludes passed items", () => {
  const ids = nonPassedRerunItemIds(ITEMS);
  assert.deepEqual(ids, ["b", "c", "d"]);
  assert.ok(!ids.includes("a"));
  assert.ok(!ids.includes("e"));
});

// ─── 모두 해제 ───────────────────────────────────────────────────────────────

test("모두 해제 clears selection (caller applies [])", () => {
  // The preset feeds [] to the picker; this asserts the empty contract.
  const cleared = [];
  assert.equal(cleared.length, 0);
  assert.equal(canRerun(cleared.length), false);
});

// ─── re-run enablement ───────────────────────────────────────────────────────

test("re-run is disabled when no items are selected", () => {
  assert.equal(canRerun(0), false);
});

test("re-run is enabled with at least one item", () => {
  assert.equal(canRerun(1), true);
  assert.equal(canRerun(3), true);
});

// ─── comparison count message ────────────────────────────────────────────────

test("comparison count message reflects the selected count", () => {
  assert.equal(formatSelectedCountMessage(3), "선택한 3개 항목을 다시 확인했습니다.");
  assert.equal(formatSelectedCountMessage(1), "선택한 1개 항목을 다시 확인했습니다.");
});

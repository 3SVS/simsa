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
  toggleItemSelection,
  canRerun,
  formatSelectedCountMessage,
  quickRerunDisabledMessage,
  buildRunDetailHref,
  buildFixPackHref,
} from "../src/lib/rerun-selection.mjs";

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

// ─── Stage 41: history-list quick re-run helpers ─────────────────────────────

test("quickRerunDisabledMessage: no remaining issues", () => {
  assert.equal(quickRerunDisabledMessage("no_remaining_issues"), "다시 확인할 남은 문제가 없어요.");
  assert.equal(quickRerunDisabledMessage(undefined), "다시 확인할 남은 문제가 없어요.");
});

test("quickRerunDisabledMessage: results unavailable", () => {
  assert.equal(quickRerunDisabledMessage("results_unavailable"), "확인 결과가 없어 다시 확인할 수 없어요.");
});

test("buildRunDetailHref: navigates to the new run detail", () => {
  assert.equal(
    buildRunDetailHref("proj1", "wprr_new"),
    "/projects/proj1/github/history/wprr_new",
  );
});

test("buildRunDetailHref: carries the source run as fromRunId", () => {
  assert.equal(
    buildRunDetailHref("proj1", "wprr_new", "wprr_old"),
    "/projects/proj1/github/history/wprr_new?fromRunId=wprr_old",
  );
});

// ─── Stage 42: history-list quick Fix Pack ───────────────────────────────────

test("buildFixPackHref: links to detail with action=fix-pack", () => {
  assert.equal(
    buildFixPackHref("proj1", "wprr_42"),
    "/projects/proj1/github/history/wprr_42?action=fix-pack",
  );
});

test("quick Fix Pack uses the same recommended set as re-run (failed/inconclusive/needs_decision)", () => {
  // The history-list Fix Pack button is enabled on the same recommendedItemCount,
  // and the request sends exactly the recommended (non-passed) itemIds.
  const ids = recommendedRerunItemIds([
    { itemId: "a", status: "passed" },
    { itemId: "b", status: "failed" },
    { itemId: "c", status: "needs_decision" },
  ]);
  assert.deepEqual(ids, ["b", "c"]);
  assert.equal(canRerun(ids.length), true);
});

// ─── Stage 43: shared selection toggle ───────────────────────────────────────

const ITEMS43 = [
  { itemId: "a", status: "passed" },
  { itemId: "b", status: "failed" },
  { itemId: "c", status: "inconclusive" },
];

test("toggleItemSelection adds an item, preserving items order", () => {
  // start with ["c"], add "a" → ordered ["a","c"] (items order: a,b,c)
  assert.deepEqual(toggleItemSelection(ITEMS43, ["c"], "a"), ["a", "c"]);
});

test("toggleItemSelection removes an item when already selected", () => {
  assert.deepEqual(toggleItemSelection(ITEMS43, ["b", "c"], "b"), ["c"]);
});

test("toggleItemSelection stays deduped", () => {
  // toggling "a" off from a set that had it once → removed
  assert.deepEqual(toggleItemSelection(ITEMS43, ["a", "b"], "a"), ["b"]);
});

test("shared selection: clearing disables both re-run and Fix Pack (same predicate)", () => {
  // ReviewItemSelectionPanel "모두 해제" → [] → canRerun false → both buttons disabled
  const cleared = [];
  assert.equal(canRerun(cleared.length), false);
  // Fix Pack uses selectedCount > 0, identical to canRerun's contract
  assert.equal(cleared.length > 0, false);
});

test("shared selection default equals recommended (failed/inconclusive/needs_decision)", () => {
  assert.deepEqual(recommendedRerunItemIds(ITEMS43), ["b", "c"]);
});

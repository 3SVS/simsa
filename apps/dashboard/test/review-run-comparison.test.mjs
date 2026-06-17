/**
 * Stage 45: source-vs-current run comparison (review-run-comparison).
 * Plain .mjs imports → Node 20 compatible under `node --test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareReviewRunResults,
  pickComparisonSourceRunId,
  canPostComparisonToComment,
  buildComparisonCommentInput,
  getReviewStatusLabel,
  buildStatusTransitionLabel,
} from "../src/lib/review-run-comparison.mjs";

function item(itemId, status, title = itemId) {
  return { itemId, title, status, reason: "", evidence: [`${itemId} 근거`], nextAction: `${itemId} 조치` };
}

// ─── source selection precedence ─────────────────────────────────────────────

test("query fromRunId takes priority over rerunOfReviewRunId", () => {
  assert.equal(
    pickComparisonSourceRunId({ fromRunId: "q", runId: "cur", rerunOfReviewRunId: "lineage" }),
    "q",
  );
});

test("rerunOfReviewRunId is used when fromRunId is absent", () => {
  assert.equal(
    pickComparisonSourceRunId({ fromRunId: null, runId: "cur", rerunOfReviewRunId: "lineage" }),
    "lineage",
  );
});

test("source selection ignores same runId (fromRunId === current)", () => {
  assert.equal(
    pickComparisonSourceRunId({ fromRunId: "cur", runId: "cur", rerunOfReviewRunId: "lineage" }),
    "lineage", // falls through to lineage
  );
});

test("source selection ignores same runId (lineage === current) → null", () => {
  assert.equal(
    pickComparisonSourceRunId({ fromRunId: null, runId: "cur", rerunOfReviewRunId: "cur" }),
    null,
  );
});

test("no source when neither present", () => {
  assert.equal(pickComparisonSourceRunId({ fromRunId: null, runId: "cur" }), null);
});

// ─── classification ──────────────────────────────────────────────────────────

test("classifies improved / stillOpen / newlyProblematic / unchanged", () => {
  const source = [
    item("a", "failed"),    // → passed   = improved
    item("b", "failed"),    // → failed   = stillOpen
    item("c", "passed"),    // → failed   = newlyProblematic
    item("d", "passed"),    // → passed   = unchanged
  ];
  const current = [
    item("a", "passed"),
    item("b", "failed"),
    item("c", "failed"),
    item("d", "passed"),
  ];
  const cmp = compareReviewRunResults({ sourceResults: source, currentResults: current });
  assert.equal(cmp.comparable, true);
  assert.deepEqual(cmp.improved.map((i) => i.itemId), ["a"]);
  assert.deepEqual(cmp.stillOpen.map((i) => i.itemId), ["b"]);
  assert.deepEqual(cmp.newlyProblematic.map((i) => i.itemId), ["c"]);
  assert.deepEqual(cmp.unchanged.map((i) => i.itemId), ["d"]);
});

test("summary counts match the groups", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed"), item("b", "passed")],
    currentResults: [item("a", "passed"), item("b", "failed")],
  });
  assert.deepEqual(cmp.summary, { improved: 1, stillOpen: 0, newlyProblematic: 1, unchanged: 0 });
});

test("partial-credit improvement (failed → inconclusive) counts as improved", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed")],
    currentResults: [item("a", "inconclusive")],
  });
  assert.deepEqual(cmp.improved.map((i) => i.itemId), ["a"]);
});

test("current-only item: non-passed → stillOpen, passed → unchanged", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed")],
    currentResults: [item("a", "failed"), item("new1", "failed"), item("new2", "passed")],
  });
  assert.ok(cmp.stillOpen.some((i) => i.itemId === "new1"));
  assert.ok(cmp.unchanged.some((i) => i.itemId === "new2"));
});

// ─── not comparable ──────────────────────────────────────────────────────────

test("missing source results → comparable false, reason missing_source_results", () => {
  const cmp = compareReviewRunResults({ sourceResults: [], currentResults: [item("a", "failed")] });
  assert.equal(cmp.comparable, false);
  assert.equal(cmp.reason, "missing_source_results");
  assert.deepEqual(cmp.summary, { improved: 0, stillOpen: 0, newlyProblematic: 0, unchanged: 0 });
});

test("missing current results → comparable false, reason missing_current_results", () => {
  const cmp = compareReviewRunResults({ sourceResults: [item("a", "failed")], currentResults: [] });
  assert.equal(cmp.comparable, false);
  assert.equal(cmp.reason, "missing_current_results");
});

test("non-array inputs are handled as not comparable", () => {
  const cmp = compareReviewRunResults({ sourceResults: undefined, currentResults: undefined });
  assert.equal(cmp.comparable, false);
  assert.equal(cmp.reason, "missing_source_results");
});

// ─── Stage 46: comparison → PR comment shortcut ──────────────────────────────

test("canPostComparisonToComment: comparable + lineage → true", () => {
  assert.equal(canPostComparisonToComment({ comparable: true, hasLineage: true }), true);
});

test("canPostComparisonToComment: not comparable → false (shortcut hidden)", () => {
  assert.equal(canPostComparisonToComment({ comparable: false, hasLineage: true }), false);
});

test("canPostComparisonToComment: fromRunId-only, no lineage → false", () => {
  assert.equal(canPostComparisonToComment({ comparable: true, hasLineage: false }), false);
});

test("buildComparisonCommentInput: includes reviewRunId + includeRerunComparison=true", () => {
  const input = buildComparisonCommentInput({
    userKey: "uk", reviewRunId: "run_cur", selectedItemIds: ["a", "b"],
    includeRerunComparison: true, comparisonAvailable: true,
  });
  assert.equal(input.reviewRunId, "run_cur");
  assert.equal(input.includeRerunComparison, true);
  assert.equal(input.userKey, "uk");
});

test("buildComparisonCommentInput: never sends includeComparison alongside rerun comparison", () => {
  const input = buildComparisonCommentInput({
    userKey: "uk", reviewRunId: "run_cur", selectedItemIds: ["a"],
    includeRerunComparison: true, comparisonAvailable: true,
  });
  assert.ok(!("includeComparison" in input), "includeComparison must not be present");
});

test("buildComparisonCommentInput: selectedItemIds passed through when non-empty", () => {
  const input = buildComparisonCommentInput({
    userKey: "uk", reviewRunId: "run_cur", selectedItemIds: ["a", "b"],
    includeRerunComparison: true, comparisonAvailable: true,
  });
  assert.deepEqual(input.selectedItemIds, ["a", "b"]);
});

test("buildComparisonCommentInput: selectedItemIds omitted when empty", () => {
  const input = buildComparisonCommentInput({
    userKey: "uk", reviewRunId: "run_cur", selectedItemIds: [],
    includeRerunComparison: true, comparisonAvailable: true,
  });
  assert.ok(!("selectedItemIds" in input));
});

test("buildComparisonCommentInput: forces includeRerunComparison false when no lineage", () => {
  const input = buildComparisonCommentInput({
    userKey: "uk", reviewRunId: "run_cur", selectedItemIds: ["a"],
    includeRerunComparison: true, comparisonAvailable: false,
  });
  assert.equal(input.includeRerunComparison, false);
});

// ─── Stage 48: status labels + transitions ───────────────────────────────────

test("getReviewStatusLabel maps each status to Korean", () => {
  assert.equal(getReviewStatusLabel("passed"), "통과");
  assert.equal(getReviewStatusLabel("failed"), "안 맞음");
  assert.equal(getReviewStatusLabel("inconclusive"), "확인 부족");
  assert.equal(getReviewStatusLabel("needs_decision"), "결정 필요");
});

test("buildStatusTransitionLabel returns 안 맞음 → 통과", () => {
  assert.equal(buildStatusTransitionLabel("failed", "passed"), "안 맞음 → 통과");
});

test("buildStatusTransitionLabel handles current-only item (새 항목)", () => {
  assert.equal(buildStatusTransitionLabel(undefined, "failed"), "새 항목 → 안 맞음");
});

test("compareReviewRunResults returns sourceStatus/currentStatus per item", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed")],
    currentResults: [item("a", "passed")],
  });
  const it = cmp.improved[0];
  assert.equal(it.sourceStatus, "failed");
  assert.equal(it.currentStatus, "passed");
  assert.equal(it.currentEvidence, "a 근거");
  assert.equal(it.currentNextAction, "a 조치");
});

test("improved item includes transition failed → passed", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed")],
    currentResults: [item("a", "passed")],
  });
  assert.equal(cmp.improved[0].transitionLabel, "안 맞음 → 통과");
  assert.equal(cmp.improved[0].direction, "improved");
});

test("newlyProblematic item includes transition passed → failed", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "passed")],
    currentResults: [item("a", "failed")],
  });
  assert.equal(cmp.newlyProblematic[0].transitionLabel, "통과 → 안 맞음");
  assert.equal(cmp.newlyProblematic[0].direction, "worsened");
});

test("unchanged item includes transition passed → passed", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "passed")],
    currentResults: [item("a", "passed")],
  });
  assert.equal(cmp.unchanged[0].transitionLabel, "통과 → 통과");
  assert.equal(cmp.unchanged[0].direction, "unchanged");
});

test("still_open item keeps the same non-passed status with still_open direction", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed")],
    currentResults: [item("a", "failed")],
  });
  assert.equal(cmp.stillOpen[0].transitionLabel, "안 맞음 → 안 맞음");
  assert.equal(cmp.stillOpen[0].direction, "still_open");
});

test("current-only item: sourceStatus undefined, label uses 새 항목", () => {
  const cmp = compareReviewRunResults({
    sourceResults: [item("a", "failed")],
    currentResults: [item("a", "failed"), item("new1", "needs_decision")],
  });
  const newItem = cmp.stillOpen.find((i) => i.itemId === "new1");
  assert.equal(newItem.sourceStatus, undefined);
  assert.equal(newItem.transitionLabel, "새 항목 → 결정 필요");
});

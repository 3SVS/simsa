/**
 * lib/rerun-selection.mjs
 *
 * Stage 40: pure selection helpers for the "다시 확인할 항목" (re-run item picker).
 *
 * Plain ESM JavaScript (not .ts) on purpose: CI runs `node --test` on the
 * Node 20 floor, which can't type-strip .ts imports. Shipping .mjs + a
 * .d.mts declaration keeps full type-safety in the app while letting the
 * test run on every supported Node. Dependency-free and side-effect-free.
 *
 * 표현 규칙: 안 맞음(failed) / 확인 부족(inconclusive) / 결정 필요(needs_decision) / 통과(passed).
 *
 * @typedef {"passed" | "failed" | "inconclusive" | "needs_decision"} RerunItemStatus
 * @typedef {{ itemId: string, status: RerunItemStatus }} RerunSelectableItem
 */

/**
 * Statuses recommended for a re-run by default (everything except 통과).
 * @type {ReadonlySet<RerunItemStatus>}
 */
const RECOMMENDED_STATUSES = new Set(["failed", "inconclusive", "needs_decision"]);

/**
 * 추천 선택 — 안 맞음 / 확인 부족 / 결정 필요 (통과는 제외). Also the default selection.
 * @param {readonly RerunSelectableItem[]} items
 * @returns {string[]}
 */
export function recommendedRerunItemIds(items) {
  return items.filter((i) => RECOMMENDED_STATUSES.has(i.status)).map((i) => i.itemId);
}

/**
 * 전체 선택 — 모든 항목.
 * @param {readonly RerunSelectableItem[]} items
 * @returns {string[]}
 */
export function allRerunItemIds(items) {
  return items.map((i) => i.itemId);
}

/**
 * 통과 제외 — 통과(passed)만 빼고 전부.
 * @param {readonly RerunSelectableItem[]} items
 * @returns {string[]}
 */
export function nonPassedRerunItemIds(items) {
  return items.filter((i) => i.status !== "passed").map((i) => i.itemId);
}

/**
 * Toggle one item in the shared selection, returning a new array that stays
 * de-duplicated and ordered to match `items` (Stage 43 shared selection).
 * @param {readonly RerunSelectableItem[]} items
 * @param {readonly string[]} selectedItemIds
 * @param {string} itemId
 * @returns {string[]}
 */
export function toggleItemSelection(items, selectedItemIds, itemId) {
  const set = new Set(selectedItemIds);
  if (set.has(itemId)) set.delete(itemId);
  else set.add(itemId);
  return items.filter((i) => set.has(i.itemId)).map((i) => i.itemId);
}

/**
 * Re-run is allowed only when at least one item is selected.
 * @param {number} selectedCount
 * @returns {boolean}
 */
export function canRerun(selectedCount) {
  return selectedCount > 0;
}

/**
 * Korean message shown above the comparison after a selective re-run.
 * @param {number} selectedCount
 * @returns {string}
 */
export function formatSelectedCountMessage(selectedCount) {
  return `선택한 ${selectedCount}개 항목을 다시 확인했습니다.`;
}

// ─── Stage 41: history-list quick re-run ─────────────────────────────────────

/**
 * Korean tooltip/hint for a disabled quick re-run button.
 * @param {"no_remaining_issues" | "results_unavailable" | undefined} reason
 * @returns {string}
 */
export function quickRerunDisabledMessage(reason) {
  if (reason === "results_unavailable") return "확인 결과가 없어 다시 확인할 수 없어요.";
  return "다시 확인할 남은 문제가 없어요.";
}

/**
 * Detail-page href for a newly created run, optionally carrying the source run.
 * @param {string} projectId
 * @param {string} newRunId
 * @param {string} [fromRunId]
 * @returns {string}
 */
export function buildRunDetailHref(projectId, newRunId, fromRunId) {
  const base = `/projects/${projectId}/github/history/${newRunId}`;
  return fromRunId ? `${base}?fromRunId=${encodeURIComponent(fromRunId)}` : base;
}

/**
 * Detail-page href that auto-opens the "남은 문제 Fix Pack" panel (Stage 42).
 * @param {string} projectId
 * @param {string} runId
 * @returns {string}
 */
export function buildFixPackHref(projectId, runId) {
  return `/projects/${projectId}/github/history/${runId}?action=fix-pack`;
}

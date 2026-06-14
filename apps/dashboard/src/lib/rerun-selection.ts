/**
 * lib/rerun-selection.ts
 *
 * Stage 40: pure selection helpers for the "다시 확인할 항목" (re-run item picker).
 *
 * Kept dependency-free and side-effect-free so the run-detail page can import
 * it directly and `node --test` can exercise it via type-stripping.
 *
 * 표현 규칙: 안 맞음(failed) / 확인 부족(inconclusive) / 결정 필요(needs_decision) / 통과(passed).
 */

export type RerunItemStatus = "passed" | "failed" | "inconclusive" | "needs_decision";

/** Structural subset of ReviewResultItem — anything with itemId + status fits. */
export type RerunSelectableItem = { itemId: string; status: RerunItemStatus };

/** Statuses that are recommended for a re-run by default (everything except 통과). */
const RECOMMENDED_STATUSES: ReadonlySet<RerunItemStatus> = new Set([
  "failed",
  "inconclusive",
  "needs_decision",
]);

/** 추천 선택 — 안 맞음 / 확인 부족 / 결정 필요 (통과는 제외). Also the default selection. */
export function recommendedRerunItemIds(items: readonly RerunSelectableItem[]): string[] {
  return items.filter((i) => RECOMMENDED_STATUSES.has(i.status)).map((i) => i.itemId);
}

/** 전체 선택 — 모든 항목. */
export function allRerunItemIds(items: readonly RerunSelectableItem[]): string[] {
  return items.map((i) => i.itemId);
}

/** 통과 제외 — 통과(passed)만 빼고 전부. */
export function nonPassedRerunItemIds(items: readonly RerunSelectableItem[]): string[] {
  return items.filter((i) => i.status !== "passed").map((i) => i.itemId);
}

/** Re-run is allowed only when at least one item is selected. */
export function canRerun(selectedCount: number): boolean {
  return selectedCount > 0;
}

/** Korean message shown above the comparison after a selective re-run. */
export function formatSelectedCountMessage(selectedCount: number): string {
  return `선택한 ${selectedCount}개 항목을 다시 확인했습니다.`;
}

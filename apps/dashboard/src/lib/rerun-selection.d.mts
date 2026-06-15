/**
 * Type declarations for rerun-selection.mjs (Stage 40).
 */
export type RerunItemStatus = "passed" | "failed" | "inconclusive" | "needs_decision";

/** Structural subset of ReviewResultItem — anything with itemId + status fits. */
export type RerunSelectableItem = { itemId: string; status: RerunItemStatus };

/** 추천 선택 — 안 맞음 / 확인 부족 / 결정 필요 (통과 제외). Also the default selection. */
export function recommendedRerunItemIds(items: readonly RerunSelectableItem[]): string[];

/** 전체 선택 — 모든 항목. */
export function allRerunItemIds(items: readonly RerunSelectableItem[]): string[];

/** 통과 제외 — 통과(passed)만 빼고 전부. */
export function nonPassedRerunItemIds(items: readonly RerunSelectableItem[]): string[];

/** Toggle one item in the shared selection; result stays deduped + ordered like `items` (Stage 43). */
export function toggleItemSelection(
  items: readonly RerunSelectableItem[],
  selectedItemIds: readonly string[],
  itemId: string,
): string[];

/** Re-run is allowed only when at least one item is selected. */
export function canRerun(selectedCount: number): boolean;

/** Korean message shown above the comparison after a selective re-run. */
export function formatSelectedCountMessage(selectedCount: number): string;

/** Korean tooltip/hint for a disabled quick re-run button (Stage 41). */
export function quickRerunDisabledMessage(
  reason: "no_remaining_issues" | "results_unavailable" | undefined,
): string;

/** Detail-page href for a newly created run, optionally carrying the source run (Stage 41). */
export function buildRunDetailHref(
  projectId: string,
  newRunId: string,
  fromRunId?: string,
): string;

/** Detail-page href that auto-opens the "남은 문제 Fix Pack" panel (Stage 42). */
export function buildFixPackHref(projectId: string, runId: string): string;

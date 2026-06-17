/**
 * Type declarations for review-run-comparison.mjs (Stage 45).
 */
export type ReviewRunItemStatus = "passed" | "failed" | "inconclusive" | "needs_decision";

/** Structural subset — itemId + title + status; evidence/nextAction optional (Stage 48). */
export type ReviewRunItem = {
  itemId: string;
  title: string;
  status: ReviewRunItemStatus;
  evidence?: string[];
  nextAction?: string;
};

/** Stage 48: a transition-aware comparison item (이전 상태 → 현재 상태). */
export type ReviewRunComparisonItem = {
  itemId: string;
  title: string;
  sourceStatus?: ReviewRunItemStatus;
  currentStatus?: ReviewRunItemStatus;
  sourceEvidence?: string;
  currentEvidence?: string;
  sourceNextAction?: string;
  currentNextAction?: string;
  transitionLabel: string;
  direction: "improved" | "worsened" | "unchanged" | "still_open";
};

export type ReviewRunComparison = {
  comparable: boolean;
  improved: ReviewRunComparisonItem[];
  stillOpen: ReviewRunComparisonItem[];
  newlyProblematic: ReviewRunComparisonItem[];
  unchanged: ReviewRunComparisonItem[];
  summary: {
    improved: number;
    stillOpen: number;
    newlyProblematic: number;
    unchanged: number;
  };
  reason?: "missing_source_results" | "missing_current_results";
};

/** Korean label for a review status (Stage 48). */
export function getReviewStatusLabel(status: ReviewRunItemStatus | string | undefined): string;

/** "이전 상태 → 현재 상태" label; missing source → "새 항목 → 현재 상태" (Stage 48). */
export function buildStatusTransitionLabel(
  sourceStatus: ReviewRunItemStatus | string | undefined,
  currentStatus: ReviewRunItemStatus | string | undefined,
): string;

/**
 * Pick which run to compare against: query `fromRunId` > rerun lineage; self ignored.
 */
export function pickComparisonSourceRunId(args: {
  fromRunId?: string | null;
  runId: string;
  rerunOfReviewRunId?: string | null;
}): string | null;

/** Stage 46: comparison→comment shortcut is available only when comparable AND lineage exists. */
export function canPostComparisonToComment(args: {
  comparable?: boolean;
  hasLineage?: boolean;
}): boolean;

/** Stage 46: build the comparison-aware comment preview/post request body. */
export function buildComparisonCommentInput(args: {
  userKey: string;
  reviewRunId: string;
  selectedItemIds?: string[];
  includeRerunComparison?: boolean;
  comparisonAvailable?: boolean;
}): {
  userKey: string;
  reviewRunId: string;
  includeRerunComparison: boolean;
  selectedItemIds?: string[];
};

/**
 * Classify item-level changes between a source run and the current run.
 * Groups hold transition-aware ReviewRunComparisonItem entries (이전 상태 → 현재 상태).
 * comparable=false when either side has no results.
 */
export function compareReviewRunResults(args: {
  sourceResults: ReviewRunItem[];
  currentResults: ReviewRunItem[];
}): ReviewRunComparison;

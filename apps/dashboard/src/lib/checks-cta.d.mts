export declare function checksPrimaryCta(facts: {
  prReviewLoaded: boolean;
  hasPrReview: boolean;
  prNeedsAction: number;
  draftNeedsAction: number;
}): "connect_pr" | "pr_fix" | "draft_fix" | "none";

export declare function checksPrimaryCta(facts: {
  prSectionVisible: boolean;
  prReviewLoaded: boolean;
  hasPrReview: boolean;
  prNeedsAction: number;
  draftNeedsAction: number;
  draftHasResults: boolean;
}): "connect_pr" | "pr_fix" | "draft_fix" | "run_precheck" | "none";

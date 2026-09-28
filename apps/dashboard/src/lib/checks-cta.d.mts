export declare function checksPrimaryCta(facts: {
  prSectionVisible: boolean;
  prReviewLoaded: boolean;
  hasPrReview: boolean;
  prNeedsAction: number;
  draftNeedsAction: number;
  draftHasResults: boolean;
  /** A finished real-app check exists (#559 여정 렌즈 결함 3). */
  liveResult?: boolean;
}): "connect_pr" | "pr_fix" | "view_live" | "draft_fix" | "run_precheck" | "none";

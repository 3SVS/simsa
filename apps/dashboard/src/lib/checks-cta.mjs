/**
 * checks-cta.mjs
 *
 * The single filled primary on the check-results screen (UIUX #5 / #2). The
 * screen has two result sections — the draft spec pre-check and the real PR/code
 * review — each with its own forward action, which used to render as competing
 * primaries. This picks EXACTLY ONE, state-driven (not hand-chosen per button):
 * the most-forward actionable step, with the real code review outranking the
 * draft pre-check. Everything else recedes to secondary.
 *
 * Pure, no I/O.
 *
 * @param {{ prReviewLoaded: boolean, hasPrReview: boolean, prNeedsAction: number, draftNeedsAction: number }} facts
 * @returns {"connect_pr" | "pr_fix" | "draft_fix" | "none"}
 */
export function checksPrimaryCta({ prReviewLoaded, hasPrReview, prNeedsAction, draftNeedsAction }) {
  if (prReviewLoaded && !hasPrReview) return "connect_pr"; // no real review yet → get one
  if (hasPrReview && prNeedsAction > 0) return "pr_fix"; // real review has issues → fix them
  if (draftNeedsAction > 0) return "draft_fix"; // only the pre-check has issues
  return "none";
}

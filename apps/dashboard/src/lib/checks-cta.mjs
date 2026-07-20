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
 * v2 (2026-07-21, journey-audit 기준선): the pre-check EMPTY state's "확인
 * 실행" button hard-coded btn-primary and bypassed this machine — the screen
 * showed two filled primaries (실측 cta=2). Two new facts close that hole:
 *   - prSectionVisible: the PR section is gated off on idea-branch projects
 *     (#328 mirror) — a hidden section's CTA must never be the screen primary.
 *   - draftHasResults: when nothing is actionable elsewhere and the pre-check
 *     hasn't run, running it IS the primary ("run_precheck").
 *
 * Pure, no I/O.
 *
 * @param {{ prSectionVisible: boolean, prReviewLoaded: boolean, hasPrReview: boolean, prNeedsAction: number, draftNeedsAction: number, draftHasResults: boolean }} facts
 * @returns {"connect_pr" | "pr_fix" | "draft_fix" | "run_precheck" | "none"}
 */
export function checksPrimaryCta({ prSectionVisible, prReviewLoaded, hasPrReview, prNeedsAction, draftNeedsAction, draftHasResults }) {
  if (prSectionVisible && prReviewLoaded && !hasPrReview) return "connect_pr"; // no real review yet → get one
  if (hasPrReview && prNeedsAction > 0) return "pr_fix"; // real review has issues → fix them
  if (draftNeedsAction > 0) return "draft_fix"; // only the pre-check has issues
  if (!draftHasResults) return "run_precheck"; // nothing anywhere yet → run the pre-check
  return "none";
}

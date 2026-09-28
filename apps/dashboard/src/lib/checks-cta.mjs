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
 * v3 (2026-09-28, #559 여정 렌즈 결함 3): the default check is the REAL APP
 * (D1). After a first real-app check the sidebar's current step 3 item led here
 * — a screen that held no real-app result at all, only the brief pre-check and
 * its "run" primary. `liveResult` (a finished real-app check exists) now puts
 * "see that result" first — behind only a developer's PR review that found real
 * problems. Without it every answer is exactly as before (connect_pr and pr_fix
 * never both apply, so their relative order is unchanged).
 *
 * Pure, no I/O.
 *
 * @param {{ prSectionVisible: boolean, prReviewLoaded: boolean, hasPrReview: boolean, prNeedsAction: number, draftNeedsAction: number, draftHasResults: boolean, liveResult?: boolean }} facts
 * @returns {"connect_pr" | "pr_fix" | "view_live" | "draft_fix" | "run_precheck" | "none"}
 */
export function checksPrimaryCta({ prSectionVisible, prReviewLoaded, hasPrReview, prNeedsAction, draftNeedsAction, draftHasResults, liveResult }) {
  if (hasPrReview && prNeedsAction > 0) return "pr_fix"; // real review has issues → fix them
  if (liveResult === true) return "view_live"; // the real app was checked → see that result
  if (prSectionVisible && prReviewLoaded && !hasPrReview) return "connect_pr"; // no real review yet → get one
  if (draftNeedsAction > 0) return "draft_fix"; // only the pre-check has issues
  if (!draftHasResults) return "run_precheck"; // nothing anywhere yet → run the pre-check
  return "none";
}

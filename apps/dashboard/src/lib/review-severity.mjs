/**
 * Review-results severity + verdict helpers (pure, deterministic).
 *
 * The review screen restyle (UI interaction-states PR) shows findings as
 * collapsible cards with a *tinted* severity chip (P0 red / P1 amber / P2 gray)
 * and a top verdict banner. The colour/label mapping and the pass/fail verdict
 * math live here so they are testable under Node 20 CI (.mjs, no type-strip).
 *
 * Design rule: chips are tinted background + strong text (e.g. red-50 / red-700),
 * NEVER filled-solid — a review full of solid red/amber pills reads like a
 * christmas tree of warning lights. Triple-encode status (icon + colour + text)
 * so it stays colourblind-safe.
 */

/** Map an internal item status to a severity tier. */
export function severityForStatus(status) {
  switch (status) {
    case "failed":
      return "p0";
    case "needs_decision":
      return "p1";
    case "inconclusive":
      return "p2";
    case "passed":
      return "ok";
    default:
      // not_started / building / unknown
      return "neutral";
  }
}

/** Short severity code shown on the collapsed finding chip. */
export function severityCode(status) {
  const sev = severityForStatus(status);
  switch (sev) {
    case "p0":
      return "P0";
    case "p1":
      return "P1";
    case "p2":
      return "P2";
    default:
      return "";
  }
}

/**
 * Tailwind classes for a severity chip. Tinted bg + strong text + hairline
 * border — deliberately NOT a solid fill.
 */
export function severityChipClass(status) {
  const sev = severityForStatus(status);
  switch (sev) {
    case "p0":
      return "bg-red-50 text-red-700 border-red-200";
    case "p1":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "p2":
      return "bg-gray-100 text-gray-600 border-gray-200";
    case "ok":
      return "bg-green-50 text-green-700 border-green-200";
    default:
      return "bg-gray-50 text-gray-500 border-gray-200";
  }
}

/** True when a finding needs attention (should default-expand its card). */
export function isActionableStatus(status) {
  const sev = severityForStatus(status);
  return sev === "p0" || sev === "p1" || sev === "p2";
}

/**
 * Compute the pass/fail verdict from a review summary. `needsAction` counts any
 * finding that is not passed. Returns counts + a `tone` for the banner colour.
 * Numbers only — the caller localises the sentence.
 */
export function buildReviewVerdict(summary) {
  const passed = Math.max(0, Number(summary?.passed ?? 0) | 0);
  const failed = Math.max(0, Number(summary?.failed ?? 0) | 0);
  const inconclusive = Math.max(0, Number(summary?.inconclusive ?? 0) | 0);
  const needsDecision = Math.max(0, Number(summary?.needsDecision ?? 0) | 0);
  const needsAction = failed + inconclusive + needsDecision;
  const total = passed + needsAction;
  return {
    total,
    passed,
    needsAction,
    tone: needsAction === 0 && total > 0 ? "pass" : "fail",
  };
}

/**
 * Progress label parts for the in-progress "Checking… (2/5)" counter.
 * `done`/`total` are clamped so the counter never shows e.g. 6/5.
 */
export function reviewProgress(done, total) {
  const t = Math.max(0, Number(total ?? 0) | 0);
  const d = Math.min(Math.max(0, Number(done ?? 0) | 0), t || Number.MAX_SAFE_INTEGER);
  return { done: d, total: t };
}

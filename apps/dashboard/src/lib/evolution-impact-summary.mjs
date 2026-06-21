// Stage 80: pure display helpers for the experiment-level Evolution Impact
// Summary card. Deterministic, no network, no LLM. The summary itself is
// computed server-side via the Stage 79 helper + Stage 80 aggregator; this
// module only formats the response for the UI.

export const SUMMARY_OVERALL_VERDICTS = [
  "mostly_improved",
  "mixed",
  "mostly_inconclusive",
  "no_followups",
  "regressed",
];

/** Overall verdict → localized label key on t.evolution. */
export function summaryVerdictLabelKey(verdict) {
  switch (verdict) {
    case "mostly_improved":
      return "summaryMostlyImproved";
    case "mixed":
      return "summaryMixed";
    case "mostly_inconclusive":
      return "summaryMostlyInconclusive";
    case "no_followups":
      return "summaryNoFollowups";
    case "regressed":
      return "summaryRegressed";
    default:
      return "summaryMostlyInconclusive";
  }
}

/** Summary-reason enum → localized label key on t.evolution. */
export function summaryReasonLabelKey(reason) {
  switch (reason) {
    case "no_saved_action_packs":
      return "summaryReasonNoSavedPacks";
    case "no_followups":
      return "summaryReasonNoFollowups";
    case "more_improved_than_regressed":
      return "summaryReasonMoreImproved";
    case "regressions_detected":
      return "summaryReasonRegressions";
    case "mostly_inconclusive":
      return "summaryReasonMostlyInconclusive";
    case "mixed_results":
      return "summaryReasonMixedResults";
    case "not_enough_comparable_data":
      return "summaryReasonNotEnoughData";
    default:
      return "summaryReasonNotEnoughData";
  }
}

/** Format an unweighted average passRate delta as a percentage with sign. */
export function formatAverageDeltaPercent(value) {
  if (value === null || value === undefined) return "—";
  const pct = Math.round(value * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

/** Format an unweighted average integer-style delta with one decimal + sign. */
export function formatAverageDeltaCount(value) {
  if (value === null || value === undefined) return "—";
  // Show one decimal so an average of e.g. -1.5 blockers does not round to -2.
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

/** True when the summary has no packs at all OR none followed. */
export function summaryHasNoFollowups(summary) {
  if (!summary) return true;
  return summary.actionPackCount === 0 || summary.followedPackCount === 0;
}

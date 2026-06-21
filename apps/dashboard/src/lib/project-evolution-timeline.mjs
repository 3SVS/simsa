// Stage 82: pure display helpers for the project-level Evolution Timeline
// card. The timeline itself is computed server-side; this module only formats
// the response for the UI.

export const TIMELINE_EVENT_TYPES = [
  "experiment_created",
  "benchmark_created",
  "decision_recorded",
  "action_pack_saved",
  "followup_recorded",
  "impact_improved",
  "impact_regressed",
  "impact_inconclusive",
  "impact_unchanged",
];

/** Event type → localized title label key on t.evolution. */
export function timelineEventLabelKey(type) {
  switch (type) {
    case "experiment_created":
      return "timelineExperimentCreated";
    case "benchmark_created":
      return "timelineBenchmarkCreated";
    case "decision_recorded":
      return "timelineDecisionRecorded";
    case "action_pack_saved":
      return "timelineActionPackSaved";
    case "followup_recorded":
      return "timelineFollowupRecorded";
    case "impact_improved":
      return "timelineImpactImproved";
    case "impact_regressed":
      return "timelineImpactRegressed";
    case "impact_inconclusive":
      return "timelineImpactInconclusive";
    case "impact_unchanged":
      return "timelineImpactUnchanged";
    default:
      return "timelineExperimentCreated";
  }
}

/** Limitation code → localized label key on t.evolution. */
export function timelineLimitationLabelKey(code) {
  switch (code) {
    case "timeline_truncated":
      return "timelineTruncated";
    default:
      return code;
  }
}

/** True when the timeline has nothing to render. */
export function timelineHasNoEvents(timeline) {
  if (!timeline) return true;
  return !timeline.events || timeline.events.length === 0;
}

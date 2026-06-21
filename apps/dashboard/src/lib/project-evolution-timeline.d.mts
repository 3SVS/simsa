// Type declarations for project-evolution-timeline.mjs (Stage 82).
import type {
  ProjectEvolutionTimeline,
  ProjectTimelineEventType,
} from "./workspace-experiment-api";

export const TIMELINE_EVENT_TYPES: ProjectTimelineEventType[];

export function timelineEventLabelKey(
  type: ProjectTimelineEventType | string | null | undefined,
): string;
export function timelineLimitationLabelKey(code: string | null | undefined): string;
export function timelineHasNoEvents(
  timeline: ProjectEvolutionTimeline | null | undefined,
): boolean;

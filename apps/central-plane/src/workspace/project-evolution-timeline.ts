/**
 * workspace/project-evolution-timeline.ts — Stage 82
 *
 * Pure deterministic builder for a project's evolution timeline. Walks
 * already-loaded experiments / benchmarks / action packs / follow-ups /
 * Stage-79 impact comparisons and emits a chronologically ordered list of
 * structured events. NO LLM, NO randomness, NO subjective summaries — every
 * title is a fixed canonical English string the dashboard re-localizes via
 * i18n by event `type`.
 *
 * No persistence in Stage 82 — the display rules will evolve as we see real
 * project histories.
 */
import type { EvolutionImpactComparison } from "./evolution-impact.js";

export type ProjectTimelineEventType =
  | "experiment_created"
  | "benchmark_created"
  | "decision_recorded"
  | "action_pack_saved"
  | "followup_recorded"
  | "impact_improved"
  | "impact_regressed"
  | "impact_inconclusive"
  | "impact_unchanged";

export type ProjectEvolutionTimelineEvent = {
  id: string;
  type: ProjectTimelineEventType;
  occurredAt: string;
  experimentId?: string;
  benchmarkId?: string;
  actionPackId?: string;
  title: string;
  summary: string;
  status?: string;
  recommendedAction?: string;
  verdict?: string;
  href?: string;
};

export type ProjectEvolutionTimeline = {
  projectId: string;
  eventCount: number;
  events: ProjectEvolutionTimelineEvent[];
  limitations: string[];
};

export type TimelineExperimentInput = {
  id: string;
  title: string;
  templateId?: string;
  status?: string;
  createdAt: string;
  decisionStatus?: string;
  selectedCandidateId?: string;
  decidedAt?: string;
};

export type TimelineBenchmarkInput = {
  id: string;
  title?: string;
  createdAt: string;
  sourceExperimentId?: string;
};

export type TimelineActionPackInput = {
  id: string;
  experimentId: string;
  recommendedAction: string;
  title: string;
  createdAt: string;
  followup: {
    status: string;
    pullRequestNumber?: number;
    reviewRunId?: string;
    benchmarkId?: string;
    note?: string;
    followedAt?: string;
  };
  /** Computed per-pack Stage 79 impact, when the pack has any follow-up. The
   *  route handler is responsible for invoking `loadImpactForActionPack`. */
  impact?: EvolutionImpactComparison | null;
};

const TIMELINE_EVENT_CAP = 50;

const CANONICAL_TITLE: Record<ProjectTimelineEventType, string> = {
  experiment_created: "Experiment created",
  benchmark_created: "Benchmark created",
  decision_recorded: "Decision recorded",
  action_pack_saved: "Action pack saved",
  followup_recorded: "Follow-up recorded",
  impact_improved: "Impact improved",
  impact_regressed: "Impact regressed",
  impact_inconclusive: "Impact inconclusive",
  impact_unchanged: "Impact unchanged",
};

function impactTypeFor(verdict: string): ProjectTimelineEventType {
  switch (verdict) {
    case "improved":
      return "impact_improved";
    case "regressed":
      return "impact_regressed";
    case "unchanged":
      return "impact_unchanged";
    case "inconclusive":
    default:
      return "impact_inconclusive";
  }
}

function experimentHref(projectId: string, experimentId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/experiment?experiment=${encodeURIComponent(experimentId)}`;
}

function benchmarkHref(projectId: string, benchmarkId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/benchmark/${encodeURIComponent(benchmarkId)}`;
}

/** Pure builder. Tests call this with hand-built inputs; the route handler
 *  loads the inputs from D1 and reuses Stage 79's impact helper for impacts. */
export function buildProjectEvolutionTimeline(args: {
  projectId: string;
  experiments: TimelineExperimentInput[];
  benchmarks: TimelineBenchmarkInput[];
  actionPacks: TimelineActionPackInput[];
}): ProjectEvolutionTimeline {
  const { projectId, experiments, benchmarks, actionPacks } = args;
  const events: ProjectEvolutionTimelineEvent[] = [];

  for (const exp of experiments) {
    events.push({
      id: `experiment_created:${exp.id}`,
      type: "experiment_created",
      occurredAt: exp.createdAt,
      experimentId: exp.id,
      title: CANONICAL_TITLE.experiment_created,
      summary: exp.title,
      status: exp.status,
      href: experimentHref(projectId, exp.id),
    });
    if (exp.decidedAt && exp.decisionStatus) {
      events.push({
        id: `decision_recorded:${exp.id}`,
        type: "decision_recorded",
        occurredAt: exp.decidedAt,
        experimentId: exp.id,
        title: CANONICAL_TITLE.decision_recorded,
        summary: exp.title,
        status: exp.decisionStatus,
        href: experimentHref(projectId, exp.id),
      });
    }
  }

  for (const bench of benchmarks) {
    events.push({
      id: `benchmark_created:${bench.id}`,
      type: "benchmark_created",
      occurredAt: bench.createdAt,
      benchmarkId: bench.id,
      experimentId: bench.sourceExperimentId,
      title: CANONICAL_TITLE.benchmark_created,
      summary: bench.title ?? "",
      href: benchmarkHref(projectId, bench.id),
    });
  }

  for (const pack of actionPacks) {
    events.push({
      id: `action_pack_saved:${pack.id}`,
      type: "action_pack_saved",
      occurredAt: pack.createdAt,
      actionPackId: pack.id,
      experimentId: pack.experimentId,
      title: CANONICAL_TITLE.action_pack_saved,
      summary: pack.title,
      recommendedAction: pack.recommendedAction,
      href: experimentHref(projectId, pack.experimentId),
    });

    // Per Stage 82 spec recommendation: only surface follow-up + impact events
    // when a real follow-up exists (i.e., a recorded followedAt timestamp).
    if (pack.followup.followedAt) {
      events.push({
        id: `followup_recorded:${pack.id}`,
        type: "followup_recorded",
        occurredAt: pack.followup.followedAt,
        actionPackId: pack.id,
        experimentId: pack.experimentId,
        title: CANONICAL_TITLE.followup_recorded,
        summary: pack.title,
        status: pack.followup.status,
        recommendedAction: pack.recommendedAction,
        href: experimentHref(projectId, pack.experimentId),
      });

      if (pack.impact) {
        const type = impactTypeFor(pack.impact.verdict);
        events.push({
          id: `${type}:${pack.id}`,
          type,
          // Impact is derived from the follow-up; anchor the event to the
          // moment the follow-up was recorded so the verdict appears near
          // the loop that produced it.
          occurredAt: pack.followup.followedAt,
          actionPackId: pack.id,
          experimentId: pack.experimentId,
          title: CANONICAL_TITLE[type],
          summary: pack.title,
          verdict: pack.impact.verdict,
          recommendedAction: pack.recommendedAction,
          href: experimentHref(projectId, pack.experimentId),
        });
      }
    }
  }

  // Sort by occurredAt DESC; tie-break by event id for golden-test stability.
  events.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    return a.id.localeCompare(b.id);
  });

  const limitations: string[] = [];
  if (events.length > TIMELINE_EVENT_CAP) limitations.push("timeline_truncated");
  const capped = events.slice(0, TIMELINE_EVENT_CAP);

  return {
    projectId,
    eventCount: capped.length,
    events: capped,
    limitations,
  };
}

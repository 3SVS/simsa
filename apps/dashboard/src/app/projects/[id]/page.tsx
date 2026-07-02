"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getProject, getProjectStats } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import { StatCard } from "@/components/StatCard";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel, enumStatusLabel, enumActionLabel, enumLimitationLabel } from "@/i18n/dictionary.mjs";
import {
  getProjectEvolutionLearning,
  getProjectEvolutionTimeline,
  type ProjectEvolutionLearningSignals,
  type ProjectLearningSignal,
  type ProjectEvolutionTimeline,
  type ProjectEvolutionTimelineEvent,
} from "@/lib/workspace-experiment-api";
import {
  topSignalLabelKey,
  formatRatePercent,
  formatAverageDeltaPercent,
  formatAverageDeltaCount,
  learningHasNoData,
} from "@/lib/project-evolution-learning.mjs";
import {
  timelineEventLabelKey,
  timelineLimitationLabelKey,
  timelineHasNoEvents,
} from "@/lib/project-evolution-timeline.mjs";
import {
  listVisualChecks,
  type VisualCheckListItem,
} from "@/lib/workspace-visual-checks-api";
import { overviewNextAction, relativeTimeLabel, verdictLabel } from "@/lib/visual-check-view.mjs";
import type { VerdictTone } from "@/lib/visual-check-view.mjs";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

// Stage 272 — verdict/status chip tones on the overview inspection card
// (same brand tokens as the visual-checks pages; colors carry meaning only).
const VC_TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};
const VC_STATUS_SLATE_CLASS = "bg-slate-50 text-slate-600 border-slate-200";

export default function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  // Locally-created projects live in localStorage (client-only); mock demos are
  // bundled. Read on the client so real projects resolve.
  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;
  const stats = getProjectStats(project);
  const hasReviewActivity =
    stats.passed + stats.failed + stats.inconclusive + stats.needsDecision > 0;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{project.name}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">{project.description}</p>

      {/* Getting-started card for projects with no review activity yet — one
          obvious next path instead of seven empty analytics sections. */}
      {!hasReviewActivity && (
        <div className="card mb-8 p-5">
          <p className="text-sm font-semibold text-gray-900">{t.overview.gettingStartedTitle}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t.overview.gettingStartedIntro}</p>
          <ol className="mt-3 space-y-2 text-sm text-gray-700">
            <li className="flex gap-2">
              <span className="font-semibold text-brand-700">1.</span>
              <Link href={`/projects/${id}/spec`} className="hover:underline">{t.overview.gsStep1}</Link>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-brand-700">2.</span>
              <Link href={`/projects/${id}/settings`} className="hover:underline">{t.overview.gsStep2}</Link>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-brand-700">3.</span>
              <Link href={`/projects/${id}/github`} className="hover:underline">{t.overview.gsStep3}</Link>
            </li>
          </ol>
        </div>
      )}

      {/* Stage 183 — Plan Map ("Where are we?") read-only entry */}
      <Link
        href={`/projects/${id}/map`}
        className="card mb-8 flex items-center justify-between gap-3 p-4 transition-colors hover:bg-gray-50"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{t.planMap.title}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t.planMap.subtitle}</p>
        </div>
        <span className="flex-shrink-0 text-xs text-brand-700">{t.planMap.youAreHere} →</span>
      </Link>

      {/* Stage 272 — inspection status at a glance + the single next action */}
      <VisualChecksOverviewCard projectId={id} t={t} locale={locale} />

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title">{t.overview.specCompleteness}</h2>
          <Link href={`/projects/${id}/spec`} className="text-xs text-brand-700 hover:underline">
            {t.common.view} →
          </Link>
        </div>
        <div className="card p-5">
          <SpecCompleteness value={project.spec.completeness} />
          {project.spec.openDecisions.length > 0 && (
            <div className="mt-4 space-y-2">
              {project.spec.openDecisions.map((d, i) => (
                <div key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 text-slate-400">•</span>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title">{t.overview.resultsSummary}</h2>
          <Link href={`/projects/${id}/checks`} className="text-xs text-brand-700 hover:underline">
            {t.common.viewAll} →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={statusLabel(t, "passed")} value={stats.passed} colorClass="text-green-600" />
          <StatCard label={statusLabel(t, "failed")} value={stats.failed} colorClass="text-red-600" />
          <StatCard label={statusLabel(t, "inconclusive")} value={stats.inconclusive} colorClass="text-amber-600" />
          <StatCard label={statusLabel(t, "needs_decision")} value={stats.needsDecision} colorClass="text-slate-600" />
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title">{t.overview.mustHaves}</h2>
          <Link href={`/projects/${id}/items`} className="text-xs text-brand-700 hover:underline">
            {t.common.viewAll} →
          </Link>
        </div>
        <div className="card divide-y divide-gray-100">
          {project.requirements.slice(0, 4).map((req) => (
            <div key={req.id} className="flex items-center gap-3 px-5 py-3.5">
              <StatusDot status={req.status} />
              <span className="flex-1 text-sm text-gray-700">{req.title}</span>
            </div>
          ))}
          {project.requirements.length > 4 && (
            <div className="px-5 py-3 text-center font-mono text-xs text-gray-400">
              + {project.requirements.length - 4} {t.common.more}
            </div>
          )}
        </div>
      </section>

      {/* Stage 81/82: evolution analytics — only once there is review activity;
          they are meaningless (and intimidating) on a fresh project. */}
      {hasReviewActivity && (
        <>
          <section className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">{t.evolution.learningTitle}</h2>
            </div>
            <EvolutionLearningCard projectId={id} t={t} />
          </section>

          <section className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">{t.evolution.timelineTitle}</h2>
            </div>
            <EvolutionTimelineCard projectId={id} t={t} />
          </section>
        </>
      )}
    </div>
  );
}

// Stage 272 — the "시각 검수" overview card: latest run's verdict chip +
// relative date + the single next action (run first / view progress / open
// the report). Best-effort: the card stays hidden while loading, without a
// userKey, or when the run list cannot be fetched.
function VisualChecksOverviewCard({
  projectId,
  t,
  locale,
}: {
  projectId: string;
  t: Dictionary;
  locale: Locale;
}) {
  const [checks, setChecks] = useState<VisualCheckListItem[] | null>(null);
  const [userKey, setUserKey] = useState<string>("");

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    listVisualChecks(projectId, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setChecks(res.checks);
      } else if (res.error === "project_not_found") {
        // A project that only exists in this browser has no server-side runs
        // yet — show the "run your first inspection" state.
        setChecks([]);
      }
      // Any other failure keeps the card hidden (best-effort, never blocks).
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, userKey]);

  if (checks === null) return null;

  const action = overviewNextAction(checks);
  const run =
    action.kind === "runFirst" ? null : (checks.find((c) => c.id === action.runId) ?? null);

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title">{t.visualChecks.title}</h2>
        <Link
          href={`/projects/${projectId}/visual-checks`}
          className="text-xs text-brand-700 hover:underline"
        >
          {t.common.viewAll} →
        </Link>
      </div>
      <div className="card p-5">
        {run === null ? (
          <>
            <p className="text-sm leading-relaxed text-gray-600">
              {t.visualChecks.overview.emptyLead}
            </p>
            <Link
              href={`/projects/${projectId}/visual-checks`}
              className="btn btn-primary btn-sm mt-3"
            >
              {t.visualChecks.overview.runFirst}
            </Link>
          </>
        ) : (
          <>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              {t.visualChecks.overview.latestLabel}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <OverviewRunChip run={run} t={t} />
                <span className="truncate text-sm text-gray-700">{run.targetUrl}</span>
                <span className="flex-shrink-0 text-xs text-gray-400">
                  {relativeTimeLabel(run.createdAt, locale)}
                </span>
              </div>
              <Link
                href={`/projects/${projectId}/visual-checks/${run.id}`}
                className={`flex-shrink-0 ${
                  action.kind === "viewReport" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"
                }`}
              >
                {action.kind === "inProgress"
                  ? t.visualChecks.overview.inProgress
                  : t.visualChecks.overview.viewReport}
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Stage 272 — chip for the latest run: queued/running/failed statuses take
// priority; a done (or legacy) run shows its verdict chip.
function OverviewRunChip({ run, t }: { run: VisualCheckListItem; t: Dictionary }) {
  let chip: { label: string; cls: string };
  if (run.status === "queued") {
    chip = { label: t.visualChecks.statusQueued, cls: VC_STATUS_SLATE_CLASS };
  } else if (run.status === "running") {
    chip = { label: t.visualChecks.statusRunning, cls: VC_STATUS_SLATE_CLASS };
  } else if (run.status === "failed") {
    chip = { label: t.visualChecks.statusFailed, cls: VC_TONE_CLASS.failed };
  } else {
    const verdict = verdictLabel(run.works, run.decision, t);
    chip = { label: verdict.label, cls: VC_TONE_CLASS[verdict.tone] };
  }
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}
    >
      {chip.label}
    </span>
  );
}

function EvolutionLearningCard({ projectId, t }: { projectId: string; t: Dictionary }) {
  const [learning, setLearning] = useState<ProjectEvolutionLearningSignals | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [userKey, setUserKey] = useState<string>("");

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    setPhase("loading");
    getProjectEvolutionLearning(projectId, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLearning(res.learning);
        setPhase("ready");
      } else {
        setLearning(null);
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, userKey]);

  if (phase === "loading") {
    return <p className="card p-5 text-xs text-gray-400">{t.outcome.loading}</p>;
  }
  if (phase === "error") {
    return <p className="card p-5 text-xs text-red-600">{t.errors.loadFailed}</p>;
  }
  if (!learning) {
    return <p className="card p-5 text-xs text-gray-400">{t.evolution.learningEmpty}</p>;
  }

  return (
    <div className="card p-5">
      <p className="text-xs text-gray-500">{t.evolution.learningDesc}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-400">{t.evolution.learningExperiments}</dt>
          <dd className="font-semibold text-gray-800">{learning.experimentCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-400">{t.evolution.learningActionPacks}</dt>
          <dd className="font-semibold text-gray-800">{learning.actionPackCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-400">{t.evolution.learningFollowedPacks}</dt>
          <dd className="font-semibold text-gray-800">{learning.followedPackCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-400">{t.evolution.learningComparablePacks}</dt>
          <dd className="font-semibold text-gray-800">{learning.comparablePackCount}</dd>
        </div>
      </dl>

      {learningHasNoData(learning) ? (
        <p className="mt-3 text-xs text-gray-500">{t.evolution.learningEmpty}</p>
      ) : (
        <>
          {/* Verdict counts */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-400">{t.evolution.summaryImprovedPacks}</dt>
              <dd className="font-semibold text-emerald-700">{learning.verdictCounts.improved}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-400">{t.evolution.summaryRegressedPacks}</dt>
              <dd className="font-semibold text-red-700">{learning.verdictCounts.regressed}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-400">{t.evolution.summaryUnchangedPacks}</dt>
              <dd className="font-semibold text-gray-700">{learning.verdictCounts.unchanged}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-400">{t.evolution.summaryInconclusivePacks}</dt>
              <dd className="font-semibold text-amber-700">{learning.verdictCounts.inconclusive}</dd>
            </div>
          </div>

          {/* Average change */}
          <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">{t.evolution.learningAverageChange}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-4">
              <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactPassRate}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaPercent(learning.averageDelta.passRateDelta)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactCritical}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(learning.averageDelta.criticalIssueDelta)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactNotVerified}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(learning.averageDelta.notVerifiedDelta)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactBlockers}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(learning.averageDelta.blockerDelta)}</dd></div>
            </dl>
          </div>

          {/* Recommended action effectiveness table */}
          {learning.recommendedActionEffectiveness.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.learningEffectiveness}</p>
              <ul className="mt-1 space-y-1 text-xs">
                {learning.recommendedActionEffectiveness.map((r) => (
                  <li
                    key={r.recommendedAction}
                    className="grid grid-cols-3 items-center gap-2 rounded-md border border-gray-100 bg-white px-2 py-1"
                  >
                    <span className="text-[11px] text-gray-600">{enumActionLabel(t, r.recommendedAction)}</span>
                    <span className="text-[11px] text-gray-500">
                      {r.comparable}/{r.total} · <span className="text-emerald-700">↑{r.improved}</span> · <span className="text-red-700">↓{r.regressed}</span> · <span className="text-amber-700">?{r.inconclusive}</span>
                    </span>
                    <span className="text-right text-[11px] text-gray-500">
                      <span className="text-emerald-700">{t.evolution.learningImprovementRate} {formatRatePercent(r.improvementRate)}</span>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-red-700">{t.evolution.learningRegressionRate} {formatRatePercent(r.regressionRate)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Top signals — always shown so the empty state has a place to live */}
      <div className="mt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.learningTopSignals}</p>
        <ul className="mt-1 space-y-1 text-xs text-gray-700">
          {learning.topSignals.map((sig, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-100 bg-white px-2 py-1">
              <TopSignalText signal={sig} t={t} />
            </li>
          ))}
        </ul>
      </div>

      {learning.limitations.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.summaryLimitationsLabel}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {learning.limitations.map((l) => (
              <li
                key={l}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500"
              >
                {enumLimitationLabel(t, l)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">{t.evolution.learningDisclaimer}</p>
    </div>
  );
}

function TopSignalText({ signal, t }: { signal: ProjectLearningSignal; t: Dictionary }) {
  if (signal.type === "not_enough_data") {
    return <span className="text-gray-500">{t.evolution.signalNotEnoughData}</span>;
  }
  const labelKey = topSignalLabelKey(signal);
  const label = t.evolution[labelKey as keyof typeof t.evolution];
  if (signal.type === "action_often_improves") {
    return (
      <>
        <span className="font-semibold text-gray-700">{t.evolution.learningEarlySignal}</span>
        <span className="text-[11px] font-medium text-gray-700">{enumActionLabel(t, signal.recommendedAction)}</span>
        <span className="text-emerald-700">{label}</span>
        <span className="text-gray-400">
          ({signal.improved}/{signal.totalComparable})
        </span>
      </>
    );
  }
  // action_often_regresses
  return (
    <>
      <span className="font-semibold text-gray-700">{t.evolution.learningEarlySignal}</span>
      <span className="text-[11px] font-medium text-gray-700">{enumActionLabel(t, signal.recommendedAction)}</span>
      <span className="text-red-700">{label}</span>
      <span className="text-gray-400">
        ({signal.regressed}/{signal.totalComparable})
      </span>
    </>
  );
}

function EvolutionTimelineCard({ projectId, t }: { projectId: string; t: Dictionary }) {
  const [timeline, setTimeline] = useState<ProjectEvolutionTimeline | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [userKey, setUserKey] = useState<string>("");

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    setPhase("loading");
    getProjectEvolutionTimeline(projectId, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setTimeline(res.timeline);
        setPhase("ready");
      } else {
        setTimeline(null);
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, userKey]);

  if (phase === "loading") {
    return <p className="card p-5 text-xs text-gray-400">{t.outcome.loading}</p>;
  }
  if (phase === "error") {
    return <p className="card p-5 text-xs text-red-600">{t.errors.loadFailed}</p>;
  }
  if (!timeline) {
    return <p className="card p-5 text-xs text-gray-400">{t.evolution.timelineEmpty}</p>;
  }

  return (
    <div className="card p-5">
      <p className="text-xs text-gray-500">{t.evolution.timelineDesc}</p>

      {timelineHasNoEvents(timeline) ? (
        <p className="mt-3 text-xs text-gray-500">{t.evolution.timelineEmpty}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {timeline.events.map((ev) => (
            <TimelineEventRow key={ev.id} event={ev} t={t} />
          ))}
        </ol>
      )}

      {timeline.limitations.length > 0 && (
        <div className="mt-3">
          <ul className="flex flex-wrap gap-1.5">
            {timeline.limitations.map((l) => (
              <li
                key={l}
                className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              >
                {t.evolution[timelineLimitationLabelKey(l) as keyof typeof t.evolution] ?? l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TimelineEventRow({
  event,
  t,
}: {
  event: ProjectEvolutionTimelineEvent;
  t: Dictionary;
}) {
  const labelKey = timelineEventLabelKey(event.type);
  const label = t.evolution[labelKey as keyof typeof t.evolution];
  const chipClass = badgeClassForEventType(event.type);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${chipClass}`}>
            {label}
          </span>
          {event.status && (
            <span className="text-[10px] text-gray-500">{enumStatusLabel(t, event.status)}</span>
          )}
          {event.recommendedAction && (
            <span className="text-[10px] text-gray-500">{enumActionLabel(t, event.recommendedAction)}</span>
          )}
        </div>
        {event.summary && (
          <p className="mt-1 truncate text-xs text-gray-700">{event.summary}</p>
        )}
        <p className="mt-0.5 text-[10px] text-gray-400">
          {new Date(event.occurredAt).toLocaleString()}
        </p>
      </div>
      {event.href && (
        <Link
          href={event.href}
          className="rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t.evolution.timelineOpen}
        </Link>
      )}
    </li>
  );
}

function badgeClassForEventType(type: string): string {
  switch (type) {
    case "impact_improved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "impact_regressed":
      return "border-red-200 bg-red-50 text-red-700";
    case "impact_unchanged":
      return "border-gray-200 bg-gray-50 text-gray-700";
    case "impact_inconclusive":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "decision_recorded":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "benchmark_created":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "experiment_created":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "action_pack_saved":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "followup_recorded":
      return "border-teal-200 bg-teal-50 text-teal-700";
    default:
      return "border-gray-200 bg-white text-gray-500";
  }
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    passed: "bg-green-500",
    failed: "bg-red-500",
    inconclusive: "bg-amber-400",
    needs_decision: "bg-slate-500",
    not_started: "bg-gray-300",
    building: "bg-blue-400",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status] ?? "bg-gray-300"}`} />
  );
}

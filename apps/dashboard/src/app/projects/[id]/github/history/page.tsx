"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  listProjectReviewHistory,
  startPRReview,
  type ProjectReviewHistoryItem,
} from "@/lib/workspace-github-api";
import {
  buildRunDetailHref,
  buildFixPackHref,
} from "@/lib/rerun-selection.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const STATUS_CLASS: Record<string, string> = {
  passed: "text-green-700 bg-green-50 border-green-200",
  failed: "text-red-700 bg-red-50 border-red-200",
  inconclusive: "text-amber-700 bg-amber-50 border-amber-200",
  error: "text-gray-600 bg-gray-50 border-gray-200",
  running: "text-slate-700 bg-slate-50 border-slate-200",
  queued: "text-gray-500 bg-gray-50 border-gray-200",
};

function runStatusLabel(t: Dictionary, status: string): string {
  if (status === "passed" || status === "failed" || status === "inconclusive") return statusLabel(t, status);
  if (status === "error") return t.runStatus.error;
  if (status === "running") return t.runStatus.running;
  if (status === "queued") return t.runStatus.queued;
  return status;
}

function RunStatusBadge({ t, status }: { t: Dictionary; status: string }) {
  return (
    <span className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? STATUS_CLASS.queued}`}>
      {runStatusLabel(t, status)}
    </span>
  );
}

function formatDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function SummaryBar({ t, summary }: { t: Dictionary; summary: NonNullable<ProjectReviewHistoryItem["summary"]> }) {
  const total = summary.passed + summary.failed + summary.inconclusive + summary.needsDecision;
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      {summary.passed > 0 && <span className="font-medium text-green-600">{summary.passed} {statusLabel(t, "passed")}</span>}
      {summary.failed > 0 && <span className="font-medium text-red-600">{summary.failed} {statusLabel(t, "failed")}</span>}
      {summary.inconclusive > 0 && <span className="font-medium text-amber-600">{summary.inconclusive} {statusLabel(t, "inconclusive")}</span>}
      {summary.needsDecision > 0 && <span className="font-medium text-slate-600">{summary.needsDecision} {statusLabel(t, "needs_decision")}</span>}
    </div>
  );
}

// ─── Quick re-run (history-list direct action) ───────────────────────────────
// "남은 문제 다시 확인" — re-checks failed/inconclusive/needs_decision only.
// For editing which items run, the user goes to the detail page (Stage 40 picker).

function QuickRerun({
  t, projectId, prNumber, runId, rerunAction, userKey,
}: {
  t: Dictionary;
  projectId: string;
  prNumber: number;
  runId: string;
  rerunAction: ProjectReviewHistoryItem["rerunAction"];
  userKey: string;
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const [phase, setPhase] = useState<"idle" | "running" | "error">("idle");

  const enabled = (rerunAction?.recommendedItemCount ?? 0) > 0;

  const run = useCallback(async () => {
    const recommendedItemIds = rerunAction?.recommendedItemIds ?? [];
    if (recommendedItemIds.length === 0 || phase === "running") return;
    setPhase("running");
    // New idempotency key per click; held for this in-flight request only.
    const idempotencyKey = crypto.randomUUID();
    const res = await startPRReview(projectId, prNumber, {
      userKey,
      selectedItemIds: recommendedItemIds,
      rerunOfReviewRunId: runId,
      idempotencyKey,
      locale,
    });
    if (!res.ok) {
      setPhase("error");
      return;
    }
    // Auto-navigate to the new run detail, carrying the source run.
    router.push(buildRunDetailHref(projectId, res.run.id, runId));
  }, [rerunAction, phase, projectId, prNumber, runId, userKey, router]);

  const detailLink = (
    <Link href={`/projects/${projectId}/github/history/${runId}`} className="text-xs text-brand-600 hover:text-brand-800">
      {t.history.selectInDetail} →
    </Link>
  );

  if (phase === "running") {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <div className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
        {t.history.rerunning}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-600">{t.history.rerunError}</span>
        {detailLink}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={!enabled}
          className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors enabled:hover:border-brand-300 enabled:hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t.history.rerunRemaining}{enabled ? ` (${rerunAction?.recommendedItemCount})` : ""}
        </button>
        {detailLink}
      </div>
      {!enabled && (
        <p className="text-[11px] text-gray-500">
          {rerunAction?.disabledReason === "results_unavailable" ? t.history.rerunDisabledNoResults : t.history.rerunNoItems}
        </p>
      )}
    </div>
  );
}

// "남은 문제 Fix Pack" — navigates to the detail page with ?action=fix-pack,
// which auto-opens the FixPackPanel for failed/inconclusive/needs_decision items.
// No inline picker in the list; item editing happens on the detail page.
function QuickFixPackLink({
  t, projectId, runId, rerunAction,
}: {
  t: Dictionary;
  projectId: string;
  runId: string;
  rerunAction: ProjectReviewHistoryItem["rerunAction"];
}) {
  const count = rerunAction?.recommendedItemCount ?? 0;
  if (count === 0) {
    return (
      <span title={t.history.fixNoItems} className="cursor-not-allowed select-none rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-300">
        {t.history.fixRemaining}
      </span>
    );
  }
  return (
    <Link
      href={buildFixPackHref(projectId, runId)}
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
    >
      {t.history.fixRemaining} ({count})
    </Link>
  );
}

export default function ReviewHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
  const [runs, setRuns] = useState<ProjectReviewHistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      const res = await listProjectReviewHistory(id, userKey ?? "", { limit: 50 });
      if (cancelled) return;
      if (res.ok) {
        setRuns(res.runs);
        setPhase("done");
      } else {
        setPhase("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, userKey]);

  if (!project) return <ProjectNotFound />;

  // Group runs by PR number for display
  const byPr = new Map<number, ProjectReviewHistoryItem[]>();
  for (const run of runs) {
    const list = byPr.get(run.prNumber) ?? [];
    list.push(run);
    byPr.set(run.prNumber, list);
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.history.title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t.history.desc}</p>
        </div>
        <Link href={`/projects/${id}/github`} className="text-xs font-medium text-brand-700 hover:text-brand-800">
          ← {t.history.backToPr}
        </Link>
      </div>

      {/* Loading */}
      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.history.loading}
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <div className="callout callout-error flex items-center justify-between">
          <span>{t.history.loadError}</span>
          <button onClick={() => window.location.reload()} className="btn btn-sm btn-secondary">{t.common.retry}</button>
        </div>
      )}

      {/* Empty */}
      {phase === "done" && runs.length === 0 && (
        <div className="card p-10 text-center">
          <p className="mb-1 text-sm font-medium text-gray-600">{t.history.emptyTitle}</p>
          <p className="mb-4 text-xs text-gray-500">{t.history.emptyBody}</p>
          <Link href={`/projects/${id}/github`} className="btn btn-md btn-primary">
            {t.checks.connectPr} →
          </Link>
        </div>
      )}

      {/* Timeline — flat list, newest first */}
      {phase === "done" && runs.length > 0 && (
        <div className="space-y-2">
          {runs.map((run, idx) => (
            <div
              key={run.id}
              className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-start gap-3"
            >
              {/* Timeline dot */}
              <div className="flex flex-col items-center mt-1.5 flex-shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full border-2 ${
                  run.status === "passed" ? "bg-green-400 border-green-400" :
                  run.status === "failed" ? "bg-red-400 border-red-400" :
                  run.status === "inconclusive" ? "bg-yellow-400 border-yellow-400" :
                  run.status === "error" ? "bg-gray-300 border-gray-300" :
                  "bg-blue-400 border-blue-400"
                }`} />
                {idx < runs.length - 1 && (
                  <div className="w-px h-full bg-gray-100 mt-1" style={{ minHeight: 16 }} />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-gray-700 flex-shrink-0">
                      PR #{run.prNumber}
                    </span>
                    <span className="text-xs text-gray-500 truncate">{run.repoFullName}</span>
                  </div>
                  <RunStatusBadge t={t} status={run.status} />
                </div>

                {run.summary && <SummaryBar t={t} summary={run.summary} />}

                {run.status === "error" && run.errorMessage && (
                  <p className="mt-1 text-xs text-gray-500">{t.runStatus.error}: {run.errorMessage}</p>
                )}

                <div className="mt-1.5 flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-500">{formatDate(run.createdAt, locale)}</span>
                  <span className="text-xs text-gray-300">{run.selectedItemCount} {t.history.items}</span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {userKey ? (
                    <>
                      <QuickRerun t={t} projectId={id} prNumber={run.prNumber} runId={run.id} rerunAction={run.rerunAction} userKey={userKey} />
                      <QuickFixPackLink t={t} projectId={id} runId={run.id} rerunAction={run.rerunAction} />
                    </>
                  ) : (
                    <Link href={`/projects/${id}/github/history/${run.id}`} className="text-xs text-brand-600 hover:text-brand-800">
                      {t.history.openRunDetails} →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PR-grouped summary */}
      {phase === "done" && runs.length > 0 && byPr.size > 1 && (
        <section className="mt-6">
          <h3 className="mb-3 section-title">{t.history.runsPerPr}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...byPr.entries()].map(([prNum, prRuns]) => {
              const latest = prRuns[0];
              return (
                <div key={prNum} className="card px-3 py-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700">PR #{prNum}</span>
                    {latest && <RunStatusBadge t={t} status={latest.status} />}
                  </div>
                  <p className="text-xs text-gray-500">{prRuns.length} {t.history.totalRuns}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

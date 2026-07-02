"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import {
  getLocalProject,
  loadExtendedProjectData,
  saveExtendedProjectData,
  getUserKey,
} from "@/lib/workflow-store";
import {
  callCheckDraftApi,
  type CheckDraftResponse,
  type CheckResultItem,
} from "@/lib/workspace-check-api";
import {
  getLatestPRReview,
  fetchLinkedPulls,
  type ReviewRun,
  type LinkedPull,
} from "@/lib/workspace-github-api";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";
import type { ItemStatus } from "@/lib/labels";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";

export default function ChecksPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  // ── Spec check state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [results, setResults] = useState<CheckDraftResponse | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

  // ── PR code check state ───────────────────────────────────────────────────
  const [linkedPulls, setLinkedPulls] = useState<LinkedPull[]>([]);
  const [prReviews, setPrReviews] = useState<Record<number, ReviewRun>>({});
  const [prLoadPhase, setPrLoadPhase] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    const ext = loadExtendedProjectData(id);
    if (ext?.checkResults) {
      setResults(ext.checkResults);
      setPhase("done");
    }
  }, [id]);

  // Load linked PRs and their latest review runs
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPrLoadPhase("loading");
      const linkedRes = await fetchLinkedPulls(id);
      if (cancelled) return;
      if (!linkedRes.ok) { setPrLoadPhase("done"); return; }
      setLinkedPulls(linkedRes.pulls);
      const reviews: Record<number, ReviewRun> = {};
      await Promise.all(
        linkedRes.pulls.map(async (lp) => {
          const r = await getLatestPRReview(id, lp.number);
          if (!cancelled && r.ok && r.run) reviews[lp.number] = r.run;
        }),
      );
      if (!cancelled) {
        setPrReviews(reviews);
        setPrLoadPhase("done");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const runCheck = useCallback(async () => {
    if (!project) return;
    setPhase("loading");
    setRateLimitMsg(null);

    const ext = loadExtendedProjectData(id);
    const productSpec = ext?.productSpec ?? {
      productName: project.name,
      oneLine: project.description,
      targetUsers: [] as string[],
      problem: project.spec.goal,
      included: project.spec.included,
      excluded: project.spec.excluded,
      userFlow: [] as string[],
      decisions: [] as string[],
      openQuestions: project.spec.openDecisions,
    };
    const items = project.requirements.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      criteria: ext?.itemCriteria?.[r.id] ?? [],
    }));

    const res = await callCheckDraftApi({ projectId: id, productSpec, items });
    if (!res.ok) {
      if (res.error === "rate_limited") {
        setRateLimitMsg(t.common.rateLimited);
        setPhase(results ? "done" : "idle");
      } else {
        setPhase("error");
      }
      return;
    }
    setResults(res);
    setPhase("done");
    saveExtendedProjectData(id, { checkResults: res });
  }, [id, project, results, t]);

  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  const needsAction = results
    ? results.summary.failed + results.summary.inconclusive + results.summary.needsDecision
    : 0;

  // Latest PR review with actual results
  const latestPrReview = Object.values(prReviews).find((r) => r.results?.length);
  const prNeedsAction = latestPrReview?.summary
    ? (latestPrReview.summary.failed ?? 0) + (latestPrReview.summary.inconclusive ?? 0)
    : 0;

  // Find the linked PR for the latest review
  const reviewedPR = latestPrReview
    ? linkedPulls.find((lp) => lp.number === latestPrReview.prNumber)
    : undefined;

  return (
    <div className="max-w-3xl space-y-10">

      {/* ─── Section 1: Draft review ─── */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.checks.draftTitle}</h2>
            <p className="mt-0.5 text-xs text-gray-400">{t.checks.draftDesc}</p>
          </div>
          {phase === "done" && (
            <button onClick={runCheck} className="flex-shrink-0 text-xs font-medium text-brand-700 hover:text-brand-800">
              {t.checks.reRun}
            </button>
          )}
        </div>

        {phase === "loading" && (
          <div className="my-4 flex items-center gap-2.5 text-sm text-gray-400">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
            {t.checks.checking}
          </div>
        )}

        {rateLimitMsg && <div className="callout mb-4 border-amber-200 bg-amber-50 text-amber-800">{rateLimitMsg}</div>}
        {phase === "error" && (
          <div className="callout callout-error mb-4 flex items-center justify-between">
            <span>{t.checks.errorMsg}</span>
            <button onClick={runCheck} className="ml-4 text-xs text-red-600 underline">{t.common.retry}</button>
          </div>
        )}

        {results && (
          <>
            <p className="my-4 text-sm text-gray-500">
              {results.results.length} {t.checks.itemsChecked}
              {results.source === "mock-fallback" && (
                <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-600">{t.checks.draftTag}</span>
              )}
            </p>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label={statusLabel(t, "passed")} value={results.summary.passed} colorClass="text-green-600" />
              <StatCard label={statusLabel(t, "failed")} value={results.summary.failed} colorClass="text-red-600" />
              <StatCard label={statusLabel(t, "inconclusive")} value={results.summary.inconclusive} colorClass="text-amber-600" />
              <StatCard label={statusLabel(t, "needs_decision")} value={results.summary.needsDecision} colorClass="text-slate-600" />
            </div>
          </>
        )}

        {phase === "idle" && !results && (
          <div className="card p-8 text-center">
            <p className="mb-1 text-sm font-medium text-gray-700">{t.checks.emptyTitle}</p>
            <p className="mb-5 text-xs text-gray-400">{t.checks.emptyDesc}</p>
            <button onClick={runCheck} className="btn btn-md btn-primary">{t.checks.runCheck}</button>
          </div>
        )}

        {results && (
          <div className="space-y-3">
            {results.results.map((r) => (
              <CheckResultCard key={r.itemId} t={t} result={r} />
            ))}
          </div>
        )}

        {results && needsAction > 0 && (
          <div className="mt-5 flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-5 py-4">
            <p className="text-sm text-brand-800">{needsAction} {t.checks.needsAction}</p>
            <Link href={`/projects/${id}/fixes`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
              {t.checks.viewRemaining} →
            </Link>
          </div>
        )}
        {results && needsAction === 0 && (
          <div className="mt-5 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-5 py-4">
            <p className="text-sm font-medium text-green-700">{t.fixesScreen.allPassed}</p>
            <Link href={`/projects/${id}/export`} className="text-sm font-medium text-green-700 hover:text-green-900">
              {t.items.ctaButton} →
            </Link>
          </div>
        )}
      </section>

      {/* ─── Section 2: Pull request review ─── */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.checks.prTitle}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{t.checks.prDesc}</p>
        </div>

        {prLoadPhase === "loading" && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
            {t.checks.prLoading}
          </div>
        )}

        {prLoadPhase === "done" && !latestPrReview && (
          <div className="card p-8 text-center">
            <p className="mb-1 text-sm text-gray-600">{t.checks.noPrReview}</p>
            <p className="mb-4 text-xs text-gray-400">{t.checks.noPrReviewDesc}</p>
            <Link href={`/projects/${id}/github`} className="btn btn-md btn-primary">
              {t.checks.connectPr} →
            </Link>
          </div>
        )}

        {prLoadPhase === "done" && latestPrReview && (
          <div className="space-y-4">
            {/* PR info */}
            <div className="card p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex-1">
                  <p className="mb-0.5 text-xs text-gray-400">{t.checks.reviewedPr}</p>
                  <p className="text-sm font-medium text-gray-800">
                    {reviewedPR ? `#${reviewedPR.number} ${reviewedPR.title}` : `PR #${latestPrReview.prNumber}`}
                  </p>
                  {latestPrReview.repoFullName && (
                    <p className="mt-0.5 font-mono text-xs text-gray-400">{latestPrReview.repoFullName}</p>
                  )}
                </div>
                <PRReviewStatusBadge t={t} status={latestPrReview.status} />
              </div>

              {latestPrReview.summary && (
                <div className="mb-3 grid grid-cols-4 gap-2">
                  <StatCard label={statusLabel(t, "passed")} value={latestPrReview.summary.passed} colorClass="text-green-600" />
                  <StatCard label={statusLabel(t, "failed")} value={latestPrReview.summary.failed} colorClass="text-red-600" />
                  <StatCard label={statusLabel(t, "inconclusive")} value={latestPrReview.summary.inconclusive} colorClass="text-amber-600" />
                  <StatCard label={statusLabel(t, "needs_decision")} value={latestPrReview.summary.needsDecision ?? 0} colorClass="text-slate-600" />
                </div>
              )}

              <p className="text-xs text-gray-400">{t.review.basisNote}</p>
              <p className="text-xs text-gray-400">{t.review.verifyLiveNote}</p>
            </div>

            {/* Per-item results (compact) */}
            {latestPrReview.results && latestPrReview.results.length > 0 && (
              <div className="space-y-2">
                {latestPrReview.results.map((r) => (
                  <div key={r.itemId} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-4 py-3">
                    <span className="mt-0.5"><StatusBadge status={r.status as ItemStatus} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800">{r.title}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{r.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            <div className="flex flex-wrap items-center gap-3">
              {prNeedsAction > 0 && (
                <Link href={`/projects/${id}/github`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                  {t.github.createFixInstructions} →
                </Link>
              )}
              <Link href={`/projects/${id}/github`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                {t.checks.viewComparison} →
              </Link>
              <Link href={`/projects/${id}/github`} className="text-sm text-gray-400 hover:text-gray-600">
                {t.checks.toGithub} →
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CheckResultCard({ t, result }: { t: Dictionary; result: CheckResultItem }) {
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-800">{result.title}</p>
        <StatusBadge status={result.status as ItemStatus} />
      </div>
      <p className="mb-2 text-xs leading-relaxed text-gray-600">{result.reason}</p>
      {result.evidence.length > 0 && (
        <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-gray-500">{t.items.evidence}</p>
          <ul className="space-y-0.5">
            {result.evidence.map((e, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-gray-500">
                <span className="mt-px text-gray-300">-</span> {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.status !== "passed" && result.nextAction && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
          <span className="font-medium">{t.checks.nextStep}:</span> {result.nextAction}
        </p>
      )}
    </div>
  );
}

function PRReviewStatusBadge({ t, status }: { t: Dictionary; status: string }) {
  const className: Record<string, string> = {
    passed: "text-green-700 bg-green-50 border-green-200",
    failed: "text-red-700 bg-red-50 border-red-200",
    inconclusive: "text-amber-700 bg-amber-50 border-amber-200",
    error: "text-gray-600 bg-gray-50 border-gray-200",
    running: "text-slate-700 bg-slate-50 border-slate-200",
    queued: "text-gray-600 bg-gray-50 border-gray-200",
  };
  const labelMap: Record<string, string> = {
    passed: statusLabel(t, "passed"),
    failed: statusLabel(t, "failed"),
    inconclusive: statusLabel(t, "inconclusive"),
    error: t.runStatus.error,
    running: t.runStatus.running,
    queued: t.runStatus.queued,
  };
  return (
    <span className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className[status] ?? className.queued}`}>
      {labelMap[status] ?? status}
    </span>
  );
}

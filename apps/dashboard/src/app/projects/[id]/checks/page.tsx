"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

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
import {
  buildReviewVerdict,
  severityChipClass,
  severityCode,
  isActionableStatus,
} from "@/lib/review-severity.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";
import { LoginSavePrompt } from "@/components/LoginSavePrompt";

export default function ChecksPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  // ── Spec check state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [results, setResults] = useState<CheckDraftResponse | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  // Collapsible findings: actionable (non-passed) cards default open; passed
  // cards collapse so the report doesn't become a wall of green.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

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

  // Seed the open set whenever results change: actionable findings expanded.
  useEffect(() => {
    if (!results) return;
    setOpenIds(new Set(results.results.filter((r) => isActionableStatus(r.status)).map((r) => r.itemId)));
  }, [results]);

  const toggleOpen = useCallback((itemId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // Load linked PRs and their latest review runs
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPrLoadPhase("loading");
      const linkedRes = await fetchLinkedPulls(id, getUserKey());
      if (cancelled) return;
      if (!linkedRes.ok) { setPrLoadPhase("done"); return; }
      setLinkedPulls(linkedRes.pulls);
      const reviews: Record<number, ReviewRun> = {};
      await Promise.all(
        linkedRes.pulls.map(async (lp) => {
          const r = await getLatestPRReview(id, lp.number, getUserKey());
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

    const res = await callCheckDraftApi({ projectId: id, userKey: getUserKey(), productSpec, items });
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

  if (!project) return <ProjectNotFound />;

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
      <div>
        <h1 className="page-title">{t.nav.checks}</h1>
        <p className="page-subtitle">{t.checks.pageSubtitle}</p>
      </div>

      {/* ─── Section 1: Draft review ─── */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.checks.draftTitle}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t.checks.draftDesc}</p>
          </div>
          {phase === "done" && (
            <button onClick={runCheck} className="btn btn-sm btn-secondary flex-shrink-0">
              {t.checks.reRun}
            </button>
          )}
        </div>

        {/* In-progress: Vercel deploy-dot pattern — a pulsing ● + a live counter,
            so system status is visible rather than a bare spinner (Nielsen H1). */}
        {phase === "loading" && (
          <div className="my-4 flex items-center gap-2.5 text-sm text-gray-600">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-600" />
            </span>
            <span>
              {t.checks.checking}
              {project.requirements.length > 0 && (
                <span className="ml-1 text-gray-400">
                  ({project.requirements.length} {t.checks.itemsChecked})
                </span>
              )}
            </span>
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
            {/* Verdict banner — triple-encoded (icon + colour + text) so it stays
                colourblind-safe (CodeRabbit/Graphite grammar). */}
            <VerdictBanner
              t={t}
              summary={results.summary}
              isDraft={results.source === "mock-fallback"}
            />
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label={statusLabel(t, "passed")} value={results.summary.passed} colorClass="text-green-600" />
              <StatCard label={statusLabel(t, "failed")} value={results.summary.failed} colorClass="text-red-600" />
              <StatCard label={statusLabel(t, "inconclusive")} value={results.summary.inconclusive} colorClass="text-amber-600" />
              <StatCard label={statusLabel(t, "needs_decision")} value={results.summary.needsDecision} colorClass="text-slate-600" />
            </div>
          </>
        )}

        {/* Next action — right under the verdict so "so what do I do" is
            visible in the 3-second glance, not below every detail card. */}
        {results && needsAction > 0 && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-5 py-4">
            <p className="text-sm text-brand-800">{needsAction} {t.checks.needsAction}</p>
            <Link href={`/projects/${id}/fixes`} className="btn btn-md btn-primary">
              {t.checks.viewRemaining} →
            </Link>
          </div>
        )}
        {results && needsAction === 0 && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-5 py-4">
            <p className="text-sm font-medium text-green-700">{t.fixesScreen.allPassed}</p>
            <Link href={`/projects/${id}/export`} className="btn btn-md btn-secondary">
              {t.items.ctaButton} →
            </Link>
          </div>
        )}

        {phase === "idle" && !results && (
          <div className="card p-8 text-center">
            <p className="mb-1 text-sm font-medium text-gray-700">{t.checks.emptyTitle}</p>
            <p className="mb-5 text-xs text-gray-500">{t.checks.emptyDesc}</p>
            <button onClick={runCheck} className="btn btn-md btn-primary">{t.checks.runCheck}</button>
          </div>
        )}

        {results && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t.checks.itemDetails}</p>
              {results.results.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setOpenIds((prev) =>
                      prev.size === results.results.length
                        ? new Set()
                        : new Set(results.results.map((r) => r.itemId)),
                    )
                  }
                  className="text-xs font-medium text-gray-500 hover:text-gray-800"
                >
                  {openIds.size === results.results.length ? t.interaction.collapseAll : t.interaction.expandAll}
                </button>
              )}
            </div>
            {results.results.map((r) => (
              <CheckResultCard
                key={r.itemId}
                t={t}
                result={r}
                open={openIds.has(r.itemId)}
                onToggle={() => toggleOpen(r.itemId)}
              />
            ))}
          </div>
        )}

      </section>

      {/* ─── Section 2: Pull request review ─── */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.checks.prTitle}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t.checks.prDesc}</p>
        </div>

        {prLoadPhase === "loading" && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
            {t.checks.prLoading}
          </div>
        )}

        {prLoadPhase === "done" && !latestPrReview && (
          <div className="card p-8 text-center">
            <p className="mb-1 text-sm text-gray-600">{t.checks.noPrReview}</p>
            <p className="mb-4 text-xs text-gray-500">{t.checks.noPrReviewDesc}</p>
            <Link href={`/projects/${id}/github`} className="btn btn-md btn-primary">
              {t.checks.connectPr} →
            </Link>
          </div>
        )}

        {prLoadPhase === "done" && latestPrReview && (
          <div className="space-y-4">
            {/* Value-moment login promotion: results exist → offer to save them
                to an account (anonymous userKey is browser-bound otherwise). */}
            <LoginSavePrompt hasResult={true} />
            {/* PR info */}
            <div className="card p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex-1">
                  <p className="mb-0.5 text-xs text-gray-500">{t.checks.reviewedPr}</p>
                  <p className="text-sm font-medium text-gray-800">
                    {reviewedPR ? `#${reviewedPR.number} ${reviewedPR.title}` : `PR #${latestPrReview.prNumber}`}
                  </p>
                  {latestPrReview.repoFullName && (
                    <p className="mt-0.5 font-mono text-xs text-gray-500">{latestPrReview.repoFullName}</p>
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

              <p className="text-xs text-gray-500">{t.review.basisNote}</p>
              <p className="text-xs text-gray-500">{t.review.verifyLiveNote}</p>
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
                <Link href={`/projects/${id}/github`} className="btn btn-md btn-primary">
                  {t.github.createFixInstructions} →
                </Link>
              )}
              <Link href={`/projects/${id}/github`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                {t.checks.viewComparison} →
              </Link>
              <Link href={`/projects/${id}/github`} className="text-sm text-gray-500 hover:text-gray-600">
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

/** Tinted severity chip (P0/P1/P2) — never a solid fill. */
function SeverityChip({ status }: { status: string }) {
  const code = severityCode(status);
  if (!code) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${severityChipClass(status)}`}>
      {code}
    </span>
  );
}

/**
 * Collapsible finding card. Collapsed row = severity chip + one-line title +
 * status. Expanded = reason (what/why) + evidence + next step (how).
 */
function CheckResultCard({
  t,
  result,
  open,
  onToggle,
}: {
  t: Dictionary;
  result: CheckResultItem;
  open: boolean;
  onToggle: () => void;
}) {
  const passed = result.status === "passed";
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="row-hover flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {passed ? (
          <span className="inline-flex flex-shrink-0 items-center rounded-md border border-green-200 bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" aria-hidden>
            ✓
          </span>
        ) : (
          <SeverityChip status={result.status} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{result.title}</span>
        <StatusBadge status={result.status as ItemStatus} />
        <span className={`flex-shrink-0 text-xs text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
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
      )}
    </div>
  );
}

/** Pass/fail verdict banner. Triple-encoded: glyph + colour + text + count. */
function VerdictBanner({
  t,
  summary,
  isDraft,
}: {
  t: Dictionary;
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  isDraft: boolean;
}) {
  const verdict = buildReviewVerdict(summary);
  const pass = verdict.tone === "pass";
  const tone = pass
    ? "border-green-200 bg-green-50 text-green-800"
    : "border-red-200 bg-red-50 text-red-800";
  const dot = pass ? "bg-green-500" : "bg-red-500";
  return (
    <div className={`my-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${tone}`}>
      <span className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-sm font-bold text-white ${dot}`} aria-hidden>
        {pass ? "✓" : "!"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {pass ? t.interaction.verdictPassTitle : t.interaction.verdictFailTitle}
        </p>
        <p className="text-xs opacity-80">
          {verdict.passed} / {verdict.total} {t.interaction.verdictPassed}
        </p>
      </div>
      {isDraft && (
        <span className="flex-shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
          {t.checks.draftTag}
        </span>
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

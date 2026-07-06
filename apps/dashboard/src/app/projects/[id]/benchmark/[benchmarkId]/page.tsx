"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState, useEffect, Fragment } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import { getSavedBenchmark, type SavedBenchmark } from "@/lib/workspace-benchmark-api";
import { postPRComment } from "@/lib/workspace-github-api";
import { buildBenchmarkSummaryText } from "@/lib/agent-benchmark.mjs";
import {
  resolveBenchmarkPrTarget,
  buildBenchmarkPrCommentMarkdown,
} from "@/lib/agent-benchmark-comment.mjs";
import { buildBenchmarkMatrix, filterMatrixRows } from "@/lib/agent-benchmark-matrix.mjs";
import type { BenchmarkMatrix } from "@/lib/agent-benchmark-matrix.mjs";
import type {
  AgentCandidate,
  CandidateMode,
  CandidateSource,
  AgentCandidateMetrics,
  BenchmarkRationaleItem,
} from "@/lib/agent-benchmark.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

function modeLabel(t: Dictionary, mode: CandidateMode): string {
  if (mode === "single_agent") return t.benchmark.modeSingle;
  if (mode === "multi_agent") return t.benchmark.modeMulti;
  if (mode === "reviewer_agent") return t.benchmark.modeReviewer;
  return t.benchmark.modeHybrid;
}

function sourceLabel(t: Dictionary, source: CandidateSource): string {
  if (source === "claude_code") return t.benchmark.sourceClaude;
  if (source === "codex") return t.benchmark.sourceCodex;
  if (source === "cursor") return t.benchmark.sourceCursor;
  if (source === "manual") return t.benchmark.sourceManual;
  return t.benchmark.sourceOther;
}

function rationaleText(t: Dictionary, item: BenchmarkRationaleItem): string {
  switch (item.code) {
    case "pass_comparison":
      return t.benchmark.rationalePassComparison
        .replace("{winner}", item.winnerLabel)
        .replace("{winnerPassed}", String(item.winnerPassed))
        .replace("{winnerTotal}", String(item.winnerTotal))
        .replace("{runner}", item.runnerLabel)
        .replace("{runnerPassed}", String(item.runnerPassed))
        .replace("{runnerTotal}", String(item.runnerTotal));
    case "fewer_critical":
      return t.benchmark.rationaleFewerCritical
        .replace("{winner}", item.winnerLabel)
        .replace("{runner}", item.runnerLabel);
    case "runner_not_verified":
      return t.benchmark.rationaleRunnerNotVerified
        .replace("{runner}", item.runnerLabel)
        .replace("{count}", String(item.count));
    default:
      return "";
  }
}

function formatDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const ITEM_BADGE: Record<string, string> = {
  failed: "border-red-200 bg-red-50 text-red-700",
  needs_decision: "border-slate-200 bg-slate-50 text-slate-700",
  inconclusive: "border-yellow-200 bg-yellow-50 text-yellow-700",
};

const MATRIX_BADGE: Record<string, string> = {
  passed: "border-green-200 bg-green-50 text-green-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  needs_decision: "border-slate-200 bg-slate-50 text-slate-700",
  inconclusive: "border-yellow-200 bg-yellow-50 text-yellow-700",
  missing: "border-gray-200 bg-gray-50 text-gray-500",
};

function matrixStatusLabel(t: Dictionary, status: string): string {
  return status === "missing" ? t.benchmark.missingResult : statusLabel(t, status);
}

export default function BenchmarkDetailPage() {
  const { id, benchmarkId } = useParams<{ id: string; benchmarkId: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "not_found" | "error">("loading");
  const [data, setData] = useState<SavedBenchmark | null>(null);
  const [copied, setCopied] = useState(false);
  // Stage 67: PR comment share
  const [previewMd, setPreviewMd] = useState<string | null>(null);
  const [postPhase, setPostPhase] = useState<"idle" | "posting" | "posted" | "error">("idle");
  const [postedUrl, setPostedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      const res = await getSavedBenchmark(id, benchmarkId, userKey ?? "");
      if (cancelled) return;
      if (res.ok) {
        setData(res.benchmark);
        setPhase("done");
      } else if (res.error === "not_found") {
        setPhase("not_found");
      } else {
        setPhase("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, benchmarkId, userKey]);

  if (!project) return <ProjectNotFound />;

  const backUrl = `/projects/${id}/benchmark`;

  if (phase === "loading") {
    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.benchmark.detailLoading}
        </div>
      </div>
    );
  }
  if (phase === "not_found" || phase === "error" || !data) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={backUrl} className="text-xs text-gray-500 hover:text-brand-600">{t.benchmark.detailBack}</Link>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          {phase === "not_found" ? t.benchmark.notFoundDetail : t.benchmark.loadErrorDetail}
        </div>
      </div>
    );
  }

  const savedTitle = data.title;
  const result = data.result;
  const candidates = result.candidates ?? [];
  const metricsBy = result.metricsByCandidate ?? {};
  const ranked = candidates
    .map((c) => ({ candidate: c, metrics: metricsBy[c.id] }))
    .filter((r): r is { candidate: AgentCandidate; metrics: AgentCandidateMetrics } => Boolean(r.metrics))
    .sort((a, b) => b.metrics.score - a.metrics.score);
  const winnerId = result.recommendation?.winnerCandidateId;
  const winner = candidates.find((c) => c.id === winnerId);
  const alignment = result.acceptanceSetAlignment;
  const winnerBlocker = result.recommendation?.blockers.find((b) => b.candidateId === winnerId);
  // Stage 68: item-level blockers (undefined for older benchmarks → count-based fallback).
  const itemBlockers = result.remainingBlockers;
  const candidateLabelById = (cid: string) => candidates.find((c) => c.id === cid)?.label ?? cid;
  // Stage 69: candidate × acceptance-item matrix (null for older benchmarks).
  const matrix = result.itemOutcomesByCandidate
    ? buildBenchmarkMatrix({ candidates, itemOutcomesByCandidate: result.itemOutcomesByCandidate })
    : null;
  // Stage 70: compact matrix insight lines for copy summary / PR comment.
  const matrixInsightLines = matrix
    ? [
        t.benchmark.matrixItemsCompared.replace("{n}", String(matrix.itemsCompared)),
        matrix.disagreementCount > 0
          ? t.benchmark.matrixInsightDiffered.replace("{n}", String(matrix.disagreementCount))
          : t.benchmark.matrixInsightNoDiff,
      ]
    : [];

  const rationaleLines = (result.recommendation?.rationale ?? [])
    .filter((r) => r.code !== "no_clear_winner")
    .map((r) => rationaleText(t, r));

  // ── Deterministic copy summary (UI language) ──
  function handleCopy() {
    const candidateLines = ranked.map(({ candidate, metrics }) =>
      t.benchmark.summaryCandidateLine
        .replace("{label}", candidate.label)
        .replace("{passed}", String(metrics.passed))
        .replace("{total}", String(metrics.totalItems))
        .replace("{critical}", String(metrics.criticalIssueCount))
        .replace("{notVerified}", String(metrics.notVerifiedCount))
        .replace("{score}", String(metrics.score)),
    );
    const blockerLines = itemBlockers !== undefined
      ? itemBlockers.map((b) => `${statusLabel(t, b.status)}: ${b.title}`)
      : winnerId
        ? winnerBlocker
          ? [
              `${winner?.label ?? winnerId}: ${winnerBlocker.failed} ${statusLabel(t, "failed")} · ${winnerBlocker.needsDecision} ${statusLabel(t, "needs_decision")} · ${winnerBlocker.inconclusive} ${statusLabel(t, "inconclusive")}`,
            ]
          : []
        : (result.recommendation?.blockers ?? []).map(
            (b) => `${b.candidateLabel}: ${b.failed} ${statusLabel(t, "failed")} · ${b.needsDecision} ${statusLabel(t, "needs_decision")} · ${b.inconclusive} ${statusLabel(t, "inconclusive")}`,
          );

    const text = buildBenchmarkSummaryText({
      heading: t.benchmark.summaryHeading,
      projectLine: `${t.benchmark.summaryProject}: ${id}`,
      benchmarkLine: `${t.benchmark.summaryBenchmark}: ${savedTitle || "—"}`,
      recommendationLine: `${t.benchmark.summaryRecommendation}: ${winner ? winner.label : t.benchmark.noClearWinner}`,
      candidatesHeading: t.benchmark.summaryCandidates,
      candidateLines,
      whyHeading: t.benchmark.why,
      whyLines: rationaleLines,
      blockersHeading: t.benchmark.blockersTitle,
      blockerLines,
      noBlockersLine: t.benchmark.noRemainingBlockers,
      matrixHeading: t.benchmark.matrixTitle,
      matrixLines: matrixInsightLines,
    });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  // ── PR comment share (Stage 67) ──
  const prTarget = resolveBenchmarkPrTarget(candidates);

  function buildCommentMarkdown(): string {
    const rows = ranked.map(({ candidate, metrics }) => ({
      label: candidate.label,
      mode: modeLabel(t, candidate.mode),
      passed: metrics.passed,
      total: metrics.totalItems,
      critical: metrics.criticalIssueCount,
      notVerified: metrics.notVerifiedCount,
      score: metrics.score,
    }));
    const blockerLines: Array<string | { text: string; evidence?: string }> = itemBlockers !== undefined
      ? itemBlockers.map((b) => ({
          text: `**${statusLabel(t, b.status)}:** ${b.title}`,
          ...(b.evidence ? { evidence: `${t.benchmark.evidence}: ${b.evidence}` } : {}),
        }))
      : winnerBlocker
        ? [
            winnerBlocker.failed > 0 ? `${statusLabel(t, "failed")}: ${winnerBlocker.failed}` : null,
            winnerBlocker.needsDecision > 0 ? `${statusLabel(t, "needs_decision")}: ${winnerBlocker.needsDecision}` : null,
            winnerBlocker.inconclusive > 0 ? `${statusLabel(t, "inconclusive")}: ${winnerBlocker.inconclusive}` : null,
          ].filter((l): l is string => l !== null)
        : [];
    return buildBenchmarkPrCommentMarkdown({
      heading: t.benchmark.summaryHeading,
      intro: t.benchmark.prIntro,
      alignmentWarning: alignment && !alignment.aligned ? t.benchmark.acceptanceSetWarning : null,
      recommendationLabel: t.benchmark.summaryRecommendation,
      recommendationValue: winner ? winner.label : t.benchmark.noClearWinner,
      noClearWinnerBody: winner ? null : t.benchmark.noClearWinnerBody,
      columns: {
        candidate: t.benchmark.colCandidate,
        mode: t.benchmark.colMode,
        passed: t.benchmark.colPassed,
        critical: t.benchmark.colCritical,
        notVerified: t.benchmark.colNotVerified,
        score: t.benchmark.colScore,
      },
      rows,
      whyHeading: t.benchmark.why,
      whyLines: rationaleLines,
      blockersHeading: t.benchmark.blockersTitle,
      blockerLines,
      noBlockersLine: t.benchmark.noRemainingBlockers,
      matrixHeading: t.benchmark.matrixTitle,
      matrixLines: matrixInsightLines,
      noteHeading: t.benchmark.prNoteHeading,
      noteText: t.benchmark.intro,
    });
  }

  function handlePreviewComment() {
    setPreviewMd(buildCommentMarkdown());
    setPostPhase("idle");
    setPostedUrl(null);
  }

  async function handlePostComment() {
    if (!userKey || !previewMd || !prTarget.canPost) return;
    setPostPhase("posting");
    const reviewRunId = ranked[0]?.candidate.reviewRunId ?? candidates[0]?.reviewRunId;
    const res = await postPRComment(id, prTarget.prNumber, { userKey, body: previewMd, reviewRunId });
    if (res.ok) {
      setPostedUrl((res as { comment?: { githubCommentUrl?: string } }).comment?.githubCommentUrl ?? null);
      setPostPhase("posted");
    } else {
      setPostPhase("error");
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <Link href={backUrl} className="text-xs text-gray-500 hover:text-brand-600">{t.benchmark.detailBack}</Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.benchmark.detailTitle}</h2>
            <p className="mt-0.5 text-sm text-gray-500">{t.benchmark.detailSubtitle}</p>
          </div>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {copied ? t.benchmark.copied : t.benchmark.copySummary}
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
        {data.title && <span className="font-medium text-gray-700">{data.title}</span>}
        <span>{t.benchmark.createdLabel}: {formatDate(data.createdAt, locale)}</span>
        <span>{t.benchmark.detailCandidates}: {data.candidateCount}</span>
        {data.sourceExperimentId && (
          <Link href={`/projects/${id}/experiment?experiment=${encodeURIComponent(data.sourceExperimentId)}`} className="text-brand-600 hover:underline">
            {t.benchmark.sourceExperiment}: {t.benchmark.openExperiment}
          </Link>
        )}
      </div>

      {/* Acceptance set alignment */}
      {alignment && (
        alignment.aligned ? (
          <p className="text-xs text-gray-500">{t.benchmark.sameAcceptanceSet}</p>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            {t.benchmark.acceptanceSetWarning}
          </div>
        )
      )}

      {/* Ready to decide? (Stage 74) */}
      {data.sourceExperimentId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-brand-800">{t.benchmark.readyToDecide}</p>
            <p className="mt-0.5 text-xs text-brand-600">{t.benchmark.readyToDecideDesc}</p>
          </div>
          <Link
            href={`/projects/${id}/experiment?experiment=${encodeURIComponent(data.sourceExperimentId)}`}
            className="flex-shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-700"
          >
            {t.benchmark.recordDecision}
          </Link>
        </div>
      )}

      {/* Recommendation */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">{t.benchmark.intro}</p>
        {winner ? (
          <>
            <h3 className="mt-3 text-sm font-semibold text-gray-800">{t.benchmark.recommendedCandidate}</h3>
            <p className="mt-1 text-sm font-semibold text-brand-700">{winner.label}</p>
            <p className="mt-1 text-xs text-gray-500">{t.benchmark.recommendedBody}</p>
            {winner.reviewRunId && (
              <Link
                href={`/projects/${id}/github/history/${winner.reviewRunId}`}
                className="mt-2 inline-block rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t.benchmark.openReviewRun}
              </Link>
            )}
          </>
        ) : (
          <>
            <h3 className="mt-3 text-sm font-semibold text-gray-700">{t.benchmark.noClearWinner}</h3>
            <p className="mt-1 text-xs text-gray-500">{t.benchmark.noClearWinnerBody}</p>
          </>
        )}
      </section>

      {/* Why */}
      {rationaleLines.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.why}</h3>
          <ul className="mt-2 space-y-1">
            {rationaleLines.map((line, i) => (
              <li key={i} className="text-xs text-gray-600">{line}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Candidate comparison table */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.candidateComparison}</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">{t.benchmark.scoreNote}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 text-left font-medium">{t.benchmark.colCandidate}</th>
                <th className="px-4 py-2 text-left font-medium">{t.benchmark.colMode}</th>
                <th className="px-4 py-2 text-left font-medium">{t.benchmark.colSource}</th>
                <th className="px-4 py-2 text-right font-medium">{t.benchmark.colPassed}</th>
                <th className="px-4 py-2 text-right font-medium">{t.benchmark.colCritical}</th>
                <th className="px-4 py-2 text-right font-medium">{t.benchmark.colNotVerified}</th>
                <th className="px-4 py-2 text-right font-medium">{t.benchmark.colScore}</th>
                <th className="px-4 py-2 text-right font-medium">{t.benchmark.colRun}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ candidate, metrics }) => (
                <tr key={candidate.id} className={`border-t border-gray-100 ${candidate.id === winnerId ? "bg-brand-50/40" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{candidate.label}</td>
                  <td className="px-4 py-2.5 text-gray-600">{modeLabel(t, candidate.mode)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{sourceLabel(t, candidate.source)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{metrics.passed} / {metrics.totalItems}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{metrics.criticalIssueCount}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{metrics.notVerifiedCount}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{metrics.score}</td>
                  <td className="px-4 py-2.5 text-right">
                    {candidate.reviewRunId ? (
                      <Link href={`/projects/${id}/github/history/${candidate.reviewRunId}`} className="text-xs text-brand-600 hover:underline">
                        {candidate.pullRequestNumber ? `PR #${candidate.pullRequestNumber}` : t.benchmark.openReviewRun}
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Metrics detail per candidate (raw counts alongside score) */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t.benchmark.metricsTitle}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {ranked.map(({ candidate, metrics }) => (
            <div key={candidate.id} className={`rounded-xl border p-4 ${candidate.id === winnerId ? "border-brand-300 bg-brand-50/40" : "border-gray-200 bg-white"}`}>
              <p className="mb-2 text-sm font-semibold text-gray-800">{candidate.label}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label={t.benchmark.acceptancePassRate} value={pct(metrics.acceptancePassRate)} strong />
                <Stat label={t.benchmark.score} value={String(metrics.score)} />
                <Stat label={t.benchmark.passed} value={`${metrics.passed} / ${metrics.totalItems}`} />
                <Stat label={t.benchmark.criticalIssues} value={String(metrics.criticalIssueCount)} />
                <Stat label={statusLabel(t, "needs_decision")} value={String(metrics.needsDecision)} />
                <Stat label={t.benchmark.notVerified} value={String(metrics.notVerifiedCount)} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Remaining blocker items (Stage 68 item-level, else count-based fallback) */}
      {itemBlockers !== undefined ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.blockerItemsTitle}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.blockerItemsDesc}</p>
          {itemBlockers.length > 0 ? (
            <div className="mt-3 space-y-2">
              {itemBlockers.map((b, i) => (
                <div key={`${b.itemId}-${i}`} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${ITEM_BADGE[b.status] ?? "border-gray-200 bg-gray-50 text-gray-600"}`}>
                      {statusLabel(t, b.status)}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{b.title}</span>
                  </div>
                  {b.evidence && <p className="mt-1 text-xs text-gray-500">{t.benchmark.evidence}: {b.evidence}</p>}
                  <p className="mt-0.5 text-[11px] text-gray-500">{candidateLabelById(b.candidateId)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500">{t.benchmark.noBlockerItems}</p>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.blockersTitle}</h3>
          {winnerId && winnerBlocker ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {winnerBlocker.failed > 0 && (
                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-red-700">{statusLabel(t, "failed")}: {winnerBlocker.failed}</span>
              )}
              {winnerBlocker.needsDecision > 0 && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-700">{statusLabel(t, "needs_decision")}: {winnerBlocker.needsDecision}</span>
              )}
              {winnerBlocker.inconclusive > 0 && (
                <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-0.5 text-yellow-700">{statusLabel(t, "inconclusive")}: {winnerBlocker.inconclusive}</span>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500">{t.benchmark.noRemainingBlockers}</p>
          )}
          <p className="mt-2 text-[11px] text-gray-500">{t.benchmark.oldBenchmarkBlockers}</p>
        </section>
      )}

      {/* Acceptance item matrix (Stage 69/70) */}
      {matrix ? (
        <MatrixSection matrix={matrix} candidates={candidates} t={t} />
      ) : (
        <section className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-4">
          <p className="text-sm font-medium text-gray-700">{t.benchmark.matrixUnavailable}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.matrixUnavailableBody}</p>
        </section>
      )}

      {/* Source review runs */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.sourceRuns}</h3>
        <ul className="mt-2 space-y-1.5">
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-600">
                {c.label} · {modeLabel(t, c.mode)} · {sourceLabel(t, c.source)}
                {c.pullRequestNumber ? ` · PR #${c.pullRequestNumber}` : ""}
              </span>
              {c.reviewRunId && (
                <Link href={`/projects/${id}/github/history/${c.reviewRunId}`} className="flex-shrink-0 text-brand-600 hover:underline">
                  {t.benchmark.openReviewRun}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Share — PR comment (Stage 67: preview-first, explicit confirm) */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.shareTitle}</h3>
        {!prTarget.canPost ? (
          <p className="mt-2 text-xs text-gray-500">{t.benchmark.mixedPrNote}</p>
        ) : !previewMd ? (
          <button
            onClick={handlePreviewComment}
            className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {t.benchmark.previewPrComment}
          </button>
        ) : postPhase === "posted" ? (
          <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {t.benchmark.postedToGithub}
            {postedUrl && (
              <a href={postedUrl} target="_blank" rel="noopener noreferrer" className="ml-2 underline hover:text-green-900">
                {t.benchmark.prViewComment}
              </a>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-xs font-medium text-gray-500">{t.benchmark.commentPreviewTitle}</p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-700">{previewMd}</pre>
            </div>
            <p className="text-xs text-amber-700">{t.benchmark.postWarning}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePostComment}
                disabled={postPhase === "posting"}
                className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
              >
                {postPhase === "posting" ? t.benchmark.prPosting : t.benchmark.postToPr}
              </button>
              {postPhase === "error" && <span className="text-xs text-red-500">{t.benchmark.postCommentError}</span>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`${strong ? "text-base font-bold text-gray-900" : "text-sm font-medium text-gray-700"}`}>{value}</p>
    </div>
  );
}

// Stage 70: matrix with disagreement-only filter + per-row evidence drilldown.
function MatrixSection({
  matrix,
  candidates,
  t,
}: {
  matrix: BenchmarkMatrix;
  candidates: AgentCandidate[];
  t: Dictionary;
}) {
  const [differentOnly, setDifferentOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = filterMatrixRows(matrix.rows, { differentOnly });

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.matrixTitle}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.matrixDesc}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-gray-500">
              <span>{t.benchmark.matrixItemsCompared.replace("{n}", String(matrix.itemsCompared))}</span>
              {matrix.disagreementCount > 0 && (
                <span className="text-amber-600">{t.benchmark.matrixDisagreements.replace("{n}", String(matrix.disagreementCount))}</span>
              )}
            </div>
          </div>
          <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={differentOnly}
              onChange={(e) => setDifferentOnly(e.target.checked)}
              className="accent-brand-600"
            />
            {t.benchmark.showDifferentOnly}
          </label>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 text-left font-medium" />
                {candidates.map((c) => (
                  <th key={c.id} className="px-4 py-2 text-left font-medium">
                    <span className="block text-gray-600">{c.label}</span>
                    <span className="block font-normal normal-case text-gray-300">{modeLabel(t, c.mode)} · {sourceLabel(t, c.source)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.itemId}>
                  <tr className={`border-t border-gray-100 ${row.hasDisagreement ? "bg-amber-50/40" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-800">{row.title}</span>
                        {row.hasDisagreement && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            {t.benchmark.differentResults}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setExpanded(expanded === row.itemId ? null : row.itemId)}
                        className="mt-0.5 text-[11px] text-brand-600 hover:underline"
                      >
                        {expanded === row.itemId ? t.benchmark.hideEvidence : t.benchmark.viewEvidence}
                      </button>
                    </td>
                    {candidates.map((c) => {
                      const s = row.statusesByCandidate[c.id] ?? "missing";
                      return (
                        <td key={c.id} className="px-4 py-2.5">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${MATRIX_BADGE[s] ?? MATRIX_BADGE.missing}`}>
                            {matrixStatusLabel(t, s)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  {expanded === row.itemId && (
                    <tr className="border-t border-gray-100 bg-gray-50">
                      <td colSpan={candidates.length + 1} className="px-4 py-3">
                        <div className="space-y-2">
                          {candidates.map((c) => {
                            const s = row.statusesByCandidate[c.id] ?? "missing";
                            const ev = row.evidenceByCandidate?.[c.id];
                            return (
                              <div key={c.id}>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-700">{c.label}</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${MATRIX_BADGE[s] ?? MATRIX_BADGE.missing}`}>
                                    {matrixStatusLabel(t, s)}
                                  </span>
                                </div>
                                <p className={`mt-0.5 text-xs ${ev ? "text-gray-600" : "text-gray-500"}`}>
                                  {ev ?? t.benchmark.noEvidenceStored}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-6 text-center">
          <p className="text-sm font-medium text-gray-700">{t.benchmark.noDifferentResults}</p>
          <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.noDifferentResultsBody}</p>
        </div>
      )}
    </section>
  );
}

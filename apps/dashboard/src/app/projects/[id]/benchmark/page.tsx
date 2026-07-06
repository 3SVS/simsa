"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  listProjectReviewHistory,
  type ProjectReviewHistoryItem,
} from "@/lib/workspace-github-api";
import {
  buildBenchmarkResult,
  canSaveBenchmark,
  CANDIDATE_MODES,
  CANDIDATE_SOURCES,
} from "@/lib/agent-benchmark.mjs";
import type {
  AgentCandidate,
  CandidateMode,
  CandidateSource,
  ReviewSummaryCounts,
  BenchmarkRationaleItem,
  BenchmarkBlockerItem,
} from "@/lib/agent-benchmark.mjs";
import {
  saveBenchmark,
  listSavedBenchmarks,
  type SavedBenchmarkListItem,
} from "@/lib/workspace-benchmark-api";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

type CandidateConfig = {
  runId: string;
  label: string;
  mode: CandidateMode;
  source: CandidateSource;
};

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

function blockerText(t: Dictionary, b: BenchmarkBlockerItem): string {
  return t.benchmark.blockerLine
    .replace("{label}", b.candidateLabel)
    .replace("{failed}", String(b.failed))
    .replace("{needsDecision}", String(b.needsDecision))
    .replace("{inconclusive}", String(b.inconclusive));
}

export default function BenchmarkPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
  const [runs, setRuns] = useState<ProjectReviewHistoryItem[]>([]);
  const [configs, setConfigs] = useState<CandidateConfig[]>([]);

  // Stage 65: persistence
  const [title, setTitle] = useState("");
  const [savePhase, setSavePhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saved, setSaved] = useState<SavedBenchmarkListItem[]>([]);

  const loadSaved = useCallback(async () => {
    if (!userKey) return;
    const res = await listSavedBenchmarks(id, userKey);
    if (res.ok) setSaved(res.benchmarks);
  }, [id, userKey]);

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
    void loadSaved();
    return () => { cancelled = true; };
  }, [id, userKey, loadSaved]);

  if (!project) return <ProjectNotFound />;

  const selectedIds = new Set(configs.map((c) => c.runId));
  const availableRuns = runs.filter((r) => !selectedIds.has(r.id));
  const runById = new Map(runs.map((r) => [r.id, r]));

  function addCandidate(run: ProjectReviewHistoryItem) {
    setConfigs((prev) => [
      ...prev,
      { runId: run.id, label: modeLabel(t, "single_agent"), mode: "single_agent", source: "manual" },
    ]);
  }
  function removeCandidate(runId: string) {
    setConfigs((prev) => prev.filter((c) => c.runId !== runId));
  }
  function updateCandidate(runId: string, patch: Partial<CandidateConfig>) {
    setConfigs((prev) => prev.map((c) => (c.runId === runId ? { ...c, ...patch } : c)));
  }

  // ── Build the deterministic benchmark from the selected candidates ──
  const candidates: AgentCandidate[] = configs.map((c) => {
    const run = runById.get(c.runId);
    return {
      id: c.runId,
      label: c.label.trim() || modeLabel(t, c.mode),
      mode: c.mode,
      source: c.source,
      pullRequestNumber: run?.prNumber,
      reviewRunId: c.runId,
    };
  });
  const countsByCandidate: Record<string, ReviewSummaryCounts> = {};
  for (const c of configs) {
    const summary = runById.get(c.runId)?.summary;
    if (summary) countsByCandidate[c.runId] = summary;
  }
  const result = buildBenchmarkResult({ projectId: id, candidates, countsByCandidate });
  const ranked = candidates
    .map((c) => ({ candidate: c, metrics: result.metricsByCandidate[c.id]! }))
    .sort((a, b) => b.metrics.score - a.metrics.score);
  const winnerId = result.recommendation?.winnerCandidateId;

  // Preview-only acceptance-set signal: the history list exposes counts, not the
  // item ids, so we approximate by comparing selectedItemCount. The authoritative
  // alignment is computed server-side and stored on the saved benchmark.
  const previewAligned = (() => {
    if (configs.length < 2) return true;
    const counts = configs.map((c) => runById.get(c.runId)?.selectedItemCount ?? -1);
    return counts.every((n) => n === counts[0]);
  })();

  async function handleSave() {
    if (!userKey || !canSaveBenchmark(configs.length)) return;
    setSavePhase("saving");
    const payload = configs.map((c) => ({
      id: c.runId,
      label: c.label.trim() || modeLabel(t, c.mode),
      mode: c.mode,
      source: c.source,
      reviewRunId: c.runId,
    }));
    const res = await saveBenchmark(id, { userKey, title: title.trim() || undefined, candidates: payload });
    if (res.ok) {
      setSavePhase("saved");
      setTitle("");
      await loadSaved();
      setTimeout(() => setSavePhase("idle"), 2500);
    } else {
      setSavePhase("error");
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.benchmark.title}</h2>
        <p className="mt-0.5 text-sm text-gray-500">{t.benchmark.subtitle}</p>
        <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">{t.benchmark.intro}</p>
      </div>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.benchmark.loading}
        </div>
      )}
      {phase === "error" && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{t.benchmark.loadError}</span>
          <button onClick={() => window.location.reload()} className="btn btn-sm btn-secondary">{t.common.retry}</button>
        </div>
      )}

      {phase === "done" && (
        <>
          {/* Candidate selector */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.selectorTitle}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.selectorHint}</p>

            {runs.length === 0 ? (
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center">
                <p className="text-sm font-medium text-gray-700">{t.benchmark.emptyTitle}</p>
                <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.emptyBody}</p>
                <a href={`/projects/${id}/github`} className="btn btn-md btn-primary mt-4">
                  {t.checks.connectPr} →
                </a>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {/* Available runs */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.benchmark.availableRuns}</p>
                  <div className="space-y-1.5">
                    {availableRuns.length === 0 && (
                      <p className="text-xs text-gray-500">{t.benchmark.noRuns}</p>
                    )}
                    {availableRuns.map((run) => (
                      <div key={run.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700">
                            {t.benchmark.runMeta.replace("{pr}", String(run.prNumber)).replace("{date}", formatDate(run.createdAt, locale))}
                          </p>
                          <p className="truncate text-[11px] text-gray-500">
                            {t.benchmark.runCounts
                              .replace("{passed}", String(run.summary?.passed ?? 0))
                              .replace("{failed}", String(run.summary?.failed ?? 0))
                              .replace("{inconclusive}", String(run.summary?.inconclusive ?? 0))}
                          </p>
                        </div>
                        <button
                          onClick={() => addCandidate(run)}
                          className="flex-shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
                        >
                          {t.benchmark.addCandidate}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Selected candidates */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.benchmark.selected}</p>
                  <div className="space-y-2">
                    {configs.length === 0 && (
                      <p className="text-xs text-gray-500">{t.benchmark.needMoreBody}</p>
                    )}
                    {configs.map((c) => {
                      const run = runById.get(c.runId);
                      return (
                        <div key={c.runId} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">
                              {run ? t.benchmark.runMeta.replace("{pr}", String(run.prNumber)).replace("{date}", formatDate(run.createdAt, locale)) : c.runId}
                            </span>
                            <button onClick={() => removeCandidate(c.runId)} className="text-[11px] text-gray-500 underline hover:text-gray-600">
                              {t.benchmark.remove}
                            </button>
                          </div>
                          <input
                            value={c.label}
                            onChange={(e) => updateCandidate(c.runId, { label: e.target.value })}
                            aria-label={t.benchmark.labelField}
                            className="mb-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300"
                          />
                          <div className="flex gap-2">
                            <select
                              value={c.mode}
                              onChange={(e) => updateCandidate(c.runId, { mode: e.target.value as CandidateMode })}
                              aria-label={t.benchmark.modeField}
                              className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300"
                            >
                              {CANDIDATE_MODES.map((m) => (
                                <option key={m} value={m}>{modeLabel(t, m)}</option>
                              ))}
                            </select>
                            <select
                              value={c.source}
                              onChange={(e) => updateCandidate(c.runId, { source: e.target.value as CandidateSource })}
                              aria-label={t.benchmark.sourceField}
                              className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300"
                            >
                              {CANDIDATE_SOURCES.map((s) => (
                                <option key={s} value={s}>{sourceLabel(t, s)}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Need more candidates */}
          {runs.length > 0 && configs.length < 2 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-6 text-center">
              <p className="text-sm font-medium text-gray-700">{t.benchmark.needMoreTitle}</p>
              <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.needMoreBody}</p>
            </div>
          )}

          {/* Metrics + comparison + recommendation */}
          {configs.length >= 2 && (
            <>
              {/* Acceptance set warning (preview heuristic) */}
              {!previewAligned && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  {t.benchmark.acceptanceSetWarning}
                </div>
              )}

              {/* Metrics cards */}
              <section>
                <h3 className="mb-3 text-sm font-semibold text-gray-700">{t.benchmark.metricsTitle}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ranked.map(({ candidate, metrics }) => (
                    <div
                      key={candidate.id}
                      className={`rounded-xl border p-4 ${candidate.id === winnerId ? "border-brand-300 bg-brand-50/40" : "border-gray-200 bg-white"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-800">{candidate.label}</p>
                        <span className="text-[11px] text-gray-500">{modeLabel(t, candidate.mode)} · {sourceLabel(t, candidate.source)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <Stat label={t.benchmark.acceptancePassRate} value={pct(metrics.acceptancePassRate)} strong />
                        <Stat label={t.benchmark.score} value={String(metrics.score)} />
                        <Stat label={t.benchmark.passed} value={`${metrics.passed} / ${metrics.totalItems}`} />
                        <Stat label={t.benchmark.criticalIssues} value={String(metrics.criticalIssueCount)} />
                        <Stat label={t.benchmark.notVerified} value={String(metrics.notVerifiedCount)} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Comparison table */}
              <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-100 px-5 py-3">
                  <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.comparisonTitle}</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-4 py-2 text-left font-medium">{t.benchmark.colCandidate}</th>
                      <th className="px-4 py-2 text-right font-medium">{t.benchmark.colPassRate}</th>
                      <th className="px-4 py-2 text-right font-medium">{t.benchmark.colPassed}</th>
                      <th className="px-4 py-2 text-right font-medium">{t.benchmark.colCritical}</th>
                      <th className="px-4 py-2 text-right font-medium">{t.benchmark.colNotVerified}</th>
                      <th className="px-4 py-2 text-right font-medium">{t.benchmark.colScore}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map(({ candidate, metrics }) => (
                      <tr key={candidate.id} className={`border-t border-gray-100 ${candidate.id === winnerId ? "bg-brand-50/40" : ""}`}>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{candidate.label}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{pct(metrics.acceptancePassRate)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{metrics.passed} / {metrics.totalItems}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{metrics.criticalIssueCount}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{metrics.notVerifiedCount}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{metrics.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Recommendation */}
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.recommendationTitle}</h3>
                {winnerId ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-brand-700">
                      {t.benchmark.winnerLabel.replace("{label}", candidates.find((c) => c.id === winnerId)?.label ?? "")}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {result.recommendation?.rationale.map((item, i) => (
                        <li key={i} className="text-xs text-gray-600">{rationaleText(t, item)}</li>
                      ))}
                    </ul>
                    <Link
                      href={`/projects/${id}/github/history/${winnerId}`}
                      className="mt-3 inline-block rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      {t.benchmark.viewRun}
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm font-semibold text-gray-700">{t.benchmark.noClearWinner}</p>
                    <p className="mt-1 text-xs text-gray-500">{t.benchmark.noClearWinnerBody}</p>
                  </>
                )}
              </section>

              {/* Remaining blockers */}
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.blockersTitle}</h3>
                <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.blockersSubtitle}</p>
                {result.recommendation && result.recommendation.blockers.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {result.recommendation.blockers.map((b) => (
                      <li key={b.candidateId} className="text-xs text-gray-600">{blockerText(t, b)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">{t.benchmark.noBlockers}</p>
                )}
              </section>

              {/* Next action */}
              <section className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-4">
                <p className="text-sm font-semibold text-gray-700">{t.benchmark.nextActionTitle}</p>
                <p className="mt-0.5 text-xs text-gray-500">{t.benchmark.nextActionBody}</p>
              </section>

              {/* Save */}
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.createBenchmark}</h3>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t.benchmark.titlePlaceholder}
                    maxLength={120}
                    className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                  <button
                    onClick={handleSave}
                    disabled={!canSaveBenchmark(configs.length) || savePhase === "saving"}
                    className="flex-shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
                  >
                    {savePhase === "saving" ? t.benchmark.saving : t.benchmark.save}
                  </button>
                </div>
                {savePhase === "saved" && <p className="mt-2 text-xs text-green-600">{t.benchmark.saved}</p>}
                {savePhase === "error" && <p className="mt-2 text-xs text-red-500">{t.benchmark.saveError}</p>}
              </section>
            </>
          )}

          {/* Saved benchmarks */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-800">{t.benchmark.savedBenchmarks}</h3>
            {saved.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">{t.benchmark.noSavedBenchmarks}</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {saved.map((b) => {
                  const winnerLabel = b.noClearWinner
                    ? t.benchmark.noClearWinner
                    : b.winnerCandidateId
                      ? runById.get(b.winnerCandidateId)
                        ? t.benchmark.runMeta
                            .replace("{pr}", String(runById.get(b.winnerCandidateId)!.prNumber))
                            .replace("{date}", formatDate(runById.get(b.winnerCandidateId)!.createdAt, locale))
                        : b.winnerCandidateId
                      : "";
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-gray-700">{b.title || t.benchmark.savedBenchmarks}</p>
                        <p className="truncate text-[11px] text-gray-500">
                          {t.benchmark.savedAt.replace("{date}", formatDate(b.createdAt, locale))} · {winnerLabel}
                        </p>
                      </div>
                      <Link
                        href={`/projects/${id}/benchmark/${b.id}`}
                        className="flex-shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        {t.benchmark.open}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
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

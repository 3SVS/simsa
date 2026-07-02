"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, loadExtendedProjectData, getUserKey } from "@/lib/workflow-store";
import {
  fetchProjectRepo,
  fetchProjectPulls,
  fetchLinkedPulls,
  linkPullRequest,
  startPRReview,
  getLatestPRReview,
  generatePRFixBrief,
  previewPRComment,
  postPRComment,
  updatePRComment,
  listPRComments,
  getPRReviewComparison,
  type GitHubPull,
  type LinkedPull,
  type LinkedRepo,
  type ReviewRun,
  type FixBriefTarget,
  type FixBriefResponse,
  type FixBriefFile,
  type ListedComment,
  type LatestPostedCommentSummary,
  type PrReviewComparisonResponse,
  type CreditEnforcementDryRun,
  type CreditEnforcementResult,
} from "@/lib/workspace-github-api";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusText } from "@/components/StatusText";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";
import type { ItemStatus } from "@/lib/labels";

export default function GitHubPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [loadPhase, setLoadPhase] = useState<"loading" | "no_repo" | "ready">("loading");
  const [repo, setRepo] = useState<LinkedRepo | null>(null);
  const [pulls, setPulls] = useState<GitHubPull[]>([]);
  const [pullsPhase, setPullsPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pullsError, setPullsError] = useState("");
  const [linkedPulls, setLinkedPulls] = useState<LinkedPull[]>([]);
  const [selectedPR, setSelectedPR] = useState<GitHubPull | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [linkPhase, setLinkPhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  // Review state: keyed by prNumber
  const [reviewRuns, setReviewRuns] = useState<Record<number, ReviewRun>>({});
  const [reviewPhase, setReviewPhase] = useState<Record<number, "idle" | "running" | "done" | "error">>({});
  // Credit dry-run result: keyed by prNumber (populated after each review run)
  const [creditDryRunByPr, setCreditDryRunByPr] = useState<Record<number, CreditEnforcementResult | CreditEnforcementDryRun>>({});
  // Comparison data: keyed by prNumber (loaded by ComparisonPanel, used by PRCommentPanel)
  const [comparisonDataByPr, setComparisonDataByPr] = useState<Record<number, PrReviewComparisonResponse>>({});

  const ext = loadExtendedProjectData(id);
  const checkResultMap = new Map(
    (ext?.checkResults?.results ?? []).map((r) => [r.itemId, r.status as ItemStatus]),
  );
  const allItems = (project?.requirements ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    checkStatus: checkResultMap.get(r.id) ?? (r.status as ItemStatus),
  }));

  const loadInitial = useCallback(async () => {
    setLoadPhase("loading");
    const [repoRes, linkedRes] = await Promise.all([
      fetchProjectRepo(id),
      fetchLinkedPulls(id),
    ]);
    if (repoRes.ok && repoRes.repo) {
      setRepo(repoRes.repo);
      setLoadPhase("ready");
    } else {
      setLoadPhase("no_repo");
    }
    if (linkedRes.ok) {
      setLinkedPulls(linkedRes.pulls);
      // Load any existing review runs for linked PRs
      for (const lp of linkedRes.pulls) {
        const reviewRes = await getLatestPRReview(id, lp.number);
        if (reviewRes.ok && reviewRes.run) {
          setReviewRuns((prev) => ({ ...prev, [lp.number]: reviewRes.run! }));
          setReviewPhase((prev) => ({ ...prev, [lp.number]: "done" }));
        }
      }
    }
  }, [id]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  async function handleLoadPulls() {
    if (!repo) return;
    setPullsPhase("loading");
    setPullsError("");
    const res = await fetchProjectPulls(id, userKey);
    if (res.ok) {
      setPulls(res.pulls);
      setPullsPhase("done");
    } else {
      setPullsError(res.error);
      setPullsPhase("error");
    }
  }

  function selectPR(pull: GitHubPull) {
    setSelectedPR(pull);
    setSelectedItemIds(new Set());
    setLinkPhase("idle");
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  async function handleLink() {
    if (!selectedPR || selectedItemIds.size === 0) return;
    setLinkPhase("saving");
    const res = await linkPullRequest(id, selectedPR.number, {
      userKey,
      pullRequest: {
        number: selectedPR.number,
        title: selectedPR.title,
        state: selectedPR.state,
        htmlUrl: selectedPR.htmlUrl,
        headBranch: selectedPR.headBranch,
        baseBranch: selectedPR.baseBranch,
      },
      selectedItemIds: Array.from(selectedItemIds),
    });
    if (res.ok) {
      setLinkedPulls((prev) => {
        const filtered = prev.filter((p) => p.number !== res.pull.number);
        return [res.pull, ...filtered];
      });
      setLinkPhase("done");
      setSelectedPR(null);
      setSelectedItemIds(new Set());
    } else {
      setLinkPhase("error");
    }
  }

  async function handleStartReview(lp: LinkedPull) {
    setReviewPhase((prev) => ({ ...prev, [lp.number]: "running" }));
    const ext2 = loadExtendedProjectData(id);
    const items = (project?.requirements ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status ?? "draft",
      criteria: (r as { criteria?: string[] }).criteria ?? [],
    }));
    const productSpec = (ext2?.productSpec ?? {}) as Record<string, unknown>;
    const idempotencyKey = `${crypto.randomUUID()}`;

    const res = await startPRReview(id, lp.number, {
      userKey,
      selectedItemIds: lp.selectedItemIds,
      items,
      productSpec,
      idempotencyKey,
    });
    if (res.ok) {
      setReviewRuns((prev) => ({ ...prev, [lp.number]: res.run }));
      setReviewPhase((prev) => ({ ...prev, [lp.number]: "done" }));
      if (res.creditEnforcement) {
        setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditEnforcement! }));
      } else if (res.creditDryRun) {
        setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditDryRun! }));
      }
    } else {
      setReviewPhase((prev) => ({ ...prev, [lp.number]: "error" }));
      // HTTP 402: store enforcement info so CreditDryRunBanner can show the blocked state
      if (!res.ok && res.error === "insufficient_credits" && res.creditEnforcement) {
        setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditEnforcement! }));
      }
    }
  }

  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">{t.nav.github}</h1>
          <p className="page-subtitle">{t.review.basisNote}</p>
        </div>
        <Link
          href={`/projects/${id}/github/history`}
          className="mt-1 flex-shrink-0 text-xs font-medium text-gray-400 hover:text-brand-700"
        >
          {t.github.viewHistory} →
        </Link>
      </div>

      {/* Loading */}
      {loadPhase === "loading" && (
        <div className="card p-6 text-center">
          <div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <p className="text-sm text-gray-400">{t.github.checkingConnection}</p>
        </div>
      )}

      {/* No repo */}
      {loadPhase === "no_repo" && (
        <div className="card p-8 text-center">
          <p className="mb-4 text-sm text-gray-600">{t.github.connectRepoFirst}</p>
          <Link href={`/projects/${id}/settings`} className="btn btn-md btn-primary">
            {t.github.goConnectRepo}
          </Link>
        </div>
      )}

      {/* Ready */}
      {loadPhase === "ready" && repo && (
        <>
          {/* Repo info */}
          <div className="card flex items-center justify-between p-4">
            <div>
              <p className="mb-0.5 text-xs text-gray-400">{t.github.connectedRepo}</p>
              <a
                href={repo.htmlUrl ?? `https://github.com/${repo.fullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm font-medium text-brand-700 hover:underline"
              >
                {repo.fullName}
              </a>
              {repo.defaultBranch && <span className="ml-2 text-xs text-gray-400">→ {repo.defaultBranch}</span>}
            </div>
            <button onClick={handleLoadPulls} disabled={pullsPhase === "loading"} className="btn btn-md btn-secondary">
              {pullsPhase === "loading" ? t.common.loading : t.github.loadPulls}
            </button>
          </div>

          {/* PR list */}
          {pullsPhase === "error" && (
            <div className="callout callout-error">
              {t.github.pullsLoadError} {pullsError.includes("not_connected") ? t.github.errorNotConnected : ""}
            </div>
          )}

          {pullsPhase === "done" && (
            <div className="card overflow-hidden">
              <p className="border-b border-gray-100 px-5 py-4 text-sm font-semibold text-gray-700">
                {pulls.length} {t.github.openPulls}
              </p>
              {pulls.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-gray-500">{t.github.noPulls}</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {pulls.map((pull) => (
                    <button
                      key={pull.number}
                      onClick={() => selectPR(pull)}
                      className={`w-full px-5 py-4 text-left transition-colors hover:bg-gray-50 ${selectedPR?.number === pull.number ? "border-l-2 border-brand-500 bg-brand-50" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex-shrink-0 font-mono text-xs text-gray-400">#{pull.number}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-800">{pull.title}</p>
                          <p className="mt-0.5 font-mono text-xs text-gray-400">
                            {pull.headBranch} → {pull.baseBranch}
                            {pull.updatedAt && ` · ${new Date(pull.updatedAt).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US")}`}
                          </p>
                        </div>
                        <span className="flex-shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">{t.github.stateOpen}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Item selection for selected PR */}
          {selectedPR && (
            <div className="rounded-lg border border-brand-200 bg-white p-5">
              <p className="mb-1 text-sm font-semibold text-gray-800">
                PR #{selectedPR.number}: {selectedPR.title}
              </p>
              <p className="mb-4 text-xs text-gray-400">
                {t.github.selectItemsForPr} ({selectedItemIds.size} {t.github.selected})
              </p>
              <div className="mb-4 max-h-56 space-y-1 overflow-y-auto">
                {allItems.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedItemIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="h-4 w-4 flex-shrink-0 cursor-pointer rounded accent-brand-600"
                    />
                    <span className="flex-1 text-sm text-gray-700">{item.title}</span>
                    <StatusBadge status={item.checkStatus} />
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleLink} disabled={selectedItemIds.size === 0 || linkPhase === "saving"} className="btn btn-md btn-primary">
                  {linkPhase === "saving" ? t.github.saving : t.github.saveLink}
                </button>
                <button onClick={() => { setSelectedPR(null); setSelectedItemIds(new Set()); }} className="text-sm text-gray-500 hover:text-gray-700">
                  {t.common.cancel}
                </button>
                {linkPhase === "done" && <span className="text-sm text-green-600">✓ {t.github.linked}</span>}
                {linkPhase === "error" && <span className="text-sm text-red-500">{t.github.linkSaveError}</span>}
              </div>
            </div>
          )}

          {/* Linked PRs list */}
          {linkedPulls.length > 0 && (
            <div className="card">
              <p className="border-b border-gray-100 px-5 py-4 text-sm font-semibold text-gray-700">
                {linkedPulls.length} {t.github.linkedPulls}
              </p>
              <div className="divide-y divide-gray-50">
                {linkedPulls.map((lp) => {
                  const phase = reviewPhase[lp.number] ?? "idle";
                  const run = reviewRuns[lp.number];
                  return (
                    <div key={lp.id} className="px-5 py-4 space-y-3">
                      {/* PR header */}
                      <div className="flex items-start gap-3">
                        <span className="text-xs text-gray-400 font-mono mt-0.5">#{lp.number}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{lp.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{lp.repoFullName}</p>
                        </div>
                        <span className={`text-xs rounded-full px-2 py-0.5 flex-shrink-0 ${lp.state === "open" ? "text-green-600 bg-green-50 border border-green-200" : "text-gray-500 bg-gray-100 border border-gray-200"}`}>
                          {lp.state === "open" ? t.github.stateOpen : lp.state === "closed" ? t.github.stateClosed : lp.state}
                        </span>
                      </div>

                      {/* Item tags */}
                      {lp.selectedItemIds.length > 0 && (
                        <div className="ml-6 flex flex-wrap gap-1.5">
                          {lp.selectedItemIds.map((itemId) => {
                            const item = allItems.find((i) => i.id === itemId);
                            return item ? (
                              <span key={itemId} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 truncate max-w-[200px]">
                                {item.title}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}

                      {/* Review section */}
                      <div className="ml-6">
                        {phase === "idle" && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-400">{t.github.notReviewedYet}</p>
                            <button onClick={() => handleStartReview(lp)} className="btn btn-md btn-primary">
                              {t.github.runReviewBtn}
                            </button>
                          </div>
                        )}

                        {phase === "running" && (
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" />
                            {t.github.reviewing}
                          </div>
                        )}

                        {phase === "error" && (
                          <div className="space-y-2">
                            {creditDryRunByPr[lp.number] && (creditDryRunByPr[lp.number] as CreditEnforcementResult).blocked ? (
                              <CreditDryRunBanner t={t} dryRun={creditDryRunByPr[lp.number]!} projectId={id} />
                            ) : (
                              <p className="text-xs text-red-600">{t.github.reviewFailed}</p>
                            )}
                            <button onClick={() => handleStartReview(lp)} className="btn btn-sm btn-secondary">
                              {t.common.retry}
                            </button>
                          </div>
                        )}

                        {phase === "done" && run && (
                          <>
                            <ReviewResultPanel run={run} onRerun={() => handleStartReview(lp)} />
                            {creditDryRunByPr[lp.number] && (
                              <CreditDryRunBanner t={t} dryRun={creditDryRunByPr[lp.number]!} projectId={id} />
                            )}
                            <div className="mt-4 pt-4 border-t border-gray-100">
                              <ComparisonPanel
                                t={t}
                                projectId={id}
                                prNumber={lp.number}
                                userKey={userKey}
                                onLoad={(prNum, data) =>
                                  setComparisonDataByPr((prev) => ({ ...prev, [prNum]: data }))
                                }
                              />
                            </div>
                            {run.results && run.results.some((r) => r.status !== "passed") && (
                              <div className="mt-4 pt-4 border-t border-gray-100">
                                <FixBriefPanel
                                  run={run}
                                  lp={lp}
                                  projectId={id}
                                  userKey={userKey}
                                  items={(project?.requirements ?? []).map((r) => ({
                                    id: r.id,
                                    title: r.title,
                                    status: r.status ?? "draft",
                                    criteria: (r as { criteria?: string[] }).criteria ?? [],
                                  }))}
                                  productSpec={(loadExtendedProjectData(id)?.productSpec ?? {}) as Record<string, unknown>}
                                />
                              </div>
                            )}
                            {run.results && run.results.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-gray-100">
                                <PRCommentPanel
                                  run={run}
                                  lp={lp}
                                  projectId={id}
                                  userKey={userKey}
                                  comparisonData={comparisonDataByPr[lp.number] ?? null}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── ComparisonPanel ─────────────────────────────────────────────────────────

function ComparisonPanel({
  t,
  projectId,
  prNumber,
  userKey,
  onLoad,
}: {
  t: Dictionary;
  projectId: string;
  prNumber: number;
  userKey: string;
  onLoad?: (prNumber: number, data: PrReviewComparisonResponse) => void;
}) {
  const [data, setData] = useState<PrReviewComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getPRReviewComparison(projectId, prNumber, userKey).then((res) => {
      if (!cancelled) {
        setData(res);
        setLoading(false);
        onLoad?.(prNumber, res);
      }
    });
    return () => { cancelled = true; };
  }, [projectId, prNumber, userKey, onLoad]);

  if (loading) return null; // silent while loading

  if (!data || !data.ok) return null;

  if (!data.comparable) {
    return (
      <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs text-gray-400">
        {t.comparison.noComparison}
      </p>
    );
  }

  const { previousRun, latestRun, comparison } = data;
  const prevSumm = previousRun.summary;
  const latSumm = latestRun.summary;

  function DeltaBadge({ prev, latest }: { prev: number; latest: number }) {
    const delta = latest - prev;
    if (delta === 0) return <span className="text-gray-400">{latest}</span>;
    if (delta > 0) return <span className="text-green-600">{prev} → {latest} (+{delta})</span>;
    return <span className="text-red-600">{prev} → {latest} ({delta})</span>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-0.5 text-sm font-semibold text-gray-800">{t.comparison.title}</p>
        <p className="text-xs text-gray-400">{t.comparison.desc}</p>
      </div>

      {/* Summary delta */}
      <div className="space-y-1.5 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-20 text-gray-500">{statusLabel(t, "failed")}</span>
          <DeltaBadge prev={prevSumm.failed} latest={latSumm.failed} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-gray-500">{statusLabel(t, "inconclusive")}</span>
          <DeltaBadge prev={prevSumm.inconclusive} latest={latSumm.inconclusive} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-gray-500">{statusLabel(t, "needs_decision")}</span>
          <DeltaBadge prev={prevSumm.needsDecision} latest={latSumm.needsDecision} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-gray-500">{statusLabel(t, "passed")}</span>
          <DeltaBadge prev={prevSumm.passed} latest={latSumm.passed} />
        </div>
      </div>

      {/* Improved items */}
      {comparison.improved.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-green-700">{t.comparison.improved} ({comparison.improved.length})</p>
          {comparison.improved.map((item) => (
            <div key={item.itemId} className="rounded-lg border border-green-100 bg-green-50 px-3 py-2.5">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-xs font-medium text-green-800">{item.title}</span>
                <span className="text-xs text-green-600">{statusLabel(t, item.from)} → {statusLabel(t, item.to)}</span>
              </div>
              <p className="text-xs text-green-700">{item.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Still open items */}
      {comparison.stillOpen.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-amber-700">{t.comparison.stillOpen} ({comparison.stillOpen.length})</p>
          {comparison.stillOpen.map((item) => (
            <div key={item.itemId} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-xs font-medium text-amber-800">{item.title}</span>
                <span className="text-xs text-amber-600">{statusLabel(t, item.status)}</span>
              </div>
              <p className="text-xs text-amber-700">{item.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Newly problematic */}
      {comparison.newlyProblematic.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-red-700">{t.comparison.newIssue} ({comparison.newlyProblematic.length})</p>
          {comparison.newlyProblematic.map((item) => (
            <div key={item.itemId} className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-xs font-medium text-red-800">{item.title}</span>
                <span className="text-xs text-red-600">{statusLabel(t, item.from)} → {statusLabel(t, item.to)}</span>
              </div>
              <p className="text-xs text-red-700">{item.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Unchanged */}
      {comparison.unchanged.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">{t.comparison.unchanged} ({comparison.unchanged.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {comparison.unchanged.map((item) => (
              <span key={item.itemId} className="text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-0.5">
                {item.title}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 italic">{comparison.summaryText}</p>
    </div>
  );
}

// ─── PRCommentPanel ──────────────────────────────────────────────────────────

function PRCommentPanel({
  run,
  lp,
  projectId,
  userKey,
  comparisonData = null,
}: {
  run: ReviewRun;
  lp: LinkedPull;
  projectId: string;
  userKey: string;
  comparisonData?: PrReviewComparisonResponse | null;
}) {
  const { t, locale } = useI18n();
  const comparable = comparisonData?.ok === true && comparisonData.comparable === true;
  const allResults = run.results ?? [];
  const fixable = allResults.filter(
    (r) => r.status === "failed" || r.status === "inconclusive" || r.status === "needs_decision",
  );
  const defaultSelected = new Set(
    [...fixable]
      .sort((a, b) => (a.status === "failed" ? -1 : b.status === "failed" ? 1 : 0))
      .slice(0, 3)
      .map((r) => r.itemId),
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(defaultSelected);
  const [includeComparison, setIncludeComparison] = useState(comparable);
  const [mode, setMode] = useState<"new" | "update_latest">("new");
  const [previewPhase, setPreviewPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [postPhase, setPostPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [postedUrl, setPostedUrl] = useState<string | null>(null);
  const [postWasUpdate, setPostWasUpdate] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pastComments, setPastComments] = useState<ListedComment[]>([]);
  const [latestPosted, setLatestPosted] = useState<LatestPostedCommentSummary | null>(null);
  const [pastLoaded, setPastLoaded] = useState(false);

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handlePreview() {
    setPreviewPhase("loading");
    setPreviewBody(null);
    setScopeError(false);
    setErrorMsg(null);
    const res = await previewPRComment(projectId, lp.number, {
      userKey,
      selectedItemIds: Array.from(selectedIds),
      includeComparison,
      locale,
    });
    if (res.ok) {
      setPreviewBody(res.comment.body);
      setPreviewPhase("done");
    } else {
      setPreviewPhase("error");
      setErrorMsg(res.message ?? res.error ?? t.comment.previewError);
    }
  }

  async function handlePost() {
    setPostPhase("loading");
    setScopeError(false);
    setErrorMsg(null);
    const res = await postPRComment(projectId, lp.number, {
      userKey,
      selectedItemIds: Array.from(selectedIds),
      body: previewBody ?? undefined,
      includeComparison,
      mode,
      locale,
    });
    if (res.ok) {
      setPostedUrl(res.comment.githubCommentUrl);
      setPostWasUpdate(res.updated === true);
      setPostPhase("done");
    } else {
      setPostPhase("error");
      if (res.error === "github_scope_required") {
        setScopeError(true);
      }
      setErrorMsg(res.message ?? res.error ?? t.comment.postError);
    }
  }

  async function loadPastComments() {
    if (pastLoaded) return;
    setPastLoaded(true);
    const res = await listPRComments(projectId, lp.number);
    if (res.ok) {
      setPastComments(res.comments);
      setLatestPosted(res.latestPostedComment);
    }
  }

  function handleRecheck() {
    setPostPhase("idle");
    setPreviewPhase("idle");
    setPreviewBody(null);
    setPostedUrl(null);
    setScopeError(false);
    setErrorMsg(null);
    setPostWasUpdate(false);
  }

  const canPost = selectedIds.size > 0;
  const hasExistingComment = latestPosted !== null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-800 mb-0.5">{t.comment.title}</p>
        <p className="text-xs text-gray-400">{t.comment.desc}</p>
      </div>

      <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
        {t.comment.publicOnly}
      </p>

      {/* Comparison inclusion option */}
      <div>
        <p className="text-xs text-gray-500 mb-1.5">{t.comment.includeComparisonDesc}</p>
        <label className={`flex items-center gap-2 cursor-pointer ${comparable ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={includeComparison}
            disabled={!comparable}
            onChange={(e) => setIncludeComparison(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600"
          />
          <span className="text-xs text-gray-700">{t.comment.includeComparison}</span>
        </label>
        {!comparable && (
          <p className="text-xs text-gray-400 mt-1 ml-6">{t.comment.comparisonUnavailable}</p>
        )}
      </div>

      {/* Mode selector — only show after past comments loaded and existing comment exists */}
      {pastLoaded && hasExistingComment && postPhase !== "done" && (
        <div className="flex gap-3">
          {(["new", "update_latest"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600">
              <input
                type="radio"
                name="comment-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-indigo-600"
              />
              {m === "new" ? t.comment.modeNew : t.comment.modeUpdate}
            </label>
          ))}
        </div>
      )}

      {/* Item selection */}
      <p className="mb-1 text-xs text-gray-400">
        {t.exportPage.selectedOfTotal
          .replace("{sel}", String(selectedIds.size))
          .replace("{total}", String(allResults.length))}
      </p>
      <div className="space-y-1">
        {allResults.map((r) => (
          <label
            key={r.itemId}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(r.itemId)}
              onChange={() => toggleId(r.itemId)}
              className="w-4 h-4 rounded accent-indigo-600 cursor-pointer flex-shrink-0"
            />
            <span className={`text-xs font-medium border rounded-full px-2 py-0.5 flex-shrink-0 ${STATUS_COLORS[r.status] ?? ""}`}>
              <StatusText status={r.status} />
            </span>
            <span className="text-sm text-gray-700 truncate">{r.title}</span>
          </label>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handlePreview}
          disabled={!canPost || previewPhase === "loading"}
          className="text-sm px-4 py-2 rounded-xl font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {previewPhase === "loading" ? t.comment.previewing : t.comment.preview}
        </button>
        {previewBody && postPhase !== "done" && (
          <button
            onClick={handlePost}
            disabled={postPhase === "loading"}
            className="text-sm px-4 py-2 rounded-xl font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {postPhase === "loading"
              ? t.comment.posting
              : mode === "update_latest" && hasExistingComment
                ? t.comment.postUpdate
                : t.comment.post}
          </button>
        )}
      </div>

      {/* Scope error */}
      {scopeError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 space-y-1">
          <p>{t.comment.scopeTitle}</p>
          <p className="text-xs">{t.comment.scopeDesc}</p>
          <Link
            href={`/projects/${projectId}/settings`}
            className="inline-block mt-1 text-xs font-medium text-amber-700 underline"
          >
            {t.comment.reconnect}
          </Link>
        </div>
      )}

      {/* Other errors */}
      {!scopeError && (previewPhase === "error" || postPhase === "error") && errorMsg && (
        <p className="text-xs text-red-500">{errorMsg}</p>
      )}

      {/* Success */}
      {postPhase === "done" && postedUrl && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-green-800 font-medium">
              {postWasUpdate ? t.comment.postedUpdate : t.comment.postedNew}
            </p>
            <a
              href={postedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-700 font-medium underline hover:text-green-900 ml-3 flex-shrink-0"
            >
              {t.comment.viewOnGithub}
            </a>
          </div>
          <button
            onClick={handleRecheck}
            className="text-xs text-green-700 underline hover:text-green-900"
          >
            {t.comment.recheck}
          </button>
        </div>
      )}

      {/* Preview body */}
      {previewBody && previewPhase === "done" && postPhase !== "done" && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">{t.comment.previewTitle}</p>
          <div className="max-h-64 overflow-y-auto">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
              {previewBody}
            </pre>
          </div>
        </div>
      )}

      {/* Past comments toggle */}
      <button
        onClick={loadPastComments}
        className="text-xs text-gray-400 hover:text-gray-600 underline"
      >
        {t.comment.showPast}
      </button>

      {pastLoaded && pastComments.length > 0 && (
        <div className="space-y-1.5">
          {latestPosted && (
            <p className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
              {t.comment.latest} {latestPosted.updatedAt.slice(0, 10)}{" "}
              {latestPosted.githubCommentUrl && (
                <a href={latestPosted.githubCommentUrl} target="_blank" rel="noopener noreferrer" className="underline">{t.comment.viewOnGithub}</a>
              )}
            </p>
          )}
          {pastComments.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs text-gray-500">
              <span className={`rounded-full px-2 py-0.5 border flex-shrink-0 ${
                c.status === "posted" ? "text-green-600 bg-green-50 border-green-200" :
                c.status === "error" ? "text-red-600 bg-red-50 border-red-200" :
                "text-gray-500 bg-gray-100 border-gray-200"
              }`}>{c.status === "posted" ? t.comment.statusPosted : c.status === "error" ? t.comment.statusError : c.status}</span>
              <span className="truncate flex-1">{c.bodyPreview}</span>
              {c.githubCommentUrl && (
                <a href={c.githubCommentUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-indigo-500 hover:underline">{t.comment.view}</a>
              )}
            </div>
          ))}
        </div>
      )}

      {pastLoaded && pastComments.length === 0 && (
        <p className="text-xs text-gray-400">{t.comment.noPast}</p>
      )}
    </div>
  );
}

// ─── FixBriefPanel ───────────────────────────────────────────────────────────

type WorkspaceItemLocal = { id: string; title: string; status: string; criteria: string[] };

function FixBriefPanel({
  run,
  lp,
  projectId,
  userKey,
  items,
  productSpec,
}: {
  run: ReviewRun;
  lp: LinkedPull;
  projectId: string;
  userKey: string;
  items: WorkspaceItemLocal[];
  productSpec: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const fixableItems = (run.results ?? []).filter(
    (r) => r.status === "failed" || r.status === "inconclusive" || r.status === "needs_decision",
  );
  // Pre-select: failed first, up to 3
  const defaultSelected = new Set(
    [...fixableItems]
      .sort((a, b) => (a.status === "failed" ? -1 : b.status === "failed" ? 1 : 0))
      .slice(0, 3)
      .map((r) => r.itemId),
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(defaultSelected);
  const [target, setTarget] = useState<FixBriefTarget>("both");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<FixBriefResponse | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (selectedIds.size === 0) return;
    setPhase("loading");
    const res = await generatePRFixBrief(projectId, lp.number, {
      userKey,
      selectedItemIds: Array.from(selectedIds),
      target,
      items,
      productSpec,
    });
    setResult(res);
    setPhase(res.ok ? "done" : "error");
  }

  async function handleCopy(file: FixBriefFile) {
    await navigator.clipboard.writeText(file.content).catch(() => {});
    setCopyMsg(file.path);
    setTimeout(() => setCopyMsg(null), 2000);
  }

  async function handleZip() {
    if (!result || !result.ok) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const f of result.brief.files) zip.file(f.path, f.content);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conclave-pr-fix-pack-${lp.number}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (fixableItems.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-800 mb-0.5">{t.fixBrief.title}</p>
        <p className="text-xs text-gray-400">{t.fixBrief.desc}</p>
      </div>

      {/* Item checkboxes */}
      <p className="mb-1 text-xs text-gray-400">
        {t.exportPage.selectedOfTotal
          .replace("{sel}", String(selectedIds.size))
          .replace("{total}", String(fixableItems.length))}
      </p>
      <div className="space-y-1">
        {fixableItems.map((r) => (
          <label
            key={r.itemId}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(r.itemId)}
              onChange={() => toggleId(r.itemId)}
              className="w-4 h-4 rounded accent-indigo-600 cursor-pointer flex-shrink-0"
            />
            <span className={`text-xs font-medium border rounded-full px-2 py-0.5 flex-shrink-0 ${STATUS_COLORS[r.status] ?? ""}`}>
              <StatusText status={r.status} />
            </span>
            <span className="text-sm text-gray-700 truncate">{r.title}</span>
          </label>
        ))}
      </div>

      {/* Target selector + generate button */}
      <div className="flex items-center gap-3">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as FixBriefTarget)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="both">{t.fixBrief.targetBoth}</option>
          <option value="claude_code">{t.fixBrief.targetClaude}</option>
          <option value="codex">{t.fixBrief.targetCodex}</option>
        </select>
        <button
          onClick={handleGenerate}
          disabled={selectedIds.size === 0 || phase === "loading"}
          className="text-sm px-4 py-2 rounded-xl font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          {phase === "loading" ? t.fixBrief.generating : t.fixBrief.generate}
        </button>
      </div>

      {/* Error */}
      {phase === "error" && result && !result.ok && (
        <p className="text-xs text-red-500">{result.error}</p>
      )}

      {/* Result */}
      {phase === "done" && result && result.ok && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-800">
              {result.brief.files.length}{t.fixBrief.filesGenerated}
            </p>
            <div className="flex items-center gap-2">
              {copyMsg && (
                <span className="text-xs text-green-600">{t.fixBrief.copied} {copyMsg}</span>
              )}
              <button
                onClick={handleZip}
                className="text-sm px-3 py-1.5 rounded-lg font-medium border border-gray-200 text-gray-700 hover:bg-white transition-colors"
              >
                {t.fixBrief.downloadZip}
              </button>
            </div>
          </div>

          {/* File list */}
          <div className="space-y-1">
            {result.brief.files.map((f) => (
              <div key={f.path} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                <button
                  onClick={() => setPreviewFile(previewFile === f.path ? null : f.path)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-xs font-mono text-indigo-700 flex-1 truncate">{f.path}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopy(f); }}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded border border-gray-200 bg-white flex-shrink-0"
                  >
                    {t.fixBrief.copy}
                  </button>
                  <span className="text-gray-400 text-xs flex-shrink-0">
                    {previewFile === f.path ? "▲" : "▼"}
                  </span>
                </button>
                {previewFile === f.path && (
                  <div className="border-t border-gray-100 px-3 py-3 max-h-64 overflow-y-auto">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                      {f.content}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400">{t.fixBrief.usageNote}</p>
        </div>
      )}
    </div>
  );
}

// ─── ReviewResultPanel ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  passed: "text-green-700 bg-green-50 border-green-200",
  failed: "text-red-700 bg-red-50 border-red-200",
  inconclusive: "text-yellow-700 bg-yellow-50 border-yellow-200",
  needs_decision: "text-purple-700 bg-purple-50 border-purple-200",
  error: "text-gray-600 bg-gray-50 border-gray-200",
};

function runStatusText(t: Dictionary, status: string): string {
  if (status === "error") return t.runStatus.error;
  if (status === "queued") return t.runStatus.queued;
  if (status === "running") return t.runStatus.running;
  return statusLabel(t, status);
}

function ReviewResultPanel({ run, onRerun }: { run: ReviewRun; onRerun: () => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const runLabel = runStatusText(t, run.status);
  const statusColor = STATUS_COLORS[run.status] ?? "text-gray-600 bg-gray-50 border-gray-200";

  return (
    <div className="space-y-3">
      {/* Result header */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${statusColor}`}>
          {t.review.resultLabel}: {runLabel}
        </span>
        {run.summary && (
          <span className="text-xs text-gray-400">
            {statusLabel(t, "passed")} {run.summary.passed} · {statusLabel(t, "failed")} {run.summary.failed} · {statusLabel(t, "inconclusive")} {run.summary.inconclusive}
            {run.summary.needsDecision > 0 && ` · ${statusLabel(t, "needs_decision")} ${run.summary.needsDecision}`}
          </span>
        )}
        <button
          onClick={onRerun}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
        >
          {t.review.recheck}
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400">{t.review.basisNote}</p>
      <p className="text-xs text-gray-400">{t.review.verifyLiveNote}</p>

      {/* Error */}
      {run.status === "error" && run.errorMessage && (
        <p className="text-xs text-red-500">{run.errorMessage}</p>
      )}

      {/* Per-item results */}
      {run.results && run.results.length > 0 && (
        <div className="space-y-2">
          {run.results.map((r) => (
            <div
              key={r.itemId}
              className="border border-gray-100 rounded-lg overflow-hidden"
            >
              <button
                onClick={() => setExpanded(expanded === r.itemId ? null : r.itemId)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors"
              >
                <span className={`text-xs font-medium border rounded-full px-2 py-0.5 flex-shrink-0 ${STATUS_COLORS[r.status] ?? ""}`}>
                  <StatusText status={r.status} />
                </span>
                <span className="text-sm text-gray-800 flex-1 truncate">{r.title}</span>
                <span className="text-gray-400 text-xs flex-shrink-0">{expanded === r.itemId ? "▲" : "▼"}</span>
              </button>
              {expanded === r.itemId && (
                <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
                  <p className="text-xs text-gray-700">{r.reason}</p>
                  {r.evidence.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">{t.review.evidenceLabel}</p>
                      <ul className="space-y-0.5">
                        {r.evidence.map((e, i) => (
                          <li key={i} className="text-xs text-gray-600 font-mono bg-gray-50 rounded px-2 py-0.5 truncate">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r.nextAction && (
                    <p className="text-xs text-indigo-700 bg-indigo-50 rounded px-2 py-1.5">
                      {t.review.nextLabel}: {r.nextAction}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Credit Dry-Run Banner ────────────────────────────────────────────────────

function CreditDryRunBanner({ t, dryRun, projectId }: { t: Dictionary; dryRun: CreditEnforcementResult | CreditEnforcementDryRun; projectId?: string }) {
  if (dryRun.billingStatus === "included" || dryRun.billingStatus === "ignored") return null;

  const covered = dryRun.allowance?.coveredByAllowance === true;
  const enforcement = dryRun as CreditEnforcementResult;
  const blocked = enforcement.actualDebitsEnabled === true && enforcement.blocked === true;

  // Product-friendly: hide internal billing flags (dry-run, rollout, debit ledger).
  // During beta actual debits are off, so the common case is "charging disabled".
  const border = blocked ? "border-red-200 bg-red-50" : covered ? "border-green-100 bg-green-50" : "border-slate-200 bg-slate-50";
  const textColor = blocked ? "text-red-700" : covered ? "text-green-700" : "text-slate-700";
  const headerLabel = blocked ? t.credit.blocked : covered ? t.credit.includedInAllowance : t.credit.estimated;
  const message = blocked ? t.credit.blocked : covered ? t.credit.includedInAllowance : t.credit.disabledBeta;

  return (
    <div className={`mt-3 rounded-lg border px-4 py-3 ${border}`}>
      <p className={`mb-1 text-xs font-semibold ${textColor}`}>{headerLabel}</p>
      <p className="text-xs text-gray-500">{message}</p>
      {dryRun.allowance && (
        <p className="mt-1 text-xs text-gray-500">
          {t.credit.thisMonth}: {dryRun.allowance.usedThisPeriod} / {dryRun.allowance.includedRuns}
          {dryRun.allowance.coveredByAllowance ? ` · ${dryRun.allowance.remainingIncludedRuns} ${t.credit.freeRunsLeft}` : ""}
        </p>
      )}
      {projectId && (
        <div className="mt-2 flex gap-3">
          <Link href={`/projects/${projectId}/credits`} className="text-xs text-brand-700 hover:underline">
            {t.credit.viewBalance} →
          </Link>
          {(blocked || dryRun.wouldBlock) && (
            <Link href={`/projects/${projectId}/credits`} className="text-xs font-medium text-amber-700 hover:underline">
              {t.credit.requestTopUp} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

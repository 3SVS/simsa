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
      // HTTP 402: store enforcement info so CreditDryRunBanner can show "차단됨"
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
                        <span className="flex-shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">open</span>
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
                  {linkPhase === "saving" ? t.telegram.saving : t.github.saveLink}
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
                          {lp.state}
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
                              <CreditDryRunBanner dryRun={creditDryRunByPr[lp.number]!} projectId={id} />
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
                              <CreditDryRunBanner dryRun={creditDryRunByPr[lp.number]!} projectId={id} />
                            )}
                            <div className="mt-4 pt-4 border-t border-gray-100">
                              <ComparisonPanel
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

const STATUS_KO_COMPARE: Record<string, string> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
};

function ComparisonPanel({
  projectId,
  prNumber,
  userKey,
  onLoad,
}: {
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
      <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
        한 번 더 PR을 확인하면 이전 결과와 비교할 수 있어요.
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
        <p className="text-sm font-semibold text-gray-800 mb-0.5">비교 결과</p>
        <p className="text-xs text-gray-400">
          수정 후 다시 확인한 결과를 이전 결과와 비교했어요.
          이 비교는 연결된 PR의 변경 내용 기준입니다.
        </p>
      </div>

      {/* Summary delta */}
      <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 space-y-1.5 text-xs">
        <div className="flex gap-2 items-center">
          <span className="text-gray-500 w-16">안 맞음</span>
          <DeltaBadge prev={prevSumm.failed} latest={latSumm.failed} />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-gray-500 w-16">확인 부족</span>
          <DeltaBadge prev={prevSumm.inconclusive} latest={latSumm.inconclusive} />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-gray-500 w-16">결정 필요</span>
          <DeltaBadge prev={prevSumm.needsDecision} latest={latSumm.needsDecision} />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-gray-500 w-16">통과</span>
          <DeltaBadge prev={prevSumm.passed} latest={latSumm.passed} />
        </div>
      </div>

      {/* Improved items */}
      {comparison.improved.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-green-700">✅ 좋아진 항목 ({comparison.improved.length})</p>
          {comparison.improved.map((item) => (
            <div key={item.itemId} className="bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-green-800">{item.title}</span>
                <span className="text-xs text-green-600">{STATUS_KO_COMPARE[item.from] ?? item.from} → {STATUS_KO_COMPARE[item.to] ?? item.to}</span>
              </div>
              <p className="text-xs text-green-700">{item.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Still open items */}
      {comparison.stillOpen.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-amber-700">⚠️ 아직 남은 항목 ({comparison.stillOpen.length})</p>
          {comparison.stillOpen.map((item) => (
            <div key={item.itemId} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-amber-800">{item.title}</span>
                <span className="text-xs text-amber-600">{STATUS_KO_COMPARE[item.status] ?? item.status}</span>
              </div>
              <p className="text-xs text-amber-700">{item.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Newly problematic */}
      {comparison.newlyProblematic.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-red-700">🔴 새로 생긴 문제 ({comparison.newlyProblematic.length})</p>
          {comparison.newlyProblematic.map((item) => (
            <div key={item.itemId} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-red-800">{item.title}</span>
                <span className="text-xs text-red-600">{STATUS_KO_COMPARE[item.from] ?? item.from} → {STATUS_KO_COMPARE[item.to] ?? item.to}</span>
              </div>
              <p className="text-xs text-red-700">{item.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Unchanged */}
      {comparison.unchanged.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">변화 없음 ({comparison.unchanged.length})</p>
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
    });
    if (res.ok) {
      setPreviewBody(res.comment.body);
      setPreviewPhase("done");
    } else {
      setPreviewPhase("error");
      setErrorMsg(res.message ?? res.error ?? "미리보기 생성 실패");
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
      setErrorMsg(res.message ?? res.error ?? "코멘트 작성 실패");
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
        <p className="text-sm font-semibold text-gray-800 mb-0.5">PR에 코멘트 남기기</p>
        <p className="text-xs text-gray-400">
          확인 결과를 GitHub PR에 코멘트로 남길 수 있어요.
          이 단계에서는 코드를 자동으로 고치지 않습니다.
        </p>
      </div>

      <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
        현재는 공개 저장소 PR에만 코멘트를 남길 수 있어요.
      </p>

      {/* Comparison inclusion option */}
      <div>
        <p className="text-xs text-gray-500 mb-1.5">
          수정 후 다시 확인한 결과가 있으면, 코멘트에 이전보다 좋아진 점과 아직 남은 항목을 함께 넣을 수 있어요.
        </p>
        <label className={`flex items-center gap-2 cursor-pointer ${comparable ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={includeComparison}
            disabled={!comparable}
            onChange={(e) => setIncludeComparison(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600"
          />
          <span className="text-xs text-gray-700">이전/최신 비교 포함</span>
        </label>
        {!comparable && (
          <p className="text-xs text-gray-400 mt-1 ml-6">한 번 더 PR을 확인하면 비교를 포함할 수 있어요.</p>
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
              {m === "new" ? "새 코멘트 작성" : "기존 코멘트 업데이트"}
            </label>
          ))}
        </div>
      )}

      {/* Item selection */}
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
          {previewPhase === "loading" ? "미리보기 생성 중..." : "코멘트 미리보기"}
        </button>
        {previewBody && postPhase !== "done" && (
          <button
            onClick={handlePost}
            disabled={postPhase === "loading"}
            className="text-sm px-4 py-2 rounded-xl font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {postPhase === "loading"
              ? "GitHub에 남기는 중..."
              : mode === "update_latest" && hasExistingComment
                ? "기존 코멘트 업데이트"
                : "GitHub에 남기기"}
          </button>
        )}
      </div>

      {/* Scope error */}
      {scopeError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 space-y-1">
          <p>GitHub 권한이 부족하거나 접근할 수 없는 저장소예요.</p>
          <p className="text-xs">공개 저장소인지 확인하거나 GitHub 권한을 다시 연결해주세요.</p>
          <Link
            href={`/projects/${projectId}/settings`}
            className="inline-block mt-1 text-xs font-medium text-amber-700 underline"
          >
            권한 다시 연결 →
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
              {postWasUpdate ? "코멘트가 업데이트됐어요!" : "코멘트가 작성됐어요!"}
            </p>
            <a
              href={postedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-700 font-medium underline hover:text-green-900 ml-3 flex-shrink-0"
            >
              GitHub에서 보기 →
            </a>
          </div>
          <button
            onClick={handleRecheck}
            className="text-xs text-green-700 underline hover:text-green-900"
          >
            다시 PR 확인하기
          </button>
        </div>
      )}

      {/* Preview body */}
      {previewBody && previewPhase === "done" && postPhase !== "done" && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">코멘트 미리보기</p>
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
        이전에 남긴 코멘트 보기
      </button>

      {pastLoaded && pastComments.length > 0 && (
        <div className="space-y-1.5">
          {latestPosted && (
            <p className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
              가장 최근 코멘트: {latestPosted.updatedAt.slice(0, 10)}{" "}
              {latestPosted.githubCommentUrl && (
                <a href={latestPosted.githubCommentUrl} target="_blank" rel="noopener noreferrer" className="underline">GitHub에서 보기</a>
              )}
            </p>
          )}
          {pastComments.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs text-gray-500">
              <span className={`rounded-full px-2 py-0.5 border flex-shrink-0 ${
                c.status === "posted" ? "text-green-600 bg-green-50 border-green-200" :
                c.status === "error" ? "text-red-600 bg-red-50 border-red-200" :
                "text-gray-500 bg-gray-100 border-gray-200"
              }`}>{c.status === "posted" ? "작성됨" : c.status === "error" ? "실패" : c.status}</span>
              <span className="truncate flex-1">{c.bodyPreview}</span>
              {c.githubCommentUrl && (
                <a href={c.githubCommentUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-indigo-500 hover:underline">보기</a>
              )}
            </div>
          ))}
        </div>
      )}

      {pastLoaded && pastComments.length === 0 && (
        <p className="text-xs text-gray-400">이전에 남긴 코멘트가 없어요.</p>
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
        <p className="text-sm font-semibold text-gray-800 mb-0.5">수정 지시서 만들기</p>
        <p className="text-xs text-gray-400">
          확인 결과에서 문제가 있는 항목을 선택하면, Claude Code나 Codex에게 넘길 수정 지시서를 만들 수 있어요.
        </p>
      </div>

      {/* Item checkboxes */}
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
          <option value="both">Claude Code + Codex</option>
          <option value="claude_code">Claude Code 전용</option>
          <option value="codex">Codex 전용</option>
        </select>
        <button
          onClick={handleGenerate}
          disabled={selectedIds.size === 0 || phase === "loading"}
          className="text-sm px-4 py-2 rounded-xl font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          {phase === "loading" ? "만드는 중..." : "수정 지시서 만들기"}
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
              {result.brief.files.length}개 파일 생성됨
            </p>
            <div className="flex items-center gap-2">
              {copyMsg && (
                <span className="text-xs text-green-600">복사됨: {copyMsg}</span>
              )}
              <button
                onClick={handleZip}
                className="text-sm px-3 py-1.5 rounded-lg font-medium border border-gray-200 text-gray-700 hover:bg-white transition-colors"
              >
                ZIP 다운로드
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
                    복사
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

          <p className="text-xs text-gray-400">
            ZIP을 다운받아 저장소 루트에 압축 해제하면 Claude Code나 Codex에서 바로 사용할 수 있어요.
          </p>
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

const RUN_STATUS_LABEL: Record<string, string> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  error: "확인 실패",
  queued: "대기 중",
  running: "확인 중",
};

function ReviewResultPanel({ run, onRerun }: { run: ReviewRun; onRerun: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const statusLabel = RUN_STATUS_LABEL[run.status] ?? run.status;
  const statusColor = STATUS_COLORS[run.status] ?? "text-gray-600 bg-gray-50 border-gray-200";

  return (
    <div className="space-y-3">
      {/* Result header */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${statusColor}`}>
          확인 결과: {statusLabel}
        </span>
        {run.summary && (
          <span className="text-xs text-gray-400">
            통과 {run.summary.passed} · 안 맞음 {run.summary.failed} · 확인 부족 {run.summary.inconclusive}
            {run.summary.needsDecision > 0 && ` · 결정 필요 ${run.summary.needsDecision}`}
          </span>
        )}
        <button
          onClick={onRerun}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
        >
          다시 확인
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400">
        이 결과는 연결된 PR의 변경 내용 기준입니다. 전체 저장소나 배포된 서비스 전체를 확인한 것은 아니에요.
      </p>

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
                      <p className="text-xs text-gray-400 mb-1">코드에서 확인된 내용</p>
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
                      다음: {r.nextAction}
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

function CreditDryRunBanner({ dryRun, projectId }: { dryRun: CreditEnforcementResult | CreditEnforcementDryRun; projectId?: string }) {
  if (dryRun.billingStatus === "included" || dryRun.billingStatus === "ignored") return null;

  const covered = dryRun.allowance?.coveredByAllowance === true;
  const isWouldBlock = dryRun.wouldBlock;
  const enforcement = dryRun as CreditEnforcementResult;
  const actualDebitsEnabled = enforcement.actualDebitsEnabled === true;

  // Stage 31 — allowlist rollout status
  const rolloutReason = enforcement.rollout?.reason;
  const notAllowlisted = actualDebitsEnabled && rolloutReason === "not_allowlisted";
  const allowlisted = actualDebitsEnabled && rolloutReason === "allowlisted";

  // Stage 26 — debit shape uses attempted/applied/duplicate instead of ok
  const debitOk =
    actualDebitsEnabled &&
    allowlisted &&
    enforcement.debit?.attempted === true &&
    enforcement.debit?.applied === true &&
    !enforcement.debit?.duplicate;
  const debitDuplicate =
    actualDebitsEnabled && allowlisted && enforcement.debit?.duplicate === true;
  const debitFailed =
    actualDebitsEnabled &&
    allowlisted &&
    enforcement.debit?.attempted === true &&
    enforcement.debit?.applied === false &&
    !enforcement.debit?.duplicate;
  const blocked = actualDebitsEnabled && enforcement.blocked === true;
  const insufficientButAllowed = actualDebitsEnabled && allowlisted && isWouldBlock && !blocked;

  const borderColor = blocked
    ? "border-red-200 bg-red-50"
    : debitFailed || insufficientButAllowed
    ? "border-amber-200 bg-amber-50"
    : debitOk || debitDuplicate
    ? "border-indigo-100 bg-indigo-50"
    : covered
    ? "border-green-100 bg-green-50"
    : "border-blue-100 bg-blue-50";
  const textColor = blocked
    ? "text-red-700"
    : debitFailed || insufficientButAllowed
    ? "text-amber-700"
    : debitOk || debitDuplicate
    ? "text-indigo-700"
    : covered
    ? "text-green-700"
    : "text-blue-700";
  const labelColor = blocked
    ? "text-red-600"
    : debitFailed || insufficientButAllowed
    ? "text-amber-600"
    : debitOk || debitDuplicate
    ? "text-indigo-600"
    : covered
    ? "text-green-600"
    : "text-blue-600";

  const headerLabel = blocked
    ? "credit 부족으로 실행이 차단됨"
    : debitDuplicate
    ? "이미 처리된 credit 차감 요청"
    : debitOk
    ? "credit 차감됨"
    : debitFailed
    ? "credit 차감 실패"
    : insufficientButAllowed
    ? "잔액 부족이지만 실행 허용"
    : covered
    ? "월 무료 제공량 안에 포함"
    : "예상 credit 확인";

  // Stage 31 — failed pending retry copy
  const debitFailedIsLedgerFailed =
    debitFailed && enforcement.debit?.ledgerStatus === "failed";

  const footerNote = blocked
    ? `현재 잔액: ${enforcement.currentBalance} review credit · 필요: ${enforcement.requiredCredits}`
    : actualDebitsEnabled
    ? (notAllowlisted
        ? "현재 계정은 실제 credit 차감 대상이 아니어서 dry-run으로만 확인됩니다."
        : debitDuplicate
        ? "이미 처리된 credit 차감 요청이라 추가 차감은 하지 않았어요."
        : debitOk
        ? `잔액: ${enforcement.debit?.newBalance ?? enforcement.remainingAfter} review credit${allowlisted ? " · 제한적 rollout 적용" : ""}`
        : debitFailedIsLedgerFailed
        ? "이전 credit 처리 요청이 실패 처리되었습니다. 새로 다시 실행해주세요."
        : debitFailed
        ? `차감 오류: ${enforcement.debit?.error ?? "알 수 없음"}`
        : insufficientButAllowed
        ? "잔액 부족 · 차감 없음 · 실행은 허용됨"
        : "실제 차감 활성화됨")
    : "실제 차감 없음 · 실행은 허용됨";

  return (
    <div className={`mt-3 border rounded-xl px-4 py-3 ${borderColor}`}>
      <p className={`text-xs font-semibold mb-1 ${textColor}`}>{headerLabel}</p>
      <p className={`text-xs ${labelColor}`}>{dryRun.message}</p>
      {dryRun.allowance && (
        <p className="text-xs text-gray-500 mt-1">
          이번 달 사용: {dryRun.allowance.usedThisPeriod} / {dryRun.allowance.includedRuns}회
          {dryRun.allowance.coveredByAllowance
            ? ` · 남은 무료 ${dryRun.allowance.remainingIncludedRuns}회`
            : ""}
        </p>
      )}
      {allowlisted && !debitOk && !debitFailed && !debitDuplicate && (
        <p className="text-xs text-blue-500 mt-1">현재 계정은 제한적 actual debit 테스트 대상입니다.</p>
      )}
      <p className="text-xs text-gray-400 mt-1">{footerNote}</p>
      {projectId && (
        <div className="mt-2 flex gap-3">
          <Link
            href={`/projects/${projectId}/credits`}
            className="text-xs text-blue-600 hover:underline"
          >
            Credit 잔액 보기 →
          </Link>
          {(blocked || dryRun.wouldBlock) && (
            <Link
              href={`/projects/${projectId}/credits`}
              className="text-xs text-amber-700 font-medium hover:underline"
            >
              Credit 충전 요청 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

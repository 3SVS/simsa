"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, loadExtendedProjectData, getUserKey, saveProject, saveExtendedProjectData, markProjectSyncFailed, applyReviewResultsToLocalProject } from "@/lib/workflow-store";
import { callWorkspaceApi } from "@/lib/workspace-api";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import {
  fetchProjectRepo,
  fetchProjectPulls,
  fetchLinkedPulls,
  linkPullRequest,
  startPRReview,
  getLatestPRReview,
  type GitHubPull,
  type LinkedPull,
  type LinkedRepo,
  type ReviewRun,
  type CreditEnforcementDryRun,
  type CreditEnforcementResult,
} from "@/lib/workspace-github-api";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusText } from "@/components/StatusText";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import { errorText } from "@/i18n/error-text.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";
import type { ItemStatus } from "@/lib/labels";
import { LoginSavePrompt } from "@/components/LoginSavePrompt";
import { SimsaStampThinking } from "@/components/SimsaStampThinking";

export default function GitHubPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [loadPhase, setLoadPhase] = useState<"loading" | "no_repo" | "load_error" | "ready">("loading");
  const [repo, setRepo] = useState<LinkedRepo | null>(null);
  const [pulls, setPulls] = useState<GitHubPull[]>([]);
  const [pullsPhase, setPullsPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pullsError, setPullsError] = useState("");
  const [linkedPulls, setLinkedPulls] = useState<LinkedPull[]>([]);
  const [linkedLoadFailed, setLinkedLoadFailed] = useState(false);
  const [selectedPR, setSelectedPR] = useState<GitHubPull | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [linkPhase, setLinkPhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  // Code-branch rescue: a project created without checking items (the one-line
  // description is optional on the code branch) dead-ends at PR linking — the
  // picker is empty and save stays disabled. This inline generator drafts the
  // items right here from a one-liner, reusing the same idea-to-spec API as
  // project creation. Nothing else on this page changes when items exist.
  const [quickIdea, setQuickIdea] = useState("");
  const [genPhase, setGenPhase] = useState<"idle" | "loading">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [, forceItemsRefresh] = useState(0);
  // Review state: keyed by prNumber
  const [reviewRuns, setReviewRuns] = useState<Record<number, ReviewRun>>({});
  const [reviewPhase, setReviewPhase] = useState<Record<number, "idle" | "running" | "done" | "error">>({});
  // Credit dry-run result: keyed by prNumber (populated after each review run)
  const [creditDryRunByPr, setCreditDryRunByPr] = useState<Record<number, CreditEnforcementResult | CreditEnforcementDryRun>>({});
  // Specific review-failure message per PR (rate limit / credits / network…).
  const [reviewErrorByPr, setReviewErrorByPr] = useState<Record<number, string>>({});
  // "✓ finished" flash for runs completed in THIS session (visible completion signal).
  const [justCompletedByPr, setJustCompletedByPr] = useState<Record<number, boolean>>({});

  const ext = loadExtendedProjectData(id);
  const checkResultMap = new Map(
    (ext?.checkResults?.results ?? []).map((r) => [r.itemId, r.status as ItemStatus]),
  );
  const allItems = (project?.requirements ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    checkStatus: checkResultMap.get(r.id) ?? (r.status as ItemStatus),
  }));

  async function handleGenerateItems() {
    if (!project || !quickIdea.trim() || genPhase === "loading") return;
    setGenPhase("loading");
    setGenError(null);
    const res = await callWorkspaceApi({ idea: quickIdea.trim() });
    if (!res.ok && res.error === "rate_limited") {
      setGenError(t.common.rateLimited);
      setGenPhase("idle");
      return;
    }
    if (!res.ok) {
      setGenError(t.errors.llmUnavailable);
      setGenPhase("idle");
      return;
    }
    const generated = res.data;
    if (!generated?.items?.length) {
      setGenError(t.github.generateItemsError);
      setGenPhase("idle");
      return;
    }
    saveProject({
      ...project,
      requirements: generated.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: "not_started" as const,
        category: "feature",
        priority: "must" as const,
      })),
    });
    saveExtendedProjectData(id, {
      productSpec: generated.productSpec,
      itemCriteria: Object.fromEntries(generated.items.map((i) => [i.id, i.criteria ?? []])),
    });
    // builtWith / entryPath intentionally omitted — the server upsert keeps the
    // stored capture-once values (sticky), so this save can't wipe them.
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: project.name,
      idea: quickIdea.trim(),
      understood: generated.understood ?? {},
      productSpec: generated.productSpec,
      items: generated.items,
    }).then((res) => { if (!res || res.ok !== true) markProjectSyncFailed(id); }).catch(() => markProjectSyncFailed(id));
    setGenPhase("idle");
    forceItemsRefresh((v) => v + 1); // re-read getLocalProject → picker appears
  }

  /** Poll the latest run until it leaves "running"; returns true when it lands. */
  async function pollRunUntilDone(prNumber: number, attempts: number): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const latest = await getLatestPRReview(id, prNumber, getUserKey()).catch(() => null);
      if (latest?.ok && latest.run && latest.run.status !== "running") {
        setReviewRuns((prev) => ({ ...prev, [prNumber]: latest.run! }));
        setReviewPhase((prev) => ({ ...prev, [prNumber]: "done" }));
        setJustCompletedByPr((prev) => ({ ...prev, [prNumber]: true }));
        if (latest.run.results) applyReviewResultsToLocalProject(id, latest.run.results);
        return true;
      }
    }
    return false;
  }

  const loadInitial = useCallback(async () => {
    setLoadPhase("loading");
    const [repoRes, linkedRes] = await Promise.all([
      fetchProjectRepo(id, getUserKey()),
      fetchLinkedPulls(id, getUserKey()),
    ]);
    if (repoRes.ok && repoRes.repo) {
      setRepo(repoRes.repo);
      setLoadPhase("ready");
    } else if (repoRes.ok) {
      // Confirmed: genuinely no repo linked.
      setLoadPhase("no_repo");
    } else {
      // Transient fetch failure ≠ "not connected" — a user WITH a linked repo
      // must not be sent to settings to "connect" what is already connected.
      setLoadPhase("load_error");
    }
    setLinkedLoadFailed(!linkedRes.ok);
    if (linkedRes.ok) {
      setLinkedPulls(linkedRes.pulls);
      // Load any existing review runs for linked PRs
      for (const lp of linkedRes.pulls) {
        const reviewRes = await getLatestPRReview(id, lp.number, getUserKey());
        if (reviewRes.ok && reviewRes.run) {
          setReviewRuns((prev) => ({ ...prev, [lp.number]: reviewRes.run! }));
          if (reviewRes.run.status !== "running" && reviewRes.run.results) {
            applyReviewResultsToLocalProject(id, reviewRes.run.results);
          }
          if (reviewRes.run.status === "running") {
            // A review is still executing server-side (user navigated away and
            // came back) — resume the running view and keep polling instead of
            // showing the idle "run review" button again.
            setReviewPhase((prev) => ({ ...prev, [lp.number]: "running" }));
            void pollRunUntilDone(lp.number, 18).then((landed) => {
              if (!landed) {
                setReviewErrorByPr((prev) => ({ ...prev, [lp.number]: t.github.reviewFailed }));
                setReviewPhase((prev) => ({ ...prev, [lp.number]: "error" }));
              }
            });
          } else {
            setReviewPhase((prev) => ({ ...prev, [lp.number]: "done" }));
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Double-click guard: two clicks in the same tick would start two runs.
    if (reviewPhase[lp.number] === "running") return;
    setReviewPhase((prev) => ({ ...prev, [lp.number]: "running" }));
    setReviewErrorByPr((prev) => ({ ...prev, [lp.number]: "" }));
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
      locale,
    });
    if (res.ok) {
      setReviewRuns((prev) => ({ ...prev, [lp.number]: res.run }));
      setReviewPhase((prev) => ({ ...prev, [lp.number]: "done" }));
      setJustCompletedByPr((prev) => ({ ...prev, [lp.number]: true }));
      if (res.run.results) applyReviewResultsToLocalProject(id, res.run.results);
      if (res.creditEnforcement) {
        setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditEnforcement! }));
      } else if (res.creditDryRun) {
        setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditDryRun! }));
      }
      return;
    }
    // HTTP 402: store enforcement info so CreditDryRunBanner can show the blocked state
    if (res.error === "insufficient_credits" && res.creditEnforcement) {
      setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditEnforcement! }));
      setReviewPhase((prev) => ({ ...prev, [lp.number]: "error" }));
      return;
    }
    // A slow-but-healthy review looks identical to a network failure here (the
    // client request aborts at 40s while the server keeps working). Before
    // declaring failure, poll the latest run for up to ~60s — if it lands, show
    // the result instead of a false "review failed". Only poll on transport-ish
    // failures; explicit server verdicts (rate limit, credits…) are final.
    const finalServerCodes = new Set([
      "rate_limited", "insufficient_credits", "no_repo_linked", "not_connected",
      "no_selected_items", "not_found", "invalid_json", "userKey_required",
    ]);
    if (!finalServerCodes.has(res.error)) {
      if (await pollRunUntilDone(lp.number, 6)) return;
    }
    // Real failure — show a SPECIFIC message (rate_limited → daily-cap copy,
    // not the generic "check your PR on GitHub" misdirection).
    setReviewErrorByPr((prev) => ({ ...prev, [lp.number]: errorText(t, res.error, "generic") }));
    setReviewPhase((prev) => ({ ...prev, [lp.number]: "error" }));
  }

  if (!project) return <ProjectNotFound />;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">{t.nav.github}</h1>
          <p className="page-subtitle">{t.review.basisNote}</p>
        </div>
        <Link
          href={`/projects/${id}/github/history`}
          className="mt-1 flex-shrink-0 text-xs font-medium text-gray-500 hover:text-brand-700"
        >
          {t.github.viewHistory} →
        </Link>
      </div>

      {/* Loading */}
      {loadPhase === "loading" && (
        <div className="card p-6 text-center">
          <div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <p className="text-sm text-gray-500">{t.github.checkingConnection}</p>
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

      {/* Transient load failure — retry, don't misdirect to settings */}
      {loadPhase === "load_error" && (
        <div className="card p-8 text-center">
          <p className="mb-4 text-sm text-gray-600">{t.github.connectionLoadError}</p>
          <button onClick={() => void loadInitial()} className="btn btn-md btn-primary">
            {t.common.retry}
          </button>
        </div>
      )}

      {/* Ready */}
      {loadPhase === "ready" && repo && (
        <>
          {/* Repo info */}
          <div className="card flex items-center justify-between p-4">
            <div>
              <p className="mb-0.5 text-xs text-gray-500">{t.github.connectedRepo}</p>
              <a
                href={repo.htmlUrl ?? `https://github.com/${repo.fullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm font-medium text-brand-700 hover:underline"
              >
                {repo.fullName}
              </a>
              {repo.defaultBranch && <span className="ml-2 text-xs text-gray-500">→ {repo.defaultBranch}</span>}
            </div>
            <button onClick={handleLoadPulls} disabled={pullsPhase === "loading"} className="btn btn-md btn-primary">
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
                        <span className="mt-0.5 flex-shrink-0 font-mono text-xs text-gray-500">#{pull.number}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-800">{pull.title}</p>
                          <p className="mt-0.5 font-mono text-xs text-gray-500">
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
              <p className="mb-4 text-xs text-gray-500">
                {t.github.selectItemsForPr} ({selectedItemIds.size} {t.github.selected})
              </p>
              {allItems.length === 0 ? (
                <div className="mb-4 rounded-lg bg-gray-50 p-4">
                  <p className="text-sm font-medium text-gray-700">{t.github.noItemsYet}</p>
                  <p className="mt-1 text-xs text-gray-500">{t.github.noItemsHint}</p>
                  <textarea
                    value={quickIdea}
                    onChange={(e) => setQuickIdea(e.target.value)}
                    rows={2}
                    placeholder={t.github.noItemsIdeaPlaceholder}
                    className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={handleGenerateItems}
                      disabled={!quickIdea.trim() || genPhase === "loading"}
                      className="btn btn-md btn-primary"
                    >
                      {genPhase === "loading" ? t.github.generatingItems : t.github.generateItems}
                    </button>
                    {genError && <span className="text-sm text-red-500">{genError}</span>}
                  </div>
                </div>
              ) : (
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
              )}
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

          {linkedLoadFailed && (
            <div className="callout callout-error flex items-center justify-between">
              <span>{t.errors.loadFailed}</span>
              <button onClick={() => void loadInitial()} className="btn btn-sm btn-secondary">{t.common.retry}</button>
            </div>
          )}

          {/* Link success — rendered here because handleLink clears selectedPR */}
          {linkPhase === "done" && (
            <p className="text-sm text-green-600">✓ {t.github.linked}</p>
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
                        <span className="text-xs text-gray-500 font-mono mt-0.5">#{lp.number}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{lp.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{lp.repoFullName}</p>
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
                            <p className="text-xs text-gray-500">{t.github.notReviewedYet}</p>
                            <button onClick={() => handleStartReview(lp)} className="btn btn-md btn-primary">
                              {t.github.runReviewBtn}
                            </button>
                          </div>
                        )}

                        {phase === "running" && (
                          <div className="space-y-1">
                            <SimsaStampThinking variant="panel" label={t.github.reviewing} />
                            <p className="text-xs text-gray-500">{t.github.reviewingHint}</p>
                          </div>
                        )}

                        {phase === "error" && (
                          <div className="space-y-2">
                            {creditDryRunByPr[lp.number] && (creditDryRunByPr[lp.number] as CreditEnforcementResult).blocked ? (
                              <CreditDryRunBanner t={t} dryRun={creditDryRunByPr[lp.number]!} projectId={id} />
                            ) : (
                              <p className="text-xs text-red-600">{reviewErrorByPr[lp.number] || t.github.reviewFailed}</p>
                            )}
                            <button onClick={() => handleStartReview(lp)} className="btn btn-sm btn-secondary">
                              {t.common.retry}
                            </button>
                          </div>
                        )}

                        {phase === "done" && run && (
                          <>
                            {justCompletedByPr[lp.number] && (
                              <p className="mb-2 text-sm font-medium text-green-600">✓ {t.github.reviewDone}</p>
                            )}
                            <ReviewResultPanel run={run} onRerun={() => handleStartReview(lp)} />
                            {creditDryRunByPr[lp.number] && (
                              <CreditDryRunBanner t={t} dryRun={creditDryRunByPr[lp.number]!} projectId={id} />
                            )}
                            {/* This tab ends at the result. Follow-up actions
                                (fix instructions / PR comment / comparison) live on
                                the run-detail page — non-developers were bouncing
                                off a screen that carried every form at once. */}
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              <Link href={`/projects/${id}/github/history/${run.id}`} className="btn btn-md btn-primary">
                                {t.github.viewResultDetail} →
                              </Link>
                              <Link href={`/projects/${id}/github/history`} className="text-sm text-gray-500 hover:text-gray-700">
                                {t.github.viewHistory} →
                              </Link>
                            </div>
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
          <span className="text-xs text-gray-500">
            {statusLabel(t, "passed")} {run.summary.passed} · {statusLabel(t, "failed")} {run.summary.failed} · {statusLabel(t, "inconclusive")} {run.summary.inconclusive}
            {run.summary.needsDecision > 0 && ` · ${statusLabel(t, "needs_decision")} ${run.summary.needsDecision}`}
          </span>
        )}
        <button
          onClick={onRerun}
          className="ml-auto text-xs text-gray-500 hover:text-gray-600 underline"
        >
          {t.review.recheck}
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-500">{t.review.verifyLiveNote}</p>

      {/* Error */}
      {run.status === "error" && run.errorMessage && (
        <p className="text-xs text-red-500">{run.errorMessage}</p>
      )}

      {/* Value-moment login promotion: first results are in — offer to save. */}
      {run.results && run.results.length > 0 && <LoginSavePrompt hasResult={true} />}

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
                <span className="text-gray-500 text-xs flex-shrink-0">{expanded === r.itemId ? "▲" : "▼"}</span>
              </button>
              {expanded === r.itemId && (
                <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
                  <p className="text-xs text-gray-700">{r.reason}</p>
                  {r.evidence.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t.review.evidenceLabel}</p>
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

  // Beta: actual debits are OFF. The "이번 달 0/5 · 5회 무료 남음" counter is a
  // post-beta pricing SIMULATION and read like a real limit ("5번 무료?" — Bae).
  // While debits are off, say the one true thing and nothing else.
  if (enforcement.actualDebitsEnabled !== true) {
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-600">{t.credit.disabledBeta}</p>
      </div>
    );
  }

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

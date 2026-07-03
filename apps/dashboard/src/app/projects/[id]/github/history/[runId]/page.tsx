"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, loadExtendedProjectData, getUserKey } from "@/lib/workflow-store";
import {
  getReviewRunDetail,
  generatePRFixBrief,
  previewPRComment,
  postPRComment,
  startPRReview,
  type PRReviewRunDetail,
  type ReviewResultItem,
  type FixBriefResult,
  type SpecificRunComparison,
} from "@/lib/workspace-github-api";
import {
  recommendedRerunItemIds,
  allRerunItemIds,
  nonPassedRerunItemIds,
  toggleItemSelection,
  canRerun,
} from "@/lib/rerun-selection.mjs";
import {
  buildReviewSelectionStorageKey,
  readStoredReviewSelection,
  writeStoredReviewSelection,
} from "@/lib/review-selection-storage.mjs";
import type { StorageLike } from "@/lib/review-selection-storage.mjs";
import {
  compareReviewRunResults,
  pickComparisonSourceRunId,
  buildComparisonCommentInput,
} from "@/lib/review-run-comparison.mjs";
import type { ReviewRunComparison, ReviewRunComparisonItem } from "@/lib/review-run-comparison.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import { errorText } from "@/i18n/error-text.mjs";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

// Run status → label. statusLabel covers passed/failed/inconclusive/needs_decision;
// run-only states (error/running/queued) fall back to the runStatus namespace.
function statusText(t: Dictionary, status: string): string {
  if (status === "error") return t.runStatus.error;
  if (status === "running") return t.runStatus.running;
  if (status === "queued") return t.runStatus.queued;
  return statusLabel(t, status);
}

// Stage 44: localStorage, guarded for SSR / private-mode / blocked storage.
function getReviewSelectionStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  passed:        "text-green-700 bg-green-50 border-green-200",
  failed:        "text-red-700 bg-red-50 border-red-200",
  inconclusive:  "text-yellow-700 bg-yellow-50 border-yellow-200",
  needs_decision:"text-slate-700 bg-slate-50 border-slate-200",
  error:         "text-gray-600 bg-gray-50 border-gray-200",
  running:       "text-blue-700 bg-blue-50 border-blue-200",
  queued:        "text-gray-500 bg-gray-50 border-gray-200",
};

function badgeClass(status: string): string {
  return STATUS_BADGE[status] ?? "text-gray-500 bg-gray-50 border-gray-200";
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 flex-shrink-0 ${badgeClass(status)}`}>
      {statusText(t, status)}
    </span>
  );
}

function formatDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: PRReviewRunDetail["summary"] }) {
  const { t } = useI18n();
  const cards = [
    { label: statusLabel(t, "passed"),         value: summary.passed,        color: "text-green-600" },
    { label: statusLabel(t, "failed"),         value: summary.failed,        color: "text-red-600" },
    { label: statusLabel(t, "inconclusive"),   value: summary.inconclusive,  color: "text-yellow-600" },
    { label: statusLabel(t, "needs_decision"), value: summary.needsDecision, color: "text-slate-600" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Result item card ─────────────────────────────────────────────────────────

function ResultCard({ item }: { item: ReviewResultItem }) {
  const { t } = useI18n();
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start gap-3 mb-2">
        <span className={`text-xs font-medium border rounded-full px-2 py-0.5 flex-shrink-0 mt-0.5 ${badgeClass(item.status)}`}>
          {statusText(t, item.status)}
        </span>
        <p className="text-sm font-medium text-gray-800">{item.title}</p>
      </div>
      {item.reason && (
        <p className="text-xs text-gray-500 leading-relaxed mb-2">{item.reason}</p>
      )}
      {Array.isArray(item.evidence) && item.evidence.length > 0 && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
          <p className="text-xs font-medium text-gray-500 mb-1">{t.runDetail.evidence}</p>
          <ul className="space-y-0.5">
            {item.evidence.map((e, i) => (
              <li key={i} className="text-xs text-gray-500 flex gap-1.5">
                <span className="text-gray-300 mt-px">-</span> {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.status !== "passed" && item.nextAction && (
        <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2">
          <span className="font-medium">{t.runDetail.nextStep}:</span> {item.nextAction}
        </p>
      )}
    </div>
  );
}

// ─── Fix Pack Panel ───────────────────────────────────────────────────────────

function FixPackPanel({
  projectId, prNumber, runId, userKey, selectedItemIds, autoOpen,
}: {
  projectId: string;
  prNumber: number;
  runId: string;
  userKey: string;
  selectedItemIds: string[];
  autoOpen?: boolean;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<FixBriefResult | null>(null);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoFiredRef = useRef(false);

  const selectedCount = selectedItemIds.length;
  const enabled = selectedCount > 0;

  const generate = useCallback(async () => {
    if (selectedItemIds.length === 0) return;
    setPhase("loading");
    const ext = loadExtendedProjectData(projectId);
    const res = await generatePRFixBrief(projectId, prNumber, {
      userKey,
      reviewRunId: runId,
      // Stage 43: use the shared selectedItemIds (same as run detail's selection panel).
      selectedItemIds,
      productSpec: ext?.productSpec,
      items: undefined,
    });
    if (!res.ok) { setPhase("error"); return; }
    setResult(res);
    setPhase("done");
  }, [projectId, prNumber, runId, userKey, selectedItemIds]);

  // Stage 42/43: when arrived via the "Fix Pack for remaining issues" quick action (?action=fix-pack), scroll
  // into view and auto-generate once — using the shared selection.
  useEffect(() => {
    if (!autoOpen || autoFiredRef.current || selectedItemIds.length === 0) return;
    autoFiredRef.current = true;
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    void generate();
  }, [autoOpen, generate, selectedItemIds.length]);

  if (phase === "idle") {
    return (
      <div ref={containerRef}>
        <button
          onClick={generate}
          disabled={!enabled}
          className="w-full bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t.runDetail.fpCreate}{enabled ? ` (${selectedCount})` : ""}
        </button>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div ref={containerRef} className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        {t.runDetail.fpCreating}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div ref={containerRef} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
        <span>{t.runDetail.fpError}</span>
        <button onClick={generate} className="text-xs text-red-600 underline">{t.runDetail.retry}</button>
      </div>
    );
  }

  if (!result) return null;
  const files = result.brief.files;
  const selectedFile = files[selectedFileIdx];

  const copyAll = () => {
    const all = files.map((f) => `# ${f.path}\n\n${f.content}`).join("\n\n---\n\n");
    navigator.clipboard.writeText(all).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div ref={containerRef} className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{t.runDetail.fpTitle}</p>
          <p className="text-xs text-indigo-600 mt-0.5">
            {t.runDetail.fpBuilt.replace("{n}", String(result.selectedItemIds.length))}
          </p>
        </div>
        <button
          onClick={copyAll}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          {copied ? t.runDetail.copied : t.runDetail.fpCopyAll}
        </button>
      </div>

      {/* Source notice — Fix Pack reflects a specific historical run */}
      <div className="bg-amber-50 border-b border-amber-100 px-4 py-2">
        <p className="text-xs text-amber-700">{t.runDetail.fpSourceNotice}</p>
      </div>

      {/* File tabs */}
      {files.length > 1 && (
        <div className="border-b border-gray-100 flex overflow-x-auto bg-white">
          {files.map((f, i) => (
            <button
              key={f.path}
              onClick={() => setSelectedFileIdx(i)}
              className={`text-xs px-3 py-2 flex-shrink-0 border-b-2 transition-colors ${
                i === selectedFileIdx
                  ? "border-indigo-500 text-indigo-700 font-medium"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {f.path.split("/").pop()}
            </button>
          ))}
        </div>
      )}

      {/* File preview */}
      {selectedFile && (
        <div className="p-4 bg-white">
          <p className="text-xs text-gray-400 mb-2 font-mono">{selectedFile.path}</p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {selectedFile.content}
          </pre>
        </div>
      )}

      {result.warnings && result.warnings.length > 0 && (
        <div className="bg-amber-50 border-t border-amber-100 px-4 py-2">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Comment Panel ────────────────────────────────────────────────────────────

type CommentPreview = {
  body: string;
  selectedItemIds: string[];
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
};

function CommentPanel({
  projectId, prNumber, runId, userKey, rerunOfReviewRunId, selectedItemIds,
  comparisonAvailable, comparisonDisplayOnly, triggerComparisonComment,
}: {
  projectId: string;
  prNumber: number;
  runId: string;
  userKey: string;
  rerunOfReviewRunId?: string;
  selectedItemIds: string[];
  comparisonAvailable?: boolean;     // Stage 46: lineage exists → comparison can go in the comment
  comparisonDisplayOnly?: boolean;   // a comparison is on screen but fromRunId-only (no lineage)
  triggerComparisonComment?: number; // Stage 46: AutoComparisonPanel "send to comment" nonce
}) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<"idle" | "previewing" | "ready" | "posting" | "posted" | "error">("idle");
  const [preview, setPreview] = useState<CommentPreview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [postResult, setPostResult] = useState<{ url?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [includeRerunComparison, setIncludeRerunComparison] = useState(Boolean(comparisonAvailable));
  const lastTriggerRef = useRef(0);

  // Stage 43: pass the shared selectedItemIds (empty → server falls back to the run's selection).
  const sharedSelected = selectedItemIds.length > 0 ? selectedItemIds : undefined;

  const generatePreview = useCallback(async (override?: { includeRerunComparison?: boolean }) => {
    setPhase("previewing");
    setWarnings([]);
    const wantRerun = override?.includeRerunComparison ?? includeRerunComparison;
    const res = await previewPRComment(projectId, prNumber, {
      ...buildComparisonCommentInput({
        userKey, reviewRunId: runId, selectedItemIds: sharedSelected,
        includeRerunComparison: wantRerun, comparisonAvailable,
      }),
      locale,
    });
    if (!res.ok) { setPhase("error"); return; }
    setPreview(res.comment as CommentPreview);
    setWarnings(res.warnings ?? []);
    setPhase("ready");
  }, [projectId, prNumber, runId, userKey, sharedSelected, includeRerunComparison, comparisonAvailable, locale]);

  const post = useCallback(async () => {
    if (!preview) return;
    setPhase("posting");
    const res = await postPRComment(projectId, prNumber, {
      ...buildComparisonCommentInput({
        userKey, reviewRunId: runId, selectedItemIds: sharedSelected,
        includeRerunComparison, comparisonAvailable,
      }),
      mode: "new",
      locale,
    });
    if (!res.ok) { setPhase("ready"); return; }
    setPostResult({ url: (res as { comment?: { githubCommentUrl?: string } }).comment?.githubCommentUrl });
    setPhase("posted");
  }, [projectId, prNumber, runId, userKey, preview, sharedSelected, includeRerunComparison, comparisonAvailable, locale]);

  // Stage 46: AutoComparisonPanel "Post this comparison as a PR comment" — check the
  // box and auto-generate a preview (the Page scrolls this panel into view).
  useEffect(() => {
    if (!triggerComparisonComment || triggerComparisonComment === lastTriggerRef.current) return;
    lastTriggerRef.current = triggerComparisonComment;
    if (!comparisonAvailable) return;
    setIncludeRerunComparison(true);
    void generatePreview({ includeRerunComparison: true });
  }, [triggerComparisonComment, comparisonAvailable, generatePreview]);

  const copyBody = () => {
    if (!preview) return;
    navigator.clipboard.writeText(preview.body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (phase === "idle") {
    return (
      <div className="space-y-2">
        {comparisonAvailable ? (
          <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-600">
            <input
              type="checkbox"
              checked={includeRerunComparison}
              onChange={(e) => setIncludeRerunComparison(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 flex-shrink-0"
            />
            <span>
              {t.runDetail.cmInclude}
              <span className="block text-[11px] text-gray-400">
                {t.runDetail.cmIncludeHint}
              </span>
            </span>
          </label>
        ) : comparisonDisplayOnly ? (
          <p className="text-[11px] text-gray-400">
            {t.runDetail.cmDisplayOnly}
          </p>
        ) : null}
        <button
          onClick={() => generatePreview()}
          className="w-full bg-white border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
        >
          {t.runDetail.cmCreate}
        </button>
      </div>
    );
  }

  if (phase === "previewing") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        {t.runDetail.cmGenerating}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
        <span>{t.runDetail.cmError}</span>
        <button onClick={() => generatePreview()} className="text-xs text-red-600 underline">{t.runDetail.retry}</button>
      </div>
    );
  }

  if (phase === "posted") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
        {t.runDetail.cmPosted}
        {postResult?.url && (
          <a href={postResult.url} target="_blank" rel="noreferrer" className="ml-2 underline text-green-600">
            {t.runDetail.view}
          </a>
        )}
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">{t.runDetail.cmPreviewTitle}</p>
        <div className="flex items-center gap-2">
          <button onClick={copyBody} className="text-xs text-gray-500 hover:text-gray-700">
            {copied ? t.runDetail.copied : t.runDetail.copy}
          </button>
          <button
            onClick={post}
            disabled={phase === "posting"}
            className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {phase === "posting" ? t.runDetail.cmPosting : t.runDetail.cmPost}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">
              {w === "comparison_not_available_for_specific_run"
                ? t.runDetail.cmWarnNoComparison
                : w}
            </p>
          ))}
        </div>
      )}

      <div className="p-4 bg-white">
        <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-sans">
          {preview.body}
        </pre>
      </div>
    </div>
  );
}

// ─── Rerun Panel ─────────────────────────────────────────────────────────────

const CMP_STATUS_COLORS: Record<string, string> = {
  passed:         "text-green-600",
  failed:         "text-red-600",
  inconclusive:   "text-yellow-600",
  needs_decision: "text-slate-600",
};

function ComparisonPanel({ cmp, newRunId, projectId, selectedCount }: {
  cmp: SpecificRunComparison;
  newRunId: string;
  projectId: string;
  selectedCount?: number;
}) {
  const { t } = useI18n();
  if (!cmp.comparable) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500">
        {t.runDetail.cmpNoPrevious}
      </div>
    );
  }
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{t.runDetail.cmpTitle}</p>
          {typeof selectedCount === "number" && selectedCount > 0 && (
            <p className="text-xs text-indigo-600 mt-0.5">{t.runDetail.rerunDoneCount.replace("{n}", String(selectedCount))}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">{cmp.summaryText}</p>
        </div>
        <Link
          href={`/projects/${projectId}/github/history/${newRunId}`}
          className="text-xs text-indigo-600 font-medium hover:text-indigo-800 flex-shrink-0"
        >
          {t.runDetail.viewNewRun}
        </Link>
      </div>
      <div className="divide-y divide-gray-100 bg-white">
        {cmp.improved.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-green-700 mb-2">{t.runDetail.cmpImproved} ({cmp.improved.length})</p>
            {cmp.improved.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-600 mb-1.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className={CMP_STATUS_COLORS[item.from] ?? ""}>{statusText(t, item.from)}</span>
                <span className="text-gray-400 mx-1">→</span>
                <span className={CMP_STATUS_COLORS[item.to] ?? ""}>{statusText(t, item.to)}</span>
              </div>
            ))}
          </div>
        )}
        {cmp.newlyProblematic.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-red-700 mb-2">{t.runDetail.cmpNewIssue} ({cmp.newlyProblematic.length})</p>
            {cmp.newlyProblematic.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-600 mb-1.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className={CMP_STATUS_COLORS[item.from] ?? ""}>{statusText(t, item.from)}</span>
                <span className="text-gray-400 mx-1">→</span>
                <span className={CMP_STATUS_COLORS[item.to] ?? ""}>{statusText(t, item.to)}</span>
              </div>
            ))}
          </div>
        )}
        {cmp.stillOpen.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-yellow-700 mb-2">{t.runDetail.cmpStillOpen} ({cmp.stillOpen.length})</p>
            {cmp.stillOpen.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-600 mb-1.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className={CMP_STATUS_COLORS[item.status] ?? ""}>{statusText(t, item.status)}</span>
              </div>
            ))}
          </div>
        )}
        {cmp.unchanged.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-gray-500 mb-2">{t.runDetail.cmpUnchanged} ({cmp.unchanged.length})</p>
            {cmp.unchanged.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-500 mb-1">
                {item.title}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-3 bg-gray-50 text-xs text-gray-400">
          {t.runDetail.cmpCaption}
        </div>
      </div>
    </div>
  );
}

// ─── Auto comparison (Stage 45) — ?fromRunId / rerun lineage ──────────────────

type AutoCompareState =
  | { phase: "loading"; sourceId: string }
  | {
      phase: "error";
      sourceId: string;
      reason: "source_not_found" | "pr_mismatch" | "source_empty" | "current_empty";
    }
  | {
      phase: "done";
      sourceId: string;
      comparison: ReviewRunComparison;
      sourceCreatedAt: string;
      currentCreatedAt: string;
    };

function autoCompareErrorText(t: Dictionary, reason: string): string {
  switch (reason) {
    case "source_not_found": return t.runDetail.acErrSourceNotFound;
    case "pr_mismatch": return t.runDetail.acErrPrMismatch;
    case "source_empty": return t.runDetail.acErrSourceEmpty;
    case "current_empty": return t.runDetail.acErrCurrentEmpty;
    default: return t.runDetail.acLoadFailed;
  }
}

// Stage 48: status-transition pill — previous status → current status.
function TransitionPill({ item }: { item: ReviewRunComparisonItem }) {
  const { t } = useI18n();
  const sourceColor = item.sourceStatus ? (CMP_STATUS_COLORS[item.sourceStatus] ?? "text-gray-500") : "text-gray-400";
  const currentColor = item.currentStatus ? (CMP_STATUS_COLORS[item.currentStatus] ?? "text-gray-500") : "text-gray-500";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] border border-gray-200 rounded-full px-2 py-0.5 bg-white">
      <span className={sourceColor}>
        {item.sourceStatus ? statusText(t, item.sourceStatus) : t.runDetail.newItem}
      </span>
      <span className="text-gray-300">→</span>
      <span className={`${currentColor} font-medium`}>
        {item.currentStatus ? statusText(t, item.currentStatus) : ""}
      </span>
    </span>
  );
}

function AutoCompareGroup({ title, description, color, items }: {
  title: string;
  description: string;
  color: string;
  items: ReviewRunComparisonItem[];
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="px-4 py-3">
      <p className={`text-xs font-medium ${color}`}>{title} ({items.length})</p>
      <p className="text-[11px] text-gray-400 mb-2">{description}</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.itemId}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-800">{item.title}</span>
              <TransitionPill item={item} />
            </div>
            {item.currentEvidence && (
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">{t.runDetail.acCurrentEvidence}: {item.currentEvidence}</p>
            )}
            {item.currentNextAction && (
              <p className="text-[11px] text-indigo-500 mt-0.5 truncate">{t.runDetail.acNextAction}: {item.currentNextAction}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AutoComparisonPanel({ state, hasLineage, onSendToComment }: {
  state: AutoCompareState;
  hasLineage?: boolean;
  onSendToComment?: () => void;
}) {
  const { t, locale } = useI18n();
  if (state.phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
        <div className="w-3 h-3 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        {t.runDetail.acComparing}
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
        <p className="text-xs font-medium text-gray-600">{t.runDetail.acCannotCompare}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{autoCompareErrorText(t, state.reason)}</p>
      </div>
    );
  }

  const { comparison: cmp, sourceCreatedAt, currentCreatedAt } = state;
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">{t.runDetail.acTitle}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {t.runDetail.acCaption}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-gray-400">
          <span>{t.runDetail.acPrevious}: {formatDate(sourceCreatedAt, locale)}</span>
          <span>{t.runDetail.acCurrent}: {formatDate(currentCreatedAt, locale)}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs">
          {cmp.summary.improved > 0 && <span className="text-green-600 font-medium">{t.runDetail.cmpImproved} {cmp.summary.improved}</span>}
          {cmp.summary.newlyProblematic > 0 && <span className="text-red-600 font-medium">{t.runDetail.cmpNewIssue} {cmp.summary.newlyProblematic}</span>}
          {cmp.summary.stillOpen > 0 && <span className="text-yellow-600 font-medium">{t.runDetail.cmpStillOpen} {cmp.summary.stillOpen}</span>}
          {cmp.summary.unchanged > 0 && <span className="text-gray-500 font-medium">{t.runDetail.cmpUnchanged} {cmp.summary.unchanged}</span>}
        </div>
      </div>
      <div className="divide-y divide-gray-100 bg-white">
        <AutoCompareGroup
          title={t.runDetail.cmpImproved} color="text-green-700"
          description={t.runDetail.acDescImproved}
          items={cmp.improved}
        />
        <AutoCompareGroup
          title={t.runDetail.cmpNewIssue} color="text-red-700"
          description={t.runDetail.acDescNew}
          items={cmp.newlyProblematic}
        />
        <AutoCompareGroup
          title={t.runDetail.cmpStillOpen} color="text-yellow-700"
          description={t.runDetail.acDescStillOpen}
          items={cmp.stillOpen}
        />
        <AutoCompareGroup
          title={t.runDetail.cmpUnchanged} color="text-gray-500"
          description={t.runDetail.acDescUnchanged}
          items={cmp.unchanged}
        />
      </div>

      {/* Stage 46: post this comparison to a PR comment (lineage runs only) */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
        {hasLineage && onSendToComment ? (
          <button
            onClick={onSendToComment}
            className="text-xs font-medium border border-indigo-200 text-indigo-700 bg-indigo-50 rounded-lg px-3 py-1.5 hover:bg-indigo-100 transition-colors"
          >
            {t.runDetail.acSendToComment}
          </button>
        ) : (
          <p className="text-[11px] text-gray-400">
            {t.runDetail.acNeedLineage}
          </p>
        )}
      </div>
    </div>
  );
}

function RerunItemRow({ item, checked, onToggle }: {
  item: ReviewResultItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const evidence = Array.isArray(item.evidence) && item.evidence.length > 0 ? item.evidence[0] : "";
  return (
    <label className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 rounded border-gray-300 flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium border rounded-full px-1.5 py-0.5 flex-shrink-0 ${badgeClass(item.status)}`}>
            {statusText(t, item.status)}
          </span>
          <span className="text-xs font-medium text-gray-800 truncate">{item.title}</span>
        </div>
        {evidence && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{evidence}</p>}
        {item.status !== "passed" && item.nextAction && (
          <p className="text-[11px] text-indigo-500 mt-0.5 truncate">{t.runDetail.next}: {item.nextAction}</p>
        )}
      </div>
    </label>
  );
}

// ─── Shared item selection panel (Stage 43) ──────────────────────────────────
// One picker; RerunPanel / FixPackPanel / CommentPanel all consume its result.

function ReviewItemSelectionPanel({
  items, selectedItemIds, onChange, storageNote,
}: {
  items: ReviewResultItem[];
  selectedItemIds: string[];
  onChange: (selectedItemIds: string[]) => void;
  storageNote?: string;
}) {
  const { t } = useI18n();
  const selectedSet = new Set(selectedItemIds);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">{t.runDetail.selTitle}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {t.runDetail.selDesc}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <button
            onClick={() => onChange(recommendedRerunItemIds(items))}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            {t.runDetail.presetRecommended}
          </button>
          <button
            onClick={() => onChange(allRerunItemIds(items))}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            {t.runDetail.presetAll}
          </button>
          <button
            onClick={() => onChange(nonPassedRerunItemIds(items))}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            {t.runDetail.presetNonPassed}
          </button>
          <button
            onClick={() => onChange([])}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            {t.runDetail.presetNone}
          </button>
        </div>
      </div>

      <div className="divide-y divide-gray-100 bg-white max-h-72 overflow-y-auto">
        {items.map((item) => (
          <RerunItemRow
            key={item.itemId}
            item={item}
            checked={selectedSet.has(item.itemId)}
            onToggle={() => onChange(toggleItemSelection(items, selectedItemIds, item.itemId))}
          />
        ))}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center justify-between gap-2">
        {selectedItemIds.length > 0 ? (
          <p className="text-xs text-indigo-600">{t.runDetail.selSelected.replace("{n}", String(selectedItemIds.length))}</p>
        ) : (
          <p className="text-xs text-amber-600">
            {t.runDetail.selHint}
          </p>
        )}
        {storageNote && <span className="text-[11px] text-gray-400 flex-shrink-0">{storageNote}</span>}
      </div>
    </div>
  );
}

function RerunPanel({
  projectId, prNumber, runId, userKey, selectedItemIds,
}: { projectId: string; prNumber: number; runId: string; userKey: string; selectedItemIds: string[] }) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [newRunId, setNewRunId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SpecificRunComparison | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [submittedCount, setSubmittedCount] = useState(0);

  const selectedCount = selectedItemIds.length;
  const enabled = canRerun(selectedCount);

  const run = useCallback(async () => {
    if (!canRerun(selectedItemIds.length)) return;
    setPhase("running");
    setErrorMsg("");
    setSubmittedCount(selectedItemIds.length);
    const idempotencyKey = crypto.randomUUID();
    // body selectedItemIds takes priority over the source run's selection.
    const res = await startPRReview(projectId, prNumber, {
      userKey,
      rerunOfReviewRunId: runId,
      selectedItemIds,
      idempotencyKey,
      locale,
    });
    if (!res.ok) {
      setErrorMsg(errorText(t, res.error, "generic"));
      setPhase("error");
      return;
    }
    setNewRunId(res.run.id);
    if (res.comparisonToSourceRun) setComparison(res.comparisonToSourceRun);
    setPhase("done");
  }, [projectId, prNumber, runId, selectedItemIds, userKey, t]);

  if (phase === "running") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        {t.runDetail.rerunRunning}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
        <span>{t.runDetail.rerunFailedPrefix} {errorMsg}</span>
        <button onClick={() => setPhase("idle")} className="text-xs text-red-600 underline ml-2">
          {t.runDetail.close}
        </button>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="space-y-3">
        {comparison && newRunId && (
          <ComparisonPanel cmp={comparison} newRunId={newRunId} projectId={projectId} selectedCount={submittedCount} />
        )}
        {newRunId && !comparison && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center justify-between">
            <span>{t.runDetail.rerunDoneCount.replace("{n}", String(submittedCount))}</span>
            <Link
              href={`/projects/${projectId}/github/history/${newRunId}`}
              className="text-xs text-green-600 underline ml-2"
            >
              {t.runDetail.viewNewRun}
            </Link>
          </div>
        )}
      </div>
    );
  }

  // idle — button only; selection lives in ReviewItemSelectionPanel
  return (
    <button
      onClick={run}
      disabled={!enabled}
      className="w-full bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {t.runDetail.rerunSelected}{enabled ? ` (${selectedCount})` : ""}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { t, locale } = useI18n();
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "not_found" | "error">("loading");
  const [detail, setDetail] = useState<{
    repoFullName: string;
    prNumber: number;
    run: PRReviewRunDetail;
  } | null>(null);
  // Stage 42: arrived from the history list "Fix Pack for remaining issues" quick action.
  // Read on the client to avoid a useSearchParams Suspense boundary.
  const [fixPackRequested, setFixPackRequested] = useState(false);
  // Stage 45: ?fromRunId — auto-compare against that source run.
  const [fromRunId, setFromRunId] = useState<string | null>(null);
  const [autoCompare, setAutoCompare] = useState<AutoCompareState | null>(null);
  // Stage 46: AutoComparisonPanel → CommentPanel "send comparison to comment".
  const [commentTriggerKey, setCommentTriggerKey] = useState(0);
  const commentSectionRef = useRef<HTMLDivElement | null>(null);
  // Stage 43: one shared item selection for re-run / Fix Pack / PR comment.
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  // Stage 44: client-side persistence of the selection per (project, run).
  const [storageStatus, setStorageStatus] = useState<"restored" | "saved" | null>(null);
  const hydratedRef = useRef(false);
  const skipNextWriteRef = useRef(false);

  const storageKey = buildReviewSelectionStorageKey({ projectId: id, runId });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFixPackRequested(params.get("action") === "fix-pack");
    setFromRunId(params.get("fromRunId"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Reset hydration for this run before loading (handles run-to-run navigation).
    hydratedRef.current = false;
    setStorageStatus(null);
    async function load() {
      setPhase("loading");
      const res = await getReviewRunDetail(id, runId, userKey ?? "");
      if (cancelled) return;
      if (!res.ok) {
        setPhase(res.error.includes("404") || res.error.includes("not_found") ? "not_found" : "error");
        return;
      }
      setDetail({ repoFullName: res.repoFullName, prNumber: res.prNumber, run: res.run });

      // Stage 44: restore stored selection, else recommended fallback.
      const validItemIds = res.run.results.map((r) => r.itemId);
      const recommended = recommendedRerunItemIds(res.run.results);
      const storage = getReviewSelectionStorage();
      const stored = storage
        ? readStoredReviewSelection({ storage, key: storageKey, validItemIds })
        : null;
      if (stored !== null) {
        // stored [] is an intentional "clear all" — restore it as-is.
        setSelectedItemIds(stored);
        setStorageStatus("restored");
      } else {
        setSelectedItemIds(recommended);
      }
      // The setState above will trigger the write effect; skip that one write
      // so restoring doesn't immediately re-persist / flip the status to "saved".
      skipNextWriteRef.current = true;
      hydratedRef.current = true;
      setPhase("done");
    }
    load();
    return () => { cancelled = true; };
  }, [id, runId, userKey, storageKey]);

  // Stage 44: persist on every post-hydration change.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (skipNextWriteRef.current) { skipNextWriteRef.current = false; return; }
    const storage = getReviewSelectionStorage();
    if (!storage) return;
    if (writeStoredReviewSelection({ storage, key: storageKey, selectedItemIds })) {
      setStorageStatus("saved");
    }
  }, [selectedItemIds, storageKey]);

  // Stage 45: auto-compare against ?fromRunId, else the rerun lineage source.
  // Non-blocking — failures only surface a small notice; other actions keep working.
  useEffect(() => {
    if (phase !== "done" || !detail || !userKey) return;
    const current = detail.run;
    // Priority: query fromRunId > current run's rerun lineage. Ignore self.
    const sourceId = pickComparisonSourceRunId({
      fromRunId, runId, rerunOfReviewRunId: current.rerunOfReviewRunId,
    });
    if (!sourceId) { setAutoCompare(null); return; }

    let cancelled = false;
    setAutoCompare({ phase: "loading", sourceId });
    (async () => {
      const res = await getReviewRunDetail(id, sourceId, userKey);
      if (cancelled) return;
      if (!res.ok) { setAutoCompare({ phase: "error", sourceId, reason: "source_not_found" }); return; }
      if (res.prNumber !== detail.prNumber) { setAutoCompare({ phase: "error", sourceId, reason: "pr_mismatch" }); return; }
      const cmp = compareReviewRunResults({ sourceResults: res.run.results, currentResults: current.results });
      if (!cmp.comparable) {
        setAutoCompare({
          phase: "error", sourceId,
          reason: cmp.reason === "missing_current_results" ? "current_empty" : "source_empty",
        });
        return;
      }
      setAutoCompare({
        phase: "done", sourceId, comparison: cmp,
        sourceCreatedAt: res.run.createdAt, currentCreatedAt: current.createdAt,
      });
    })();
    return () => { cancelled = true; };
  }, [phase, detail, fromRunId, id, runId, userKey]);

  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  const historyUrl = `/projects/${id}/github/history`;
  const prPageUrl = `/projects/${id}/github`;

  if (phase === "loading") {
    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
          {t.runDetail.loading}
        </div>
      </div>
    );
  }

  if (phase === "not_found") {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={historyUrl} className="text-xs text-gray-400 hover:text-indigo-600 inline-block">
          {t.runDetail.backToHistory}
        </Link>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm font-medium text-gray-700 mb-1">{t.runDetail.notFoundTitle}</p>
          <p className="text-xs text-gray-400">{t.runDetail.notFoundDesc}</p>
        </div>
      </div>
    );
  }

  if (phase === "error" || !detail) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={historyUrl} className="text-xs text-gray-400 hover:text-indigo-600 inline-block">
          {t.runDetail.backToHistory}
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {t.runDetail.loadError}
        </div>
      </div>
    );
  }

  const { run, repoFullName, prNumber } = detail;
  const actionNeeded = run.summary.failed + run.summary.inconclusive + run.summary.needsDecision;
  const hasResults = Array.isArray(run.results) && run.results.length > 0;
  // Stage 46: backend can only put the comparison in the comment when this run
  // has rerun lineage (it uses rerun_of_review_run_id). fromRunId-only is display-only.
  const hasLineage = Boolean(run.rerunOfReviewRunId);
  const comparisonDisplayOnly = autoCompare?.phase === "done" && !hasLineage;

  const sortedResults = hasResults
    ? [...run.results].sort((a, b) => {
        const order: Record<string, number> = { failed: 0, inconclusive: 1, needs_decision: 2, passed: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      })
    : [];

  return (
    <div className="max-w-3xl space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={historyUrl} className="text-xs text-gray-400 hover:text-indigo-600 mb-2 inline-block">
            {t.runDetail.backToHistory}
          </Link>
          <h2 className="text-lg font-bold text-gray-900">{t.runDetail.title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{repoFullName} · PR #{prNumber}</p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {/* ── Source label ── */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs text-amber-700">
        {t.runDetail.sourceNotice}
      </div>

      {/* ── Lineage badge ── */}
      {run.rerunOfReviewRunId && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
          <span className="text-xs font-medium text-indigo-700 bg-indigo-100 border border-indigo-200 rounded-full px-2 py-0.5">
            {t.runDetail.rerunBadge}
          </span>
          <Link
            href={`/projects/${id}/github/history/${run.rerunOfReviewRunId}`}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {t.runDetail.viewPrevRun}
          </Link>
        </div>
      )}

      {/* ── Run meta ── */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-xs text-gray-500 space-y-1.5">
        <div className="flex items-center justify-between">
          <span>{t.runDetail.runTime}</span>
          <span className="text-gray-700 font-medium">{formatDate(run.createdAt, locale)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t.runDetail.itemCount}</span>
          <span className="text-gray-700 font-medium">{run.selectedItemCount}</span>
        </div>
        {run.errorMessage && (
          <div className="flex items-center justify-between">
            <span>{t.runDetail.errorLabel}</span>
            <span className="text-red-600">{run.errorMessage}</span>
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      <SummaryCards summary={run.summary} />

      {/* ── Auto comparison vs source run (Stage 45/46) ── */}
      {autoCompare && (
        <AutoComparisonPanel
          state={autoCompare}
          hasLineage={hasLineage}
          onSendToComment={() => {
            commentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            setCommentTriggerKey((k) => k + 1);
          }}
        />
      )}

      {/* ── Comparison hint (hidden once an auto-comparison is shown) ── */}
      {!autoCompare && run.status !== "queued" && run.status !== "running" && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-blue-700">
            {t.runDetail.compareHint}
          </p>
          <Link href={prPageUrl} className="text-xs text-blue-600 font-medium hover:text-blue-800 flex-shrink-0">
            {t.runDetail.viewLatestComparison}
          </Link>
        </div>
      )}

      {/* ── Shared item selection (Stage 43) — drives re-run / Fix Pack / comment ── */}
      {hasResults && userKey && (
        <>
          <ReviewItemSelectionPanel
            items={run.results}
            selectedItemIds={selectedItemIds}
            onChange={setSelectedItemIds}
            storageNote={
              storageStatus === "restored" ? t.runDetail.restored
              : storageStatus === "saved" ? t.runDetail.saved
              : undefined
            }
          />

          {/* Re-run */}
          <RerunPanel
            projectId={id}
            prNumber={prNumber}
            runId={runId}
            userKey={userKey}
            selectedItemIds={selectedItemIds}
          />

          {/* Fix Pack (focused on remaining issues, auto-opens on ?action=fix-pack) */}
          {actionNeeded > 0 && (
            <FixPackPanel
              projectId={id}
              prNumber={prNumber}
              runId={runId}
              userKey={userKey}
              selectedItemIds={selectedItemIds}
              autoOpen={fixPackRequested}
            />
          )}

          {/* PR comment */}
          <div ref={commentSectionRef}>
            <CommentPanel
              projectId={id}
              prNumber={prNumber}
              runId={runId}
              userKey={userKey}
              rerunOfReviewRunId={run.rerunOfReviewRunId}
              selectedItemIds={selectedItemIds}
              comparisonAvailable={hasLineage}
              comparisonDisplayOnly={comparisonDisplayOnly}
              triggerComparisonComment={commentTriggerKey}
            />
          </div>
        </>
      )}

      {/* ── Item results ── */}
      {hasResults ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{t.runDetail.itemResults}</h3>
          <div className="space-y-3">
            {sortedResults.map((r) => (
              <ResultCard key={r.itemId} item={r} />
            ))}
          </div>
        </section>
      ) : (
        run.status !== "error" && run.status !== "queued" && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            {t.runDetail.noItemResults}
          </div>
        )
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
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
  canRerun,
  formatSelectedCountMessage,
} from "@/lib/rerun-selection";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  passed:        { label: "통과",     badge: "text-green-700 bg-green-50 border-green-200" },
  failed:        { label: "안 맞음", badge: "text-red-700 bg-red-50 border-red-200" },
  inconclusive:  { label: "확인 부족",badge: "text-yellow-700 bg-yellow-50 border-yellow-200" },
  needs_decision:{ label: "결정 필요",badge: "text-violet-700 bg-violet-50 border-violet-200" },
  error:         { label: "실패",     badge: "text-gray-600 bg-gray-50 border-gray-200" },
  running:       { label: "실행 중", badge: "text-blue-700 bg-blue-50 border-blue-200" },
  queued:        { label: "대기 중", badge: "text-gray-500 bg-gray-50 border-gray-200" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { label: status, badge: "text-gray-500 bg-gray-50 border-gray-200" };
  return (
    <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 flex-shrink-0 ${c.badge}`}>
      {c.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: PRReviewRunDetail["summary"] }) {
  const cards = [
    { label: "통과",      value: summary.passed,        color: "text-green-600" },
    { label: "안 맞음",  value: summary.failed,        color: "text-red-600" },
    { label: "확인 부족", value: summary.inconclusive,  color: "text-yellow-600" },
    { label: "결정 필요", value: summary.needsDecision, color: "text-violet-600" },
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
  const cfg = STATUS_CFG[item.status] ?? STATUS_CFG["error"];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start gap-3 mb-2">
        <span className={`text-xs font-medium border rounded-full px-2 py-0.5 flex-shrink-0 mt-0.5 ${cfg.badge}`}>
          {item.userLabel ?? cfg.label}
        </span>
        <p className="text-sm font-medium text-gray-800">{item.title}</p>
      </div>
      {item.reason && (
        <p className="text-xs text-gray-500 leading-relaxed mb-2">{item.reason}</p>
      )}
      {Array.isArray(item.evidence) && item.evidence.length > 0 && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
          <p className="text-xs font-medium text-gray-500 mb-1">확인 근거</p>
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
          <span className="font-medium">다음 단계:</span> {item.nextAction}
        </p>
      )}
    </div>
  );
}

// ─── Fix Pack Panel ───────────────────────────────────────────────────────────

function FixPackPanel({
  projectId, prNumber, runId, userKey,
}: { projectId: string; prNumber: number; runId: string; userKey: string }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<FixBriefResult | null>(null);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setPhase("loading");
    const ext = loadExtendedProjectData(projectId);
    const res = await generatePRFixBrief(projectId, prNumber, {
      userKey,
      reviewRunId: runId,
      productSpec: ext?.productSpec,
      items: undefined,
    });
    if (!res.ok) { setPhase("error"); return; }
    setResult(res);
    setPhase("done");
  }, [projectId, prNumber, runId, userKey]);

  if (phase === "idle") {
    return (
      <button
        onClick={generate}
        className="w-full bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-800 transition-colors"
      >
        이 기록으로 Fix Pack 만들기
      </button>
    );
  }

  if (phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        Fix Pack 생성 중...
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
        <span>Fix Pack 생성 실패</span>
        <button onClick={generate} className="text-xs text-red-600 underline">다시 시도</button>
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
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Fix Pack</p>
          <p className="text-xs text-gray-400 mt-0.5">
            이 확인 기록 기준 생성됨 · {result.selectedItemIds.length}개 항목
          </p>
        </div>
        <button
          onClick={copyAll}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          {copied ? "복사됨!" : "전체 복사"}
        </button>
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
  projectId, prNumber, runId, userKey, rerunOfReviewRunId,
}: { projectId: string; prNumber: number; runId: string; userKey: string; rerunOfReviewRunId?: string }) {
  const [phase, setPhase] = useState<"idle" | "previewing" | "ready" | "posting" | "posted" | "error">("idle");
  const [preview, setPreview] = useState<CommentPreview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [postResult, setPostResult] = useState<{ url?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [includeRerunComparison, setIncludeRerunComparison] = useState(Boolean(rerunOfReviewRunId));

  const generatePreview = useCallback(async () => {
    setPhase("previewing");
    setWarnings([]);
    const res = await previewPRComment(projectId, prNumber, {
      userKey, reviewRunId: runId,
      includeRerunComparison: includeRerunComparison && Boolean(rerunOfReviewRunId),
    });
    if (!res.ok) { setPhase("error"); return; }
    setPreview(res.comment as CommentPreview);
    setWarnings(res.warnings ?? []);
    setPhase("ready");
  }, [projectId, prNumber, runId, userKey, includeRerunComparison, rerunOfReviewRunId]);

  const post = useCallback(async () => {
    if (!preview) return;
    setPhase("posting");
    const res = await postPRComment(projectId, prNumber, {
      userKey, reviewRunId: runId, mode: "new",
      includeRerunComparison: includeRerunComparison && Boolean(rerunOfReviewRunId),
    });
    if (!res.ok) { setPhase("ready"); return; }
    setPostResult({ url: (res as { comment?: { githubCommentUrl?: string } }).comment?.githubCommentUrl });
    setPhase("posted");
  }, [projectId, prNumber, runId, userKey, preview, includeRerunComparison, rerunOfReviewRunId]);

  const copyBody = () => {
    if (!preview) return;
    navigator.clipboard.writeText(preview.body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (phase === "idle") {
    return (
      <div className="space-y-2">
        {rerunOfReviewRunId && (
          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600">
            <input
              type="checkbox"
              checked={includeRerunComparison}
              onChange={(e) => setIncludeRerunComparison(e.target.checked)}
              className="rounded border-gray-300"
            />
            이전 확인 기록과의 비교 포함
          </label>
        )}
        <button
          onClick={generatePreview}
          className="w-full bg-white border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
        >
          이 기록으로 PR comment 작성하기
        </button>
      </div>
    );
  }

  if (phase === "previewing") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        comment 생성 중...
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
        <span>comment 생성 실패</span>
        <button onClick={generatePreview} className="text-xs text-red-600 underline">다시 시도</button>
      </div>
    );
  }

  if (phase === "posted") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
        GitHub에 comment를 남겼습니다.
        {postResult?.url && (
          <a href={postResult.url} target="_blank" rel="noreferrer" className="ml-2 underline text-green-600">
            보기 →
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
        <p className="text-sm font-semibold text-gray-800">PR comment 미리보기</p>
        <div className="flex items-center gap-2">
          <button onClick={copyBody} className="text-xs text-gray-500 hover:text-gray-700">
            {copied ? "복사됨!" : "복사"}
          </button>
          <button
            onClick={post}
            disabled={phase === "posting"}
            className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {phase === "posting" ? "작성 중..." : "GitHub에 남기기"}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">
              {w === "comparison_not_available_for_specific_run"
                ? "이전/최신 비교는 특정 확인 기록에서는 지원하지 않아요."
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
  needs_decision: "text-violet-600",
};

const STATUS_KO: Record<string, string> = {
  passed: "통과", failed: "안 맞음", inconclusive: "확인 부족", needs_decision: "결정 필요",
};

function ComparisonPanel({ cmp, newRunId, projectId, selectedCount }: {
  cmp: SpecificRunComparison;
  newRunId: string;
  projectId: string;
  selectedCount?: number;
}) {
  if (!cmp.comparable) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500">
        비교할 이전 확인 결과가 없어요.
      </div>
    );
  }
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">이전/새 결과 비교</p>
          {typeof selectedCount === "number" && selectedCount > 0 && (
            <p className="text-xs text-indigo-600 mt-0.5">{formatSelectedCountMessage(selectedCount)}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">{cmp.summaryText}</p>
        </div>
        <Link
          href={`/projects/${projectId}/github/history/${newRunId}`}
          className="text-xs text-indigo-600 font-medium hover:text-indigo-800 flex-shrink-0"
        >
          새 기록 보기 →
        </Link>
      </div>
      <div className="divide-y divide-gray-100 bg-white">
        {cmp.improved.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-green-700 mb-2">좋아진 항목 ({cmp.improved.length}개)</p>
            {cmp.improved.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-600 mb-1.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className={CMP_STATUS_COLORS[item.from] ?? ""}>{STATUS_KO[item.from] ?? item.from}</span>
                <span className="text-gray-400 mx-1">→</span>
                <span className={CMP_STATUS_COLORS[item.to] ?? ""}>{STATUS_KO[item.to] ?? item.to}</span>
              </div>
            ))}
          </div>
        )}
        {cmp.newlyProblematic.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-red-700 mb-2">새로 생긴 문제 ({cmp.newlyProblematic.length}개)</p>
            {cmp.newlyProblematic.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-600 mb-1.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className={CMP_STATUS_COLORS[item.from] ?? ""}>{STATUS_KO[item.from] ?? item.from}</span>
                <span className="text-gray-400 mx-1">→</span>
                <span className={CMP_STATUS_COLORS[item.to] ?? ""}>{STATUS_KO[item.to] ?? item.to}</span>
              </div>
            ))}
          </div>
        )}
        {cmp.stillOpen.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-yellow-700 mb-2">아직 남은 항목 ({cmp.stillOpen.length}개)</p>
            {cmp.stillOpen.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-600 mb-1.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-gray-400 mx-1">·</span>
                <span className={CMP_STATUS_COLORS[item.status] ?? ""}>{STATUS_KO[item.status] ?? item.status}</span>
              </div>
            ))}
          </div>
        )}
        {cmp.unchanged.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-gray-500 mb-2">변화 없음 ({cmp.unchanged.length}개)</p>
            {cmp.unchanged.map((item) => (
              <div key={item.itemId} className="text-xs text-gray-500 mb-1">
                {item.title}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-3 bg-gray-50 text-xs text-gray-400">
          이 비교는 선택한 이전 확인 기록과 방금 다시 확인한 결과를 비교한 것입니다.
        </div>
      </div>
    </div>
  );
}

function RerunItemRow({ item, checked, onToggle }: {
  item: ReviewResultItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const cfg = STATUS_CFG[item.status] ?? STATUS_CFG["error"];
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
          <span className={`text-[11px] font-medium border rounded-full px-1.5 py-0.5 flex-shrink-0 ${cfg.badge}`}>
            {item.userLabel ?? cfg.label}
          </span>
          <span className="text-xs font-medium text-gray-800 truncate">{item.title}</span>
        </div>
        {evidence && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{evidence}</p>}
        {item.status !== "passed" && item.nextAction && (
          <p className="text-[11px] text-indigo-500 mt-0.5 truncate">다음: {item.nextAction}</p>
        )}
      </div>
    </label>
  );
}

function RerunPanel({
  projectId, prNumber, runId, results, userKey,
}: { projectId: string; prNumber: number; runId: string; results: ReviewResultItem[]; userKey: string }) {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [newRunId, setNewRunId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SpecificRunComparison | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [submittedCount, setSubmittedCount] = useState(0);
  // Default selection: 안 맞음 / 확인 부족 / 결정 필요 (통과 제외).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(recommendedRerunItemIds(results)),
  );

  const toggle = useCallback((itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const applyPreset = useCallback((ids: string[]) => setSelected(new Set(ids)), []);

  const run = useCallback(async () => {
    const ids = [...selected];
    if (!canRerun(ids.length)) return;
    setPhase("running");
    setErrorMsg("");
    setSubmittedCount(ids.length);
    const idempotencyKey = crypto.randomUUID();
    // body selectedItemIds takes priority over the source run's selection.
    const res = await startPRReview(projectId, prNumber, {
      userKey,
      rerunOfReviewRunId: runId,
      selectedItemIds: ids,
      idempotencyKey,
    });
    if (!res.ok) {
      setErrorMsg(res.error ?? "확인 실패");
      setPhase("error");
      return;
    }
    setNewRunId(res.run.id);
    if (res.comparisonToSourceRun) setComparison(res.comparisonToSourceRun);
    setPhase("done");
  }, [projectId, prNumber, runId, selected, userKey]);

  if (phase === "running") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
        확인 실행 중... (PR 크기에 따라 최대 30초 소요)
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
        <span>다시 확인 실패: {errorMsg}</span>
        <button onClick={() => setPhase("idle")} className="text-xs text-red-600 underline ml-2">
          닫기
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
            <span>{formatSelectedCountMessage(submittedCount)}</span>
            <Link
              href={`/projects/${projectId}/github/history/${newRunId}`}
              className="text-xs text-green-600 underline ml-2"
            >
              새 기록 보기 →
            </Link>
          </div>
        )}
      </div>
    );
  }

  // idle — item picker
  const selectedCount = selected.size;
  const enabled = canRerun(selectedCount);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">다시 확인할 항목</p>
        <p className="text-xs text-gray-400 mt-0.5">
          남은 문제만 골라 다시 확인할 수 있어요. 기본으로 통과하지 않은 항목이 선택돼 있어요.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <button
            onClick={() => applyPreset(recommendedRerunItemIds(results))}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            추천 선택
          </button>
          <button
            onClick={() => applyPreset(allRerunItemIds(results))}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            전체 선택
          </button>
          <button
            onClick={() => applyPreset(nonPassedRerunItemIds(results))}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            통과 제외
          </button>
          <button
            onClick={() => applyPreset([])}
            className="text-[11px] border border-gray-200 bg-white text-gray-600 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            모두 해제
          </button>
        </div>
      </div>

      <div className="divide-y divide-gray-100 bg-white max-h-72 overflow-y-auto">
        {results.map((item) => (
          <RerunItemRow
            key={item.itemId}
            item={item}
            checked={selected.has(item.itemId)}
            onToggle={() => toggle(item.itemId)}
          />
        ))}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
        {!enabled && (
          <p className="text-xs text-amber-600">다시 확인할 항목을 하나 이상 선택해주세요.</p>
        )}
        <button
          onClick={run}
          disabled={!enabled}
          className="w-full bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          선택한 항목 다시 확인하기{enabled ? ` (${selectedCount}개)` : ""}
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "not_found" | "error">("loading");
  const [detail, setDetail] = useState<{
    repoFullName: string;
    prNumber: number;
    run: PRReviewRunDetail;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      const res = await getReviewRunDetail(id, runId, userKey ?? "");
      if (cancelled) return;
      if (!res.ok) {
        setPhase(res.error.includes("404") || res.error.includes("not_found") ? "not_found" : "error");
        return;
      }
      setDetail({ repoFullName: res.repoFullName, prNumber: res.prNumber, run: res.run });
      setPhase("done");
    }
    load();
    return () => { cancelled = true; };
  }, [id, runId, userKey]);

  if (!project) return <p className="text-sm text-gray-400">프로젝트를 찾을 수 없습니다.</p>;

  const historyUrl = `/projects/${id}/github/history`;
  const prPageUrl = `/projects/${id}/github`;

  if (phase === "loading") {
    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
          확인 결과를 불러오는 중...
        </div>
      </div>
    );
  }

  if (phase === "not_found") {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={historyUrl} className="text-xs text-gray-400 hover:text-indigo-600 inline-block">
          ← 확인 기록으로 돌아가기
        </Link>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm font-medium text-gray-700 mb-1">확인 결과를 찾을 수 없어요.</p>
          <p className="text-xs text-gray-400">삭제됐거나 다른 프로젝트의 결과일 수 있어요.</p>
        </div>
      </div>
    );
  }

  if (phase === "error" || !detail) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href={historyUrl} className="text-xs text-gray-400 hover:text-indigo-600 inline-block">
          ← 확인 기록으로 돌아가기
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          결과를 불러오지 못했습니다. 확인 기록 목록에서 다시 접근해 주세요.
        </div>
      </div>
    );
  }

  const { run, repoFullName, prNumber } = detail;
  const actionNeeded = run.summary.failed + run.summary.inconclusive + run.summary.needsDecision;
  const hasResults = Array.isArray(run.results) && run.results.length > 0;

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
            ← 확인 기록으로 돌아가기
          </Link>
          <h2 className="text-lg font-bold text-gray-900">확인 상세</h2>
          <p className="text-xs text-gray-400 mt-0.5">{repoFullName} · PR #{prNumber}</p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {/* ── Source label ── */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs text-amber-700">
        이 화면은 특정 확인 기록 기준입니다. 최신 PR 상태와 다를 수 있어요.
      </div>

      {/* ── Lineage badge ── */}
      {run.rerunOfReviewRunId && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
          <span className="text-xs font-medium text-indigo-700 bg-indigo-100 border border-indigo-200 rounded-full px-2 py-0.5">
            다시 확인한 기록
          </span>
          <Link
            href={`/projects/${id}/github/history/${run.rerunOfReviewRunId}`}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            이전 확인 기록 보기 →
          </Link>
        </div>
      )}

      {/* ── Run meta ── */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-xs text-gray-500 space-y-1.5">
        <div className="flex items-center justify-between">
          <span>확인 시간</span>
          <span className="text-gray-700 font-medium">{formatDate(run.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>확인 항목 수</span>
          <span className="text-gray-700 font-medium">{run.selectedItemCount}개</span>
        </div>
        {run.errorMessage && (
          <div className="flex items-center justify-between">
            <span>오류 내용</span>
            <span className="text-red-600">{run.errorMessage}</span>
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      <SummaryCards summary={run.summary} />

      {/* ── Comparison hint ── */}
      {run.status !== "queued" && run.status !== "running" && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-blue-700">
            같은 PR을 한 번 더 확인하면 이전 확인 결과와 비교할 수 있어요.
          </p>
          <Link href={prPageUrl} className="text-xs text-blue-600 font-medium hover:text-blue-800 flex-shrink-0">
            최신 비교 결과 보기 →
          </Link>
        </div>
      )}

      {/* ── Re-run (run-specific, selectable items) ── */}
      {hasResults && userKey && (
        <>
          <p className="text-xs text-gray-500 -mb-2">
            이 기록에서 문제가 남은 항목만 골라 다시 확인할 수 있어요.
          </p>
          <RerunPanel
            projectId={id}
            prNumber={prNumber}
            runId={runId}
            results={run.results}
            userKey={userKey}
          />
        </>
      )}

      {/* ── Run-specific Fix Pack ── */}
      {actionNeeded > 0 && userKey && (
        <FixPackPanel projectId={id} prNumber={prNumber} runId={runId} userKey={userKey} />
      )}

      {/* ── Run-specific Comment ── */}
      {hasResults && userKey && (
        <CommentPanel
          projectId={id}
          prNumber={prNumber}
          runId={runId}
          userKey={userKey}
          rerunOfReviewRunId={run.rerunOfReviewRunId}
        />
      )}

      {/* ── Item results ── */}
      {hasResults ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">항목별 결과</h3>
          <div className="space-y-3">
            {sortedResults.map((r) => (
              <ResultCard key={r.itemId} item={r} />
            ))}
          </div>
        </section>
      ) : (
        run.status !== "error" && run.status !== "queued" && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            항목별 결과가 저장되지 않았습니다.
          </div>
        )
      )}
    </div>
  );
}

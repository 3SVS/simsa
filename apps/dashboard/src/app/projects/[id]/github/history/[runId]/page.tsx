"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  getReviewRunDetail,
  type PRReviewRunDetail,
  type ReviewResultItem,
} from "@/lib/workspace-github-api";

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
    { label: "통과",      value: summary.passed,       color: "text-green-600" },
    { label: "안 맞음",  value: summary.failed,       color: "text-red-600" },
    { label: "확인 부족", value: summary.inconclusive, color: "text-yellow-600" },
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

  // ── Loading ──

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

  // ── Done ──

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
          <Link
            href={prPageUrl}
            className="text-xs text-blue-600 font-medium hover:text-blue-800 flex-shrink-0"
          >
            최신 비교 결과 보기 →
          </Link>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={prPageUrl}
          className="inline-flex items-center bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-800 transition-colors"
        >
          이 PR 다시 확인하기
        </Link>
        {actionNeeded > 0 && (
          <Link
            href={prPageUrl}
            className="inline-flex items-center bg-white border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors"
          >
            이 결과로 Fix Pack 만들기
          </Link>
        )}
        <Link
          href={prPageUrl}
          className="inline-flex items-center bg-white border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors"
        >
          이 결과로 PR comment 작성하기
        </Link>
      </div>

      {actionNeeded > 0 && (
        <p className="text-xs text-gray-400 -mt-3">
          Fix Pack과 PR comment는 현재 최신 확인 결과 기준으로 생성됩니다.
          이 이전 확인 결과를 기준으로 생성하는 기능은 Stage 36에서 추가될 예정이에요.
        </p>
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

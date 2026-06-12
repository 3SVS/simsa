"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  listProjectReviewHistory,
  type ProjectReviewHistoryItem,
} from "@/lib/workspace-github-api";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  passed:      { label: "통과",     className: "text-green-700 bg-green-50 border-green-200" },
  failed:      { label: "안 맞음", className: "text-red-700 bg-red-50 border-red-200" },
  inconclusive:{ label: "확인 부족",className: "text-yellow-700 bg-yellow-50 border-yellow-200" },
  error:       { label: "실패",     className: "text-gray-600 bg-gray-50 border-gray-200" },
  running:     { label: "실행 중", className: "text-blue-700 bg-blue-50 border-blue-200" },
  queued:      { label: "대기 중", className: "text-gray-500 bg-gray-50 border-gray-200" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? { label: status, className: "text-gray-500 bg-gray-50 border-gray-200" };
  return (
    <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 flex-shrink-0 ${c.className}`}>
      {c.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function SummaryBar({ summary }: { summary: NonNullable<ProjectReviewHistoryItem["summary"]> }) {
  const total = summary.passed + summary.failed + summary.inconclusive + summary.needsDecision;
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      {summary.passed > 0 && (
        <span className="text-green-600 font-medium">{summary.passed} 통과</span>
      )}
      {summary.failed > 0 && (
        <span className="text-red-600 font-medium">{summary.failed} 안 맞음</span>
      )}
      {summary.inconclusive > 0 && (
        <span className="text-yellow-600 font-medium">{summary.inconclusive} 확인 부족</span>
      )}
      {summary.needsDecision > 0 && (
        <span className="text-violet-600 font-medium">{summary.needsDecision} 결정 필요</span>
      )}
    </div>
  );
}

export default function ReviewHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
  const [runs, setRuns] = useState<ProjectReviewHistoryItem[]>([]);

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
    return () => { cancelled = true; };
  }, [id, userKey]);

  if (!project) return <p className="text-sm text-gray-400">프로젝트를 찾을 수 없습니다.</p>;

  // Group runs by PR number for display
  const byPr = new Map<number, ProjectReviewHistoryItem[]>();
  for (const run of runs) {
    const list = byPr.get(run.prNumber) ?? [];
    list.push(run);
    byPr.set(run.prNumber, list);
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">PR 코드 확인 기록</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            이 프로젝트의 모든 PR 코드 확인 이력을 최신순으로 보여줍니다.
          </p>
        </div>
        <Link
          href={`/projects/${id}/github`}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          ← PR 확인 화면
        </Link>
      </div>

      {/* Loading */}
      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />
          기록을 불러오는 중...
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          기록을 불러오지 못했습니다.
        </div>
      )}

      {/* Empty */}
      {phase === "done" && runs.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm font-medium text-gray-600 mb-1">아직 확인 기록이 없어요.</p>
          <p className="text-xs text-gray-400 mb-4">PR을 연결하고 코드 확인을 실행하면 여기에 쌓입니다.</p>
          <Link
            href={`/projects/${id}/github`}
            className="inline-block bg-gray-900 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors"
          >
            PR 연결 및 코드 확인 →
          </Link>
        </div>
      )}

      {/* Timeline — flat list, newest first */}
      {phase === "done" && runs.length > 0 && (
        <div className="space-y-2">
          {runs.map((run, idx) => (
            <div
              key={run.id}
              className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-start gap-3"
            >
              {/* Timeline dot */}
              <div className="flex flex-col items-center mt-1.5 flex-shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full border-2 ${
                  run.status === "passed" ? "bg-green-400 border-green-400" :
                  run.status === "failed" ? "bg-red-400 border-red-400" :
                  run.status === "inconclusive" ? "bg-yellow-400 border-yellow-400" :
                  run.status === "error" ? "bg-gray-300 border-gray-300" :
                  "bg-blue-400 border-blue-400"
                }`} />
                {idx < runs.length - 1 && (
                  <div className="w-px h-full bg-gray-100 mt-1" style={{ minHeight: 16 }} />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-gray-700 flex-shrink-0">
                      PR #{run.prNumber}
                    </span>
                    <span className="text-xs text-gray-400 truncate">{run.repoFullName}</span>
                  </div>
                  <StatusBadge status={run.status} />
                </div>

                {run.summary && <SummaryBar summary={run.summary} />}

                {run.status === "error" && run.errorMessage && (
                  <p className="text-xs text-gray-400 mt-1">오류: {run.errorMessage}</p>
                )}

                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-gray-400">{formatDate(run.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-300">
                      {run.selectedItemCount}개 항목
                    </span>
                    <Link
                      href={`/projects/${id}/github/history/${run.id}`}
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      상세 보기 →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PR-grouped summary */}
      {phase === "done" && runs.length > 0 && byPr.size > 1 && (
        <section className="mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">PR별 확인 횟수</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[...byPr.entries()].map(([prNum, prRuns]) => {
              const latest = prRuns[0];
              return (
                <div key={prNum} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-gray-700">PR #{prNum}</span>
                    {latest && <StatusBadge status={latest.status} />}
                  </div>
                  <p className="text-xs text-gray-400">총 {prRuns.length}회 확인</p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

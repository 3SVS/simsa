"use client";

// Train M-1b (2026-07-21, design locked) — "왜 이 판정인가요?" 증거 체인.
//
// 서버의 on-demand evidence pack(M-1a)을 펼침 시점에 로드해 렌더한다:
//   [확인 항목] ↔ [무엇으로 확인했나] ↔ [상태] 3열 체인
//   + 브라우저가 본 사실(측정) / Simsa의 해석("사실 아님" 라벨) 분리 (§5 불변식 2)
//   + 위험 신호 배지(하드 게이트 플래그) + 개발자용 원문(접힘)
//
// 숫자 점수 없음 — 상태 라벨만. 영어 산문(gate.reasons 등)은 비개발자 카피
// 원칙에 따라 "개발자용 상세"에만 둔다(nondev-report의 접힌 원문 패턴).

import { useState } from "react";
import { fetchRunEvidence, type RunEvidence } from "@/lib/workspace-visual-checks-api";
import type { Dictionary } from "@/i18n/dictionary.mjs";

const STATUS_CLASS: Record<string, string> = {
  verified: "bg-green-50 text-green-700 border-green-200",
  broken: "bg-red-50 text-red-700 border-red-200",
  not_verified: "bg-slate-50 text-slate-600 border-slate-200",
};

// 위험 플래그 → 비개발자 라벨은 과설명 위험 — 플래그명 자체가 기술 신호라
// 노출은 최소로: true인 하드게이트 플래그 수와 안내문만. (개별 나열은 dev 원문에.)
export function EvidenceChainSection({
  projectId,
  runId,
  userKey,
  t,
}: {
  projectId: string;
  runId: string;
  userKey: string;
  t: Dictionary;
}) {
  const s = t.visualChecks.evidence;
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [evidence, setEvidence] = useState<RunEvidence | null>(null);

  async function load() {
    if (phase === "loading" || phase === "done") return;
    setPhase("loading");
    const res = await fetchRunEvidence(projectId, runId, userKey);
    if (res.ok) {
      setEvidence(res.evidence);
      setPhase("done");
    } else {
      setPhase("error");
    }
  }

  const statusLabel = (st: string) =>
    st === "verified" ? s.statusVerified : st === "broken" ? s.statusBroken : s.statusNotVerified;

  return (
    <details
      className="rounded-lg border border-gray-100"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm">
        <span className="font-medium text-gray-700">{s.title}</span>
        <span className="ml-2 text-xs text-gray-500">{s.subtitle}</span>
      </summary>
      <div className="border-t border-gray-100 px-4 pb-4 pt-4">
        {phase === "loading" && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
            {s.loading}
          </div>
        )}
        {phase === "error" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-red-600">{s.loadError}</p>
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                void load();
              }}
              className="btn btn-sm btn-secondary flex-shrink-0"
            >
              {t.common.retry}
            </button>
          </div>
        )}
        {phase === "done" && evidence && (
          <div className="space-y-5">
            {/* 판정 상태 (로컬라이즈된 상태 라벨 — 점수 아님) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {s.decisionLabel}
              </span>
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                {s.states[evidence.gate.decision] ?? evidence.gate.decision}
              </span>
              {evidence.pack.humanGateRequired && (
                <span className="text-[11px] text-amber-700">{s.humanGate}</span>
              )}
            </div>

            {/* 3열 체인 */}
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {s.chainTitle}
              </p>
              {evidence.criteria.length === 0 ? (
                <p className="text-xs text-gray-500">{s.noCriteria}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400">
                        <th className="py-1.5 pr-3 font-medium">{s.colCriterion}</th>
                        <th className="py-1.5 pr-3 font-medium">{s.colObserved}</th>
                        <th className="py-1.5 font-medium">{s.colStatus}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {evidence.criteria.map((c) => (
                        <tr key={c.id}>
                          <td className="py-2 pr-3 text-gray-700">{c.text}</td>
                          <td className="py-2 pr-3 text-gray-500">
                            {c.observedBy.length > 0 ? c.observedBy.join(", ") : s.noObservation}
                          </td>
                          <td className="py-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[c.status]}`}
                            >
                              {statusLabel(c.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 브라우저가 본 사실 (측정만) */}
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                {s.factsTitle}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-gray-500">{s.factsWorks}</dt>
                  <dd className="font-medium text-gray-700">
                    {evidence.browserFacts.works === true
                      ? t.visualChecks.worksYes
                      : evidence.browserFacts.works === false
                        ? t.visualChecks.worksNo
                        : t.visualChecks.worksUnknown}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{s.factsConsoleErrors}</dt>
                  <dd className="font-medium text-gray-700">
                    {evidence.browserFacts.consoleErrors.length || s.factsNone}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{s.factsFailedInteractions}</dt>
                  <dd className="font-medium text-gray-700">
                    {evidence.browserFacts.failedInteractions.length || s.factsNone}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{s.factsScreenshots}</dt>
                  <dd className="font-medium text-gray-700">
                    {evidence.browserFacts.screenshotCount || s.factsNone}
                  </dd>
                </div>
              </dl>
              {evidence.browserFacts.failedInteractions.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                  {evidence.browserFacts.failedInteractions.slice(0, 5).map((f, i) => (
                    <li key={i}>· {f}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Simsa의 해석 — 사실 아님 라벨 (불변식 2) */}
            {evidence.interpretations.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {s.interpretationsTitle}
                  <span className="ml-2 normal-case tracking-normal text-amber-700">
                    {s.interpretationsNote}
                  </span>
                </p>
                <ul className="space-y-0.5 text-xs text-gray-600">
                  {evidence.interpretations.slice(0, 8).map((it, i) => (
                    <li key={i}>· {it}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 개발자용 원문 (영어 산문은 여기로 — 비개발자 카피 원칙) */}
            <details className="rounded-md border border-gray-100 bg-gray-50">
              <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-gray-500">
                {s.devDetails}
              </summary>
              <pre className="overflow-x-auto px-3 pb-3 text-[10px] leading-relaxed text-gray-600">
                {JSON.stringify(
                  {
                    decision: evidence.gate.decision,
                    reasons: evidence.gate.reasons,
                    nextSafestAction: evidence.gate.nextSafestAction,
                    notVerified: evidence.pack.notVerified,
                    riskFlags: Object.fromEntries(
                      Object.entries(evidence.pack.riskFlags).filter(([, v]) => v),
                    ),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        )}
      </div>
    </details>
  );
}

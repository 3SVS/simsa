"use client";

import { useState } from "react";
import {
  fetchCreditBalances,
  fetchCreditLedger,
  fetchCreditPreview,
  fetchMonthlyCreditPreview,
  fetchCreditConfig,
  fetchRolloutChecklist,
  fetchPendingLedger,
  markPendingFailed,
  grantCredits,
  type CreditBalance,
  type CreditType,
  type LedgerEntry,
  type PreviewResult,
  type EnforcementPreview,
  type UsageRange,
  type CreditLedgerPreviewEntry,
  type MonthlyCreditPreviewResult,
  type CreditExecutionConfigResult,
  type AdminCreditRolloutChecklistResponse,
  type RolloutCheck,
  type PendingLedgerEntry,
  type AdminPendingCreditLedgerResponse,
} from "@/lib/workspace-admin-credits-api";

const RANGE_LABELS: Record<UsageRange, string> = {
  "24h": "최근 24시간",
  "7d": "최근 7일",
  "30d": "최근 30일",
};

const CREDIT_TYPE_LABELS: Record<CreditType, string> = {
  review: "리뷰 크레딧",
  fix: "Fix 크레딧",
  workspace: "워크스페이스 크레딧",
};

const DIRECTION_LABELS: Record<string, string> = {
  grant: "지급",
  debit: "차감",
  adjustment: "조정",
  preview: "미리보기",
  preview_debit: "예상 차감",
};

const STATUS_LABELS: Record<string, string> = {
  applied: "적용됨",
  failed: "실패",
  pending: "대기 중",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
        <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function BalanceTable({ balances }: { balances: CreditBalance[] }) {
  if (balances.length === 0)
    return <p className="text-sm text-gray-500">잔액 없음.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 text-gray-500 font-medium">크레딧 유형</th>
          <th className="text-right py-1 text-gray-500 font-medium">잔액</th>
          <th className="text-right py-1 text-gray-500 font-medium">마지막 업데이트</th>
        </tr>
      </thead>
      <tbody>
        {balances.map((b) => (
          <tr key={b.creditType} className="border-b last:border-0">
            <td className="py-1">{CREDIT_TYPE_LABELS[b.creditType] ?? b.creditType}</td>
            <td className="py-1 text-right font-mono font-bold text-blue-700">{b.balance}</td>
            <td className="py-1 text-right text-gray-400">{b.updatedAt.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0)
    return <p className="text-sm text-gray-500">장부 내역 없음.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 text-gray-500 font-medium">유형</th>
          <th className="text-left py-1 text-gray-500 font-medium">방향</th>
          <th className="text-left py-1 text-gray-500 font-medium">상태</th>
          <th className="text-right py-1 text-gray-500 font-medium">금액</th>
          <th className="text-left py-1 text-gray-500 font-medium pl-3">사유</th>
          <th className="text-right py-1 text-gray-500 font-medium">날짜</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-b last:border-0">
            <td className="py-1">{CREDIT_TYPE_LABELS[e.creditType] ?? e.creditType}</td>
            <td className="py-1">
              <span
                className={
                  e.direction === "grant"
                    ? "text-green-700"
                    : e.direction === "debit"
                    ? "text-red-600"
                    : "text-gray-500"
                }
              >
                {DIRECTION_LABELS[e.direction] ?? e.direction}
              </span>
            </td>
            <td className="py-1">
              <span
                className={
                  e.status === "applied"
                    ? "text-green-700"
                    : e.status === "failed"
                    ? "text-red-500"
                    : e.status === "pending"
                    ? "text-amber-600"
                    : "text-gray-400"
                }
              >
                {STATUS_LABELS[e.status] ?? e.status ?? "—"}
              </span>
            </td>
            <td className="py-1 text-right font-mono">{e.amount}</td>
            <td className="py-1 pl-3 text-gray-600 max-w-xs truncate">{e.reason}</td>
            <td className="py-1 text-right text-gray-400">{e.createdAt.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EnforcementSummaryBanner({ ep }: { ep: EnforcementPreview }) {
  return (
    <div className="flex items-center gap-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
      <span className="text-amber-700 font-medium text-sm">Dry-run — 실제 차감 없음</span>
      <span className="text-xs text-amber-600">
        차감 시 credit 부족 예상: <strong>{ep.wouldBlockCount}</strong> / {ep.checkedEventCount}건
      </span>
    </div>
  );
}

function LedgerPreviewTable({ entries }: { entries: CreditLedgerPreviewEntry[] }) {
  if (entries.length === 0)
    return <p className="text-sm text-gray-500">billable 예상 항목 없음.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 text-gray-500 font-medium">사용자</th>
          <th className="text-left py-1 text-gray-500 font-medium">이벤트</th>
          <th className="text-right py-1 text-gray-500 font-medium">예상 차감</th>
          <th className="text-right py-1 text-gray-500 font-medium">현재 잔액</th>
          <th className="text-right py-1 text-gray-500 font-medium">차감 후 잔액</th>
          <th className="text-left py-1 text-gray-500 font-medium pl-3">차단 여부</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-b last:border-0">
            <td className="py-1 font-mono text-xs">{e.userKey}</td>
            <td className="py-1 text-xs text-gray-600">{e.eventType}</td>
            <td className="py-1 text-right font-mono font-bold text-amber-700">{e.amount}</td>
            <td className="py-1 text-right font-mono text-gray-500">{e.balance.currentBalance}</td>
            <td className="py-1 text-right font-mono">{e.balance.wouldHaveRemainingBalance}</td>
            <td className="py-1 pl-3">
              {e.balance.wouldBlockIfEnforced ? (
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">credit 부족 예상</span>
              ) : (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">충분</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PendingCleanupTable({
  entries,
  adminReason,
  onAdminReasonChange,
  onMarkFailed,
  loading,
}: {
  entries: PendingLedgerEntry[];
  adminReason: string;
  onAdminReasonChange: (v: string) => void;
  onMarkFailed: (id: string) => void;
  loading: boolean;
}) {
  if (entries.length === 0)
    return <p className="text-sm text-green-700 font-medium">오래된 pending 항목 없음 ✓</p>;
  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700">
        이 작업은 balance를 변경하지 않습니다. pending 상태를 failed로 표시해 운영상 정리하는 작업입니다.
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Admin 정리 사유 (예: Worker timeout cleanup)"
          value={adminReason}
          onChange={(e) => onAdminReasonChange(e.target.value)}
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 text-gray-500 font-medium">ID</th>
              <th className="text-left py-1 text-gray-500 font-medium">userKey</th>
              <th className="text-right py-1 text-gray-500 font-medium">금액</th>
              <th className="text-right py-1 text-gray-500 font-medium">경과(분)</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-2">sourceEventId</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-2">생성일시</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="py-1 font-mono text-xs text-gray-500">{e.id.slice(0, 12)}…</td>
                <td className="py-1 font-mono text-xs">{e.userKey}</td>
                <td className="py-1 text-right font-mono font-bold text-amber-700">{e.amount}</td>
                <td className="py-1 text-right">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${e.ageMinutes >= 60 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {e.ageMinutes}분
                  </span>
                </td>
                <td className="py-1 pl-2 font-mono text-xs text-gray-500 max-w-xs truncate">{e.sourceEventId ?? "—"}</td>
                <td className="py-1 pl-2 text-xs text-gray-400">{e.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td className="py-1 pl-2">
                  <button
                    onClick={() => onMarkFailed(e.id)}
                    disabled={loading}
                    className="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700 disabled:opacity-50"
                  >
                    failed 처리
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHECK_STATUS_STYLES: Record<string, string> = {
  passed: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  manual: "bg-gray-100 text-gray-600",
  blocked: "bg-red-100 text-red-700",
};

const CHECK_STATUS_LABELS: Record<string, string> = {
  passed: "통과",
  warning: "주의",
  manual: "수동 확인",
  blocked: "차단됨",
};

function RolloutChecklistSection({ data }: { data: AdminCreditRolloutChecklistResponse }) {
  const { productionSafety, requiredChecks, recommendedScenarios, productionEnableCriteria } = data;

  return (
    <div className="space-y-4">
      {/* Production safety banner */}
      <div
        className={`rounded-lg px-4 py-3 ${productionSafety.safeForProductionDefault ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
      >
        <p className={`text-sm font-medium ${productionSafety.safeForProductionDefault ? "text-green-700" : "text-red-700"}`}>
          {productionSafety.safeForProductionDefault
            ? "프로덕션 기본 안전 상태 — 두 flag 모두 비활성"
            : "경고: 프로덕션 flag 활성 상태 — 실제 차감/차단 가능"}
        </p>
        <div className="flex gap-4 mt-1 text-xs">
          <span className={productionSafety.actualDebitsEnabled ? "text-red-600 font-medium" : "text-gray-500"}>
            ACTUAL_DEBITS: {productionSafety.actualDebitsEnabled ? "true (활성)" : "false (비활성)"}
          </span>
          <span className={productionSafety.blockingEnabled ? "text-red-600 font-medium" : "text-gray-500"}>
            BLOCKING: {productionSafety.blockingEnabled ? "true (활성)" : "false (비활성)"}
          </span>
        </div>
      </div>

      {/* Required checks */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">필수 확인 항목</p>
        <div className="space-y-2">
          {requiredChecks.map((check: RolloutCheck) => (
            <div key={check.id} className="flex gap-3 items-start">
              <span className={`text-xs px-2 py-0.5 rounded shrink-0 mt-0.5 ${CHECK_STATUS_STYLES[check.status] ?? "bg-gray-100 text-gray-600"}`}>
                {CHECK_STATUS_LABELS[check.status] ?? check.status}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-700">{check.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{check.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended scenarios */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">권장 시나리오</p>
        <div className="space-y-2">
          {recommendedScenarios.map((s) => (
            <div key={s.id} className="border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-700">{s.label}</span>
                <span className="text-xs text-gray-400">
                  debits={String(s.flags.actualDebitsEnabled)} · blocking={String(s.flags.blockingEnabled)}
                </span>
              </div>
              <p className="text-xs text-gray-500">{s.expectedOutcome}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Production enable criteria */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">프로덕션 활성화 전 확인 기준</p>
        <ul className="space-y-1">
          {productionEnableCriteria.map((criterion, i) => (
            <li key={i} className="flex gap-2 text-xs text-gray-600">
              <span className="text-gray-400 shrink-0">{i + 1}.</span>
              <span>{criterion}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PreviewTable({ preview }: { preview: PreviewResult }) {
  return (
    <div className="space-y-3">
      {preview.enforcementPreview ? (
        <EnforcementSummaryBanner ep={preview.enforcementPreview} />
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-amber-700 font-medium text-sm">Dry-run 미리보기 — 실제 차감 없음 (actualDebitsEnabled: false)</span>
        </div>
      )}

      {preview.allowanceSummary && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-xs text-blue-700 flex gap-6">
          <span>무료 커버: <strong>{preview.allowanceSummary.totalCoveredByAllowance}</strong>회</span>
          <span>과금 후보: <strong>{preview.allowanceSummary.totalBillableAfterAllowance}</strong>회</span>
          <span className="text-blue-500">{preview.allowanceSummary.rule}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="예상 차감 크레딧" value={preview.totalEstimatedCredits} />
        <StatCard label="과금 후보 이벤트" value={preview.previewEntries.length} />
      </div>

      {preview.previewEntries.length === 0 ? (
        <p className="text-sm text-gray-500">과금 후보 이벤트 없음.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 text-gray-500 font-medium">사용자</th>
              <th className="text-left py-1 text-gray-500 font-medium">이벤트 유형</th>
              <th className="text-left py-1 text-gray-500 font-medium">크레딧 유형</th>
              <th className="text-right py-1 text-gray-500 font-medium">잔액</th>
              <th className="text-right py-1 text-gray-500 font-medium">예상 차감</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-3">무료 제공량</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-3">부족 여부</th>
            </tr>
          </thead>
          <tbody>
            {preview.previewEntries.map((e, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1 font-mono text-xs">{e.userKey}</td>
                <td className="py-1 text-xs text-gray-600">{e.eventType}</td>
                <td className="py-1">{CREDIT_TYPE_LABELS[e.creditType] ?? e.creditType}</td>
                <td className="py-1 text-right font-mono text-gray-500">
                  {e.currentBalance ?? "—"}
                </td>
                <td className="py-1 text-right font-mono font-bold text-amber-700">
                  {e.estimatedAmount}
                </td>
                <td className="py-1 pl-3 text-xs">
                  {e.allowance ? (
                    e.allowance.coveredByAllowance ? (
                      <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                        무료 ({e.allowance.periodKey})
                      </span>
                    ) : (
                      <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        초과 ({e.allowance.usedBeforeThisEvent}/{e.allowance.includedRuns})
                      </span>
                    )
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-1 pl-3">
                  {e.wouldBlockIfEnforced === true ? (
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">credit 부족 예상</span>
                  ) : e.wouldBlockIfEnforced === false ? (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">credit 충분</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview.ledgerPreview && preview.ledgerPreview.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2">Ledger 미리보기 (실제 차감 없음)</h4>
          <LedgerPreviewTable entries={preview.ledgerPreview} />
        </div>
      )}
    </div>
  );
}

function MonthlyPreviewSection({ data }: { data: MonthlyCreditPreviewResult }) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm font-semibold text-blue-800">
          이 화면은 월 무료 제공량과 credit 차감을 시뮬레이션합니다. 실제 credit은 차감되지 않습니다.
        </p>
        <p className="text-xs text-blue-600 mt-0.5">
          {data.month} · 무료 {data.allowanceRule.includedRuns}회/user · actualDebitsEnabled: false
        </p>
      </div>

      {/* Per-user table */}
      <div>
        <h4 className="text-xs font-semibold text-gray-600 mb-2">사용자별 (월 allowance 적용 후)</h4>
        {data.users.length === 0 ? (
          <p className="text-sm text-gray-500">이 달에 PR 코드 확인 이벤트가 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 text-gray-500 font-medium">userKey</th>
                <th className="text-right py-1 text-gray-500 font-medium">PR 확인 수</th>
                <th className="text-right py-1 text-gray-500 font-medium">무료 커버</th>
                <th className="text-right py-1 text-gray-500 font-medium">credit 후보</th>
                <th className="text-right py-1 text-gray-500 font-medium">예상 review credit</th>
                <th className="text-right py-1 text-gray-500 font-medium">현재 잔액</th>
                <th className="text-right py-1 text-gray-500 font-medium">차단됐을 실행</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.userKey} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-1 font-mono text-xs">{u.userKey}</td>
                  <td className="py-1 text-right">{u.totalPrReviewRuns}</td>
                  <td className="py-1 text-right text-green-700">{u.coveredByAllowance}</td>
                  <td className="py-1 text-right text-amber-700">{u.billableRuns}</td>
                  <td className="py-1 text-right font-bold text-amber-700">{u.estimatedReviewCredits}</td>
                  <td className="py-1 text-right font-mono text-gray-500">{u.currentReviewBalance}</td>
                  <td className="py-1 text-right">
                    {u.wouldBlockCount > 0 ? (
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{u.wouldBlockCount}회</span>
                    ) : (
                      <span className="text-xs text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Per-project table */}
      {data.projects.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2">프로젝트별 (user allowance 적용 후 비례 추정)</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 text-gray-500 font-medium">projectId</th>
                <th className="text-right py-1 text-gray-500 font-medium">PR 확인 수</th>
                <th className="text-right py-1 text-gray-500 font-medium">credit 후보 (추정)</th>
                <th className="text-right py-1 text-gray-500 font-medium">예상 review credit</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.projectId} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-1 font-mono text-xs">{p.projectId}</td>
                  <td className="py-1 text-right">{p.totalPrReviewRuns}</td>
                  <td className="py-1 text-right text-amber-700">{p.billableRuns}</td>
                  <td className="py-1 text-right font-bold text-amber-700">{p.estimatedReviewCredits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminCreditsPage() {
  const [adminKey, setAdminKey] = useState("");
  const [userKey, setUserKey] = useState("");
  const [range, setRange] = useState<UsageRange>("7d");

  const [balances, setBalances] = useState<CreditBalance[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const [grantType, setGrantType] = useState<CreditType>("review");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantUserKey, setGrantUserKey] = useState("");

  // Monthly preview state
  const [monthInput, setMonthInput] = useState("");
  const [monthlyUserKey, setMonthlyUserKey] = useState("");
  const [monthlyPreview, setMonthlyPreview] = useState<MonthlyCreditPreviewResult | null>(null);

  // Stage 24: credit config
  const [creditConfig, setCreditConfig] = useState<CreditExecutionConfigResult | null>(null);

  // Stage 29: rollout checklist
  const [rolloutChecklist, setRolloutChecklist] = useState<AdminCreditRolloutChecklistResponse | null>(null);

  // Stage 30: pending ledger cleanup
  const [pendingResult, setPendingResult] = useState<AdminPendingCreditLedgerResponse | null>(null);
  const [pendingMinutes, setPendingMinutes] = useState("15");
  const [pendingAdminReason, setPendingAdminReason] = useState("");
  const [markFailedSuccess, setMarkFailedSuccess] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<string | null>(null);

  function clearState() {
    setBalances(null);
    setLedger(null);
    setPreview(null);
    setMonthlyPreview(null);
    setCreditConfig(null);
    setRolloutChecklist(null);
    setPendingResult(null);
    setError(null);
    setGrantSuccess(null);
    setMarkFailedSuccess(null);
  }

  async function handleFetchConfig() {
    if (!adminKey.trim()) {
      setError("Admin key를 입력해주세요.");
      return;
    }
    setLoading(true);
    clearState();
    try {
      const result = await fetchCreditConfig(adminKey.trim());
      setCreditConfig(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyError(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "disabled") {
      setError("서버에 ADMIN_USAGE_STATS_KEY가 설정되지 않았습니다.");
    } else if (msg === "unauthorized") {
      setError("Admin key가 올바르지 않습니다.");
    } else {
      setError(msg);
    }
  }

  async function handleFetchBalances() {
    if (!adminKey.trim() || !userKey.trim()) {
      setError("Admin key와 userKey를 입력해주세요.");
      return;
    }
    setLoading(true);
    clearState();
    try {
      const result = await fetchCreditBalances(adminKey.trim(), userKey.trim());
      setBalances(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchLedger() {
    if (!adminKey.trim() || !userKey.trim()) {
      setError("Admin key와 userKey를 입력해주세요.");
      return;
    }
    setLoading(true);
    clearState();
    try {
      const result = await fetchCreditLedger(adminKey.trim(), userKey.trim());
      setLedger(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    if (!adminKey.trim()) {
      setError("Admin key를 입력해주세요.");
      return;
    }
    setLoading(true);
    clearState();
    try {
      const result = await fetchCreditPreview(
        adminKey.trim(),
        range,
        userKey.trim() || undefined,
      );
      setPreview(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleMonthlyPreview() {
    if (!adminKey.trim()) {
      setError("Admin key를 입력해주세요.");
      return;
    }
    setLoading(true);
    clearState();
    try {
      const result = await fetchMonthlyCreditPreview(
        adminKey.trim(),
        monthInput.trim() || undefined,
        monthlyUserKey.trim() || undefined,
      );
      setMonthlyPreview(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleGrant() {
    const key = adminKey.trim();
    const uk = grantUserKey.trim();
    const reason = grantReason.trim();
    const amount = parseInt(grantAmount, 10);

    if (!key) { setError("Admin key를 입력해주세요."); return; }
    if (!uk) { setError("지급 대상 userKey를 입력해주세요."); return; }
    if (!reason) { setError("지급 사유를 입력해주세요."); return; }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("금액은 1 이상의 정수여야 합니다.");
      return;
    }

    setLoading(true);
    setError(null);
    setGrantSuccess(null);
    try {
      const result = await grantCredits(key, {
        userKey: uk,
        creditType: grantType,
        amount,
        reason,
      });
      setGrantSuccess(
        `지급 완료: ${uk} → ${CREDIT_TYPE_LABELS[result.balance.creditType]} ${result.balance.balance}개 (잔액)`,
      );
      setGrantAmount("");
      setGrantReason("");
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchPendingLedger() {
    if (!adminKey.trim()) { setError("Admin key를 입력해주세요."); return; }
    setLoading(true);
    clearState();
    try {
      const minutes = parseInt(pendingMinutes, 10);
      const result = await fetchPendingLedger(adminKey.trim(), {
        olderThanMinutes: Number.isFinite(minutes) ? minutes : 15,
      });
      setPendingResult(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkFailed(entryId: string) {
    if (!adminKey.trim()) { setError("Admin key를 입력해주세요."); return; }
    const reason = pendingAdminReason.trim() || "manual admin cleanup";
    setLoading(true);
    setError(null);
    setMarkFailedSuccess(null);
    try {
      await markPendingFailed(adminKey.trim(), entryId, reason);
      setMarkFailedSuccess(`failed 처리됨: ${entryId}`);
      // Re-fetch to show updated state
      const minutes = parseInt(pendingMinutes, 10);
      const updated = await fetchPendingLedger(adminKey.trim(), {
        olderThanMinutes: Number.isFinite(minutes) ? minutes : 15,
      });
      setPendingResult(updated);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchRolloutChecklist() {
    if (!adminKey.trim()) {
      setError("Admin key를 입력해주세요.");
      return;
    }
    setLoading(true);
    clearState();
    try {
      const result = await fetchRolloutChecklist(adminKey.trim());
      setRolloutChecklist(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Credit 관리</h1>
        <p className="text-sm text-gray-500 mt-1">
          운영자 전용 — 잔액 조회, 수동 지급, 장부 확인, Dry-run 미리보기
        </p>
      </div>

      {/* Auth */}
      <SectionCard title="Admin Key">
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="ADMIN_USAGE_STATS_KEY 입력"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </SectionCard>

      {/* Stage 24/31: Credit Execution Config */}
      <SectionCard title="Credit 실행 설정 (Stage 24/31)">
        <div className="space-y-3">
          <button
            onClick={handleFetchConfig}
            disabled={loading}
            className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            설정 확인
          </button>
          {creditConfig && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-4 items-center">
                <span className={`text-xs font-mono px-2 py-1 rounded ${creditConfig.actualDebitsEnabled ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                  ENABLE_ACTUAL_CREDIT_DEBITS: {creditConfig.envFlags.ENABLE_ACTUAL_CREDIT_DEBITS}
                  {" "}→ actualDebitsEnabled: {String(creditConfig.actualDebitsEnabled)}
                </span>
              </div>
              <div className="flex gap-4 items-center">
                <span className={`text-xs font-mono px-2 py-1 rounded ${creditConfig.blockingEnabled ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                  ENABLE_CREDIT_BLOCKING: {creditConfig.envFlags.ENABLE_CREDIT_BLOCKING}
                  {" "}→ blockingEnabled: {String(creditConfig.blockingEnabled)}
                </span>
              </div>
              {/* Stage 31: limited rollout allowlist */}
              {creditConfig.limitedRollout !== undefined && (
                <div className={`text-xs font-mono px-2 py-1 rounded ${creditConfig.limitedRollout.allowedUserKeyCount > 0 ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                  <div>
                    ACTUAL_DEBIT_ALLOWED_USER_KEYS: {creditConfig.envFlags.ACTUAL_DEBIT_ALLOWED_USER_KEYS ?? "(unset)"}
                    {" "}→ {creditConfig.limitedRollout.allowedUserKeyCount}명 등록
                  </div>
                  {creditConfig.limitedRollout.allowedUserKeysPreview.length > 0 && (
                    <div className="mt-1 text-blue-600">
                      미리보기: {creditConfig.limitedRollout.allowedUserKeysPreview.join(", ")}
                      {creditConfig.limitedRollout.allowedUserKeyCount > 5 ? " ..." : ""}
                    </div>
                  )}
                  {creditConfig.limitedRollout.enabled ? (
                    <div className="mt-1 text-blue-700 font-semibold">제한적 actual debit 활성 (allowlist 한정)</div>
                  ) : creditConfig.actualDebitsEnabled && creditConfig.limitedRollout.allowedUserKeyCount === 0 ? (
                    <div className="mt-1 text-amber-600 font-semibold">경고: actualDebitsEnabled=true지만 allowlist가 비어 있어 실제 차감 없음</div>
                  ) : null}
                </div>
              )}
              {!creditConfig.actualDebitsEnabled && (
                <p className="text-xs text-gray-500">현재 dry-run 모드: 실제 차감 없음, 실행 차단 없음</p>
              )}
              {creditConfig.actualDebitsEnabled && !creditConfig.blockingEnabled && (
                <p className="text-xs text-amber-600">실제 차감 활성 · 차단 비활성: credit이 차감되지만 실행은 차단되지 않음</p>
              )}
              {creditConfig.actualDebitsEnabled && creditConfig.blockingEnabled && (
                <p className="text-xs text-red-600 font-medium">실제 차감 + 차단 모두 활성: credit 부족 시 HTTP 402 반환</p>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {grantSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
          {grantSuccess}
        </div>
      )}

      {/* Balance + Ledger lookup */}
      <SectionCard title="잔액 · 장부 조회">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="userKey (예: gh:octocat)"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleFetchBalances}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              잔액 조회
            </button>
            <button
              onClick={handleFetchLedger}
              disabled={loading}
              className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              장부 조회
            </button>
          </div>
          {balances !== null && (
            <div className="pt-2">
              <p className="text-xs text-gray-400 mb-2">userKey: {userKey}</p>
              <BalanceTable balances={balances} />
            </div>
          )}
          {ledger !== null && (
            <div className="pt-2">
              <p className="text-xs text-gray-400 mb-2">userKey: {userKey} — 최근 50건</p>
              <LedgerTable entries={ledger} />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Manual grant */}
      <SectionCard title="수동 크레딧 지급">
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="지급 대상 userKey"
              value={grantUserKey}
              onChange={(e) => setGrantUserKey(e.target.value)}
              className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={grantType}
              onChange={(e) => setGrantType(e.target.value as CreditType)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="review">리뷰 크레딧</option>
              <option value="fix">Fix 크레딧</option>
              <option value="workspace">워크스페이스 크레딧</option>
            </select>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="금액"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              className="w-24 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="지급 사유 (예: 베타 환영 지급)"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleGrant}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
            >
              지급
            </button>
          </div>
          <p className="text-xs text-gray-400">
            ※ 지급은 실제로 잔액 테이블에 기록됩니다. 취소 불가.
          </p>
        </div>
      </SectionCard>

      {/* Dry-run preview */}
      <SectionCard title="Dry-run 차감 미리보기">
        <div className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as UsageRange)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(["24h", "7d", "30d"] as UsageRange[]).map((r) => (
                <option key={r} value={r}>{RANGE_LABELS[r]}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="userKey 필터 (선택)"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handlePreview}
              disabled={loading}
              className="bg-amber-600 text-white px-4 py-2 rounded text-sm hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
            >
              미리보기
            </button>
          </div>
          {preview && <PreviewTable preview={preview} />}
        </div>
      </SectionCard>

      {/* Monthly credit preview */}
      <SectionCard title="월별 Credit 미리보기">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            특정 달의 PR 확인 횟수, 무료 제공량 적용 후 예상 credit 부담을 사용자/프로젝트별로 확인합니다.
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              placeholder="월 (예: 2026-06, 기본값: 이번 달)"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="userKey 필터 (선택)"
              value={monthlyUserKey}
              onChange={(e) => setMonthlyUserKey(e.target.value)}
              className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleMonthlyPreview}
              disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
            >
              월별 조회
            </button>
          </div>
          {monthlyPreview && <MonthlyPreviewSection data={monthlyPreview} />}
        </div>
      </SectionCard>

      {/* Pending ledger cleanup */}
      <SectionCard title="Pending Ledger 수동 정리 (Stage 30)">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            오래된 status=pending debit 항목을 조회하고, balance 변경 없이 failed로 수동 정리합니다.
            pending 상태가 오래 유지되면 Worker 중간 실패(timeout 등) 가능성이 있습니다.
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-sm text-gray-600 whitespace-nowrap">기준 시간(분):</label>
            <select
              value={pendingMinutes}
              onChange={(e) => setPendingMinutes(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="15">15분 이상</option>
              <option value="30">30분 이상</option>
              <option value="60">60분 이상</option>
            </select>
            <button
              onClick={handleFetchPendingLedger}
              disabled={loading}
              className="bg-amber-600 text-white px-4 py-2 rounded text-sm hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
            >
              Pending 조회
            </button>
          </div>
          {markFailedSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-2 text-sm">
              {markFailedSuccess}
            </div>
          )}
          {pendingResult && (
            <PendingCleanupTable
              entries={pendingResult.entries}
              adminReason={pendingAdminReason}
              onAdminReasonChange={setPendingAdminReason}
              onMarkFailed={handleMarkFailed}
              loading={loading}
            />
          )}
        </div>
      </SectionCard>

      {/* Stage 32: Internal Actual Debit Test Run Guide */}
      <SectionCard title="내부 Actual Debit 테스트 실행 가이드 (Stage 32)">
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3">
            <p className="text-xs font-bold text-red-700">⚠ 테스트 종료 후 ENABLE_ACTUAL_CREDIT_DEBITS를 반드시 false로 되돌리세요.</p>
            <p className="text-xs text-red-600 mt-1">flag를 켠 상태로 두면 allowlist에 등록된 모든 사용자에게 실제 credit이 차감됩니다.</p>
          </div>
          <div className="space-y-1 text-xs text-gray-700">
            <p className="font-semibold text-gray-800 mb-2">테스트 절차:</p>
            <ol className="list-decimal list-inside space-y-1.5 pl-1">
              <li>
                <span className="font-medium">ACTUAL_DEBIT_ALLOWED_USER_KEYS에 내부 userKey 등록</span>
                <p className="text-gray-500 pl-5 mt-0.5">예: <code className="bg-gray-100 px-1 rounded">ACTUAL_DEBIT_ALLOWED_USER_KEYS = &quot;gh:yourtestaccount&quot;</code></p>
              </li>
              <li>
                <span className="font-medium">ENABLE_ACTUAL_CREDIT_DEBITS=true 설정 후 wrangler deploy</span>
                <p className="text-gray-500 pl-5 mt-0.5">wrangler.toml 수정 → deploy</p>
              </li>
              <li>
                <span className="font-medium">ENABLE_CREDIT_BLOCKING=false 유지 (기본 테스트 모드)</span>
                <p className="text-gray-500 pl-5 mt-0.5">잔액 부족 시에도 실행 차단하지 않음</p>
              </li>
              <li>
                <span className="font-medium">아래 &quot;수동 크레딧 지급&quot;으로 review credit 지급</span>
                <p className="text-gray-500 pl-5 mt-0.5">userKey=내부계정, type=review, amount=5 권장</p>
              </li>
              <li>
                <span className="font-medium">PR review 실행 (월 5회 allowance 소진 후)</span>
                <p className="text-gray-500 pl-5 mt-0.5">allowance 소진 전에는 credit이 차감되지 않음</p>
              </li>
              <li>
                <span className="font-medium">아래 &quot;장부 조회&quot;에서 ledger status=applied 확인</span>
              </li>
              <li>
                <span className="font-medium">아래 &quot;잔액 조회&quot;에서 balance 감소 확인</span>
              </li>
              <li>
                <span className="font-medium text-red-600">테스트 후 ENABLE_ACTUAL_CREDIT_DEBITS를 false로 복구 후 재배포</span>
              </li>
            </ol>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-xs text-amber-700 font-medium">failed pending 또는 duplicate failed 발생 시:</p>
            <p className="text-xs text-amber-600 mt-1">
              같은 Idempotency-Key 재시도 대신, 새 PR review를 실행하여 새 Idempotency-Key를 생성해야 합니다.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Rollout checklist */}
      <SectionCard title="프로덕션 활성화 체크리스트 (Stage 29)">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            실제 credit 차감/차단을 활성화하기 전 필수 확인 항목 및 운영 가이드입니다. 현재 flag 상태를 자동 감지합니다.
          </p>
          <button
            onClick={handleFetchRolloutChecklist}
            disabled={loading}
            className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
          >
            체크리스트 조회
          </button>
          {rolloutChecklist && <RolloutChecklistSection data={rolloutChecklist} />}
        </div>
      </SectionCard>

      {/* Free allowance policy notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-sm font-medium text-blue-700 mb-1">무료 허용 정책 (현행)</p>
        <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
          <li>PR 코드 확인 (workspace_pr_review_run) — 월 5회 무료 후 과금 후보 (1 크레딧/회)</li>
          <li>제품 설명서 생성, 확인, 패키지 내보내기 — 무료 포함</li>
          <li>PR 코멘트, Telegram 알림 — 무료 포함</li>
          <li>실제 과금은 미구현 (actualDebitsEnabled: false 고정)</li>
        </ul>
      </div>

      {loading && (
        <div className="text-sm text-gray-500 text-center py-2">로딩 중...</div>
      )}
    </div>
  );
}

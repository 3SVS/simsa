"use client";

import { useState } from "react";
import {
  fetchCreditBalances,
  fetchCreditLedger,
  fetchCreditPreview,
  fetchMonthlyCreditPreview,
  grantCredits,
  type CreditBalance,
  type CreditType,
  type LedgerEntry,
  type PreviewResult,
  type EnforcementPreview,
  type UsageRange,
  type CreditLedgerPreviewEntry,
  type MonthlyCreditPreviewResult,
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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<string | null>(null);

  function clearState() {
    setBalances(null);
    setLedger(null);
    setPreview(null);
    setMonthlyPreview(null);
    setError(null);
    setGrantSuccess(null);
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

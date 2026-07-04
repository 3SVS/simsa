"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionary.mjs";
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
  fetchAdminTopUpRequests,
  fulfillAdminTopUpRequest,
  rejectAdminTopUpRequest,
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
  type AdminTopUpRequest,
} from "@/lib/workspace-admin-credits-api";

function rangeLabel(t: Dictionary, v: UsageRange): string {
  if (v === "24h") return t.adminCredits.range24h;
  if (v === "7d") return t.adminCredits.range7d;
  return t.adminCredits.range30d;
}

function creditTypeLabel(t: Dictionary, v: CreditType): string {
  if (v === "review") return t.adminCredits.creditTypeReview;
  if (v === "fix") return t.adminCredits.creditTypeFix;
  return t.adminCredits.creditTypeWorkspace;
}

function directionLabel(t: Dictionary, v: string): string {
  if (v === "grant") return t.adminCredits.directionGrant;
  if (v === "debit") return t.adminCredits.directionDebit;
  if (v === "adjustment") return t.adminCredits.directionAdjustment;
  if (v === "preview") return t.adminCredits.directionPreview;
  if (v === "preview_debit") return t.adminCredits.directionPreviewDebit;
  return v;
}

function statusLabelText(t: Dictionary, v: string | null | undefined): string {
  if (v === "applied") return t.adminCredits.statusApplied;
  if (v === "failed") return t.adminCredits.statusFailed;
  if (v === "pending") return t.adminCredits.statusPending;
  return v ?? "—";
}

function checkStatusLabel(t: Dictionary, v: string): string {
  if (v === "passed") return t.adminCredits.checkPassed;
  if (v === "warning") return t.adminCredits.checkWarning;
  if (v === "manual") return t.adminCredits.checkManual;
  if (v === "blocked") return t.adminCredits.checkBlocked;
  return v;
}

const CHECK_STATUS_STYLES: Record<string, string> = {
  passed: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  manual: "bg-gray-100 text-gray-600",
  blocked: "bg-red-100 text-red-700",
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
  const { t } = useI18n();
  if (balances.length === 0)
    return <p className="text-sm text-gray-500">{t.adminCredits.noBalance}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colCreditType}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colBalance}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colLastUpdated}</th>
        </tr>
      </thead>
      <tbody>
        {balances.map((b) => (
          <tr key={b.creditType} className="border-b last:border-0">
            <td className="py-1">{creditTypeLabel(t, b.creditType)}</td>
            <td className="py-1 text-right font-mono font-bold text-indigo-700">{b.balance}</td>
            <td className="py-1 text-right text-gray-500">{b.updatedAt.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  const { t } = useI18n();
  if (entries.length === 0)
    return <p className="text-sm text-gray-500">{t.adminCredits.noLedger}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colType}</th>
          <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colDirection}</th>
          <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colStatus}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colAmount}</th>
          <th className="text-left py-1 text-gray-500 font-medium pl-3">{t.adminCredits.colReason}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colDate}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-b last:border-0">
            <td className="py-1">{creditTypeLabel(t, e.creditType)}</td>
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
                {directionLabel(t, e.direction)}
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
                    : "text-gray-500"
                }
              >
                {statusLabelText(t, e.status)}
              </span>
            </td>
            <td className="py-1 text-right font-mono">{e.amount}</td>
            <td className="py-1 pl-3 text-gray-600 max-w-xs truncate">{e.reason}</td>
            <td className="py-1 text-right text-gray-500">{e.createdAt.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EnforcementSummaryBanner({ ep }: { ep: EnforcementPreview }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
      <span className="text-amber-700 font-medium text-sm">{t.adminCredits.dryRunNoDebit}</span>
      <span className="text-xs text-amber-600">
        {t.adminCredits.estInsufficientPrefix}<strong>{ep.wouldBlockCount}</strong>{t.adminCredits.estInsufficientSuffix.replace("{n}", String(ep.checkedEventCount))}
      </span>
    </div>
  );
}

function LedgerPreviewTable({ entries }: { entries: CreditLedgerPreviewEntry[] }) {
  const { t } = useI18n();
  if (entries.length === 0)
    return <p className="text-sm text-gray-500">{t.adminCredits.noBillablePreview}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colUser}</th>
          <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colEvent}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colEstDebit}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colCurrentBalance}</th>
          <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colBalanceAfterDebit}</th>
          <th className="text-left py-1 text-gray-500 font-medium pl-3">{t.adminCredits.colBlocked}</th>
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
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t.adminCredits.creditShortfallExpected}</span>
              ) : (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{t.adminCredits.sufficient}</span>
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
  const { t } = useI18n();
  if (entries.length === 0)
    return <p className="text-sm text-green-700 font-medium">{t.adminCredits.noOldPending}</p>;
  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700">
        {t.adminCredits.pendingNoBalanceChange}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder={t.adminCredits.adminReasonPlaceholder}
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
              <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colAmount}</th>
              <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colAgeMinutes}</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-2">sourceEventId</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-2">{t.adminCredits.colCreatedAt}</th>
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
                    {t.adminCredits.ageMinutesSuffix.replace("{n}", String(e.ageMinutes))}
                  </span>
                </td>
                <td className="py-1 pl-2 font-mono text-xs text-gray-500 max-w-xs truncate">{e.sourceEventId ?? "—"}</td>
                <td className="py-1 pl-2 text-xs text-gray-500">{e.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td className="py-1 pl-2">
                  <button
                    onClick={() => onMarkFailed(e.id)}
                    disabled={loading}
                    className="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700 disabled:opacity-50"
                  >
                    {t.adminCredits.markFailed}
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

function RolloutChecklistSection({ data }: { data: AdminCreditRolloutChecklistResponse }) {
  const { t } = useI18n();
  const { productionSafety, requiredChecks, recommendedScenarios, productionEnableCriteria } = data;

  return (
    <div className="space-y-4">
      {/* Production safety banner */}
      <div
        className={`rounded-lg px-4 py-3 ${productionSafety.safeForProductionDefault ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
      >
        <p className={`text-sm font-medium ${productionSafety.safeForProductionDefault ? "text-green-700" : "text-red-700"}`}>
          {productionSafety.safeForProductionDefault
            ? t.adminCredits.prodSafeDefault
            : t.adminCredits.prodWarningFlagsActive}
        </p>
        <div className="flex gap-4 mt-1 text-xs">
          <span className={productionSafety.actualDebitsEnabled ? "text-red-600 font-medium" : "text-gray-500"}>
            ACTUAL_DEBITS: {productionSafety.actualDebitsEnabled ? t.adminCredits.flagActive : t.adminCredits.flagInactive}
          </span>
          <span className={productionSafety.blockingEnabled ? "text-red-600 font-medium" : "text-gray-500"}>
            BLOCKING: {productionSafety.blockingEnabled ? t.adminCredits.flagActive : t.adminCredits.flagInactive}
          </span>
        </div>
      </div>

      {/* Required checks */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">{t.adminCredits.requiredChecksTitle}</p>
        <div className="space-y-2">
          {requiredChecks.map((check: RolloutCheck) => (
            <div key={check.id} className="flex gap-3 items-start">
              <span className={`text-xs px-2 py-0.5 rounded shrink-0 mt-0.5 ${CHECK_STATUS_STYLES[check.status] ?? "bg-gray-100 text-gray-600"}`}>
                {checkStatusLabel(t, check.status)}
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
        <p className="text-xs font-medium text-gray-500 mb-2">{t.adminCredits.recommendedScenariosTitle}</p>
        <div className="space-y-2">
          {recommendedScenarios.map((s) => (
            <div key={s.id} className="border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-700">{s.label}</span>
                <span className="text-xs text-gray-500">
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
        <p className="text-xs font-medium text-gray-500 mb-2">{t.adminCredits.prodEnableCriteriaTitle}</p>
        <ul className="space-y-1">
          {productionEnableCriteria.map((criterion, i) => (
            <li key={i} className="flex gap-2 text-xs text-gray-600">
              <span className="text-gray-500 shrink-0">{i + 1}.</span>
              <span>{criterion}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PreviewTable({ preview }: { preview: PreviewResult }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {preview.enforcementPreview ? (
        <EnforcementSummaryBanner ep={preview.enforcementPreview} />
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-amber-700 font-medium text-sm">{t.adminCredits.dryRunPreviewNoDebit}</span>
        </div>
      )}

      {preview.allowanceSummary && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 text-xs text-indigo-700 flex gap-6">
          <span>{t.adminCredits.allowanceFreeCover}<strong>{preview.allowanceSummary.totalCoveredByAllowance}</strong>{t.adminCredits.allowanceFreeCoverSuffix.replace("{n}", "")}</span>
          <span>{t.adminCredits.allowanceBillableCandidate}<strong>{preview.allowanceSummary.totalBillableAfterAllowance}</strong>{t.adminCredits.allowanceBillableCandidateSuffix.replace("{n}", "")}</span>
          <span className="text-indigo-500">{preview.allowanceSummary.rule}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t.adminCredits.estDebitCredits} value={preview.totalEstimatedCredits} />
        <StatCard label={t.adminCredits.billableCandidateEvents} value={preview.previewEntries.length} />
      </div>

      {preview.previewEntries.length === 0 ? (
        <p className="text-sm text-gray-500">{t.adminCredits.noBillableEvents}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colUser}</th>
              <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colEventType}</th>
              <th className="text-left py-1 text-gray-500 font-medium">{t.adminCredits.colCreditType}</th>
              <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colBalance}</th>
              <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colEstDebit}</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-3">{t.adminCredits.colFreeAllowance}</th>
              <th className="text-left py-1 text-gray-500 font-medium pl-3">{t.adminCredits.colShortfall}</th>
            </tr>
          </thead>
          <tbody>
            {preview.previewEntries.map((e, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1 font-mono text-xs">{e.userKey}</td>
                <td className="py-1 text-xs text-gray-600">{e.eventType}</td>
                <td className="py-1">{creditTypeLabel(t, e.creditType)}</td>
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
                        {t.adminCredits.allowanceFree} ({e.allowance.periodKey})
                      </span>
                    ) : (
                      <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        {t.adminCredits.allowanceOver} ({e.allowance.usedBeforeThisEvent}/{e.allowance.includedRuns})
                      </span>
                    )
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
                <td className="py-1 pl-3">
                  {e.wouldBlockIfEnforced === true ? (
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t.adminCredits.creditShortfallExpectedShort}</span>
                  ) : e.wouldBlockIfEnforced === false ? (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{t.adminCredits.creditSufficient}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview.ledgerPreview && preview.ledgerPreview.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2">{t.adminCredits.ledgerPreviewTitle}</h4>
          <LedgerPreviewTable entries={preview.ledgerPreview} />
        </div>
      )}
    </div>
  );
}

function MonthlyPreviewSection({ data }: { data: MonthlyCreditPreviewResult }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
        <p className="text-sm font-semibold text-indigo-800">
          {t.adminCredits.monthlySimNotice}
        </p>
        <p className="text-xs text-indigo-600 mt-0.5">
          {data.month} · {t.adminCredits.monthlyFreePerUser.replace("{n}", String(data.allowanceRule.includedRuns))} · actualDebitsEnabled: false
        </p>
      </div>

      {/* Per-user table */}
      <div>
        <h4 className="text-xs font-semibold text-gray-600 mb-2">{t.adminCredits.perUserTitle}</h4>
        {data.users.length === 0 ? (
          <p className="text-sm text-gray-500">{t.adminCredits.noPrReviewEvents}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 text-gray-500 font-medium">userKey</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colPrReviewCount}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colFreeCover}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colCreditCandidate}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colEstReviewCredit}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colCurrentBalance}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colWouldBlockRuns}</th>
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
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t.adminCredits.countSuffix.replace("{n}", String(u.wouldBlockCount))}</span>
                    ) : (
                      <span className="text-xs text-gray-500">0</span>
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
          <h4 className="text-xs font-semibold text-gray-600 mb-2">{t.adminCredits.perProjectTitle}</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 text-gray-500 font-medium">projectId</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colPrReviewCount}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colCreditCandidateEst}</th>
                <th className="text-right py-1 text-gray-500 font-medium">{t.adminCredits.colEstReviewCredit}</th>
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
  const { t } = useI18n();
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

  // Stage 33: top-up requests
  const [topUpRequests, setTopUpRequests] = useState<AdminTopUpRequest[] | null>(null);
  const [topUpStatusFilter, setTopUpStatusFilter] = useState("requested");
  const [topUpAdminNotes, setTopUpAdminNotes] = useState<Record<string, string>>({});
  const [topUpActionSuccess, setTopUpActionSuccess] = useState<string | null>(null);

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
    setTopUpRequests(null);
    setTopUpActionSuccess(null);
  }

  async function handleFetchConfig() {
    if (!adminKey.trim()) {
      setError(t.adminCredits.errAdminKeyRequired);
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
      setError(t.adminCredits.errDisabled);
    } else if (msg === "unauthorized") {
      setError(t.adminCredits.errUnauthorized);
    } else {
      setError(msg);
    }
  }

  async function handleFetchBalances() {
    if (!adminKey.trim() || !userKey.trim()) {
      setError(t.adminCredits.errAdminKeyAndUserKeyRequired);
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
      setError(t.adminCredits.errAdminKeyAndUserKeyRequired);
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
      setError(t.adminCredits.errAdminKeyRequired);
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
      setError(t.adminCredits.errAdminKeyRequired);
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

    if (!key) { setError(t.adminCredits.errAdminKeyRequired); return; }
    if (!uk) { setError(t.adminCredits.errGrantUserKeyRequired); return; }
    if (!reason) { setError(t.adminCredits.errGrantReasonRequired); return; }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError(t.adminCredits.errAmountPositiveInteger);
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
        t.adminCredits.grantSuccess
          .replace("{user}", uk)
          .replace("{type}", creditTypeLabel(t, result.balance.creditType))
          .replace("{amount}", String(result.balance.balance)),
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
    if (!adminKey.trim()) { setError(t.adminCredits.errAdminKeyRequired); return; }
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
    if (!adminKey.trim()) { setError(t.adminCredits.errAdminKeyRequired); return; }
    const reason = pendingAdminReason.trim() || "manual admin cleanup";
    setLoading(true);
    setError(null);
    setMarkFailedSuccess(null);
    try {
      await markPendingFailed(adminKey.trim(), entryId, reason);
      setMarkFailedSuccess(t.adminCredits.markFailedSuccess.replace("{id}", entryId));
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

  async function handleFetchTopUpRequests() {
    if (!adminKey.trim()) { setError(t.adminCredits.errAdminKeyRequired); return; }
    setLoading(true);
    setError(null);
    setTopUpActionSuccess(null);
    try {
      const result = await fetchAdminTopUpRequests(adminKey.trim(), topUpStatusFilter || undefined);
      setTopUpRequests(result);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleFulfillTopUp(id: string) {
    if (!adminKey.trim()) { setError(t.adminCredits.errAdminKeyRequired); return; }
    setLoading(true);
    setError(null);
    try {
      const adminNote = topUpAdminNotes[id]?.trim();
      const result = await fulfillAdminTopUpRequest(adminKey.trim(), id, adminNote);
      setTopUpActionSuccess(
        t.adminCredits.topUpFulfillSuccess
          .replace("{user}", result.request.userKey)
          .replace("{amount}", String(result.request.requestedAmount))
          .replace("{balance}", String(result.newBalance)),
      );
      const updated = await fetchAdminTopUpRequests(adminKey.trim(), topUpStatusFilter || undefined);
      setTopUpRequests(updated);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRejectTopUp(id: string) {
    if (!adminKey.trim()) { setError(t.adminCredits.errAdminKeyRequired); return; }
    setLoading(true);
    setError(null);
    try {
      const adminNote = topUpAdminNotes[id]?.trim();
      await rejectAdminTopUpRequest(adminKey.trim(), id, adminNote);
      setTopUpActionSuccess(t.adminCredits.topUpRejectSuccess.replace("{id}", id));
      const updated = await fetchAdminTopUpRequests(adminKey.trim(), topUpStatusFilter || undefined);
      setTopUpRequests(updated);
    } catch (e) {
      handleKeyError(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchRolloutChecklist() {
    if (!adminKey.trim()) {
      setError(t.adminCredits.errAdminKeyRequired);
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
        <h1 className="text-2xl font-bold text-gray-800">{t.adminCredits.pageTitle}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t.adminCredits.pageIntro}
        </p>
      </div>

      {/* Auth */}
      <SectionCard title={t.adminCredits.adminKeySection}>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder={t.adminCredits.adminKeyPlaceholder}
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </SectionCard>

      {/* Stage 24/31: Credit Execution Config */}
      <SectionCard title={t.adminCredits.creditConfigSection}>
        <div className="space-y-3">
          <button
            onClick={handleFetchConfig}
            disabled={loading}
            className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {t.adminCredits.checkConfig}
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
                <div className={`text-xs font-mono px-2 py-1 rounded ${creditConfig.limitedRollout.allowedUserKeyCount > 0 ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-600"}`}>
                  <div>
                    ACTUAL_DEBIT_ALLOWED_USER_KEYS: {creditConfig.envFlags.ACTUAL_DEBIT_ALLOWED_USER_KEYS ?? "(unset)"}
                    {" "}→ {t.adminCredits.rolloutRegistered.replace("{n}", String(creditConfig.limitedRollout.allowedUserKeyCount))}
                  </div>
                  {creditConfig.limitedRollout.allowedUserKeysPreview.length > 0 && (
                    <div className="mt-1 text-indigo-600">
                      {t.adminCredits.rolloutPreview}{creditConfig.limitedRollout.allowedUserKeysPreview.join(", ")}
                      {creditConfig.limitedRollout.allowedUserKeyCount > 5 ? " ..." : ""}
                    </div>
                  )}
                  {creditConfig.limitedRollout.enabled ? (
                    <div className="mt-1 text-indigo-700 font-semibold">{t.adminCredits.rolloutLimitedActive}</div>
                  ) : creditConfig.actualDebitsEnabled && creditConfig.limitedRollout.allowedUserKeyCount === 0 ? (
                    <div className="mt-1 text-amber-600 font-semibold">{t.adminCredits.rolloutWarningEmptyAllowlist}</div>
                  ) : null}
                </div>
              )}
              {!creditConfig.actualDebitsEnabled && (
                <p className="text-xs text-gray-500">{t.adminCredits.configDryRunMode}</p>
              )}
              {creditConfig.actualDebitsEnabled && !creditConfig.blockingEnabled && (
                <p className="text-xs text-amber-600">{t.adminCredits.configDebitNoBlock}</p>
              )}
              {creditConfig.actualDebitsEnabled && creditConfig.blockingEnabled && (
                <p className="text-xs text-red-600 font-medium">{t.adminCredits.configDebitAndBlock}</p>
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
      <SectionCard title={t.adminCredits.balanceLedgerSection}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t.adminCredits.userKeyPlaceholder}
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleFetchBalances}
              disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {t.adminCredits.fetchBalance}
            </button>
            <button
              onClick={handleFetchLedger}
              disabled={loading}
              className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {t.adminCredits.fetchLedger}
            </button>
          </div>
          {balances !== null && (
            <div className="pt-2">
              <p className="text-xs text-gray-500 mb-2">userKey: {userKey}</p>
              <BalanceTable balances={balances} />
            </div>
          )}
          {ledger !== null && (
            <div className="pt-2">
              <p className="text-xs text-gray-500 mb-2">userKey: {userKey} — {t.adminCredits.recentEntries.replace("{n}", "50")}</p>
              <LedgerTable entries={ledger} />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Manual grant */}
      <SectionCard title={t.adminCredits.manualGrantSection}>
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder={t.adminCredits.grantUserKeyPlaceholder}
              value={grantUserKey}
              onChange={(e) => setGrantUserKey(e.target.value)}
              className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={grantType}
              onChange={(e) => setGrantType(e.target.value as CreditType)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="review">{t.adminCredits.creditTypeReview}</option>
              <option value="fix">{t.adminCredits.creditTypeFix}</option>
              <option value="workspace">{t.adminCredits.creditTypeWorkspace}</option>
            </select>
            <input
              type="number"
              min="1"
              step="1"
              placeholder={t.adminCredits.amountPlaceholder}
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              className="w-24 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t.adminCredits.grantReasonPlaceholder}
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleGrant}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
            >
              {t.adminCredits.grant}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {t.adminCredits.grantNotice}
          </p>
        </div>
      </SectionCard>

      {/* Dry-run preview */}
      <SectionCard title={t.adminCredits.dryRunPreviewSection}>
        <div className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as UsageRange)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(["24h", "7d", "30d"] as UsageRange[]).map((r) => (
                <option key={r} value={r}>{rangeLabel(t, r)}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t.adminCredits.userKeyFilterOptional}
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handlePreview}
              disabled={loading}
              className="bg-amber-600 text-white px-4 py-2 rounded text-sm hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
            >
              {t.adminCredits.preview}
            </button>
          </div>
          {preview && <PreviewTable preview={preview} />}
        </div>
      </SectionCard>

      {/* Monthly credit preview */}
      <SectionCard title={t.adminCredits.monthlyPreviewSection}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t.adminCredits.monthlyPreviewIntro}
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              placeholder={t.adminCredits.monthPlaceholder}
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder={t.adminCredits.userKeyFilterOptional}
              value={monthlyUserKey}
              onChange={(e) => setMonthlyUserKey(e.target.value)}
              className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleMonthlyPreview}
              disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
            >
              {t.adminCredits.monthlyLookup}
            </button>
          </div>
          {monthlyPreview && <MonthlyPreviewSection data={monthlyPreview} />}
        </div>
      </SectionCard>

      {/* Pending ledger cleanup */}
      <SectionCard title={t.adminCredits.pendingCleanupSection}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t.adminCredits.pendingCleanupIntro}
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-sm text-gray-600 whitespace-nowrap">{t.adminCredits.thresholdMinutesLabel}</label>
            <select
              value={pendingMinutes}
              onChange={(e) => setPendingMinutes(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="15">{t.adminCredits.threshold15}</option>
              <option value="30">{t.adminCredits.threshold30}</option>
              <option value="60">{t.adminCredits.threshold60}</option>
            </select>
            <button
              onClick={handleFetchPendingLedger}
              disabled={loading}
              className="bg-amber-600 text-white px-4 py-2 rounded text-sm hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
            >
              {t.adminCredits.fetchPending}
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
      <SectionCard title={t.adminCredits.testRunGuideSection}>
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3">
            <p className="text-xs font-bold text-red-700">{t.adminCredits.testRunWarningTitle}</p>
            <p className="text-xs text-red-600 mt-1">{t.adminCredits.testRunWarningDesc}</p>
          </div>
          <div className="space-y-1 text-xs text-gray-700">
            <p className="font-semibold text-gray-800 mb-2">{t.adminCredits.testProcedureTitle}</p>
            <ol className="list-decimal list-inside space-y-1.5 pl-1">
              <li>
                <span className="font-medium">{t.adminCredits.testStep1}</span>
                <p className="text-gray-500 pl-5 mt-0.5">{t.adminCredits.testStep1Detail}<code className="bg-gray-100 px-1 rounded">ACTUAL_DEBIT_ALLOWED_USER_KEYS = &quot;gh:yourtestaccount&quot;</code></p>
              </li>
              <li>
                <span className="font-medium">{t.adminCredits.testStep2}</span>
                <p className="text-gray-500 pl-5 mt-0.5">{t.adminCredits.testStep2Detail}</p>
              </li>
              <li>
                <span className="font-medium">{t.adminCredits.testStep3}</span>
                <p className="text-gray-500 pl-5 mt-0.5">{t.adminCredits.testStep3Detail}</p>
              </li>
              <li>
                <span className="font-medium">{t.adminCredits.testStep4}</span>
                <p className="text-gray-500 pl-5 mt-0.5">{t.adminCredits.testStep4Detail}</p>
              </li>
              <li>
                <span className="font-medium">{t.adminCredits.testStep5}</span>
                <p className="text-gray-500 pl-5 mt-0.5">{t.adminCredits.testStep5Detail}</p>
              </li>
              <li>
                <span className="font-medium">{t.adminCredits.testStep6}</span>
              </li>
              <li>
                <span className="font-medium">{t.adminCredits.testStep7}</span>
              </li>
              <li>
                <span className="font-medium text-red-600">{t.adminCredits.testStep8}</span>
              </li>
            </ol>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-xs text-amber-700 font-medium">{t.adminCredits.testRunDuplicateTitle}</p>
            <p className="text-xs text-amber-600 mt-1">
              {t.adminCredits.testRunDuplicateDesc}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Stage 33: Top-up request management */}
      <SectionCard title={t.adminCredits.topUpSection}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t.adminCredits.topUpIntro}
          </p>
          <div className="flex gap-2 items-center">
            <select
              value={topUpStatusFilter}
              onChange={(e) => setTopUpStatusFilter(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="requested">{t.adminCredits.topUpFilterRequested}</option>
              <option value="fulfilled">{t.adminCredits.topUpFilterFulfilled}</option>
              <option value="rejected">{t.adminCredits.topUpFilterRejected}</option>
              <option value="">{t.adminCredits.topUpFilterAll}</option>
            </select>
            <button
              onClick={handleFetchTopUpRequests}
              disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {t.adminCredits.fetchTopUpList}
            </button>
          </div>
          {topUpActionSuccess && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              {topUpActionSuccess}
            </p>
          )}
          {topUpRequests !== null && (
            topUpRequests.length === 0 ? (
              <p className="text-sm text-gray-500">{t.adminCredits.noTopUpRequests}</p>
            ) : (
              <div className="space-y-3 mt-2">
                {topUpRequests.map((req) => (
                  <div key={req.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-gray-700">{req.userKey}</span>
                          <span className="font-bold text-indigo-700">+{req.requestedAmount}</span>
                          <span className="text-gray-500 text-xs">{req.creditType}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${
                            req.status === "requested"
                              ? "text-amber-700 bg-amber-50 border-amber-200"
                              : req.status === "fulfilled"
                              ? "text-green-700 bg-green-50 border-green-200"
                              : "text-red-600 bg-red-50 border-red-200"
                          }`}>
                            {req.status === "requested" ? t.adminCredits.topUpStatusRequested : req.status === "fulfilled" ? t.adminCredits.topUpStatusFulfilled : t.adminCredits.topUpStatusRejected}
                          </span>
                        </div>
                        {req.note && (
                          <p className="text-xs text-gray-500 mt-1">{t.adminCredits.topUpNoteLabel}{req.note}</p>
                        )}
                        {req.adminNote && (
                          <p className="text-xs text-indigo-600 mt-0.5">{t.adminCredits.topUpAdminNoteLabel}{req.adminNote}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          {t.adminCredits.topUpRequestedAt}{req.createdAt.slice(0, 10)}
                          {req.resolvedAt && `${t.adminCredits.topUpResolvedAt}${req.resolvedAt.slice(0, 10)}`}
                        </p>
                      </div>
                    </div>
                    {req.status === "requested" && (
                      <div className="mt-2 flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder={t.adminCredits.adminNotePlaceholder}
                          value={topUpAdminNotes[req.id] ?? ""}
                          onChange={(e) => setTopUpAdminNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => handleFulfillTopUp(req.id)}
                          disabled={loading}
                          className="bg-green-600 text-white px-3 py-1.5 rounded text-xs hover:bg-green-700 disabled:opacity-50"
                        >
                          {t.adminCredits.grant}
                        </button>
                        <button
                          onClick={() => handleRejectTopUp(req.id)}
                          disabled={loading}
                          className="bg-red-500 text-white px-3 py-1.5 rounded text-xs hover:bg-red-600 disabled:opacity-50"
                        >
                          {t.adminCredits.reject}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </SectionCard>

      {/* Rollout checklist */}
      <SectionCard title={t.adminCredits.rolloutChecklistSection}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t.adminCredits.rolloutChecklistIntro}
          </p>
          <button
            onClick={handleFetchRolloutChecklist}
            disabled={loading}
            className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
          >
            {t.adminCredits.fetchChecklist}
          </button>
          {rolloutChecklist && <RolloutChecklistSection data={rolloutChecklist} />}
        </div>
      </SectionCard>

      {/* Free allowance policy notice */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
        <p className="text-sm font-medium text-indigo-700 mb-1">{t.adminCredits.allowanceNoticeTitle}</p>
        <ul className="text-xs text-indigo-600 space-y-0.5 list-disc list-inside">
          <li>{t.adminCredits.allowanceNotice1}</li>
          <li>{t.adminCredits.allowanceNotice2}</li>
          <li>{t.adminCredits.allowanceNotice3}</li>
          <li>{t.adminCredits.allowanceNotice4}</li>
        </ul>
      </div>

      {loading && (
        <div className="text-sm text-gray-500 text-center py-2">{t.adminCredits.loading}</div>
      )}
    </div>
  );
}

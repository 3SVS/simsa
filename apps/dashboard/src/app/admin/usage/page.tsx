"use client";

import { useState } from "react";
import {
  fetchUsageStats,
  type UsageRange,
  type UsageStatsResponse,
  type DryRunBillingByEventRow,
  type BillingStatus,
} from "@/lib/workspace-admin-api";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionary.mjs";

function rangeLabel(t: Dictionary, r: UsageRange): string {
  if (r === "24h") return t.adminUsage.range24h;
  if (r === "7d") return t.adminUsage.range7d;
  return t.adminUsage.range30d;
}

function billingStatusLabel(t: Dictionary, s: BillingStatus): string {
  if (s === "billable_candidate") return t.adminUsage.statusBillable;
  if (s === "included") return t.adminUsage.statusIncluded;
  if (s === "future_billable") return t.adminUsage.statusFutureBillable;
  return t.adminUsage.statusIgnored;
}

const BILLING_STATUS_COLORS: Record<BillingStatus, string> = {
  billable_candidate: "bg-amber-100 text-amber-700",
  included: "bg-green-100 text-green-700",
  future_billable: "bg-indigo-100 text-indigo-700",
  ignored: "bg-gray-100 text-gray-500",
};

export default function AdminUsagePage() {
  const { t } = useI18n();
  const [adminKey, setAdminKey] = useState("");
  const [range, setRange] = useState<UsageRange>("7d");
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Stage 23: link to credits page rendered below header

  async function handleLoad() {
    if (!adminKey.trim()) {
      setError(t.adminUsage.errKeyRequired);
      return;
    }
    setLoading(true);
    setError(null);
    setStats(null);
    try {
      const result = await fetchUsageStats(adminKey.trim(), range);
      if (!result.ok) {
        if (result.error === "disabled") {
          setError(t.adminUsage.errDisabled);
        } else if (result.error === "unauthorized") {
          setError(t.adminUsage.errUnauthorized);
        } else {
          setError(result.message ?? result.error);
        }
      } else {
        setStats(result);
      }
    } catch {
      setError(t.adminUsage.errRequest);
    } finally {
      setLoading(false);
    }
  }

  const billing = stats?.dryRunBilling;
  const billableRows = billing?.byEventType.filter((r) => r.billingStatus === "billable_candidate") ?? [];
  const includedRows = billing?.byEventType.filter((r) => r.billingStatus === "included") ?? [];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">{t.adminUsage.title}</h1>
          <a
            href="/admin/credits"
            className="text-xs text-indigo-600 hover:underline whitespace-nowrap mt-1"
          >
            {t.adminUsage.viewCreditPreview}
          </a>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {t.adminUsage.intro}
        </p>

        {/* Auth + range selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.adminUsage.adminKey}</label>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLoad()}
              placeholder={t.adminUsage.adminKeyPlaceholder}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.adminUsage.range}</label>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as UsageRange)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {(["24h", "7d", "30d"] as UsageRange[]).map((r) => (
                <option key={r} value={r}>{rangeLabel(t, r)}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleLoad}
            disabled={loading}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? t.adminUsage.loading : t.adminUsage.load}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-red-700 text-sm">
            {error}
          </div>
        )}

        {stats && (
          <>
            <p className="text-xs text-gray-400 mb-4">
              {t.adminUsage.basis
                .replace("{range}", rangeLabel(t, stats.range))
                .replace("{cutoff}", stats.cutoff.slice(0, 10))}
            </p>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <SummaryCard label={t.adminUsage.totalEvents} value={stats.summary.totalEvents.toLocaleString()} />
              <SummaryCard label={t.adminUsage.activeUsers} value={stats.summary.activeUsers.toLocaleString()} />
              <SummaryCard
                label={t.adminUsage.telegramErrorRate}
                value={`${stats.summary.telegramErrorRate.toFixed(1)}%`}
                highlight={stats.summary.telegramErrorRate > 10}
              />
              <SummaryCard
                label={t.adminUsage.llmFallbackRate}
                value={`${stats.summary.llmFallbackRate.toFixed(1)}%`}
                highlight={stats.summary.llmFallbackRate > 30}
              />
            </div>

            {/* ─── Dry-run billing section ─────────────────────────────────── */}
            {billing && (
              <div className="mb-6">
                {/* Dry-run notice */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-800">{t.adminUsage.dryRunTitle}</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {t.adminUsage.dryRunDesc}
                    </p>
                  </div>
                </div>

                {/* Credit summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                  <SummaryCard
                    label={t.adminUsage.totalEstimatedCredits}
                    value={billing.totalEstimatedCredits.toLocaleString()}
                    accent
                  />
                  {billing.byCreditType.map((r) => (
                    <SummaryCard
                      key={r.creditType}
                      label={`${r.creditType} ${t.adminUsage.creditSuffix}`}
                      value={r.estimatedCredits.toLocaleString()}
                    />
                  ))}
                </div>

                {/* Billable candidates */}
                {billableRows.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="font-semibold text-gray-800">{t.adminUsage.billableTitle}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">{t.adminUsage.billableDesc}</p>
                    </div>
                    <BillingEventTable rows={billableRows} />
                  </div>
                )}

                {/* Included (free) events */}
                {includedRows.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="font-semibold text-gray-800">{t.adminUsage.includedTitle}</h2>
                    </div>
                    <BillingEventTable rows={includedRows} />
                  </div>
                )}

                {/* Top users by estimated credits */}
                {billing.topUsersByEstimatedCredits.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="font-semibold text-gray-800">{t.adminUsage.topUsersCredits}</h2>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs">
                          <th className="text-left px-5 py-2 font-medium">User Key</th>
                          <th className="text-right px-5 py-2 font-medium">{t.adminUsage.estimatedCredit}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.topUsersByEstimatedCredits.map((row, i) => (
                          <tr key={row.userKey} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-5 py-3 font-mono text-xs text-gray-600">
                              {i + 1}. {row.userKey}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-amber-700">
                              {row.estimatedCredits}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Top projects by estimated credits */}
                {billing.topProjectsByEstimatedCredits.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
                    <div className="px-5 py-4 border-b border-gray-100">
                      <h2 className="font-semibold text-gray-800">{t.adminUsage.topProjectsCredits}</h2>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs">
                          <th className="text-left px-5 py-2 font-medium">Project ID</th>
                          <th className="text-right px-5 py-2 font-medium">{t.adminUsage.estimatedCredit}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.topProjectsByEstimatedCredits.map((row, i) => (
                          <tr key={row.projectId} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-5 py-3 font-mono text-xs text-gray-600">
                              {i + 1}. {row.projectId}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-amber-700">
                              {row.estimatedCredits}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Event type breakdown */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800">{t.adminUsage.byEventTitle}</h2>
              </div>
              {stats.byEventType.length === 0 ? (
                <p className="px-5 py-4 text-sm text-gray-400">{t.adminUsage.noEvents}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left px-5 py-2 font-medium">{t.adminUsage.colFeature}</th>
                      <th className="text-left px-5 py-2 font-medium text-gray-400">{t.adminUsage.colEventType}</th>
                      <th className="text-right px-5 py-2 font-medium">{t.adminUsage.colCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byEventType.map((row) => (
                      <tr key={row.eventType} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-900">{row.label}</td>
                        <td className="px-5 py-3 text-gray-400 font-mono text-xs">{row.eventType}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Daily activity */}
            {stats.dailyActivity.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-800">{t.adminUsage.dailyTitle}</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left px-5 py-2 font-medium">{t.adminUsage.colDate}</th>
                      <th className="text-right px-5 py-2 font-medium">{t.adminUsage.colEvents}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.dailyActivity.map((row) => (
                      <tr key={row.date} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-900">{row.date}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Top users */}
            {stats.topUsers.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-800">{t.adminUsage.topUsersTitle}</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left px-5 py-2 font-medium">User Key</th>
                      <th className="text-right px-5 py-2 font-medium">{t.adminUsage.colEvents}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topUsers.map((row, i) => (
                      <tr key={row.userKey} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-5 py-3 font-mono text-xs text-gray-600">
                          {i + 1}. {row.userKey}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BillingEventTable({ rows }: { rows: DryRunBillingByEventRow[] }) {
  const { t } = useI18n();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 text-gray-500 text-xs">
          <th className="text-left px-5 py-2 font-medium">{t.adminUsage.colFeature}</th>
          <th className="text-left px-5 py-2 font-medium">{t.adminUsage.colStatus}</th>
          <th className="text-right px-5 py-2 font-medium">{t.adminUsage.colCount}</th>
          <th className="text-right px-5 py-2 font-medium">{t.adminUsage.colUnitPrice}</th>
          <th className="text-right px-5 py-2 font-medium">{t.adminUsage.estimatedCredit}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.eventType} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="px-5 py-3 text-gray-900">{row.label}</td>
            <td className="px-5 py-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BILLING_STATUS_COLORS[row.billingStatus]}`}>
                {billingStatusLabel(t, row.billingStatus)}
              </span>
            </td>
            <td className="px-5 py-3 text-right text-gray-700">{row.count.toLocaleString()}</td>
            <td className="px-5 py-3 text-right text-gray-500">{row.creditCost}</td>
            <td className="px-5 py-3 text-right font-semibold text-amber-700">
              {row.estimatedCredits}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
  accent = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  accent?: boolean;
}) {
  const cls = accent
    ? "border-amber-400 bg-amber-50"
    : highlight
    ? "border-amber-300 bg-amber-50"
    : "border-gray-200 bg-white";
  const textCls = accent || highlight ? "text-amber-700" : "text-gray-900";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${textCls}`}>{value}</p>
    </div>
  );
}

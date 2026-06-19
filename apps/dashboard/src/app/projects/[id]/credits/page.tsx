"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getUserKey } from "@/lib/workflow-store";
import {
  fetchWorkspaceCredits,
  createTopUpRequest,
  fetchTopUpRequests,
  type WorkspaceCreditsResponse,
  type TopUpRequest,
  type CreditType,
} from "@/lib/workspace-credits-api";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionary.mjs";

const STATUS_COLORS: Record<string, string> = {
  requested: "text-amber-600 bg-amber-50 border-amber-200",
  fulfilled: "text-green-700 bg-green-50 border-green-200",
  rejected: "text-red-600 bg-red-50 border-red-200",
};

function statusLabel(t: Dictionary, status: string): string {
  if (status === "requested") return t.creditsPage.statusRequested;
  if (status === "fulfilled") return t.creditsPage.statusFulfilled;
  if (status === "rejected") return t.creditsPage.statusRejected;
  return status;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded border ${STATUS_COLORS[status] ?? "text-gray-500 bg-gray-50 border-gray-200"}`}>
      {statusLabel(t, status)}
    </span>
  );
}

export default function CreditsPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const userKey = getUserKey();

  const [credits, setCredits] = useState<WorkspaceCreditsResponse | null>(null);
  const [creditsPhase, setCreditsPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [creditsError, setCreditsError] = useState("");

  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [requestsPhase, setRequestsPhase] = useState<"idle" | "loading" | "done" | "error">("idle");

  // Top-up form state
  const [formAmount, setFormAmount] = useState(10);
  const [formNote, setFormNote] = useState("");
  const [submitPhase, setSubmitPhase] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [submitError, setSubmitError] = useState("");

  const loadCredits = useCallback(async () => {
    if (!userKey) return;
    setCreditsPhase("loading");
    try {
      const data = await fetchWorkspaceCredits(userKey);
      setCredits(data);
      setCreditsPhase("done");
    } catch (e) {
      setCreditsError(e instanceof Error ? e.message : t.creditsPage.unknownError);
      setCreditsPhase("error");
    }
  }, [userKey, t]);

  const loadRequests = useCallback(async () => {
    if (!userKey) return;
    setRequestsPhase("loading");
    try {
      const data = await fetchTopUpRequests(userKey);
      setRequests(data);
      setRequestsPhase("done");
    } catch {
      setRequestsPhase("error");
    }
  }, [userKey]);

  useEffect(() => {
    loadCredits();
    loadRequests();
  }, [loadCredits, loadRequests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userKey) return;
    setSubmitPhase("submitting");
    setSubmitError("");
    try {
      await createTopUpRequest({
        userKey,
        creditType: "review" as CreditType,
        requestedAmount: formAmount,
        note: formNote.trim() || undefined,
      });
      setSubmitPhase("done");
      setFormAmount(10);
      setFormNote("");
      // Reload both
      await Promise.all([loadCredits(), loadRequests()]);
      setSubmitPhase("idle");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t.creditsPage.requestFailed);
      setSubmitPhase("error");
    }
  };

  const reviewBalance = credits?.balances.find((b) => b.creditType === "review")?.balance ?? 0;
  const allowance = credits?.allowance.review;
  const openRequests = requests.filter((r) => r.status === "requested").length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Back link */}
      <div className="flex items-center gap-2">
        <Link href={`/projects/${id}/github`} className="text-sm text-indigo-600 hover:underline">
          {t.creditsPage.back}
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">{t.creditsPage.title}</h1>
      <p className="text-sm text-gray-500">{t.creditsPage.intro}</p>

      {/* Balance section */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-sm">{t.creditsPage.balanceTitle}</h2>
        </div>
        <div className="p-5">
          {creditsPhase === "loading" && (
            <p className="text-sm text-gray-400">{t.creditsPage.loading}</p>
          )}
          {creditsPhase === "error" && (
            <p className="text-sm text-red-500">{creditsError}</p>
          )}
          {creditsPhase === "done" && credits && (
            <div className="space-y-4">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-indigo-700">{reviewBalance}</span>
                <span className="text-sm text-gray-500">{t.creditsPage.reviewCredit}</span>
              </div>

              {allowance && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>{t.creditsPage.freeThisMonth}</span>
                    <span className="font-medium">
                      {t.creditsPage.usedOfRuns
                        .replace("{used}", String(allowance.usedThisPeriod))
                        .replace("{included}", String(allowance.includedRuns))}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (allowance.usedThisPeriod / allowance.includedRuns) * 100)}%` }}
                    />
                  </div>
                  <p className="text-gray-500">
                    {allowance.remainingIncludedRuns > 0
                      ? t.creditsPage.remainingRuns
                          .replace("{n}", String(allowance.remainingIncludedRuns))
                          .replace("{period}", allowance.periodKey)
                      : t.creditsPage.noRemainingRuns.replace("{period}", allowance.periodKey)}
                  </p>
                </div>
              )}

              {credits.actualDebitsEnabled && (
                <p className="text-xs text-indigo-600">
                  {credits.actualDebitAllowedForUser
                    ? t.creditsPage.actualDebitOn
                    : t.creditsPage.dryRunMode}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top-up request form */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-sm">{t.creditsPage.topUpTitle}</h2>
        </div>
        <div className="p-5">
          {reviewBalance === 0 && creditsPhase === "done" && (
            <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
              <p className="text-sm text-amber-700 font-medium">{t.creditsPage.lowBalanceTitle}</p>
              <p className="text-xs text-amber-600 mt-0.5">{t.creditsPage.lowBalanceDesc}</p>
            </div>
          )}

          {openRequests >= 3 ? (
            <div className="border border-indigo-200 bg-indigo-50 rounded-lg px-4 py-3">
              <p className="text-sm text-indigo-700">
                {t.creditsPage.pendingRequests.replace("{n}", String(openRequests))}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  {t.creditsPage.amountLabel}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={formAmount}
                    onChange={(e) => setFormAmount(Number(e.target.value))}
                    className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                  <span className="text-sm text-gray-500">{t.creditsPage.reviewCredit}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  {t.creditsPage.noteLabel}
                </label>
                <textarea
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  rows={2}
                  placeholder={t.creditsPage.notePlaceholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                  maxLength={300}
                />
              </div>

              {submitPhase === "error" && (
                <p className="text-sm text-red-500">{submitError}</p>
              )}

              <button
                type="submit"
                disabled={submitPhase === "submitting"}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitPhase === "submitting" ? t.creditsPage.submitting : t.creditsPage.submit}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Request history */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700 text-sm">{t.creditsPage.historyTitle}</h2>
          <button
            onClick={loadRequests}
            className="text-xs text-indigo-600 hover:underline"
          >
            {t.creditsPage.refresh}
          </button>
        </div>
        <div className="p-5">
          {requestsPhase === "loading" && (
            <p className="text-sm text-gray-400">{t.creditsPage.loading}</p>
          )}
          {requestsPhase === "done" && requests.length === 0 && (
            <p className="text-sm text-gray-400">{t.creditsPage.noRequests}</p>
          )}
          {requestsPhase === "done" && requests.length > 0 && (
            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="border border-gray-100 rounded-lg px-4 py-3 bg-white"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-indigo-700">
                        +{req.requestedAmount}
                      </span>
                      <span className="text-xs text-gray-500">{t.creditsPage.reviewCredit}</span>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                  {req.note && (
                    <p className="text-xs text-gray-500 mt-1">{req.note}</p>
                  )}
                  {req.adminNote && (
                    <p className="text-xs text-indigo-600 mt-1">{t.creditsPage.adminNote} {req.adminNote}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {req.createdAt.slice(0, 10)}
                    {req.resolvedAt && ` → ${req.resolvedAt.slice(0, 10)} ${t.creditsPage.resolved}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-400 text-center">{t.creditsPage.footer}</p>
    </div>
  );
}

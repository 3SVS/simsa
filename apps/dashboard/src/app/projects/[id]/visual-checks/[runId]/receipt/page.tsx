"use client";

// Train C · C-3 — 확인 영수증 (재정렬 D-19 amend).
//
// 한 번의 확인이 무엇을, 언제, 어디까지 봤는지를 인쇄·복사 가능한 한 장으로. 수리가 있었다면
// '고친 내용'(고친 쪽의 사실)과 '다시 확인한 증거'(고친 뒤 실제 앱을 다시 연 별도 확인의 판정)를
// 서로 다른 섹션으로 둔다 — 고친 주체가 판정하지 않는다.
//
// 새 서버 라우트 없음: 기존 GET 상세 · 수리 잡 · 목록(모두 서버가 프로젝트→userKey, 런→프로젝트 소유권을
// 확인한다)을 조합하고, 그리는 내용은 순수 함수 buildReceiptView가 정한다(test/visual-check-receipt).
// 채운 버튼은 '다음 할 일' 하나뿐.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ProjectNotFound } from "@/components/ProjectNotFound";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  getRepair,
  getVisualCheck,
  listVisualChecks,
  type RepairJob,
  type VisualCheckDetail,
  type VisualCheckListItem,
} from "@/lib/workspace-visual-checks-api";
import { buildReceiptView, notSeenText, receiptPlainText } from "@/lib/visual-check-receipt.mjs";
import type { ReceiptItemStatus, ReceiptNextAction, ReceiptReadyView } from "@/lib/visual-check-receipt.mjs";
import { verdictLabel } from "@/lib/visual-check-view.mjs";
import type { VerdictTone } from "@/lib/visual-check-view.mjs";
import { userVerdictLabel } from "@/lib/user-verdict.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  clear: "bg-sky-50 text-sky-700 border-sky-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};

const STATUS_CLASS: Record<ReceiptItemStatus, string> = {
  pass: "bg-green-50 text-green-700 border-green-200",
  broken: "bg-red-50 text-red-700 border-red-200",
  notConfirmed: "bg-gray-50 text-gray-600 border-gray-200",
  noProblemFound: "bg-sky-50 text-sky-700 border-sky-200",
};

function formatDateTime(iso: string, locale: Locale): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

type Loaded =
  | { phase: "loading" }
  | { phase: "notfound" }
  | { phase: "error" }
  | {
      phase: "done";
      check: VisualCheckDetail;
      /** null = no repair · undefined = could not read */
      repair: RepairJob | null | undefined;
      /** null = could not read */
      checks: VisualCheckListItem[] | null;
      partial: boolean;
    };

function VerdictChip({ works, decision, t }: { works: boolean | null; decision: string; t: Dictionary }) {
  const v = verdictLabel(works, decision, t);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[v.tone]}`}>
      {v.label}
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-gray-700">{children}</dd>
    </div>
  );
}

function nextHref(projectId: string, runId: string, next: ReceiptNextAction): string {
  if (next.kind === "viewRecheck") return `/projects/${projectId}/visual-checks/${next.runId}`;
  if (next.kind === "backToProject") return `/projects/${projectId}`;
  return `/projects/${projectId}/visual-checks/${runId}`;
}

function ReadyReceipt({ view, projectId, t, locale }: { view: ReceiptReadyView; projectId: string; t: Dictionary; locale: Locale }) {
  const r = t.visualChecks.receipt;
  const fmt = (iso: string) => formatDateTime(iso, locale);
  const fix = view.fix;
  const recheck = view.recheck;
  return (
    <>
      {/* 확인한 것 */}
      <section className="card p-5">
        <h3 className="section-title">{r.sectionChecked}</h3>
        <dl className="mt-3 space-y-2">
          <MetaRow label={r.address}><span className="break-all">{view.checked.targetUrl}</span></MetaRow>
          <MetaRow label={r.intent}><span className="leading-relaxed">{view.checked.intent}</span></MetaRow>
          <MetaRow label={r.checkedAt}><span className="text-gray-500">{fmt(view.checked.at)}</span></MetaRow>
          <MetaRow label={r.resultLabel}>
            <VerdictChip works={view.verdict.works} decision={view.verdict.decision} t={t} />
          </MetaRow>
          <MetaRow label={r.yourAnswer}>
            {view.userVerdict ? userVerdictLabel(view.userVerdict, t) : <span className="text-gray-500">{r.yourAnswerNone}</span>}
          </MetaRow>
        </dl>
        {view.source && (
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            {r.sourceNote}{" "}
            <Link href={`/projects/${projectId}/visual-checks/${view.source.runId}/receipt`} className="underline hover:text-gray-700" data-print-hide>
              {r.sourceLink}
            </Link>
          </p>
        )}
      </section>

      {/* 항목 표 */}
      <section className="card p-5">
        <h3 className="section-title">{view.items.basis === "acceptance" ? r.itemsTitleAcceptance : r.itemsTitleCoreFlow}</h3>
        {view.items.basis === "coreFlow" && <p className="section-desc leading-relaxed">{r.itemsIntroCoreFlow}</p>}
        {view.items.rows.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{r.itemsNoneReached}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th scope="col" className="py-2 pr-3 font-medium">{r.colItem}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{r.colExpected}</th>
                  <th scope="col" className="py-2 font-medium">{r.colResult}</th>
                </tr>
              </thead>
              <tbody>
                {view.items.rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100 align-top last:border-0">
                    <td className="py-2 pr-3 font-medium text-gray-800">{row.title}</td>
                    <td className="py-2 pr-3 text-gray-600">{row.expected ?? "—"}</td>
                    <td className="py-2">
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>
                        {r.status[row.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 못 본 것 */}
      <section className="card p-5">
        <h3 className="section-title">{r.notSeenTitle}</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          {view.notSeen.map((n, i) => (
            <li key={i} className="text-sm leading-relaxed text-gray-600">{notSeenText(n, r)}</li>
          ))}
        </ul>
      </section>

      {/* 고친 내용 — 고친 쪽의 사실만(판정 없음) */}
      {fix && (
        <section className="card p-5">
          <h3 className="section-title">{r.fixTitle}</h3>
          <p className="section-desc leading-relaxed">{r.fixBy}</p>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-gray-700">
            <li>
              {fix.status === "active" ? r.fixActive : fix.status === "failed" ? r.fixFailed : fix.kind === "autoFix" ? r.fixAutoFix : r.fixBriefOnly}
            </li>
            {fix.changedFiles !== null && <li>{r.changedFiles.replace("{count}", String(fix.changedFiles))}</li>}
            {fix.buildCheck === "passed" && <li>{r.buildPassed}</li>}
            {fix.buildCheck === "unverified" && <li className="text-amber-700">{r.buildUnverified}</li>}
            {fix.envCause && <li className="text-amber-700">{t.visualChecks.repair.envCauseWarning}</li>}
          </ul>
          {fix.changesUrl && (
            <p className="mt-3 text-sm">
              <a href={fix.changesUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline hover:text-brand-800">
                {r.openChanges}
              </a>
              <span className="hidden break-all text-xs text-gray-500 print:inline"> ({fix.changesUrl})</span>
            </p>
          )}
        </section>
      )}

      {/* 다시 확인한 증거 — 별도 확인의 판정만(고친 쪽 필드 없음) */}
      {view.showRecheck && (
        <section className="card p-5">
          <h3 className="section-title">{r.recheckTitle}</h3>
          {(recheck.state === "done" || recheck.state === "linked") && (
            <p className="section-desc leading-relaxed">{r.recheckBy}</p>
          )}
          {recheck.state === "done" && (
            <dl className="mt-3 space-y-2">
              <MetaRow label={r.recheckResult}>
                <VerdictChip works={recheck.works} decision={recheck.decision} t={t} />
              </MetaRow>
              <MetaRow label={r.recheckAt}><span className="text-gray-500">{fmt(recheck.at)}</span></MetaRow>
            </dl>
          )}
          {recheck.state === "linked" && (
            <p className="mt-3 text-sm text-gray-700">
              {recheck.resolved === true ? r.recheckLinkedWorks : recheck.resolved === false ? r.recheckLinkedBroken : r.recheckLinked}
            </p>
          )}
          {recheck.state === "active" && <p className="mt-2 text-sm text-gray-600">{r.recheckActive}</p>}
          {recheck.state === "failed" && <p className="mt-2 text-sm text-gray-600">{r.recheckFailed}</p>}
          {recheck.state === "none" && <p className="mt-2 text-sm leading-relaxed text-gray-600">{r.recheckNone}</p>}
          {(recheck.state === "done" || recheck.state === "linked") && (
            <Link
              href={`/projects/${projectId}/visual-checks/${recheck.runId}/receipt`}
              className="mt-3 inline-block text-xs text-brand-700 hover:underline"
              data-print-hide
            >
              {r.recheckOpen} →
            </Link>
          )}
        </section>
      )}

      {/* 정직 문구 */}
      <p className="callout callout-info text-sm leading-relaxed">{r.notAGuarantee}</p>

      {/* 다음 할 일 — 이 화면의 유일한 채운 버튼 */}
      <section className="card p-5" data-print-hide>
        <h3 className="section-title">{r.nextTitle}</h3>
        <p className="section-desc leading-relaxed">{r.nextWhy[view.nextAction.kind]}</p>
        <Link href={nextHref(projectId, view.runId, view.nextAction)} className="btn btn-primary btn-sm mt-3">
          {r.next[view.nextAction.kind]}
        </Link>
      </section>
    </>
  );
}

export default function VisualCheckReceiptPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();
  const r = t.visualChecks.receipt;

  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoaded({ phase: "loading" });
      const res = await getVisualCheck(id, runId, userKey);
      if (cancelled) return;
      if (!res.ok) {
        setLoaded({ phase: res.error === "not_found" || res.error === "forbidden" ? "notfound" : "error" });
        return;
      }
      if (res.check.status !== "done") {
        setLoaded({ phase: "done", check: res.check, repair: null, checks: null, partial: false });
        return;
      }
      // 고친 내용(수리 잡)과 다시 확인(목록의 재검수 런) — 같은 소유권 확인을 거치는 기존 API만.
      const [repairRes, listRes] = await Promise.all([getRepair(id, runId, userKey), listVisualChecks(id, userKey)]);
      if (cancelled) return;
      setLoaded({
        phase: "done",
        check: res.check,
        repair: repairRes.ok ? repairRes.repair : undefined,
        checks: listRes.ok ? listRes.checks : null,
        partial: !repairRes.ok || !listRes.ok,
      });
    })();
    return () => { cancelled = true; };
  }, [id, runId, userKey]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (!project) return <ProjectNotFound />;

  const view =
    loaded.phase === "done"
      ? buildReceiptView({ check: loaded.check, repair: loaded.repair, checks: loaded.checks })
      : null;

  async function handleCopy() {
    if (!view) return;
    try {
      const partial = loaded.phase === "done" && loaded.partial;
      await navigator.clipboard.writeText(receiptPlainText(view, t, (iso) => formatDateTime(iso, locale), { partial }));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — printing still works.
    }
  }

  return (
    <div data-receipt className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3" data-print-hide>
        <Link href={`/projects/${id}/visual-checks/${runId}`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          ← {r.backToReport}
        </Link>
        {view?.state === "ready" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => window.print()} className="btn btn-secondary btn-sm">
              {r.print}
            </button>
            <button type="button" onClick={() => void handleCopy()} className="btn btn-secondary btn-sm">
              {copied ? r.copied : r.copy}
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="page-title">{r.title}</h2>
        <p className="page-subtitle">{r.subtitle}</p>
      </div>

      {loaded.phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {r.loading}
        </div>
      )}
      {loaded.phase === "notfound" && <div className="callout callout-info">{t.visualChecks.notFound}</div>}
      {loaded.phase === "error" && <div className="callout callout-error">{t.visualChecks.loadError}</div>}
      {view?.state === "notReady" && <div className="callout callout-info">{r.notReady}</div>}
      {view?.state === "failed" && <div className="callout callout-info">{r.failed}</div>}
      {view?.state === "missing" && <div className="callout callout-info">{t.visualChecks.notFound}</div>}

      {/* Printed too: a receipt missing its fix / re-check sections must say so on paper as well. */}
      {loaded.phase === "done" && loaded.partial && view?.state === "ready" && (
        <div className="callout callout-info">{r.partialLoad}</div>
      )}
      {view?.state === "ready" && <ReadyReceipt view={view} projectId={id} t={t} locale={locale} />}
    </div>
  );
}

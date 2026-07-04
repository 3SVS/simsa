"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

// Stage 262 — Visual checks (시각 검수) list. Client component: reads the
// project from localStorage (server components 404'd on local projects before)
// and the runs from the central plane with the browser-persisted userKey.
// Stage 264 — one-click inspection run (POST …/visual-checks/run), status
// badges for queued/running/failed rows, and 5s polling while a run is active.
// Stage 266 — verdict-transition chip on the latest done row when its verdict
// differs from the previous done run (e.g. "확인 필요 → 작동해요").

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  listVisualChecks,
  runVisualCheck,
  type VisualCheckListItem,
} from "@/lib/workspace-visual-checks-api";
import { listProjectSources } from "@/lib/workspace-sources-api";
import { verdictLabel } from "@/lib/visual-check-view.mjs";
import type { VerdictTone } from "@/lib/visual-check-view.mjs";
import { latestDoneTransition } from "@/lib/visual-check-compare.mjs";
import {
  isActiveStatus,
  mapRunError,
  runButtonState,
  RUN_POLL_INTERVAL_MS,
} from "@/lib/visual-check-run-state.mjs";
import type { RunErrorKey } from "@/lib/visual-check-run-state.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};

// Stage 264 — decision-slate for queued/running, failed tokens for failed.
const STATUS_SLATE_CLASS = "bg-slate-50 text-slate-600 border-slate-200";

function formatDateTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function executorLabel(t: Dictionary, executor: string): string {
  return executor === "container" ? t.visualChecks.executorContainer : t.visualChecks.executorLocal;
}

/**
 * Chip for a non-terminal / failed run. Done (and unknown/legacy) statuses
 * return null so the row keeps the verdict chip exactly as before Stage 264.
 */
function statusChipFor(t: Dictionary, status: string): { label: string; cls: string } | null {
  if (status === "queued") return { label: t.visualChecks.statusQueued, cls: STATUS_SLATE_CLASS };
  if (status === "running") return { label: t.visualChecks.statusRunning, cls: STATUS_SLATE_CLASS };
  if (status === "failed") return { label: t.visualChecks.statusFailed, cls: TONE_CLASS.failed };
  return null;
}

type RunNotice =
  | { kind: "queuedOnly" }
  | { kind: "error"; errorKey: RunErrorKey };

export default function VisualChecksPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
  const [checks, setChecks] = useState<VisualCheckListItem[]>([]);
  // Optimistic true: when the sources lookup fails we keep the button enabled
  // and let the backend's website_source_required answer drive the callout.
  const [hasWebsiteSource, setHasWebsiteSource] = useState(true);
  const [intent, setIntent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<RunNotice | null>(null);

  const applyListResult = useCallback(
    (res: Awaited<ReturnType<typeof listVisualChecks>>): void => {
      if (res.ok) {
        setChecks(res.checks);
        setPhase("done");
      } else if (res.error === "project_not_found") {
        // A project that only exists in this browser has no server-side runs yet.
        setChecks([]);
        setPhase("done");
      } else {
        setPhase("error");
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    listVisualChecks(id, userKey).then((res) => {
      if (cancelled) return;
      applyListResult(res);
    });
    return () => { cancelled = true; };
  }, [id, userKey, applyListResult]);

  // Best-effort website-source lookup so the run button can point at
  // /sources proactively instead of only after a 400 from the backend.
  useEffect(() => {
    let cancelled = false;
    listProjectSources(id, userKey).then((res) => {
      if (cancelled || !res.ok) return;
      setHasWebsiteSource(res.sources.some((s) => s.type === "website"));
    });
    return () => { cancelled = true; };
  }, [id, userKey]);

  // Stage 264 — while any run is queued/running, silently re-fetch the list
  // every 5s. The interval clears on unmount and when no run is active.
  const hasActiveRun = checks.some((c) => isActiveStatus(c.status));
  useEffect(() => {
    if (!hasActiveRun) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await listVisualChecks(id, userKey);
      if (cancelled || !res.ok) return;
      setChecks(res.checks);
    }, RUN_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [hasActiveRun, id, userKey]);

  if (!project) return <ProjectNotFound />;

  const buttonState = runButtonState({ hasWebsiteSource, hasActiveRun });
  // Stage 266 — verdict transition between the two most recent done runs
  // (null when there are fewer than two done runs or the verdict is unchanged).
  const transition = latestDoneTransition(checks);
  const showSourcesLink =
    !hasWebsiteSource || (notice?.kind === "error" && notice.errorKey === "websiteSourceRequired");

  async function handleRun() {
    if (submitting || buttonState.disabled) return;
    setSubmitting(true);
    setNotice(null);
    const trimmedIntent = intent.trim();
    const res = await runVisualCheck(id, {
      userKey,
      ...(trimmedIntent ? { intent: trimmedIntent } : {}),
    });
    setSubmitting(false);
    if (res.ok) {
      if (!res.dispatched) setNotice({ kind: "queuedOnly" });
      setIntent("");
      applyListResult(await listVisualChecks(id, userKey));
    } else {
      setNotice({ kind: "error", errorKey: mapRunError(res.error) });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t.visualChecks.title}</h2>
        <p className="page-subtitle">{t.visualChecks.subtitle}</p>
      </div>

      {/* Stage 264 — one-click inspection run */}
      <section className="card p-5">
        <h3 className="section-title">{t.visualChecks.runTitle}</h3>
        <p className="section-desc leading-relaxed">{t.visualChecks.runHint}</p>

        <div className="mt-3">
          <label htmlFor="vc-intent" className="text-xs font-medium text-gray-500">
            {t.visualChecks.intentLabel}
          </label>
          <input
            id="vc-intent"
            type="text"
            value={intent}
            maxLength={1000}
            onChange={(e) => setIntent(e.target.value)}
            placeholder={t.visualChecks.intentPlaceholder}
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
          />
        </div>

        <button
          onClick={handleRun}
          disabled={submitting || buttonState.disabled}
          className="btn btn-primary btn-sm mt-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? t.visualChecks.runSubmitting : t.visualChecks.runButton}
        </button>

        {hasActiveRun && (
          <div className="callout callout-info mt-3">{t.visualChecks.runActiveNotice}</div>
        )}

        {!hasWebsiteSource && !hasActiveRun && (
          <div className="callout callout-info mt-3">{t.visualChecks.runNeedWebsite}</div>
        )}

        {notice?.kind === "queuedOnly" && (
          <div className="callout callout-info mt-3">{t.visualChecks.runQueuedOnly}</div>
        )}

        {notice?.kind === "error" && (
          <div
            className={`callout mt-3 ${
              notice.errorKey === "runAlreadyActive" || notice.errorKey === "websiteSourceRequired"
                ? "callout-info"
                : "callout-error"
            }`}
          >
            {t.visualChecks.runErrors[notice.errorKey]}
          </div>
        )}

        {showSourcesLink && (
          <Link href={`/projects/${id}/sources`} className="btn btn-secondary btn-sm mt-3">
            {t.visualChecks.goToSources}
          </Link>
        )}
      </section>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.visualChecks.loading}
        </div>
      )}

      {phase === "error" && (
        <div className="callout callout-error flex items-center justify-between">
          <span>{t.visualChecks.loadError}</span>
          <button onClick={() => window.location.reload()} className="btn btn-sm btn-secondary">{t.common.retry}</button>
        </div>
      )}

      {phase === "done" && checks.length === 0 && (
        <div className="empty-state">
          <p className="text-sm font-medium text-gray-700">{t.visualChecks.emptyTitle}</p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-gray-500">{t.visualChecks.emptyBody}</p>
        </div>
      )}

      {phase === "done" && checks.length > 0 && (
        <ul className="space-y-2">
          {checks.map((check) => {
            const statusChip = statusChipFor(t, check.status);
            const verdict = verdictLabel(check.works, check.decision, t);
            const chip = statusChip ?? { label: verdict.label, cls: TONE_CLASS[verdict.tone] };
            // Stage 266 — transition chip only on the latest done row, and only
            // when its verdict differs from the previous done run.
            const transitionChip =
              transition && transition.runId === check.id
                ? {
                    label: `${verdictLabel(transition.fromWorks, "", t).label} → ${verdictLabel(transition.toWorks, "", t).label}`,
                    cls: transition.direction === "improved" ? TONE_CLASS.passed : TONE_CLASS.failed,
                  }
                : null;
            return (
              <li key={check.id}>
                <Link
                  href={`/projects/${id}/visual-checks/${check.id}`}
                  className="card block px-4 py-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}>
                        {chip.label}
                      </span>
                      <span className="truncate text-sm font-medium text-gray-800">{check.targetUrl}</span>
                    </div>
                    <span className="flex-shrink-0 text-xs text-gray-500">{formatDateTime(check.createdAt, locale)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    <span className="inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5">
                      {executorLabel(t, check.executor)}
                    </span>
                    <span>{t.visualChecks.evidenceCount.replace("{count}", String(check.evidenceCount))}</span>
                    {transitionChip && (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${transitionChip.cls}`}>
                        {transitionChip.label}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

// Stage 262 — Visual check report detail. Renders the persisted Korean
// non-dev report (Stage 260B layout): verdict heading + works chip, one-line
// lead, meta, findings cards, screenshots, flow video, copy-ready agent fix
// prompt, next steps and notes. Client component (localStorage userKey).
// Stage 264 — while the run is queued/running, shows a progress state and
// polls the detail every 5s until it lands on done|failed.
// Stage 266 — when an older done run exists, renders the "이전 검수와 비교"
// section: verdict transition, findings resolved/remaining/new, and
// side-by-side screenshot pairs (previous vs latest).
// Stage 269 — on a done-but-not-working run, renders the "[고치기]" repair
// section: dispatches a Stage 268 repair job (draft PR carrying the fix
// brief — code is NOT auto-applied), polls it every 5s, then links the
// resulting GitHub PR ("수리 시작점 PR").
// Stage 272 — the repair-done card explains that the live site only changes
// after merge + deploy, and offers a one-click re-check (new Stage 264 run →
// navigate to its detail, which auto-shows the Stage 266 comparison).

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  getVisualCheck,
  listVisualChecks,
  requestRepair,
  getRepair,
  runVisualCheck,
  CENTRAL_PLANE_URL,
  type VisualCheckDetail,
  type NonDevFinding,
  type RepairJob,
} from "@/lib/workspace-visual-checks-api";
import {
  verdictLabel,
  severityLabel,
  severityTone,
  splitEvidenceKeys,
  buildEvidenceUrl,
} from "@/lib/visual-check-view.mjs";
import type { VerdictTone, SeverityTone } from "@/lib/visual-check-view.mjs";
import { compareVisualChecks, pickPreviousDoneCheck } from "@/lib/visual-check-compare.mjs";
import type { VisualCheckComparison, ComparedFinding } from "@/lib/visual-check-compare.mjs";
import { isActiveStatus, mapRunError, RUN_POLL_INTERVAL_MS } from "@/lib/visual-check-run-state.mjs";
import type { RunErrorKey } from "@/lib/visual-check-run-state.mjs";
import {
  canRepair,
  isRepairActive,
  repairFailureKind,
  isEnvCause,
  repairErrorKey,
  REPAIR_POLL_INTERVAL_MS,
} from "@/lib/repair-state.mjs";
import type { RepairErrorKey } from "@/lib/repair-state.mjs";
import { SimsaStampThinking } from "@/components/SimsaStampThinking";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};

const SEVERITY_CLASS: Record<SeverityTone, string> = {
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
  decision: "bg-slate-50 text-slate-600 border-slate-200",
};

// Stage 266 — chip tones for the verdict transition direction. Colors carry
// meaning only: improved reuses the passed token, regressed the failed token,
// unchanged stays neutral slate.
const DIRECTION_CLASS: Record<"improved" | "regressed" | "unchanged", string> = {
  improved: "bg-green-50 text-green-700 border-green-200",
  regressed: "bg-red-50 text-red-700 border-red-200",
  unchanged: "bg-slate-50 text-slate-600 border-slate-200",
};

function formatDateTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function FindingCard({ finding, t }: { finding: NonDevFinding; t: Dictionary }) {
  return (
    <div className="card p-4">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${SEVERITY_CLASS[severityTone(finding.severity)]}`}>
        {severityLabel(finding.severity, t)}
      </span>
      <dl className="mt-3 space-y-2.5">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.visualChecks.findingWhat}</dt>
          <dd className="mt-0.5 text-sm font-medium text-gray-800">{finding.what}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.visualChecks.findingWhy}</dt>
          <dd className="mt-0.5 text-sm leading-relaxed text-gray-600">{finding.why}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t.visualChecks.findingHow}</dt>
          <dd className="mt-0.5 text-sm leading-relaxed text-gray-600">{finding.how}</dd>
        </div>
      </dl>
      {finding.evidence && (
        <details className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">{t.visualChecks.findingTech}</summary>
          <code className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-gray-600">{finding.evidence}</code>
        </details>
      )}
    </div>
  );
}

// Stage 266 — one of the three finding lists (resolved / remaining / new).
function ComparedFindingList({
  title,
  emptyText,
  items,
  t,
}: {
  title: string;
  emptyText: string;
  items: ComparedFinding[];
  t: Dictionary;
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-gray-500">{emptyText}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASS[severityTone(f.severity)]}`}>
                {severityLabel(f.severity, t)}
              </span>
              <span className="min-w-0 text-sm leading-snug text-gray-700">{f.what}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ComparableResult = Extract<VisualCheckComparison, { comparable: true }>;

// Stage 266 — "이전 검수와 비교": verdict transition + resolved/remaining/new
// findings + side-by-side screenshot pairs (previous vs latest run evidence).
function ComparisonSection({
  result,
  projectId,
  prevRunId,
  latestRunId,
  userKey,
  t,
}: {
  result: ComparableResult;
  projectId: string;
  prevRunId: string;
  latestRunId: string;
  userKey: string;
  t: Dictionary;
}) {
  // Screenshot pairs can be heavy — collapsed by default behind a toggle.
  const [showShots, setShowShots] = useState(false);
  const { verdictTransition, findings, evidencePairs } = result;
  const fromVerdict = verdictLabel(verdictTransition.from.works, verdictTransition.from.decision, t);
  const toVerdict = verdictLabel(verdictTransition.to.works, verdictTransition.to.decision, t);
  const hasScreenshotBlock =
    evidencePairs.pairs.length > 0 || evidencePairs.prevOnly.length > 0 || evidencePairs.latestOnly.length > 0;

  return (
    <section className="card p-5">
      <h3 className="section-title">{t.visualChecks.compare.title}</h3>
      <p className="section-desc leading-relaxed">{t.visualChecks.compare.desc}</p>

      {/* Verdict transition line */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${DIRECTION_CLASS[verdictTransition.direction]}`}>
          {t.visualChecks.compare[verdictTransition.direction]}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[fromVerdict.tone]}`}>
            {fromVerdict.label}
          </span>
          <span aria-hidden className="text-xs text-gray-500">→</span>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[toVerdict.tone]}`}>
            {toVerdict.label}
          </span>
        </span>
      </div>

      {/* Findings: resolved / still present / new */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <ComparedFindingList
          title={t.visualChecks.compare.resolvedTitle}
          emptyText={t.visualChecks.compare.noneResolved}
          items={findings.resolved}
          t={t}
        />
        <ComparedFindingList
          title={t.visualChecks.compare.remainingTitle}
          emptyText={t.visualChecks.compare.noneRemaining}
          items={findings.remaining}
          t={t}
        />
        <ComparedFindingList
          title={t.visualChecks.compare.introducedTitle}
          emptyText={t.visualChecks.compare.noneIntroduced}
          items={findings.introduced}
          t={t}
        />
      </div>

      {/* Side-by-side screenshot pairs (previous vs latest) */}
      {hasScreenshotBlock && (
        <div className="mt-4">
          <button onClick={() => setShowShots((v) => !v)} className="btn btn-secondary btn-sm">
            {showShots ? t.visualChecks.compare.hideScreenshots : t.visualChecks.compare.showScreenshots}
          </button>
          {showShots && (
            <div className="mt-3 space-y-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {t.visualChecks.compare.screenshotsTitle}
              </h4>
              {evidencePairs.pairs.length === 0 && (
                <p className="text-xs text-gray-500">{t.visualChecks.compare.noPairs}</p>
              )}
              {evidencePairs.pairs.map((pair) => (
                <div key={pair.name}>
                  <p className="font-mono text-[10px] text-gray-500">{pair.name.replace(/^screenshots\//, "")}</p>
                  <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                    {([
                      { label: t.visualChecks.compare.prevLabel, rid: prevRunId },
                      { label: t.visualChecks.compare.latestLabel, rid: latestRunId },
                    ] as const).map(({ label, rid }) => (
                      <figure key={rid} className="card overflow-hidden">
                        <figcaption className="border-b border-gray-100 px-3 py-1.5 text-[11px] font-medium text-gray-500">
                          {label}
                        </figcaption>
                        {/* Evidence sits behind the userKey — plain <img> keeps the
                            private query URL out of Next's optimizer (Stage 262). */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={buildEvidenceUrl(CENTRAL_PLANE_URL, projectId, rid, pair.name, userKey)}
                          alt={`${label} — ${pair.name}`}
                          loading="lazy"
                          className="w-full bg-gray-50"
                        />
                      </figure>
                    ))}
                  </div>
                </div>
              ))}
              {evidencePairs.prevOnly.length > 0 && (
                <p className="text-[11px] leading-relaxed text-gray-500">
                  {t.visualChecks.compare.prevOnly}:{" "}
                  <span className="font-mono">{evidencePairs.prevOnly.map((n) => n.replace(/^screenshots\//, "")).join(", ")}</span>
                </p>
              )}
              {evidencePairs.latestOnly.length > 0 && (
                <p className="text-[11px] leading-relaxed text-gray-500">
                  {t.visualChecks.compare.latestOnly}:{" "}
                  <span className="font-mono">{evidencePairs.latestOnly.map((n) => n.replace(/^screenshots\//, "")).join(", ")}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Stage 272 — after the repair PR is ready, the done card carries an honest
// explainer (the fix lives on a PR branch; the LIVE site only changes after
// merge + deploy) and a one-click re-check that dispatches a new Stage 264
// run and navigates to its detail page (which polls and auto-shows the
// Stage 266 comparison once done).
type RecheckNotice = { kind: "queuedOnly" } | { kind: "error"; errorKey: RunErrorKey };

// Stage 269 — "[고치기]": dispatch a repair job for a done-but-not-working
// run, poll it every 5s, and surface the resulting draft PR. Honest copy:
// the PR carries the fix brief (SIMSA-FIX-BRIEF.md) — code changes are NOT
// auto-applied yet; the PR is the handoff point for an agent/developer.
function RepairSection({
  projectId,
  runId,
  userKey,
  t,
  locale,
}: {
  projectId: string;
  runId: string;
  userKey: string;
  t: Dictionary;
  locale: Locale;
}) {
  const s = t.visualChecks.repair;
  const router = useRouter();
  // null = no repair job yet (show the button); otherwise render the job state.
  const [repair, setRepair] = useState<RepairJob | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "submitting">("loading");
  const [errorKey, setErrorKey] = useState<RepairErrorKey | null>(null);
  // Stage 272 — post-repair re-check dispatch state.
  const [recheckSubmitting, setRecheckSubmitting] = useState(false);
  const [recheckNotice, setRecheckNotice] = useState<RecheckNotice | null>(null);

  // On mount, GET once — if a repair already exists, render its state
  // instead of the bare button (and resume polling when it is still active).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getRepair(projectId, runId, userKey);
      if (cancelled) return;
      if (res.ok) setRepair(res.repair);
      setPhase("ready");
    })();
    return () => { cancelled = true; };
  }, [projectId, runId, userKey]);

  // Poll the job every 5s while it is queued/running. The interval clears on
  // unmount and once the job is terminal (done/failed/unknown).
  const active = isRepairActive(repair);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await getRepair(projectId, runId, userKey);
      if (cancelled || !res.ok) return;
      setRepair(res.repair);
    }, REPAIR_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, projectId, runId, userKey]);

  async function handleRepair() {
    if (phase !== "ready") return;
    setPhase("submitting");
    setErrorKey(null);
    const res = await requestRepair(projectId, runId, userKey, locale);
    if (res.ok) {
      // Undispatched jobs come back already failed (dispatched:false) with
      // the reason in `note` — surface it through the failed card.
      setRepair(res.dispatched ? res.repair : { ...res.repair, error: res.repair.error ?? res.note ?? null });
    } else {
      const key = repairErrorKey(res.error);
      if (key === "alreadyActive") {
        // 409 — another repair is already running: resume polling that job.
        const g = await getRepair(projectId, runId, userKey);
        if (g.ok && g.repair) {
          setRepair(g.repair);
          setPhase("ready");
          return;
        }
      }
      setErrorKey(key);
    }
    setPhase("ready");
  }

  // Stage 272 — same POST run dispatch as the Stage 264 list page. On a
  // dispatched run we navigate straight to its detail page; a queued-only
  // (degraded runner) or error answer keeps the user here with a callout.
  async function handleRecheck() {
    if (recheckSubmitting) return;
    setRecheckSubmitting(true);
    setRecheckNotice(null);
    const res = await runVisualCheck(projectId, { userKey, locale });
    if (res.ok && res.dispatched) {
      // Keep the button disabled while the navigation happens.
      router.push(`/projects/${projectId}/visual-checks/${res.check.id}`);
      return;
    }
    if (res.ok) {
      setRecheckNotice({ kind: "queuedOnly" });
    } else {
      setRecheckNotice({ kind: "error", errorKey: mapRunError(res.error) });
    }
    setRecheckSubmitting(false);
  }

  const isDone = repair !== null && repair.status === "done";
  const isFailed = repair !== null && repair.status === "failed";
  // The button shows when no job exists yet, or again after a failed one.
  const showButton = phase !== "loading" && !active && !isDone;

  return (
    <section className="card p-5">
      <h3 className="section-title">{s.title}</h3>
      <p className="section-desc leading-relaxed">{s.desc}</p>

      {phase === "loading" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.common.loading}
        </div>
      )}

      {/* Active job — queued/running, polled every 5s */}
      {active && repair && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">
              {s.progressTitle}
              <span className="ml-2 inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {repair.status === "queued" ? s.statusQueued : s.statusRunning}
              </span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">{s.progressBody}</p>
          </div>
        </div>
      )}

      {/* Done — the repair starting-point PR is ready */}
      {isDone && repair && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">{s.doneTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-green-700">{s.doneBody}</p>
          {isEnvCause(repair) && (
            <div className="callout mt-3 border-amber-200 bg-amber-50 text-amber-700">
              {s.envCauseWarning}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {repair.prUrl ? (
              <a href={repair.prUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                {s.openPr}
              </a>
            ) : (
              <p className="text-xs text-green-700">{s.noPrNote}</p>
            )}
            {repair.branchName && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                {s.branchLabel}
                <code className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-gray-600">
                  {repair.branchName}
                </code>
              </span>
            )}
          </div>

          {/* Stage 272 — honest merge+deploy explainer + one-click re-check */}
          <div className="mt-3 border-t border-green-200 pt-3">
            <p className="text-sm leading-relaxed text-green-700">{s.recheckExplainer}</p>
            <button
              onClick={handleRecheck}
              disabled={recheckSubmitting}
              className="btn btn-secondary btn-sm mt-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recheckSubmitting ? t.visualChecks.runSubmitting : s.recheckButton}
            </button>
            {recheckNotice?.kind === "queuedOnly" && (
              <div className="callout callout-info mt-2">{t.visualChecks.runQueuedOnly}</div>
            )}
            {recheckNotice?.kind === "error" && (
              <div
                className={`callout mt-2 ${
                  recheckNotice.errorKey === "runAlreadyActive" ||
                  recheckNotice.errorKey === "websiteSourceRequired"
                    ? "callout-info"
                    : "callout-error"
                }`}
              >
                {t.visualChecks.runErrors[recheckNotice.errorKey]}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Failed: repo access denied — non-dev guidance (private repo / no
          permission) with a path to the repo-connection screen instead of a
          raw git error (auto_fix 성숙 2026-07-20). */}
      {isFailed && repair && repairFailureKind(repair) === "repoAccessDenied" && (
        <div className="callout callout-info mt-4">
          <p className="text-sm font-medium">{s.failedRepoAccessTitle}</p>
          <p className="mt-1 text-sm leading-relaxed">{s.failedRepoAccessBody}</p>
          <Link href={`/projects/${projectId}/github`} className="btn btn-secondary btn-sm mt-2">
            {s.goToRepo}
          </Link>
        </div>
      )}

      {/* Failed — localized error card + collapsible developer details */}
      {isFailed && repair && repairFailureKind(repair) !== "repoAccessDenied" && (
        <div className="callout callout-error mt-4">
          <p className="text-sm font-medium">{s.failedTitle}</p>
          <p className="mt-1 text-sm leading-relaxed">{s.failedBody}</p>
          {repair.error && (
            <details className="mt-2 rounded-md border border-red-100 bg-white/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-red-600">{s.detailsLabel}</summary>
              <code className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-red-700">
                {repair.error}
              </code>
            </details>
          )}
        </div>
      )}

      {/* Request errors that never created a job */}
      {errorKey === "repoRequired" && (
        <div className="callout callout-info mt-4">
          <p>{s.errors.repoRequired}</p>
          <Link href={`/projects/${projectId}/github`} className="btn btn-secondary btn-sm mt-2">
            {s.goToRepo}
          </Link>
        </div>
      )}
      {errorKey === "tokenRequired" && (
        <div className="callout callout-info mt-4">
          <p>{s.errors.tokenRequired}</p>
          <Link href={`/projects/${projectId}/settings`} className="btn btn-secondary btn-sm mt-2">
            {s.goToGithubSettings}
          </Link>
        </div>
      )}
      {errorKey !== null && errorKey !== "repoRequired" && errorKey !== "tokenRequired" && (
        <div className="callout callout-error mt-4">{s.errors[errorKey]}</div>
      )}

      {showButton && (
        <button
          onClick={handleRepair}
          disabled={phase === "submitting"}
          className="btn btn-primary btn-sm mt-4"
        >
          {phase === "submitting" ? s.submitting : s.button}
        </button>
      )}
    </section>
  );
}

export default function VisualCheckDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "notfound" | "error">("loading");
  const [check, setCheck] = useState<VisualCheckDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stage 266 — the most recent done run older than this one, for comparison.
  const [prevCheck, setPrevCheck] = useState<VisualCheckDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      const res = await getVisualCheck(id, runId, userKey);
      if (cancelled) return;
      if (res.ok) {
        setCheck(res.check);
        setPhase("done");
      } else if (res.error === "not_found" || res.error === "forbidden") {
        setPhase("notfound");
      } else {
        setPhase("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, runId, userKey]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // Stage 266 — once this run's report is done, look for the most recent
  // OLDER done run of the same project and load its detail for comparison.
  // Best-effort: any list/detail failure just leaves the section hidden.
  const doneCreatedAt = phase === "done" && check?.status === "done" ? check.createdAt : null;
  useEffect(() => { setPrevCheck(null); }, [runId]);
  useEffect(() => {
    if (!doneCreatedAt) return;
    let cancelled = false;
    (async () => {
      const listRes = await listVisualChecks(id, userKey);
      if (cancelled || !listRes.ok) return;
      const prev = pickPreviousDoneCheck(listRes.checks, runId, doneCreatedAt);
      if (!prev) return;
      const prevRes = await getVisualCheck(id, prev.id, userKey);
      if (cancelled || !prevRes.ok) return;
      setPrevCheck(prevRes.check);
    })();
    return () => { cancelled = true; };
  }, [doneCreatedAt, id, runId, userKey]);

  // Stage 264 — while the run is queued/running, silently re-fetch the detail
  // every 5s. The interval clears on unmount and once the run is terminal
  // (done/failed/unknown), so it never polls forever.
  const isRunActive = phase === "done" && check !== null && isActiveStatus(check.status);
  useEffect(() => {
    if (!isRunActive) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await getVisualCheck(id, runId, userKey);
      if (cancelled || !res.ok) return;
      setCheck(res.check);
    }, RUN_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isRunActive, id, runId, userKey]);

  if (!project) return <p className="text-sm text-gray-500">{t.common.notFound}</p>;

  async function handleCopyPrompt() {
    if (!check?.agentPrompt) return;
    try {
      await navigator.clipboard.writeText(check.agentPrompt);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — leave the button as-is.
    }
  }

  const report = check?.report ?? null;
  const verdict = check ? verdictLabel(check.works, check.decision, t) : null;
  const evidence = splitEvidenceKeys(check?.evidenceKeys ?? []);
  const findings = report?.findings ?? [];
  const nextSteps = report?.nextSteps ?? [];
  const notes = report?.notes ?? [];

  // Stage 266 — pure comparison, recomputed from state (never fetched twice).
  // Non-comparable results (e.g. the older run has no report) hide the section.
  const comparisonRaw =
    prevCheck && check && check.status === "done" ? compareVisualChecks(prevCheck, check) : null;
  const comparison = comparisonRaw?.comparable ? comparisonRaw : null;

  return (
    <div className="space-y-6">
      <Link href={`/projects/${id}/visual-checks`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
        ← {t.visualChecks.backToList}
      </Link>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.visualChecks.loading}
        </div>
      )}

      {phase === "notfound" && (
        <div className="callout callout-info">{t.visualChecks.notFound}</div>
      )}

      {phase === "error" && (
        <div className="callout callout-error">{t.visualChecks.loadError}</div>
      )}

      {/* Stage 264 — progress state while the run is queued/running */}
      {isRunActive && check && (
        <section className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
          <SimsaStampThinking
            variant="panel"
            label={check.status === "queued" ? t.visualChecks.statusQueued : t.visualChecks.statusRunning}
          />
          <div>
            <h2 className="text-base font-semibold text-gray-800">{t.visualChecks.progressTitle}</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">
              {t.visualChecks.progressBody}
            </p>
          </div>
          <p className="break-all font-mono text-[11px] text-gray-500">{check.targetUrl}</p>
        </section>
      )}

      {/* Stage 264 — terminal failure */}
      {phase === "done" && check && check.status === "failed" && (
        <div className="callout callout-error">
          <p className="text-sm font-medium">{t.visualChecks.failedTitle}</p>
          <p className="mt-1 text-sm leading-relaxed">{t.visualChecks.failedBody}</p>
        </div>
      )}

      {phase === "done" && check && verdict && !isActiveStatus(check.status) && check.status !== "failed" && (
        <>
          {/* Verdict heading + works chip */}
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="page-title">{report?.verdict || verdict.label}</h2>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[verdict.tone]}`}>
                {verdict.label}
              </span>
            </div>
            {report?.oneLine && <p className="page-subtitle">{report.oneLine}</p>}
          </div>

          {/* Meta: target / intent / date */}
          <section className="card p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-500">{t.visualChecks.metaTarget}</dt>
                <dd className="min-w-0 break-all text-gray-700">
                  <a href={check.targetUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    {check.targetUrl}
                  </a>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-500">{t.visualChecks.metaIntent}</dt>
                <dd className="min-w-0 leading-relaxed text-gray-700">{report?.intent || check.intent}</dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-500">
                  {check.executor === "container" ? t.visualChecks.executorContainer : t.visualChecks.executorLocal}
                </dt>
                <dd className="text-gray-500">{formatDateTime(check.createdAt, locale)}</dd>
              </div>
            </dl>
          </section>

          {/* Stage 266 — compared with the previous inspection */}
          {comparison && prevCheck && (
            <ComparisonSection
              result={comparison}
              projectId={id}
              prevRunId={prevCheck.id}
              latestRunId={runId}
              userKey={userKey}
              t={t}
            />
          )}

          {/* Findings */}
          <section className="space-y-3">
            <h3 className="section-title">{t.visualChecks.findingsTitle}</h3>
            {findings.length === 0 ? (
              <p className="text-xs text-gray-500">{t.visualChecks.noFindings}</p>
            ) : (
              findings.map((f, i) => <FindingCard key={i} finding={f} t={t} />)
            )}
          </section>

          {/* Screenshots */}
          {evidence.screenshots.length > 0 && (
            <section className="space-y-3">
              <h3 className="section-title">{t.visualChecks.screenshotsTitle}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {evidence.screenshots.map((name) => (
                  <figure key={name} className="card overflow-hidden">
                    {/* Evidence is served by the central plane behind the userKey — a
                        plain <img> keeps the private query URL out of Next's optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={buildEvidenceUrl(CENTRAL_PLANE_URL, id, runId, name, userKey)}
                      alt={name}
                      loading="lazy"
                      className="w-full bg-gray-50"
                    />
                    <figcaption className="border-t border-gray-100 px-3 py-1.5 font-mono text-[10px] text-gray-500">
                      {name.replace(/^screenshots\//, "")}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}

          {/* Flow video */}
          {evidence.video && (
            <section className="space-y-3">
              <h3 className="section-title">{t.visualChecks.videoTitle}</h3>
              <video
                controls
                preload="metadata"
                src={buildEvidenceUrl(CENTRAL_PLANE_URL, id, runId, evidence.video, userKey)}
                className="card w-full"
              />
            </section>
          )}

          {/* Stage 269 — "[고치기]": only a finished run that did NOT verify
              as working can dispatch a repair (draft fix-brief PR). */}
          {canRepair(check) && (
            <RepairSection projectId={id} runId={runId} userKey={userKey} t={t} locale={locale} />
          )}

          {/* Copy-ready agent fix prompt */}
          <section className="card p-5">
            <h3 className="section-title">{t.visualChecks.fixTitle}</h3>
            {check.agentPrompt ? (
              <>
                <p className="section-desc leading-relaxed">{t.visualChecks.fixBody}</p>
                <button
                  onClick={handleCopyPrompt}
                  className="btn btn-primary btn-sm mt-3"
                >
                  {copied ? t.visualChecks.copied : t.visualChecks.copyPrompt}
                </button>
              </>
            ) : (
              <p className="section-desc">{t.visualChecks.noPrompt}</p>
            )}
          </section>

          {/* Next steps */}
          {nextSteps.length > 0 && (
            <section className="card p-5">
              <h3 className="section-title">{t.visualChecks.nextStepsTitle}</h3>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                {nextSteps.map((step, i) => (
                  <li key={i} className="text-sm leading-relaxed text-gray-600">{step}</li>
                ))}
              </ol>
            </section>
          )}

          {/* Notes */}
          {notes.length > 0 && (
            <section className="card p-5">
              <h3 className="section-title">{t.visualChecks.notesTitle}</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                {notes.map((note, i) => (
                  <li key={i} className="text-xs leading-relaxed text-gray-500">{note}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

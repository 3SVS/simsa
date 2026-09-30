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
// section: dispatches a repair job (Stage 270 auto_fix → PR with real code
// changes; fallback brief_only → fix-brief draft PR), polls it every 5s, then
// links the resulting GitHub PR.
// Stage 272 — the repair-done card explains that the live site only changes
// after merge + deploy, and offers a one-click re-check (new Stage 264 run →
// navigate to its detail, which auto-shows the Stage 266 comparison).

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ProjectNotFound } from "@/components/ProjectNotFound";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey, loadExtendedProjectData, saveExtendedProjectData } from "@/lib/workflow-store";
import { screenshotCaption, screenshotFileName } from "@/lib/screenshot-caption.mjs";
import {
  getVisualCheck,
  listVisualChecks,
  requestRepair,
  getRepair,
  runVisualCheck,
  submitUserVerdict,
  recordFixPromptCopied,
  CENTRAL_PLANE_URL,
  type VisualCheckDetail,
  type NonDevFinding,
  type RepairJob,
} from "@/lib/workspace-visual-checks-api";
import {
  USER_VERDICT_OPTIONS,
  normalizeUserVerdict,
  userVerdictErrorKey,
  userVerdictLabel,
  pickDefaultPromptTarget,
  fixPromptFor,
  availablePromptTargets,
} from "@/lib/user-verdict.mjs";
import type { UserVerdict, UserVerdictErrorKey, FixPromptTarget } from "@/lib/user-verdict.mjs";
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
import { isActiveStatus, runErrorNotice, runErrorTone, RUN_POLL_INTERVAL_MS } from "@/lib/visual-check-run-state.mjs";
import type { RunErrorKey } from "@/lib/visual-check-run-state.mjs";
import { errorNoticeText } from "@/lib/daily-limit.mjs";
import { buildRecheckBody } from "@/lib/visual-check-recheck.mjs";
import {
  canRepair,
  hasSomethingToFix,
  repairEntryMode,
  isRepairActive,
  repairFailureKind,
  isEnvCause,
  repairErrorNotice,
  repairErrorTone,
  showBuildUnverified,
  repairDoneKind,
  REPAIR_POLL_INTERVAL_MS,
} from "@/lib/repair-state.mjs";
import type { RepairErrorKey } from "@/lib/repair-state.mjs";
import { fetchProjectRepo } from "@/lib/workspace-github-api";
import { fetchProjectRepoSettled, repoConnectedFact } from "@/lib/repo-settle.mjs";
import { SimsaStampThinking } from "@/components/SimsaStampThinking";
import { EvidenceChainSection } from "@/components/EvidenceChainSection";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  // ★"문제를 찾지 못했어요" — 확인한 것(초록)도, 못 본 것(앰버)도 아닌 자리.
  //  근거를 모아 따라가 봤고 결함이 없었다는 뜻이라 중립적 파랑을 쓴다.
  clear: "bg-sky-50 text-sky-700 border-sky-200",
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
      {/* ★순환의 고리 (2026-09-01) — "이걸 고치면 다음엔 여기까지 봅니다".
          고칠 이유가 우리 편의가 아니라 **사용자의 이익**이어야 실제로 고친다.
          그리고 고침이 다음 단계로 이어지는 게 눈에 보여야 한 바퀴가 돈다. */}
      {finding.unlocks && (
        <p className="mt-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
          {finding.unlocks}
        </p>
      )}
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
              {evidencePairs.pairs.map((pair, pairIndex) => (
                <div key={pair.name}>
                  <p title={screenshotFileName(pair.name)} className="text-[11px] font-medium text-gray-600">
                    {screenshotCaption(pair.name, pairIndex, {
                      initial: t.visualChecks.shotInitial,
                      afterStep: t.visualChecks.shotAfterStep,
                      final: t.visualChecks.shotFinal,
                    })}
                  </p>
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
                  <span>{evidencePairs.prevOnly.map((n, i) => screenshotCaption(n, i, { initial: t.visualChecks.shotInitial, afterStep: t.visualChecks.shotAfterStep, final: t.visualChecks.shotFinal })).join(", ")}</span>
                </p>
              )}
              {evidencePairs.latestOnly.length > 0 && (
                <p className="text-[11px] leading-relaxed text-gray-500">
                  {t.visualChecks.compare.latestOnly}:{" "}
                  <span>{evidencePairs.latestOnly.map((n, i) => screenshotCaption(n, i, { initial: t.visualChecks.shotInitial, afterStep: t.visualChecks.shotAfterStep, final: t.visualChecks.shotFinal })).join(", ")}</span>
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
// Train W — W-2: resetAt rides along so a capped re-check can say when (null otherwise);
// receivedAt = when the answer arrived (#558 검증 2차 P2-1 — "now" only after a reset
// that happened while the notice was on screen).
type RecheckNotice =
  | { kind: "queuedOnly" }
  | { kind: "error"; errorKey: RunErrorKey; resetAt: string | null; receivedAt: number };

// 화면 검수 결과를 프로젝트 상태에 남긴다 — 하단 "다음 한 걸음" 바가 여기서 무엇을
// 가리킬지 정하려면 이 사실이 필요하고, 화면 검수는 `checkResults`에 아무것도 쓰지
// 않는다. 리포트 전체가 아니라 판단에 쓰는 최소만 저장한다. runId(#559 여정 렌즈
// 결함 2): "고칠 것" 화면이 이 결과 화면을 가리킬 수 있게.
function rememberVisualResult(projectId: string, check: VisualCheckDetail): void {
  saveExtendedProjectData(projectId, {
    visualCheck: {
      decision: check.decision,
      findingCount: check.report?.findings?.length ?? 0,
      at: check.createdAt,
      runId: check.id,
    },
  });
}

// Stage 272 — same POST run dispatch as the Stage 264 list page. On a
// dispatched run we navigate straight to its detail page; a queued-only
// (degraded runner) or error answer keeps the user here with a callout.
// Train C — C0 (계약 1): the re-check carries the ORIGINAL intent and the
// source run id, so "check again after the fix" measures with the same
// yardstick instead of the server's generic default sentence.
// Train C — C2a: shared by the repair card (linked repo) and the builder-paste
// card (address-only app) so both "check again" buttons behave identically.
function useRecheck(projectId: string, check: VisualCheckDetail, userKey: string, locale: Locale) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<RecheckNotice | null>(null);

  async function run() {
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    // PR #552 검증 결함 #2: a first run carries the server's default sentence as its
    // intent (projects/new sends none). That is not a yardstick anyone chose, so the
    // project's confirmed one-line ("맞나요?" card) travels instead — otherwise the
    // contract-1 cascade stops at body.intent and never reaches productSpec.oneLine.
    const res = await runVisualCheck(
      projectId,
      buildRecheckBody(check, userKey, locale, {
        confirmedIntent: loadExtendedProjectData(projectId)?.productSpec?.oneLine ?? null,
      }),
    );
    if (res.ok && res.dispatched) {
      // Keep the button disabled while the navigation happens.
      router.push(`/projects/${projectId}/visual-checks/${res.check.id}`);
      return;
    }
    if (res.ok) {
      setNotice({ kind: "queuedOnly" });
    } else {
      // The whole answer, not just its code — a 429 carries resetAt (W-2).
      setNotice({ kind: "error", ...runErrorNotice(res), receivedAt: Date.now() });
    }
    setSubmitting(false);
  }

  return { submitting, notice, run };
}

function RecheckNoticeView({ notice, t }: { notice: RecheckNotice | null; t: Dictionary }) {
  if (!notice) return null;
  if (notice.kind === "queuedOnly") {
    return <div className="callout callout-info mt-2">{t.visualChecks.runQueuedOnly}</div>;
  }
  const soft = runErrorTone(notice.errorKey) === "info";
  return (
    <div className={`callout mt-2 ${soft ? "callout-info" : "callout-error"}`}>
      {errorNoticeText(t.visualChecks.runErrors, notice.errorKey, notice.resetAt, t.visualChecks.resetWhen, { receivedAt: notice.receivedAt })}
    </div>
  );
}

// Train C — C2a (재정렬 §1 끊김 #4·#5, D-17 amend): an address-only app
// (Lovable / Bolt / v0 / Base44 … — no code repository linked) cannot use the
// server repair job, and before Train C it still saw the "[고치기]" button,
// which ended in "connect a GitHub repository first". Now it gets the two-step
// path it can actually walk: paste the builder prompt into the tool's chat →
// publish → "check again" (same intent, same yardstick — C0). Linking code is
// offered as an optional sentence, never as the gate.
function BuilderPasteSection({
  projectId,
  check,
  userKey,
  t,
  locale,
}: {
  projectId: string;
  check: VisualCheckDetail;
  userKey: string;
  t: Dictionary;
  locale: Locale;
}) {
  const s = t.visualChecks.builderPaste;
  const recheck = useRecheck(projectId, check, userKey, locale);
  return (
    <section className="card p-5">
      <h3 className="section-title">{s.title}</h3>
      <p className="section-desc leading-relaxed">{s.body}</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">
        <li className="text-sm leading-relaxed text-gray-600">{s.step1}</li>
        <li className="text-sm leading-relaxed text-gray-600">{s.step2}</li>
      </ol>
      <button
        onClick={() => void recheck.run()}
        disabled={recheck.submitting}
        className="btn btn-secondary btn-sm mt-3 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {recheck.submitting ? t.visualChecks.runSubmitting : s.recheckButton}
      </button>
      <RecheckNoticeView notice={recheck.notice} t={t} />
      {/* #559 여정 렌즈 결함 7: "connect your code" goes where connecting actually
          happens (준비·연결). It used to open the code-changes (PR) screen, which
          for an unlinked project only said "connect a repository first". */}
      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        {s.repoOptional}{" "}
        <Link href={`/projects/${projectId}/settings`} className="underline hover:text-gray-700">
          {s.repoOptionalLink}
        </Link>
      </p>
    </section>
  );
}

// Stage 269 — "[고치기]": dispatch a repair job for a done-but-not-working
// run, poll it every 5s, and surface the resulting PR. Honest copy: before
// and during the job the mode is unknown, so the copy promises neither; when
// done, repairDoneKind picks auto_fix (code changed) or brief_only (the PR
// carries only SIMSA-FIX-BRIEF.md — the handoff point for an agent/developer).
function RepairSection({
  projectId,
  runId,
  check,
  userKey,
  t,
  locale,
}: {
  projectId: string;
  runId: string;
  /** Train C — C0: the run being repaired; its intent/id travel with the re-check. */
  check: VisualCheckDetail;
  userKey: string;
  t: Dictionary;
  locale: Locale;
}) {
  const s = t.visualChecks.repair;
  // null = no repair job yet (show the button); otherwise render the job state.
  const [repair, setRepair] = useState<RepairJob | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "submitting">("loading");
  // Train W — W-2: the request error plus the daily cap's resetAt (null otherwise)
  // and when the answer arrived (#558 검증 2차 P2-1).
  const [errorNotice, setErrorNotice] = useState<{ errorKey: RepairErrorKey; resetAt: string | null; receivedAt: number } | null>(null);
  // Stage 272 — post-repair re-check dispatch (shared hook, Train C — C0/C2a).
  const recheck = useRecheck(projectId, check, userKey, locale);

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
    setErrorNotice(null);
    const res = await requestRepair(projectId, runId, userKey, locale);
    if (res.ok) {
      // Undispatched jobs come back already failed (dispatched:false) with
      // the reason in `note` — surface it through the failed card.
      setRepair(res.dispatched ? res.repair : { ...res.repair, error: res.repair.error ?? res.note ?? null });
    } else {
      // The whole answer, not just its code — a 429 carries resetAt (W-2).
      const notice = { ...repairErrorNotice(res), receivedAt: Date.now() };
      if (notice.errorKey === "alreadyActive") {
        // 409 — another repair is already running: resume polling that job.
        const g = await getRepair(projectId, runId, userKey);
        if (g.ok && g.repair) {
          setRepair(g.repair);
          setPhase("ready");
          return;
        }
      }
      setErrorNotice(notice);
    }
    setPhase("ready");
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
            {/* Train W — W-3 ①: a queued job says it is waiting its turn. */}
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              {repair.status === "queued" ? s.progressBodyQueued : s.progressBody}
            </p>
          </div>
        </div>
      )}

      {/* Done — the repair PR is ready. Train W — W-3 ③: a job that really
          changed code (auto_fix) says so; a brief-only job keeps the "code was
          not changed" copy. The build line appears only on an auto_fix job with
          buildVerified === false (same test as the done copy — never both). */}
      {isDone && repair && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">
            {repairDoneKind(repair) === "autoFix" ? s.doneTitleAutoFix : s.doneTitle}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-green-700">
            {repairDoneKind(repair) === "autoFix" ? s.doneBodyAutoFix : s.doneBody}
          </p>
          {showBuildUnverified(repair) && (
            <p className="mt-2 text-sm leading-relaxed text-amber-700">{s.buildUnverified}</p>
          )}
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
              onClick={() => void recheck.run()}
              disabled={recheck.submitting}
              className="btn btn-secondary btn-sm mt-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recheck.submitting ? t.visualChecks.runSubmitting : s.recheckButton}
            </button>
            <RecheckNoticeView notice={recheck.notice} t={t} />
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
      {errorNotice?.errorKey === "repoRequired" && (
        <div className="callout callout-info mt-4">
          <p>{s.errors.repoRequired}</p>
          <Link href={`/projects/${projectId}/github`} className="btn btn-secondary btn-sm mt-2">
            {s.goToRepo}
          </Link>
        </div>
      )}
      {errorNotice?.errorKey === "tokenRequired" && (
        <div className="callout callout-info mt-4">
          <p>{s.errors.tokenRequired}</p>
          <Link href={`/projects/${projectId}/settings`} className="btn btn-secondary btn-sm mt-2">
            {s.goToGithubSettings}
          </Link>
        </div>
      )}
      {errorNotice !== null && errorNotice.errorKey !== "repoRequired" && errorNotice.errorKey !== "tokenRequired" && (
        <div className={`callout mt-4 ${repairErrorTone(errorNotice.errorKey) === "info" ? "callout-info" : "callout-error"}`}>
          {errorNoticeText(s.errors, errorNotice.errorKey, errorNotice.resetAt, t.visualChecks.resetWhen, { receivedAt: errorNotice.receivedAt })}
        </div>
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

// Train C — C2b (계약 2, D-19 amend): "이번 결과, 어떠셨어요?" — the human
// acceptance label. The machine verdict (works/decision) says what the browser
// saw; this says what the PERSON accepted. Four answers, no score. The initial
// value comes from the server on re-open (old servers: no field → nothing
// selected). Re-answering overwrites; a failed save keeps the previous answer
// and says so — a silently "saved" label that never reached the server is the
// worst kind of quiet.
function UserVerdictSection({
  projectId,
  runId,
  userKey,
  initial,
  t,
}: {
  projectId: string;
  runId: string;
  userKey: string;
  initial: UserVerdict | null;
  t: Dictionary;
}) {
  const s = t.visualChecks.userVerdict;
  const [verdict, setVerdict] = useState<UserVerdict | null>(initial);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Why the last save failed: "unavailable" (the route is not on the server that
  // answered — permanent for this session) vs "generic" (worth a retry).
  const [errorKey, setErrorKey] = useState<UserVerdictErrorKey>("generic");
  // A new run detail (or a later server value) resets the selection.
  useEffect(() => { setVerdict(initial); setPhase("idle"); }, [initial, runId]);

  async function choose(next: UserVerdict) {
    if (phase === "saving") return;
    const previous = verdict;
    setVerdict(next);
    setPhase("saving");
    const res = await submitUserVerdict(projectId, runId, userKey, next);
    if (res.ok) {
      // PR #552 검증 P2: the wire value is only a cast — normalize it like the read
      // path does, and keep what the user just chose if the server echoes a value
      // this UI does not know (never "saved" with no chip selected).
      setVerdict(normalizeUserVerdict(res.verdict) ?? next);
      setPhase("saved");
    } else {
      setVerdict(previous);
      setErrorKey(userVerdictErrorKey(res.error));
      setPhase("error");
    }
  }

  return (
    <section className="card p-5">
      <h3 className="section-title">{s.title}</h3>
      <p className="section-desc leading-relaxed">{s.hint}</p>
      <div role="radiogroup" aria-label={s.title} className="mt-3 flex flex-wrap gap-2">
        {USER_VERDICT_OPTIONS.map((opt) => {
          const selected = verdict === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void choose(opt)}
              disabled={phase === "saving"}
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {userVerdictLabel(opt, t)}
            </button>
          );
        })}
      </div>
      {phase === "saving" && <p className="mt-2 text-xs text-gray-500">{s.saving}</p>}
      {phase === "saved" && <p className="mt-2 text-xs text-gray-500">{s.saved}</p>}
      {phase === "error" && (
        <p className="mt-2 text-xs text-red-600">
          {errorKey === "unavailable" ? s.saveUnavailable : s.saveError}
        </p>
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
  // Train C — C2b (계약 3): which fix-instruction format is showing. Only the
  // user's explicit toggle is state; the DEFAULT is derived every render (see
  // `promptTarget` below) from the run, built_with and the repo fact. It used to
  // be state seeded in load() — so a run entered while queued/running (the
  // re-check path: router.push to the new run) was pinned to "cli" and the poll
  // that later delivered the builderPrompt never moved it (PR #552 검증 결함 #1).
  const [explicitPromptTarget, setExplicitPromptTarget] = useState<FixPromptTarget | null>(null);
  // Train C — C2a: is a code repository linked? undefined = still looking ·
  // true = linked · false = confirmed none · null = unknown (fetch failed).
  // Read through repo-settle so a transient D1 null right after a link does not
  // collapse to a hard false (3svs-os error-patterns/transient-null-hard-false).
  const [hasRepo, setHasRepo] = useState<boolean | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setHasRepo(undefined);
    fetchProjectRepoSettled(fetchProjectRepo, id, userKey, { attempts: 1 })
      .then((res) => { if (!cancelled) setHasRepo(repoConnectedFact(res)); })
      .catch(() => { if (!cancelled) setHasRepo(null); });
    return () => { cancelled = true; };
  }, [id, userKey]);
  // PR #552 검증 P2: does this run already have a repair job? It decides the entry
  // mode together with the repo fact — an existing job (progress, PR link) must
  // stay visible even when the repo lookup failed or timed out (hasRepo false /
  // null), where the builder-paste card would otherwise replace it. Separate
  // from RepairSection's own mount GET (that one renders the job's state).
  // undefined = not looked yet · true = a job exists · false = none / unknown.
  const [repairProbe, setRepairProbe] = useState<boolean | undefined>(undefined);
  const probeRepair = check !== null && canRepair(check);
  useEffect(() => {
    setRepairProbe(undefined);
    if (!probeRepair) return;
    let cancelled = false;
    void getRepair(id, runId, userKey).then((res) => {
      if (!cancelled) setRepairProbe(res.ok && res.repair !== null);
    });
    return () => { cancelled = true; };
  }, [probeRepair, id, runId, userKey]);
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
        // 화면 검수 결과를 프로젝트 상태에 남긴다 — 하단 "다음 한 걸음" 바가
        // 여기서 무엇을 가리킬지(고칠 것으로 갈지, 끝났다고 말할지) 정하려면
        // 이 사실이 필요하고, 화면 검수는 `checkResults`에 아무것도 쓰지 않는다.
        // 리포트 전체가 아니라 판단에 쓰는 최소만 저장한다.
        if (res.check.status === "done") rememberVisualResult(id, res.check);
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
  // Train C — C2b: a new run starts from its own default format again.
  useEffect(() => { setExplicitPromptTarget(null); }, [runId]);
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
      // A run that finishes while this page is open (the first check started
      // from the overview lands here while still running) is remembered too.
      if (res.check.status === "done") rememberVisualResult(id, res.check);
    }, RUN_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isRunActive, id, runId, userKey]);

  // #559 여정 렌즈 결함 11 (D10 잔존): this is where the address box lands. It
  // printed a bare English "Not found." on the server / first paint (no local
  // storage there yet); the shared card waits for mount like every other screen.
  if (!project) return <ProjectNotFound />;

  // Train C — C2b (계약 3): the format showing right now. Derived, not stored, so a
  // report that arrives through the 5s poll (or a repo fact that settles later)
  // re-picks the default; the user's explicit toggle, when set, wins.
  // `addressOnly` (PR #552 검증 결함 #3): while no code repository is linked —
  // confirmed none, unknown, or still looking — the C2a card above says "paste it
  // into that tool's chat", so an unknown tool defaults to the pasteable format
  // instead of the CLI prompt that names Claude Code / Cursor (D-17 amend).
  const promptTarget: FixPromptTarget =
    explicitPromptTarget ??
    pickDefaultPromptTarget(
      loadExtendedProjectData(id)?.builtWithTools,
      fixPromptFor(check, "web_builder") !== null,
      { addressOnly: hasRepo !== true },
    );

  async function handleCopyPrompt() {
    const text = fixPromptFor(check, promptTarget);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
      // Train C — C2b (계약 4): "how the result was used" — recorded only after
      // the copy actually happened, and never awaited (measurement must not
      // block the UX; a 404 from an older server is swallowed inside).
      void recordFixPromptCopied(id, runId, userKey, promptTarget);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — leave the button as-is.
    }
  }

  const report = check?.report ?? null;
  // Train C — C2b: the fix-instruction formats this run actually carries.
  const promptTargets = availablePromptTargets(check);
  const activePrompt = fixPromptFor(check, promptTarget);
  const otherPromptTarget: FixPromptTarget | null =
    promptTargets.length > 1 ? (promptTarget === "web_builder" ? "cli" : "web_builder") : null;
  // Train C — C2b: the user's own acceptance label from the server (old servers → null).
  const initialUserVerdict = check ? normalizeUserVerdict(check.userVerdict) : null;
  // Train C — C2a: which "make it work" entry to show. "loading" while the repo
  // fact — and, when no repo is known, the repair-job probe — is still pending, so
  // the area does not flash from one card to the other; a run that cannot be
  // repaired at all shows neither. An existing repair job keeps the repair card
  // whatever the repo fact says (PR #552 검증 P2 — its PR link must not vanish).
  const repairFactsPending = hasRepo === undefined || (hasRepo !== true && repairProbe === undefined);
  const repairMode: "loading" | "repair" | "builder_paste" | "none" = !canRepair(check)
    ? "none"
    : repairFactsPending
      ? "loading"
      : repairEntryMode(check, hasRepo, { hasRepairJob: repairProbe === true });
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
            {/* Train W — W-3 ①: queued says "waiting its turn" + the measured
                request→report time; running keeps the walking-the-flow copy. */}
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">
              {check.status === "queued" ? t.visualChecks.progressBodyQueued : t.visualChecks.progressBody}
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
              {/* Train N4 (§8-8): the timestamp is labelled as what it is —
                  where the run executed is not something the user acts on. */}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-500">{t.visualChecks.metaCheckedAt}</dt>
                <dd className="text-gray-500">{formatDateTime(check.createdAt, locale)}</dd>
              </div>
            </dl>
            {/* Train C · C-3 — the printable/copyable receipt of this check (a text link:
                the report keeps its own single filled button). */}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <Link
                href={`/projects/${id}/visual-checks/${runId}/receipt`}
                className="text-xs text-brand-700 hover:underline"
              >
                {t.visualChecks.receipt.openFromReport} →
              </Link>
            </div>
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

          {/* SI 티어 A5 — 지시서 수용 기준별 결과 (있을 때만). 개수이지 점수가 아니다. */}
          {report?.acceptance && report.acceptance.items.length > 0 && (
            <section className="space-y-3">
              <h3 className="section-title">{t.visualChecks.acceptanceTitle}</h3>
              <p className="text-xs text-gray-500">{t.visualChecks.acceptanceIntro}</p>
              <ul className="space-y-2">
                {report.acceptance.items.map((a) => (
                  <li key={a.acceptanceId} className="card flex flex-wrap items-start gap-x-3 gap-y-1 p-3 text-sm">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-xs font-medium " +
                        (a.status === "broken"
                          ? "bg-red-50 text-red-700"
                          : a.status === "no_problem"
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-600")
                      }
                    >
                      {t.visualChecks.acceptanceStatus[a.status]}
                    </span>
                    <span className="font-medium text-gray-900">{a.featureTitle}</span>
                    <span className="basis-full text-xs text-gray-500">
                      {t.visualChecks.acceptanceExpected}: {a.then}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Train M-1b — "왜 이 판정인가요?" 증거 체인 (펼침 시 lazy 로드) */}
          <EvidenceChainSection projectId={id} runId={runId} userKey={userKey} t={t} />

          {/* Screenshots */}
          {evidence.screenshots.length > 0 && (
            <section className="space-y-3">
              <h3 className="section-title">{t.visualChecks.screenshotsTitle}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {evidence.screenshots.map((name, shotIndex) => (
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
                    {/* Train N4 (§8-8): a step name, not a file name. The raw
                        name stays in the title attribute for developers. */}
                    <figcaption
                      title={screenshotFileName(name)}
                      className="border-t border-gray-100 px-3 py-1.5 text-[11px] font-medium text-gray-600"
                    >
                      {screenshotCaption(name, shotIndex, {
                        initial: t.visualChecks.shotInitial,
                        afterStep: t.visualChecks.shotAfterStep,
                        final: t.visualChecks.shotFinal,
                      })}
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
              as working can dispatch a repair (draft fix-brief PR).
              Train C — C2a: and only when a code repository is linked; an
              address-only app gets the builder-paste path instead (D-17). */}
          {repairMode === "loading" && (
            <section className="card p-5">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
                {t.common.loading}
              </div>
            </section>
          )}
          {repairMode === "repair" && (
            <RepairSection projectId={id} runId={runId} check={check} userKey={userKey} t={t} locale={locale} />
          )}
          {repairMode === "builder_paste" && (
            <BuilderPasteSection projectId={id} check={check} userKey={userKey} t={t} locale={locale} />
          )}

          {/* Copy-ready fix prompt. Train C — C2b (계약 3): two formats. A chat
              builder (Lovable/Bolt/v0/Replit/Base44 in built_with) sees the
              paste-into-chat block by default; everyone else sees the CLI agent
              prompt as before. When the run carries both, a text toggle flips.
              Old runs without builderPrompt render exactly the pre-Train-C UI.
              2026-09-29: only when there is something to fix — a "no problem
              found" result with informational items only shows no fix card
              (hasSomethingToFix, same rule as the server's next steps). */}
          {hasSomethingToFix(check) && (
          <section className="card p-5">
            <h3 className="section-title">{t.visualChecks.fixTitle}</h3>
            {activePrompt ? (
              <>
                <p className="section-desc leading-relaxed">
                  {promptTarget === "web_builder" ? t.visualChecks.fixPrompt.builderBody : t.visualChecks.fixBody}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={handleCopyPrompt} className="btn btn-primary btn-sm">
                    {copied
                      ? t.visualChecks.copied
                      : promptTarget === "web_builder"
                        ? t.visualChecks.fixPrompt.copyBuilder
                        : t.visualChecks.copyPrompt}
                  </button>
                  {otherPromptTarget && (
                    <button
                      type="button"
                      onClick={() => { setExplicitPromptTarget(otherPromptTarget); setCopied(false); }}
                      className="text-xs text-gray-500 underline hover:text-gray-700"
                    >
                      {otherPromptTarget === "cli" ? t.visualChecks.fixPrompt.showCli : t.visualChecks.fixPrompt.showBuilder}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="section-desc">{t.visualChecks.noPrompt}</p>
            )}
          </section>
          )}

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

          {/* Train C — C2b (계약 2): the person's own verdict, last — after
              they have read what we found and (maybe) tried the app again. */}
          <UserVerdictSection
            projectId={id}
            runId={runId}
            userKey={userKey}
            initial={initialUserVerdict}
            t={t}
          />
        </>
      )}
    </div>
  );
}

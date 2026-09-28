"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";
import { IntentConfirmCard } from "@/components/IntentConfirmCard";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getProject, getProjectStats } from "@/lib/mock-data";
import { getLocalProject, getUserKey , consumeProjectSyncFailed } from "@/lib/workflow-store";
import { StatCard } from "@/components/StatCard";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { Tooltip } from "@/components/Tooltip";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel, enumStatusLabel, enumActionLabel, enumLimitationLabel } from "@/i18n/dictionary.mjs";
import {
  getProjectEvolutionLearning,
  getProjectEvolutionTimeline,
  type ProjectEvolutionLearningSignals,
  type ProjectLearningSignal,
  type ProjectEvolutionTimeline,
  type ProjectEvolutionTimelineEvent,
} from "@/lib/workspace-experiment-api";
import {
  topSignalLabelKey,
  formatRatePercent,
  formatAverageDeltaPercent,
  formatAverageDeltaCount,
  learningHasNoData,
} from "@/lib/project-evolution-learning.mjs";
import {
  timelineEventLabelKey,
  timelineLimitationLabelKey,
  timelineHasNoEvents,
} from "@/lib/project-evolution-timeline.mjs";
import {
  listVisualChecks,
  type VisualCheckListItem,
} from "@/lib/workspace-visual-checks-api";
import { inspectionDepth, overviewNextAction, relativeTimeLabel, verdictLabel } from "@/lib/visual-check-view.mjs";
import type { VerdictTone } from "@/lib/visual-check-view.mjs";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";
import {
  nextProjectAction,
  stepMapView,
  explainerKind,
  visualCheckFact,
  visualCheckActiveFact,
  reviewRunFact,
  sourceFacts,
} from "@/lib/project-steps.mjs";
import { loadExtendedProjectData } from "@/lib/workflow-store";
import { StuckHelper } from "@/components/StuckHelper";
import { AppAddressStart } from "@/components/AppAddressStart";
import { fetchProjectRepo, listProjectReviewHistory } from "@/lib/workspace-github-api";
import { fetchProjectRepoSettled, repoConnectedFact } from "@/lib/repo-settle.mjs";
import { listProjectSources } from "@/lib/workspace-sources-api";

// Stage 272 — verdict/status chip tones on the overview inspection card
// (same brand tokens as the visual-checks pages; colors carry meaning only).
const VC_TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  // ★"문제를 찾지 못했어요" — 확인한 것(초록)도, 못 본 것(앰버)도 아닌 자리.
  //  근거를 모아 따라가 봤고 결함이 없었다는 뜻이라 중립적 파랑을 쓴다.
  clear: "bg-sky-50 text-sky-700 border-sky-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};
const VC_STATUS_SLATE_CLASS = "bg-slate-50 text-slate-600 border-slate-200";

export default function ProjectOverviewPage() {
  // One-time "server save failed" notice (marked by fire-and-forget saves).
  const [syncFailed, setSyncFailed] = useState(false);
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    if (consumeProjectSyncFailed(id)) setSyncFailed(true);
  }, [id]);
  const { t, locale } = useI18n();

  // Confirmed project facts, fetched ONCE at the page level so the command
  // center and the inspection card can never disagree about what's connected
  // (journey-audit P2, 2026-07-20: the inspection card pushed a code-branch
  // project toward URL inspection while nothing was connected yet).
  const [hasRepo, setHasRepo] = useState<boolean | null>(null);
  const [hasReviewRun, setHasReviewRun] = useState<boolean | null>(null);
  const [hasDeployUrl, setHasDeployUrl] = useState<boolean | null>(null);
  // AF-1: 제출한 저장소는 project_sources에 저장된다. hasRepo(=GitHub 링크)와는
  // 다른 사실이라 따로 센다 — 안 그러면 방금 준 저장소를 못 본 척하게 된다.
  const [hasRepoSource, setHasRepoSource] = useState<boolean | null>(null);
  // ★2026-09-28 (D3): "확인했음"은 실제 앱 확인 런도 센다. 종전엔 PR 리뷰 이력만 봐서,
  // 실제 앱 확인을 끝낸 사람에게도 개요가 계속 "첫 검수"를 권했다. 목록은 여기서
  // 한 번만 받아 시각 검수 카드와 나눠 쓴다(둘이 다른 답을 할 수 없게).
  const [hasVisualCheck, setHasVisualCheck] = useState<boolean | null>(null);
  // #559 검증 결함 2: a queued/running run is not a result — the command center
  // says "in progress" instead of "your latest review is in".
  const [visualCheckActive, setVisualCheckActive] = useState<boolean | null>(null);
  const [visualChecks, setVisualChecks] = useState<VisualCheckListItem[] | null>(null);
  // Whether the repo / sources requests have FINISHED (with any result). The
  // "how it works" list depends on whether an app exists; it waits for both
  // answers so it never swaps under the reader — and still appears (as before)
  // when a request failed and the fact stays unknown.
  const [repoSettled, setRepoSettled] = useState(false);
  const [sourcesSettled, setSourcesSettled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const uk = getUserKey();
    fetchProjectRepoSettled(fetchProjectRepo, id, uk)
      .then((res) => { if (!cancelled) setHasRepo(repoConnectedFact(res)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRepoSettled(true); });
    listProjectReviewHistory(id, uk, { limit: 1 })
      .then((res) => { if (!cancelled) setHasReviewRun(reviewRunFact(res)); })
      .catch(() => {});
    listProjectSources(id, uk)
      .then((res) => {
        if (cancelled) return;
        const facts = sourceFacts(res);
        setHasDeployUrl(facts.hasDeployUrl);
        setHasRepoSource(facts.hasRepoSource);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSourcesSettled(true); });
    listVisualChecks(id, uk)
      .then((res) => {
        if (cancelled) return;
        setHasVisualCheck(visualCheckFact(res));
        setVisualCheckActive(visualCheckActiveFact(res));
        // A project that only exists in this browser has no server-side runs.
        // Any other failure keeps the card hidden (best-effort, never blocks).
        setVisualChecks(res.ok ? res.checks : res.error === "project_not_found" ? [] : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);
  const entryPath = loadExtendedProjectData(id)?.entryPath ?? null;
  // Locally-created projects live in localStorage (client-only); mock demos are
  // bundled. Read on the client so real projects resolve.
  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <ProjectNotFound />;
  const stats = getProjectStats(project);
  const hasReviewActivity =
    stats.passed + stats.failed + stats.inconclusive + stats.needsDecision > 0;

  return (
    <div className="max-w-3xl">
      {syncFailed && (
        <div className="callout mb-4 flex items-start justify-between gap-3 border-amber-200 bg-amber-50 text-amber-800">
          <span>{t.common.syncFailed}</span>
          <Tooltip content={t.common.dismiss} placement="left">
            <button onClick={() => setSyncFailed(false)} aria-label={t.common.dismiss} className="text-amber-700 hover:text-amber-900">×</button>
          </Tooltip>
        </div>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{project.name}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">{project.description}</p>

      {/* G10: 체험용 예시 배너 — 자유롭게 만지게 하고, 출구(내 아이디어)를 명시 */}
      {loadExtendedProjectData(id)?.isSample && (
        <div className="callout mb-6 flex flex-wrap items-center justify-between gap-3 border-brand-200 bg-brand-50 text-brand-800">
          <span className="text-sm">{t.overview.sampleBanner}</span>
          <Link href="/projects/new" className="btn btn-sm btn-primary flex-shrink-0">
            {t.overview.sampleCta} →
          </Link>
        </div>
      )}

      {/* STEP 4 — command center: ONE computed "지금 할 일" CTA that walks the
          user along the shortest path to the activation moment (first review
          result). The 3-step explainer folds inside it pre-activation, so the
          overview drives instead of describing. */}
      <CommandCenterCard
        projectId={id}
        t={t}
        locale={locale}
        hasItems={project.requirements.length > 0}
        showExplainer={!hasReviewActivity}
        hasRepo={hasRepo}
        hasRepoSource={hasRepoSource}
        hasReviewRun={hasReviewRun}
        hasVisualCheck={hasVisualCheck}
        visualCheckActive={visualCheckActive}
        activeRunId={activeRunId(visualChecks)}
        hasDeployUrl={hasDeployUrl}
        entryPath={entryPath}
        factsSettled={repoSettled && sourcesSettled}
      />

      {/* ★AF-4 (설계 D-3) — "이 앱은 ~로 보입니다. 맞나요?"
          제출 직후 검수가 도는 동안 **그 자리에서** 확인받는다. 별도 화면으로
          보내면 확인 절차가 검수를 가로막는데, 이 설계의 핵심은 가치를 먼저
          보여주고 그 다음에 묻는 순서다. 이미 확정된 프로젝트에는 나타나지 않는다.
          지도(Plan Map) 위에 둔다 — 기준이 정해져야 지도가 의미를 갖는다. */}
      {entryPath === "code" && <IntentConfirmCard projectId={id} />}

      {/* Stage 272 — inspection status at a glance + the single next action */}
      <VisualChecksOverviewCard
        projectId={id}
        t={t}
        locale={locale}
        checks={visualChecks}
        hasRepo={hasRepo}
        hasRepoSource={hasRepoSource}
        hasDeployUrl={hasDeployUrl}
      />

      {/* G2 — 막힘 도우미: 만들기 도중의 유일한 도움 입구 (복귀 이메일이 여기로 안내) */}
      <div className="mb-8">
        <StuckHelper
          projectId={id}
          productName={project.name}
          buildTool={loadExtendedProjectData(id)?.builtWithTools?.[0]}
        />
      </div>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title">{t.overview.resultsSummary}</h2>
          <Link href={`/projects/${id}/checks`} className="text-xs text-brand-700 hover:underline">
            {t.common.viewAll} →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={statusLabel(t, "passed")} value={stats.passed} colorClass="text-green-600" />
          <StatCard label={statusLabel(t, "failed")} value={stats.failed} colorClass="text-red-600" />
          <StatCard label={statusLabel(t, "inconclusive")} value={stats.inconclusive} colorClass="text-amber-600" />
          <StatCard label={statusLabel(t, "needs_decision")} value={stats.needsDecision} colorClass="text-slate-600" />
        </div>
      </section>

      {/* ★한 화면에 8블록이었다 (2026-09-01 실측). "지금 할 일"을 하나 만들어 놓고
          그 옆에 똑같이 눌러도 되는 것을 7개 더 두면, 하나를 고른 효과가 사라진다.
          Bae: *"유저들이 쉽게 따라오고 확인할 수 있도록 심플해야 하고."*

          여기 접는 셋 — 지도 · 제품 설명서 · 확인 항목 — 은 **사이드바에 이미 있고**,
          지도는 지휘 센터의 3단계 설명과 같은 것을 세 번째로 말하고 있었다(같은 것을
          여러 곳에서 말하면 어느 것도 믿기 어려워진다). 없애지는 않는다 — 필요할 때
          펼치면 되고, 사이드바 경로도 그대로다.

          결과 통계는 접지 않는다: 그건 중복이 아니라 **검수의 답** 자체다. */}
      <details className="mb-8 rounded-lg border border-gray-100">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm">
          <span className="font-medium text-gray-700">{t.overview.detailsTitle}</span>
          <span className="ml-2 text-xs text-gray-500">{t.overview.detailsHint}</span>
        </summary>
        <div className="border-t border-gray-100 px-4 pb-4 pt-4">
          {/* Stage 183 — Plan Map ("Where are we?") read-only entry */}
          <Link
            href={`/projects/${id}/map`}
            className="card mb-8 flex items-center justify-between gap-3 p-4 transition-colors hover:bg-gray-50"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{t.planMap.title}</p>
              <p className="mt-0.5 text-xs text-gray-500">{t.planMap.subtitle}</p>
            </div>
            <span className="flex-shrink-0 text-xs text-brand-700">{t.planMap.youAreHere} →</span>
          </Link>

          <section className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">{t.overview.specCompleteness}</h2>
              <Link href={`/projects/${id}/spec`} className="text-xs text-brand-700 hover:underline">
                {t.common.view} →
              </Link>
            </div>
            <div className="card p-5">
              <SpecCompleteness value={project.spec.completeness} />
              {project.spec.openDecisions.length > 0 && (
                <div className="mt-4 space-y-2">
                  {project.spec.openDecisions.map((d, i) => (
                    <div key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="mt-0.5 text-slate-400">•</span>
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">{t.overview.mustHaves}</h2>
              <Link href={`/projects/${id}/items`} className="text-xs text-brand-700 hover:underline">
                {t.common.viewAll} →
              </Link>
            </div>
            <RequirementsInlineList requirements={project.requirements} t={t} />
          </section>

        </div>
      </details>

      {/* Stage 81/82: evolution analytics. These are power-user "engine" gauges
          (experiments, action packs, benchmarks) that read as intimidating
          all-zeros to a non-developer. Tucked behind a collapsed disclosure so
          the default overview stays clean; power users can expand it. */}
      {hasReviewActivity && (
        <details className="mb-8 rounded-lg border border-gray-100">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm">
            <span className="font-medium text-gray-700">{t.evolution.advancedTitle}</span>
            <span className="ml-2 text-xs text-gray-500">{t.evolution.advancedHint}</span>
          </summary>
          <div className="border-t border-gray-100 px-4 pb-4 pt-4">
            <section className="mb-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="section-title">{t.evolution.learningTitle}</h2>
              </div>
              <EvolutionLearningCard projectId={id} t={t} />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="section-title">{t.evolution.timelineTitle}</h2>
              </div>
              <EvolutionTimelineCard projectId={id} t={t} />
            </section>
          </div>
        </details>
      )}
    </div>
  );
}

/** The real-app check still running, if any — the command center's "see how it's going" goes there. */
function activeRunId(checks: VisualCheckListItem[] | null): string | null {
  if (!checks) return null;
  const a = overviewNextAction(checks);
  return a.kind === "inProgress" ? a.runId : null;
}

/**
 * STEP 4 — the overview's command center. Computes the SINGLE next action from
 * confirmed facts (nextProjectAction) and renders one primary CTA. While facts
 * are unknown it renders the explainer only — no CTA beats one that flips
 * after a fetch resolves. No gamification: a quiet card, not a celebration.
 *
 * ★2026-09-28 — the add_url action is not a link to another screen: the address
 * box and the "start checking" button are right here (D4, AppAddressStart), and
 * the default check is the real app, never the PR screen (D1).
 */
function CommandCenterCard({
  projectId,
  t,
  locale,
  hasItems,
  showExplainer,
  hasRepo,
  hasRepoSource,
  hasReviewRun,
  hasVisualCheck,
  visualCheckActive,
  activeRunId,
  hasDeployUrl,
  entryPath,
  factsSettled,
}: {
  projectId: string;
  t: Dictionary;
  locale: Locale;
  hasItems: boolean;
  showExplainer: boolean;
  hasRepo: boolean | null;
  hasRepoSource: boolean | null;
  hasReviewRun: boolean | null;
  // At least one FINISHED real-app check exists — counts as "checked" together with PR reviews.
  hasVisualCheck: boolean | null;
  // A real-app check is queued or running (no result yet).
  visualCheckActive: boolean | null;
  // That running check's id, when known — "see how it's going" opens it directly.
  activeRunId: string | null;
  // A connected deploy/website URL — the builder path's alternative to a repo,
  // so an idea-only project reaches its results without connecting GitHub.
  hasDeployUrl: boolean | null;
  entryPath: "idea" | "code" | "spec" | null;
  // The repo and sources requests have both finished (whatever the result).
  factsSettled: boolean;
}) {
  const facts = { hasItems, hasRepo, hasRepoSource, hasReviewRun, hasVisualCheck, visualCheckActive, hasDeployUrl, entryPath };
  const next = nextProjectAction(facts);

  const copy: Record<string, { label: string; desc: string }> = {
    create_items: { label: t.commandCenter.createItems, desc: t.commandCenter.createItemsDesc },
    connect_code: { label: t.commandCenter.connectCode, desc: t.commandCenter.connectCodeDesc },
    add_url: { label: t.commandCenter.addUrl, desc: t.commandCenter.addUrlDesc },
    get_pack: { label: t.commandCenter.getPack, desc: t.commandCenter.getPackDesc },
    run_review: { label: t.commandCenter.runReview, desc: t.commandCenter.runReviewDesc },
    view_progress: { label: t.commandCenter.viewProgress, desc: t.commandCenter.viewProgressDesc },
    view_results: { label: t.commandCenter.viewResults, desc: t.commandCenter.viewResultsDesc },
  };
  const c = next ? copy[next.action] : null;
  // The running check opens directly (the inspection card below links the same run).
  const nextHref =
    next?.action === "view_progress" && activeRunId
      ? `/projects/${projectId}/visual-checks/${activeRunId}`
      : `/projects/${projectId}/${next?.slug ?? ""}`;

  if (!c && !showExplainer) return null;

  // D6 · #559 검증 결함 3: the progress row, the step-2 label ("앱 확인" when the
  // app exists) and the how-it-works list (D7) all depend on whether an app
  // exists — for a non-code project known only once the repo/address requests
  // finish. One hold rule (stepMapView) keeps all three from swapping under the reader.
  const view = stepMapView(facts, factsSettled);
  const steps = view.steps;
  const stepLabel: Record<string, string | null> = {
    prepare: t.stepsNav.prepare,
    review: view.reviewLabelKey ? t.stepsNav[view.reviewLabelKey] : null,
    results: t.stepsNav.results,
  };
  const explainerReady = view.known;
  const explainer = explainerKind(facts);

  return (
    <div className="card mb-8 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.commandCenter.title}</p>

      {/* Compact "you are here" progress — the body's own axis, next to the CTA
          (the sidebar map is nav; this is the at-a-glance status). */}
      <ol className="mt-3 flex items-center gap-1.5">
        {steps.map((step, i) => {
          const done = step.status === "done";
          const current = step.status === "current";
          return (
            <li key={step.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  done ? "bg-green-100 text-green-700"
                    : current ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-xs ${current ? "font-semibold text-gray-900" : done ? "text-gray-600" : "text-gray-400"}`}>
                {stepLabel[step.key] ?? (
                  // App presence not known yet — hold the label (결함 3).
                  <span aria-hidden className="inline-block h-3 w-14 animate-pulse rounded bg-gray-100 align-middle" />
                )}
              </span>
              {i < steps.length - 1 && <span aria-hidden className="mx-0.5 h-px w-4 bg-gray-200" />}
            </li>
          );
        })}
      </ol>

      {c && next && next.action === "add_url" && (
        <div className="mt-2">
          <p className="text-sm text-gray-700">{c.desc}</p>
          <AppAddressStart projectId={projectId} t={t} locale={locale} />
        </div>
      )}
      {c && next && next.action !== "add_url" && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">{c.desc}</p>
          <Link href={nextHref} className="btn btn-md btn-primary">
            {c.label} →
          </Link>
        </div>
      )}
      {/* Builder building-state: the app may already exist elsewhere — keep the
          "connect your deploy URL" door open at all times (no GitHub required). */}
      {next?.action === "get_pack" && (
        <p className="mt-2 text-xs text-gray-500">
          {t.commandCenter.alreadyBuilt}{" "}
          <Link href={`/projects/${projectId}/sources`} className="font-medium text-brand-700 hover:underline">
            {t.commandCenter.connectUrl} →
          </Link>
        </p>
      )}
      {/* Flow-audit B-1 (2026-07-17): the explainer must match the situation —
          before an app exists the path is builder pack → build with a dev AI →
          paste the live URL. ★2026-09-28 (D7): once an app exists (a repo or an
          address is known — also for a restored project that defaulted to the
          idea branch) the builder-pack list contradicted "your code is
          connected", so the app list shows instead. */}
      {showExplainer && explainerReady && (
        <ol className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 text-xs text-gray-500">
          {explainer === "idea" ? (
            <>
              <li>1. {t.overview.gsIdeaStep1}</li>
              <li>2. {t.overview.gsIdeaStep2}</li>
              <li>3. {t.overview.gsIdeaStep3}</li>
            </>
          ) : (
            <>
              <li>1. {t.overview.gsStep1}</li>
              <li>2. {t.overview.gsStep2}</li>
              <li>3. {t.overview.gsStep3}</li>
            </>
          )}
        </ol>
      )}
    </div>
  );
}

// Stage 272 — the "시각 검수" overview card: latest run's verdict chip +
// relative date + a link to that run. Best-effort: the card stays hidden while
// loading or when the run list cannot be fetched.
//
// ★2026-09-28 (D5): the card no longer has its own "run your first check"
// door when there are no runs. That button ("첫 검수 실행하기") sat next to the
// command center's primary with the SAME label and a DIFFERENT destination
// (/visual-checks vs /github) — one screen, two answers to "what now". The
// command center is the single "what to do now"; this card only reports runs
// that exist.
function VisualChecksOverviewCard({
  projectId,
  t,
  locale,
  checks,
  hasRepo,
  hasRepoSource,
  hasDeployUrl,
}: {
  projectId: string;
  t: Dictionary;
  locale: Locale;
  // Fetched once at the page level (null = loading or failed → hidden).
  checks: VisualCheckListItem[] | null;
  hasRepo: boolean | null;
  hasRepoSource: boolean | null;
  hasDeployUrl: boolean | null;
}) {
  if (checks === null) return null;

  const action = overviewNextAction(checks);
  const run =
    action.kind === "runFirst" ? null : (checks.find((c) => c.id === action.runId) ?? null);
  if (run === null) return null;

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title">{t.visualChecks.title}</h2>
        <Link
          href={`/projects/${projectId}/visual-checks`}
          className="text-xs text-brand-700 hover:underline"
        >
          {t.common.viewAll} →
        </Link>
      </div>
      <div className="card p-5">
        {/* ★AF-5 (설계 D-4) — 이 결과가 **어느 깊이**이고 **무엇을 못 봤는지**.
            장식이 아니라 정직성 요건이다: 검수 러너에는 로그인 기능이 없어
            로그인 뒤 화면은 보지 못한다. 표기가 없으면 사용자는 이 결과를
            전체 검수로 오해한다. */}
        {(() => {
          const d = inspectionDepth({ hasRepo, hasRepoSource, hasDeployUrl });
          const dc = t.visualChecks.overview.depth;
          return (
            <div className="mb-3 rounded-md border border-gray-100 bg-gray-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-gray-600">
                {d.level === 2 ? dc.label2 : dc.label1}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                {d.level === 2 ? dc.note2 : dc.note1}
              </p>
              {d.nextStep && (
                <Link
                  href={`/projects/${projectId}/sources`}
                  className="mt-1 inline-block text-xs text-brand-700 hover:underline"
                >
                  {d.nextStep === "add_url" ? dc.addUrl : dc.addRepo} →
                </Link>
              )}
            </div>
          );
        })()}
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {t.visualChecks.overview.latestLabel}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <OverviewRunChip run={run} t={t} />
            <span className="truncate text-sm text-gray-700">{run.targetUrl}</span>
            <span className="flex-shrink-0 text-xs text-gray-500">
              {relativeTimeLabel(run.createdAt, locale)}
            </span>
          </div>
          <Link
            href={`/projects/${projectId}/visual-checks/${run.id}`}
            className="btn btn-secondary btn-sm flex-shrink-0"
          >
            {action.kind === "inProgress"
              ? t.visualChecks.overview.inProgress
              : t.visualChecks.overview.viewReport}
          </Link>
        </div>
      </div>
    </section>
  );
}

// Stage 272 — chip for the latest run: queued/running/failed statuses take
// priority; a done (or legacy) run shows its verdict chip.
function OverviewRunChip({ run, t }: { run: VisualCheckListItem; t: Dictionary }) {
  let chip: { label: string; cls: string };
  if (run.status === "queued") {
    chip = { label: t.visualChecks.statusQueued, cls: VC_STATUS_SLATE_CLASS };
  } else if (run.status === "running") {
    chip = { label: t.visualChecks.statusRunning, cls: VC_STATUS_SLATE_CLASS };
  } else if (run.status === "failed") {
    chip = { label: t.visualChecks.statusFailed, cls: VC_TONE_CLASS.failed };
  } else {
    const verdict = verdictLabel(run.works, run.decision, t);
    chip = { label: verdict.label, cls: VC_TONE_CLASS[verdict.tone] };
  }
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}
    >
      {chip.label}
    </span>
  );
}

function EvolutionLearningCard({ projectId, t }: { projectId: string; t: Dictionary }) {
  const [learning, setLearning] = useState<ProjectEvolutionLearningSignals | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [userKey, setUserKey] = useState<string>("");
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    setPhase("loading");
    getProjectEvolutionLearning(projectId, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLearning(res.learning);
        setPhase("ready");
      } else {
        setLearning(null);
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, userKey, reloadNonce]);

  if (phase === "loading") {
    return <p className="card p-5 text-xs text-gray-500">{t.outcome.loading}</p>;
  }
  if (phase === "error") {
    return (
      <div className="card flex items-center justify-between gap-3 p-5">
        <p className="text-xs text-red-600">{t.errors.loadFailed}</p>
        <button type="button" onClick={() => setReloadNonce((n) => n + 1)} className="btn btn-sm btn-secondary flex-shrink-0">
          {t.common.retry}
        </button>
      </div>
    );
  }
  if (!learning) {
    return <p className="card p-5 text-xs text-gray-500">{t.evolution.learningEmpty}</p>;
  }

  return (
    <div className="card p-5">
      <p className="text-xs text-gray-500">{t.evolution.learningDesc}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-500">{t.evolution.learningExperiments}</dt>
          <dd className="font-semibold text-gray-800">{learning.experimentCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-500">{t.evolution.learningActionPacks}</dt>
          <dd className="font-semibold text-gray-800">{learning.actionPackCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-500">{t.evolution.learningFollowedPacks}</dt>
          <dd className="font-semibold text-gray-800">{learning.followedPackCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
          <dt className="text-gray-500">{t.evolution.learningComparablePacks}</dt>
          <dd className="font-semibold text-gray-800">{learning.comparablePackCount}</dd>
        </div>
      </dl>

      {learningHasNoData(learning) ? (
        <p className="mt-3 text-xs text-gray-500">{t.evolution.learningEmpty}</p>
      ) : (
        <>
          {/* Verdict counts */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-500">{t.evolution.summaryImprovedPacks}</dt>
              <dd className="font-semibold text-emerald-700">{learning.verdictCounts.improved}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-500">{t.evolution.summaryRegressedPacks}</dt>
              <dd className="font-semibold text-red-700">{learning.verdictCounts.regressed}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-500">{t.evolution.summaryUnchangedPacks}</dt>
              <dd className="font-semibold text-gray-700">{learning.verdictCounts.unchanged}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
              <dt className="text-gray-500">{t.evolution.summaryInconclusivePacks}</dt>
              <dd className="font-semibold text-amber-700">{learning.verdictCounts.inconclusive}</dd>
            </div>
          </div>

          {/* Average change */}
          <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{t.evolution.learningAverageChange}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-4">
              <div className="flex justify-between"><dt className="text-gray-500">{t.evolution.impactPassRate}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaPercent(learning.averageDelta.passRateDelta)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t.evolution.impactCritical}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(learning.averageDelta.criticalIssueDelta)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t.evolution.impactNotVerified}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(learning.averageDelta.notVerifiedDelta)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t.evolution.impactBlockers}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(learning.averageDelta.blockerDelta)}</dd></div>
            </dl>
          </div>

          {/* Recommended action effectiveness table */}
          {learning.recommendedActionEffectiveness.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{t.evolution.learningEffectiveness}</p>
              <ul className="mt-1 space-y-1 text-xs">
                {learning.recommendedActionEffectiveness.map((r) => (
                  <li
                    key={r.recommendedAction}
                    className="grid grid-cols-3 items-center gap-2 rounded-md border border-gray-100 bg-white px-2 py-1"
                  >
                    <span className="text-[11px] text-gray-600">{enumActionLabel(t, r.recommendedAction)}</span>
                    <span className="text-[11px] text-gray-500">
                      {r.comparable}/{r.total} · <span className="text-emerald-700">↑{r.improved}</span> · <span className="text-red-700">↓{r.regressed}</span> · <span className="text-amber-700">?{r.inconclusive}</span>
                    </span>
                    <span className="text-right text-[11px] text-gray-500">
                      <span className="text-emerald-700">{t.evolution.learningImprovementRate} {formatRatePercent(r.improvementRate)}</span>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-red-700">{t.evolution.learningRegressionRate} {formatRatePercent(r.regressionRate)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Top signals — always shown so the empty state has a place to live */}
      <div className="mt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{t.evolution.learningTopSignals}</p>
        <ul className="mt-1 space-y-1 text-xs text-gray-700">
          {learning.topSignals.map((sig, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-100 bg-white px-2 py-1">
              <TopSignalText signal={sig} t={t} />
            </li>
          ))}
        </ul>
      </div>

      {learning.limitations.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{t.evolution.summaryLimitationsLabel}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {learning.limitations.map((l) => (
              <li
                key={l}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500"
              >
                {enumLimitationLabel(t, l)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">{t.evolution.learningDisclaimer}</p>
    </div>
  );
}

function TopSignalText({ signal, t }: { signal: ProjectLearningSignal; t: Dictionary }) {
  if (signal.type === "not_enough_data") {
    return <span className="text-gray-500">{t.evolution.signalNotEnoughData}</span>;
  }
  const labelKey = topSignalLabelKey(signal);
  const label = t.evolution[labelKey as keyof typeof t.evolution];
  if (signal.type === "action_often_improves") {
    return (
      <>
        <span className="font-semibold text-gray-700">{t.evolution.learningEarlySignal}</span>
        <span className="text-[11px] font-medium text-gray-700">{enumActionLabel(t, signal.recommendedAction)}</span>
        <span className="text-emerald-700">{label}</span>
        <span className="text-gray-500">
          ({signal.improved}/{signal.totalComparable})
        </span>
      </>
    );
  }
  // action_often_regresses
  return (
    <>
      <span className="font-semibold text-gray-700">{t.evolution.learningEarlySignal}</span>
      <span className="text-[11px] font-medium text-gray-700">{enumActionLabel(t, signal.recommendedAction)}</span>
      <span className="text-red-700">{label}</span>
      <span className="text-gray-500">
        ({signal.regressed}/{signal.totalComparable})
      </span>
    </>
  );
}

function EvolutionTimelineCard({ projectId, t }: { projectId: string; t: Dictionary }) {
  const { locale } = useI18n();
  const [timeline, setTimeline] = useState<ProjectEvolutionTimeline | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [userKey, setUserKey] = useState<string>("");
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    setPhase("loading");
    getProjectEvolutionTimeline(projectId, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setTimeline(res.timeline);
        setPhase("ready");
      } else {
        setTimeline(null);
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, userKey, reloadNonce]);

  if (phase === "loading") {
    return <p className="card p-5 text-xs text-gray-500">{t.outcome.loading}</p>;
  }
  if (phase === "error") {
    return (
      <div className="card flex items-center justify-between gap-3 p-5">
        <p className="text-xs text-red-600">{t.errors.loadFailed}</p>
        <button type="button" onClick={() => setReloadNonce((n) => n + 1)} className="btn btn-sm btn-secondary flex-shrink-0">
          {t.common.retry}
        </button>
      </div>
    );
  }
  if (!timeline) {
    return <p className="card p-5 text-xs text-gray-500">{t.evolution.timelineEmpty}</p>;
  }

  return (
    <div className="card p-5">
      <p className="text-xs text-gray-500">{t.evolution.timelineDesc}</p>

      {timelineHasNoEvents(timeline) ? (
        <p className="mt-3 text-xs text-gray-500">{t.evolution.timelineEmpty}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {timeline.events.map((ev) => (
            <TimelineEventRow key={ev.id} event={ev} t={t} />
          ))}
        </ol>
      )}

      {timeline.limitations.length > 0 && (
        <div className="mt-3">
          <ul className="flex flex-wrap gap-1.5">
            {timeline.limitations.map((l) => (
              <li
                key={l}
                className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              >
                {t.evolution[timelineLimitationLabelKey(l) as keyof typeof t.evolution] ?? l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TimelineEventRow({
  event,
  t,
}: {
  event: ProjectEvolutionTimelineEvent;
  t: Dictionary;
}) {
  const { locale } = useI18n();
  const labelKey = timelineEventLabelKey(event.type);
  const label = t.evolution[labelKey as keyof typeof t.evolution];
  const chipClass = badgeClassForEventType(event.type);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${chipClass}`}>
            {label}
          </span>
          {event.status && (
            <span className="text-[10px] text-gray-500">{enumStatusLabel(t, event.status)}</span>
          )}
          {event.recommendedAction && (
            <span className="text-[10px] text-gray-500">{enumActionLabel(t, event.recommendedAction)}</span>
          )}
        </div>
        {event.summary && (
          <p className="mt-1 truncate text-xs text-gray-700">{event.summary}</p>
        )}
        <p className="mt-0.5 text-[10px] text-gray-500">
          {new Date(event.occurredAt).toLocaleString(locale === "ko" ? "ko-KR" : "en-US")}
        </p>
      </div>
      {event.href && (
        <Link
          href={event.href}
          className="rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t.evolution.timelineOpen}
        </Link>
      )}
    </li>
  );
}

function badgeClassForEventType(type: string): string {
  switch (type) {
    case "impact_improved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "impact_regressed":
      return "border-red-200 bg-red-50 text-red-700";
    case "impact_unchanged":
      return "border-gray-200 bg-gray-50 text-gray-700";
    case "impact_inconclusive":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "decision_recorded":
      return "border-brand-200 bg-brand-50 text-brand-700";
    case "benchmark_created":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "experiment_created":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "action_pack_saved":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "followup_recorded":
      return "border-teal-200 bg-teal-50 text-teal-700";
    default:
      return "border-gray-200 bg-white text-gray-500";
  }
}

/**
 * UIUX 지시서 #3 (2026-07-21) — "+N개 더"를 별도 페이지가 아니라 그 자리
 * 인라인 확장/접힘으로. 노출 기준은 개수가 아니라 중요도: 필수(must)는 전부
 * 항상 노출, 부가(should/could)만 접힘. 전부 must면 전부 보인다(지시 그대로).
 */
function RequirementsInlineList({
  requirements,
  t,
}: {
  requirements: Array<{ id: string; title: string; status: string; priority: string }>;
  t: Dictionary;
}) {
  const [showOptional, setShowOptional] = useState(false);
  const mustItems = requirements.filter((r) => r.priority === "must");
  const optionalItems = requirements.filter((r) => r.priority !== "must");

  const row = (req: { id: string; title: string; status: string }) => (
    <div key={req.id} className="flex items-center gap-3 px-5 py-3.5">
      <StatusDot status={req.status} />
      <span className="flex-1 text-sm text-gray-700">{req.title}</span>
    </div>
  );

  return (
    <div className="card divide-y divide-gray-100">
      {mustItems.map(row)}
      {showOptional && optionalItems.map(row)}
      {optionalItems.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="w-full px-5 py-3 text-center font-mono text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
        >
          {showOptional ? t.interaction.collapseAll : `+ ${optionalItems.length} ${t.common.more}`}
        </button>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    passed: "bg-green-500",
    failed: "bg-red-500",
    inconclusive: "bg-amber-400",
    needs_decision: "bg-slate-500",
    not_started: "bg-gray-300",
    building: "bg-blue-400",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status] ?? "bg-gray-300"}`} />
  );
}

"use client";

// 내 앱 — 문 (a) "만들기"의 진행 화면과 결과 카드 (SI 티어 Train B — B-8 · D-4 · D-6 · D-7 · D-17).
//
//  - 진행: 서버 상태 머신을 쉬운 단계 이름으로(준비 → 뼈대 → 기능 → 빌드 확인 → 작동 확인 → 올리기 → 끝),
//    지금 단계만 강조. 퍼센트 없음(D-4). 5초 폴링(visual-check 관례), 탭이 숨으면 멈추고 돌아오면 바로 다시.
//  - 복원: 새로고침·재방문 시 서버 목록의 가장 최근 잡을 그대로 이어서 보여 준다(브라우저 저장 없음).
//  - 실패: 종류별로 정직하게(아직 준비 중인 단계 · 한도 · 끊김 · 빌드 확인 · 작동 확인 …) + "비용은 받지
//    않았어요(베타)" + 다시 시도 · 지시서 받아가기. 모르는 코드는 일반 문구.
//  - 끝: 내 앱 카드 — 주소 · (있으면) 마지막 확인 결과 · 이 앱 신고하기 · (있으면) 받아가기 ·
//    "Simsa 주소에서 운영 중 · 프로덕션 아님"(D-6).
//  - 옛 서버(빌드 라우트 없음): 만들기 버튼 대신 정직한 안내 + 지시서 받아가기.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import { ProjectNotFound } from "@/components/ProjectNotFound";
import { MakeAppPanel, StartNoticeCallout } from "@/components/MakeAppPanel";
import { useI18n } from "@/i18n/I18nProvider";
import { useDeveloperMode } from "@/lib/use-developer-mode";
import { usePageVisible } from "@/lib/use-page-visible";
import { useStartBuild, type StartedBuild } from "@/lib/use-start-build";
import { getDevSpecApi } from "@/lib/dev-spec-api";
import { devSpecView } from "@/lib/dev-spec-view.mjs";
import { listVisualChecks, type VisualCheckListItem } from "@/lib/workspace-visual-checks-api";
import { getBuildJob, listBuildJobs, type BuildApiFailure, type BuildJobListOk } from "@/lib/build-job-api";
import {
  appCardView,
  budgetLine,
  buildAvailability,
  buildFailureKind,
  buildStageRow,
  failureActions,
  isBuildActive,
  latestBuildJob,
  nextBuildPollDelayMs,
  stageForStatus,
  type BuildJobEventView,
  type BuildJobView,
  type BuildStageState,
} from "@/lib/build-job-view.mjs";

const GLYPH: Record<BuildStageState, string> = { done: "✓", current: "●", stopped: "■", todo: "○" };
const ROW_CLASS: Record<BuildStageState, string> = {
  done: "text-gray-500",
  current: "font-medium text-gray-900",
  stopped: "font-medium text-red-700",
  todo: "text-gray-400",
};
const GLYPH_CLASS: Record<BuildStageState, string> = {
  done: "border-green-200 bg-green-50 text-green-700",
  current: "border-brand-300 bg-brand-600 text-white",
  stopped: "border-red-200 bg-red-50 text-red-700",
  todo: "border-gray-200 bg-white text-gray-400",
};

export default function BuildPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const mk = t.makeApp;
  const project = getLocalProject(id) ?? getProject(id);
  const [developerMode] = useDeveloperMode();
  const visible = usePageVisible();

  const [list, setList] = useState<BuildJobListOk | BuildApiFailure | null>(null);
  const [job, setJob] = useState<BuildJobView | null>(null);
  const [events, setEvents] = useState<BuildJobEventView[]>([]);
  const [devSpec, setDevSpec] = useState<unknown>(null);
  const [devSpecLoaded, setDevSpecLoaded] = useState(false);
  const [checks, setChecks] = useState<VisualCheckListItem[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useStartBuild(id, locale === "en" ? "en" : "ko");

  // ── 복원: 서버 목록의 가장 최근 잡(새로고침·재방문) ─────────────────────────
  useEffect(() => {
    let alive = true;
    setList(null);
    (async () => {
      const uk = getUserKey();
      const res = await listBuildJobs(id, uk);
      if (!alive) return;
      setList(res);
      if (!res.ok) return;
      const latest = latestBuildJob(res.jobs);
      setJob(latest);
      setEvents([]);
      if (!latest) return;
      // 멈춘 자리(stoppedStage)는 타임라인이 알려 준다 — 상세를 한 번 읽는다.
      const detail = await getBuildJob(id, latest.id, uk);
      if (alive && detail.ok) {
        setJob(detail.job);
        setEvents(detail.events);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, reloadKey]);

  // 시작 전 안내에 쓰는 지시서 4줄 요약.
  useEffect(() => {
    let alive = true;
    getDevSpecApi(id, getUserKey()).then((r) => {
      if (!alive) return;
      if (r.ok) setDevSpec(r.devSpec);
      setDevSpecLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // 끝난 앱의 마지막 확인 결과(있으면) — 카드의 링크 하나.
  const jobDone = job?.status === "done";
  useEffect(() => {
    if (!jobDone) return;
    let alive = true;
    listVisualChecks(id, getUserKey()).then((r) => {
      if (alive && r.ok) setChecks(r.checks);
    });
    return () => {
      alive = false;
    };
  }, [id, jobDone]);

  // ── 폴링: 진행 중일 때만, 탭이 보일 때만 ──────────────────────────────────────
  const jobId = job?.id ?? null;
  const active = job ? isBuildActive(job.status) : false;
  const statusRef = useRef<string | null>(null);
  useEffect(() => {
    statusRef.current = job?.status ?? null;
  }, [job?.status]);
  const pollStartedAt = useRef(Date.now());
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasHidden.current = true;
      return;
    }
    if (!jobId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delayFor = (status: string | null) =>
      nextBuildPollDelayMs(status, {
        hidden: document.visibilityState === "hidden",
        elapsedMs: Date.now() - pollStartedAt.current,
      });
    const tick = async () => {
      const r = await getBuildJob(id, jobId, getUserKey());
      if (cancelled) return;
      if (r.ok) {
        setJob(r.job);
        setEvents(r.events);
      }
      const next = delayFor(r.ok ? r.job.status : statusRef.current);
      if (next !== null) timer = setTimeout(tick, next);
    };
    // 탭이 돌아온 직후에는 기다리지 않고 바로 한 번 — 오래 떠 있던 화면이 5초 동안 옛 단계를 보이지 않게.
    const first = wasHidden.current ? 0 : delayFor(statusRef.current);
    wasHidden.current = false;
    if (first !== null) timer = setTimeout(tick, first);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, jobId, active, visible]);

  const handleStarted = useCallback(
    (started: StartedBuild) => {
      pollStartedAt.current = Date.now();
      setEvents([]);
      // 시작 응답의 잡은 요약본이다(멈춘 이유·타임라인 없음) — 먼저 그리고 곧바로 상세로 바꾼다.
      // 이미 만드는 중이던 잡(409)은 id만 있으니 상세를 읽어 이어서 보여 준다.
      if (started.job) setJob(started.job);
      void getBuildJob(id, started.jobId, getUserKey()).then((r) => {
        if (r.ok) {
          setJob(r.job);
          setEvents(r.events);
        } else {
          setReloadKey((k) => k + 1);
        }
      });
    },
    [id],
  );

  if (!project) return <ProjectNotFound />;

  const base = `/projects/${encodeURIComponent(id)}`;
  const availability = buildAvailability(list);
  const view = devSpecView(devSpec);
  const card = appCardView(job, checks);
  const row = job ? buildStageRow(job, events) : null;
  const failed = job?.status === "failed";
  const failKind = failed ? buildFailureKind(job) : null;
  const actions = failKind ? failureActions(failKind) : null;
  const currentStage = job && active ? stageForStatus(job.status) : null;
  const budget = budgetLine(job);

  async function handleRetry() {
    const started = await retry.start();
    if (started) handleStarted(started);
  }

  const retryButton = (primary: boolean) => (
    <button
      key="retry"
      type="button"
      onClick={handleRetry}
      disabled={retry.starting}
      className={`btn btn-md ${primary ? "btn-primary" : "btn-secondary"} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {retry.starting ? mk.starting : mk.retry}
    </button>
  );
  const takeSpecLink = (primary: boolean) => (
    <Link key="takeSpec" href={`${base}/export`} className={`btn btn-md ${primary ? "btn-primary" : "btn-secondary"}`}>
      {mk.takeSpec}
    </Link>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t.nav.myApp}</h1>
        <p className="page-subtitle">{mk.pageSubtitle}</p>
      </div>

      {(availability === "loading" || (availability === "available" && !job && !devSpecLoaded)) && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {mk.loading}
        </div>
      )}

      {/* 옛 서버 — 누르면 막히는 버튼 대신 정직한 안내 */}
      {availability === "missing" && (
        <section className="card p-5">
          <p className="text-sm leading-relaxed text-gray-700">{mk.startErrors.unavailable}</p>
          <div className="mt-4">{takeSpecLink(true)}</div>
        </section>
      )}

      {availability === "unknown" && (
        <div className="callout callout-error flex items-center justify-between gap-3">
          <span>{mk.loadError}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn btn-sm btn-secondary">
            {t.common.retry}
          </button>
        </div>
      )}

      {/* 아직 만든 적 없음 — 만들기(지시서가 있으면) 또는 지시서 먼저 */}
      {availability === "available" && !job && devSpecLoaded &&
        (view ? (
          <MakeAppPanel projectId={id} view={view} latestJob={null} developerMode={developerMode} onStarted={handleStarted} />
        ) : (
          <section className="card p-5">
            <p className="text-sm leading-relaxed text-gray-700">{mk.needDevSpec}</p>
            <Link href={`${base}/dev-spec`} className="btn btn-md btn-primary mt-4">
              {mk.needDevSpecLink}
            </Link>
          </section>
        ))}

      {/* 끝 — 내 앱 카드 (D-6) */}
      {card && (
        <section className="card p-5">
          <h2 className="section-title">{mk.appTitle}</h2>
          <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">{mk.address}</dt>
            <dd>
              <a href={card.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-brand-700 underline">
                {card.url.replace(/\/$/, "")}
              </a>
            </dd>
          </dl>
          <p className="mt-1.5 text-xs text-gray-500">{mk.hostedNote}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a href={card.url} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-primary">
              {mk.openApp}
            </a>
            {card.checkRunId && (
              <Link href={`${base}/visual-checks/${encodeURIComponent(card.checkRunId)}`} className="btn btn-md btn-secondary">
                {mk.lastCheck}
              </Link>
            )}
            {card.downloadUrl && (
              <a href={card.downloadUrl} className="btn btn-md btn-secondary">
                {mk.download}
              </a>
            )}
          </div>
          <p className="mt-4 text-xs">
            <a href={card.reportUrl} target="_blank" rel="noopener noreferrer" className="text-gray-500 underline hover:text-gray-700">
              {mk.report}
            </a>
          </p>
        </section>
      )}

      {/* 진행 — 단계로(퍼센트 없음, D-4) */}
      {job && row && (
        <section className="card p-5" aria-live="polite">
          <h2 className="section-title">{failed ? mk.failedTitle : jobDone ? mk.stageHints.done : mk.progressTitle}</h2>
          <ol className="mt-4 space-y-2">
            {row.map((s) => (
              <li key={s.key} className={`flex items-center gap-2.5 text-sm ${ROW_CLASS[s.state]}`} aria-current={s.state === "current" ? "step" : undefined}>
                <span aria-hidden className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-md border text-[10px] font-bold ${GLYPH_CLASS[s.state]}`}>
                  {GLYPH[s.state]}
                </span>
                <span>{mk.stages[s.key]}</span>
                {s.state === "current" && (
                  <span className="rounded-full border border-brand-200 bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700">{mk.nowTag}</span>
                )}
                {s.state === "stopped" && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium text-red-700">{mk.stoppedTag}</span>
                )}
              </li>
            ))}
          </ol>
          {currentStage && <p className="mt-4 text-sm text-gray-700">{mk.stageHints[currentStage]}</p>}
          {currentStage === "features" && job.wbsTotal > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {mk.featuresCount.replace("{done}", String(job.wbsDone)).replace("{total}", String(job.wbsTotal))}
            </p>
          )}
          {budget && (
            <p className="mt-3 text-xs text-gray-500">{mk.budget.replace("{budget}", budget.budget).replace("{spent}", budget.spent)}</p>
          )}
          {active && <p className="mt-3 text-xs text-gray-500">{mk.leaveOk}</p>}
        </section>
      )}

      {/* 멈춤 — 종류별 정직한 이유 + 비용 없음 + 다시 시도 · 지시서 받아가기 */}
      {failed && failKind && actions && (
        <section className="card p-5">
          <p className="text-sm leading-relaxed text-gray-800">{mk.failures[failKind]}</p>
          <p className="mt-1.5 text-xs text-gray-500">{mk.noCharge}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {actions.primary === "retry" ? [retryButton(true), takeSpecLink(false)] : [takeSpecLink(true), retryButton(false)]}
          </div>
          {retry.notice && <StartNoticeCallout notice={retry.notice} projectId={id} />}
        </section>
      )}
    </div>
  );
}

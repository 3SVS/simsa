"use client";

/**
 * MakeAppPanel — 문 (a) "만들기" (SI 티어 Train B — B-8 · D-6 · D-7 · D-17).
 *
 * 지시서까지 만든 비개발자가 **계정 추가 없이** 한 번 눌러 앱을 만든다(S 경로). 누르기 전에 한 번에
 * 읽히는 안내: 무엇을 만드는지(지시서 4줄 요약 재사용) · 예상 소요 [PILOT] · "비용은 받지 않아요(베타)" ·
 * "만든 앱은 Simsa 주소에 올라가요". 예산 숫자는 여기서 말하지 않는다 — 서버가 잡을 만들 때 정하고
 * 진행 화면이 그 값을 보여 준다(D-7: 서버가 준 값만).
 *
 * A 경로(내 저장소·내 배포) 문장은 개발자 모드에서만(makeIntroKeys). 모달·오버레이 없음 — 인라인.
 * 최근 잡이 진행 중이거나 끝났으면 다시 만들라고 하지 않고 "진행 상황 보기"·"내 앱 보기"로 보낸다.
 */
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import type { DevSpecViewModel } from "@/lib/dev-spec-view.mjs";
import {
  BUILD_EXPECTED_MAX_MINUTES,
  makeIntroKeys,
  makePanelState,
  startErrorTone,
  type BuildJobView,
} from "@/lib/build-job-view.mjs";
import { errorNoticeText } from "@/lib/daily-limit.mjs";
import { useStartBuild, type StartNotice, type StartedBuild } from "@/lib/use-start-build";

type Props = {
  projectId: string;
  view: DevSpecViewModel;
  latestJob: BuildJobView | null;
  developerMode: boolean;
  onStarted: (started: StartedBuild) => void;
};

export function MakeAppPanel({ projectId, view, latestJob, developerMode, onStarted }: Props) {
  const { t, locale } = useI18n();
  const mk = t.makeApp;
  const { start, starting, notice } = useStartBuild(projectId, locale === "en" ? "en" : "ko");
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const state = makePanelState(latestJob);

  if (state === "active" || state === "done") {
    return (
      <section className="card mt-6 p-6">
        <h2 className="section-title">{mk.panelTitle}</h2>
        <p className="mt-2 text-sm text-gray-700">{state === "active" ? mk.activeLine : mk.doneLine}</p>
        <Link href={`${base}/my-app`} className="btn btn-md btn-primary mt-4">
          {state === "active" ? mk.viewProgress : mk.viewApp}
        </Link>
      </section>
    );
  }

  async function handleMake() {
    const started = await start();
    if (started) onStarted(started);
  }

  const keys = makeIntroKeys({ developerMode, hasExcluded: view.excluded.length > 0 });
  const line = (k: (typeof keys)[number]): string => {
    switch (k) {
      case "what":
        return mk.what
          .replace("{what}", view.what)
          .replace("{screens}", String(view.screenCount))
          .replace("{entities}", String(view.entityCount));
      case "excluded":
        return mk.excluded.replace("{excluded}", view.excluded.join(" · "));
      case "eta":
        return mk.eta.replace("{minutes}", String(BUILD_EXPECTED_MAX_MINUTES));
      case "free":
        return mk.free;
      case "hosted":
        return mk.hosted;
      case "devPath":
        return mk.devPath;
    }
  };

  return (
    <section className="card mt-6 p-6">
      <h2 className="section-title">{mk.panelTitle}</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
        {keys.map((k) => (
          <li key={k}>
            {line(k)}
            {k === "devPath" && (
              <>
                {" "}
                <Link href={`${base}/export`} className="text-brand-700 underline">{mk.devPathLink}</Link>
              </>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleMake}
        disabled={starting}
        className="btn btn-md btn-primary mt-5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {starting ? mk.starting : mk.make}
      </button>
      {notice && <StartNoticeCallout notice={notice} projectId={projectId} />}
    </section>
  );
}

/** 시작 요청이 막혔을 때 한 줄 — 상한은 "언제 다시", 옛 서버는 지시서 받아가기로. */
export function StartNoticeCallout({ notice, projectId }: { notice: StartNotice; projectId: string }) {
  const { t } = useI18n();
  const mk = t.makeApp;
  const tone = startErrorTone(notice.errorKey);
  return (
    <div className={`callout mt-3 ${tone === "info" ? "callout-info" : "callout-error"}`}>
      {errorNoticeText(mk.startErrors, notice.errorKey, notice.resetAt, t.visualChecks.resetWhen, { receivedAt: notice.receivedAt })}
      {notice.errorKey === "unavailable" && (
        <>
          {" "}
          <Link href={`/projects/${encodeURIComponent(projectId)}/export`} className="underline">{mk.takeSpec}</Link>
        </>
      )}
    </div>
  );
}

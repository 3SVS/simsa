"use client";
// B-8 — "만들기" 한 번: POST …/build → 잡 id, 또는 정직한 알림.
//
// 지시서 화면의 [만들기]와 멈춘 만들기의 [다시 시도]가 같은 경로를 탄다(한 규칙 — #498 교훈).
// 이미 만드는 중(409 build_already_active)은 오류가 아니다: 그 잡을 이어서 보여 준다.
// 알림은 응답 본문 전체로 매핑한다(startErrorNotice) — 429의 resetAt이 화면까지 가야 "언제 다시"를
// 말할 수 있고, 받은 시각(receivedAt)이 있어야 "지금 다시 할 수 있어요"를 리셋 전에 받은 알림에만 쓴다.
import { useCallback, useRef, useState } from "react";
import { startBuild } from "./build-job-api";
import { startErrorNotice, type BuildJobView, type StartErrorKey } from "./build-job-view.mjs";
import { getUserKey } from "./workflow-store";

export type StartNotice = { errorKey: StartErrorKey; resetAt: string | null; receivedAt: number };
export type StartedBuild = { jobId: string; job: BuildJobView | null };

export function useStartBuild(projectId: string, locale: "ko" | "en") {
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<StartNotice | null>(null);
  // 두 번 누름 방지 — 상태 갱신이 끝나기 전에 온 두 번째 클릭도 막는다.
  const inFlight = useRef(false);

  const start = useCallback(async (): Promise<StartedBuild | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setStarting(true);
    setNotice(null);
    try {
      const res = await startBuild(projectId, getUserKey(), locale);
      if (res.ok) return { jobId: res.job.id, job: res.job };
      const n = startErrorNotice(res.status, res.body);
      if (n.errorKey === "alreadyActive" && n.activeJobId) return { jobId: n.activeJobId, job: null };
      setNotice({ errorKey: n.errorKey, resetAt: n.resetAt, receivedAt: Date.now() });
      return null;
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  }, [projectId, locale]);

  return { start, starting, notice };
}

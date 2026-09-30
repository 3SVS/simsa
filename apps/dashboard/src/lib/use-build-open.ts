"use client";
// B-8 (PR #578 검증 결함 2) — "서버가 만들기를 열었는가"를 화면 여럿(사이드바·개요·지시서·내 앱·다음 바)이
// **한 번 물은 답**으로 나눠 쓴다. 따로 물으면 요청이 늘고, 화면마다 답이 갈라질 수 있다(#498: 두 독자는 표류한다).
//
//   null  — 아직 묻는 중
//   true  — 서버가 buildEnabled:true
//   false — 닫힘 · 옛 서버 · 오류(buildOpenFact: 확인하지 못한 것은 열림으로 치지 않는다)
//
// 모듈 상태에 1분 동안 기억하고, 묻는 중인 요청은 함께 기다린다. 저장소(localStorage)는 쓰지 않는다 — 서버 사실이다.
import { useEffect, useState } from "react";
import { getBuildAvailability } from "./build-job-api";
import { buildOpenFact } from "./build-job-view.mjs";

const TTL_MS = 60_000;
let cached: { at: number; open: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

export function loadBuildOpen(now: number = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < TTL_MS) return Promise.resolve(cached.open);
  if (!inflight) {
    inflight = getBuildAvailability()
      .then((res) => buildOpenFact(res) === true)
      .catch(() => false)
      .then((open) => {
        cached = { at: Date.now(), open };
        inflight = null;
        return open;
      });
  }
  return inflight;
}

export function useBuildOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(() =>
    cached && Date.now() - cached.at < TTL_MS ? cached.open : null,
  );
  useEffect(() => {
    let alive = true;
    loadBuildOpen().then((v) => {
      if (alive) setOpen(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return open;
}

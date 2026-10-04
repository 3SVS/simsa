/**
 * workspace/service-switches.ts — Train W · W-2 (재정렬 D-7 amend): 검수·수리 킬스위치 해석의 단일 출처.
 *
 *   INSPECTION_ENABLED · REPAIR_ENABLED (wrangler.toml [vars])
 *     - 정확히 "off"  → 꺼짐
 *     - 미설정 · "on" · "OFF" · "" · 그 밖의 값 → 켜짐
 *
 * 왜 "정확히 off만": 킬스위치는 **fail-closed가 아니다.** [vars]에서 키가 빠지거나 오타가 난
 * 배포가 서비스를 조용히 끄면 그것이 사고다. 끄는 것은 사람이 의도해서 정확한 값을 쓴 경우만.
 * (선례: LEGACY_AUTO_REVIEW · ANTHROPIC_ENABLED — 둘 다 `=== "off"`.)
 *
 * 어디서 판정하나: **디스패치 함수 안**(dispatchInspection · dispatchRepairJob)이 이 헬퍼로 막는다.
 * 그래서 라우트·verify-sweep 크론·향후 빌드 뒤 자동 검수가 모두 같은 게이트를 지난다. 행을 만드는
 * 호출자(라우트·스윕)는 같은 헬퍼로 **행을 만들기 전에** 한 번 더 묻는다 — 꺼진 서비스가 실패 행을
 * 남기지 않게. Workers의 env는 요청 하나 안에서 바뀌지 않으므로 두 판정은 항상 같은 답이다.
 */
import type { Env } from "../env.js";

/** 503 error codes the dashboard maps (#558 — mapRunError / repairErrorKey). */
export const INSPECTION_DISABLED = "inspection_disabled" as const;
export const REPAIR_DISABLED = "repair_disabled" as const;

/** The one rule: only the exact string "off" turns a switch off. */
export function switchIsOn(raw: string | undefined): boolean {
  return raw !== "off";
}

/** Inspections (route · verify-sweep · any future auto-inspection) may dispatch. */
export function inspectionEnabled(env: Pick<Env, "INSPECTION_ENABLED">): boolean {
  return switchIsOn(env.INSPECTION_ENABLED);
}

/** Repair jobs may dispatch. */
export function repairEnabled(env: Pick<Env, "REPAIR_ENABLED">): boolean {
  return switchIsOn(env.REPAIR_ENABLED);
}

/** 503 error code for the build route (Train B hotfix 2026-10-01). */
export const BUILD_DISABLED = "build_disabled" as const;

/**
 * Builds (door (a) — POST /workspace/projects/:id/build) may start.
 *
 * Same "exactly off" rule as the other switches, but production ships with
 * BUILD_ENABLED = "off" in wrangler.toml [vars] until the build executor bundle
 * (PR #569 — job-scoped tokens, daily caps, budget stop) is live: the route
 * provisions a per-project D1 database and a hosting-org repository for any
 * caller with a dev spec, and no dashboard screen uses it yet.
 */
export function buildEnabled(env: Pick<Env, "BUILD_ENABLED">): boolean {
  return switchIsOn(env.BUILD_ENABLED);
}

/**
 * 2026-10-04 — 단계적 열기. BUILD_ENABLED 값 하나로 세 상태(단일 출처):
 *   "off"   → 모두 닫힘(종전 그대로)
 *   "staff" → 장비 티어(D-24 staff, plan_grants로 지정한 키)만 **새 빌드를 시작**할 수 있다 — 라이브 실증 3종(문 (a))을
 *             모두에게 열기 전에 프로덕션에서 돌리기 위한 단계. 이미 시작된 잡의 콜백·LLM 프록시·Worker 배포는 jobToken으로
 *             인증되므로 env 수준 buildEnabled()(= off가 아님)만 본다.
 *   그 밖   → 모두 열림(종전 "정확히 off만 꺼짐" 규칙 유지)
 */
export type BuildMode = "off" | "staff" | "on";

export function buildMode(env: Pick<Env, "BUILD_ENABLED">): BuildMode {
  const raw = (env.BUILD_ENABLED ?? "").trim();
  if (!switchIsOn(env.BUILD_ENABLED)) return "off";
  return raw === "staff" ? "staff" : "on";
}

/** staff 단계에서 장비 티어가 아닌 사람의 새 빌드 시작 — 503 코드(대시보드는 '아직 열리지 않음'으로 그린다). */
export const BUILD_STAFF_ONLY = "build_staff_only" as const;

/** 이 티어가 지금 새 빌드를 시작할 수 있는가(POST /build · 가능 여부 API). */
export function buildOpenForTier(env: Pick<Env, "BUILD_ENABLED">, tier: string): boolean {
  const mode = buildMode(env);
  return mode === "on" || (mode === "staff" && tier === "staff");
}

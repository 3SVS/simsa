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

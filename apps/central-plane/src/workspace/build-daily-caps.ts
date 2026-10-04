/**
 * workspace/build-daily-caps.ts — Train B · B-5b S1: 빌드 일일 상한 (#561 Train W 관례 그대로, 빌드용).
 *
 * POST /workspace/projects/:id/build 하나가 우리 계정에 프로젝트 D1 · simsa-hosted 저장소 · 빌더 컨테이너(최대 45분) ·
 * 잡당 최대 $10(D-7 [PILOT]) LLM을 연다. userKey는 클라이언트가 만드는 익명 id라(workspace.ts "No auth") 사용자 상한만으로는
 * 호출마다 새 키를 만드는 루프를 못 막는다 — 그래서 #561과 같은 세 층:
 *
 *   user     3 / 일  (userKey — keyed HMAC)
 *   network  5 / 일  [PILOT] (cf-connecting-ip — keyed HMAC, 없으면 이 층 생략)
 *   service 30 / 일  [PILOT] (서비스 전체 — 하루 원가 상한: 30 × $10 = $300)
 *
 * 조정: BETA_BUILD_DAILY_LIMIT · BETA_BUILD_DAILY_LIMIT_PER_IP · BETA_BUILD_DAILY_LIMIT_GLOBAL (코드 변경 없이).
 * 판정·저장은 rate-limit.ts consumeDailyCaps(버킷마다 원자 문장 하나, fail-open) — 새 테이블·마이그레이션 없음.
 * 슬롯은 소유권·지시서·활성 잡(409)·설정(503) 검사를 다 통과한 **뒤, 프로비저닝 전에** 잡고, 일이 시작되지 않으면
 * (프로비저닝 실패·행 저장 실패·디스패치 실패) 돌려준다 — 우리 실패는 사용자의 시도가 아니다.
 *
 * 응답(#561 모양, kind만 "build"):
 *   user / network 가득 → 429 { ok:false, error:"daily_limit_reached", kind:"build", limit, resetAt, scope } + Retry-After
 *   service 가득        → 503 { ok:false, error:"build_disabled", reason:"daily_capacity", resetAt } + Retry-After
 *     (서비스 가득은 그 사용자가 쓴 것이 아니다 — "오늘 횟수를 다 썼어요"는 거짓이므로 킬스위치와 같은 "잠시 멈춤" 코드)
 *
 * beta-limits.ts(검수·수리 상한)는 다른 작업(#576)이 만지는 파일이라 건드리지 않고, 같은 규칙을 이 파일에 둔다.
 */
import type { Env } from "../env.js";
import type { DailyCap, DailyCapScope } from "./rate-limit.js";
import { BUILD_DISABLED } from "./service-switches.js";
import { entitlementsFor, type Tier } from "./entitlements.js";

export const BUILD_DAILY_LIMITS = {
  /** 사용자(userKey)당 하루 빌드 시작. */
  perUser: 3,
  /** [PILOT] 네트워크(cf-connecting-ip)당. */
  perNetwork: 5,
  /** [PILOT] 서비스 전체 — 하루 원가 상한. */
  service: 30,
} as const;

export const BUILD_DAILY_BUCKET = "build-daily";
export const BUILD_DAILY_IP_BUCKET = "build-daily-ip";
export const BUILD_DAILY_GLOBAL_BUCKET = "build-daily-global";
/** 서비스 버킷의 고정 키(개인 정보 아님). beta-limits.ts SERVICE_BUCKET_KEY와 같은 값. */
export const BUILD_SERVICE_BUCKET_KEY = "all";

type BuildCapEnv = Pick<Env, "BETA_BUILD_DAILY_LIMIT" | "BETA_BUILD_DAILY_LIMIT_PER_IP" | "BETA_BUILD_DAILY_LIMIT_GLOBAL">;

/** 양의 정수 env 재정의(잘못되거나 없으면 기본값). beta-limits.ts와 같은 규칙. */
function limitFromEnv(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 사용자 하루 상한. 2026-10-04(D-24 배선): 티어를 주면 entitlements.buildsPerDay(무료 1·베이직 3·프로 10·장비 50)가
 * 기준이고, BETA_BUILD_DAILY_LIMIT을 **넣었을 때만** 모든 티어의 천장(더 낮은 쪽)이다(#585 검수 상한과 같은 규칙).
 * 티어를 안 주면 종전 기본(3)·재정의 그대로(옛 호출부 호환).
 */
export function buildDailyLimit(env: BuildCapEnv, tier?: Tier): number {
  if (!tier) return limitFromEnv(env.BETA_BUILD_DAILY_LIMIT, BUILD_DAILY_LIMITS.perUser);
  const byTier = entitlementsFor(tier).buildsPerDay;
  const ceiling = parseInt(env.BETA_BUILD_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(ceiling) && ceiling > 0 ? Math.min(byTier, ceiling) : byTier;
}
export function buildDailyLimitPerIp(env: BuildCapEnv): number {
  return limitFromEnv(env.BETA_BUILD_DAILY_LIMIT_PER_IP, BUILD_DAILY_LIMITS.perNetwork);
}
export function buildDailyLimitGlobal(env: BuildCapEnv): number {
  return limitFromEnv(env.BETA_BUILD_DAILY_LIMIT_GLOBAL, BUILD_DAILY_LIMITS.service);
}

/** 빌드 한 번이 슬롯을 가져가는 상한들 — 순서 user → network → service(가장 구체적인 답이 먼저). */
export function buildDailyCapsFor(env: BuildCapEnv, userKey: string, networkKey: string | null, tier?: Tier): DailyCap[] {
  const caps: DailyCap[] = [{ scope: "user", bucket: BUILD_DAILY_BUCKET, key: userKey, limit: buildDailyLimit(env, tier) }];
  if (networkKey) caps.push({ scope: "network", bucket: BUILD_DAILY_IP_BUCKET, key: networkKey, limit: buildDailyLimitPerIp(env) });
  caps.push({ scope: "service", bucket: BUILD_DAILY_GLOBAL_BUCKET, key: BUILD_SERVICE_BUCKET_KEY, limit: buildDailyLimitGlobal(env) });
  return caps;
}

export type BuildDailyCapRejection =
  | {
      status: 429;
      body: { ok: false; error: "daily_limit_reached"; kind: "build"; limit: number; resetAt: string; scope: Exclude<DailyCapScope, "service">; tier?: Tier };
      retryAfterSeconds: number;
    }
  | {
      status: 503;
      body: { ok: false; error: typeof BUILD_DISABLED; reason: "daily_capacity"; resetAt: string };
      retryAfterSeconds: number;
    };

export function buildDailyCapRejection(full: { scope: DailyCapScope; limit: number; resetAt: string; retryAfterSeconds: number }, tier?: Tier): BuildDailyCapRejection {
  if (full.scope === "service") {
    return { status: 503, body: { ok: false, error: BUILD_DISABLED, reason: "daily_capacity", resetAt: full.resetAt }, retryAfterSeconds: full.retryAfterSeconds };
  }
  return {
    status: 429,
    body: { ok: false, error: "daily_limit_reached", kind: "build", limit: full.limit, resetAt: full.resetAt, scope: full.scope, ...(tier ? { tier } : {}) },
    retryAfterSeconds: full.retryAfterSeconds,
  };
}

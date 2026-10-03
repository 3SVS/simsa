/**
 * project-quota.ts — D-24.2 새 프로젝트 생성 상한 (docs/simsa-plan-tiers-design-2026-10-03.md).
 *
 * [LOCKED] 세는 것은 **새 프로젝트 행이 생길 때만**(재저장·검수·수리는 세지 않음).
 * 지워도 돌려주지 않는다. 집계 키는 병행 — 하나라도 차면 거절:
 *   - 로그인 계정이 있으면 계정 버킷(`acct:<auth user id>`)
 *   - 언제나 익명 키(userKey) 버킷 — 같은 날 익명으로 만든 뒤 로그인해서 또 만드는 우회를 막는다
 *   - 네트워크 버킷(비밀 키 HMAC, IPv6 /64 — rate-limit-key.ts). 익명과 로그인은 버킷과 몫이
 *     다르다(공용 와이파이·사무실을 위해 로그인 몫이 크다). 프로·장비는 네트워크 상한 없음.
 *
 * 계정 식별: ①요청의 Better Auth 세션 ②없으면 이 userKey를 claim한 계정
 * (workspaces.legacy_user_key → created_by_auth_user_id). 조회 실패 = 익명으로 센다
 * (익명 몫이 더 작으므로 실패가 상한을 넓히지 않는다).
 */
import type { Env } from "../env.js";
import { resolveBetterAuthSession, type ResolveSession } from "../routes/workspace-claim.js";
import { clientNetworkKey } from "./beta-limits.js";
import { entitlementsFor, type Tier } from "./entitlements.js";
import { consumeDailyCaps, peekDailyCaps, type DailyCap, type DailyCapScope, type DailyCapsResult } from "./rate-limit.js";
import { resolveTier } from "./tier-resolve.js";

/** Bucket names (workspace_rate_limit key prefix — also the HMAC salt). */
export const PROJECT_CREATE_ACCOUNT_BUCKET = "project-create-daily-acct";
export const PROJECT_CREATE_USER_BUCKET = "project-create-daily-user";
export const PROJECT_CREATE_NETWORK_ANON_BUCKET = "project-create-daily-net-anon";
export const PROJECT_CREATE_NETWORK_ACCOUNT_BUCKET = "project-create-daily-net-acct";

export type ProjectCreateIdentity = {
  tier: Tier;
  accountId: string | null;
  userKey: string;
  networkKey: string | null;
};

/** D-24.2의 병행 집계를 DailyCap 목록으로. 순수 함수 — 테스트가 그대로 고정한다. */
export function buildProjectCreateCaps(id: ProjectCreateIdentity): DailyCap[] {
  const e = entitlementsFor(id.tier);
  const caps: DailyCap[] = [];
  if (id.accountId) {
    caps.push({ scope: "user", bucket: PROJECT_CREATE_ACCOUNT_BUCKET, key: `acct:${id.accountId}`, limit: e.projectCreatesPerDay });
  }
  caps.push({ scope: "user", bucket: PROJECT_CREATE_USER_BUCKET, key: id.userKey, limit: e.projectCreatesPerDay });
  const networkLimit = id.accountId ? e.projectCreatesPerDayPerNetworkAccount : e.projectCreatesPerDayPerNetworkAnonymous;
  if (id.networkKey && networkLimit !== null) {
    caps.push({
      scope: "network",
      bucket: id.accountId ? PROJECT_CREATE_NETWORK_ACCOUNT_BUCKET : PROJECT_CREATE_NETWORK_ANON_BUCKET,
      key: id.networkKey,
      limit: networkLimit,
    });
  }
  return caps;
}

/** 이 userKey를 claim한 계정(workspace-claim.ts). 없거나 실패 → null. */
async function claimedAccountId(env: Env, userKey: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT "created_by_auth_user_id" AS creator FROM workspaces WHERE legacy_user_key = ? LIMIT 1',
    )
      .bind(userKey)
      .first<{ creator: string | null }>();
    return row?.creator ? String(row.creator) : null;
  } catch {
    return null;
  }
}

export async function resolveProjectCreateIdentity(
  env: Env,
  req: Request,
  userKey: string,
  deps: { resolveSession?: ResolveSession } = {},
): Promise<ProjectCreateIdentity> {
  const resolveSession = deps.resolveSession ?? resolveBetterAuthSession;
  const session = await resolveSession(env, req.headers).catch(() => null);
  const accountId = session?.id ?? (await claimedAccountId(env, userKey));
  return {
    tier: await resolveTier(env, userKey),
    accountId,
    userKey,
    networkKey: clientNetworkKey(req),
  };
}

export type ProjectCreateQuota = {
  tier: Tier;
  projectCreate: {
    /** 계정(또는 익명 키) 기준 하루 몫 — 화면의 "N개 중". */
    limit: number;
    remaining: number;
    resetAt: string;
    /** 가장 빠듯한 집계 — "network"면 같은 네트워크의 다른 사람이 쓴 것이다. */
    limitedBy: DailyCapScope | null;
  };
};

/** GET /workspace/quota — 슬롯을 쓰지 않는 읽기. */
export async function peekProjectCreateQuota(
  env: Env,
  req: Request,
  userKey: string,
  deps: { resolveSession?: ResolveSession } = {},
): Promise<ProjectCreateQuota> {
  const id = await resolveProjectCreateIdentity(env, req, userKey, deps);
  const limit = entitlementsFor(id.tier).projectCreatesPerDay;
  const peek = await peekDailyCaps(env, buildProjectCreateCaps(id));
  return {
    tier: id.tier,
    projectCreate: {
      limit,
      remaining: Math.min(limit, peek.remaining),
      resetAt: peek.resetAt,
      limitedBy: peek.remaining <= 0 ? (peek.tightest?.scope ?? null) : null,
    },
  };
}

export type ProjectCreateConsume = { identity: ProjectCreateIdentity; result: DailyCapsResult };

/** 새 프로젝트 행을 만들기 직전에 한 칸 쓴다. 저장이 실패하면 호출자가 result.refund(). */
export async function consumeProjectCreate(
  env: Env,
  req: Request,
  userKey: string,
  deps: { resolveSession?: ResolveSession } = {},
): Promise<ProjectCreateConsume> {
  const identity = await resolveProjectCreateIdentity(env, req, userKey, deps);
  const result = await consumeDailyCaps(env, buildProjectCreateCaps(identity));
  return { identity, result };
}

/** D-24.3 거절 본문. 화면은 kind·resetAt으로 세 갈래(계속하기·다시 만들 시각·업그레이드)를 그린다. */
export function projectCreateLimitedBody(
  identity: ProjectCreateIdentity,
  limited: Extract<DailyCapsResult, { limited: true }>,
  locale: "ko" | "en" = "ko",
): Record<string, unknown> {
  const limit = entitlementsFor(identity.tier).projectCreatesPerDay;
  return {
    ok: false,
    error: "rate_limited",
    scope: "project_daily",
    kind: "project_create",
    tier: identity.tier,
    limit,
    limitedBy: limited.scope,
    resetAt: limited.resetAt,
    retryAfterSeconds: limited.retryAfterSeconds,
    message:
      locale === "en"
        ? `You can start ${limit} new project${limit === 1 ? "" : "s"} per day on your plan. You can keep working on your existing projects.`
        : `지금 플랜에서는 새 프로젝트를 하루 ${limit}개까지 만들 수 있어요. 기존 프로젝트에서는 계속 작업할 수 있어요.`,
  };
}

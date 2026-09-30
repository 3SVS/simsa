/**
 * SI 티어 Train B — B2: S 모드 호스팅 라우터 (dynamic dispatch Worker).
 * B-7: 호스팅 사업자 의무(D-6) — 정지 목록·신고 사이트·요청 상한·배포 버전 확인.
 *
 * `<slug>.<HOSTING_ROOT_DOMAIN>` → dispatch namespace의 유저 Worker `slug`.
 * 판단은 route.ts(순수), 안내 페이지는 pages.ts(순수), 여기는 HTTP 껍데기와 바인딩 호출뿐.
 *
 * 응답 규칙(정직성):
 *  - `/.well-known/simsa-health` → 어느 호스트든 200 JSON(배포 SHA·바인딩 상태). 배포 뒤 버전 확인 수단.
 *  - 도메인 미설정 → 503 hosting_not_configured
 *  - 우리 호스팅이 아닌 주소 → 404
 *  - `report.<root>` → 신고 폼(`/`)·이용 규칙(`/rules`). Simsa가 직접 그린다.
 *  - 앱 주소의 `/.well-known/simsa-*` → 유저 앱으로 **보내지 않는다**(신고 입구는 302, 나머지 404).
 *  - 정지된 slug → 410 + 짧은 안내(KO/EN, 소유자 정보 없음)
 *  - slug당 요청 상한 초과 → 429 + Retry-After (+ 분 단위 strike 기록 → central-plane 크론이 자동 정지 판단)
 *  - 네임스페이스에 없는 slug → 404 ("아직 배포 전이거나 삭제됨")
 *  - 유저 Worker 예외 → 502 (우리 라우터 오류와 구분)
 * 모든 응답에 `x-simsa-dispatch-sha`(배포 SHA, 없으면 "unknown"), 앱 응답엔 `x-simsa-hosted: <slug>`.
 *
 * 바인딩이 없을 때(정지 목록 KV 생성 전·로컬):
 *  - 정지 목록 없음 → **서빙 계속(fail-open)** + isolate당 한 줄 JSON 로그. 근거: KV를 만들기 전에 이 코드를
 *    배포하거나 KV 장애가 나면 fail-closed는 **모든 호스팅 앱을 동시에 내린다**(우리 사정으로 유저 앱 전부 다운).
 *    정지된 앱이 잠깐 보이는 비용이 그보다 작고, 확실한 차단 수단(유저 Worker 삭제)은 KV와 무관하게 남아 있다.
 *    대신 헬스 응답이 `suspensionList: "unbound"`로 드러내고, 관리자 정지 라우트는 KV가 없으면 503으로 거절한다
 *    (정지된 척하지 않는다). KV 조회 오류 때는 이 isolate가 최근 정지로 본 slug를 10분 동안 계속 막는다.
 *  - 요청 상한 바인딩 없음 → 상한 없이 서빙 + isolate당 한 줄 로그. 헬스에 `rateLimiter: "unbound"`.
 */
import {
  decideRoute,
  HEALTH_PATH,
  hostingReportUrl,
  HOSTING_RATE_LIMIT,
  normalizeRootDomain,
  parseSuspension,
  reservedPathKind,
  RULES_PATH,
  STRIKE_TTL_SECONDS,
  strikeKey,
  suspendedKey,
  type SuspensionSource,
} from "./route.js";
import { htmlResponse, parseReportStatus, pickLang, rateLimitedPage, reportSitePage, rulesPage, suspendedPage } from "./pages.js";

export interface Env {
  DISPATCHER: DispatchNamespace;
  HOSTING_ROOT_DOMAIN?: string;
  /** B-7 정지 목록(Workers KV). central-plane과 **같은 네임스페이스**를 바인딩한다. 키 `suspended:<slug>`·`strike:<slug>:<분>`. */
  HOSTING_SUSPENDED?: KVNamespace;
  /** B-7 slug당 요청 상한(Workers Rate Limiting 바인딩, 수치는 wrangler.toml [[ratelimits]]). */
  HOSTING_RATE_LIMITER?: RateLimit;
  /** 배포 커밋 SHA — deploy-hosting-dispatch.yml이 `--var DEPLOYED_SHA:$GITHUB_SHA`로 넣는다. */
  DEPLOYED_SHA?: string;
  /** 신고 폼이 보내는 central-plane 주소(https). 없으면 신고 페이지가 503으로 "지금은 받을 수 없어요". */
  SIMSA_API_BASE?: string;
}

/** `ctx.waitUntil`만 쓴다 — 테스트는 모크를 넘기거나 생략(생략 시 기다렸다가 응답). */
export type Deferrer = { waitUntil(promise: Promise<unknown>): void };

/**
 * 정지 목록 KV 조회 캐시(초). Cloudflare KV `cacheTtl` 하한이 30초라 이보다 짧게 못 한다.
 * 정직한 한계: 정지를 쓴 지역은 즉시, 다른 지역은 보통 30초·최대 약 60초 뒤에 410이 된다
 * (KV 문서: 다른 지역에 보이기까지 최대 60초 또는 cacheTtl — "없음" 응답도 같은 시간 캐시된다).
 */
export const SUSPENSION_CACHE_TTL_SECONDS = 30;
/** KV 조회 오류 때, 이 isolate가 최근 정지로 본 slug를 계속 막는 시간. */
export const LAST_KNOWN_SUSPENDED_MS = 10 * 60_000;
const LAST_KNOWN_MAX = 500;
const STRIKE_MEMO_MAX = 2000;

// ─── isolate 상태(요청 사이에 남는 작은 메모리) ───────────────────────────────────
const lastKnownSuspended = new Map<string, { until: number; source: SuspensionSource }>();
const strikesWritten = new Set<string>();
const warned = new Set<string>();

/** 테스트 전용: isolate 상태 초기화. */
export function resetIsolateStateForTests(): void {
  lastKnownSuspended.clear();
  strikesWritten.clear();
  warned.clear();
}

const errorMessage = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

function logLine(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

function warnOnce(event: string, fields: Record<string, unknown>): void {
  if (warned.has(event)) return;
  warned.add(event);
  logLine({ event, ...fields });
}

/**
 * "없는 앱"을 뜻하는 **디스패치 계층** 오류인가 — `Worker not found`로 시작하는 것만.
 *
 * 2026-09-25 라이브 교훈: 처음엔 "not found|has been deleted"까지 넓게 받았는데, 그러면 **살아 있는 유저
 * 앱**이 던진 "User not found" 같은 오류도 "배포 안 됨 404"로 둔갑해 앱 고장을 가린다. 실제로 본 502는
 * 스크립트 삭제 뒤에도 엣지에서 옛 코드가 한동안 실행되며(API상 script_count 0) 그 앱이 지워진 D1에서
 * 낸 오류였다 — 라우터가 판정할 일이 아니라 **삭제 전파 지연**이다. 즉시 차단은 B7 라우터 차단(410)으로.
 */
export function isMissingWorker(message: string): boolean {
  return /^Worker not found/i.test(message.trim());
}

const text = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } });

/** Response.redirect()는 헤더가 잠겨 SHA 헤더를 못 붙인다 — 직접 만든다. */
const redirect = (location: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 302, headers: { location, "cache-control": "no-store", ...extra } });

export function deployedSha(env: Pick<Env, "DEPLOYED_SHA">): string {
  const v = env.DEPLOYED_SHA?.trim();
  return v ? v.slice(0, 64) : "unknown";
}

/** SIMSA_API_BASE → https origin. 형식이 틀리면 null(신고 폼을 엉뚱한 곳으로 보내지 않는다). */
export function apiBaseOf(env: Pick<Env, "SIMSA_API_BASE">): string | null {
  const raw = env.SIMSA_API_BASE?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

async function defer(ctx: Deferrer | undefined, p: Promise<unknown> | null): Promise<void> {
  if (!p) return;
  if (ctx) ctx.waitUntil(p);
  else await p;
}

function remember(slug: string, source: SuspensionSource, now: number): void {
  if (lastKnownSuspended.size >= LAST_KNOWN_MAX && !lastKnownSuspended.has(slug)) {
    const oldest = lastKnownSuspended.keys().next().value;
    if (oldest !== undefined) lastKnownSuspended.delete(oldest);
  }
  lastKnownSuspended.set(slug, { until: now + LAST_KNOWN_SUSPENDED_MS, source });
}

/** 정지면 { source }, 아니면(또는 확인 불가면) null. 확인 불가는 로그로 남긴다. */
async function suspensionOf(env: Env, slug: string, now: Date): Promise<{ source: SuspensionSource } | null> {
  const kv = env.HOSTING_SUSPENDED;
  if (!kv) {
    warnOnce("hosting_suspension_unchecked", { reason: "no_binding", effect: "serving" });
    return null;
  }
  try {
    const s = parseSuspension(await kv.get(suspendedKey(slug), { cacheTtl: SUSPENSION_CACHE_TTL_SECONDS }));
    if (s) remember(slug, s.source, now.getTime());
    else lastKnownSuspended.delete(slug);
    return s;
  } catch (e) {
    const last = lastKnownSuspended.get(slug);
    if (last && last.until > now.getTime()) {
      logLine({ event: "hosting_suspension_check_failed", slug, effect: "blocked_last_known", message: errorMessage(e) });
      return { source: last.source };
    }
    logLine({ event: "hosting_suspension_check_failed", slug, effect: "serving", message: errorMessage(e) });
    return null;
  }
}

async function overLimit(env: Env, slug: string): Promise<boolean> {
  const rl = env.HOSTING_RATE_LIMITER;
  if (!rl) {
    warnOnce("hosting_rate_limit_unchecked", { reason: "no_binding", effect: "serving" });
    return false;
  }
  try {
    const { success } = await rl.limit({ key: slug });
    return !success;
  } catch (e) {
    logLine({ event: "hosting_rate_limit_check_failed", slug, effect: "serving", message: errorMessage(e) });
    return false;
  }
}

/** 분당 한 번(이 isolate 기준)만 KV에 strike를 남긴다 — 같은 키 쓰기 한도(초당 1회)와 로그 폭주를 피한다. */
function recordStrike(env: Env, slug: string, now: Date): Promise<unknown> | null {
  const kv = env.HOSTING_SUSPENDED;
  const key = strikeKey(slug, now);
  if (strikesWritten.has(key)) return null;
  if (strikesWritten.size >= STRIKE_MEMO_MAX) strikesWritten.clear();
  strikesWritten.add(key);
  logLine({ event: "hosting_rate_limited", slug, key, recorded: Boolean(kv) });
  if (!kv) return null;
  return kv.put(key, "1", { expirationTtl: STRIKE_TTL_SECONDS }).catch((e: unknown) => {
    logLine({ event: "hosting_strike_write_failed", slug, message: errorMessage(e) });
  });
}

function health(env: Env): Response {
  const root = normalizeRootDomain(env.HOSTING_ROOT_DOMAIN ?? "");
  const body = {
    ok: true,
    service: "simsa-hosting-dispatch",
    sha: deployedSha(env),
    hostingRoot: root || null,
    suspensionList: env.HOSTING_SUSPENDED ? "bound" : "unbound",
    rateLimiter: env.HOSTING_RATE_LIMITER ? "bound" : "unbound",
    reportIntake: apiBaseOf(env) ? "configured" : "not_configured",
    rateLimit: HOSTING_RATE_LIMIT,
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function reportSite(request: Request, url: URL, env: Env, root: string): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "method not allowed", { allow: "GET, HEAD" });
  const lang = pickLang(url, request.headers.get("accept-language"));
  if (url.pathname === RULES_PATH) return htmlResponse(200, rulesPage(lang, root));
  if (url.pathname !== "/") return text(404, "not found");
  const api = apiBaseOf(env);
  const html = reportSitePage({ lang, slug: url.searchParams.get("app"), rootDomain: root, apiBase: api, status: parseReportStatus(url) });
  return htmlResponse(api ? 200 : 503, html, {}, api);
}

async function route(request: Request, env: Env, ctx: Deferrer | undefined, now: Date): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === HEALTH_PATH) return health(env);
  const root = normalizeRootDomain(env.HOSTING_ROOT_DOMAIN ?? "");
  const d = decideRoute(url.hostname, root);
  switch (d.kind) {
    case "not_configured":
      return text(503, "hosting_not_configured");
    case "not_hosted":
      return text(404, "not a Simsa-hosted address");
    case "report_site":
      return reportSite(request, url, env, root);
    case "suspended":
    case "dispatch": {
      const slug = d.slug;
      const hosted = { "x-simsa-hosted": slug };
      // 예약 경로는 정지·상한보다 먼저 — 정지된 앱도 신고 입구는 열려 있어야 한다. 유저 앱으로는 절대 안 간다.
      const reserved = reservedPathKind(url.pathname);
      if (reserved === "report") return redirect(hostingReportUrl(slug, root), hosted);
      if (reserved !== null) return text(404, "reserved path", hosted);

      const lang = pickLang(url, request.headers.get("accept-language"));
      const suspension = d.kind === "suspended" ? { source: "admin" as const } : await suspensionOf(env, slug, now);
      if (suspension) return htmlResponse(410, suspendedPage(lang, suspension.source, root), hosted);

      if (await overLimit(env, slug)) {
        await defer(ctx, recordStrike(env, slug, now));
        return htmlResponse(429, rateLimitedPage(lang), { ...hosted, "retry-after": String(HOSTING_RATE_LIMIT.periodSeconds) });
      }

      let worker: Fetcher;
      try {
        worker = env.DISPATCHER.get(slug);
      } catch (e) {
        const message = errorMessage(e);
        logLine({ event: "dispatch_get_error", slug, message });
        if (isMissingWorker(message)) return text(404, "app not deployed yet", hosted);
        return text(502, "hosting router error", hosted);
      }
      try {
        const res = await worker.fetch(request);
        const out = new Response(res.body, res);
        out.headers.set("x-simsa-hosted", slug);
        return out;
      } catch (e) {
        const message = errorMessage(e);
        logLine({ event: "dispatch_fetch_error", slug, message });
        if (isMissingWorker(message)) return text(404, "app not deployed yet", hosted);
        return text(502, "the app failed to respond", hosted);
      }
    }
  }
}

export async function handle(request: Request, env: Env, ctx?: Deferrer, now: Date = new Date()): Promise<Response> {
  const res = await route(request, env, ctx, now);
  res.headers.set("x-simsa-dispatch-sha", deployedSha(env));
  return res;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

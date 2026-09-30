/**
 * 호스트명 → 유저 Worker 결정 (순수 함수 — 라우터의 판단은 전부 여기).
 *
 * 규칙 (D-6):
 *  - `<slug>.<root>` 한 단계 서브도메인만 받는다. `a.b.<root>`·루트 자체·다른 도메인은 거부.
 *  - slug = 스크립트 이름. 소문자·숫자·하이픈, 3~40자, 하이픈으로 시작·끝 금지, `--` 금지.
 *    (프로비저닝 쪽 `toHostedSlug`와 같은 규칙 — 테스트가 둘을 함께 고정한다.)
 *  - 예약어(www·api·app·admin·mail·…)는 유저 앱이 가져갈 수 없다 — 피싱 표면.
 *  - `report.<root>`는 Simsa가 직접 서빙하는 신고·이용 규칙 사이트(B-7). 유저 앱 origin과 분리한
 *    이유: 유저 앱 origin에 신고 폼을 두면 그 앱이 등록한 서비스 워커가 신고 페이지 요청을 가로채
 *    가짜 "접수됐어요"를 보여 줄 수 있다. 다른 서브도메인은 다른 origin이라 가로챌 수 없다.
 *  - 정지 여부는 여기서 판단하지 않는다 — KV 조회는 비동기라 index.ts가 한다(B-7).
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www", "api", "app", "admin", "mail", "email", "smtp", "imap", "pop", "ftp",
  "status", "docs", "help", "support", "billing", "pay", "payment", "login", "auth",
  "account", "accounts", "dashboard", "static", "assets", "cdn", "simsa", "conclave",
  "security", "abuse", "report", "root", "system", "internal", "dispatch",
]);

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

// ─── B-7 호스팅 사업자 의무 — 예약 주소·키·상한 (central-plane hosting-duties.ts와 같은 값, 테스트가 대조) ───

/** 신고·이용 규칙 사이트의 서브도메인 라벨. RESERVED_SLUGS에 이미 있어 유저 앱이 가져갈 수 없다. */
export const REPORT_HOST_LABEL = "report";
/** 신고 사이트 안의 이용 규칙 경로. */
export const RULES_PATH = "/rules";

/**
 * 라우터가 가로채는 예약 경로 접두어 — 이 아래 요청은 **유저 앱으로 절대 가지 않는다.**
 * RFC 8615 `/.well-known/`은 사이트 메타데이터 자리이고, `simsa-` 접두어는 흔한 용도(acme-challenge·
 * security.txt·assetlinks.json·apple-app-site-association·openid-configuration)와 겹치지 않는다.
 * 접두어 전체를 막아 두면 나중에 예약 경로를 늘려도 이미 올라간 유저 앱과 충돌하지 않는다.
 */
export const RESERVED_PATH_PREFIX = "/.well-known/simsa-";
/** 배포 버전 확인(모든 호스트에서 응답). */
export const HEALTH_PATH = "/.well-known/simsa-health";
/** 앱 주소에서 신고 사이트로 보내는 입구(302). */
export const REPORT_PATH = "/.well-known/simsa-report";

export type ReservedPathKind = "health" | "report" | "unknown";

export function reservedPathKind(pathname: string): ReservedPathKind | null {
  if (pathname === HEALTH_PATH) return "health";
  if (pathname === REPORT_PATH || pathname === `${REPORT_PATH}/`) return "report";
  if (pathname.startsWith(RESERVED_PATH_PREFIX)) return "unknown";
  return null;
}

export function normalizeRootDomain(rootDomain: string): string {
  return rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/** 영수증·내 앱 카드·호스팅 약관이 가리킬 신고 주소. slug가 유효하지 않으면 앱 지정 없이. */
export function hostingReportUrl(slug: string, rootDomain: string): string {
  const base = `https://${REPORT_HOST_LABEL}.${normalizeRootDomain(rootDomain)}/`;
  return isValidSlug(slug) ? `${base}?app=${slug}` : base;
}

/** 호스팅 이용 규칙(금지 콘텐츠·신고·정지·이의) 공개 주소. */
export function hostingRulesUrl(rootDomain: string): string {
  return `https://${REPORT_HOST_LABEL}.${normalizeRootDomain(rootDomain)}${RULES_PATH}`;
}

/** 정지 목록 KV 키. 값은 JSON `{v, reason, source, at, logId}` — 값이 있기만 하면 정지다. */
export const SUSPENDED_KEY_PREFIX = "suspended:";
/** 요청 상한 초과 기록(분 단위) — central-plane 크론이 모아 자동 정지를 판단한다. */
export const STRIKE_KEY_PREFIX = "strike:";
/** strike 키 수명. 자동 정지 판단 창(60분)보다 넉넉하게. */
export const STRIKE_TTL_SECONDS = 7200;

export function suspendedKey(slug: string): string {
  return `${SUSPENDED_KEY_PREFIX}${slug}`;
}

/** UTC 분 키 "202609301412". */
export function minuteKey(now: Date): string {
  return now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

export function strikeKey(slug: string, now: Date): string {
  return `${STRIKE_KEY_PREFIX}${slug}:${minuteKey(now)}`;
}

export type SuspensionSource = "admin" | "auto";

/**
 * KV 값 → 정지 여부. null이면 정지 아님. 값이 있는데 JSON이 깨졌으면 **정지로 본다**(관리자 정지로 취급) —
 * 목록에 올라간 slug를 형식 문제로 풀어 주지 않는다.
 */
export function parseSuspension(raw: string | null): { source: SuspensionSource } | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && (v as Record<string, unknown>)["source"] === "auto") return { source: "auto" };
  } catch {
    /* 깨진 값도 정지 */
  }
  return { source: "admin" };
}

/**
 * [PILOT] slug당 요청 상한. **wrangler.toml [[ratelimits]] HOSTING_RATE_LIMITER의 simple.limit·period와
 * 같아야 한다**(Workers Rate Limiting 바인딩은 수치를 설정 파일에서만 받는다 — 테스트가 두 곳을 대조).
 * period는 바인딩 제약상 10 또는 60초만 가능.
 */
export const HOSTING_RATE_LIMIT = { limit: 600, periodSeconds: 60 } as const;

export type RouteDecision =
  | { kind: "dispatch"; slug: string }
  | { kind: "report_site" }
  | { kind: "not_configured" }
  | { kind: "not_hosted"; reason: "root" | "other_domain" | "nested" | "invalid_slug" | "reserved" }
  | { kind: "suspended"; slug: string };

export function decideRoute(hostname: string, rootDomain: string, isSuspended: (slug: string) => boolean = () => false): RouteDecision {
  const root = normalizeRootDomain(rootDomain);
  if (!root) return { kind: "not_configured" };
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === root) return { kind: "not_hosted", reason: "root" };
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return { kind: "not_hosted", reason: "other_domain" };
  const label = host.slice(0, -suffix.length);
  if (label.includes(".")) return { kind: "not_hosted", reason: "nested" };
  if (label === REPORT_HOST_LABEL) return { kind: "report_site" };
  if (RESERVED_SLUGS.has(label)) return { kind: "not_hosted", reason: "reserved" };
  if (!SLUG_RE.test(label)) return { kind: "not_hosted", reason: "invalid_slug" };
  if (isSuspended(label)) return { kind: "suspended", slug: label };
  return { kind: "dispatch", slug: label };
}

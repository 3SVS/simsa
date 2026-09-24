/**
 * 호스트명 → 유저 Worker 결정 (순수 함수 — 라우터의 판단은 전부 여기).
 *
 * 규칙 (D-6):
 *  - `<slug>.<root>` 한 단계 서브도메인만 받는다. `a.b.<root>`·루트 자체·다른 도메인은 거부.
 *  - slug = 스크립트 이름. 소문자·숫자·하이픈, 3~40자, 하이픈으로 시작·끝 금지, `--` 금지.
 *    (프로비저닝 쪽 `toHostedSlug`와 같은 규칙 — 테스트가 둘을 함께 고정한다.)
 *  - 예약어(www·api·app·admin·mail·…)는 유저 앱이 가져갈 수 없다 — 피싱 표면.
 *  - 정지된 slug는 410(B7 호스팅 의무의 꽂는 자리). 정지 목록 조회는 호출자가 주입.
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

export type RouteDecision =
  | { kind: "dispatch"; slug: string }
  | { kind: "not_configured" }
  | { kind: "not_hosted"; reason: "root" | "other_domain" | "nested" | "invalid_slug" | "reserved" }
  | { kind: "suspended"; slug: string };

export function decideRoute(hostname: string, rootDomain: string, isSuspended: (slug: string) => boolean = () => false): RouteDecision {
  const root = rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!root) return { kind: "not_configured" };
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === root) return { kind: "not_hosted", reason: "root" };
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return { kind: "not_hosted", reason: "other_domain" };
  const label = host.slice(0, -suffix.length);
  if (label.includes(".")) return { kind: "not_hosted", reason: "nested" };
  if (RESERVED_SLUGS.has(label)) return { kind: "not_hosted", reason: "reserved" };
  if (!SLUG_RE.test(label)) return { kind: "not_hosted", reason: "invalid_slug" };
  if (isSuspended(label)) return { kind: "suspended", slug: label };
  return { kind: "dispatch", slug: label };
}

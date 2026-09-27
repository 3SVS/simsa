/**
 * 호스팅 slug 예약어 — apps/hosting-dispatch/src/route.ts의 RESERVED_SLUGS와 **같은 목록**이어야 한다
 * (라우터가 거부하는 이름으로 앱을 만들면 배포는 되는데 주소가 404). 테스트가 두 파일을 대조한다.
 */
export const RESERVED_SLUGS_FOR_HOSTING: ReadonlySet<string> = new Set([
  "www", "api", "app", "admin", "mail", "email", "smtp", "imap", "pop", "ftp",
  "status", "docs", "help", "support", "billing", "pay", "payment", "login", "auth",
  "account", "accounts", "dashboard", "static", "assets", "cdn", "simsa", "conclave",
  "security", "abuse", "report", "root", "system", "internal", "dispatch",
]);

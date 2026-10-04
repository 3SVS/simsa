/**
 * routes/hosting-duties.ts — SI 티어 Train B · B-7 호스팅 사업자 의무(D-6).
 *
 * 관리자(Bearer INTERNAL_CALLBACK_TOKEN — 다른 /admin/* 관례와 같다. 미설정 503, 틀림 401):
 *   POST /admin/hosting/:slug/suspend    { reason: phishing|spam|adult|malware|illegal|abuse_other, memo? ≤1000 }
 *   POST /admin/hosting/:slug/unsuspend  { memo? ≤1000 }
 *   GET  /admin/hosting/:slug            정지 상태 · 최근 로그 20(정지·해제·요청 몰림 플래그) · 최근 신고 20
 *   → 운영자의 "1클릭" 경로는 Actions `hosting-duty` 워크플로(토큰은 repo secret에만 있다).
 *
 * 공개:
 *   POST /hosting/report  신고 접수. 두 가지 모양만 받는다(그 밖의 Content-Type은 415):
 *     - `application/json` (대시보드·API). 브라우저에서 다른 사이트가 보내려면 CORS 프리플라이트를 거쳐야 해
 *       허용 목록(cors.ts) 밖의 사이트는 못 보낸다. 예전엔 Content-Type과 무관하게 본문을 JSON으로 읽어서
 *       다른 사이트가 `enctype="text/plain"` 폼으로 JSON 모양 본문을 몰래 보낼 수 있었다.
 *     - `application/x-www-form-urlencoded` (report.<root> 페이지 — 스크립트 없음). **Origin이 정확히
 *       `https://report.<root>`일 때만** 받는다(PR #575 검증 P1: 다른 사이트가 방문자 브라우저로 폼을 자동 제출하면
 *       방문자마다 네트워크가 달라 네트워크 상한을 우회했다). 신고 페이지는 Referrer-Policy strict-origin이라
 *       브라우저가 Origin을 싣는다(no-referrer면 "null"). 폼이면 303으로 report.<root>로 돌려보낸다(되돌아갈
 *       주소는 HOSTING_ROOT_DOMAIN + 검증된 slug로만 만든다 — 열린 리디렉트 없음).
 *     접수 스위치: HOSTING_REPORTS_ENABLED가 정확히 "on"이 아니면 본문을 읽기 전에 JSON 503 reports_not_open /
 *       폼 303 error=closed("준비 중" 안내 — 브라우저 사용자에게 JSON을 보이지 않는다). 방침 고지 전엔 꺼 둔다.
 *     본문은 **읽은 바이트로** 16KB 상한(Content-Length 헤더를 믿지 않는다 — 청크 전송·HTTP/2는 헤더가 없어도 된다).
 *     신고자 IP는 cf-connecting-ip만 보고(x-forwarded-for는 위조 가능), 저장은 네트워크 단위 비밀 키 HMAC으로만.
 *     하루 상한·알림 묶음은 workspace/hosting-duties.ts.
 */
import { Hono, type Context } from "hono";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { corsMiddleware } from "./cors.js";
import {
  hostingReportUrl,
  isHostableSlug,
  normalizeReportedApp,
  normalizeRootDomain,
  recordHostingReport,
  ReportBodySchema,
  reportsOpen,
  reportSiteOrigin,
  REPORTS_RECENT_SQL,
  SuspendBodySchema,
  suspendHostedApp,
  suspendedKey,
  SUSPENSION_LOG_RECENT_SQL,
  UnsuspendBodySchema,
  unsuspendHostedApp,
  type SuspensionOutcome,
} from "../workspace/hosting-duties.js";

type C = Context<{ Bindings: Env }>;

function sameToken(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** 다른 /admin/* 와 같은 관례: 서버 토큰 미설정 → 503, 없거나 틀리면 401. 본문을 읽기 전에 판정한다. */
function adminGate(c: C): Response | null {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return c.json({ ok: false, error: "admin_disabled" }, 503);
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m || !m[1] || !sameToken(m[1], expected)) return c.json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

const NOT_JSON = Symbol("not_json");

/** 빈 본문 = {}, 깨진 JSON = NOT_JSON. (관리자 경로 — 토큰 뒤라 크기 상한은 두지 않는다.) */
async function readJsonOrEmpty(c: C): Promise<unknown> {
  const text = await c.req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

function issues(error: { issues: Array<{ path: Array<string | number>; message: string }> }) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function outcomeResponse(c: C, out: SuspensionOutcome): Response {
  if (out.ok) return c.json(out, 200);
  switch (out.error) {
    case "invalid_slug":
      return c.json({ ok: false, error: "invalid_slug" }, 400);
    case "store_not_configured":
      return c.json({ ok: false, error: "suspension_store_not_configured" }, 503);
    case "log_unavailable":
      return c.json({ ok: false, error: "log_unavailable" }, 503);
    case "store_failed":
      return c.json({ ok: false, error: "suspension_store_failed", logId: out.logId ?? null }, 503);
  }
}

const FORM_FIELDS = ["app", "reason", "description", "contact", "lang"] as const;

/** 신고 본문 상한(바이트). 한글 1000자 설명(UTF-8 3바이트)·폼 인코딩(%XX 3배)을 넉넉히 담는다. */
export const MAX_REPORT_BODY_BYTES = 16_384;

export type CappedBody = { ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" };

/**
 * 본문을 **읽은 바이트 수로** 자른다 — 누적이 `maxBytes`를 넘는 순간 스트림을 취소하고 too_large.
 * Content-Length가 있고 이미 넘으면 읽지도 않는다(빠른 거절). 헤더가 없거나 거짓이어도 상한은 지켜진다.
 * UTF-8로 디코드(깨진 바이트는 대체 문자 — 그 뒤 Zod·정규화가 거른다).
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<CappedBody> {
  const declared = req.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) return { ok: false, reason: "too_large" };
  const body = req.body;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    all.set(ch, at);
    at += ch.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8").decode(all) };
}

/** 폼 본문 → 아는 필드만(첫 값). */
function formFields(text: string): Record<string, string> {
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const k of FORM_FIELDS) {
    const v = params.get(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

/** report.<root> 페이지가 읽는 결과 코드 — hosting-dispatch pages.ts REPORT_STATUS_VALUES와 같다(테스트 대조). */
export const FORM_STATUS_VALUES = ["sent", "limit", "app_limit", "invalid", "unavailable", "closed"] as const;
type FormStatus = (typeof FORM_STATUS_VALUES)[number];

/** 폼 전송 뒤 돌아갈 주소 — 우리 도메인 + 검증된 slug로만 만든다. */
function formReturnUrl(root: string, slug: string | null, status: FormStatus, lang: "ko" | "en" | null): string {
  const base = hostingReportUrl(slug ?? "", root);
  const sep = base.includes("?") ? "&" : "?";
  const flag = status === "sent" ? "sent=1" : `error=${status}`;
  return `${base}${sep}${flag}${lang ? `&lang=${lang}` : ""}`;
}

type BodyKind = "form" | "json" | "unsupported";

function bodyKindOf(contentType: string | undefined): BodyKind {
  const ct = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (ct === "application/x-www-form-urlencoded") return "form";
  if (ct === "application/json") return "json";
  return "unsupported";
}

export function createHostingDutiesRoutes(fetchImpl?: FetchLike): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  // 공개 신고만 브라우저 CORS(대시보드 JSON 호출). 관리자 경로에는 붙이지 않는다.
  app.use("/hosting/*", corsMiddleware);

  app.post("/admin/hosting/:slug/suspend", async (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const raw = await readJsonOrEmpty(c);
    const parsed = raw === NOT_JSON ? null : SuspendBodySchema.safeParse(raw);
    if (!parsed || !parsed.success) return c.json({ ok: false, error: "invalid_body", issues: parsed ? issues(parsed.error) : [] }, 400);
    const out = await suspendHostedApp(
      c.env,
      { slug: c.req.param("slug"), reason: parsed.data.reason, actor: "admin", memo: parsed.data.memo ?? null },
      fetchImpl ? { fetch: fetchImpl } : {},
    );
    return outcomeResponse(c, out);
  });

  app.post("/admin/hosting/:slug/unsuspend", async (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const raw = await readJsonOrEmpty(c);
    const parsed = raw === NOT_JSON ? null : UnsuspendBodySchema.safeParse(raw);
    if (!parsed || !parsed.success) return c.json({ ok: false, error: "invalid_body", issues: parsed ? issues(parsed.error) : [] }, 400);
    const out = await unsuspendHostedApp(c.env, { slug: c.req.param("slug"), actor: "admin", memo: parsed.data.memo ?? null });
    return outcomeResponse(c, out);
  });

  app.get("/admin/hosting/:slug", async (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const slug = c.req.param("slug");
    if (!isHostableSlug(slug)) return c.json({ ok: false, error: "invalid_slug" }, 400);
    const kv = c.env.HOSTING_SUSPENDED;
    let suspended: boolean | null = null;
    let current: unknown = null;
    if (kv) {
      try {
        const raw = await kv.get(suspendedKey(slug));
        suspended = raw !== null;
        if (raw !== null) {
          try {
            current = JSON.parse(raw);
          } catch {
            current = { unparsable: true };
          }
        }
      } catch {
        suspended = null;
      }
    }
    const log = await c.env.DB.prepare(SUSPENSION_LOG_RECENT_SQL)
      .bind(slug)
      .all()
      .catch(() => ({ results: [] as unknown[] }));
    const reports = await c.env.DB.prepare(REPORTS_RECENT_SQL)
      .bind(slug)
      .all()
      .catch(() => ({ results: [] as unknown[] }));
    return c.json({
      ok: true,
      slug,
      store: kv ? "bound" : "unbound",
      suspended,
      current,
      log: log.results ?? [],
      reports: reports.results ?? [],
      reportUrl: hostingReportUrl(slug, c.env.HOSTING_ROOT_DOMAIN ?? ""),
    });
  });

  app.post("/hosting/report", async (c) => {
    const kind = bodyKindOf(c.req.header("content-type"));
    if (kind === "unsupported") return c.json({ ok: false, error: "unsupported_media_type" }, 415);
    const root = normalizeRootDomain(c.env.HOSTING_ROOT_DOMAIN ?? "");

    if (kind === "form") {
      // 폼은 신고 사이트에서 온 것만 — 다른 사이트의 자동 제출을 막는다. 거절은 저장·상한 소모 없음.
      if (!root) return c.json({ ok: false, error: "hosting_not_configured" }, 503);
      if (c.req.header("origin") !== reportSiteOrigin(root)) return c.json({ ok: false, error: "origin_not_allowed" }, 403);
    }
    if (!reportsOpen(c.env)) {
      if (kind === "form") return c.redirect(formReturnUrl(root, null, "closed", null), 303);
      return c.json({ ok: false, error: "reports_not_open" }, 503);
    }

    // 공개 경로 — 필드 상한(설명 1000·연락처 200·주소 300자)을 넉넉히 넘는 본문은 끝까지 읽지 않는다.
    const body = await readBodyCapped(c.req.raw, MAX_REPORT_BODY_BYTES);
    if (!body.ok) {
      if (body.reason === "too_large") return c.json({ ok: false, error: "body_too_large" }, 413);
      return c.json({ ok: false, error: "invalid_body", issues: [] }, 400);
    }
    let raw: unknown = null;
    if (kind === "form") {
      raw = formFields(body.text);
    } else {
      try {
        raw = JSON.parse(body.text);
      } catch {
        raw = null;
      }
    }
    const rawObj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const lang = rawObj["lang"] === "ko" || rawObj["lang"] === "en" ? rawObj["lang"] : null;
    const guessedSlug = typeof rawObj["app"] === "string" ? normalizeReportedApp(rawObj["app"], root) : null;
    const viaForm = kind === "form";
    const back = (status: FormStatus, slug: string | null) => c.redirect(formReturnUrl(root, slug, status, lang), 303);

    const parsed = ReportBodySchema.safeParse(raw);
    if (!parsed.success) {
      if (viaForm) return back("invalid", guessedSlug);
      return c.json({ ok: false, error: "invalid_body", issues: issues(parsed.error) }, 400);
    }
    const ip = c.req.header("cf-connecting-ip")?.trim() || "unknown";
    const out = await recordHostingReport(c.env, parsed.data, ip, fetchImpl ? { fetch: fetchImpl } : {});
    if (out.ok) {
      if (viaForm) return back("sent", out.slug);
      return c.json({ ok: true, reportId: out.reportId }, 200);
    }
    switch (out.error) {
      case "invalid_app":
        if (viaForm) return back("invalid", null);
        return c.json({ ok: false, error: "invalid_app" }, 400);
      case "not_hosted":
        // 우리 도메인 모양이지만 Simsa가 올린 적 없는 이름 — 되돌아갈 주소에 싣지 않는다.
        if (viaForm) return back("invalid", null);
        return c.json({ ok: false, error: "app_not_hosted" }, 400);
      case "report_limit":
        if (viaForm) return back("limit", out.slug);
        return c.json({ ok: false, error: "report_limit", retryAfterSeconds: out.retryAfterSeconds }, 429, { "Retry-After": String(out.retryAfterSeconds) });
      case "app_report_limit":
        if (viaForm) return back("app_limit", out.slug);
        return c.json({ ok: false, error: "app_report_limit", retryAfterSeconds: out.retryAfterSeconds }, 429, { "Retry-After": String(out.retryAfterSeconds) });
      case "report_unavailable":
        if (viaForm) return back("unavailable", out.slug);
        return c.json({ ok: false, error: "report_unavailable" }, 503);
    }
  });

  return app;
}

/**
 * routes/hosting-duties.ts — SI 티어 Train B · B-7 호스팅 사업자 의무(D-6).
 *
 * 관리자(Bearer INTERNAL_CALLBACK_TOKEN — 다른 /admin/* 관례와 같다. 미설정 503, 틀림 401):
 *   POST /admin/hosting/:slug/suspend    { reason: phishing|spam|adult|malware|illegal|abuse_other, memo? ≤1000 }
 *   POST /admin/hosting/:slug/unsuspend  { memo? ≤1000 }
 *   GET  /admin/hosting/:slug            정지 상태 · 최근 로그 20 · 최근 신고 20
 *   → 운영자의 "1클릭" 경로는 Actions `hosting-duty` 워크플로(토큰은 repo secret에만 있다).
 *
 * 공개:
 *   POST /hosting/report  신고 접수. JSON(대시보드·API) 또는 폼(report.<root> 페이지 — 스크립트 없음).
 *     폼이면 303으로 report.<root>로 돌려보낸다(되돌아갈 주소는 HOSTING_ROOT_DOMAIN + 검증된 slug로만
 *     만든다 — 열린 리디렉트 없음). 신고자 IP는 cf-connecting-ip만 보고(x-forwarded-for는 위조 가능), 저장은
 *     비밀 키 HMAC으로만. 하루 상한은 workspace/hosting-duties.ts REPORT_CAPS.
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

/** 빈 본문 = {}, 깨진 JSON = NOT_JSON. */
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

function pickFormStrings(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FORM_FIELDS) {
    const v = body[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

type FormStatus = "sent" | "invalid" | "limit" | "unavailable";

/** 폼 전송 뒤 돌아갈 주소 — 우리 도메인 + 검증된 slug로만 만든다. */
function formReturnUrl(root: string, slug: string | null, status: FormStatus, lang: "ko" | "en" | null): string {
  const base = hostingReportUrl(slug ?? "", root);
  const sep = base.includes("?") ? "&" : "?";
  const flag = status === "sent" ? "sent=1" : `error=${status}`;
  return `${base}${sep}${flag}${lang ? `&lang=${lang}` : ""}`;
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
      { slug: c.req.param("slug"), reason: parsed.data.reason, source: "admin", actor: "admin", memo: parsed.data.memo ?? null },
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
    const ct = (c.req.header("content-type") ?? "").toLowerCase();
    const isForm = ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("multipart/form-data");
    // 공개 경로 — 필드 상한(설명 1000·연락처 200·주소 300자)을 넉넉히 넘는 본문은 읽기 전에 거절한다.
    const declared = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_REPORT_BODY_BYTES) return c.json({ ok: false, error: "body_too_large" }, 413);
    let raw: unknown;
    if (isForm) {
      const body = await c.req.parseBody().catch(() => null);
      raw = body ? pickFormStrings(body) : null;
    } else {
      raw = await c.req.json().catch(() => null);
    }
    const root = normalizeRootDomain(c.env.HOSTING_ROOT_DOMAIN ?? "");
    const rawObj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const lang = rawObj["lang"] === "ko" || rawObj["lang"] === "en" ? rawObj["lang"] : null;
    const guessedSlug = typeof rawObj["app"] === "string" ? normalizeReportedApp(rawObj["app"], root) : null;
    // 폼은 우리 도메인이 설정돼 있을 때만 되돌려 보낸다(아니면 JSON으로 정직하게).
    const viaForm = isForm && root !== "";
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
      case "report_limit":
        if (viaForm) return back("limit", out.slug);
        return c.json({ ok: false, error: "report_limit", retryAfterSeconds: out.retryAfterSeconds }, 429, { "Retry-After": String(out.retryAfterSeconds) });
      case "report_unavailable":
        if (viaForm) return back("unavailable", out.slug);
        return c.json({ ok: false, error: "report_unavailable" }, 503);
    }
  });

  return app;
}

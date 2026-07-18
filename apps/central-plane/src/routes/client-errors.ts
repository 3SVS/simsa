/**
 * routes/client-errors.ts — G12 클라이언트 오류 수집 (2026-07-18 backlog).
 *
 * POST /workspace/client-errors — dashboard 전역 핸들러의 fire-and-forget 신고.
 *   서버가 절단을 강제(클라이언트 신뢰 안 함), IP당 시간당 30건 제한, 실패해도
 *   200류로 조용히(신고 실패가 사용자 화면을 어지럽히면 본말전도).
 * GET  /admin/client-errors — 최근 100건 (INTERNAL_CALLBACK_TOKEN).
 *
 * 프라이버시: 메시지/스택/경로만 — 폼 값·이메일 같은 내용은 클라이언트가 애초에
 * 보내지 않는 계약(dashboard lib/client-error-report.mjs). URL 쿼리는 경로에서
 * 잘라낸다(토큰류 유입 방지).
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { corsHeaders } from "./cors.js";

const LIMIT_PER_HOUR = 30;

/** 서버측 강제 절단 + 쿼리 제거. Pure — 테스트 고정. */
export function sanitizeClientError(body: unknown): {
  userKey: string | null;
  path: string | null;
  message: string;
  stack: string | null;
  userAgent: string | null;
} | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const message = typeof b["message"] === "string" ? b["message"].trim().slice(0, 500) : "";
  if (!message) return null;
  const rawPath = typeof b["path"] === "string" ? b["path"] : null;
  return {
    userKey: typeof b["userKey"] === "string" ? b["userKey"].slice(0, 64) : null,
    // 쿼리스트링/해시는 버린다 — 토큰·검색어류가 오류 수집에 섞이면 안 된다.
    path: rawPath ? rawPath.split(/[?#]/)[0]!.slice(0, 200) : null,
    message,
    stack: typeof b["stack"] === "string" ? b["stack"].slice(0, 2000) : null,
    userAgent: typeof b["userAgent"] === "string" ? b["userAgent"].slice(0, 200) : null,
  };
}

export function createClientErrorRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/workspace/client-errors", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const err = sanitizeClientError(body);
    if (!err) {
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    // 전역 폭주 가드(스팸/오류 루프): 최근 1시간 총량 상한. 클라이언트 캡(세션당
    // 5건)이 1차 방어라 서버는 거친 상한만 두고, 초과분은 조용히 수용한 척 버린다
    // (신고 실패가 사용자 화면을 어지럽히면 본말전도).
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM client_errors WHERE created_at > ?`,
    )
      .bind(hourAgo)
      .first<{ n: number }>()
      .catch(() => null);
    if ((total?.n ?? 0) >= LIMIT_PER_HOUR * 10) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...headers } });
    }

    await c.env.DB.prepare(
      `INSERT INTO client_errors (id, user_key, path, message, stack, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        `cerr_${crypto.randomUUID().slice(0, 12)}`,
        err.userKey,
        err.path,
        err.message,
        err.stack,
        err.userAgent,
        new Date().toISOString(),
      )
      .run()
      .catch(() => undefined);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  app.get("/admin/client-errors", async (c) => {
    const expected = c.env.INTERNAL_CALLBACK_TOKEN;
    const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expected || got !== expected) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    }
    const rows = await c.env.DB.prepare(
      `SELECT id, user_key, path, message, stack, user_agent, created_at
         FROM client_errors ORDER BY created_at DESC LIMIT 100`,
    )
      .all()
      .catch(() => ({ results: [] as unknown[] }));
    return new Response(JSON.stringify({ ok: true, errors: rows.results ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  return app;
}

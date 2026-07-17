/**
 * plan.ts — RC-4 플랜 자격 (2026-07-17 design lock approved).
 *
 * paid 판정 우선순위: ①plan_grants 미회수 그랜트(베타 수동 부여) ②ls_subscriptions
 * active 구독. 그 외 전부 free. 모든 DB 오류는 free로 fail-safe — 자격 조회 실패가
 * 검수 자체를 막으면 안 되지만, 실패를 paid로 승격해서도 안 된다.
 *
 * Routes:
 *   GET  /workspace/plan?userKey=...   → { ok, plan }  (공개 — plan은 민감정보 아님)
 *   GET  /admin/plan-grants            → 그랜트 목록 (INTERNAL_CALLBACK_TOKEN)
 *   POST /admin/plan-grants            → { userKey, action: "grant"|"revoke", note? }
 */
import { Hono } from "hono";
import type { Env } from "./env.js";
import { corsHeaders } from "./routes/cors.js";

export type Plan = "free" | "paid";

export async function resolvePlan(env: Env, userKey: string | undefined | null): Promise<Plan> {
  const key = (userKey ?? "").trim();
  if (!key) return "free";
  try {
    const grant = await env.DB.prepare(
      `SELECT plan FROM plan_grants WHERE user_key = ? AND revoked_at IS NULL`,
    )
      .bind(key)
      .first<{ plan: string }>();
    if (grant?.plan === "paid") return "paid";
  } catch {
    /* table missing or query error → keep checking subscription */
  }
  try {
    const sub = await env.DB.prepare(
      `SELECT id FROM ls_subscriptions WHERE user_key = ? AND status = 'active' LIMIT 1`,
    )
      .bind(key)
      .first<{ id: string }>();
    if (sub) return "paid";
  } catch {
    /* fail-safe to free */
  }
  return "free";
}

export function createPlanRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/workspace/plan", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const plan = await resolvePlan(c.env, c.req.query("userKey"));
    return new Response(JSON.stringify({ ok: true, plan }), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  });

  const requireAdmin = (c: { env: Env; req: { header: (n: string) => string | undefined } }): boolean => {
    const expected = c.env.INTERNAL_CALLBACK_TOKEN;
    const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    return Boolean(expected) && got === expected;
  };

  app.get("/admin/plan-grants", async (c) => {
    if (!requireAdmin(c)) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    const rows = await c.env.DB.prepare(
      `SELECT user_key, plan, note, created_at, revoked_at FROM plan_grants ORDER BY created_at DESC LIMIT 100`,
    )
      .all()
      .catch(() => ({ results: [] as unknown[] }));
    return new Response(JSON.stringify({ ok: true, grants: rows.results ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  app.post("/admin/plan-grants", async (c) => {
    if (!requireAdmin(c)) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim() : "";
    const action = b["action"];
    if (!userKey || (action !== "grant" && action !== "revoke")) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_and_action_required" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const now = new Date().toISOString();
    if (action === "grant") {
      await c.env.DB.prepare(
        `INSERT INTO plan_grants (user_key, plan, note, created_at, revoked_at)
         VALUES (?, 'paid', ?, ?, NULL)
         ON CONFLICT(user_key) DO UPDATE SET revoked_at = NULL, note = excluded.note`,
      )
        .bind(userKey, typeof b["note"] === "string" ? b["note"].slice(0, 200) : null, now)
        .run();
    } else {
      await c.env.DB.prepare(`UPDATE plan_grants SET revoked_at = ? WHERE user_key = ?`)
        .bind(now, userKey)
        .run();
    }
    return new Response(JSON.stringify({ ok: true, userKey, action }), { status: 200, headers: { "content-type": "application/json" } });
  });

  return app;
}

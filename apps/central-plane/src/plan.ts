/**
 * plan.ts — RC-4 플랜 자격 (2026-07-17 design lock approved).
 *
 * D-24(2026-10-03 design lock approved): 플랜은 이제 티어(free·basic·pro·staff)다 —
 * 수치·기능은 workspace/entitlements.ts 단일 표. `resolvePlan`(free|paid)은 하위 호환:
 * 협의체 같은 "paid" 기능이 있는 티어(pro·staff)만 paid로 답한다.
 *
 * 티어 판정 우선순위: ①plan_grants 미회수 그랜트(수동 부여 — basic/pro/staff, 레거시 paid=pro)
 * ②ls_subscriptions active 구독(레거시 = pro). 그 외 전부 free. 모든 DB 오류는 free로
 * fail-safe — 자격 조회 실패가 검수 자체를 막으면 안 되지만, 실패를 유료로 승격해서도 안 된다.
 *
 * Routes:
 *   GET  /workspace/plan?userKey=...   → { ok, plan, tier }  (공개 — 플랜은 민감정보 아님)
 *   GET  /workspace/quota?userKey=...  → { ok, tier, projectCreate }  (D-24.3 남은 개수, 소비 없음)
 *   GET  /admin/plan-grants            → 그랜트 목록 (INTERNAL_CALLBACK_TOKEN)
 *   POST /admin/plan-grants            → { userKey, action: "grant"|"revoke", plan?, note? }
 */
import { Hono } from "hono";
import type { Env } from "./env.js";
import { corsHeaders } from "./routes/cors.js";
import { entitlementsFor, isGrantablePlan, type Tier } from "./workspace/entitlements.js";
import { resolveTier } from "./workspace/tier-resolve.js";
import { peekProjectCreateQuota } from "./workspace/project-quota.js";

export type Plan = "free" | "paid";
export type { Tier };
export { resolveTier };

/** 하위 호환(RC-4): 협의체 자격이 있는 티어만 paid. */
export async function resolvePlan(env: Env, userKey: string | undefined | null): Promise<Plan> {
  return entitlementsFor(await resolveTier(env, userKey)).councilReview ? "paid" : "free";
}

export function createPlanRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/workspace/plan", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const tier = await resolveTier(c.env, c.req.query("userKey"));
    const plan: Plan = entitlementsFor(tier).councilReview ? "paid" : "free";
    return new Response(JSON.stringify({ ok: true, plan, tier }), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  });

  // D-24.3 — 막히기 **전에** 남은 개수를 보여주기 위한 읽기(슬롯을 쓰지 않는다).
  app.get("/workspace/quota", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const userKey = (c.req.query("userKey") ?? "").trim();
    if (!userKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), {
        status: 400,
        headers: { "content-type": "application/json", ...headers },
      });
    }
    const quota = await peekProjectCreateQuota(c.env, c.req.raw, userKey);
    return new Response(JSON.stringify({ ok: true, tier: quota.tier, projectCreate: quota.projectCreate }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
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
      // D-24: plan 생략 = 레거시 'paid'(=프로). 그 외 basic·pro·staff만.
      const plan = b["plan"] === undefined ? "paid" : b["plan"];
      if (!isGrantablePlan(plan)) {
        return new Response(JSON.stringify({ ok: false, error: "invalid_plan" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      await c.env.DB.prepare(
        `INSERT INTO plan_grants (user_key, plan, note, created_at, revoked_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(user_key) DO UPDATE SET plan = excluded.plan, revoked_at = NULL, note = excluded.note`,
      )
        .bind(userKey, plan, typeof b["note"] === "string" ? b["note"].slice(0, 200) : null, now)
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

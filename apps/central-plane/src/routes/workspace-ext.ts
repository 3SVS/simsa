/**
 * routes/workspace-ext.ts — G8 D-1 (DR-1/DR-2 LOCKED, 2026-07-19).
 *
 * ExtendedProjectData의 서버 정본 라우트:
 *   PUT /workspace/projects/:id/ext          — { userKey, ext } upsert.
 *   GET /workspace/projects/:id/ext?userKey= — 소유자만 조회.
 *
 * 소유권 = 기존 owned-project 게이트(프로젝트가 D1에 미러돼 있고 user_key 일치).
 * 미러 전 프로젝트의 upsert는 404 — 클라이언트 fire-and-forget이 조용히 넘기고
 * 다음 저장에서 재시도한다(best-effort, DR-2). 충돌 = last-write-wins.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { corsHeaders, corsMiddleware } from "./cors.js";
import { getOwnedProject } from "../workspace/db.js";

const EXT_JSON_CAP = 262_144; // 256KB — 텍스트 상태만 (스크린샷류는 R2)

/** Pure — 테스트 고정. 형식·크기만 검증(내용은 사용자의 것). */
export function validateExtUpsert(body: unknown): { userKey: string; extJson: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim().slice(0, 64) : "";
  if (!userKey) return null;
  const ext = b["ext"];
  if (typeof ext !== "object" || ext === null || Array.isArray(ext)) return null;
  let extJson: string;
  try {
    extJson = JSON.stringify(ext);
  } catch {
    return null;
  }
  if (extJson.length > EXT_JSON_CAP) return null;
  return { userKey, extJson };
}

export function createWorkspaceExtRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  app.put("/workspace/projects/:id/ext", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const v = validateExtUpsert(body);
    if (!v) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_ext" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    const owned = await getOwnedProject(c.env, projectId, v.userKey).catch(() => null);
    if (!owned) {
      // 미러 전이거나 소유 아님 — 구분해주지 않는다.
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }

    await c.env.DB.prepare(
      `INSERT INTO workspace_project_ext (project_id, user_key, ext_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         ext_json = excluded.ext_json,
         updated_at = excluded.updated_at`,
    )
      .bind(projectId, v.userKey, v.extJson, new Date().toISOString())
      .run();

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  app.get("/workspace/projects/:id/ext", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    const userKey = (c.req.query("userKey") ?? "").trim();
    if (!userKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }
    const row = await c.env.DB.prepare(
      `SELECT ext_json, updated_at FROM workspace_project_ext WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<{ ext_json: string; updated_at: string }>()
      .catch(() => null);
    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }
    let ext: unknown;
    try {
      ext = JSON.parse(row.ext_json);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }
    return new Response(JSON.stringify({ ok: true, ext, updatedAt: row.updated_at }), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  return app;
}

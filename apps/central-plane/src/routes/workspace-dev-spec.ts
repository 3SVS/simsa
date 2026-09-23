/**
 * routes/workspace-dev-spec.ts — T0 개발 지시서 저장/조회 (SI 티어 D-2, 2026-09-24).
 *
 *   PUT /workspace/projects/:id/dev-spec           — { userKey, devSpec } 저장.
 *                                                    스키마·무결성 실패 = 422 (저장 안 함).
 *   GET /workspace/projects/:id/dev-spec?userKey=  — 소유자만 조회. 없으면 404 no_dev_spec.
 *
 * 소유권 = 기존 owned-project 게이트(getOwnedProject). 응답은 "missing"과 "not owned"를
 * 구분하지 않는다(프로젝트 id 탐색 방지, workspace-ext와 동일 규율).
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { corsHeaders, corsMiddleware } from "./cors.js";
import { getOwnedProject } from "../workspace/db.js";
import { validateDevSpec, type DevSpecValidation } from "../workspace/dev-spec.js";

/** 지시서는 텍스트 상태만 — 512KB 캡(스크린샷류는 R2). */
export const DEV_SPEC_JSON_CAP = 524_288;

export type DevSpecUpsertParse =
  | { ok: true; userKey: string; devSpecJson: string }
  | { ok: false; error: "invalid_body" | "userKey_required" | "dev_spec_too_large" | "dev_spec_invalid"; detail?: DevSpecValidation };

/** Pure — 입구 검증. 형식·크기·스키마·무결성 순. 테스트 고정. */
export function parseDevSpecUpsert(body: unknown): DevSpecUpsertParse {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim().slice(0, 64) : "";
  if (!userKey) return { ok: false, error: "userKey_required" };
  const v = validateDevSpec(b["devSpec"]);
  if (!v.ok) return { ok: false, error: "dev_spec_invalid", detail: v };
  const devSpecJson = JSON.stringify(v.spec);
  if (devSpecJson.length > DEV_SPEC_JSON_CAP) return { ok: false, error: "dev_spec_too_large" };
  return { ok: true, userKey, devSpecJson };
}

const json = (headers: Record<string, string>, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function createWorkspaceDevSpecRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  app.put("/workspace/projects/:id/dev-spec", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(headers, 400, { ok: false, error: "invalid_json" });
    }
    const parsed = parseDevSpecUpsert(body);
    if (!parsed.ok) {
      if (parsed.error === "dev_spec_invalid" && parsed.detail && !parsed.detail.ok) {
        // 422: 무엇이 틀렸는지 기계가 읽을 수 있게 돌려준다(생성기가 해당 섹션만 재생성).
        return json(headers, 422, { ok: false, error: parsed.error, stage: parsed.detail.stage, issues: parsed.detail.issues });
      }
      return json(headers, 400, { ok: false, error: parsed.error });
    }

    const owned = await getOwnedProject(c.env, projectId, parsed.userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE workspace_projects
         SET dev_spec_json = ?, dev_spec_updated_at = ?
       WHERE id = ? AND user_key = ?`,
    )
      .bind(parsed.devSpecJson, now, projectId, parsed.userKey)
      .run();

    return json(headers, 200, { ok: true, updatedAt: now });
  });

  app.get("/workspace/projects/:id/dev-spec", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    const userKey = (c.req.query("userKey") ?? "").trim();
    if (!userKey) return json(headers, 400, { ok: false, error: "userKey_required" });

    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    const row = await c.env.DB.prepare(
      `SELECT dev_spec_json, dev_spec_updated_at FROM workspace_projects WHERE id = ? AND user_key = ?`,
    )
      .bind(projectId, userKey)
      .first<{ dev_spec_json: string | null; dev_spec_updated_at: string | null }>()
      .catch(() => null);
    if (!row || !row.dev_spec_json) return json(headers, 404, { ok: false, error: "no_dev_spec" });

    let devSpec: unknown;
    try {
      devSpec = JSON.parse(row.dev_spec_json);
    } catch {
      return json(headers, 404, { ok: false, error: "no_dev_spec" });
    }
    return json(headers, 200, { ok: true, devSpec, updatedAt: row.dev_spec_updated_at });
  });

  return app;
}

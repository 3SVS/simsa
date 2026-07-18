/**
 * routes/shares.ts — G11 읽기전용 공유 링크 (2026-07-18 backlog).
 *
 * 비개발자→개발자 전달이 파일 다운로드뿐이면 마찰이 크다. 공유 시점의
 * 스냅샷을 저장하고 추측 불가 링크로 열람하게 한다.
 *
 *  POST   /workspace/shares      — 스냅샷 생성 (userKey 필수, 크기 캡 60KB,
 *                                  시간당 20개 캡). 응답 { shareId }.
 *  GET    /workspace/shares/:id  — 공개 열람 (revoked/missing → 404 동일 응답
 *                                  — 존재 여부를 구분해주지 않는다).
 *  DELETE /workspace/shares/:id  — 소유자(userKey 일치)만 회수(revoked_at).
 *
 * 프라이버시 경계 = 스냅샷 모델: 살아있는 프로젝트가 아니라 "공유한 그 내용,
 * 그 시점"만 보인다. 이후 프로젝트가 바뀌어도 링크 내용은 안 바뀐다(명세).
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { corsHeaders, corsMiddleware } from "./cors.js";

const MAX_PAYLOAD_BYTES = 60_000;
const CREATES_PER_HOUR = 20;

/** Pure — 테스트 고정. 형식/크기만 검증(내용은 사용자의 것). */
export function sanitizeSharePayload(body: unknown): { userKey: string; projectId: string | null; payloadJson: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim().slice(0, 64) : "";
  if (!userKey) return null;
  const payload = b["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const title = (payload as Record<string, unknown>)["title"];
  if (typeof title !== "string" || title.trim().length === 0) return null;
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (payloadJson.length > MAX_PAYLOAD_BYTES) return null;
  return {
    userKey,
    projectId: typeof b["projectId"] === "string" ? b["projectId"].slice(0, 64) : null,
    payloadJson,
  };
}

function randomShareId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `shr_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function createShareRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  app.post("/workspace/shares", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const share = sanitizeSharePayload(body);
    if (!share) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_share" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const recent = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM workspace_shares WHERE user_key = ? AND created_at > ?`,
    )
      .bind(share.userKey, hourAgo)
      .first<{ n: number }>()
      .catch(() => null);
    if ((recent?.n ?? 0) >= CREATES_PER_HOUR) {
      return new Response(JSON.stringify({ ok: false, error: "rate_limited", message: "잠시 후 다시 시도해주세요. 공유 링크를 너무 많이 만들었어요." }), { status: 429, headers: { "content-type": "application/json", ...headers } });
    }

    const id = randomShareId();
    await c.env.DB.prepare(
      `INSERT INTO workspace_shares (id, user_key, project_id, payload_json, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
      .bind(id, share.userKey, share.projectId, share.payloadJson, new Date().toISOString())
      .run();

    return new Response(JSON.stringify({ ok: true, shareId: id }), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  app.get("/workspace/shares/:id", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(
      `SELECT payload_json, created_at, revoked_at FROM workspace_shares WHERE id = ?`,
    )
      .bind(id)
      .first<{ payload_json: string; created_at: string; revoked_at: string | null }>()
      .catch(() => null);
    if (!row || row.revoked_at) {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }
    return new Response(JSON.stringify({ ok: true, payload, createdAt: row.created_at }), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  app.delete("/workspace/shares/:id", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const id = c.req.param("id");
    const userKey = (c.req.query("userKey") ?? "").trim();
    if (!userKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const r = await c.env.DB.prepare(
      `UPDATE workspace_shares SET revoked_at = ? WHERE id = ? AND user_key = ? AND revoked_at IS NULL`,
    )
      .bind(new Date().toISOString(), id, userKey)
      .run()
      .catch(() => null);
    const changed = (r?.meta as { changes?: number } | undefined)?.changes ?? 0;
    if (changed === 0) {
      // 소유 아님/없음/이미 회수 — 구분해주지 않는다.
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  return app;
}

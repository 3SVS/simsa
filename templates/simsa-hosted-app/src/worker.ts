/**
 * Simsa 호스팅 템플릿 — Worker 진입점 (Hono).
 *
 * 규칙(빌드 잡·개발 AI가 지킬 것):
 *  - API는 전부 `/api/*` 아래. 그 밖의 경로는 정적 자산(React 앱)이 받는다(wrangler.toml [assets]).
 *  - DB는 `env.DB`(D1) 하나. 스키마는 migrations/ 에 번호순 SQL로 추가한다 — 코드에서 CREATE TABLE 금지.
 *  - 비밀·외부 결제·이메일 발송은 이 템플릿 범위 밖(D-5 [PILOT]). 지시서에 "이번 버전 제외"로 남긴다.
 *  - 모든 응답은 JSON. 오류는 `{ ok:false, error:"<snake_case>" }`.
 */
import { Hono } from "hono";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
};

type Item = { id: number; title: string; done: number; created_at: string };

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, app: "simsa-hosted-app", time: new Date().toISOString() }));

app.get("/api/items", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, title, done, created_at FROM items ORDER BY id DESC LIMIT 100").all<Item>();
  return c.json({ ok: true, items: rows.results ?? [] });
});

app.post("/api/items", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const title = typeof (body as { title?: unknown })?.title === "string" ? (body as { title: string }).title.trim() : "";
  if (!title || title.length > 200) return c.json({ ok: false, error: "title_required" }, 400);
  const r = await c.env.DB.prepare("INSERT INTO items (title) VALUES (?) RETURNING id, title, done, created_at").bind(title).first<Item>();
  return c.json({ ok: true, item: r }, 201);
});

app.patch("/api/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: "invalid_id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { done?: unknown };
  const done = body.done === true ? 1 : 0;
  const r = await c.env.DB.prepare("UPDATE items SET done = ? WHERE id = ? RETURNING id, title, done, created_at").bind(done, id).first<Item>();
  if (!r) return c.json({ ok: false, error: "not_found" }, 404);
  return c.json({ ok: true, item: r });
});

app.delete("/api/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: "invalid_id" }, 400);
  const r = await c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ ok: false, error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ ok: false, error: "not_found" }, 404) : c.env.ASSETS.fetch(c.req.raw)));

export default app;

/**
 * v0.16.17 — Sprint E5 (shadow scaffold): spawned-agent admin routes.
 *
 *   GET  /admin/spawned-agents[?status=shadow|promoted|archived]
 *   POST /admin/spawned-agents/:id/status  body { status }
 *   POST /admin/run-agent-spawner          (manual trigger)
 *
 * All require INTERNAL_CALLBACK_TOKEN. Weekly cron also calls
 * runAgentSpawner() directly.
 *
 * IMPORTANT: today's scope is detection + storage. Spawned agents
 * are NOT yet wired into the CLI's council factory — they sit in
 * 'shadow' status, visible to the operator. A follow-up sprint will
 * register promoted shadow agents with the runtime council.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  listSpawnedAgents,
  runAgentSpawner,
  setSpawnedAgentStatus,
} from "../agent-spawner.js";

const VALID_STATUSES = ["shadow", "promoted", "archived"] as const;

export function createSpawnedAgentsRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  function requireAdmin(c: { req: { header: (k: string) => string | undefined }; env: Env }):
    | { ok: true }
    | { ok: false; status: 401 | 503; body: { error: string } } {
    const expected = c.env.INTERNAL_CALLBACK_TOKEN;
    if (!expected) return { ok: false, status: 503, body: { error: "admin_disabled" } };
    const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || m[1] !== expected) return { ok: false, status: 401, body: { error: "unauthorized" } };
    return { ok: true };
  }

  app.get("/admin/spawned-agents", async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const statusParam = c.req.query("status");
    const status =
      statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as "shadow" | "promoted" | "archived")
        : null;
    const agents = await listSpawnedAgents(c.env, status);
    return c.json({ count: agents.length, agents });
  });

  app.post("/admin/spawned-agents/:id/status", async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null;
    const newStatus = body?.status;
    if (newStatus !== "shadow" && newStatus !== "promoted" && newStatus !== "archived") {
      return c.json(
        {
          error: "invalid_status",
          error_description: `status must be one of: ${VALID_STATUSES.join(", ")}`,
        },
        400,
      );
    }
    const ok = await setSpawnedAgentStatus(c.env, id, newStatus);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ id, status: newStatus });
  });

  app.post("/admin/run-agent-spawner", async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const result = await runAgentSpawner(c.env);
    return c.json(result);
  });

  return app;
}

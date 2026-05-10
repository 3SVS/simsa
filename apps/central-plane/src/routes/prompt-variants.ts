/**
 * v0.16.15 — Sprint E4 (scaffold): prompt-variant admin routes.
 *
 *   POST /admin/prompt-variants
 *     body { agent_id, variant_id, description?, system_prompt, is_baseline? }
 *     register a variant. Status starts 'inactive'.
 *
 *   GET  /admin/prompt-variants[?agent_id=…&status=…]
 *     list registered variants.
 *
 *   POST /admin/prompt-variants/:id/status
 *     body { status: 'inactive'|'shadow'|'promoted'|'archived' }
 *     manual status flip. Future automated promoter will hit the same
 *     setVariantStatus helper.
 *
 * All endpoints require INTERNAL_CALLBACK_TOKEN.
 *
 * NOTE: A/B routing (which variant a given /saas/review uses) is NOT
 * wired today. This scaffold ships the data model + CRUD so an
 * operator can populate variants in advance. Wiring lands in a
 * follow-up once Sprint D telemetry has accumulated enough signal.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  listPromptVariants,
  registerPromptVariant,
  setVariantStatus,
  type VariantStatus,
} from "../prompt-evolution.js";

const VALID_STATUSES = ["inactive", "shadow", "promoted", "archived"] as const;

export function createPromptVariantsRoutes(): Hono<{ Bindings: Env }> {
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

  app.post("/admin/prompt-variants", async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_request", error_description: "JSON body required" }, 400);
    }
    if (typeof body.agent_id !== "string" || body.agent_id.length === 0) {
      return c.json({ error: "invalid_request", error_description: "agent_id required" }, 400);
    }
    if (typeof body.variant_id !== "string" || body.variant_id.length === 0) {
      return c.json({ error: "invalid_request", error_description: "variant_id required" }, 400);
    }
    if (typeof body.system_prompt !== "string" || body.system_prompt.length === 0) {
      return c.json({ error: "invalid_request", error_description: "system_prompt required" }, 400);
    }
    try {
      const result = await registerPromptVariant(c.env, {
        agent_id: body.agent_id,
        variant_id: body.variant_id,
        system_prompt: body.system_prompt,
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(body.is_baseline === true ? { is_baseline: true } : {}),
      });
      return c.json(result, 201);
    } catch (err) {
      const msg = (err as Error).message ?? "insert_failed";
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "already_exists", error_description: "agent_id + variant_id pair exists" }, 409);
      }
      return c.json({ error: "insert_failed", error_description: msg.slice(0, 200) }, 500);
    }
  });

  app.get("/admin/prompt-variants", async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const agentId = c.req.query("agent_id");
    const statusParam = c.req.query("status");
    const status =
      statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as VariantStatus)
        : undefined;
    const variants = await listPromptVariants(c.env, {
      ...(agentId ? { agent_id: agentId } : {}),
      ...(status ? { status } : {}),
    });
    return c.json({ count: variants.length, variants });
  });

  app.post("/admin/prompt-variants/:id/status", async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null;
    const newStatus = body?.status;
    if (
      newStatus !== "inactive" &&
      newStatus !== "shadow" &&
      newStatus !== "promoted" &&
      newStatus !== "archived"
    ) {
      return c.json(
        {
          error: "invalid_status",
          error_description: `status must be one of: ${VALID_STATUSES.join(", ")}`,
        },
        400,
      );
    }
    const ok = await setVariantStatus(c.env, id, newStatus);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ id, status: newStatus });
  });

  return app;
}

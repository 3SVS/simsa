/**
 * Stage 209 / 221 — Better Auth LOCAL-ONLY route wiring (gated D1 runtime).
 *
 * Mounts `/api/auth/*` for the local Better Auth runtime, behind strict gates. It is
 * production-safe by construction — the default (and therefore production) path never
 * constructs a DB-backed handler:
 *
 *   - AUTH_ENABLED unset/!= "true"  → 503 { error: "auth_disabled" }  (the default).
 *   - AUTH_ENABLED === "true" but no local secret
 *                                   → 503 { error: "auth_not_configured" }.
 *   - AUTH_ENABLED === "true" + secret but no D1 binding (`env.DB`)
 *                                   → 503 { error: "auth_db_unavailable" }.
 *   - AUTH_ENABLED === "true" + secret + D1 binding
 *                                   → build a D1-backed Better Auth runtime via
 *                                     createBetterAuthRuntime(env) and delegate.
 *
 * It never reads back, echoes, or logs the secret/token/user/session/DB. It adds no
 * OAuth provider, no CORS, no dashboard UI. The runtime is constructed per-request
 * (lazy — no DB access until a handler runs) and ONLY when every gate is satisfied,
 * so this route stays dormant in production (AUTH_ENABLED is unset there).
 *
 * Local-only: the 0047 schema is applied to LOCAL D1 only. Production migration,
 * secret provisioning, cookie/CORS topology, and deploy remain SEPARATELY gated.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { resolveAuthRuntimeGate, createBetterAuthRuntime } from "../better-auth-spike.js";

export function createAuthSpikeRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.all("/api/auth/*", async (c) => {
    const gate = resolveAuthRuntimeGate(c.env);
    if (gate === "disabled") {
      return c.json({ error: "auth_disabled" }, 503);
    }
    if (gate === "not_configured") {
      // Flag on but no local secret. Never reveal more than this secret-free signal.
      return c.json({ error: "auth_not_configured" }, 503);
    }
    if (gate === "db_unavailable") {
      // Flag + secret present but no D1 binding — cannot back a handler. Safe explicit error.
      return c.json({ error: "auth_db_unavailable" }, 503);
    }
    const auth = createBetterAuthRuntime(c.env);
    if (!auth) {
      // Defensive: gate said ready but construction returned null. Stay safe, never 500-leak.
      return c.json({ error: "auth_not_configured" }, 503);
    }
    return auth.handler(c.req.raw);
  });

  return app;
}

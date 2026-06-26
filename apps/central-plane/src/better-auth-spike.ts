import { betterAuth } from "better-auth";
import type { Env } from "./env.js";
import { getAuthSpikeConfig } from "./auth-spike-config.js";
import { buildBetterAuthD1Database } from "./better-auth-d1.js";

/**
 * Stage 204 / 221 — Better Auth LOCAL-ONLY runtime (gated D1 wiring).
 *
 * Stage 204 proved `better-auth` resolves under the central-plane build. Stage 221
 * wires the local route to a D1-backed Better Auth handler (via the Stage 216 helper
 * `buildBetterAuthD1Database`) — but ONLY behind strict runtime gates, so the served
 * behaviour is unchanged by default and production stays dormant:
 *
 *   - NOT instantiated at import time (constructed per-request from `c.env`).
 *   - Built ONLY when AUTH_ENABLED === "true" AND a local secret is present AND a D1
 *     binding (`env.DB`) is available — every other case returns null / a safe gate.
 *   - The D1 binding only exists inside a request, and the dialect is lazy, so no DB
 *     access happens at construction.
 *   - Never activated in production: AUTH_ENABLED defaults off → the route returns
 *     503 auth_disabled before any runtime is constructed.
 *   - No OAuth provider, no production env, no secret/token logging.
 *
 * Production migration of the 0047 schema, cookie/CORS strategy, secret provisioning,
 * and deploy remain SEPARATELY gated (see docs/stage-220 decision memo). This file is
 * a LOCAL runtime only.
 */

/** Import proof: the better-auth factory resolved at build time. */
export function betterAuthAvailable(): boolean {
  return typeof betterAuth === "function";
}

/**
 * Why the auth runtime can / can't be constructed for a given env, mapped to the
 * safe 503 the route returns. Pure + deterministic; no secret/DB access.
 *
 *   - "disabled"       → AUTH_ENABLED is not "true" (the default / production path)
 *   - "not_configured" → enabled but no local secret present
 *   - "db_unavailable" → enabled + secret but no D1 binding on env
 *   - "ready"          → all gates satisfied; a DB-backed runtime can be built
 */
export type AuthRuntimeGate = "disabled" | "not_configured" | "db_unavailable" | "ready";

export function resolveAuthRuntimeGate(env: Partial<Env> | undefined): AuthRuntimeGate {
  const cfg = getAuthSpikeConfig(env);
  if (!cfg.enabled) return "disabled";
  if (!cfg.runtimeReady) return "not_configured"; // enabled but secret missing
  if (!(env ?? {}).DB) return "db_unavailable";
  return "ready";
}

/**
 * Construct the LOCAL D1-backed Better Auth runtime — ONLY when every gate passes
 * (enabled + secret + D1 binding). Returns null in every other case (default /
 * production / test path), so no secret and no D1 are required to compile or test.
 * Call this per-request with `c.env`; the dialect is lazy and touches the DB only
 * when a handler actually runs.
 */
export function createBetterAuthRuntime(env: Partial<Env> | undefined) {
  if (resolveAuthRuntimeGate(env) !== "ready") return null;
  const e = env ?? {};
  const db = e.DB;
  // Narrowing guard (also defensive — resolveAuthRuntimeGate already required it).
  if (!db) return null;
  const secret = e.BETTER_AUTH_SECRET as string;
  return betterAuth({
    secret,
    database: buildBetterAuthD1Database(db),
    emailAndPassword: { enabled: true },
  });
}

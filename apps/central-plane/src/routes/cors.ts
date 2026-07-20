/**
 * routes/cors.ts — Stage 91
 *
 * Single source of truth for browser-facing CORS on central-plane.
 *
 * Before Stage 91 the allowlist + corsHeaders were duplicated in
 * workspace.ts / workspace-github.ts / workspace-notifications.ts, and several
 * browser-facing route modules (experiment, benchmark, credits, admin-credits,
 * admin-stats) shipped NO CORS at all — so the dashboard's client-side calls to
 * those features were blocked from every origin. This module centralizes the
 * allowlist and provides a Hono middleware those modules can mount.
 *
 * Exact origins only — NO wildcards. The `.conclave-ai.dev` suffix is kept for
 * legacy dashboard subdomains.
 */
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

export const ALLOWED_ORIGINS = [
  "http://localhost:3002",
  "http://localhost:3000",
  "https://dashboard.conclave-ai.dev",
  "https://conclave-dashboard.vercel.app", // Vercel production dashboard (beta QA)
  "https://app.trysimsa.com", // Stage 89/91: Simsa dashboard app domain (exact origin)
  "https://trysimsa.com", // Stage 89/91: Simsa marketing domain (exact origin)
];

/**
 * Canonical browser-method allowlist — the SINGLE place Allow-Methods is
 * declared. 2026-07-20 P0: PUT was missing from every declaration in the
 * codebase, and workspace.ts's local "POST, OPTIONS" shadowed stricter routes'
 * preflights — so the browser blocked the G8 ext-sync PUT for EVERY real
 * user while node/curl probes (no CORS) stayed green, surfacing as a phantom
 * "서버 저장에 실패했어요" banner. Allowing a method a route doesn't implement
 * is harmless (404/405 + auth still apply); missing one silently kills the
 * feature in browsers only. Keep this complete.
 */
export const CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

/** Returns CORS headers for `origin`; disallowed origins fall back to the first
 * allowed origin (never echoed). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed: string =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-Simsa-User-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Hono middleware: answers preflight OPTIONS with 204 + CORS, and attaches CORS
 * headers to every other response (incl. error responses). Mount per
 * browser-facing module: `app.use("*", corsMiddleware)`.
 */
export const corsMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const origin = c.req.header("origin") ?? null;
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  await next();
  const headers = corsHeaders(origin);
  try {
    for (const [key, value] of Object.entries(headers)) {
      c.res.headers.set(key, value);
    }
  } catch {
    // `Response.redirect()` (OAuth start/callback/disconnect) returns a response
    // whose headers are IMMUTABLE — set() throws "Can't modify immutable
    // headers", which the global onError turned into a 500 for the whole
    // GitHub-connect flow. Rebuild the response with a mutable Headers copy so
    // the redirect (status + Location) survives and CORS still applies.
    const merged = new Headers(c.res.headers);
    for (const [key, value] of Object.entries(headers)) merged.set(key, value);
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers: merged });
  }
};

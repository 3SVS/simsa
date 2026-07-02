/**
 * Stage 232 — same-origin auth rewrite config (code readiness; NOT live until a dashboard deploy).
 *
 * Pure, server-side helpers used by `next.config.ts` to proxy first-party
 * `app.trysimsa.com/api/auth/*` to the central-plane Worker's `/api/auth/*`, so Better Auth
 * cookies are first-party once auth is later activated. This does NOT activate auth — the worker
 * route stays `503 auth_disabled` while `AUTH_ENABLED` is unset, and merging this changes no live
 * behaviour until a separately-approved dashboard (Vercel) deploy.
 *
 * Server-side only (read in next.config at build time); the origin is NOT exposed to the client.
 */

/** The documented production central-plane Worker origin (existing dashboard convention). */
export const DEFAULT_CENTRAL_PLANE_AUTH_ORIGIN = "https://conclave-ai.seunghunbae.workers.dev";

/**
 * Resolve the central-plane origin the auth rewrite proxies to. Fail-safe + never throws:
 * a missing / empty / non-absolute value falls back to the documented production origin; a
 * valid http(s) origin is used with any trailing slash(es) stripped.
 *
 * @param {Record<string, string | undefined> | undefined} env
 * @returns {string} an absolute origin with no trailing slash
 */
export function resolveCentralPlaneAuthOrigin(env) {
  const raw = env && typeof env.CENTRAL_PLANE_AUTH_ORIGIN === "string" ? env.CENTRAL_PLANE_AUTH_ORIGIN.trim() : "";
  if (/^https?:\/\/\S+$/.test(raw)) {
    return raw.replace(/\/+$/, "");
  }
  return DEFAULT_CENTRAL_PLANE_AUTH_ORIGIN;
}

/**
 * Build the Next.js rewrite list that proxies first-party `/api/auth/*` to the central-plane
 * Worker. Scoped to `/api/auth/:path*` only (does not shadow other dashboard routes).
 *
 * @param {string} origin absolute central-plane origin (no trailing slash)
 * @returns {{ source: string, destination: string }[]}
 */
export function buildAuthRewrites(origin) {
  return [
    {
      source: "/api/auth/:path*",
      destination: `${origin}/api/auth/:path*`,
    },
    // Membership bridge + claim flow ride the same first-party origin so the
    // Better Auth session cookie reaches the worker (same reasoning as /api/auth).
    {
      source: "/api/membership/:path*",
      destination: `${origin}/workspace/membership/:path*`,
    },
  ];
}

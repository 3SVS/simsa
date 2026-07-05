import { betterAuth } from "better-auth";
import type { Env } from "./env.js";
import { getAuthSpikeConfig } from "./auth-spike-config.js";
import { buildBetterAuthD1Database } from "./better-auth-d1.js";
import { resolveAuthTopologyConfig } from "./auth-topology.js";
import { emailVerificationRequired, buildVerificationEmail } from "./auth-email-verification.js";
import { sendWorkspaceEmail } from "./workspace/email-notify.js";

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
/**
 * GitHub social-login provider config — GitHub-first sign-in for the vibe-coder
 * audience. DORMANT until BOTH AUTH_GH_CLIENT_ID and AUTH_GH_CLIENT_SECRET are
 * set (fail-safe: partial config yields no provider). This is a SEPARATE GitHub
 * OAuth app from WORKSPACE_GH_*: GitHub requires the redirect host to exactly
 * match the registered callback host, and the login callback must live on the
 * DASHBOARD origin (first-party session cookie via the /api/auth proxy) while
 * the workspace repo-connect callback lives on the Worker origin — one app
 * cannot serve both hosts. Pure + exported so the gating is unit-testable.
 */
export function resolveGithubLoginProvider(
  env: Partial<Env> | undefined,
): { clientId: string; clientSecret: string } | null {
  const e = env ?? {};
  const clientId = typeof e.AUTH_GH_CLIENT_ID === "string" ? e.AUTH_GH_CLIENT_ID.trim() : "";
  const clientSecret = typeof e.AUTH_GH_CLIENT_SECRET === "string" ? e.AUTH_GH_CLIENT_SECRET.trim() : "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function createBetterAuthRuntime(env: Partial<Env> | undefined) {
  if (resolveAuthRuntimeGate(env) !== "ready") return null;
  const e = env ?? {};
  const db = e.DB;
  // Narrowing guard (also defensive — resolveAuthRuntimeGate already required it).
  if (!db) return null;
  const secret = e.BETTER_AUTH_SECRET as string;
  // Optional topology config (Stage 227): spread ONLY when set, so an unset env leaves the
  // options identical to before (origin derived from the request). Never activates auth.
  const topology = resolveAuthTopologyConfig(e);
  const github = resolveGithubLoginProvider(e);
  // D2 soft-auth: send a verification email on sign-up ONLY when Resend is
  // configured (else we couldn't deliver it). `emailAndPassword` deliberately
  // does NOT set requireEmailVerification — sign-in is never blocked; the
  // verified flag gates the workspace claim instead (see workspace-claim.ts).
  const verify = emailVerificationRequired(e);
  return betterAuth({
    secret,
    database: buildBetterAuthD1Database(db),
    emailAndPassword: { enabled: true },
    ...(verify
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
              const { subject, text } = buildVerificationEmail(url);
              // sendWorkspaceEmail never throws; swallow its result so a mail
              // hiccup never breaks sign-up.
              await sendWorkspaceEmail(e as Env, { to: user.email, subject, text });
            },
          },
        }
      : {}),
    ...(github ? { socialProviders: { github } } : {}),
    ...(topology.baseURL ? { baseURL: topology.baseURL } : {}),
    ...(topology.trustedOrigins ? { trustedOrigins: topology.trustedOrigins } : {}),
  });
}

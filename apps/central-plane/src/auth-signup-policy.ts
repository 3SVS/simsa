import type { Env } from "./env.js";

/**
 * Stage 241 — auth sign-up exposure guard.
 *
 * The Better Auth route is gated by AUTH_ENABLED, but once enabled the public
 * `POST /api/auth/sign-up/*` endpoint is directly reachable (Stage 240 exposure risk).
 * This guard adds an INDEPENDENT, env-controlled sign-up policy so production can disable or
 * restrict public sign-up WITHOUT disabling sign-in/session for existing users.
 *
 * Fail-closed: an unset / unknown value resolves to "disabled". So when this code is deployed,
 * public sign-up is OFF by default until `AUTH_SIGNUP_MODE=open` is explicitly set. Sign-in,
 * session, and sign-out are NEVER affected by this policy.
 *
 * This is code-readiness only — it changes no production behaviour until a separately-approved
 * central-plane deploy.
 */
export type SignupMode = "open" | "invite_only" | "disabled";

/** Pure, deterministic, never throws. Default (unset/unknown) = "disabled" (fail-closed). */
export function resolveSignupMode(env: Partial<Env> | undefined): SignupMode {
  const raw = typeof (env ?? {}).AUTH_SIGNUP_MODE === "string" ? (env ?? {}).AUTH_SIGNUP_MODE!.trim().toLowerCase() : "";
  if (raw === "open") return "open";
  if (raw === "invite_only") return "invite_only";
  return "disabled";
}

/**
 * True only for Better Auth sign-up endpoints (`/api/auth/sign-up`, `/api/auth/sign-up/email`,
 * …). Sign-in (`/api/auth/sign-in/*`), session, and sign-out are NOT sign-up paths.
 */
export function isSignupPath(pathname: string): boolean {
  if (typeof pathname !== "string") return false;
  const p = pathname.split("?")[0]!.replace(/\/+$/, "");
  return p === "/api/auth/sign-up" || p.startsWith("/api/auth/sign-up/");
}

/**
 * Whether a public sign-up request should be BLOCKED. Only "open" permits sign-up; "disabled"
 * and (for now) "invite_only" block it — invite-code enforcement is a later stage, so until then
 * invite_only blocks open public sign-up rather than silently allowing it.
 */
export function isSignupBlocked(mode: SignupMode): boolean {
  return mode !== "open";
}

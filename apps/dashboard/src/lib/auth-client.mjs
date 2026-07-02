/**
 * auth-client.mjs
 *
 * Stage 241 — lightweight, dependency-free auth client for the dashboard.
 *
 * The dashboard proxies `/api/auth/*` to the central-plane Better Auth route (same-origin
 * rewrite), so we just `fetch` the documented Better Auth endpoints rather than adding the
 * `better-auth` package to the dashboard:
 *   - GET  /api/auth/get-session  → returns `null` (signed out) or `{ user, session }`
 *   - POST /api/auth/sign-out     → clears the session
 *
 * Controlled preview only: this provides session display + sign-out for internal/controlled use.
 * It does NOT add a public sign-up flow and does NOT gate any dashboard route. `fetch` is injected
 * so the pure logic is testable; the default uses the browser `fetch` against same-origin paths.
 */

const SESSION_PATH = "/api/auth/get-session";
const SIGN_OUT_PATH = "/api/auth/sign-out";

/**
 * Fetch the current auth session (same-origin, credentialed). Returns the parsed Better Auth
 * session object, or null when signed out / on any non-2xx / parse error. Never throws.
 * @param {typeof fetch} [fetchImpl]
 */
export async function getAuthSession(fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return null;
  try {
    const res = await f(SESSION_PATH, { method: "GET", credentials: "include", headers: { accept: "application/json" } });
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    // Better Auth returns null when signed out, or { user, session } when signed in.
    return data && typeof data === "object" && data.user ? data : null;
  } catch {
    return null;
  }
}

/**
 * Sign the current session out (same-origin, credentialed). Returns true on a 2xx response.
 * Never throws.
 * @param {typeof fetch} [fetchImpl]
 */
export async function signOutAuth(fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return false;
  try {
    const res = await f(SIGN_OUT_PATH, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

const MEMBERSHIP_ME_PATH = "/api/membership/me";
const MEMBERSHIP_CLAIM_PATH = "/api/membership/claim";

/**
 * Fetch the auth-user ↔ workspace membership bridge (same-origin, credentialed).
 * Sends the legacy userKey via the `x-simsa-user-key` header (kept out of URLs).
 * Returns the parsed bridge response or null on any failure. Never throws.
 * @param {string} userKey
 * @param {typeof fetch} [fetchImpl]
 */
export async function getMembership(userKey, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return null;
  try {
    const res = await f(MEMBERSHIP_ME_PATH, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json", ...(userKey ? { "x-simsa-user-key": userKey } : {}) },
    });
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && typeof data === "object" && data.ok === true ? data : null;
  } catch {
    return null;
  }
}

/**
 * Claim this browser's legacy userKey data into the signed-in account
 * (creates/reuses the personal workspace and assigns unclaimed projects).
 * Returns a discriminated result; never throws.
 * @param {string} userKey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, workspaceId: string, alreadyClaimed: boolean, claimedProjects: number } | { ok: false, error: string }>}
 */
export async function claimWorkspace(userKey, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "no_fetch" };
  try {
    const res = await f(MEMBERSHIP_CLAIM_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(userKey ? { "x-simsa-user-key": userKey } : {}) },
      body: JSON.stringify({ userKey }),
    });
    const data = res ? await res.json().catch(() => null) : null;
    if (res && res.ok && data && data.ok === true) {
      return {
        ok: true,
        workspaceId: String(data.workspaceId ?? ""),
        alreadyClaimed: data.alreadyClaimed === true,
        claimedProjects: Number.isFinite(data.claimedProjects) ? Number(data.claimedProjects) : 0,
      };
    }
    return { ok: false, error: data && typeof data.error === "string" ? data.error : `http_${res ? res.status : 0}` };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * Resolve a UI auth status from a session fetch result. Pure + deterministic.
 * @param {{ loading?: boolean, error?: boolean, session?: any }} input
 * @returns {{ status: "loading" | "error" | "signed_in" | "signed_out", email: string | null }}
 */
export function resolveAuthStatus(input) {
  const { loading, error, session } = input ?? {};
  if (loading) return { status: "loading", email: null };
  if (error) return { status: "error", email: null };
  const email = session && session.user && typeof session.user.email === "string" ? session.user.email : null;
  return email ? { status: "signed_in", email } : { status: "signed_out", email: null };
}

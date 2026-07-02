/**
 * Stage 254 — auth-user ↔ workspace bridge (READ-ONLY).
 *
 * Pure response builder + input parsing for `GET /workspace/membership/me`. This bridge only
 * REPORTS the caller's auth/userKey/workspace readiness — it never creates a workspace, never
 * creates a member, never claims or updates projects, and never migrates legacy userKey data.
 *
 * Privacy/identity rules baked in here:
 *   - `userKey` is the LEGACY anonymous scope, NEVER an authenticated identity.
 *   - Only safe, non-sensitive fields are returned (id/name/role + email). No tokens/secrets.
 *   - `canCreatePersonalWorkspace` / `canClaimProjects` are computed capabilities now that the
 *     claim flow exists (routes/workspace-claim.ts): both require a live session; claiming also
 *     requires a legacy userKey to claim. Signed-out callers always get false.
 */

/** A workspace membership row, reduced to safe display fields (no tokens). */
export type BridgeWorkspace = { id: string; name: string; role: string };

export type MembershipBridgeInput = {
  authUserId: string | null;
  email: string | null;
  userKey: string | null;
  /** Already-read membership rows (safe fields only). Ignored unless authenticated. */
  workspaces: BridgeWorkspace[];
  /** Count of legacy projects for the provided userKey (read-only). */
  legacyProjectCount: number;
};

export type MembershipBridgeResponse = {
  ok: true;
  authenticated: boolean;
  authUserId: string | null;
  email: string | null;
  userKey: string | null;
  hasPersonalWorkspace: boolean;
  workspaces: BridgeWorkspace[];
  legacyProjectCount: number;
  bridgeMode: "read_only";
  canCreatePersonalWorkspace: boolean;
  canClaimProjects: boolean;
};

/**
 * Parse the caller's legacy userKey from the request. Header `x-simsa-user-key` is preferred
 * (keeps the key out of URLs/logs); the `?userKey=` query param is accepted for parity with the
 * existing workspace GET convention. Returns null for missing/blank/implausible values — the
 * endpoint stays read-only and simply omits the legacy count rather than failing.
 */
export function parseUserKey(headerValue?: string | null, queryValue?: string | null): string | null {
  const raw = (typeof headerValue === "string" && headerValue.trim()) || (typeof queryValue === "string" && queryValue.trim()) || "";
  if (!raw) return null;
  // Plausibility guard only (NOT authentication): non-empty, single token, bounded length.
  if (raw.length > 200 || /\s/.test(raw)) return null;
  return raw;
}

/**
 * Build the read-only membership bridge response. Deterministic; never throws.
 * `workspaces` is only surfaced when authenticated; `hasPersonalWorkspace` derives from it.
 */
export function buildMembershipResponse(input: MembershipBridgeInput): MembershipBridgeResponse {
  const authenticated = typeof input.authUserId === "string" && input.authUserId.length > 0;
  const workspaces = authenticated ? input.workspaces ?? [] : [];
  return {
    ok: true,
    authenticated,
    authUserId: authenticated ? input.authUserId : null,
    email: authenticated && typeof input.email === "string" ? input.email : null,
    userKey: typeof input.userKey === "string" ? input.userKey : null,
    hasPersonalWorkspace: authenticated && workspaces.length > 0,
    workspaces,
    legacyProjectCount: Number.isFinite(input.legacyProjectCount) && input.legacyProjectCount > 0 ? Math.floor(input.legacyProjectCount) : 0,
    bridgeMode: "read_only",
    canCreatePersonalWorkspace: authenticated,
    canClaimProjects: authenticated && typeof input.userKey === "string" && input.userKey.length > 0,
  };
}

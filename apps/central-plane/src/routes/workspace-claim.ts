/**
 * workspace-claim.ts — the explicit claim flow the 0048 membership foundation
 * (Stage 249) and the read-only bridge (Stage 254) deliberately left out.
 *
 * `POST /workspace/membership/claim` binds the caller's LEGACY anonymous
 * userKey scope to their authenticated Better Auth account:
 *
 *   1. requires a live Better Auth session (401 otherwise — covers the
 *      auth-disabled production default, where no session can exist),
 *   2. requires a plausible legacy userKey (header `x-simsa-user-key`
 *      preferred, body.userKey accepted),
 *   3. creates the personal workspace for that userKey if it does not exist
 *      (workspaces.legacy_user_key = userKey, creator = session user),
 *   4. ensures the owner membership row,
 *   5. assigns workspace_id to every legacy project of that userKey that has
 *      none yet (never re-assigns projects already claimed elsewhere).
 *
 * A userKey can belong to exactly ONE account: claiming a key whose workspace
 * was created by a different auth user is a 409 `claimed_by_other` with no
 * information about the other account. Re-claiming your own key is idempotent.
 *
 * This route intentionally lives OUTSIDE routes/workspace-membership.ts —
 * that file carries a tested read-only source guarantee (no INSERT/UPDATE).
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { createBetterAuthRuntime } from "../better-auth-spike.js";
import { parseUserKey } from "../workspace-membership-bridge.js";

export type SessionUser = { id: string };

export type ResolveSession = (
  env: Partial<Env> | undefined,
  headers: Headers,
) => Promise<SessionUser | null>;

/** Default session resolution via the gated Better Auth runtime. Fail-safe → null. */
export const resolveBetterAuthSession: ResolveSession = async (env, headers) => {
  try {
    const auth = createBetterAuthRuntime(env);
    if (!auth) return null;
    const session = await auth.api.getSession({ headers });
    const user = session?.user;
    if (user && typeof user.id === "string" && user.id) return { id: user.id };
    return null;
  } catch {
    return null;
  }
};

function newWorkspaceId(): string {
  // High-entropy id (unlike the legacy wsp_ project ids): 128-bit UUID.
  return `ws_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createWorkspaceClaimRoutes(deps?: {
  resolveSession?: ResolveSession;
}): Hono<{ Bindings: Env }> {
  const resolveSession = deps?.resolveSession ?? resolveBetterAuthSession;
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", corsMiddleware);

  app.post("/workspace/membership/claim", async (c) => {
    const user = await resolveSession(c.env, c.req.raw.headers);
    if (!user) return c.json({ ok: false, error: "unauthenticated" }, 401);

    let bodyUserKey: string | null = null;
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      bodyUserKey = typeof body["userKey"] === "string" ? body["userKey"] : null;
    } catch {
      bodyUserKey = null; // empty body is fine when the header carries the key
    }
    const userKey = parseUserKey(c.req.header("x-simsa-user-key"), bodyUserKey);
    if (!userKey) return c.json({ ok: false, error: "missing_user_key" }, 400);

    const db = c.env?.DB;
    if (!db) return c.json({ ok: false, error: "db_unavailable" }, 503);

    try {
      const existing = await db
        .prepare('SELECT "id" AS id, "created_by_auth_user_id" AS creator FROM workspaces WHERE legacy_user_key = ?')
        .bind(userKey)
        .first<{ id?: string; creator?: string | null }>();

      const now = new Date().toISOString();

      if (existing?.id) {
        if (existing.creator !== user.id) {
          return c.json({ ok: false, error: "claimed_by_other" }, 409);
        }
        // Idempotent re-claim: ensure membership + pick up any projects the
        // userKey has produced since the first claim.
        const results = await db.batch([
          db
            .prepare(
              "INSERT OR IGNORE INTO workspace_members (workspace_id, auth_user_id, role, status, joined_at, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?, ?)",
            )
            .bind(existing.id, user.id, now, now, now),
          db
            .prepare("UPDATE workspace_projects SET workspace_id = ? WHERE user_key = ? AND workspace_id IS NULL")
            .bind(existing.id, userKey),
        ]);
        const claimedProjects = Number(results?.[1]?.meta?.changes ?? 0);
        return c.json({ ok: true, workspaceId: existing.id, alreadyClaimed: true, claimedProjects });
      }

      const wsId = newWorkspaceId();
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO workspaces (id, name, type, created_by_auth_user_id, legacy_user_key, created_at, updated_at) VALUES (?, 'Personal', 'personal', ?, ?, ?, ?)",
          )
          .bind(wsId, user.id, userKey, now, now),
        db
          .prepare(
            "INSERT OR IGNORE INTO workspace_members (workspace_id, auth_user_id, role, status, joined_at, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?, ?)",
          )
          .bind(wsId, user.id, now, now, now),
        db
          .prepare("UPDATE workspace_projects SET workspace_id = ? WHERE user_key = ? AND workspace_id IS NULL")
          .bind(wsId, userKey),
      ]);
      const claimedProjects = Number(results?.[2]?.meta?.changes ?? 0);
      return c.json({ ok: true, workspaceId: wsId, alreadyClaimed: false, claimedProjects });
    } catch (err) {
      console.error("[workspace-claim] claim failed", err instanceof Error ? err.message : String(err));
      return c.json({ ok: false, error: "claim_failed" }, 500);
    }
  });

  return app;
}

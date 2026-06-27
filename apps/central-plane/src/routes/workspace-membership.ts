/**
 * workspace-membership.ts — Stage 254 (auth-user ↔ workspace bridge, READ-ONLY).
 *
 * `GET /workspace/membership/me` reports the caller's auth/userKey/workspace readiness for the
 * 0048 membership schema. It is the FIRST endpoint to read the Better Auth session server-side
 * (the rest of the workspace API is anonymous-userKey-scoped). It is strictly READ-ONLY:
 *   - no INSERT into workspaces / workspace_members,
 *   - no UPDATE of workspace_projects (no claim, no workspace_id assignment),
 *   - no legacy userKey migration, no audit rows.
 *
 * userKey is the legacy anonymous scope, never an authenticated identity. Personal-workspace
 * creation and project claim are deliberately disabled here (canCreatePersonalWorkspace /
 * canClaimProjects = false) and land in later, separately-approved stages.
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { createBetterAuthRuntime } from "../better-auth-spike.js";
import {
  buildMembershipResponse,
  parseUserKey,
  type BridgeWorkspace,
} from "../workspace-membership-bridge.js";

export function createWorkspaceMembershipRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // Stage 91: browser-facing CORS (preflight + headers on every response).
  app.use("*", corsMiddleware);

  app.get("/workspace/membership/me", async (c) => {
    // 1) Read the Better Auth session server-side (read-only). Fail safe → unauthenticated.
    let authUserId: string | null = null;
    let email: string | null = null;
    try {
      const auth = createBetterAuthRuntime(c.env);
      if (auth) {
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        const user = session?.user;
        if (user && typeof user.id === "string" && user.id) {
          authUserId = user.id;
          email = typeof user.email === "string" ? user.email : null;
        }
      }
    } catch {
      authUserId = null;
      email = null;
    }

    // 2) Legacy userKey: prefer the header (keeps it out of URLs), else ?userKey= (existing convention).
    const userKey = parseUserKey(c.req.header("x-simsa-user-key"), c.req.query("userKey"));

    // 3) READ-ONLY lookups. No writes anywhere.
    let workspaces: BridgeWorkspace[] = [];
    let legacyProjectCount = 0;
    const db = c.env?.DB;

    if (authUserId && db) {
      try {
        const res = await db
          .prepare(
            'SELECT w."id" AS id, w."name" AS name, m."role" AS role ' +
              'FROM workspace_members m JOIN workspaces w ON w."id" = m."workspace_id" ' +
              'WHERE m."auth_user_id" = ? AND m."status" = ?',
          )
          .bind(authUserId, "active")
          .all();
        workspaces = (res?.results ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          name: String(r.name),
          role: String(r.role),
        }));
      } catch {
        workspaces = [];
      }
    }

    if (userKey && db) {
      try {
        const row = await db
          .prepare('SELECT COUNT(*) AS n FROM workspace_projects WHERE user_key = ?')
          .bind(userKey)
          .first<{ n?: number }>();
        const n = Number(row?.n ?? 0);
        legacyProjectCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      } catch {
        legacyProjectCount = 0;
      }
    }

    return c.json(buildMembershipResponse({ authUserId, email, userKey, workspaces, legacyProjectCount }));
  });

  return app;
}

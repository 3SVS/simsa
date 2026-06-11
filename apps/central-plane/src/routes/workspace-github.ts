/**
 * workspace-github.ts
 *
 * GitHub OAuth + repo connection routes for Workspace.
 *
 * GET  /workspace/github/oauth/start        — redirect to GitHub auth
 * GET  /workspace/github/oauth/callback     — exchange code, save connection, redirect to dashboard
 * GET  /workspace/github/status             — connection status for a userKey
 * GET  /workspace/github/repos              — list public repos for connected user
 * POST /workspace/projects/:id/repo         — link a repo to a project
 * GET  /workspace/projects/:id/repo         — get linked repo for a project
 *
 * Security:
 *   - state CSRF token is validated on callback
 *   - access tokens are AES-256-GCM encrypted (CONCLAVE_TOKEN_KEK) before D1 storage
 *   - GitHub tokens are never sent to the dashboard
 *   - client secret only used server-side in callback
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { encryptToken, decryptToken } from "../crypto.js";
import {
  saveOAuthState, getOAuthState, markStateUsed,
  upsertGitHubConnection, getGitHubConnectionByUserKey,
  upsertProjectRepo, getProjectRepo,
} from "../workspace/github-db.js";
import {
  generateState, buildAuthUrl, exchangeCode,
  fetchGitHubUser, fetchGitHubRepos,
  isAllowedReturnTo, appendGitHubConnected,
} from "../workspace/github-oauth.js";

// ─── CORS helpers (shared with workspace.ts) ──────────────────────────────────

const ALLOWED_ORIGINS = [
  "http://localhost:3002",
  "http://localhost:3000",
  "https://dashboard.conclave-ai.dev",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

const DEFAULT_DASHBOARD_URL = "https://dashboard.conclave-ai.dev";

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createWorkspaceGitHubRoutes(
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // Preflight
  app.options("/workspace/github/*", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });
  app.options("/workspace/projects/:id/repo", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  // ── GET /workspace/github/oauth/start ──────────────────────────────────────
  app.get("/workspace/github/oauth/start", async (c) => {
    const clientId = c.env.WORKSPACE_GH_CLIENT_ID;
    if (!clientId || clientId.startsWith("REPLACE_WITH_")) {
      return json({ error: "GitHub OAuth not configured. Register a GitHub OAuth App and set WORKSPACE_GH_CLIENT_ID." }, 503);
    }

    const userKey = c.req.query("userKey") ?? "";
    const returnTo = c.req.query("returnTo") ?? "/";

    if (!isAllowedReturnTo(returnTo)) {
      return json({ error: "returnTo is not an allowed dashboard origin" }, 400);
    }

    const state = generateState();
    await saveOAuthState(c.env, { state, userKey, returnTo });

    const baseUrl = c.env.PUBLIC_BASE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";
    const redirectUri = c.env.WORKSPACE_GH_REDIRECT_URI ?? `${baseUrl}/workspace/github/oauth/callback`;
    const scopes = c.env.WORKSPACE_GH_SCOPES ?? "read:user public_repo";
    const authUrl = buildAuthUrl({ clientId, redirectUri, scopes, state });

    return Response.redirect(authUrl, 302);
  });

  // ── GET /workspace/github/oauth/callback ───────────────────────────────────
  app.get("/workspace/github/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    const dashboardUrl = c.env.WORKSPACE_GH_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL;

    if (error) {
      return Response.redirect(`${dashboardUrl}?github=denied`, 302);
    }

    if (!code || !state) {
      return json({ error: "missing code or state" }, 400);
    }

    // Verify state
    const storedState = await getOAuthState(c.env, state);
    if (!storedState || storedState.used) {
      return json({ error: "invalid or expired state" }, 400);
    }
    await markStateUsed(c.env, state);

    const clientId = c.env.WORKSPACE_GH_CLIENT_ID;
    const clientSecret = c.env.WORKSPACE_GH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return json({ error: "GitHub OAuth not configured on server" }, 503);
    }

    const baseUrl = c.env.PUBLIC_BASE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";
    const redirectUri = c.env.WORKSPACE_GH_REDIRECT_URI ?? `${baseUrl}/workspace/github/oauth/callback`;

    // Exchange code for token
    let tokenData: { access_token: string; scope: string; token_type: string };
    try {
      tokenData = await exchangeCode({ code, clientId, clientSecret, redirectUri }, fetchImpl);
    } catch (err) {
      console.error("[workspace/github/callback] token exchange failed:", err);
      return json({ error: `token exchange failed: ${(err as Error).message}` }, 502);
    }

    // Fetch GitHub user
    let ghUser: { id: number; login: string; name?: string; avatar_url?: string };
    try {
      ghUser = await fetchGitHubUser(tokenData.access_token, fetchImpl);
    } catch (err) {
      console.error("[workspace/github/callback] user fetch failed:", err);
      return json({ error: `GitHub user fetch failed: ${(err as Error).message}` }, 502);
    }

    // Encrypt access token (requires CONCLAVE_TOKEN_KEK)
    let tokenEnc = "";
    const kek = c.env.CONCLAVE_TOKEN_KEK;
    if (kek) {
      try {
        tokenEnc = await encryptToken(tokenData.access_token, kek);
      } catch (err) {
        console.warn("[workspace/github/callback] token encryption failed:", err);
        // Continue without token — repo list will return 503 until KEK is set
      }
    } else {
      console.warn("[workspace/github/callback] CONCLAVE_TOKEN_KEK not set — token not persisted");
    }

    await upsertGitHubConnection(c.env, {
      userKey: storedState.userKey,
      githubUserId: String(ghUser.id),
      githubLogin: ghUser.login,
      githubName: ghUser.name,
      avatarUrl: ghUser.avatar_url,
      accessTokenEnc: tokenEnc,
      scopes: tokenData.scope,
    });

    const returnTo = storedState.returnTo || "/";
    const dest = appendGitHubConnected(returnTo, dashboardUrl);
    return Response.redirect(dest, 302);
  });

  // ── GET /workspace/github/status?userKey=... ──────────────────────────────
  app.get("/workspace/github/status", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const userKey = c.req.query("userKey") ?? "";

    if (!userKey) {
      return json({ ok: true, connected: false }, 200, origin);
    }

    try {
      const conn = await getGitHubConnectionByUserKey(c.env, userKey);
      if (!conn) return json({ ok: true, connected: false }, 200, origin);

      return json({
        ok: true,
        connected: true,
        user: { login: conn.githubLogin, name: conn.githubName, avatarUrl: conn.avatarUrl },
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/status] error:", err);
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  // ── GET /workspace/github/repos?userKey=... ───────────────────────────────
  app.get("/workspace/github/repos", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const userKey = c.req.query("userKey") ?? "";

    if (!userKey) {
      return json({ ok: false, error: "userKey_required" }, 400, origin);
    }

    let conn;
    try {
      conn = await getGitHubConnectionByUserKey(c.env, userKey);
    } catch (err) {
      return json({ ok: false, error: "db_error" }, 500, origin);
    }

    if (!conn || !conn.accessTokenEnc) {
      return json({ ok: false, error: "not_connected" }, 401, origin);
    }

    const kek = c.env.CONCLAVE_TOKEN_KEK;
    if (!kek) {
      return json({ ok: false, error: "token_unavailable — CONCLAVE_TOKEN_KEK not set" }, 503, origin);
    }

    let token: string;
    try {
      token = await decryptToken(conn.accessTokenEnc, kek);
    } catch {
      return json({ ok: false, error: "token_decrypt_failed" }, 503, origin);
    }

    let repos: Array<{ id: number; full_name: string; owner: { login: string }; name: string; private: boolean; default_branch: string; html_url: string }>;
    try {
      repos = await fetchGitHubRepos(token, fetchImpl);
    } catch (err) {
      return json({ ok: false, error: `github_api_failed: ${(err as Error).message}` }, 502, origin);
    }

    return json({
      ok: true,
      repos: repos.map((r) => ({
        id: String(r.id),
        fullName: r.full_name,
        owner: r.owner.login,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
        htmlUrl: r.html_url,
      })),
    }, 200, origin);
  });

  // ── POST /workspace/projects/:id/repo ─────────────────────────────────────
  app.post("/workspace/projects/:id/repo", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }

    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    const repo = b["repo"] as Record<string, unknown> | undefined;

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    if (!repo || typeof repo["fullName"] !== "string") {
      return json({ ok: false, error: "repo.fullName_required" }, 400, origin);
    }

    // Verify GitHub connection exists
    let conn;
    try {
      conn = await getGitHubConnectionByUserKey(c.env, userKey);
    } catch {
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
    if (!conn) return json({ ok: false, error: "not_connected — connect GitHub first" }, 401, origin);

    try {
      const linked = await upsertProjectRepo(c.env, {
        projectId,
        userKey,
        githubConnectionId: conn.id,
        repoId: typeof repo["id"] === "string" ? repo["id"] : String(repo["id"] ?? ""),
        repoFullName: String(repo["fullName"]),
        repoOwner: typeof repo["owner"] === "string" ? repo["owner"] : String(repo["owner"] ?? ""),
        repoName: typeof repo["name"] === "string" ? repo["name"] : String(repo["name"] ?? ""),
        defaultBranch: typeof repo["defaultBranch"] === "string" ? repo["defaultBranch"] : undefined,
        private: Boolean(repo["private"]),
        htmlUrl: typeof repo["htmlUrl"] === "string" ? repo["htmlUrl"] : undefined,
      });

      return json({
        ok: true,
        repo: {
          id: linked.repoId,
          fullName: linked.repoFullName,
          owner: linked.repoOwner,
          name: linked.repoName,
          defaultBranch: linked.defaultBranch,
          private: linked.private,
          htmlUrl: linked.htmlUrl,
        },
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/projects/repo] save failed:", err);
      return json({ ok: false, error: "save_failed" }, 500, origin);
    }
  });

  // ── GET /workspace/projects/:id/repo ──────────────────────────────────────
  app.get("/workspace/projects/:id/repo", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");

    try {
      const repo = await getProjectRepo(c.env, projectId);
      if (!repo) return json({ ok: true, repo: null }, 200, origin);

      return json({
        ok: true,
        repo: {
          id: repo.repoId,
          fullName: repo.repoFullName,
          owner: repo.repoOwner,
          name: repo.repoName,
          defaultBranch: repo.defaultBranch,
          private: repo.private,
          htmlUrl: repo.htmlUrl,
        },
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/projects/repo] fetch failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  return app;
}

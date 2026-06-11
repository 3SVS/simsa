/**
 * workspace/github-db.ts
 *
 * D1 helpers for workspace GitHub OAuth connections and project-repo links.
 * Separate from the existing GitHub App (gh_app_installations) D1 tables.
 */
import type { Env } from "../env.js";

function randId(prefix: string): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${r}`;
}

// ─── OAuth state ──────────────────────────────────────────────────────────────

export type DbOAuthState = {
  state: string;
  userKey: string;
  returnTo: string;
  createdAt: string;
  used: boolean;
};

/** State TTL: reject states older than 15 minutes. */
const STATE_TTL_MS = 15 * 60 * 1000;

export async function saveOAuthState(
  env: Env,
  input: { state: string; userKey: string; returnTo: string },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO workspace_oauth_states (state, user_key, return_to, created_at, used)
     VALUES (?, ?, ?, ?, 0)`,
  )
    .bind(input.state, input.userKey, input.returnTo, now)
    .run();
}

export async function getOAuthState(env: Env, state: string): Promise<DbOAuthState | null> {
  const row = await env.DB.prepare(
    `SELECT state, user_key, return_to, created_at, used FROM workspace_oauth_states WHERE state = ?`,
  )
    .bind(state)
    .first<{ state: string; user_key: string; return_to: string; created_at: string; used: number }>();

  if (!row) return null;
  // Reject expired states
  if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) return null;
  return {
    state: row.state,
    userKey: row.user_key,
    returnTo: row.return_to,
    createdAt: row.created_at,
    used: row.used === 1,
  };
}

export async function markStateUsed(env: Env, state: string): Promise<void> {
  await env.DB.prepare(`UPDATE workspace_oauth_states SET used = 1 WHERE state = ?`).bind(state).run();
}

// ─── GitHub connections ───────────────────────────────────────────────────────

export type DbGitHubConnection = {
  id: string;
  userKey: string;
  githubUserId: string;
  githubLogin: string;
  githubName?: string;
  avatarUrl?: string;
  accessTokenEnc: string;
  scopes?: string;
  createdAt: string;
  updatedAt: string;
};

export async function upsertGitHubConnection(
  env: Env,
  input: {
    userKey: string;
    githubUserId: string;
    githubLogin: string;
    githubName?: string;
    avatarUrl?: string;
    accessTokenEnc: string;
    scopes?: string;
  },
): Promise<DbGitHubConnection> {
  const now = new Date().toISOString();
  // Try to find existing connection for this GitHub user
  const existing = await env.DB.prepare(
    `SELECT id, created_at FROM workspace_github_connections WHERE github_user_id = ?`,
  ).bind(input.githubUserId).first<{ id: string; created_at: string }>();

  const id = existing?.id ?? randId("wgc");
  const createdAt = existing?.created_at ?? now;

  await env.DB.prepare(
    `INSERT INTO workspace_github_connections
       (id, user_key, github_user_id, github_login, github_name, avatar_url,
        access_token_enc, scopes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (github_user_id) DO UPDATE SET
       user_key = excluded.user_key,
       github_login = excluded.github_login,
       github_name = excluded.github_name,
       avatar_url = excluded.avatar_url,
       access_token_enc = excluded.access_token_enc,
       scopes = excluded.scopes,
       updated_at = excluded.updated_at`,
  )
    .bind(
      id, input.userKey, input.githubUserId, input.githubLogin,
      input.githubName ?? null, input.avatarUrl ?? null,
      input.accessTokenEnc, input.scopes ?? null, createdAt, now,
    )
    .run();

  return {
    id,
    userKey: input.userKey,
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    githubName: input.githubName,
    avatarUrl: input.avatarUrl,
    accessTokenEnc: input.accessTokenEnc,
    scopes: input.scopes,
    createdAt,
    updatedAt: now,
  };
}

export async function getGitHubConnectionByUserKey(
  env: Env,
  userKey: string,
): Promise<DbGitHubConnection | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_key, github_user_id, github_login, github_name, avatar_url,
            access_token_enc, scopes, created_at, updated_at
     FROM workspace_github_connections WHERE user_key = ? ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(userKey)
    .first<{
      id: string; user_key: string; github_user_id: string; github_login: string;
      github_name: string | null; avatar_url: string | null;
      access_token_enc: string; scopes: string | null;
      created_at: string; updated_at: string;
    }>();

  if (!row) return null;
  return {
    id: row.id,
    userKey: row.user_key,
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    githubName: row.github_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    accessTokenEnc: row.access_token_enc,
    scopes: row.scopes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Project ↔ Repo links ─────────────────────────────────────────────────────

export type DbProjectRepo = {
  id: string;
  projectId: string;
  userKey: string;
  githubConnectionId: string;
  repoId: string;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  defaultBranch?: string;
  private: boolean;
  htmlUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export async function upsertProjectRepo(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    githubConnectionId: string;
    repoId: string;
    repoFullName: string;
    repoOwner: string;
    repoName: string;
    defaultBranch?: string;
    private: boolean;
    htmlUrl?: string;
  },
): Promise<DbProjectRepo> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT id, created_at FROM workspace_project_repos WHERE project_id = ?`,
  ).bind(input.projectId).first<{ id: string; created_at: string }>();

  const id = existing?.id ?? randId("wpr");
  const createdAt = existing?.created_at ?? now;

  await env.DB.prepare(
    `INSERT INTO workspace_project_repos
       (id, project_id, user_key, github_connection_id, repo_id, repo_full_name,
        repo_owner, repo_name, default_branch, private, html_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       user_key = excluded.user_key,
       github_connection_id = excluded.github_connection_id,
       repo_id = excluded.repo_id,
       repo_full_name = excluded.repo_full_name,
       repo_owner = excluded.repo_owner,
       repo_name = excluded.repo_name,
       default_branch = excluded.default_branch,
       private = excluded.private,
       html_url = excluded.html_url,
       updated_at = excluded.updated_at`,
  )
    .bind(
      id, input.projectId, input.userKey, input.githubConnectionId,
      input.repoId, input.repoFullName, input.repoOwner, input.repoName,
      input.defaultBranch ?? null, input.private ? 1 : 0, input.htmlUrl ?? null,
      createdAt, now,
    )
    .run();

  return { id, projectId: input.projectId, userKey: input.userKey, githubConnectionId: input.githubConnectionId, repoId: input.repoId, repoFullName: input.repoFullName, repoOwner: input.repoOwner, repoName: input.repoName, defaultBranch: input.defaultBranch, private: input.private, htmlUrl: input.htmlUrl, createdAt, updatedAt: now };
}

export async function getProjectRepo(env: Env, projectId: string): Promise<DbProjectRepo | null> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, user_key, github_connection_id, repo_id, repo_full_name,
            repo_owner, repo_name, default_branch, private, html_url, created_at, updated_at
     FROM workspace_project_repos WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{
      id: string; project_id: string; user_key: string; github_connection_id: string;
      repo_id: string; repo_full_name: string; repo_owner: string; repo_name: string;
      default_branch: string | null; private: number; html_url: string | null;
      created_at: string; updated_at: string;
    }>();

  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id, userKey: row.user_key,
    githubConnectionId: row.github_connection_id, repoId: row.repo_id,
    repoFullName: row.repo_full_name, repoOwner: row.repo_owner, repoName: row.repo_name,
    defaultBranch: row.default_branch ?? undefined,
    private: row.private === 1,
    htmlUrl: row.html_url ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

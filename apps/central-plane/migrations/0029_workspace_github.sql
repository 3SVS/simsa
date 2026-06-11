-- Stage 9: GitHub OAuth + project-repo connections for workspace.
-- Separate from the existing GitHub App (gh_app_installations) flow.
-- Uses workspace-specific OAuth App credentials (WORKSPACE_GH_CLIENT_ID).

-- ── OAuth state table (short-lived, cleaned after use) ────────────────────────
CREATE TABLE IF NOT EXISTS workspace_oauth_states (
  state      TEXT NOT NULL PRIMARY KEY,
  user_key   TEXT NOT NULL,
  return_to  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

-- ── GitHub connections per user_key ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_github_connections (
  id                    TEXT NOT NULL PRIMARY KEY,
  user_key              TEXT NOT NULL,
  github_user_id        TEXT NOT NULL,
  github_login          TEXT NOT NULL,
  github_name           TEXT,
  avatar_url            TEXT,
  access_token_enc      TEXT NOT NULL DEFAULT '',
  scopes                TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_github_connections_user_key
  ON workspace_github_connections (user_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_github_connections_github_user
  ON workspace_github_connections (github_user_id);

-- ── Project ↔ Repo links ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_project_repos (
  id                   TEXT NOT NULL PRIMARY KEY,
  project_id           TEXT NOT NULL,
  user_key             TEXT NOT NULL,
  github_connection_id TEXT NOT NULL,
  repo_id              TEXT NOT NULL,
  repo_full_name       TEXT NOT NULL,
  repo_owner           TEXT NOT NULL,
  repo_name            TEXT NOT NULL,
  default_branch       TEXT,
  private              INTEGER NOT NULL DEFAULT 0,
  html_url             TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_project_repos_project
  ON workspace_project_repos (project_id);

CREATE INDEX IF NOT EXISTS idx_workspace_project_repos_user_key
  ON workspace_project_repos (user_key);

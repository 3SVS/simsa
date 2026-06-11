"use client";

/**
 * Dashboard API client for workspace GitHub OAuth + project-repo connections.
 * GitHub tokens are NEVER handled here — central-plane manages them.
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

const DASHBOARD_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : "https://dashboard.conclave-ai.dev";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GitHubUser = { login: string; name?: string; avatarUrl?: string };

export type GitHubStatusResponse =
  | { ok: true; connected: false }
  | { ok: true; connected: true; user: GitHubUser };

export type GitHubRepo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
};

export type GitHubReposResponse =
  | { ok: true; repos: GitHubRepo[] }
  | { ok: false; error: string };

export type LinkedRepo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch?: string;
  private: boolean;
  htmlUrl?: string;
};

export type ProjectRepoResponse =
  | { ok: true; repo: LinkedRepo | null }
  | { ok: false; error: string };

export type LinkProjectRepoResponse =
  | { ok: true; repo: LinkedRepo }
  | { ok: false; error: string };

// ─── OAuth start ──────────────────────────────────────────────────────────────

/** Navigate the browser to GitHub OAuth. Returns the URL (caller does the redirect). */
export function buildOAuthStartUrl(userKey: string, returnTo: string): string {
  const params = new URLSearchParams({ userKey, returnTo });
  return `${CENTRAL_PLANE_URL}/workspace/github/oauth/start?${params.toString()}`;
}

/** Start the GitHub OAuth flow — navigates the current page to GitHub. */
export function startGitHubOAuth(userKey: string, returnTo?: string): void {
  const rt = returnTo ?? window.location.href;
  window.location.href = buildOAuthStartUrl(userKey, rt);
}

// ─── Connection status ────────────────────────────────────────────────────────

export async function fetchGitHubStatus(userKey: string): Promise<GitHubStatusResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/github/status?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: true, connected: false };
    return (await resp.json()) as GitHubStatusResponse;
  } catch {
    return { ok: true, connected: false };
  }
}

// ─── Repo list ────────────────────────────────────────────────────────────────

export async function fetchGitHubRepos(userKey: string): Promise<GitHubReposResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/github/repos?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      return { ok: false, error: err.error ?? `HTTP ${resp.status}` };
    }
    return (await resp.json()) as GitHubReposResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Project-repo link ────────────────────────────────────────────────────────

export async function linkProjectRepo(
  projectId: string,
  userKey: string,
  repo: GitHubRepo,
): Promise<LinkProjectRepoResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/repo`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey, repo }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as LinkProjectRepoResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function fetchProjectRepo(projectId: string): Promise<ProjectRepoResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/repo`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as ProjectRepoResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

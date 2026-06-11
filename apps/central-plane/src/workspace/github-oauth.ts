/**
 * workspace/github-oauth.ts
 *
 * Pure helpers for GitHub Web Application OAuth flow.
 * No D1 access — callers handle state persistence.
 * fetch is injected for testability.
 */
import type { FetchLike } from "../github.js";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

const ALLOWED_RETURN_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3002",
  "https://dashboard.conclave-ai.dev",
];

export type GitHubUser = {
  id: number;
  login: string;
  name?: string;
  avatar_url?: string;
};

export type GitHubRepo = {
  id: number;
  full_name: string;
  owner: { login: string };
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
};

/** Generate a random 32-byte hex state token. */
export function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Build the GitHub authorization URL. */
export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
}): string {
  const url = new URL(GITHUB_AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/** Exchange authorization code for access token. */
export async function exchangeCode(
  params: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: FetchLike,
): Promise<{ access_token: string; scope: string; token_type: string }> {
  const resp = await fetchImpl(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });
  if (!resp.ok) throw new Error(`GitHub token exchange HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    scope?: string;
    token_type?: string;
  };
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error} — ${data.error_description ?? ""}`);
  if (!data.access_token) throw new Error("GitHub OAuth: no access_token in response");
  return {
    access_token: data.access_token,
    scope: data.scope ?? "",
    token_type: data.token_type ?? "bearer",
  };
}

/** Fetch the authenticated GitHub user. */
export async function fetchGitHubUser(token: string, fetchImpl: FetchLike): Promise<GitHubUser> {
  const resp = await fetchImpl(`${GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "conclave-ai" },
  });
  if (!resp.ok) throw new Error(`GitHub /user HTTP ${resp.status}`);
  return resp.json() as Promise<GitHubUser>;
}

/** List public repos for the authenticated user. */
export async function fetchGitHubRepos(token: string, fetchImpl: FetchLike): Promise<GitHubRepo[]> {
  const resp = await fetchImpl(
    `${GITHUB_API}/user/repos?sort=updated&per_page=100&visibility=public`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "conclave-ai" } },
  );
  if (!resp.ok) throw new Error(`GitHub /user/repos HTTP ${resp.status}`);
  return resp.json() as Promise<GitHubRepo[]>;
}

/** Validate that returnTo is a trusted dashboard origin. */
export function isAllowedReturnTo(returnTo: string): boolean {
  if (!returnTo) return false;
  // Allow relative paths (they're safe — we prepend the origin on redirect)
  if (returnTo.startsWith("/")) return true;
  try {
    const url = new URL(returnTo);
    return ALLOWED_RETURN_ORIGINS.some((o) => url.origin === o);
  } catch {
    return false;
  }
}

/** Append ?github=connected (or &github=connected) to a URL. */
export function appendGitHubConnected(returnTo: string, dashboardBaseUrl: string): string {
  const full = returnTo.startsWith("http") ? returnTo : `${dashboardBaseUrl}${returnTo}`;
  const sep = full.includes("?") ? "&" : "?";
  return `${full}${sep}github=connected`;
}

/**
 * workspace/github-app-access.ts
 *
 * Private-repo access for Workspace via the EXISTING GitHub App
 * (conclave-ai era, GH_APP_ID + GH_APP_PRIVATE_KEY) — architecture-v0.4
 * "option B", pulled forward.
 *
 * Design (no migration, derive-at-use-time):
 *   - The workspace OAuth token (`public_repo` scope) stays the primary
 *     credential. Private repos are invisible to it (GitHub answers 404).
 *   - When the user's OAuth token cannot see a repo, we try the GitHub App:
 *     if the App is installed on that repo, we mint a short-lived
 *     installation token (60 min, minted fresh per request — Workers
 *     isolates make server-side caching pointless, matching gh-app.ts).
 *   - No `access_mode` column: `resolveRepoAccessToken` probes OAuth first
 *     and falls back to the App on every call, so a repo flipping
 *     public↔private or the App being (un)installed needs no stored state.
 *
 * Every function here is fail-safe: missing GH_APP_* creds, App not
 * installed, or any network/parse error → null / oauth-fallback, never throw.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { mintAppJwt, getInstallationToken } from "../gh-app.js";
import { decryptToken } from "../crypto.js";
import { getGitHubConnectionByUserKey } from "./github-db.js";
import type { GitHubRepo } from "./github-oauth.js";

const GITHUB_API = "https://api.github.com";

function ghHeaders(auth: string): Record<string, string> {
  return {
    authorization: `Bearer ${auth}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "conclave-ai",
  };
}

export interface AppInstallationAccess {
  token: string;
  installationId: number;
}

/**
 * App JWT → GET /repos/{owner}/{repo}/installation → POST access_tokens.
 * Returns { token, installationId } when the App is installed on the repo;
 * null when the App is not installed, GH_APP_* creds are missing, or any
 * step fails. Never throws. No caching — fetch per request (Workers).
 */
export async function getAppInstallationToken(
  env: Env,
  owner: string,
  repo: string,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<AppInstallationAccess | null> {
  // 2026-07-20 계측: 이 경로의 실패가 전부 조용한 null이라 "App 설치했는데
  // 연결 실패"를 라이브에서 판별할 수 없었다(Bae 실측). 실패 지점·HTTP
  // status·app id(공개 정보)를 로그로 남긴다 — Worker 로그는 tail로 보인다.
  // fail-safe 계약(어떤 실패도 null, throw 금지)은 그대로.
  if (!env.GH_APP_ID || !env.GH_APP_PRIVATE_KEY) {
    console.log(`[gh-app-access] ${owner}/${repo}: skipped — GH_APP_ID/PRIVATE_KEY missing`);
    return null;
  }
  try {
    const jwt = await mintAppJwt(env);
    const r = await fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
      { headers: ghHeaders(jwt) },
    );
    if (!r.ok) {
      // 404 = App not installed on this repo (or installed under a different
      // account/app id). app_id 로그가 "설치한 앱 ≠ 서버 자격의 앱" 불일치를
      // 즉시 드러낸다.
      const tail = await r.text().then((t) => t.slice(0, 120)).catch(() => "");
      console.log(
        `[gh-app-access] ${owner}/${repo}: installation lookup ${r.status} (app_id=${env.GH_APP_ID}) ${tail}`,
      );
      return null;
    }
    const j = (await r.json()) as { id?: number };
    if (typeof j.id !== "number") {
      console.log(`[gh-app-access] ${owner}/${repo}: installation response missing id`);
      return null;
    }
    const t = await getInstallationToken(env, j.id, fetchImpl);
    return { token: t.token, installationId: j.id };
  } catch (err) {
    console.log(
      `[gh-app-access] ${owner}/${repo}: failed — ${String((err as Error)?.message ?? err).slice(0, 200)}`,
    );
    return null;
  }
}

/**
 * Fetch repo metadata through the App installation token. Returns the repo
 * (same shape the OAuth lookup uses) when the App is installed and can see
 * it; null otherwise. Never throws.
 */
export async function getRepoViaApp(
  env: Env,
  owner: string,
  repo: string,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<GitHubRepo | null> {
  const access = await getAppInstallationToken(env, owner, repo, fetchImpl);
  if (!access) return null;
  try {
    const r = await fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: ghHeaders(access.token) },
    );
    if (!r.ok) return null;
    return (await r.json()) as GitHubRepo;
  } catch {
    return null;
  }
}

export type RepoAccessError = "not_connected" | "token_unavailable" | "token_decrypt_failed";

export type RepoAccessResult =
  | { ok: true; token: string; via: "oauth" | "app"; installationId?: number }
  | { ok: false; error: RepoAccessError };

/**
 * Resolve the token to use for GitHub reads/writes on owner/repo:
 *   1. the user's OAuth token when it can see the repo (probe GET /repos),
 *   2. else the App installation token when the App is installed there,
 *   3. else the OAuth token anyway — the downstream call fails exactly like
 *      it did before this helper existed (unchanged error contract).
 *
 * `opts.repoPrivate === false` (linked repo record says public) skips the
 * probe entirely and returns the OAuth token — the exact pre-App behavior
 * with zero extra GitHub calls. Private/unknown repos take the probe path.
 * (A public repo later flipped private just fails downstream like before,
 * until the user re-links it — derive-at-use-time, no stored access mode.)
 *
 * The connection/KEK failure modes keep the pre-existing error codes so
 * call sites map to the same HTTP statuses (401 not_connected,
 * 503 token_unavailable / token_decrypt_failed).
 */
export async function resolveRepoAccessToken(
  env: Env,
  userKey: string,
  owner: string,
  repo: string,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
  opts: { repoPrivate?: boolean } = {},
): Promise<RepoAccessResult> {
  const conn = await getGitHubConnectionByUserKey(env, userKey).catch(() => null);
  if (!conn || !conn.accessTokenEnc) return { ok: false, error: "not_connected" };

  const kek = env.CONCLAVE_TOKEN_KEK;
  if (!kek) return { ok: false, error: "token_unavailable" };

  let oauthToken: string;
  try {
    oauthToken = await decryptToken(conn.accessTokenEnc, kek);
  } catch {
    return { ok: false, error: "token_decrypt_failed" };
  }

  // Known-public repo → OAuth token straight away (pre-App fast path).
  if (opts.repoPrivate === false) return { ok: true, token: oauthToken, via: "oauth" };

  // Probe: can the user's OAuth token see this repo? (Private repos answer
  // 404 under the `public_repo` scope.) Any probe error → treat as not-visible.
  let oauthCanSee = false;
  try {
    const probe = await fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: ghHeaders(oauthToken) },
    );
    oauthCanSee = probe.ok;
  } catch {
    oauthCanSee = false;
  }
  if (oauthCanSee) return { ok: true, token: oauthToken, via: "oauth" };

  const appAccess = await getAppInstallationToken(env, owner, repo, fetchImpl);
  if (appAccess) {
    return { ok: true, token: appAccess.token, via: "app", installationId: appAccess.installationId };
  }

  // Fail-safe fallback: behave exactly as before the App path existed.
  return { ok: true, token: oauthToken, via: "oauth" };
}

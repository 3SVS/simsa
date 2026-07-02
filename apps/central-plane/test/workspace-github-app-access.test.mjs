/**
 * workspace-github-app-access.test.mjs
 *
 * Private-repo access via the existing GitHub App:
 *   - getAppInstallationToken: installed → token; not installed → null; missing creds → null
 *   - getRepoViaApp: repo metadata through the installation token
 *   - resolveRepoAccessToken: OAuth-first, App-fallback order + error contract
 *   - Route GET /workspace/github/repos/lookup: private link allowed when the
 *     App is installed; actionable app_not_installed (+ appInstallUrl) when not
 *
 * No network calls — GitHub API is mocked via injected fetch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, generateKeyPairSync } from "node:crypto";

const { getAppInstallationToken, getRepoViaApp, resolveRepoAccessToken } =
  await import("../dist/workspace/github-app-access.js");
const { upsertGitHubConnection } = await import("../dist/workspace/github-db.js");
const { encryptToken } = await import("../dist/crypto.js");
const { createApp } = await import("../dist/router.js");

// Real RSA key so mintAppJwt can sign (same pattern as saas.test.mjs).
const { privateKey: GH_APP_PRIVATE_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const OAUTH_TOKEN = "ghp_oauth_token";
const APP_TOKEN = "ghs_app_installation_token";
const INSTALLATION_ID = 4242;

// ─── Minimal D1 mock (connection rows only — copied shape from workspace-github.test.mjs) ──

function makeMockDb() {
  const state = { github_connections: new Map(), project_repos: new Map(), oauth_states: new Map() };
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          if (/workspace_github_connections/.test(sql) && /user_key = \?/.test(sql)) {
            const entries = [...state.github_connections.values()].filter(r => r.user_key === bound[0]);
            return entries.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0] ?? null;
          }
          if (/workspace_github_connections/.test(sql) && /github_user_id = \?/.test(sql)) {
            const entries = [...state.github_connections.values()].filter(r => r.github_user_id === bound[0]);
            return entries[0] ?? null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO workspace_github_connections/.test(sql)) {
            const [id, user_key, github_user_id, github_login, github_name, avatar_url, access_token_enc, scopes, created_at, updated_at] = bound;
            state.github_connections.set(id, { id, user_key, github_user_id, github_login, github_name, avatar_url, access_token_enc, scopes, created_at, updated_at });
          }
          return { success: true };
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

async function makeEnvWithConnection(overrides = {}) {
  const kek = randomBytes(32).toString("base64");
  const env = {
    DB: makeMockDb(),
    ENVIRONMENT: "test",
    CONCLAVE_TOKEN_KEK: kek,
    GH_APP_ID: "12345",
    GH_APP_PRIVATE_KEY: GH_APP_PRIVATE_PEM,
    ...overrides,
  };
  const enc = await encryptToken(OAUTH_TOKEN, kek);
  await upsertGitHubConnection(env, {
    userKey: "uk_app", githubUserId: "77", githubLogin: "apptester",
    accessTokenEnc: enc, scopes: "read:user public_repo",
  });
  return env;
}

/**
 * GitHub API mock. Options:
 *   appInstalled  — /repos/:o/:r/installation answers 200 {id} (else 404)
 *   oauthRepo     — what GET /repos/:o/:r returns for the OAuth token:
 *                   "public" → 200 public repo, "private" → 200 private repo,
 *                   "404" → 404 (private invisible / nonexistent)
 * Records every request in .calls.
 */
function makeGitHubFetch({ appInstalled = true, oauthRepo = "404" } = {}) {
  const calls = [];
  const repoJson = (priv) => ({
    id: 999, full_name: "acme/secret-app", name: "secret-app",
    owner: { login: "acme" }, private: priv, default_branch: "main",
    html_url: "https://github.com/acme/secret-app",
    permissions: { pull: true, push: true, admin: false },
  });
  const fetchImpl = async (url, init = {}) => {
    const auth = (init.headers?.authorization ?? init.headers?.Authorization ?? "");
    calls.push({ url: String(url), auth });
    const u = String(url);
    if (/\/repos\/[^/]+\/[^/]+\/installation$/.test(u)) {
      return appInstalled
        ? new Response(JSON.stringify({ id: INSTALLATION_ID }), { status: 200 })
        : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    if (/\/app\/installations\/\d+\/access_tokens$/.test(u)) {
      return new Response(JSON.stringify({
        token: APP_TOKEN, expires_at: "2099-01-01T00:00:00Z", permissions: { contents: "read" },
      }), { status: 201 });
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) {
      if (auth.includes(APP_TOKEN)) {
        return new Response(JSON.stringify(repoJson(true)), { status: 200 });
      }
      // OAuth-token view
      if (oauthRepo === "public") return new Response(JSON.stringify(repoJson(false)), { status: 200 });
      if (oauthRepo === "private") return new Response(JSON.stringify(repoJson(true)), { status: 200 });
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    return new Response("unexpected url: " + u, { status: 500 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// ─── getAppInstallationToken ─────────────────────────────────────────────────

describe("getAppInstallationToken", () => {
  it("returns token + installationId when the App is installed", async () => {
    const env = { GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: GH_APP_PRIVATE_PEM };
    const fetchMock = makeGitHubFetch({ appInstalled: true });
    const access = await getAppInstallationToken(env, "acme", "secret-app", fetchMock);
    assert.ok(access, "should resolve access");
    assert.equal(access.token, APP_TOKEN);
    assert.equal(access.installationId, INSTALLATION_ID);
  });

  it("returns null when the App is not installed on the repo (404)", async () => {
    const env = { GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: GH_APP_PRIVATE_PEM };
    const fetchMock = makeGitHubFetch({ appInstalled: false });
    const access = await getAppInstallationToken(env, "acme", "secret-app", fetchMock);
    assert.equal(access, null);
  });

  it("returns null (no fetch) when GH_APP creds are missing", async () => {
    const fetchMock = makeGitHubFetch();
    assert.equal(await getAppInstallationToken({}, "acme", "x", fetchMock), null);
    assert.equal(await getAppInstallationToken({ GH_APP_ID: "1" }, "acme", "x", fetchMock), null);
    assert.equal(await getAppInstallationToken({ GH_APP_PRIVATE_KEY: GH_APP_PRIVATE_PEM }, "acme", "x", fetchMock), null);
    assert.equal(fetchMock.calls.length, 0, "must not hit the network without creds");
  });

  it("returns null instead of throwing on a garbage private key", async () => {
    const env = { GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: "not-a-pem" };
    const access = await getAppInstallationToken(env, "acme", "secret-app", makeGitHubFetch());
    assert.equal(access, null);
  });
});

// ─── getRepoViaApp ───────────────────────────────────────────────────────────

describe("getRepoViaApp", () => {
  it("returns repo metadata when the App is installed", async () => {
    const env = { GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: GH_APP_PRIVATE_PEM };
    const repo = await getRepoViaApp(env, "acme", "secret-app", makeGitHubFetch({ appInstalled: true }));
    assert.ok(repo, "repo should resolve");
    assert.equal(repo.full_name, "acme/secret-app");
    assert.equal(repo.private, true);
  });

  it("returns null when the App is not installed", async () => {
    const env = { GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: GH_APP_PRIVATE_PEM };
    const repo = await getRepoViaApp(env, "acme", "secret-app", makeGitHubFetch({ appInstalled: false }));
    assert.equal(repo, null);
  });
});

// ─── resolveRepoAccessToken (fallback order) ─────────────────────────────────

describe("resolveRepoAccessToken", () => {
  it("uses the OAuth token when it can see the repo — App path never touched", async () => {
    const env = await makeEnvWithConnection();
    const fetchMock = makeGitHubFetch({ oauthRepo: "public" });
    const res = await resolveRepoAccessToken(env, "uk_app", "acme", "secret-app", fetchMock);
    assert.equal(res.ok, true);
    assert.equal(res.via, "oauth");
    assert.equal(res.token, OAUTH_TOKEN);
    assert.ok(!fetchMock.calls.some((c) => c.url.endsWith("/installation")), "no App installation lookup");
  });

  it("falls back to the App installation token when OAuth answers 404 (private repo)", async () => {
    const env = await makeEnvWithConnection();
    const fetchMock = makeGitHubFetch({ oauthRepo: "404", appInstalled: true });
    const res = await resolveRepoAccessToken(env, "uk_app", "acme", "secret-app", fetchMock);
    assert.equal(res.ok, true);
    assert.equal(res.via, "app");
    assert.equal(res.token, APP_TOKEN);
    assert.equal(res.installationId, INSTALLATION_ID);
  });

  it("falls back to the OAuth token (pre-App behavior) when the App is not installed either", async () => {
    const env = await makeEnvWithConnection();
    const fetchMock = makeGitHubFetch({ oauthRepo: "404", appInstalled: false });
    const res = await resolveRepoAccessToken(env, "uk_app", "acme", "secret-app", fetchMock);
    assert.equal(res.ok, true);
    assert.equal(res.via, "oauth");
    assert.equal(res.token, OAUTH_TOKEN);
  });

  it("keeps the pre-existing error contract: not_connected / token_unavailable", async () => {
    const env = await makeEnvWithConnection();
    const noConn = await resolveRepoAccessToken(env, "uk_nobody", "acme", "x", makeGitHubFetch());
    assert.deepEqual(noConn, { ok: false, error: "not_connected" });

    const envNoKek = await makeEnvWithConnection();
    envNoKek.CONCLAVE_TOKEN_KEK = undefined;
    const noKek = await resolveRepoAccessToken(envNoKek, "uk_app", "acme", "x", makeGitHubFetch());
    assert.deepEqual(noKek, { ok: false, error: "token_unavailable" });
  });
});

// ─── Route: GET /workspace/github/repos/lookup (private repos) ───────────────

const INSTALL_URL = "https://github.com/apps/conclave-ai/installations/new";

function lookupRequest() {
  return new Request(
    "http://localhost/workspace/github/repos/lookup?userKey=uk_app&fullName=acme/secret-app",
  );
}

describe("GET /workspace/github/repos/lookup — private repos via App", () => {
  it("allows the link when OAuth can't see the repo but the App is installed", async () => {
    const env = await makeEnvWithConnection({ GH_APP_INSTALL_URL: INSTALL_URL });
    const app = createApp({ fetch: makeGitHubFetch({ oauthRepo: "404", appInstalled: true }) });
    const resp = await app.fetch(lookupRequest(), env);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.repo.fullName, "acme/secret-app");
    assert.equal(body.repo.private, true);
  });

  it("allows the link when OAuth sees a private repo and the App is installed", async () => {
    const env = await makeEnvWithConnection({ GH_APP_INSTALL_URL: INSTALL_URL });
    const app = createApp({ fetch: makeGitHubFetch({ oauthRepo: "private", appInstalled: true }) });
    const resp = await app.fetch(lookupRequest(), env);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.repo.private, true);
  });

  it("returns actionable app_not_installed (+ appInstallUrl) for a known-private repo without the App", async () => {
    const env = await makeEnvWithConnection({ GH_APP_INSTALL_URL: INSTALL_URL });
    const app = createApp({ fetch: makeGitHubFetch({ oauthRepo: "private", appInstalled: false }) });
    const resp = await app.fetch(lookupRequest(), env);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "app_not_installed");
    assert.equal(body.appInstallUrl, INSTALL_URL);
  });

  it("keeps not_found for an invisible repo without the App, adding the install hint URL", async () => {
    const env = await makeEnvWithConnection({ GH_APP_INSTALL_URL: INSTALL_URL });
    const app = createApp({ fetch: makeGitHubFetch({ oauthRepo: "404", appInstalled: false }) });
    const resp = await app.fetch(lookupRequest(), env);
    assert.equal(resp.status, 404);
    const body = await resp.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
    assert.equal(body.appInstallUrl, INSTALL_URL);
  });

  it("omits appInstallUrl when GH_APP_INSTALL_URL is unset (placeholder default)", async () => {
    const env = await makeEnvWithConnection({ GH_APP_INSTALL_URL: "" });
    const app = createApp({ fetch: makeGitHubFetch({ oauthRepo: "private", appInstalled: false }) });
    const resp = await app.fetch(lookupRequest(), env);
    const body = await resp.json();
    assert.equal(body.error, "app_not_installed");
    assert.equal(body.appInstallUrl, undefined);
  });

  it("public repos keep working unchanged (OAuth path, no App calls)", async () => {
    const env = await makeEnvWithConnection();
    const fetchMock = makeGitHubFetch({ oauthRepo: "public" });
    const app = createApp({ fetch: fetchMock });
    const resp = await app.fetch(lookupRequest(), env);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.repo.private, false);
    assert.ok(!fetchMock.calls.some((c) => c.url.endsWith("/installation")), "no App installation lookup");
  });
});

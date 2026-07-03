/**
 * workspace-github.ts
 *
 * GitHub OAuth + repo connection routes for Workspace.
 *
 * GET  /workspace/github/oauth/start                    — redirect to GitHub auth
 * GET  /workspace/github/oauth/callback                 — exchange code, save connection, redirect
 * GET  /workspace/github/status                         — connection status for a userKey
 * GET  /workspace/github/repos                          — list public repos for connected user
 * POST /workspace/projects/:id/repo                     — link a repo to a project
 * GET  /workspace/projects/:id/repo                     — get linked repo for a project
 * GET  /workspace/projects/:id/github/pulls             — list open PRs for linked repo
 * POST /workspace/projects/:id/github/pulls/:number/link — link a PR to workspace items
 * GET  /workspace/projects/:id/github/linked-pulls      — get linked PR mappings
 *
 * Security:
 *   - state CSRF token is validated on callback
 *   - access tokens are AES-256-GCM encrypted (CONCLAVE_TOKEN_KEK) before D1 storage
 *   - GitHub tokens are never sent to the dashboard
 *   - client secret only used server-side in callback
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { ALLOWED_ORIGINS } from "./cors.js";
import { BRAND } from "../workspace/brand.js";
import type { FetchLike } from "../github.js";
import { encryptToken, decryptToken } from "../crypto.js";
import {
  saveOAuthState, getOAuthState, markStateUsed,
  upsertGitHubConnection, getGitHubConnectionByUserKey,
  deleteGitHubConnectionsByUserKey,
  upsertProjectRepo, getProjectRepo,
} from "../workspace/github-db.js";
import {
  generateState, buildAuthUrl, exchangeCode,
  fetchGitHubUser, fetchGitHubRepos, fetchGitHubRepoByFullName, fetchGitHubPulls,
  isAllowedReturnTo, appendGitHubConnected,
} from "../workspace/github-oauth.js";
import { getRepoViaApp, resolveRepoAccessToken } from "../workspace/github-app-access.js";
import { upsertProjectPR, getLinkedPRs } from "../workspace/pr-db.js";
import {
  insertReviewRun, updateReviewRun, getLatestReviewRun, getLatestTwoPrReviewRuns,
  listPRReviewRuns, listProjectReviewRuns, getReviewRunById,
} from "../workspace/pr-review-db.js";
import { loadPRReviewRunForAction } from "../workspace/pr-review-run-loader.js";
import { normalizeSelectedItemIds, recommendedRerunItemIds } from "../workspace/selected-items.js";
import {
  compareRunResults, buildRunSummary, parseRunResults, compareSpecificReviewRuns,
  type SpecificRunComparison,
} from "../workspace/pr-review-compare.js";
import { fetchPRFiles } from "../workspace/github-pr.js";
import { reviewPRAgainstItems, deriveRunStatus } from "../workspace/pr-review.js";
import { captureTrainingRecord } from "../workspace/training-store.js";
import { getProject, getOwnedProject } from "../workspace/db.js";
import { consumeUserHourlyLimit, hourlyLimitFromEnv } from "../workspace/rate-limit.js";
import type { CheckableItem, ProductSpecForCheck } from "../workspace/check.js";
import { normalizeProductSpec, normalizeCheckableItems } from "../workspace/check.js";
import { generatePRFixBrief } from "../workspace/pr-fix-brief.js";
import type { FixBriefItem, FixBriefTarget } from "../workspace/pr-fix-brief.js";
import {
  insertPrComment, updatePrComment, getPrComments,
  getLatestPostedComment, getPrCommentById,
} from "../workspace/pr-comment-db.js";
import {
  buildCommentBody, bodyPreview, postGitHubComment, updateGitHubComment, hasPrCommentScope,
} from "../workspace/pr-comment.js";
import type { CommentResultItem, ComparisonDataForComment } from "../workspace/pr-comment.js";
import { insertUsageEvent } from "../workspace/usage-events-db.js";
import { checkCreditEnforcementDryRun, checkCreditEnforcement } from "../workspace/credit-enforcement.js";
import { getMarketplaceEntitlement } from "../workspace/marketplace-entitlement.js";
import type { CreditEnforcementDryRun, CreditEnforcementResult } from "../workspace/credit-enforcement.js";
import { generateDebitId, buildPrReviewDebitSourceEventId, validateIdempotencyKey } from "../workspace/credits.js";
import {
  getNotificationSettings,
  insertNotificationRecord,
} from "../workspace/notification-db.js";
import {
  buildPrReviewTelegramMessage,
  sendWorkspaceTelegramMessage,
} from "../workspace/telegram-notify.js";
import { notifyPrReviewCompleteByEmail } from "../workspace/email-notify.js";

// ─── CORS helpers (shared with workspace.ts) ──────────────────────────────────

// ALLOWED_ORIGINS centralized in ./cors.ts (Stage 91) — imported at top.

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Stage 92: default to the live Simsa app domain (app.trysimsa.com) for
// user-facing post-connect redirects / Telegram links when WORKSPACE_GH_DASHBOARD_URL
// (or DASHBOARD_BASE_URL) is unset. The old default (dashboard.conclave-ai.dev)
// never had DNS. Production env, if set, still takes precedence.
const DEFAULT_DASHBOARD_URL = BRAND.appUrl;

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

// ─── Ownership + rate-limit gates (security hardening) ───────────────────────

/**
 * Ownership gate for every project-scoped route in this file. Returns a ready
 * 404 Response when the project is missing OR belongs to another userKey —
 * one indistinguishable "not_found" so low-entropy project ids can't be probed.
 * Returns null when the caller owns the project.
 */
async function denyUnlessOwnedProject(
  env: Env,
  projectId: string,
  userKey: string,
  origin: string | null,
): Promise<Response | null> {
  const owned = await getOwnedProject(env, projectId, userKey).catch(() => null);
  if (!owned) return json({ ok: false, error: "not_found" }, 404, origin);
  return null;
}

const DEFAULT_PR_REVIEW_HOURLY_LIMIT = 30;
const DEFAULT_PR_COMMENT_HOURLY_LIMIT = 60;

/**
 * Per-userKey hourly rate-limit gate. Returns a ready 429 Response when the
 * bucket is exhausted, null otherwise (consuming one slot).
 */
async function denyIfRateLimited(
  env: Env,
  bucket: "workspace-pr-review" | "workspace-pr-comment",
  userKey: string,
  limitPerHour: number,
  origin: string | null,
): Promise<Response | null> {
  const rl = await consumeUserHourlyLimit(env, bucket, userKey, limitPerHour);
  if (!rl.limited) return null;
  return new Response(
    JSON.stringify({ ok: false, error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(rl.retryAfterSeconds),
        ...corsHeaders(origin),
      },
    },
  );
}

// ─── Comparison helper ────────────────────────────────────────────────────────

async function loadComparisonForComment(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
  locale: "en" | "ko" = "ko",
): Promise<{ data: ComparisonDataForComment | null; warning?: string }> {
  try {
    const [latest, previous] = await getLatestTwoPrReviewRuns(env, projectId, repoFullName, prNumber);
    if (!latest || !previous) return { data: null, warning: "not_enough_runs" };
    const latestResults = parseRunResults(latest.resultJson);
    const previousResults = parseRunResults(previous.resultJson);
    const comparison = compareRunResults(previousResults, latestResults, locale);
    const latestSummary = buildRunSummary(latest);
    const previousSummary = buildRunSummary(previous);
    return {
      data: {
        previousSummary: previousSummary.summary,
        latestSummary: latestSummary.summary,
        improved: comparison.improved,
        stillOpen: comparison.stillOpen,
        newlyProblematic: comparison.newlyProblematic,
      },
    };
  } catch {
    return { data: null };
  }
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
  app.options("/workspace/projects/:id/github/*", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });
  // PATCH preflight for comment update
  app.options("/workspace/projects/:id/github/pulls/:number/comment/:commentId", (c) => {
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

  // ── POST /workspace/github/disconnect ──────────────────────────────────────
  // Stage 273: delete the user's GitHub connection row(s) — including the
  // encrypted access token — so the user can switch GitHub accounts. GitHub
  // OAuth has no account picker (an existing grant silently re-authorizes),
  // so disconnect + logout-at-github.com is the only honest switch path.
  app.post("/workspace/github/disconnect", async (c) => {
    const origin = c.req.header("origin") ?? null;

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    try {
      const disconnected = await deleteGitHubConnectionsByUserKey(c.env, userKey);
      return json({ ok: true, disconnected }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/disconnect] failed:", err);
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

    let repos: Array<{ id: number; full_name: string; owner: { login: string }; name: string; private: boolean; default_branch: string; html_url: string; permissions?: { pull?: boolean; push?: boolean; admin?: boolean } }>;
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
        // Additive (Stage 56): viewer permission bits, when GitHub provides them.
        ...(r.permissions ? { permissions: r.permissions } : {}),
      })),
    }, 200, origin);
  });

  // ── GET /workspace/github/repos/lookup?userKey=...&fullName=owner/repo ─────
  // Stage 56: org/collaborator repos the user isn't a listed member of never appear
  // in /user/repos. This resolves a repo by full name (public-repo, by-name access),
  // so the dashboard can offer a "type owner/repo directly" fallback in the picker.
  app.get("/workspace/github/repos/lookup", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const userKey = c.req.query("userKey") ?? "";
    const fullName = (c.req.query("fullName") ?? "").trim();

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    const m = fullName.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (!m) return json({ ok: false, error: "invalid_full_name" }, 400, origin);
    const owner = m[1] as string;
    const repoName = m[2] as string;

    let conn;
    try {
      conn = await getGitHubConnectionByUserKey(c.env, userKey);
    } catch {
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
    if (!conn || !conn.accessTokenEnc) return json({ ok: false, error: "not_connected" }, 401, origin);

    const kek = c.env.CONCLAVE_TOKEN_KEK;
    if (!kek) return json({ ok: false, error: "token_unavailable" }, 503, origin);

    let token: string;
    try {
      token = await decryptToken(conn.accessTokenEnc, kek);
    } catch {
      return json({ ok: false, error: "token_decrypt_failed" }, 503, origin);
    }

    let repo;
    try {
      repo = await fetchGitHubRepoByFullName(owner, repoName, token, fetchImpl);
    } catch (err) {
      return json({ ok: false, error: `github_api_failed: ${(err as Error).message}` }, 502, origin);
    }
    // Private repos via the existing GitHub App (additive, fail-safe):
    //  - OAuth 404 covers both "doesn't exist" and "private + public_repo scope";
    //    the App lookup disambiguates: installed → link allowed.
    //  - OAuth sees it but private=true (broader legacy scope) → same App path.
    //  - App not installed / creds missing → the previous error contract, plus
    //    an actionable appInstallUrl (GH_APP_INSTALL_URL) when configured.
    const appInstallUrl = c.env.GH_APP_INSTALL_URL ?? "";
    if (!repo || repo.private) {
      const viaApp = await getRepoViaApp(c.env, owner, repoName, fetchImpl);
      if (viaApp) {
        repo = viaApp;
      } else if (!repo) {
        return json({ ok: false, error: "not_found", ...(appInstallUrl ? { appInstallUrl } : {}) }, 404, origin);
      } else {
        // Known-private, App not installed → actionable error (supersedes
        // Stage 56's private_unsupported).
        return json({ ok: false, error: "app_not_installed", ...(appInstallUrl ? { appInstallUrl } : {}) }, 200, origin);
      }
    }

    return json({
      ok: true,
      repo: {
        id: String(repo.id),
        fullName: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url,
        ...(repo.permissions ? { permissions: repo.permissions } : {}),
      },
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

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

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

  // ── GET /workspace/projects/:id/repo?userKey=... ──────────────────────────
  app.get("/workspace/projects/:id/repo", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

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

  // ── GET /workspace/projects/:id/github/pulls?userKey=... ─────────────────
  // List open PRs for the project's linked repo.
  app.get("/workspace/projects/:id/github/pulls", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked — connect a repo first" }, 400, origin);

    // OAuth-first, App-fallback token resolution (private repos via the App).
    const access = await resolveRepoAccessToken(c.env, userKey, repo.repoOwner, repo.repoName, fetchImpl, { repoPrivate: repo.private });
    if (!access.ok) {
      if (access.error === "not_connected") {
        return json({ ok: false, error: "not_connected — connect GitHub first" }, 401, origin);
      }
      return json({ ok: false, error: access.error }, 503, origin);
    }
    const token = access.token;

    let pulls;
    try {
      pulls = await fetchGitHubPulls(repo.repoOwner, repo.repoName, token, fetchImpl, "open");
    } catch (err) {
      return json({ ok: false, error: `github_api_failed: ${(err as Error).message}` }, 502, origin);
    }

    return json({
      ok: true,
      repo: { fullName: repo.repoFullName, owner: repo.repoOwner, name: repo.repoName, defaultBranch: repo.defaultBranch },
      pulls: pulls.map((p) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        htmlUrl: p.html_url,
        headBranch: p.head.ref,
        baseBranch: p.base.ref,
        updatedAt: p.updated_at,
      })),
    }, 200, origin);
  });

  // ── POST /workspace/projects/:id/github/pulls/:number/link ───────────────
  // Link a PR to workspace items. No review job is created.
  app.post("/workspace/projects/:id/github/pulls/:number/link", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumberStr = c.req.param("number");
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    const pr = b["pullRequest"] as Record<string, unknown> | undefined;
    const selectedItemIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [];

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    if (!pr || typeof pr["title"] !== "string") {
      return json({ ok: false, error: "pullRequest.title_required" }, 400, origin);
    }
    if (selectedItemIds.length === 0) {
      return json({ ok: false, error: "selectedItemIds_must_not_be_empty" }, 400, origin);
    }

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    try {
      const linked = await upsertProjectPR(c.env, {
        projectId, userKey,
        repoFullName: repo.repoFullName,
        prNumber,
        prTitle: String(pr["title"]),
        prState: typeof pr["state"] === "string" ? pr["state"] : "open",
        prUrl: typeof pr["htmlUrl"] === "string" ? pr["htmlUrl"] : undefined,
        prHeadBranch: typeof pr["headBranch"] === "string" ? pr["headBranch"] : undefined,
        prBaseBranch: typeof pr["baseBranch"] === "string" ? pr["baseBranch"] : undefined,
        selectedItemIds,
      });
      return json({ ok: true, pull: { id: linked.id, repoFullName: linked.repoFullName, number: linked.prNumber, title: linked.prTitle, state: linked.prState, htmlUrl: linked.prUrl, headBranch: linked.prHeadBranch, baseBranch: linked.prBaseBranch, selectedItemIds: linked.selectedItemIds, updatedAt: linked.updatedAt } }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/pulls/link] save failed:", err);
      return json({ ok: false, error: "save_failed" }, 500, origin);
    }
  });

  // ── GET /workspace/projects/:id/github/linked-pulls?userKey=... ──────────
  app.get("/workspace/projects/:id/github/linked-pulls", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    try {
      const pulls = await getLinkedPRs(c.env, projectId);
      return json({
        ok: true,
        pulls: pulls.map((p) => ({
          id: p.id, repoFullName: p.repoFullName, number: p.prNumber,
          title: p.prTitle, state: p.prState, htmlUrl: p.prUrl,
          headBranch: p.prHeadBranch, baseBranch: p.prBaseBranch,
          selectedItemIds: p.selectedItemIds, updatedAt: p.updatedAt,
        })),
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/linked-pulls] fetch failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── POST /workspace/projects/:id/github/pulls/:number/review ─────────────
  // Start a PR code review run. Synchronous: fetches diff + runs LLM + stores result.
  app.post("/workspace/projects/:id/github/pulls/:number/review", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    // Review findings (reason/evidence/nextAction) follow the user's UI language.
    const reviewLocale: "en" | "ko" = b["locale"] === "en" ? "en" : "ko";

    // Ownership: the project must belong to the caller before anything else
    // (repo link, runs, and credits are all project-scoped).
    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    // Per-userKey hourly rate limit for review execution (LLM + GitHub cost).
    const reviewLimit = hourlyLimitFromEnv(c.env.WORKSPACE_PR_REVIEW_HOURLY_LIMIT, DEFAULT_PR_REVIEW_HOURLY_LIMIT);
    const limited = await denyIfRateLimited(c.env, "workspace-pr-review", userKey, reviewLimit, origin);
    if (limited) return limited;

    // Stage 40: normalize hand-picked selectedItemIds (dedupe, trim, drop
    // empties, cap). Returns undefined when not an array → falls back to
    // source run / linked PR selection downstream.
    const bodySelectedIds = normalizeSelectedItemIds(b["selectedItemIds"]);
    const rerunOfReviewRunId = typeof b["rerunOfReviewRunId"] === "string" ? b["rerunOfReviewRunId"] : undefined;

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 1b. Validate source run if rerunOfReviewRunId provided; inherit selectedItemIds
    let sourceRunForRerun: Awaited<ReturnType<typeof getReviewRunById>> | null = null;
    let sourceSelectedItemIds: string[] | undefined;
    if (rerunOfReviewRunId) {
      const dbSourceRun = await getReviewRunById(c.env, rerunOfReviewRunId).catch(() => null);
      if (!dbSourceRun) {
        return json({ ok: false, error: "rerun_source_not_found" }, 404, origin);
      }
      if (
        dbSourceRun.projectId !== projectId ||
        dbSourceRun.repoFullName !== repo.repoFullName ||
        dbSourceRun.prNumber !== prNumber
      ) {
        return json({ ok: false, error: "rerun_source_mismatch" }, 404, origin);
      }
      sourceRunForRerun = dbSourceRun;
      if (dbSourceRun.selectedItemIds.length > 0) {
        sourceSelectedItemIds = dbSourceRun.selectedItemIds;
      }
    }

    // 2. Get linked PR to inherit selectedItemIds if not in body/source run
    const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
    const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);

    // 3. Determine selectedItemIds: body > source run > linked PR > error
    const selectedItemIds = bodySelectedIds?.length
      ? bodySelectedIds
      : (sourceSelectedItemIds?.length
        ? sourceSelectedItemIds
        : (linkedPR?.selectedItemIds ?? []));
    if (selectedItemIds.length === 0) {
      return json({ ok: false, error: "no_selected_items" }, 400, origin);
    }

    // 4. GitHub token — OAuth first, App installation token fallback (private repos).
    if (!c.env.CONCLAVE_TOKEN_KEK) {
      return json({ ok: false, error: "token_unavailable" }, 503, origin);
    }
    const conn = await getGitHubConnectionByUserKey(c.env, userKey).catch(() => null);
    if (!conn) return json({ ok: false, error: "not_connected" }, 401, origin);
    const access = await resolveRepoAccessToken(c.env, userKey, repo.repoOwner, repo.repoName, fetchImpl, { repoPrivate: repo.private });
    if (!access.ok) {
      if (access.error === "not_connected") return json({ ok: false, error: "not_connected" }, 401, origin);
      return json({ ok: false, error: access.error }, 503, origin);
    }
    const token = access.token;

    // 5. Load items + productSpec: prefer body payload, fall back to D1
    let items: CheckableItem[];
    let productSpec: ProductSpecForCheck;
    const bodyItems = b["items"];
    const bodySpec = b["productSpec"];

    if (Array.isArray(bodyItems) && bodyItems.length > 0 && bodySpec && typeof bodySpec === "object") {
      // Normalize at the boundary — a partial spec (missing array fields) would otherwise
      // crash the review heuristics with an opaque "reading 'some'" error.
      items = normalizeCheckableItems(bodyItems);
      productSpec = normalizeProductSpec(bodySpec);
    } else {
      const dbProj = await getProject(c.env, projectId).catch(() => null);
      if (!dbProj) return json({ ok: false, error: "project_not_found" }, 404, origin);
      items = normalizeCheckableItems(dbProj.items);
      productSpec = normalizeProductSpec(dbProj.productSpec);
    }

    // Filter to selectedItemIds only
    const itemsToReview = items.filter((item) => selectedItemIds.includes(item.id));
    if (itemsToReview.length === 0) {
      return json({ ok: false, error: "no_matching_items" }, 400, origin);
    }

    // 5b. Credit enforcement (blocks with HTTP 402 when ENABLE_CREDIT_BLOCKING+ENABLE_ACTUAL_CREDIT_DEBITS=true)
    // Stage 27: extract idempotency key (header priority > body fallback), validate, build sourceEventId
    const idempotencyKeyHeader = c.req.header("Idempotency-Key") ?? null;
    const idempotencyKeyBody = typeof b["idempotencyKey"] === "string" ? b["idempotencyKey"] : null;
    const rawIdempotencyKey = idempotencyKeyHeader ?? idempotencyKeyBody ?? null;

    if (rawIdempotencyKey !== null && !validateIdempotencyKey(rawIdempotencyKey)) {
      return json({ ok: false, error: "invalid_idempotency_key" }, 400, origin);
    }

    let prReviewExecutionId: string;
    if (rawIdempotencyKey) {
      prReviewExecutionId = await buildPrReviewDebitSourceEventId({
        projectId,
        repoFullName: repo.repoFullName,
        prNumber,
        userKey,
        idempotencyKey: rawIdempotencyKey,
      });
    } else {
      prReviewExecutionId = generateDebitId();
    }

    let creditEnforcement: CreditEnforcementResult | CreditEnforcementDryRun | undefined;
    try {
      // Paid GitHub Marketplace plan raises the monthly included runs.
      // Fail-safe: any lookup error → null → base free allowance only.
      const entitlement = await getMarketplaceEntitlement(c.env, userKey);
      const enfResult = await checkCreditEnforcement({
        env: c.env,
        userKey,
        eventType: "workspace_pr_review_run",
        projectId,
        sourceEventId: prReviewExecutionId,
        entitlement,
      });
      creditEnforcement = {
        ...enfResult,
        idempotency: {
          provided: rawIdempotencyKey !== null,
          keyAccepted: rawIdempotencyKey !== null,
          sourceEventId: prReviewExecutionId,
        },
      };
      if ((creditEnforcement as CreditEnforcementResult).blocked) {
        return json({
          ok: false,
          error: "insufficient_credits",
          creditEnforcement,
          message: (creditEnforcement as CreditEnforcementResult).message,
        }, 402, origin);
      }
    } catch (err) {
      console.warn("[workspace/pr-review] credit enforcement failed (non-fatal):", err);
    }

    // 6. Insert run as running (with rerun lineage if applicable)
    const run = await insertReviewRun(c.env, {
      projectId, userKey,
      repoFullName: repo.repoFullName,
      prNumber,
      linkedPrId: linkedPR?.id,
      selectedItemIds,
      status: "running",
      rerunOfReviewRunId: rerunOfReviewRunId,
    }).catch(() => null);
    if (!run) return json({ ok: false, error: "run_create_failed" }, 500, origin);

    // 7. Fetch PR files
    const [owner, repoName] = repo.repoFullName.split("/");
    const warnings: string[] = [];
    let prFilesResult;
    try {
      prFilesResult = await fetchPRFiles(owner ?? "", repoName ?? "", prNumber, token, fetchImpl);
      warnings.push(...prFilesResult.warnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateReviewRun(c.env, run.id, { status: "error", errorMessage: `PR 파일 가져오기 실패: ${msg}` });
      return json({ ok: false, error: "pr_fetch_failed", details: msg }, 502, origin);
    }

    // 8. Run review
    let reviewResult;
    try {
      reviewResult = await reviewPRAgainstItems(
        {
          projectId,
          productSpec,
          items: itemsToReview,
          prMeta: prFilesResult.meta,
          prFiles: prFilesResult.files,
          locale: reviewLocale,
        },
        c.env.ANTHROPIC_API_KEY,
        fetchImpl,
      );
      if (reviewResult.warnings?.length) warnings.push(...reviewResult.warnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateReviewRun(c.env, run.id, { status: "error", errorMessage: `리뷰 실행 실패: ${msg}` });
      return json({ ok: false, error: "review_failed", details: msg }, 500, origin);
    }

    // 9. Determine final status + store
    const finalStatus = deriveRunStatus(reviewResult.results);
    await updateReviewRun(c.env, run.id, {
      status: finalStatus,
      resultJson: JSON.stringify(reviewResult),
    });

    // 9b. Record review run usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_pr_review_run",
      metadata: { source: reviewResult.source, prNumber, repoFullName: repo.repoFullName, ...reviewResult.summary },
    });

    // 9c. Capture the raw training triplet (diff + council verdict) for a future
    // fine-tune / distillation. Opt-in only: no-op without active consent or an
    // EVIDENCE bucket, and never throws (best-effort telemetry).
    // region from the edge (Cloudflare adds request.cf.country — coarse, not PII);
    // locale from the review request. Other envelope tags land in STEP 2/3.
    const cfCountry = (c.req.raw as { cf?: { country?: string } }).cf?.country ?? null;
    await captureTrainingRecord(c.env, {
      userKey,
      projectId,
      reviewRunId: run.id,
      repoFullName: repo.repoFullName,
      prNumber,
      headSha: prFilesResult.meta.headSha,
      productSpec,
      items: itemsToReview,
      prFiles: prFilesResult.files,
      review: reviewResult,
      finalStatus,
      rerunOfReviewRunId,
      envelope: {
        region: cfCountry,
        locale: reviewLocale,
      },
    }).catch(() => {});

    // 10. Telegram notification (non-blocking: failure must not fail the review response)
    await (async () => {
      try {
        const settings = await getNotificationSettings(c.env, userKey, "telegram").catch(() => null);
        if (!settings || !settings.enabled || settings.notifyPolicy === "disabled") return;

        const hasProblems =
          reviewResult.summary.failed > 0 ||
          reviewResult.summary.inconclusive > 0 ||
          reviewResult.summary.needsDecision > 0;

        if (settings.notifyPolicy === "problems_only" && !hasProblems) {
          await insertNotificationRecord(c.env, {
            userKey,
            projectId,
            channel: "telegram",
            eventType: "pr_review_complete",
            status: "skipped",
            destinationPreview: `chat:${settings.chatId}`,
          });
          return;
        }

        const problematicItems = reviewResult.results
          .filter((r) => r.status !== "passed")
          .map((r) => ({ title: r.title, status: r.status }));

        const dashboardBase = c.env.DASHBOARD_BASE_URL ?? DEFAULT_DASHBOARD_URL;
        const message = buildPrReviewTelegramMessage({
          repoFullName: repo.repoFullName,
          prNumber,
          summary: reviewResult.summary,
          problematicItems,
          dashboardUrl: `${dashboardBase}/projects/${projectId}/github`,
        });

        const sendResult = await sendWorkspaceTelegramMessage(c.env, settings.chatId, message, fetchImpl);

        await insertNotificationRecord(c.env, {
          userKey,
          projectId,
          channel: "telegram",
          eventType: "pr_review_complete",
          status: sendResult.ok ? "sent" : "error",
          destinationPreview: `chat:${settings.chatId}`,
          messagePreview: message.slice(0, 100),
          errorMessage: sendResult.ok ? undefined : sendResult.error,
        });

        await insertUsageEvent(c.env, {
          userKey,
          projectId,
          eventType: sendResult.ok
            ? "workspace_telegram_notification_sent"
            : "workspace_telegram_notification_error",
        });

        if (!sendResult.ok) {
          warnings.push("telegram_notification_failed");
        }
      } catch (err) {
        console.warn("[workspace/pr-review] telegram notification failed:", err);
      }
    })();

    // 10b. Email notification (Resend) — self-contained + non-fatal; dormant
    // until RESEND_API_KEY is set. Settings lookup, policy, history record and
    // usage event all live inside the helper (workspace/email-notify.ts).
    await notifyPrReviewCompleteByEmail(c.env, {
      userKey,
      projectId,
      repoFullName: repo.repoFullName,
      prNumber,
      summary: reviewResult.summary,
      results: reviewResult.results.map((r) => ({ title: r.title, status: r.status })),
    }, fetchImpl);

    // 11. Build rerun metadata + comparison if applicable
    let rerunMeta: { ofReviewRunId: string; reusedSelectedItemIds: string[] } | undefined;
    let comparisonToSourceRun: SpecificRunComparison | undefined;
    if (rerunOfReviewRunId && sourceRunForRerun) {
      const reusedFromSource = !bodySelectedIds?.length && Boolean(sourceSelectedItemIds?.length);
      rerunMeta = {
        ofReviewRunId: rerunOfReviewRunId,
        reusedSelectedItemIds: reusedFromSource ? (sourceSelectedItemIds ?? []) : [],
      };
      const sourceResults = parseRunResults(sourceRunForRerun.resultJson);
      const newResults = reviewResult.results as Array<{ itemId: string; title: string; status: "passed" | "failed" | "inconclusive" | "needs_decision"; reason: string }>;
      comparisonToSourceRun = compareSpecificReviewRuns(
        { id: rerunOfReviewRunId, results: sourceResults },
        { id: run.id, results: newResults },
      );
    }

    return json({
      ok: true,
      run: {
        id: run.id,
        status: finalStatus,
        projectId,
        repoFullName: repo.repoFullName,
        prNumber,
        selectedItemIds,
        rerunOfReviewRunId: rerunOfReviewRunId ?? undefined,
        summary: reviewResult.summary,
        results: reviewResult.results,
        createdAt: run.createdAt,
        updatedAt: new Date().toISOString(),
      },
      rerun: rerunMeta,
      comparisonToSourceRun,
      creditEnforcement,
      warnings: warnings.length ? warnings : undefined,
    }, 200, origin);
  });

  // ── GET /workspace/projects/:id/github/pulls/:number/review?userKey=... ──
  // Return the latest review run for a PR.
  app.get("/workspace/projects/:id/github/pulls/:number/review", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: true, run: null }, 200, origin);

    try {
      const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber);
      if (!run) return json({ ok: true, run: null }, 200, origin);

      // Parse stored result if available
      let reviewResult;
      if (run.resultJson) {
        try { reviewResult = JSON.parse(run.resultJson) as { summary?: unknown; results?: unknown[] }; } catch { /* ignored */ }
      }

      return json({
        ok: true,
        run: {
          id: run.id,
          status: run.status,
          repoFullName: run.repoFullName,
          prNumber: run.prNumber,
          selectedItemIds: run.selectedItemIds,
          summary: reviewResult?.summary ?? undefined,
          results: reviewResult?.results ?? undefined,
          errorMessage: run.errorMessage ?? undefined,
          updatedAt: run.updatedAt,
        },
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/pulls/review GET] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── POST /workspace/projects/:id/github/pulls/:number/fix-brief ─────────
  // Generate a deterministic PR Fix Pack from an existing review run.
  app.post("/workspace/projects/:id/github/pulls/:number/fix-brief", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const target: FixBriefTarget =
      b["target"] === "claude_code" || b["target"] === "codex" ? b["target"] : "both";
    const reviewRunId = typeof b["reviewRunId"] === "string" ? b["reviewRunId"] : undefined;

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 2. Get review run — specific run if reviewRunId provided, else latest
    let reviewResults: Array<{ itemId: string; title: string; status: string; reason: string; evidence: string[]; nextAction: string }> = [];
    let runId: string;
    let runCreatedAt: string;
    let runStatus: string;
    let runSelectedItemIds: string[];
    let runSummaryForSource: { passed: number; failed: number; inconclusive: number; needsDecision: number };

    if (reviewRunId) {
      const loaded = await loadPRReviewRunForAction({
        env: c.env, projectId, repoFullName: repo.repoFullName, prNumber, reviewRunId,
      });
      if (!loaded.ok) {
        const status = loaded.error === "review_run_not_found" || loaded.error === "review_run_mismatch" ? 404 : 400;
        return json({ ok: false, error: loaded.error }, status, origin);
      }
      reviewResults = loaded.run.results as typeof reviewResults;
      runId = loaded.run.id;
      runCreatedAt = loaded.run.createdAt;
      runStatus = loaded.run.status;
      runSelectedItemIds = loaded.run.selectedItemIds;
      runSummaryForSource = loaded.run.summary;
    } else {
      const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
      if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);
      if (run.resultJson) {
        try {
          const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
          if (Array.isArray(parsed.results)) reviewResults = parsed.results as typeof reviewResults;
        } catch { /* ignored */ }
      }
      runId = run.id;
      runCreatedAt = run.createdAt;
      runStatus = run.status;
      runSelectedItemIds = run.selectedItemIds;
      const parsed2 = run.resultJson ? (() => { try { return JSON.parse(run.resultJson) as { summary?: { passed?: number; failed?: number; inconclusive?: number; needsDecision?: number } }; } catch { return {}; } })() : {};
      runSummaryForSource = {
        passed: Number(parsed2.summary?.passed ?? 0),
        failed: Number(parsed2.summary?.failed ?? 0),
        inconclusive: Number(parsed2.summary?.inconclusive ?? 0),
        needsDecision: Number(parsed2.summary?.needsDecision ?? 0),
      };
    }

    if (reviewResults.length === 0) {
      return json({ ok: false, error: "no_review_results" }, 400, origin);
    }

    // 4. Determine selectedItemIds: body > linked PR run > all fixable
    const fixableItemIds = reviewResults
      .filter((r) => ["failed", "inconclusive", "needs_decision"].includes(r.status))
      .map((r) => r.itemId);

    const selectedItemIds = bodySelectedIds?.length
      ? bodySelectedIds
      : (runSelectedItemIds.length ? runSelectedItemIds.filter((id) => fixableItemIds.includes(id)) : fixableItemIds);

    if (selectedItemIds.length === 0) {
      return json({ ok: false, error: "no_fixable_items" }, 400, origin);
    }

    // 5. Load project for spec + items
    const dbProj = await getProject(c.env, projectId).catch(() => null);
    const bodySpec = b["productSpec"];
    const bodyItems = b["items"];

    const productSpec = (bodySpec && typeof bodySpec === "object"
      ? bodySpec
      : (dbProj?.productSpec ?? {})) as { productName?: string; oneLine?: string; included?: string[]; excluded?: string[]; openQuestions?: string[] };
    const allItems = (Array.isArray(bodyItems) && bodyItems.length > 0
      ? bodyItems
      : (Array.isArray(dbProj?.items) ? (dbProj!.items as unknown[]) : [])) as FixBriefItem[];

    // Need prMeta — get it from the linked PR or reconstruct from run
    const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
    const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);

    const prMeta = {
      number: prNumber,
      title: linkedPR?.prTitle ?? `PR #${prNumber}`,
      state: linkedPR?.prState ?? "open",
      headBranch: linkedPR?.prHeadBranch ?? "feature",
      baseBranch: linkedPR?.prBaseBranch ?? "main",
      headSha: "",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    };

    // 6. Generate brief
    const result = generatePRFixBrief({
      projectId,
      productSpec: {
        productName: productSpec.productName ?? "제품",
        oneLine: productSpec.oneLine,
        included: productSpec.included,
        excluded: productSpec.excluded,
        openQuestions: productSpec.openQuestions,
      },
      allItems,
      selectedItemIds,
      reviewResults: reviewResults.map((r) => ({
        itemId: r.itemId,
        title: r.title,
        status: r.status as "passed" | "failed" | "inconclusive" | "needs_decision",
        userLabel: ({ passed: "통과", failed: "안 맞음", inconclusive: "확인 부족", needs_decision: "결정 필요" } as Record<string, "통과" | "안 맞음" | "확인 부족" | "결정 필요">)[r.status] ?? "확인 부족",
        reason: r.reason,
        evidence: r.evidence,
        nextAction: r.nextAction,
      })),
      prMeta,
      repoFullName: repo.repoFullName,
      runId: runId,
      target,
    });

    return json({
      ...result,
      sourceReviewRun: {
        id: runId,
        createdAt: runCreatedAt,
        status: runStatus,
        summary: runSummaryForSource,
      },
    }, 200, origin);
  });

  // ── POST /workspace/projects/:id/github/pulls/:number/comment/preview ────
  // Generate a comment body preview without posting to GitHub.
  app.post("/workspace/projects/:id/github/pulls/:number/comment/preview", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const includeFixBrief = b["includeFixBrief"] === true;
    const includeComparison = b["includeComparison"] === true;
    const includeRerunComparison = b["includeRerunComparison"] === true;
    const reviewRunId = typeof b["reviewRunId"] === "string" ? b["reviewRunId"] : undefined;
    // Comment body language — optional, "en" | "ko", defaults to "ko".
    const locale: "en" | "ko" = b["locale"] === "en" ? "en" : "ko";

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 2. Get review run — specific run if reviewRunId provided, else latest
    let reviewResults: CommentResultItem[] = [];
    let runSelectedItemIds: string[];
    let runTimestamp: string | undefined;
    let loadedRerunOfReviewRunId: string | undefined;

    const warnings: string[] = [];

    if (reviewRunId) {
      const loaded = await loadPRReviewRunForAction({
        env: c.env, projectId, repoFullName: repo.repoFullName, prNumber, reviewRunId,
      });
      if (!loaded.ok) {
        const status = loaded.error === "review_run_not_found" || loaded.error === "review_run_mismatch" ? 404 : 400;
        return json({ ok: false, error: loaded.error }, status, origin);
      }
      reviewResults = loaded.run.results as CommentResultItem[];
      runSelectedItemIds = loaded.run.selectedItemIds;
      runTimestamp = loaded.run.createdAt;
      loadedRerunOfReviewRunId = loaded.run.rerunOfReviewRunId;
      // latest-two comparison is meaningless for a specific historical run
      if (includeComparison) warnings.push("comparison_not_available_for_specific_run");
    } else {
      const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
      if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);
      if (run.resultJson) {
        try {
          const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
          if (Array.isArray(parsed.results)) reviewResults = parsed.results as CommentResultItem[];
        } catch { /* ignored */ }
      }
      runSelectedItemIds = run.selectedItemIds;
    }

    if (reviewResults.length === 0) {
      return json({ ok: false, error: "no_review_results" }, 400, origin);
    }

    // 3. Determine selectedItemIds
    const selectedItemIds = bodySelectedIds?.length ? bodySelectedIds : runSelectedItemIds;
    const selectedItems = reviewResults.filter((r) => selectedItemIds.includes(r.itemId));
    const summary = {
      failed: selectedItems.filter((r) => r.status === "failed").length,
      inconclusive: selectedItems.filter((r) => r.status === "inconclusive").length,
      needsDecision: selectedItems.filter((r) => r.status === "needs_decision").length,
      passed: selectedItems.filter((r) => r.status === "passed").length,
    };

    // 4. Get PR title
    const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
    const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);
    const prTitle = linkedPR?.prTitle ?? `PR #${prNumber}`;

    // 5a. Load rerun comparison if requested (takes priority over latest-two comparison)
    let rerunComparisonData: SpecificRunComparison | undefined;
    if (includeRerunComparison) {
      if (!reviewRunId) {
        warnings.push("rerun_comparison_requires_review_run_id");
      } else if (!loadedRerunOfReviewRunId) {
        warnings.push("rerun_source_not_available");
      } else {
        try {
          const sourceRun = await getReviewRunById(c.env, loadedRerunOfReviewRunId);
          if (!sourceRun) {
            warnings.push("rerun_source_not_available");
          } else {
            const sourceResults = parseRunResults(sourceRun.resultJson);
            rerunComparisonData = compareSpecificReviewRuns(
              { id: loadedRerunOfReviewRunId, results: sourceResults },
              { id: reviewRunId, results: reviewResults as Array<{ itemId: string; title: string; status: "passed" | "failed" | "inconclusive" | "needs_decision"; reason: string }> },
              locale,
            );
            if (!rerunComparisonData.comparable) warnings.push("rerun_comparison_not_available");
          }
        } catch {
          warnings.push("rerun_comparison_not_available");
        }
      }
      if (includeComparison) warnings.push("latest_comparison_skipped_because_rerun_comparison_requested");
    }

    // 5b. Load latest-two comparison (only when rerun comparison NOT active)
    let comparisonData: ComparisonDataForComment | undefined;
    if (includeComparison && !reviewRunId && !includeRerunComparison) {
      const comp = await loadComparisonForComment(c.env, projectId, repo.repoFullName, prNumber, locale);
      if (comp.warning === "not_enough_runs") warnings.push("not_enough_runs");
      else if (comp.data) comparisonData = comp.data;
    }

    // 6. Build body
    const { body: commentBody, truncated, comparisonIncluded, rerunComparisonIncluded } = buildCommentBody({
      repoFullName: repo.repoFullName,
      prNumber,
      prTitle,
      selectedItems,
      summary,
      includeFixBrief,
      includeComparison: includeComparison && !reviewRunId && !includeRerunComparison,
      comparisonData,
      runTimestamp,
      includeRerunComparison,
      rerunComparisonData,
      locale,
    });
    if (truncated) warnings.push("코멘트가 너무 길어 일부 내용이 잘렸습니다.");
    if (includeComparison && !reviewRunId && comparisonData && !comparisonIncluded && !includeRerunComparison) warnings.push("비교 섹션이 너무 길어 생략됐습니다.");
    if (includeRerunComparison && rerunComparisonData && !rerunComparisonIncluded) warnings.push("rerun_comparison_section_omitted_due_to_length");

    return json({
      ok: true,
      comment: { body: commentBody, selectedItemIds, summary },
      warnings: warnings.length ? warnings : undefined,
    }, 200, origin);
  });

  // ── POST /workspace/projects/:id/github/pulls/:number/comment ─────────────
  // Post a comment to the GitHub PR and record it in D1.
  app.post("/workspace/projects/:id/github/pulls/:number/comment", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    // Per-userKey hourly rate limit for GitHub comment writes.
    const commentLimit = hourlyLimitFromEnv(c.env.WORKSPACE_PR_COMMENT_HOURLY_LIMIT, DEFAULT_PR_COMMENT_HOURLY_LIMIT);
    const limited = await denyIfRateLimited(c.env, "workspace-pr-comment", userKey, commentLimit, origin);
    if (limited) return limited;

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const customBody = typeof b["body"] === "string" ? b["body"] : undefined;
    const includeFixBrief = b["includeFixBrief"] === true;
    const includeComparison = b["includeComparison"] === true;
    const includeRerunComparison = b["includeRerunComparison"] === true;
    const reviewRunId = typeof b["reviewRunId"] === "string" ? b["reviewRunId"] : undefined;
    // mode: "new" = always create new comment, "update_latest" = update most recent posted comment
    const mode: "new" | "update_latest" = b["mode"] === "update_latest" ? "update_latest" : "new";
    // Comment body language — optional, "en" | "ko", defaults to "ko".
    const locale: "en" | "ko" = b["locale"] === "en" ? "en" : "ko";

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 2. Get review run — validate before token ops so mismatch fails fast
    let reviewResults: CommentResultItem[] = [];
    let runSelectedItemIds: string[];
    let runTimestamp: string | undefined;
    let postLoadedRerunOfReviewRunId: string | undefined;

    if (reviewRunId) {
      const loaded = await loadPRReviewRunForAction({
        env: c.env, projectId, repoFullName: repo.repoFullName, prNumber, reviewRunId,
      });
      if (!loaded.ok) {
        const status = loaded.error === "review_run_not_found" || loaded.error === "review_run_mismatch" ? 404 : 400;
        return json({ ok: false, error: loaded.error }, status, origin);
      }
      reviewResults = loaded.run.results as CommentResultItem[];
      runSelectedItemIds = loaded.run.selectedItemIds;
      runTimestamp = loaded.run.createdAt;
      postLoadedRerunOfReviewRunId = loaded.run.rerunOfReviewRunId;
    } else {
      const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
      if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);
      if (run.resultJson) {
        try {
          const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
          if (Array.isArray(parsed.results)) reviewResults = parsed.results as CommentResultItem[];
        } catch { /* ignored */ }
      }
      runSelectedItemIds = run.selectedItemIds;
    }

    // 3. GitHub connection + scope check + token decryption
    if (!c.env.CONCLAVE_TOKEN_KEK) {
      return json({ ok: false, error: "token_unavailable" }, 503, origin);
    }
    const conn = await getGitHubConnectionByUserKey(c.env, userKey).catch(() => null);
    if (!conn) return json({ ok: false, error: "not_connected" }, 401, origin);

    if (!hasPrCommentScope(conn.scopes)) {
      return json({
        ok: false,
        error: "github_scope_required",
        message: "GitHub PR에 코멘트를 남기려면 권한을 다시 연결해야 해요.",
      }, 403, origin);
    }

    // OAuth-first, App-fallback token resolution (private repos via the App).
    const access = await resolveRepoAccessToken(c.env, userKey, repo.repoOwner, repo.repoName, fetchImpl, { repoPrivate: repo.private });
    if (!access.ok) {
      if (access.error === "not_connected") return json({ ok: false, error: "not_connected" }, 401, origin);
      return json({ ok: false, error: access.error }, 503, origin);
    }
    const token = access.token;

    // 4. Build or use provided body
    const selectedItemIds = bodySelectedIds?.length ? bodySelectedIds : runSelectedItemIds;
    const selectedItems = reviewResults.filter((r) => selectedItemIds.includes(r.itemId));

    let commentBody: string;
    if (customBody) {
      commentBody = customBody;
    } else {
      const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
      const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);
      const prTitle = linkedPR?.prTitle ?? `PR #${prNumber}`;
      const summary = {
        failed: selectedItems.filter((r) => r.status === "failed").length,
        inconclusive: selectedItems.filter((r) => r.status === "inconclusive").length,
        needsDecision: selectedItems.filter((r) => r.status === "needs_decision").length,
        passed: selectedItems.filter((r) => r.status === "passed").length,
      };

      // Rerun comparison (takes priority over latest-two)
      let postRerunComparisonData: SpecificRunComparison | undefined;
      if (includeRerunComparison && reviewRunId && postLoadedRerunOfReviewRunId) {
        try {
          const sourceRun = await getReviewRunById(c.env, postLoadedRerunOfReviewRunId);
          if (sourceRun) {
            const sourceResults = parseRunResults(sourceRun.resultJson);
            postRerunComparisonData = compareSpecificReviewRuns(
              { id: postLoadedRerunOfReviewRunId, results: sourceResults },
              { id: reviewRunId, results: reviewResults as Array<{ itemId: string; title: string; status: "passed" | "failed" | "inconclusive" | "needs_decision"; reason: string }> },
              locale,
            );
          }
        } catch { /* ignore — build without rerun comparison */ }
      }

      let comparisonData: ComparisonDataForComment | undefined;
      if (includeComparison && !reviewRunId && !includeRerunComparison) {
        const comp = await loadComparisonForComment(c.env, projectId, repo.repoFullName, prNumber, locale);
        if (comp.data) comparisonData = comp.data;
      }
      const { body: built } = buildCommentBody({
        repoFullName: repo.repoFullName, prNumber, prTitle, selectedItems, summary,
        includeFixBrief,
        includeComparison: includeComparison && !reviewRunId && !includeRerunComparison,
        comparisonData,
        runTimestamp,
        includeRerunComparison,
        rerunComparisonData: postRerunComparisonData,
        locale,
      });
      commentBody = built;
    }

    const preview = bodyPreview(commentBody);
    const [owner, repoName] = repo.repoFullName.split("/");

    // 6a. update_latest mode — find existing posted comment and PATCH it
    if (mode === "update_latest") {
      const latestPosted = await getLatestPostedComment(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
      if (latestPosted?.githubCommentId) {
        const updateResult = await updateGitHubComment(
          { owner: owner ?? "", repo: repoName ?? "", githubCommentId: latestPosted.githubCommentId, body: commentBody, token },
          fetchImpl,
        );

        if (!updateResult.ok) {
          const errStatus = updateResult.status;
          await updatePrComment(c.env, latestPosted.id, { status: "error", errorMessage: updateResult.error });

          if (errStatus === 403) {
            return json({ ok: false, error: "github_scope_required", message: "GitHub 권한이 부족하거나 접근할 수 없는 저장소예요." }, 403, origin);
          }
          if (errStatus === 404) {
            return json({ ok: false, error: "comment_not_found", message: "업데이트할 코멘트를 GitHub에서 찾을 수 없어요. 이미 삭제됐거나 접근할 수 없는 코멘트예요." }, 404, origin);
          }
          return json({ ok: false, error: "github_update_failed", details: updateResult.error }, 502, origin);
        }

        await updatePrComment(c.env, latestPosted.id, {
          status: "posted",
          githubCommentId: updateResult.id,
          githubCommentUrl: updateResult.url,
          bodyPreview: preview,
        });

        // Record usage event (non-fatal)
        await insertUsageEvent(c.env, {
          userKey,
          projectId,
          eventType: "workspace_pr_comment_updated",
          metadata: { commentId: latestPosted.id, githubCommentId: updateResult.id, repoFullName: repo.repoFullName, prNumber },
        });

        return json({
          ok: true,
          updated: true,
          comment: {
            id: latestPosted.id,
            status: "posted",
            githubCommentId: updateResult.id,
            githubCommentUrl: updateResult.url,
            bodyPreview: preview,
            updatedAt: new Date().toISOString(),
          },
        }, 200, origin);
      }
      // No existing posted comment → fall through to create new one
    }

    // 6b. Insert draft record (new comment)
    const dbComment = await insertPrComment(c.env, {
      projectId, userKey,
      repoFullName: repo.repoFullName,
      prNumber,
      reviewRunId: reviewRunId ?? undefined,
      selectedItemIds,
      bodyPreview: preview,
      status: "draft",
    }).catch(() => null);
    if (!dbComment) return json({ ok: false, error: "comment_create_failed" }, 500, origin);

    // 7. Post to GitHub
    const postResult = await postGitHubComment(
      { owner: owner ?? "", repo: repoName ?? "", issueNumber: prNumber, body: commentBody, token },
      fetchImpl,
    );

    if (!postResult.ok) {
      const errStatus = postResult.status;
      await updatePrComment(c.env, dbComment.id, {
        status: "error",
        errorMessage: postResult.error,
      });

      if (errStatus === 403) {
        return json({
          ok: false,
          error: "github_scope_required",
          message: "GitHub 권한이 부족하거나 접근할 수 없는 저장소예요. 공개 저장소인지 확인하거나 GitHub 권한을 다시 연결해주세요.",
        }, 403, origin);
      }
      if (errStatus === 404) {
        return json({
          ok: false,
          error: "repo_not_found",
          message: "GitHub 권한이 부족하거나 접근할 수 없는 저장소예요. 공개 저장소인지 확인하거나 GitHub 권한을 다시 연결해주세요.",
        }, 404, origin);
      }
      return json({ ok: false, error: "github_post_failed", details: postResult.error }, 502, origin);
    }

    // 8. Update record with posted result
    await updatePrComment(c.env, dbComment.id, {
      status: "posted",
      githubCommentId: postResult.id,
      githubCommentUrl: postResult.url,
    });

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_pr_comment_posted",
      metadata: { commentId: dbComment.id, githubCommentId: postResult.id, repoFullName: repo.repoFullName, prNumber },
    });

    return json({
      ok: true,
      updated: false,
      comment: {
        id: dbComment.id,
        status: "posted",
        githubCommentId: postResult.id,
        githubCommentUrl: postResult.url,
        bodyPreview: preview,
        createdAt: dbComment.createdAt,
      },
    }, 200, origin);
  });

  // ── GET /workspace/projects/:id/github/pulls/:number/comments?userKey=... ─
  // List comment records for a PR (most recent first).
  app.get("/workspace/projects/:id/github/pulls/:number/comments", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: true, comments: [], latestPostedComment: null }, 200, origin);

    try {
      const [comments, latestPosted] = await Promise.all([
        getPrComments(c.env, projectId, repo.repoFullName, prNumber),
        getLatestPostedComment(c.env, projectId, repo.repoFullName, prNumber),
      ]);
      return json({
        ok: true,
        comments: comments.map((c2) => ({
          id: c2.id,
          status: c2.status,
          githubCommentId: c2.githubCommentId,
          githubCommentUrl: c2.githubCommentUrl,
          bodyPreview: c2.bodyPreview,
          errorMessage: c2.errorMessage,
          createdAt: c2.createdAt,
          updatedAt: c2.updatedAt,
        })),
        latestPostedComment: latestPosted ? {
          id: latestPosted.id,
          githubCommentId: latestPosted.githubCommentId,
          githubCommentUrl: latestPosted.githubCommentUrl,
          bodyPreview: latestPosted.bodyPreview,
          updatedAt: latestPosted.updatedAt,
        } : null,
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/pulls/comments GET] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── GET /workspace/projects/:id/github/pulls/:number/review/compare ─────────
  // Deterministic before/after comparison of the latest two completed review runs.
  app.get("/workspace/projects/:id/github/pulls/:number/review/compare", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    try {
      const [latest, previous] = await getLatestTwoPrReviewRuns(
        c.env, projectId, repo.repoFullName, prNumber,
      );

      // Not enough completed runs
      if (!latest || !previous) {
        return json({ ok: true, comparable: false, reason: "not_enough_runs" }, 200, origin);
      }

      // Build summaries
      const latestSummary = buildRunSummary(latest);
      const previousSummary = buildRunSummary(previous);

      // Parse item-level results
      const latestResults = parseRunResults(latest.resultJson);
      const previousResults = parseRunResults(previous.resultJson);

      // Compute comparison
      const comparison = compareRunResults(previousResults, latestResults);

      // Record usage event (non-fatal) — userKey validated above.
      {
        await insertUsageEvent(c.env, {
          userKey,
          projectId,
          eventType: "workspace_pr_review_compared",
          metadata: {
            latestRunId: latest.id,
            previousRunId: previous.id,
            repoFullName: repo.repoFullName,
            prNumber,
            improvedCount: comparison.improved.length,
            newlyProblematicCount: comparison.newlyProblematic.length,
          },
        });
      }

      return json({
        ok: true,
        comparable: true,
        previousRun: previousSummary,
        latestRun: latestSummary,
        comparison,
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/pulls/review/compare] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── PATCH /workspace/projects/:id/github/pulls/:number/comment/:commentId ──
  // Update the body of an existing GitHub PR comment (re-generates or uses provided body).
  app.patch("/workspace/projects/:id/github/pulls/:number/comment/:commentId", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    const commentId = c.req.param("commentId");

    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }
    if (!commentId) return json({ ok: false, error: "commentId_required" }, 400, origin);

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    // Shares the comment-write bucket with POST …/comment.
    const commentLimit = hourlyLimitFromEnv(c.env.WORKSPACE_PR_COMMENT_HOURLY_LIMIT, DEFAULT_PR_COMMENT_HOURLY_LIMIT);
    const limited = await denyIfRateLimited(c.env, "workspace-pr-comment", userKey, commentLimit, origin);
    if (limited) return limited;

    const customBody = typeof b["body"] === "string" ? b["body"] : undefined;
    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const includeFixBrief = b["includeFixBrief"] === true;
    const includeComparison = b["includeComparison"] === true;
    // Comment body language — optional, "en" | "ko", defaults to "ko".
    const locale: "en" | "ko" = b["locale"] === "en" ? "en" : "ko";

    // 1. Get existing comment record
    const existingComment = await getPrCommentById(c.env, commentId).catch(() => null);
    if (!existingComment) return json({ ok: false, error: "comment_not_found" }, 404, origin);
    if (!existingComment.githubCommentId) {
      return json({ ok: false, error: "comment_not_posted" }, 400, origin);
    }

    // 2. GitHub connection + scope check
    if (!c.env.CONCLAVE_TOKEN_KEK) {
      return json({ ok: false, error: "token_unavailable" }, 503, origin);
    }
    const conn = await getGitHubConnectionByUserKey(c.env, userKey).catch(() => null);
    if (!conn) return json({ ok: false, error: "not_connected" }, 401, origin);

    if (!hasPrCommentScope(conn.scopes)) {
      return json({
        ok: false,
        error: "github_scope_required",
        message: "GitHub PR에 코멘트를 남기려면 권한을 다시 연결해야 해요.",
      }, 403, origin);
    }

    // 3. Build updated body (repo first — the token resolver needs owner/repo
    // for the OAuth-first/App-fallback probe on private repos).
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    const access = await resolveRepoAccessToken(c.env, userKey, repo.repoOwner, repo.repoName, fetchImpl, { repoPrivate: repo.private });
    if (!access.ok) {
      if (access.error === "not_connected") return json({ ok: false, error: "not_connected" }, 401, origin);
      return json({ ok: false, error: access.error }, 503, origin);
    }
    const token = access.token;

    let commentBody: string;
    if (customBody) {
      commentBody = customBody;
    } else {
      // Re-generate from latest review run
      const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
      if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);

      let reviewResults: CommentResultItem[] = [];
      if (run.resultJson) {
        try {
          const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
          if (Array.isArray(parsed.results)) reviewResults = parsed.results as CommentResultItem[];
        } catch { /* ignored */ }
      }

      const selectedItemIds = bodySelectedIds?.length ? bodySelectedIds : existingComment.selectedItemIds;
      const selectedItems = reviewResults.filter((r) => selectedItemIds.includes(r.itemId));

      const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
      const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);
      const prTitle = linkedPR?.prTitle ?? `PR #${prNumber}`;
      const summary = {
        failed: selectedItems.filter((r) => r.status === "failed").length,
        inconclusive: selectedItems.filter((r) => r.status === "inconclusive").length,
        needsDecision: selectedItems.filter((r) => r.status === "needs_decision").length,
        passed: selectedItems.filter((r) => r.status === "passed").length,
      };
      let comparisonData: ComparisonDataForComment | undefined;
      if (includeComparison) {
        const comp = await loadComparisonForComment(c.env, projectId, repo.repoFullName, prNumber, locale);
        if (comp.data) comparisonData = comp.data;
      }
      const { body: built } = buildCommentBody({
        repoFullName: repo.repoFullName, prNumber, prTitle, selectedItems, summary,
        includeFixBrief, includeComparison, comparisonData,
        locale,
      });
      commentBody = built;
    }

    // 4. PATCH GitHub comment
    const [owner, repoName] = repo.repoFullName.split("/");
    const updateResult = await updateGitHubComment(
      { owner: owner ?? "", repo: repoName ?? "", githubCommentId: existingComment.githubCommentId, body: commentBody, token },
      fetchImpl,
    );

    const preview = bodyPreview(commentBody);

    if (!updateResult.ok) {
      await updatePrComment(c.env, commentId, { status: "error", errorMessage: updateResult.error, bodyPreview: preview });

      if (updateResult.status === 403) {
        return json({ ok: false, error: "github_scope_required", message: "GitHub 권한이 부족해요." }, 403, origin);
      }
      if (updateResult.status === 404) {
        return json({ ok: false, error: "comment_not_found", message: "GitHub에서 코멘트를 찾을 수 없어요. 이미 삭제됐을 수 있어요." }, 404, origin);
      }
      return json({ ok: false, error: "github_update_failed", details: updateResult.error }, 502, origin);
    }

    // 5. Update D1 record
    await updatePrComment(c.env, commentId, {
      status: "posted",
      githubCommentId: updateResult.id,
      githubCommentUrl: updateResult.url,
      bodyPreview: preview,
    });

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_pr_comment_updated",
      metadata: { commentId, githubCommentId: updateResult.id, repoFullName: repo.repoFullName, prNumber },
    });

    return json({
      ok: true,
      comment: {
        id: commentId,
        status: "posted",
        githubCommentId: updateResult.id,
        githubCommentUrl: updateResult.url,
        bodyPreview: preview,
        updatedAt: new Date().toISOString(),
      },
    }, 200, origin);
  });

  // ── GET /workspace/projects/:id/github/review/runs/:runId ───────────────
  // Project-level run lookup — no prNumber required in URL.
  // Validates that the run belongs to this project (projectId check only).
  // Used by /history/:runId dashboard route where prNumber isn't in the URL.
  app.get("/workspace/projects/:id/github/review/runs/:runId", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");
    if (!runId) return json({ ok: false, error: "run_id_required" }, 400, origin);

    const userKey = c.req.query("userKey");
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    try {
      const run = await getReviewRunById(c.env, runId);
      if (!run) return json({ ok: false, error: "run_not_found" }, 404, origin);

      // Validate ownership at project level
      if (run.projectId !== projectId) {
        return json({ ok: false, error: "run_not_found" }, 404, origin);
      }

      let summary: { passed: number; failed: number; inconclusive: number; needsDecision: number } = {
        passed: 0, failed: 0, inconclusive: 0, needsDecision: 0,
      };
      let results: unknown[] = [];
      if (run.resultJson) {
        try {
          const parsed = JSON.parse(run.resultJson) as {
            summary?: { passed?: number; failed?: number; inconclusive?: number; needsDecision?: number };
            results?: unknown[];
          };
          if (parsed.summary) {
            summary = {
              passed: Number(parsed.summary.passed ?? 0),
              failed: Number(parsed.summary.failed ?? 0),
              inconclusive: Number(parsed.summary.inconclusive ?? 0),
              needsDecision: Number(parsed.summary.needsDecision ?? 0),
            };
          }
          if (Array.isArray(parsed.results)) results = parsed.results;
        } catch { /* malformed JSON — return empty results */ }
      }

      return json({
        ok: true,
        projectId,
        repoFullName: run.repoFullName,
        prNumber: run.prNumber,
        run: {
          id: run.id,
          status: run.status,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          selectedItemIds: run.selectedItemIds,
          selectedItemCount: run.selectedItemIds.length,
          errorMessage: run.errorMessage ?? undefined,
          rerunOfReviewRunId: run.rerunOfReviewRunId ?? undefined,
          summary,
          results,
        },
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/review/runs/:runId GET] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId ──
  // Fetch a single review run by ID. Validates that the run belongs to this
  // project/repo/PR — returns 404 on mismatch so run IDs can't be guessed across projects.
  app.get("/workspace/projects/:id/github/pulls/:number/review/runs/:runId", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    const runId = c.req.param("runId");

    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }
    if (!runId) return json({ ok: false, error: "run_id_required" }, 400, origin);

    const userKey = c.req.query("userKey");
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 404, origin);

    try {
      const run = await getReviewRunById(c.env, runId);
      if (!run) return json({ ok: false, error: "run_not_found" }, 404, origin);

      // Validate ownership — prevent cross-project/PR snooping
      if (run.projectId !== projectId || run.repoFullName !== repo.repoFullName || run.prNumber !== prNumber) {
        return json({ ok: false, error: "run_not_found" }, 404, origin);
      }

      let summary: { passed: number; failed: number; inconclusive: number; needsDecision: number } = {
        passed: 0, failed: 0, inconclusive: 0, needsDecision: 0,
      };
      let results: unknown[] = [];
      if (run.resultJson) {
        try {
          const parsed = JSON.parse(run.resultJson) as {
            summary?: { passed?: number; failed?: number; inconclusive?: number; needsDecision?: number };
            results?: unknown[];
          };
          if (parsed.summary) {
            summary = {
              passed: Number(parsed.summary.passed ?? 0),
              failed: Number(parsed.summary.failed ?? 0),
              inconclusive: Number(parsed.summary.inconclusive ?? 0),
              needsDecision: Number(parsed.summary.needsDecision ?? 0),
            };
          }
          if (Array.isArray(parsed.results)) results = parsed.results;
        } catch { /* malformed JSON — return empty results */ }
      }

      return json({
        ok: true,
        projectId,
        repoFullName: run.repoFullName,
        prNumber: run.prNumber,
        run: {
          id: run.id,
          status: run.status,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          selectedItemIds: run.selectedItemIds,
          selectedItemCount: run.selectedItemIds.length,
          errorMessage: run.errorMessage ?? undefined,
          rerunOfReviewRunId: run.rerunOfReviewRunId ?? undefined,
          summary,
          results,
        },
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/pulls/review/runs/:runId GET] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── GET /workspace/projects/:id/github/pulls/:number/review/history ──────
  // List all review runs for a specific PR, newest first.
  // Query: userKey (required), limit (optional, 1-100, default 20)
  app.get("/workspace/projects/:id/github/pulls/:number/review/history", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

    const userKey = c.req.query("userKey");
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const limitParam = parseInt(c.req.query("limit") ?? "20", 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 20 : Math.min(limitParam, 100);

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: true, runs: [] }, 200, origin);

    try {
      const runs = await listPRReviewRuns(c.env, projectId, repo.repoFullName, prNumber, { limit });

      return json({
        ok: true,
        runs: runs.map((run) => {
          let summary: unknown = undefined;
          let results: unknown[] | undefined = undefined;
          if (run.resultJson) {
            try {
              const parsed = JSON.parse(run.resultJson) as { summary?: unknown; results?: unknown[] };
              summary = parsed.summary;
              results = parsed.results;
            } catch { /* ignored */ }
          }
          return {
            id: run.id,
            status: run.status,
            repoFullName: run.repoFullName,
            prNumber: run.prNumber,
            selectedItemIds: run.selectedItemIds,
            summary,
            results,
            errorMessage: run.errorMessage ?? undefined,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
          };
        }),
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/pulls/review/history GET] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  // ── GET /workspace/projects/:id/github/review-history ────────────────────
  // List all review runs for the entire project (all PRs), newest first.
  // Query: userKey (required), limit (optional, 1-200, default 50)
  app.get("/workspace/projects/:id/github/review-history", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");

    const userKey = c.req.query("userKey");
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const denied = await denyUnlessOwnedProject(c.env, projectId, userKey, origin);
    if (denied) return denied;

    const limitParam = parseInt(c.req.query("limit") ?? "50", 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 50 : Math.min(limitParam, 200);

    try {
      const runs = await listProjectReviewRuns(c.env, projectId, { limit });

      return json({
        ok: true,
        runs: runs.map((run) => {
          let summary: unknown = undefined;
          // Stage 41: lightweight rerunAction for the history-list quick re-run.
          // We extract only the recommended itemIds (failed / inconclusive /
          // needs_decision) — never the full results — so the list stays small.
          const results = parseRunResults(run.resultJson);
          let rerunAction: {
            recommendedItemIds: string[];
            recommendedItemCount: number;
            disabledReason?: "no_remaining_issues" | "results_unavailable";
          };
          if (results.length === 0) {
            rerunAction = { recommendedItemIds: [], recommendedItemCount: 0, disabledReason: "results_unavailable" };
          } else {
            const recommendedItemIds = recommendedRerunItemIds(results);
            rerunAction = recommendedItemIds.length > 0
              ? { recommendedItemIds, recommendedItemCount: recommendedItemIds.length }
              : { recommendedItemIds: [], recommendedItemCount: 0, disabledReason: "no_remaining_issues" };
          }
          if (run.resultJson) {
            try {
              const parsed = JSON.parse(run.resultJson) as { summary?: unknown };
              summary = parsed.summary;
            } catch { /* ignored */ }
          }
          return {
            id: run.id,
            status: run.status,
            repoFullName: run.repoFullName,
            prNumber: run.prNumber,
            selectedItemCount: run.selectedItemIds.length,
            summary,
            rerunAction,
            errorMessage: run.errorMessage ?? undefined,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
          };
        }),
      }, 200, origin);
    } catch (err) {
      console.error("[workspace/github/review-history GET] failed:", err);
      return json({ ok: false, error: "fetch_failed" }, 500, origin);
    }
  });

  return app;
}

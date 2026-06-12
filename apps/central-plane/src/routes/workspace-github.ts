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
import type { FetchLike } from "../github.js";
import { encryptToken, decryptToken } from "../crypto.js";
import {
  saveOAuthState, getOAuthState, markStateUsed,
  upsertGitHubConnection, getGitHubConnectionByUserKey,
  upsertProjectRepo, getProjectRepo,
} from "../workspace/github-db.js";
import {
  generateState, buildAuthUrl, exchangeCode,
  fetchGitHubUser, fetchGitHubRepos, fetchGitHubPulls,
  isAllowedReturnTo, appendGitHubConnected,
} from "../workspace/github-oauth.js";
import { upsertProjectPR, getLinkedPRs } from "../workspace/pr-db.js";
import {
  insertReviewRun, updateReviewRun, getLatestReviewRun, getLatestTwoPrReviewRuns,
} from "../workspace/pr-review-db.js";
import {
  compareRunResults, buildRunSummary, parseRunResults,
} from "../workspace/pr-review-compare.js";
import { fetchPRFiles } from "../workspace/github-pr.js";
import { reviewPRAgainstItems, deriveRunStatus } from "../workspace/pr-review.js";
import { getProject } from "../workspace/db.js";
import type { CheckableItem, ProductSpecForCheck } from "../workspace/check.js";
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
import {
  getNotificationSettings,
  insertNotificationRecord,
} from "../workspace/notification-db.js";
import {
  buildPrReviewTelegramMessage,
  sendWorkspaceTelegramMessage,
} from "../workspace/telegram-notify.js";

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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

// ─── Comparison helper ────────────────────────────────────────────────────────

async function loadComparisonForComment(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
): Promise<{ data: ComparisonDataForComment | null; warning?: string }> {
  try {
    const [latest, previous] = await getLatestTwoPrReviewRuns(env, projectId, repoFullName, prNumber);
    if (!latest || !previous) return { data: null, warning: "not_enough_runs" };
    const latestResults = parseRunResults(latest.resultJson);
    const previousResults = parseRunResults(previous.resultJson);
    const comparison = compareRunResults(previousResults, latestResults);
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

  // ── GET /workspace/projects/:id/github/pulls?userKey=... ─────────────────
  // List open PRs for the project's linked repo.
  app.get("/workspace/projects/:id/github/pulls", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked — connect a repo first" }, 400, origin);

    const conn = await getGitHubConnectionByUserKey(c.env, userKey).catch(() => null);
    if (!conn || !conn.accessTokenEnc) {
      return json({ ok: false, error: "not_connected — connect GitHub first" }, 401, origin);
    }

    const kek = c.env.CONCLAVE_TOKEN_KEK;
    if (!kek) return json({ ok: false, error: "token_unavailable" }, 503, origin);

    let token: string;
    try { token = await decryptToken(conn.accessTokenEnc, kek); }
    catch { return json({ ok: false, error: "token_decrypt_failed" }, 503, origin); }

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

  // ── GET /workspace/projects/:id/github/linked-pulls ──────────────────────
  app.get("/workspace/projects/:id/github/linked-pulls", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");

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

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 2. Get linked PR to inherit selectedItemIds if not in body
    const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
    const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);

    // 3. Determine selectedItemIds: body > linked PR > error
    const selectedItemIds = bodySelectedIds?.length
      ? bodySelectedIds
      : (linkedPR?.selectedItemIds ?? []);
    if (selectedItemIds.length === 0) {
      return json({ ok: false, error: "no_selected_items" }, 400, origin);
    }

    // 4. GitHub token
    if (!c.env.CONCLAVE_TOKEN_KEK) {
      return json({ ok: false, error: "token_unavailable" }, 503, origin);
    }
    const conn = await getGitHubConnectionByUserKey(c.env, userKey).catch(() => null);
    if (!conn) return json({ ok: false, error: "not_connected" }, 401, origin);
    let token: string;
    try {
      token = await decryptToken(conn.accessTokenEnc, c.env.CONCLAVE_TOKEN_KEK);
    } catch {
      return json({ ok: false, error: "token_decrypt_failed" }, 503, origin);
    }

    // 5. Load items + productSpec: prefer body payload, fall back to D1
    let items: CheckableItem[];
    let productSpec: ProductSpecForCheck;
    const bodyItems = b["items"];
    const bodySpec = b["productSpec"];

    if (Array.isArray(bodyItems) && bodyItems.length > 0 && bodySpec && typeof bodySpec === "object") {
      items = bodyItems as CheckableItem[];
      productSpec = bodySpec as ProductSpecForCheck;
    } else {
      const dbProj = await getProject(c.env, projectId).catch(() => null);
      if (!dbProj) return json({ ok: false, error: "project_not_found" }, 404, origin);
      items = (Array.isArray(dbProj.items) ? dbProj.items : []) as CheckableItem[];
      productSpec = (dbProj.productSpec ?? {}) as ProductSpecForCheck;
    }

    // Filter to selectedItemIds only
    const itemsToReview = items.filter((item) => selectedItemIds.includes(item.id));
    if (itemsToReview.length === 0) {
      return json({ ok: false, error: "no_matching_items" }, 400, origin);
    }

    // 6. Insert run as running
    const run = await insertReviewRun(c.env, {
      projectId, userKey,
      repoFullName: repo.repoFullName,
      prNumber,
      linkedPrId: linkedPR?.id,
      selectedItemIds,
      status: "running",
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

    return json({
      ok: true,
      run: {
        id: run.id,
        status: finalStatus,
        projectId,
        repoFullName: repo.repoFullName,
        prNumber,
        selectedItemIds,
        summary: reviewResult.summary,
        results: reviewResult.results,
        createdAt: run.createdAt,
        updatedAt: new Date().toISOString(),
      },
      warnings: warnings.length ? warnings : undefined,
    }, 200, origin);
  });

  // ── GET /workspace/projects/:id/github/pulls/:number/review ──────────────
  // Return the latest review run for a PR.
  app.get("/workspace/projects/:id/github/pulls/:number/review", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

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

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const target: FixBriefTarget =
      b["target"] === "claude_code" || b["target"] === "codex" ? b["target"] : "both";

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 2. Get latest review run
    const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
    if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);

    // 3. Parse review results
    let reviewResults: Array<{ itemId: string; title: string; status: string; reason: string; evidence: string[]; nextAction: string }> = [];
    if (run.resultJson) {
      try {
        const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
        if (Array.isArray(parsed.results)) reviewResults = parsed.results as typeof reviewResults;
      } catch { /* ignored */ }
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
      : (run.selectedItemIds.length ? run.selectedItemIds.filter((id) => fixableItemIds.includes(id)) : fixableItemIds);

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
      runId: run.id,
      target,
    });

    return json(result, 200, origin);
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

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const includeFixBrief = b["includeFixBrief"] === true;
    const includeComparison = b["includeComparison"] === true;

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

    // 2. Get latest review run
    const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
    if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);

    // 3. Parse review results
    let reviewResults: CommentResultItem[] = [];
    if (run.resultJson) {
      try {
        const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
        if (Array.isArray(parsed.results)) reviewResults = parsed.results as CommentResultItem[];
      } catch { /* ignored */ }
    }
    if (reviewResults.length === 0) {
      return json({ ok: false, error: "no_review_results" }, 400, origin);
    }

    // 4. Determine selectedItemIds
    const selectedItemIds = bodySelectedIds?.length
      ? bodySelectedIds
      : run.selectedItemIds;

    const selectedItems = reviewResults.filter((r) => selectedItemIds.includes(r.itemId));
    const summary = {
      failed: selectedItems.filter((r) => r.status === "failed").length,
      inconclusive: selectedItems.filter((r) => r.status === "inconclusive").length,
      needsDecision: selectedItems.filter((r) => r.status === "needs_decision").length,
      passed: selectedItems.filter((r) => r.status === "passed").length,
    };

    // 5. Get PR title
    const linkedPRs = await getLinkedPRs(c.env, projectId).catch(() => []);
    const linkedPR = linkedPRs.find((p) => p.prNumber === prNumber);
    const prTitle = linkedPR?.prTitle ?? `PR #${prNumber}`;

    // 6. Load comparison data if requested
    const warnings: string[] = [];
    let comparisonData: ComparisonDataForComment | undefined;
    if (includeComparison) {
      const comp = await loadComparisonForComment(c.env, projectId, repo.repoFullName, prNumber);
      if (comp.warning === "not_enough_runs") warnings.push("not_enough_runs");
      else if (comp.data) comparisonData = comp.data;
    }

    // 7. Build body
    const { body: commentBody, truncated, comparisonIncluded } = buildCommentBody({
      repoFullName: repo.repoFullName,
      prNumber,
      prTitle,
      selectedItems,
      summary,
      includeFixBrief,
      includeComparison,
      comparisonData,
    });
    if (truncated) warnings.push("코멘트가 너무 길어 일부 내용이 잘렸습니다.");
    if (includeComparison && comparisonData && !comparisonIncluded) warnings.push("비교 섹션이 너무 길어 생략됐습니다.");

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

    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const customBody = typeof b["body"] === "string" ? b["body"] : undefined;
    const includeFixBrief = b["includeFixBrief"] === true;
    const includeComparison = b["includeComparison"] === true;
    // mode: "new" = always create new comment, "update_latest" = update most recent posted comment
    const mode: "new" | "update_latest" = b["mode"] === "update_latest" ? "update_latest" : "new";

    // 1. Get linked repo
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

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

    let token: string;
    try {
      token = await decryptToken(conn.accessTokenEnc, c.env.CONCLAVE_TOKEN_KEK);
    } catch {
      return json({ ok: false, error: "token_decrypt_failed" }, 503, origin);
    }

    // 3. Get latest review run
    const run = await getLatestReviewRun(c.env, projectId, repo.repoFullName, prNumber).catch(() => null);
    if (!run) return json({ ok: false, error: "no_review_run" }, 400, origin);

    // 4. Parse review results
    let reviewResults: CommentResultItem[] = [];
    if (run.resultJson) {
      try {
        const parsed = JSON.parse(run.resultJson) as { results?: unknown[] };
        if (Array.isArray(parsed.results)) reviewResults = parsed.results as CommentResultItem[];
      } catch { /* ignored */ }
    }

    // 5. Build or use provided body
    const selectedItemIds = bodySelectedIds?.length ? bodySelectedIds : run.selectedItemIds;
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
      let comparisonData: ComparisonDataForComment | undefined;
      if (includeComparison) {
        const comp = await loadComparisonForComment(c.env, projectId, repo.repoFullName, prNumber);
        if (comp.data) comparisonData = comp.data;
      }
      const { body: built } = buildCommentBody({
        repoFullName: repo.repoFullName, prNumber, prTitle, selectedItems, summary,
        includeFixBrief, includeComparison, comparisonData,
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
      reviewRunId: run.id,
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

  // ── GET /workspace/projects/:id/github/pulls/:number/comments ─────────────
  // List comment records for a PR (most recent first).
  app.get("/workspace/projects/:id/github/pulls/:number/comments", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const projectId = c.req.param("id");
    const prNumber = parseInt(c.req.param("number"), 10);
    if (isNaN(prNumber) || prNumber < 1) {
      return json({ ok: false, error: "invalid_pr_number" }, 400, origin);
    }

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

      // Record usage event (non-fatal)
      const userKey = c.req.query("userKey") ?? "";
      if (userKey) {
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

    const customBody = typeof b["body"] === "string" ? b["body"] : undefined;
    const bodySelectedIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const includeFixBrief = b["includeFixBrief"] === true;
    const includeComparison = b["includeComparison"] === true;

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

    let token: string;
    try {
      token = await decryptToken(conn.accessTokenEnc, c.env.CONCLAVE_TOKEN_KEK);
    } catch {
      return json({ ok: false, error: "token_decrypt_failed" }, 503, origin);
    }

    // 3. Build updated body
    const repo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (!repo) return json({ ok: false, error: "no_repo_linked" }, 400, origin);

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
        const comp = await loadComparisonForComment(c.env, projectId, repo.repoFullName, prNumber);
        if (comp.data) comparisonData = comp.data;
      }
      const { body: built } = buildCommentBody({
        repoFullName: repo.repoFullName, prNumber, prTitle, selectedItems, summary,
        includeFixBrief, includeComparison, comparisonData,
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

  return app;
}

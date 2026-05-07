/**
 * v0.16 (Problem 3) — SaaS auth + GH App webhook routes.
 *
 * Endpoints:
 *   POST /webhook/github          — GitHub App webhook receiver. Verifies HMAC,
 *                                   updates gh_app_installations on installation events,
 *                                   triggers SaaS pipeline on pull_request events (TBD wiring).
 *   GET  /auth/github/callback    — OAuth redirect destination after a user authorizes
 *                                   the GH App. Exchanges ?code= for a user token, looks
 *                                   up the matching pending Device Flow session via ?state=,
 *                                   approves it, and renders a success page for the browser.
 *   POST /auth/device             — Device Flow start. CLI calls this; we issue a
 *                                   device_code + user_code and return both with a
 *                                   verification_uri the CLI displays to the user.
 *   POST /auth/token              — Device Flow poll. CLI sends device_code; we
 *                                   return either pending / approved+token / denied / expired.
 *   POST /auth/logout             — Revokes the caller's token (Authorization: Bearer …).
 *
 * The Device Flow shape mirrors RFC 8628 fairly closely; we deliberately
 * use our own auth surface (NOT GitHub Device Flow) so the user identity
 * we get back is OUR saas_users row, not a raw GH PAT. This keeps the
 * auth boundary at the central plane, not at GitHub.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  approveDeviceCode,
  consumeReviewCredit,
  createDeviceCode,
  createJob,
  findDeviceCode,
  findInstallationById,
  findUserByToken,
  issueToken,
  linkInstallationUser,
  recordMeter,
  removeInstallation,
  revokeToken,
  suspendInstallation,
  unsuspendInstallation,
  upsertInstallation,
  upsertUser,
} from "../db/saas.js";
import {
  exchangeOAuthCode,
  getAuthedUser,
  verifyWebhookSignature,
} from "../gh-app.js";
import { spawnSandbox } from "./saas.js";

export function createSaasAuthRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // --- POST /webhook/github -----------------------------------------------
  // GitHub App webhook. Signature header: X-Hub-Signature-256.
  // Event header: X-GitHub-Event (e.g. "installation", "installation_repositories",
  // "pull_request", "pull_request_review", "push").
  app.post("/webhook/github", async (c) => {
    const env = c.env;
    if (!env.GH_APP_WEBHOOK_SECRET) {
      // Worker secret not yet provisioned. Refuse rather than silently
      // accepting unsigned events.
      return c.json({ error: "webhook secret not configured" }, 503);
    }
    const sig = c.req.header("x-hub-signature-256") ?? null;
    const event = c.req.header("x-github-event") ?? "";
    const delivery = c.req.header("x-github-delivery") ?? "";
    const rawBody = await c.req.text();
    const ok = await verifyWebhookSignature(env.GH_APP_WEBHOOK_SECRET, rawBody, sig);
    if (!ok) {
      return c.json({ error: "signature mismatch" }, 401);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const p = payload as Record<string, unknown>;
    const action = String(p["action"] ?? "");

    // Installation lifecycle events — keep gh_app_installations in sync.
    if (event === "installation") {
      const inst = (p["installation"] ?? {}) as Record<string, unknown>;
      const installationId = Number(inst["id"]);
      const account = (inst["account"] ?? {}) as Record<string, unknown>;
      const accountLogin = String(account["login"] ?? "");
      const accountId = Number(account["id"] ?? 0);
      const targetType = String(inst["target_type"] ?? "User") as "User" | "Organization";
      const repoSelection = String(inst["repository_selection"] ?? "all") as "all" | "selected";
      if (action === "created") {
        const repos = (p["repositories"] ?? []) as Array<{ id: number }>;
        const ids = Array.isArray(repos) && repos.length > 0 ? repos.map((r) => r.id) : null;
        await upsertInstallation(env, {
          installationId,
          accountLogin,
          accountId,
          targetType,
          repoSelection,
          selectedRepoIds: ids,
        });
        // Auto-register the installer as a saas_user. This is the "no
        // CLI required" sign-up path: clicking Install on the GH App
        // page is the entire onboard. Trial credit is granted
        // automatically (consumeReviewCredit's first call returns "trial").
        if (accountLogin && accountId) {
          const user = await upsertUser(env, {
            githubUserId: accountId,
            githubLogin: accountLogin,
            email: null,
          });
          await linkInstallationUser(env, installationId, user.id);
          console.log(`[webhook] install ${installationId} → user ${user.id} (${accountLogin})`);
        } else {
          console.log(`[webhook] install ${installationId} created (no account info)`);
        }
      } else if (action === "deleted") {
        await removeInstallation(env, installationId);
        console.log(`[webhook] install ${installationId} deleted`);
      } else if (action === "suspend") {
        await suspendInstallation(env, installationId);
      } else if (action === "unsuspend") {
        await unsuspendInstallation(env, installationId);
      }
      return c.json({ ok: true, event, action, delivery });
    }

    // pull_request events trigger the SaaS pipeline. We auto-spawn a
    // review on opened/reopened/synchronize (the head SHA changed).
    // Other actions (closed/labeled/etc.) are acknowledged but skipped.
    if (event === "pull_request") {
      const reviewable = action === "opened" || action === "reopened" || action === "synchronize";
      if (!reviewable) {
        return c.json({ ok: true, event, action, delivery, skipped: "non_reviewable_action" });
      }
      const pr = (p["pull_request"] ?? {}) as Record<string, unknown>;
      const repo = (p["repository"] ?? {}) as Record<string, unknown>;
      const inst = (p["installation"] ?? {}) as Record<string, unknown>;
      const title = String(pr["title"] ?? "");
      const body = String(pr["body"] ?? "");
      // Honor [skip conclave] in title or body — same magic word the
      // BYO-key workflow respects, so users get one consistent escape hatch.
      if (/\[skip conclave\]/i.test(title) || /\[skip conclave\]/i.test(body)) {
        return c.json({ ok: true, event, action, delivery, skipped: "skip_conclave" });
      }
      const prNumber = Number(pr["number"]);
      const repoSlug = String(repo["full_name"] ?? "");
      const installationId = Number(inst["id"]);
      if (!prNumber || !repoSlug || !installationId) {
        return c.json({ ok: true, event, action, delivery, skipped: "missing_fields" });
      }
      const installRow = await findInstallationById(env, installationId);
      if (!installRow || !installRow.saasUserId) {
        // Race: PR event arrived before installation→user link finished.
        // Acknowledge so GitHub doesn't retry forever; the next push to
        // the PR will re-trigger.
        return c.json({ ok: true, event, action, delivery, skipped: "user_not_linked" });
      }
      const billed = await consumeReviewCredit(env, installRow.saasUserId);
      if (billed === null) {
        return c.json({ ok: true, event, action, delivery, skipped: "credits_exhausted" });
      }
      const jobId = `job_${Math.floor(Date.now()).toString(36)}_${randHexLocal(8)}`;
      await createJob(env, {
        jobId,
        userId: installRow.saasUserId,
        repoSlug,
        prNumber,
        kind: "review",
        prdPresent: false,
      }).catch(() => undefined);
      await recordMeter(env, {
        userId: installRow.saasUserId,
        meterName: `review.requested.${billed}.webhook`,
        quantity: 1,
        repoSlug,
      }).catch(() => undefined);
      const publicBaseUrl = env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
      const spawn = await spawnSandbox(env, {
        jobId,
        repo: repoSlug,
        prNumber,
        autofix: false,
        publicBaseUrl,
      });
      return c.json({
        ok: true,
        event,
        action,
        delivery,
        jobId,
        billed,
        spawn: spawn.accepted ? "accepted" : (spawn.reason ?? "queued"),
      });
    }

    // pull_request_review, push, etc. — ack for now.
    return c.json({ ok: true, event, action, delivery });
  });

  // --- POST /auth/device --------------------------------------------------
  // CLI starts a Device Flow session. Returns device_code (secret),
  // user_code (public, 8 chars dashed), verification_uri (where user goes).
  app.post("/auth/device", async (c) => {
    const env = c.env;
    if (!env.GH_APP_CLIENT_ID) {
      return c.json({ error: "GH App client_id not configured" }, 503);
    }
    const dc = await createDeviceCode(env);
    const baseUrl = env.PUBLIC_BASE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";
    // The verification flow: browser hits GH OAuth authorize for our app,
    // GH redirects back to /auth/github/callback with code + state. We use
    // the user_code as `state` so the callback can find the right device
    // session to approve.
    const verificationUri =
      `https://github.com/login/oauth/authorize?` +
      `client_id=${encodeURIComponent(env.GH_APP_CLIENT_ID)}` +
      `&state=${encodeURIComponent(dc.userCode)}` +
      `&redirect_uri=${encodeURIComponent(`${baseUrl}/auth/github/callback`)}`;
    return c.json({
      device_code: dc.deviceCode,
      user_code: dc.userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUri,
      expires_in: Math.max(0, Math.floor((Date.parse(dc.expiresAt) - Date.now()) / 1000)),
      interval: dc.intervalSec,
    });
  });

  // --- POST /auth/token ---------------------------------------------------
  // CLI polls until status flips. Mirrors RFC 8628 error responses
  // (`authorization_pending`, `slow_down`, `expired_token`).
  app.post("/auth/token", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { device_code?: string } | null;
    if (!body?.device_code) {
      return c.json({ error: "invalid_request", error_description: "device_code required" }, 400);
    }
    const dc = await findDeviceCode(c.env, body.device_code);
    if (!dc) {
      return c.json({ error: "invalid_grant", error_description: "unknown device_code" }, 400);
    }
    if (Date.parse(dc.expiresAt) < Date.now()) {
      return c.json({ error: "expired_token", error_description: "device code expired; restart login" }, 400);
    }
    if (dc.status === "denied") {
      return c.json({ error: "access_denied", error_description: "user denied authorization" }, 400);
    }
    if (dc.status === "pending") {
      return c.json({ error: "authorization_pending" }, 400);
    }
    if (dc.status !== "approved" || !dc.approvedUserId) {
      return c.json({ error: "invalid_grant", error_description: "session not approved" }, 400);
    }
    // Approved — issue a fresh token. We do this lazily at poll time so
    // the token is only minted when the CLI actually asks for it.
    const issued = await issueToken(c.env, dc.approvedUserId, "cli");
    return c.json({
      access_token: issued.token,
      token_type: "bearer",
      scope: "cli",
      expires_in: 0, // 0 = no expiry (we keep it server-side until /auth/logout)
    });
  });

  // --- GET /auth/github/callback ------------------------------------------
  // Browser hits this after the user clicks "Authorize" on GitHub's
  // OAuth confirm screen. Code → user access token → user identity →
  // upsert saas_users + approve the matching Device Flow session.
  app.get("/auth/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state"); // we set this to the user_code
    const errParam = c.req.query("error");
    const env = c.env;

    if (errParam) {
      return c.html(htmlError(`GitHub denied authorization: ${errParam}`), 400);
    }
    if (!code || !state) {
      return c.html(htmlError("Missing ?code or ?state — cannot complete login."), 400);
    }
    if (!env.GH_APP_CLIENT_ID || !env.GH_APP_CLIENT_SECRET) {
      return c.html(htmlError("Worker not yet configured (GH App secrets missing)."), 503);
    }
    try {
      const { accessToken } = await exchangeOAuthCode(env, code);
      const ghUser = await getAuthedUser(accessToken);
      const user = await upsertUser(env, {
        githubUserId: ghUser.id,
        githubLogin: ghUser.login,
        email: ghUser.email,
      });
      const approved = await approveDeviceCode(env, state, user.id);
      if (!approved) {
        // Either expired, already approved, or no matching session.
        return c.html(
          htmlError(
            `No matching login session for code ${escapeHtml(state)}. ` +
              `Restart \`conclave login\` from your terminal and try again.`,
          ),
          400,
        );
      }
      return c.html(htmlOk(user.githubLogin));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.html(htmlError(`Login failed: ${escapeHtml(msg)}`), 500);
    }
  });

  // --- POST /auth/logout --------------------------------------------------
  app.post("/auth/logout", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) return c.json({ error: "missing bearer token" }, 401);
    const found = await findUserByToken(c.env, m[1]!);
    if (!found) return c.json({ error: "invalid token" }, 401);
    await revokeToken(c.env, found.tokenId);
    return c.json({ ok: true });
  });

  return app;
}

// --- HTML helpers --------------------------------------------------------

function htmlOk(login: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Conclave AI — login complete</title>
<style>
  body{font:14px/1.5 ui-monospace,monospace;color:#222;max-width:560px;margin:80px auto;padding:0 24px}
  .ok{color:#0a8}
  code{background:#f4f4f4;padding:2px 6px;border-radius:4px}
</style></head><body>
<h1 class="ok">✓ Logged in as ${escapeHtml(login)}</h1>
<p>You can close this tab. Your terminal will pick up the token automatically.</p>
<p><small>Conclave AI Code Council · device flow login complete</small></p>
</body></html>`;
}

function htmlError(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Conclave AI — login failed</title>
<style>
  body{font:14px/1.5 ui-monospace,monospace;color:#222;max-width:560px;margin:80px auto;padding:0 24px}
  .err{color:#c33}
  code{background:#f4f4f4;padding:2px 6px;border-radius:4px}
</style></head><body>
<h1 class="err">✗ Login failed</h1>
<p>${message}</p>
<p><small>Conclave AI Code Council · device flow</small></p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function randHexLocal(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

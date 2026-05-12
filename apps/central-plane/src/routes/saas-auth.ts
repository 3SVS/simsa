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
  findJobByHeadSha,
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
  createCouncilCheckRun,
  exchangeOAuthCode,
  getAuthedUser,
  postPrComment,
  verifyWebhookSignature,
} from "../gh-app.js";
import { notifyFounderOnNewInstall } from "../notify-founder.js";
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
          // Fire-and-forget founder alert. Skipped when secrets unset
          // or when the installer IS the founder (own dogfood = noise).
          await notifyFounderOnNewInstall(env, {
            installationId,
            accountLogin,
            targetType,
          }).catch(() => undefined);
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
      // Tell the user what's happening — silence is the worst UX.
      // Best-effort; if the comment fails we still proceed.
      const startBody = spawn.accepted
        ? `🤖 **Conclave AI** is reviewing this PR.\n\nThe council (Claude + GPT-5 + Gemini) will post the verdict here in ~60 seconds. Add a \`[skip conclave]\` to a commit message to opt out.`
        : `⏸ **Conclave AI** queued your review but couldn't start the sandbox right now: \`${(spawn.reason ?? "unknown").slice(0, 200)}\`. We'll retry on your next push.`;
      await postPrComment(env, installationId, repoSlug, prNumber, startBody).catch(() => undefined);
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

    // Sprint 2 — check_run: a third-party deploy preview (Vercel /
    // Netlify / Cloudflare) finished. Most reviews fire +60-120s after
    // the PR push when the deploy build is still running, so the
    // initial council verdict can be APPROVE while the deploy fails
    // shortly after. Without this branch the user sees green Council
    // ✓ + green CI ✓ + red Vercel ✗ and gets confused. We re-write
    // the council check-run conclusion to action_required and post a
    // PR comment naming the failing deploy.
    if (event === "check_run" && action === "completed") {
      const checkRun = (p["check_run"] ?? {}) as Record<string, unknown>;
      const repo = (p["repository"] ?? {}) as Record<string, unknown>;
      const inst = (p["installation"] ?? {}) as Record<string, unknown>;
      const checkName = String(checkRun["name"] ?? "");
      const conclusion = String(checkRun["conclusion"] ?? "");
      const headSha = String(checkRun["head_sha"] ?? "");
      const repoSlug = String(repo["full_name"] ?? "");
      const installationId = Number(inst["id"]);

      // Skip our own check-run + non-deploy checks. Only react to
      // failures of recognized deploy-platform runs.
      const isDeployCheck = /vercel|netlify|cloudflare|deploy|preview/i.test(checkName);
      const isOurCheck = /conclave/i.test(checkName);
      if (!isDeployCheck || isOurCheck) {
        return c.json({ ok: true, event, action, delivery, skipped: "not_a_deploy_check" });
      }
      if (conclusion !== "failure" && conclusion !== "timed_out" && conclusion !== "cancelled") {
        return c.json({ ok: true, event, action, delivery, skipped: "deploy_did_not_fail" });
      }
      if (!headSha || !repoSlug || !installationId) {
        return c.json({ ok: true, event, action, delivery, skipped: "missing_fields" });
      }

      // Find the job we ran for this exact head SHA. If our review
      // hasn't fired yet (deploy finished before review), the
      // pull_request handler's later spawn will probe deploy via cli
      // and surface the failure on its own — no follow-up needed.
      const job = await findJobByHeadSha(env, repoSlug, headSha);
      if (!job) {
        return c.json({ ok: true, event, action, delivery, skipped: "no_prior_job" });
      }
      // If the council already said REWORK / REJECT, the user already
      // has a clear gate. Only act when our verdict was APPROVE — the
      // mismatch case Bae flagged.
      if (job.verdict !== "approve") {
        return c.json({ ok: true, event, action, delivery, skipped: `council_already_${job.verdict ?? "unknown"}` });
      }

      const platformName = pickDeployPlatformName(checkName);
      const failNote = [
        `⚠️ **${platformName} deploy failed for this commit** after Conclave's APPROVE verdict.`,
        ``,
        `Council reviewed code only — the build failure trumps that. Don't merge until the build is green.`,
        ``,
        `Failed check: \`${checkName}\` · conclusion \`${conclusion}\``,
      ].join("\n");
      await postPrComment(env, installationId, repoSlug, job.prNumber, failNote).catch(() => undefined);
      // Re-write our check-run to action_required so the merge gate
      // reflects the build failure too.
      await createCouncilCheckRun(env, installationId, repoSlug, headSha, {
        verdict: "rework",
        ...(job.blockers !== null && job.blockers !== undefined ? { blockers: job.blockers } : {}),
        summary: `${platformName} deploy failed after council approve. Address the build failure before merging.`,
      }).catch(() => undefined);
      return c.json({ ok: true, event, action, delivery, action_taken: "downgraded_to_rework", platform: platformName });
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
  //
  // 2026-05-12: also accept the trailing-slash variant. The first
  // external install configured the App's Callback URL with a stray
  // `/` at the end, and Hono's path matcher is strict so the request
  // hit the default 404 envelope. Cheap to alias both forms — the
  // handler body is identical.
  app.get("/auth/github/callback/", async (c) => {
    const params = c.req.query();
    const qs = new URLSearchParams(params).toString();
    return c.redirect("/auth/github/callback" + (qs ? "?" + qs : ""), 301);
  });
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

// v0.14.5 — login pages match the judicial-conclave brand from
// apps/landing (parchment cream + oxblood seal + gold leaf accents +
// Bodoni-style display serif). One-shot HTML pages served direct from
// the Worker; Google Fonts loads once per browser visit. Both pages
// share the same shell so they look like a pair, not two unrelated
// templates.
const SHARED_HEAD = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,500;0,600;1,500&family=Crimson+Pro:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" />
<style>
  :root {
    --parchment: #F4ECDC;
    --parchment-light: #FBF6E9;
    --parchment-line: #D9C9A6;
    --ink: #1A1310;
    --ink-subtle: #3D2E26;
    --ink-muted: #5C463A;
    --ink-mute: #7A685A;
    --oxblood: #5C111C;
    --oxblood-soft: #8E2C39;
    --gold: #9B7A30;
    --gold-light: #C7A554;
  }
  * { box-sizing: border-box; }
  html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: "Crimson Pro", Georgia, serif;
    color: var(--ink);
    background: var(--parchment);
    background-image:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='2' stitchTiles='stitch' seed='3'/><feColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.07 0 0 0 0 0.05 0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>"),
      radial-gradient(ellipse 80% 50% at 50% 0%, rgba(155, 122, 48, 0.04), transparent 60%),
      radial-gradient(ellipse 70% 50% at 50% 100%, rgba(92, 17, 28, 0.03), transparent 65%);
    background-size: 220px, 100% 100%, 100% 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  ::selection { background: var(--oxblood); color: var(--parchment); }
  .stage {
    width: 100%;
    max-width: 560px;
    text-align: center;
    animation: rise 600ms cubic-bezier(0.2, 0, 0.15, 1);
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .seal {
    margin: 0 auto 36px;
    width: 64px; height: 64px;
    display: flex; align-items: center; justify-content: center;
  }
  .marker {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-mute);
    display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
  }
  .marker::before, .marker::after {
    content: "";
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--gold) 40%, var(--gold) 60%, transparent);
    opacity: 0.55;
  }
  h1 {
    font-family: "Bodoni Moda", Bodoni, Didot, serif;
    font-weight: 500;
    font-size: clamp(2.25rem, 5vw, 3.25rem);
    line-height: 1.05;
    letter-spacing: -0.01em;
    margin: 0 0 8px;
    color: var(--ink);
  }
  h1 em { font-style: italic; font-weight: 500; }
  .subtitle {
    font-family: "Bodoni Moda", Bodoni, Didot, serif;
    font-style: italic;
    font-weight: 500;
    font-size: 1.25rem;
    color: var(--oxblood);
    margin: 0 0 28px;
  }
  .body {
    font-size: 17px;
    line-height: 1.65;
    color: var(--ink-muted);
    max-width: 42ch;
    margin: 0 auto 28px;
  }
  .latin {
    font-family: "Bodoni Moda", Bodoni, Didot, serif;
    font-style: italic;
    color: var(--ink-mute);
    font-size: 15px;
    margin: 36px 0 0;
  }
  .gold-rule {
    height: 2px;
    width: 56px;
    margin: 32px auto;
    background: linear-gradient(90deg, transparent 0%, var(--gold) 30%, var(--gold-light) 50%, var(--gold) 70%, transparent 100%);
  }
  .meta {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-mute);
    margin-top: 48px;
  }
  code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    background: var(--parchment-light);
    border: 1px solid var(--parchment-line);
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 0.9em;
    color: var(--ink);
  }
  .who {
    display: inline-block;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    color: var(--oxblood);
    font-weight: 500;
  }
  /* Wax seal — circular stamp built from gradients (no asset) */
  .wax {
    width: 64px; height: 64px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--oxblood-soft), var(--oxblood) 60%, #4B0E17);
    box-shadow:
      inset 0 0 0 2px rgba(199, 165, 84, 0.35),
      inset 4px 8px 16px rgba(0, 0, 0, 0.35),
      inset -4px -6px 12px rgba(255, 215, 165, 0.18),
      0 4px 8px rgba(40, 10, 15, 0.25);
    display: flex; align-items: center; justify-content: center;
    color: var(--parchment);
    font-family: "Bodoni Moda", Bodoni, Didot, serif;
    font-style: italic;
    font-weight: 500;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  /* Logo: three council dots inside an outline ring */
  .ring { stroke: var(--oxblood); fill: none; stroke-width: 1.4; }
  .dot  { fill: var(--oxblood); }
  /* Error variant: replace seal with a struck-through ring */
  .seal--err .ring { stroke: var(--oxblood); }
  .seal--err .dot  { fill: var(--ink-mute); opacity: 0.4; }
  .seal--err .strike {
    stroke: var(--oxblood);
    stroke-width: 1.4;
    stroke-linecap: round;
  }
  .err-message {
    background: var(--parchment-light);
    border-left: 3px solid var(--oxblood);
    padding: 14px 18px;
    text-align: left;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px;
    color: var(--ink-subtle);
    margin: 24px auto;
    max-width: 480px;
    line-height: 1.55;
  }
</style>`;

function logoSvgInline(): string {
  // Three filled dots inscribed in an outline ring — Conclave AI mark.
  // Coords match apps/landing/src/components/Logo.tsx geometry (cy=12,
  // r=4.5, dots at -90/30/150°), so the brand is identical across web
  // and login pages.
  return `<svg width="56" height="56" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle class="ring" cx="12" cy="12" r="10" />
    <circle class="dot" cx="12" cy="7.5" r="1.6" />
    <circle class="dot" cx="15.897" cy="14.25" r="1.6" />
    <circle class="dot" cx="8.103" cy="14.25" r="1.6" />
  </svg>`;
}

function logoSvgInlineErr(): string {
  // Same ring + dots, but with a slash struck across — visual "session
  // not granted" without abandoning the mark.
  return `<svg width="56" height="56" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="seal--err" aria-hidden="true">
    <circle class="ring" cx="12" cy="12" r="10" />
    <circle class="dot" cx="12" cy="7.5" r="1.6" />
    <circle class="dot" cx="15.897" cy="14.25" r="1.6" />
    <circle class="dot" cx="8.103" cy="14.25" r="1.6" />
    <line class="strike" x1="5" y1="19" x2="19" y2="5" />
  </svg>`;
}

function htmlOk(login: string): string {
  return `<!doctype html>
<html lang="en"><head>${SHARED_HEAD}<title>Conclave AI · Audience granted</title></head>
<body>
  <main class="stage">
    <div class="seal">${logoSvgInline()}</div>
    <p class="marker">device flow · session approved</p>
    <h1>The council has <em>granted</em> audience.</h1>
    <p class="subtitle">Habemus consensum.</p>
    <div class="gold-rule"></div>
    <p class="body">
      You may close this tab. Your terminal will receive the seal automatically — no further action is required of you.
    </p>
    <p class="body">
      Logged in as <span class="who">@${escapeHtml(login)}</span>.
    </p>
    <p class="latin">Verify with <code>conclave whoami</code> · revoke with <code>conclave logout</code>.</p>
    <p class="meta">Conclave AI · Code Council · MMXXVI</p>
  </main>
</body></html>`;
}

function htmlError(message: string): string {
  return `<!doctype html>
<html lang="en"><head>${SHARED_HEAD}<title>Conclave AI · Session closed</title></head>
<body>
  <main class="stage">
    <div class="seal">${logoSvgInlineErr()}</div>
    <p class="marker">device flow · session closed</p>
    <h1>The session is <em>closed</em>.</h1>
    <p class="subtitle">Sessio clausa est.</p>
    <div class="gold-rule"></div>
    <div class="err-message">${message}</div>
    <p class="body">
      Return to your terminal and run <code>conclave login</code> to begin a new audience. The previous device code is no longer valid.
    </p>
    <p class="meta">Conclave AI · Code Council · MMXXVI</p>
  </main>
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

function pickDeployPlatformName(checkName: string): string {
  const n = checkName.toLowerCase();
  if (n.includes("vercel")) return "Vercel";
  if (n.includes("netlify")) return "Netlify";
  if (n.includes("cloudflare")) return "Cloudflare";
  return "Deploy";
}

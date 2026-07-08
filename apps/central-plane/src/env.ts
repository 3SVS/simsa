/**
 * The binding surface we accept from the Workers runtime. Added to as
 * follow-up PRs introduce KV (rate limits), Queues (async aggregation),
 * secrets (GITHUB_CLIENT_ID / SECRET for OAuth), etc.
 */
export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  /**
   * Git commit SHA this Worker was deployed from. Injected at deploy time by
   * deploy-central-plane.yml (`wrangler deploy --var DEPLOYED_SHA:$GITHUB_SHA`)
   * and surfaced on /healthz so the canary can flag "main is ahead of the
   * deployed Worker" — i.e. catch a merge that never got deployed. Absent on
   * local dev and on any deploy predating this var.
   */
  DEPLOYED_SHA?: string;
  /**
   * Public GitHub OAuth App client_id (vars, not secret — it's public by nature).
   * Required by the /oauth/device/* routes. Leave empty / set to placeholder
   * while the central plane is run without OAuth integration.
   */
  GITHUB_CLIENT_ID?: string;
  /**
   * Telegram bot token. Set via `wrangler secret put TELEGRAM_BOT_TOKEN` —
   * never paste into wrangler.toml. Required by /telegram/webhook.
   */
  TELEGRAM_BOT_TOKEN?: string;
  /**
   * Optional shared secret for Telegram webhook verification. Pass this
   * as `secret_token` when calling setWebhook and the Worker will reject
   * updates without a matching `X-Telegram-Bot-Api-Secret-Token` header.
   */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /**
   * v0.5 H — base64-encoded 32-byte KEK used to AES-GCM encrypt the
   * GitHub access token stored in D1 (`installs.github_access_token_enc`).
   * Set via `wrangler secret put CONCLAVE_TOKEN_KEK --env production`.
   *
   * Runtime behaviour:
   *   - If unset: OAuth callback refuses to persist tokens (the
   *     `setGithubAccessToken` write throws) and Telegram button clicks
   *     that hit an encrypted row error out with a clear operator
   *     message. The /oauth/device/start path keeps working — only the
   *     token-persistence step gates on this secret.
   *   - If set but wrong length / not valid base64: startup preflight
   *     fails fast with a clear message (see src/preflight.ts).
   */
  CONCLAVE_TOKEN_KEK?: string;
  /**
   * v0.13.7 — public base URL of THIS Worker. Used by the webhook
   * self-heal cron to compute the URL it should re-bind on Telegram.
   * Defaults to the production URL when unset; override for staging
   * or self-hosted deployments.
   */
  PUBLIC_BASE_URL?: string;
  /**
   * v0.16 (Problem 3) — GitHub App credentials for the SaaS path.
   * These authenticate THIS Worker as the "Conclave AI Code Council"
   * GH App when minting installation access tokens, verifying
   * webhooks, and handling the post-install OAuth callback.
   *
   * Set via:
   *   wrangler secret put GH_APP_ID
   *   wrangler secret put GH_APP_CLIENT_ID
   *   wrangler secret put GH_APP_CLIENT_SECRET   (from GH App "Generate a new client secret")
   *   wrangler secret put GH_APP_WEBHOOK_SECRET
   *   wrangler secret put GH_APP_PRIVATE_KEY     (full .pem multi-line; pipe stdin)
   *
   * Routes that require these:
   *   /webhook/github            — needs WEBHOOK_SECRET for HMAC verification
   *   /auth/github/callback      — needs CLIENT_ID + CLIENT_SECRET for code→token
   *   /saas/review + /saas/autofix — needs APP_ID + PRIVATE_KEY to mint installation tokens
   */
  GH_APP_ID?: string;
  GH_APP_CLIENT_ID?: string;
  GH_APP_CLIENT_SECRET?: string;
  GH_APP_WEBHOOK_SECRET?: string;
  GH_APP_PRIVATE_KEY?: string;
  /**
   * v0.16.2 — Cloudflare Container binding (apps/central-plane/container/).
   * Spawned per /saas/review + /saas/autofix request. The Worker calls
   *   c.env.SANDBOX.idFromName(`pr-${repo}-${prNumber}`).get().fetch(...)
   * to forward the job into a Node 20 container running runAutofix.
   */
  SANDBOX?: DurableObjectNamespace;
  /**
   * Stage 263 — SimsaInspector container binding
   * (apps/central-plane/inspector-container/). One instance per visual-check
   * run: the Worker calls
   *   c.env.INSPECTOR.idFromName(`vc-${runId}`).get().fetch(...)
   * to forward the inspection job into a Playwright + Chromium container that
   * executes the deep-flow check, uploads evidence via the Stage 261 evidence
   * endpoint, and reports back to /internal/visual-check-done. Optional:
   * without the binding, POST .../visual-checks/run still creates the queued
   * row and returns dispatched:false (note inspector_unavailable).
   */
  INSPECTOR?: DurableObjectNamespace;
  /**
   * Stage 261 — R2 bucket `simsa-evidence`: visual-check evidence
   * (screenshots/video under checks/{userKey}/{projectId}/{runId}/) and
   * uploaded project documents (PRD/md under docs/{userKey}/{projectId}/).
   * Optional: without the binding, document upload and evidence routes
   * return 503 (evidence_storage_unconfigured); everything else works.
   */
  EVIDENCE?: R2Bucket;
  /**
   * v0.16.2 — bearer token the container uses when calling back to
   * /internal/job-done. Random per deploy. Set via `wrangler secret put
   * INTERNAL_CALLBACK_TOKEN`. Without it /internal/job-done refuses calls.
   */
  INTERNAL_CALLBACK_TOKEN?: string;
  /**
   * v0.16.2 — LLM keys forwarded into the container as env vars on
   * spawn. The container needs them to call the council agents +
   * worker model. Set via `wrangler secret put`.
   */
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /**
   * 2026-07-09 — Langfuse minimal wiring (Simsa flow observability).
   * All three must be set for traces to be sent; otherwise the workspace
   * routes silently skip Langfuse (fail-open — never blocks a user call).
   * HOST is not a secret (wrangler.toml [vars] is fine); the keys are
   * secrets — set via Actions "set-worker-secrets" workflow (CF rule).
   */
  LANGFUSE_HOST?: string;
  /** Alias for LANGFUSE_HOST. Either name works so a secret set as
   *  LANGFUSE_BASE_URL (common Langfuse convention) doesn't silently no-op. */
  LANGFUSE_BASE_URL?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  /**
   * Tasks #51 — per-deploy salt mixed into the IP hash for the
   * /saas/demo/review rate-limit table. Rotate to invalidate all
   * demo rate-limit rows. Optional — defaults to a fixed string when
   * unset (still hashed, just predictable).
   */
  DEMO_RATE_SALT?: string;
  /**
   * Stage 9 — Workspace GitHub OAuth (Web Application Flow).
   * Separate from the existing GitHub App (GH_APP_*) credentials.
   *
   * Register a GitHub OAuth App at https://github.com/settings/developers
   * with callback URL: https://conclave-ai.seunghunbae.workers.dev/workspace/github/oauth/callback
   *
   * Set via wrangler.toml [vars] (client ID is public):
   *   WORKSPACE_GH_CLIENT_ID = "..."
   *   WORKSPACE_GH_REDIRECT_URI = "..."  (defaults to workers.dev/callback if unset)
   *   WORKSPACE_GH_SCOPES = "read:user public_repo"  (optional, has default)
   *   WORKSPACE_GH_DASHBOARD_URL = "https://app.trysimsa.com"  (optional; Stage 92 default)
   *
   * Set via `wrangler secret put` (client secret must NOT be in wrangler.toml):
   *   WORKSPACE_GH_CLIENT_SECRET = "..."
   */
  WORKSPACE_GH_CLIENT_ID?: string;
  WORKSPACE_GH_CLIENT_SECRET?: string;
  WORKSPACE_GH_REDIRECT_URI?: string;
  WORKSPACE_GH_SCOPES?: string;
  WORKSPACE_GH_DASHBOARD_URL?: string;
  /**
   * Private-repo support via the existing GitHub App (workspace/github-app-access.ts).
   * Public "install this App" URL shown to users whose private repo isn't
   * reachable, e.g. https://github.com/apps/<slug>/installations/new.
   * Set via wrangler.toml [vars]; empty string = no install link surfaced.
   */
  GH_APP_INSTALL_URL?: string;
  /**
   * Stage 17 — base URL of the dashboard. Used when building Telegram notification
   * message links. Defaults to https://app.trysimsa.com when unset (Stage 92).
   * Set via wrangler.toml [vars] or `wrangler secret put DASHBOARD_BASE_URL`.
   */
  DASHBOARD_BASE_URL?: string;
  /**
   * Email notifications (Resend) — simple default alternative to Telegram for
   * workspace "PR review complete" notifications. DORMANT until RESEND_API_KEY
   * is provisioned: without it every email path returns
   * { ok:false, error:"not_configured" } (503 email_not_configured on the test
   * endpoint) and never throws.
   *
   * Set via `wrangler secret put RESEND_API_KEY`.
   * NOTIFY_EMAIL_FROM is optional (wrangler.toml [vars]) and defaults to
   * "Simsa <notify@trysimsa.com>".
   */
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL_FROM?: string;
  /**
   * D2 soft-auth — email-verification kill switch. Verification is otherwise
   * enabled automatically whenever RESEND_API_KEY is set (so verification mail
   * can actually be sent). Set to "off" to force it off even with Resend
   * configured. It gates the workspace CLAIM (cross-device sync), never login.
   */
  AUTH_EMAIL_VERIFICATION?: string;
  /**
   * Stage 18 — Admin usage stats key. Set via `wrangler secret put ADMIN_USAGE_STATS_KEY`.
   * Required for GET /admin/usage-stats. Returns 503 when unset, 401 on key mismatch.
   */
  ADMIN_USAGE_STATS_KEY?: string;
  /**
   * Stage 4 — hourly request cap for POST /workspace/idea-to-spec-draft.
   * Parsed as integer; defaults to 20 when unset or non-numeric.
   * Set via wrangler.toml [vars] or `wrangler secret put`.
   */
  WORKSPACE_GENERATION_LIMIT_PER_HOUR?: string;
  /**
   * Security hardening — hourly per-userKey cap for
   * POST /workspace/projects/:id/github/pulls/:number/review.
   * Parsed as integer; defaults to 30 when unset or non-numeric.
   */
  WORKSPACE_PR_REVIEW_HOURLY_LIMIT?: string;
  /**
   * Security hardening — hourly per-userKey cap for the PR comment write
   * endpoints (POST …/comment and PATCH …/comment/:commentId).
   * Parsed as integer; defaults to 60 when unset or non-numeric.
   */
  WORKSPACE_PR_COMMENT_HOURLY_LIMIT?: string;
  /**
   * beta_limits (PR B) — TEMPORARY daily per-userKey abuse caps for the free
   * managed beta. See workspace/beta-limits.ts for rationale. Defaults:
   * reviews 100/day, project creations 20/day. Re-tune from cost_meta after
   * open. Parsed as positive integers; invalid/absent → defaults.
   */
  BETA_REVIEW_DAILY_LIMIT?: string;
  /**
   * Optional Cloudflare AI Gateway base for Anthropic, e.g.
   * https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/anthropic
   * When set, all workspace LLM calls route through the gateway instead of
   * api.anthropic.com directly — sidesteps the intermittent 403 "Request not
   * allowed" on direct Worker egress (2026-07-05). Unset = direct (default).
   * Set via wrangler.toml [vars] (it is a URL, not a secret).
   */
  CF_AI_GATEWAY_ANTHROPIC_URL?: string;
  BETA_PROJECT_CREATE_DAILY_LIMIT?: string;
  /**
   * In-app feedback (workspace-feedback.ts) admin notification targets.
   * ADMIN_TELEGRAM_CHAT_ID: numeric chat id to DM new feedback to (uses the
   * existing TELEGRAM_BOT_TOKEN). ADMIN_FEEDBACK_EMAIL: fallback recipient
   * (uses RESEND_API_KEY). Both optional — feedback is still stored in D1
   * without either; notification is best-effort.
   */
  ADMIN_TELEGRAM_CHAT_ID?: string;
  ADMIN_FEEDBACK_EMAIL?: string;
  /**
   * v0.14.5 — Lemon Squeezy MoR for paid tiers (Stripe Korea is
   * personal-only; LS handles VAT across KR/US/EU). All four secrets
   * required for billing routes to function; otherwise /billing
   * returns 503 billing_not_configured.
   *
   * Set via:
   *   wrangler secret put LEMONSQUEEZY_API_KEY      (from LS dashboard → API)
   *   wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET (chosen when creating webhook)
   *   wrangler secret put LEMONSQUEEZY_STORE_ID     (numeric store id)
   *   wrangler secret put LEMONSQUEEZY_VARIANT_ID_FIRST_PR (variant id of the $3 product)
   */
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_VARIANT_ID_FIRST_PR?: string;
  /**
   * LS subscriptions — variant id → monthly workspace review credits.
   * JSON string like {"123456":30,"789012":100}. Parsed fail-safe by
   * parseSubscriptionVariantCredits(): malformed JSON / non-object →
   * treated as empty mapping (subscription events still ack 200 and
   * persist state, but no credits are granted; a structured line is
   * logged for manual review). Unknown variants → log + no grant.
   * Set via wrangler.toml [vars] or `wrangler secret put`.
   */
  LS_SUBSCRIPTION_VARIANT_CREDITS?: string;
  /**
   * Founder-alert hook for the very first external installs.
   * When a `gh_app_installations` row is created in the install/created
   * webhook and `account_login !== FOUNDER_GITHUB_LOGIN`, the Worker
   * fires a one-shot Telegram message to `FOUNDER_TG_CHAT_ID` (uses
   * the same `TELEGRAM_BOT_TOKEN` already in use).
   *
   * Both are optional — alert is skipped silently when either is unset
   * or when the install is the founder's own. Set via:
   *   wrangler secret put FOUNDER_GITHUB_LOGIN     (e.g. seunghunbae-3svs)
   *   wrangler secret put FOUNDER_TG_CHAT_ID       (numeric Telegram chat id)
   */
  FOUNDER_GITHUB_LOGIN?: string;
  FOUNDER_TG_CHAT_ID?: string;
  /**
   * Stage 24 — feature flags for actual credit debits.
   * Both default to false; set "true" via wrangler.toml [vars] to activate.
   *
   * ENABLE_ACTUAL_CREDIT_DEBITS: when "true", debitCredits() writes D1.
   * ENABLE_CREDIT_BLOCKING:      when "true", PR review returns HTTP 402
   *   if the user has insufficient credit after allowance is exhausted.
   *   Has no effect when ENABLE_ACTUAL_CREDIT_DEBITS is false.
   *
   * Stage 31 — limited rollout allowlist.
   * ACTUAL_DEBIT_ALLOWED_USER_KEYS: comma-separated list of userKeys
   *   eligible for actual debits when ENABLE_ACTUAL_CREDIT_DEBITS=true.
   *   Empty (default) → no user receives actual debits even when flag is on.
   *   "*" wildcard is NOT supported.
   */
  ENABLE_ACTUAL_CREDIT_DEBITS?: string;
  ENABLE_CREDIT_BLOCKING?: string;
  ACTUAL_DEBIT_ALLOWED_USER_KEYS?: string;
  /**
   * Stage 204 — Better Auth LOCAL-ONLY spike feature flags. All default OFF; production
   * leaves them unset so the spike never activates. Set only in local dev.
   *
   * AUTH_ENABLED:        when "true", the local-only Better Auth spike runtime may construct.
   * AUTH_PROVIDER:       provider id for the spike (currently "better-auth").
   * BETTER_AUTH_SECRET:  server-side signing secret for the local spike (local dev only).
   *   Never commit a real value; set via local env. The spike stays disabled when unset.
   *   Real secret handling, D1 wiring, and any production rollout are separately gated.
   *
   * Stage 227 — optional Better Auth topology config (cookie/CORS readiness). Both are
   * OPTIONAL and purely additive: when unset, the runtime behaves exactly as before (Better
   * Auth derives the origin from the incoming request). Setting them does NOT activate auth
   * (still gated by AUTH_ENABLED). They map directly to Better Auth options of the same name:
   * BETTER_AUTH_BASE_URL:        production base URL, e.g. "https://app.trysimsa.com" → `baseURL`.
   * BETTER_AUTH_TRUSTED_ORIGINS: comma-separated allowed origins → `trustedOrigins: string[]`.
   */
  AUTH_ENABLED?: string;
  AUTH_PROVIDER?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_BASE_URL?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  /**
   * GitHub SOCIAL LOGIN (Better Auth socialProviders.github) — a SEPARATE
   * GitHub OAuth app from WORKSPACE_GH_* (the repo-connect app): GitHub
   * requires the redirect host to exactly match the registered callback host,
   * and the login callback lives on the DASHBOARD origin
   * (https://app.trysimsa.com/api/auth/callback/github via the /api/auth
   * proxy) while repo-connect's lives on the Worker origin. Dormant until BOTH
   * are set. Secret via the set-worker-secrets workflow — never local wrangler.
   */
  AUTH_GH_CLIENT_ID?: string;
  AUTH_GH_CLIENT_SECRET?: string;
  /**
   * D3 — Google SOCIAL LOGIN (Better Auth socialProviders.google). Many
   * non-developers have a Google account, so this is the first-class social
   * option for the open beta. Callback lives on the DASHBOARD origin
   * (https://app.trysimsa.com/api/auth/callback/google via the /api/auth proxy).
   * Dormant until BOTH are set. Secret via the set-worker-secrets workflow —
   * never local wrangler. (Kakao is deferred post-open: its email scope needs a
   * Kakao Biz app / identity verification.)
   */
  AUTH_GOOGLE_CLIENT_ID?: string;
  AUTH_GOOGLE_CLIENT_SECRET?: string;
  /**
   * Stage 241 — auth sign-up exposure guard. Controls whether the public
   * `POST /api/auth/sign-up/*` endpoint is allowed, INDEPENDENTLY of AUTH_ENABLED.
   * Fail-closed: default (unset / unknown) = "disabled" → sign-up is blocked (403
   * signup_disabled) even when auth is enabled. Sign-in / session / sign-out are never
   * affected by this flag. Values: "open" (allow sign-up) · "invite_only" (block public
   * sign-up; invite enforcement is deferred to a later stage) · "disabled" (block).
   */
  AUTH_SIGNUP_MODE?: string;
}

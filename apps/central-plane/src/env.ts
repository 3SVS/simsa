/**
 * The binding surface we accept from the Workers runtime. Added to as
 * follow-up PRs introduce KV (rate limits), Queues (async aggregation),
 * secrets (GITHUB_CLIENT_ID / SECRET for OAuth), etc.
 */
export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
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
   *   WORKSPACE_GH_DASHBOARD_URL = "https://dashboard.conclave-ai.dev"  (optional)
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
   * Stage 4 — hourly request cap for POST /workspace/idea-to-spec-draft.
   * Parsed as integer; defaults to 20 when unset or non-numeric.
   * Set via wrangler.toml [vars] or `wrangler secret put`.
   */
  WORKSPACE_GENERATION_LIMIT_PER_HOUR?: string;
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
}

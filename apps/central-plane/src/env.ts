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
}

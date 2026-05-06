-- v0.16 SaaS migration — adds the tables Problem 3 needs to deliver
-- the central-plane SaaS flow:
--   * saas_users          — registered users (linked to GitHub identity)
--   * saas_tokens         — long-lived bearer tokens issued via Device Flow
--   * saas_device_codes   — RFC 8628 device-code session table
--   * gh_app_installations — tracks Conclave AI Code Council install state
--   * usage_meters        — Stripe metering precursor (per-event records)
--
-- All names prefixed with `saas_` or `gh_app_` to avoid collisions with
-- the legacy oauth_devices / installs tables (which serve the older
-- CONCLAVE_TOKEN + repository_dispatch path; both flows coexist during
-- the transition).

CREATE TABLE IF NOT EXISTS saas_users (
  id              TEXT PRIMARY KEY,                  -- usr_<time36>_<rand16>
  github_user_id  INTEGER NOT NULL UNIQUE,           -- numeric GH user id
  github_login    TEXT NOT NULL,                     -- e.g., "seunghunbae-3svs"
  email           TEXT,                              -- optional, from GH email scope
  tier            TEXT NOT NULL DEFAULT 'free',      -- free | solo | pro
  byo_anthropic   INTEGER NOT NULL DEFAULT 0,        -- 0=platform-managed key, 1=BYO Anthropic key
  data_share_opt_in INTEGER NOT NULL DEFAULT 1,      -- federated catalog contribution; default ON
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_users_github_login ON saas_users(github_login);

-- Per-user bearer tokens. The CLI stores the raw token in
-- `~/.conclave/auth.json`; we store sha256(token) so leaked DB rows
-- cannot be replayed. Token granting only happens through the Device
-- Flow (saas_device_codes → /auth/token poll); never directly.
CREATE TABLE IF NOT EXISTS saas_tokens (
  id           TEXT PRIMARY KEY,                     -- tok_<time36>_<rand16>
  user_id      TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,                 -- sha256 hex
  scope        TEXT NOT NULL DEFAULT 'cli',          -- cli | webhook | future scopes
  issued_at    TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at   TEXT,                                 -- nullable; user-initiated logout
  FOREIGN KEY (user_id) REFERENCES saas_users(id)
);
CREATE INDEX IF NOT EXISTS idx_saas_tokens_user ON saas_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_tokens_hash ON saas_tokens(token_hash);

-- RFC 8628 device-code session. CLI calls POST /auth/device to start
-- a session; user opens verification_uri in browser + types user_code;
-- our /auth/github/callback approves the device; CLI polls
-- POST /auth/token with device_code and gets a saas_tokens row.
CREATE TABLE IF NOT EXISTS saas_device_codes (
  device_code   TEXT PRIMARY KEY,                    -- dvc_<time36>_<rand24> (secret)
  user_code     TEXT NOT NULL UNIQUE,                -- 8 char public (e.g., WDJB-MJHT)
  status        TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | denied | expired
  approved_user_id TEXT,                             -- saas_users.id once status=approved
  interval_sec  INTEGER NOT NULL DEFAULT 5,          -- min poll interval
  expires_at    TEXT NOT NULL,                       -- 15 min from creation
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_device_codes_user_code ON saas_device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_saas_device_codes_expires ON saas_device_codes(expires_at);

-- GitHub App installation tracking. Populated by /webhook/github when
-- GitHub fires the `installation` event (created / deleted / suspended /
-- unsuspended). Used by /saas/review + /saas/autofix to mint installation
-- access tokens for the target repo.
CREATE TABLE IF NOT EXISTS gh_app_installations (
  installation_id   INTEGER PRIMARY KEY,             -- GH-issued; stable across events
  account_login     TEXT NOT NULL,                   -- "seunghunbae-3svs", etc.
  account_id        INTEGER NOT NULL,                -- numeric GH account id
  target_type       TEXT NOT NULL,                   -- "User" | "Organization"
  repo_selection    TEXT NOT NULL,                   -- "all" | "selected"
  selected_repo_ids TEXT,                            -- JSON array when repo_selection='selected'
  saas_user_id      TEXT,                            -- linked saas_users.id (set after Device Flow login)
  installed_at      TEXT NOT NULL,
  suspended_at      TEXT,
  removed_at        TEXT,
  FOREIGN KEY (saas_user_id) REFERENCES saas_users(id)
);
CREATE INDEX IF NOT EXISTS idx_gh_app_installations_login ON gh_app_installations(account_login);
CREATE INDEX IF NOT EXISTS idx_gh_app_installations_user ON gh_app_installations(saas_user_id);

-- Per-event usage records. Aggregated to Stripe billing meters at
-- billing time. Pre-Stripe (Problem 4) we just collect data so when
-- billing turns on we have history to bill against.
CREATE TABLE IF NOT EXISTS usage_meters (
  id          TEXT PRIMARY KEY,                      -- um_<time36>_<rand16>
  user_id     TEXT NOT NULL,
  meter_name  TEXT NOT NULL,                         -- review.completed | autofix.completed | tokens.input | tokens.output
  quantity    REAL NOT NULL,                         -- usually 1.0; tokens.* uses absolute count
  cost_usd    REAL,                                  -- realised LLM cost where applicable
  occurred_at TEXT NOT NULL,                         -- ISO-8601, when the event happened
  reported_to_stripe_at TEXT,                        -- nullable; set when shipped to Stripe Meters API
  episodic_id TEXT,                                  -- ep-<...> when applicable for traceback
  repo_slug   TEXT,                                  -- denormalised for quick filtering
  FOREIGN KEY (user_id) REFERENCES saas_users(id)
);
CREATE INDEX IF NOT EXISTS idx_usage_meters_user ON usage_meters(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_meters_meter ON usage_meters(meter_name);
CREATE INDEX IF NOT EXISTS idx_usage_meters_occurred ON usage_meters(occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_meters_unreported ON usage_meters(reported_to_stripe_at) WHERE reported_to_stripe_at IS NULL;

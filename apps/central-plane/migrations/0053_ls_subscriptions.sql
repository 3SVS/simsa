-- LS subscriptions — Lemon Squeezy subscription state tracking (additive).
--
-- Why a new table: gh_marketplace_subscriptions is keyed on
-- github_account_id (NOT NULL UNIQUE) and is GitHub-Marketplace-specific;
-- billing_orders is one-row-per-payment with a UNIQUE(provider,
-- provider_order_id) dedup contract we don't want to overload with
-- mutable subscription state. This table is one row per LS subscription,
-- upserted on every subscription_* webhook event.
--
-- Monthly credit grants themselves are NOT stored here — each
-- subscription_payment_success writes a billing_orders row
-- (provider_order_id = 'subinv_<invoiceId>', the idempotency lock) plus a
-- workspace_credit_ledger grant entry (source_event_id =
-- 'ls_subinv_<invoiceId>').

CREATE TABLE IF NOT EXISTS ls_subscriptions (
  id                        TEXT PRIMARY KEY,               -- lssub_<random16>
  provider                  TEXT NOT NULL DEFAULT 'lemonsqueezy',
  provider_subscription_id  TEXT NOT NULL UNIQUE,           -- LS subscription id (data.id)
  customer_id               INTEGER,                        -- LS customer id
  product_id                TEXT,                           -- LS product id
  variant_id                TEXT,                           -- current LS variant id (plan)
  status                    TEXT NOT NULL,                  -- LS status: active | cancelled | expired | past_due | ...
  user_email                TEXT,                           -- email LS captured
  user_key                  TEXT,                           -- workspace userKey from checkout custom_data (nullable)
  monthly_credits           INTEGER NOT NULL DEFAULT 0,     -- mapping result at last event; 0 = unknown variant
  renews_at                 TEXT,                           -- ISO, nullable
  ends_at                   TEXT,                           -- ISO, nullable
  last_event_name           TEXT,                           -- last webhook event applied
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ls_subscriptions_user_key
  ON ls_subscriptions(user_key)
  WHERE user_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ls_subscriptions_email
  ON ls_subscriptions(user_email)
  WHERE user_email IS NOT NULL;

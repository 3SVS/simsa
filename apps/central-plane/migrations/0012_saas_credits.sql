-- v0.16.3 — SaaS trial + paid-credit gate.
--
-- Adds two columns to saas_users so we can charge $1/review without
-- giving every user unlimited free runs:
--   * trial_used    — set to 1 the first time a user consumes a free
--                     trial review. Reset only by manual ops (refunds, etc).
--   * paid_credits  — integer count of paid review credits. Decremented
--                     by /saas/review or the webhook auto-trigger.
--
-- byo_anthropic=1 users bypass both columns entirely (their cost to us
-- is ~$0 since they bring their own LLM key).

ALTER TABLE saas_users ADD COLUMN trial_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saas_users ADD COLUMN paid_credits INTEGER NOT NULL DEFAULT 0;

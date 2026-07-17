-- 0060 — plan_grants (RC-4, 2026-07-17 design lock approved).
--
-- Beta-phase paid-plan entitlement: until billing is live, "paid" is granted
-- manually via POST /admin/plan-grants (INTERNAL_CALLBACK_TOKEN). The resolver
-- (src/plan.ts) treats EITHER an active ls_subscriptions row OR an unrevoked
-- grant here as paid. Additive only; revocation is a timestamp, not a DELETE,
-- so grant history survives.

CREATE TABLE IF NOT EXISTS plan_grants (
  user_key   TEXT NOT NULL PRIMARY KEY,
  plan       TEXT NOT NULL CHECK (plan IN ('paid')),
  note       TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

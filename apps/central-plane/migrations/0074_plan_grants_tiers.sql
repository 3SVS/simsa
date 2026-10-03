-- 0074 — plan_grants tiers (D-24, 2026-10-03 design lock approved).
--
-- D-24.1: plans are now tiers. 0060 allowed only 'paid' (RC-4). Widen the CHECK
-- to the grantable tiers — 'basic' · 'pro' · 'staff' (equipment keys exempt from
-- the D-24.2 project-create cap; not a customer tier) — and keep the legacy
-- 'paid', which src/workspace/entitlements.ts reads as 'pro'.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt in place.
-- Rows are copied as-is: every existing grant stays 'paid' (= pro, unchanged
-- behaviour). No new personal data — user_key / note / timestamps as before.

CREATE TABLE plan_grants_v2 (
  user_key   TEXT NOT NULL PRIMARY KEY,
  plan       TEXT NOT NULL CHECK (plan IN ('paid', 'basic', 'pro', 'staff')),
  note       TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

INSERT INTO plan_grants_v2 (user_key, plan, note, created_at, revoked_at)
  SELECT user_key, plan, note, created_at, revoked_at FROM plan_grants;

DROP TABLE plan_grants;

ALTER TABLE plan_grants_v2 RENAME TO plan_grants;

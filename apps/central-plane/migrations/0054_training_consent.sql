-- 0054 — Training-data consent (per userKey).
--
-- The self-evolve substrate (answer-keys / failure-catalog) distils raw review
-- cycles into RAG rules, then the episodic raw log ages out at 90 days. That is
-- correct for operational memory but destroys the *original* (diff, council
-- verdict, outcome) triplets a future fine-tune / distillation would need.
--
-- This table records EXPLICIT, VERSIONED opt-in to retain those triplets in a
-- durable training store (R2, prefix `training/`). Default is OFF: no row, or
-- consented=0, or a stale consent_version, means NOTHING is captured. Consent is
-- version-gated so a change to the training clause requires re-consent — old
-- rows stop being "active" until the user agrees to the new version.
--
-- Keyed by user_key to mirror workspace_notification_settings (the SaaS identity
-- handle). No PII beyond the handle; the training store itself keys on
-- sha256(user_key), never the raw handle.

CREATE TABLE IF NOT EXISTS workspace_training_consent (
  user_key         TEXT PRIMARY KEY,
  consented        INTEGER NOT NULL DEFAULT 0,  -- 0 = opted out (default), 1 = opted in
  consent_version  TEXT,                        -- ToS training-clause version agreed to (NULL until first opt-in)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

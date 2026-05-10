-- v0.16.15 — Sprint E4 (scaffold): prompt evolution data model.
--
-- Provides infrastructure for A/B-testing agent prompt variants. The
-- ACTUAL routing of treatment traffic + winner-selection logic lands
-- in a follow-up sprint — this migration ships the storage + admin
-- endpoints so operators can register variants and start collecting
-- outcomes the moment Sprint D telemetry has accumulated enough signal.
--
-- Two-table design:
--   prompt_variants — the variants themselves (one row per
--     {agent_id, variant_id} combination, including the canonical
--     baseline).
--   prompt_variant_outcomes — per-review tracking of which variant
--     was used + the resulting catch quality signals. Fed by the
--     CLI when it emits metrics.rag with provenance, OR by the
--     worker when /saas/review runs in a sandbox.
--
-- Lifecycle (target):
--   1. Operator creates variant via POST /admin/prompt-variants.
--   2. status='shadow' — variant runs alongside production but its
--      verdict is recorded, never returned to user.
--   3. After N reviews + minimum window, statistical-significance
--      gate decides win/loss.
--   4. status='promoted' — replaces baseline. Old baseline → 'archived'.
--
-- Today the scaffold leaves status='inactive' on insert; an operator
-- explicitly flips to 'shadow' once the integration with each agent's
-- prompt loader lands.

CREATE TABLE IF NOT EXISTS prompt_variants (
  id              TEXT PRIMARY KEY,            -- pv_<sha8(agent_id+variant_id)>
  agent_id        TEXT NOT NULL,               -- 'claude' | 'openai' | 'gemini' | 'design'
  variant_id      TEXT NOT NULL,               -- author-supplied label (e.g. 'directive-v2')
  is_baseline     INTEGER NOT NULL DEFAULT 0,  -- 1 = current canonical baseline (one per agent_id)
  status          TEXT NOT NULL DEFAULT 'inactive',  -- 'inactive' | 'shadow' | 'promoted' | 'archived'
  description     TEXT,                        -- one-line summary of what this variant changes
  system_prompt   TEXT NOT NULL,               -- the actual prompt body
  created_at      TEXT NOT NULL,
  promoted_at     TEXT,                        -- when status flipped to 'promoted'
  archived_at     TEXT,
  removed_at      TEXT,                        -- soft delete
  UNIQUE(agent_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_variants_agent
  ON prompt_variants(agent_id, status, created_at DESC)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS prompt_variant_outcomes (
  id              TEXT PRIMARY KEY,            -- pvo_<sha8(variant_id+review_id)>
  variant_pk      TEXT NOT NULL,               -- prompt_variants.id
  agent_id        TEXT NOT NULL,
  review_id       TEXT NOT NULL,               -- jobs.id or episodic_id
  verdict         TEXT,                        -- 'approve' | 'rework' | 'reject'
  blocker_count   INTEGER,
  cost_usd        REAL,
  latency_ms      INTEGER,
  user_feedback_severity TEXT,                 -- if user later submitted /feedback referencing this review
  recorded_at     TEXT NOT NULL,
  FOREIGN KEY (variant_pk) REFERENCES prompt_variants(id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_variant_outcomes_variant
  ON prompt_variant_outcomes(variant_pk, recorded_at DESC);

-- v0.16.17 — Sprint E5 (shadow scaffold): agent self-spawning.
--
-- When user feedback or PR file-type clusters reveal a domain conclave
-- doesn't currently handle well (e.g. K8s manifests, GraphQL schemas,
-- Rust code), we want to spin up a NEW agent persona without operator
-- intervention. Today's scope:
--   1. Detect emergence — feedback rows classified into `category='other'`
--      cluster around recognizable hints (file types, vocabulary).
--   2. Synthesize a system prompt via Haiku for the candidate domain.
--   3. Insert into `spawned_agents` with status='shadow' (NEVER affects
--      user verdict). Operator reviews via /admin/spawned-agents.
--   4. Manual graduation: status='promoted' is operator-only, never
--      automatic. Promoted agents start participating in the actual
--      council in a follow-up sprint that wires the registry into the
--      CLI's `buildAgent` factory.
--
-- Distinct from prompt_variants (E4): those are PER-AGENT system-prompt
-- A/B variants. spawned_agents are entirely NEW agent personas that
-- didn't exist before.
--
-- Soft-delete via removed_at preserves history.

CREATE TABLE IF NOT EXISTS spawned_agents (
  id                    TEXT PRIMARY KEY,         -- sa_<sha8(domain_hint)>
  agent_id              TEXT NOT NULL UNIQUE,     -- 'k8s-manifest' / 'graphql-schema' / etc.
  display_name          TEXT NOT NULL,
  domain_hint           TEXT NOT NULL,            -- one-line description of the new domain
  emergence_signal      TEXT,                     -- short summary of WHY this was spawned (which feedback rows / file clusters)
  trigger_feedback_ids  TEXT NOT NULL DEFAULT '[]',  -- JSON array of fb_ ids that motivated this
  system_prompt         TEXT NOT NULL,            -- Haiku-synthesized prompt
  base_agent_id         TEXT,                     -- closest existing agent the prompt was forked from
  status                TEXT NOT NULL DEFAULT 'shadow',  -- 'shadow' | 'promoted' | 'archived'
  spawned_at            TEXT NOT NULL,
  promoted_at           TEXT,
  archived_at           TEXT,
  removed_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_spawned_agents_status
  ON spawned_agents(status, spawned_at DESC)
  WHERE removed_at IS NULL;

-- Per-shadow-agent outcome tracking. Distinct from prompt_variant_outcomes
-- because spawned agents may not even have a comparable baseline.
CREATE TABLE IF NOT EXISTS spawned_agent_outcomes (
  id              TEXT PRIMARY KEY,
  spawned_agent_pk TEXT NOT NULL,
  review_id       TEXT NOT NULL,
  verdict         TEXT,
  blocker_count   INTEGER,
  cost_usd        REAL,
  latency_ms      INTEGER,
  recorded_at     TEXT NOT NULL,
  FOREIGN KEY (spawned_agent_pk) REFERENCES spawned_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_spawned_agent_outcomes_pk
  ON spawned_agent_outcomes(spawned_agent_pk, recorded_at DESC);

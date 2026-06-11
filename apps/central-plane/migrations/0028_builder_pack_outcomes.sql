-- Stage 8: builder pack outcome recording.
-- Stores the result of sending a builder pack to Claude Code / Codex.
-- user_key is the same anonymous UUID used in workspace_projects (no real auth yet).

CREATE TABLE IF NOT EXISTS builder_pack_outcomes (
  id                    TEXT NOT NULL PRIMARY KEY,
  project_id            TEXT NOT NULL,
  user_key              TEXT NOT NULL DEFAULT '',
  target                TEXT NOT NULL,             -- "claude_code" | "codex" | "both"
  selected_item_ids_json TEXT NOT NULL DEFAULT '[]',
  outcome               TEXT NOT NULL,             -- "worked" | "partial" | "failed" | "not_checked"
  note                  TEXT,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_builder_pack_outcomes_project
  ON builder_pack_outcomes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_builder_pack_outcomes_user_key
  ON builder_pack_outcomes (user_key, created_at DESC);

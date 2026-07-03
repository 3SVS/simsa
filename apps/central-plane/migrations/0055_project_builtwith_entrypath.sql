-- 0055 — P1 envelope collection on the project: built_with + entry_path.
--
-- These are captured at project-creation time and copied onto every training
-- record's envelope (built_with, entry_path) so the R2 data resolves per agent
-- and per entry branch. Both can only be tagged at capture — no backfill.
-- Stored as JSON / short text; null until the user answers (default 'null'/NULL).

ALTER TABLE workspace_projects ADD COLUMN built_with_json TEXT NOT NULL DEFAULT 'null';
ALTER TABLE workspace_projects ADD COLUMN entry_path TEXT;

-- Stage 268 — Simsa visual-check repair jobs (ADDITIVE).
--
-- One row per "[고치기]" click on a failed visual check. The Worker dispatches
-- the check's stored agent_prompt (Stage 260B deterministic fix prompt) into
-- the ConclaveSandbox container as a `simsa_repair` job; the container creates
-- a repair branch + draft PR on the user's connected GitHub repo and reports
-- back via /internal/repair-done (Bearer INTERNAL_CALLBACK_TOKEN).
--
-- env_cause: 1 when the check's evidence points at a dead-backend/env-var root
-- cause (ERR_NAME_NOT_RESOLVED / ENOTFOUND / connection-refused patterns).
-- The repair still runs (fallback-style code fixes are legitimate — golf-now
-- PR #38) but the UI must warn that a code change alone may not fully fix it.
--
-- Safety: CREATE TABLE/INDEX IF NOT EXISTS only. No ALTER, no data mutation.

CREATE TABLE IF NOT EXISTS workspace_repair_jobs (
  id              TEXT NOT NULL PRIMARY KEY,
  project_id      TEXT NOT NULL,
  user_key        TEXT NOT NULL,
  visual_check_id TEXT NOT NULL,
  repo_full_name  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed')),
  branch_name     TEXT,
  pr_url          TEXT,
  pr_number       INTEGER,
  env_cause       INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_repair_jobs_check ON workspace_repair_jobs (visual_check_id);
CREATE INDEX IF NOT EXISTS idx_workspace_repair_jobs_project ON workspace_repair_jobs (project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_repair_jobs_user ON workspace_repair_jobs (user_key);

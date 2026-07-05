-- 0058 — in-app feedback (dashboard "help/feedback" replaces the broken mailto).
-- Anonymous userKey-scoped: type + message + auto-attached context.
CREATE TABLE IF NOT EXISTS workspace_feedback (
  id           TEXT PRIMARY KEY,
  user_key     TEXT NOT NULL,
  kind         TEXT NOT NULL,           -- 'bug' | 'question' | 'suggestion'
  message      TEXT NOT NULL,
  route        TEXT,                    -- screen path where it was sent
  project_id   TEXT,                    -- if sent from inside a project
  user_agent   TEXT,                    -- browser UA (context only)
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_feedback_created_idx
  ON workspace_feedback (created_at);

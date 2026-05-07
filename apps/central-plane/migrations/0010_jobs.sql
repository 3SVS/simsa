-- v0.16.2 — jobs table for SaaS pipeline tracking.
--
-- One row per /saas/review or /saas/autofix call. Created at spawn time,
-- updated when the sandbox container POSTs back to /internal/job-done.
--
-- Status lifecycle:
--   accepted → running (when container ack'd) → done | failed | timeout
--
-- We keep verdict + blockers + cycles + smoke outcome here so the
-- forthcoming /saas/jobs/:id endpoint (CLI follow + dashboard) can
-- render history without re-walking usage_meters.
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,                 -- job_<timeMs36>_<rand16>
  user_id         TEXT NOT NULL,
  repo_slug       TEXT NOT NULL,
  pr_number       INTEGER NOT NULL,
  kind            TEXT NOT NULL,                    -- 'review' | 'autofix'
  status          TEXT NOT NULL DEFAULT 'accepted', -- accepted | running | done | failed | timeout
  verdict         TEXT,                             -- approve | rework | reject | unknown
  blockers        INTEGER,
  cycles          INTEGER,
  duration_ms     INTEGER,
  smoke_outcome   TEXT,                             -- ok | broken | skipped
  deploy_url      TEXT,
  error_message   TEXT,
  prd_present     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  completed_at    TEXT,
  FOREIGN KEY (user_id) REFERENCES saas_users(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_repo_pr ON jobs(repo_slug, pr_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at DESC);

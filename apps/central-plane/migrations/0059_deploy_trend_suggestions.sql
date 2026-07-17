-- D14 (2026-07-17): deploy/service trend review queue.
-- Weekly watcher rows land here as 'pending'; a human reviews and updates
-- workspace/service-examples.ts (the single guidance-freshness seam), then
-- marks the row applied/dismissed. Never auto-applied.
CREATE TABLE IF NOT EXISTS deploy_trend_suggestions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_label TEXT NOT NULL,
  release_tag TEXT NOT NULL,
  release_url TEXT NOT NULL,
  relevance TEXT NOT NULL,           -- 'high' | 'medium'
  title TEXT NOT NULL,
  summary_ko TEXT NOT NULL,
  guidance_key TEXT NOT NULL,        -- 'deploy' | 'storage' | 'email' | 'payment' | 'other'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'applied' | 'dismissed'
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deploy_trend_status ON deploy_trend_suggestions(status, created_at);

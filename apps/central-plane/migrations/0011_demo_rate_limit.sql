-- Tasks #51 — landing demo rate limit table.
--
-- /saas/demo/review is no-auth (anyone on the landing page can try it),
-- so we cap each IP at N demos per UTC day. We hash the IP with a
-- per-deploy salt + sha256 so the table never stores raw addresses.
-- One row per (ip_hash, day) with a quantity counter; the demo handler
-- INSERTs ON CONFLICT increments the counter and rejects when the cap
-- is reached.
CREATE TABLE IF NOT EXISTS demo_rate_limit (
  ip_hash    TEXT NOT NULL,
  day_utc    TEXT NOT NULL,           -- YYYY-MM-DD
  count      INTEGER NOT NULL DEFAULT 0,
  first_at   TEXT NOT NULL,
  last_at    TEXT NOT NULL,
  PRIMARY KEY (ip_hash, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_demo_rate_day ON demo_rate_limit(day_utc);

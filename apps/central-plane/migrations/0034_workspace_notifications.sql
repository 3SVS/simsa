-- Stage 17: Telegram notification settings + history
CREATE TABLE IF NOT EXISTS workspace_notification_settings (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  notify_policy TEXT NOT NULL DEFAULT 'problems_only',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_notification_settings_user_channel
ON workspace_notification_settings(user_key, channel);

CREATE TABLE IF NOT EXISTS workspace_notifications (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  project_id TEXT,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  destination_preview TEXT,
  message_preview TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_user
ON workspace_notifications(user_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_project
ON workspace_notifications(project_id, created_at DESC);

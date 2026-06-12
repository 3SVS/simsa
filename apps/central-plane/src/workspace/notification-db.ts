/**
 * workspace/notification-db.ts
 *
 * D1 helpers for workspace_notification_settings and workspace_notifications.
 * Settings: per user_key+channel, stores chat_id + policy.
 * Notifications: event log (sent / skipped / error).
 */
import type { Env } from "../env.js";

export type NotifyPolicy = "problems_only" | "always" | "disabled";
export type NotificationStatus = "sent" | "skipped" | "error";
export type NotificationChannel = "telegram";

export type DbNotificationSettings = {
  id: string;
  userKey: string;
  channel: NotificationChannel;
  chatId: string;
  enabled: boolean;
  notifyPolicy: NotifyPolicy;
  createdAt: string;
  updatedAt: string;
};

export type DbNotification = {
  id: string;
  userKey: string;
  projectId?: string;
  channel: NotificationChannel;
  eventType: string;
  status: NotificationStatus;
  destinationPreview?: string;
  messagePreview?: string;
  errorMessage?: string;
  createdAt: string;
};

type DbRow = Record<string, unknown>;

function randId(prefix: string): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${r}`;
}

function rowToSettings(row: DbRow): DbNotificationSettings {
  return {
    id: row["id"] as string,
    userKey: row["user_key"] as string,
    channel: row["channel"] as NotificationChannel,
    chatId: row["chat_id"] as string,
    enabled: (row["enabled"] as number) !== 0,
    notifyPolicy: (row["notify_policy"] as NotifyPolicy) ?? "problems_only",
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

function rowToNotification(row: DbRow): DbNotification {
  return {
    id: row["id"] as string,
    userKey: row["user_key"] as string,
    projectId: (row["project_id"] as string | null) ?? undefined,
    channel: row["channel"] as NotificationChannel,
    eventType: row["event_type"] as string,
    status: row["status"] as NotificationStatus,
    destinationPreview: (row["destination_preview"] as string | null) ?? undefined,
    messagePreview: (row["message_preview"] as string | null) ?? undefined,
    errorMessage: (row["error_message"] as string | null) ?? undefined,
    createdAt: row["created_at"] as string,
  };
}

export async function upsertNotificationSettings(
  env: Env,
  input: {
    userKey: string;
    channel: NotificationChannel;
    chatId: string;
    enabled: boolean;
    notifyPolicy: NotifyPolicy;
  },
): Promise<DbNotificationSettings> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT * FROM workspace_notification_settings WHERE user_key = ? AND channel = ? LIMIT 1`,
  ).bind(input.userKey, input.channel).first<DbRow>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE workspace_notification_settings
         SET chat_id = ?, enabled = ?, notify_policy = ?, updated_at = ?
       WHERE user_key = ? AND channel = ?`,
    ).bind(
      input.chatId,
      input.enabled ? 1 : 0,
      input.notifyPolicy,
      now,
      input.userKey,
      input.channel,
    ).run();
    return rowToSettings({
      ...existing,
      chat_id: input.chatId,
      enabled: input.enabled ? 1 : 0,
      notify_policy: input.notifyPolicy,
      updated_at: now,
    });
  }

  const id = randId("wns");
  await env.DB.prepare(
    `INSERT INTO workspace_notification_settings
       (id, user_key, channel, chat_id, enabled, notify_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.userKey, input.channel, input.chatId, input.enabled ? 1 : 0, input.notifyPolicy, now, now).run();

  return { id, userKey: input.userKey, channel: input.channel, chatId: input.chatId, enabled: input.enabled, notifyPolicy: input.notifyPolicy, createdAt: now, updatedAt: now };
}

export async function getNotificationSettings(
  env: Env,
  userKey: string,
  channel: NotificationChannel,
): Promise<DbNotificationSettings | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM workspace_notification_settings WHERE user_key = ? AND channel = ? LIMIT 1`,
  ).bind(userKey, channel).first<DbRow>();
  return row ? rowToSettings(row) : null;
}

export async function insertNotificationRecord(
  env: Env,
  input: {
    userKey: string;
    projectId?: string;
    channel: NotificationChannel;
    eventType: string;
    status: NotificationStatus;
    destinationPreview?: string;
    messagePreview?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const id = randId("wnr");
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO workspace_notifications
         (id, user_key, project_id, channel, event_type, status,
          destination_preview, message_preview, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      input.userKey,
      input.projectId ?? null,
      input.channel,
      input.eventType,
      input.status,
      input.destinationPreview ?? null,
      input.messagePreview ?? null,
      input.errorMessage ?? null,
      now,
    ).run();
  } catch (err) {
    // Non-fatal: notification recording must not break the main operation
    console.warn("[notification-db] insertNotificationRecord failed:", err);
  }
}

export async function getNotifications(
  env: Env,
  userKey: string,
  limit = 20,
): Promise<DbNotification[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM workspace_notifications WHERE user_key = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(userKey, limit).all<DbRow>();
  return (rows.results ?? []).map(rowToNotification);
}

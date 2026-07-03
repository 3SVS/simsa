"use client";

/**
 * Dashboard API client for workspace Telegram + email notification settings
 * and history. TELEGRAM_BOT_TOKEN / RESEND_API_KEY are NEVER exposed here —
 * central-plane manages them.
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotifyPolicy = "problems_only" | "always" | "disabled";
export type NotificationChannel = "telegram" | "email";
export type NotificationStatus = "sent" | "skipped" | "error";

export type NotificationSettings = {
  id: string;
  userKey: string;
  channel: NotificationChannel;
  chatId: string;
  /** Email channel only — the destination address (server alias of chatId). */
  emailAddress?: string;
  enabled: boolean;
  notifyPolicy: NotifyPolicy;
  createdAt: string;
  updatedAt: string;
};

export type NotificationRecord = {
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

export type NotificationSettingsResponse =
  | {
      ok: true;
      settings: NotificationSettings | null;
      telegramEnabled: boolean;
      /** True when the server has RESEND_API_KEY provisioned (email channel usable). */
      emailConfigured?: boolean;
    }
  | { ok: false; error: string };

export type SaveSettingsResponse =
  | { ok: true; settings: NotificationSettings }
  | { ok: false; error: string };

export type TestNotificationResponse =
  | { ok: true; status: "sent" }
  | { ok: false; error: string; message?: string };

export type NotificationsListResponse =
  | { ok: true; notifications: NotificationRecord[] }
  | { ok: false; error: string };

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchNotificationSettings(
  userKey: string,
  channel: NotificationChannel = "telegram",
): Promise<NotificationSettingsResponse> {
  try {
    const res = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/notifications/settings?userKey=${encodeURIComponent(userKey)}&channel=${channel}`,
    );
    return (await res.json()) as NotificationSettingsResponse;
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}

export async function saveNotificationSettings(input: {
  userKey: string;
  channel?: NotificationChannel;
  /** Telegram channel destination. */
  chatId?: string;
  /** Email channel destination. */
  emailAddress?: string;
  enabled: boolean;
  notifyPolicy: NotifyPolicy;
}): Promise<SaveSettingsResponse> {
  try {
    const res = await fetch(`${CENTRAL_PLANE_URL}/workspace/notifications/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, channel: input.channel ?? "telegram" }),
    });
    return (await res.json()) as SaveSettingsResponse;
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}

export async function testNotification(
  userKey: string,
  channel: NotificationChannel = "telegram",
): Promise<TestNotificationResponse> {
  try {
    const res = await fetch(`${CENTRAL_PLANE_URL}/workspace/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, channel }),
    });
    return (await res.json()) as TestNotificationResponse;
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}

export async function fetchNotifications(userKey: string): Promise<NotificationsListResponse> {
  try {
    const res = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/notifications?userKey=${encodeURIComponent(userKey)}`,
    );
    return (await res.json()) as NotificationsListResponse;
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}

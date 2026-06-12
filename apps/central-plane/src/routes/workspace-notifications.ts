/**
 * workspace-notifications.ts
 *
 * Telegram notification settings + history routes for Workspace.
 *
 * GET  /workspace/notifications/settings?userKey=...&channel=telegram
 * POST /workspace/notifications/settings
 * POST /workspace/notifications/test
 * GET  /workspace/notifications?userKey=...
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import {
  upsertNotificationSettings,
  getNotificationSettings,
  insertNotificationRecord,
  getNotifications,
  type NotifyPolicy,
  type NotificationChannel,
} from "../workspace/notification-db.js";
import { sendWorkspaceTelegramMessage } from "../workspace/telegram-notify.js";

const ALLOWED_ORIGINS = [
  "http://localhost:3002",
  "http://localhost:3000",
  "https://dashboard.conclave-ai.dev",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

export function createWorkspaceNotificationRoutes(
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.options("/workspace/notifications/*", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  // ── GET /workspace/notifications/settings ─────────────────────────────────
  app.get("/workspace/notifications/settings", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const userKey = c.req.query("userKey") ?? "";
    const channel = ((c.req.query("channel") ?? "telegram") as NotificationChannel);

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    try {
      const settings = await getNotificationSettings(c.env, userKey, channel);
      // Expose telegramEnabled so the dashboard can show whether the server has the bot token
      const telegramEnabled = Boolean(c.env.TELEGRAM_BOT_TOKEN);
      return json({ ok: true, settings, telegramEnabled }, 200, origin);
    } catch (err) {
      console.error("[notifications/settings GET] error:", err);
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  // ── POST /workspace/notifications/settings ─────────────────────────────────
  app.post("/workspace/notifications/settings", async (c) => {
    const origin = c.req.header("origin") ?? null;
    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    const channel = (typeof b["channel"] === "string" ? b["channel"] : "telegram") as NotificationChannel;
    const chatId = typeof b["chatId"] === "string" ? b["chatId"].trim() : "";
    const enabled = typeof b["enabled"] === "boolean" ? b["enabled"] : true;
    const notifyPolicy = (typeof b["notifyPolicy"] === "string" ? b["notifyPolicy"] : "problems_only") as NotifyPolicy;

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    if (!chatId) return json({ ok: false, error: "chatId_required" }, 400, origin);
    if (!["problems_only", "always", "disabled"].includes(notifyPolicy)) {
      return json({ ok: false, error: "invalid_notifyPolicy" }, 400, origin);
    }
    if (channel !== "telegram") {
      return json({ ok: false, error: "unsupported_channel" }, 400, origin);
    }

    try {
      const settings = await upsertNotificationSettings(c.env, { userKey, channel, chatId, enabled, notifyPolicy });
      return json({ ok: true, settings }, 200, origin);
    } catch (err) {
      console.error("[notifications/settings POST] error:", err);
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  // ── POST /workspace/notifications/test ────────────────────────────────────
  app.post("/workspace/notifications/test", async (c) => {
    const origin = c.req.header("origin") ?? null;
    let body: unknown;
    try { body = await c.req.json(); } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    const channel = ((typeof b["channel"] === "string" ? b["channel"] : "telegram") as NotificationChannel);

    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return json({
        ok: false,
        error: "telegram_not_configured",
        message: "Telegram 알림을 보내려면 서버 설정이 필요해요.",
      }, 503, origin);
    }

    const settings = await getNotificationSettings(c.env, userKey, channel).catch(() => null);
    if (!settings) {
      return json({ ok: false, error: "settings_not_found", message: "먼저 채팅 ID를 저장해주세요." }, 400, origin);
    }

    const testText = `Conclave 테스트 메시지\n\n알림이 정상적으로 설정됐어요.\nPR 확인 완료 시 이 채팅으로 결과를 알려드릴게요.`;
    const result = await sendWorkspaceTelegramMessage(c.env, settings.chatId, testText, fetchImpl);

    await insertNotificationRecord(c.env, {
      userKey,
      channel,
      eventType: "test",
      status: result.ok ? "sent" : "error",
      destinationPreview: `chat:${settings.chatId}`,
      messagePreview: testText.slice(0, 100),
      errorMessage: result.ok ? undefined : result.error,
    });

    if (result.ok) {
      return json({ ok: true, status: "sent" }, 200, origin);
    }
    return json({
      ok: false,
      error: result.error,
      message: "Telegram 전송에 실패했어요. 채팅 ID가 맞는지 확인해주세요.",
    }, 502, origin);
  });

  // ── GET /workspace/notifications ──────────────────────────────────────────
  app.get("/workspace/notifications", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);

    try {
      const notifications = await getNotifications(c.env, userKey, 20);
      return json({ ok: true, notifications }, 200, origin);
    } catch (err) {
      console.error("[notifications GET] error:", err);
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  return app;
}

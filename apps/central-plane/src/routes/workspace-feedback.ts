/**
 * workspace-feedback.ts — in-app feedback intake (replaces the broken mailto).
 *
 * POST /workspace/feedback
 *   { userKey, kind: "bug"|"question"|"suggestion", message, route?, projectId? }
 *   → { ok: true }  (stored in D1; admin notified best-effort)
 *
 * Non-developers often have no mail client configured, so the dashboard's
 * "help/feedback" is an in-app form. Context (route, projectId, a hash of the
 * userKey, UA) is attached automatically so the operator knows WHERE it came
 * from without the user explaining. No PII beyond what the user types.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { ALLOWED_ORIGINS } from "./cors.js";
import { sendWorkspaceTelegramMessage } from "../workspace/telegram-notify.js";
import { sendWorkspaceEmail } from "../workspace/email-notify.js";
import { wrapBrandedEmail } from "../workspace/email-brand.js";

const KINDS = new Set(["bug", "question", "suggestion"]);
const MAX_MESSAGE = 4000;

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-Simsa-User-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Notify the operator of new feedback — Telegram first, else email. Best-effort. */
async function notifyAdmin(env: Env, summary: string): Promise<void> {
  try {
    if (env.ADMIN_TELEGRAM_CHAT_ID && env.TELEGRAM_BOT_TOKEN) {
      const r = await sendWorkspaceTelegramMessage(env, env.ADMIN_TELEGRAM_CHAT_ID, summary);
      if (r.ok) return;
    }
    if (env.ADMIN_FEEDBACK_EMAIL && env.RESEND_API_KEY) {
      const { html, text } = wrapBrandedEmail({
        heading: "New feedback · 새 피드백",
        paragraphs: summary.split("\n").filter((line) => line.trim().length > 0),
      });
      await sendWorkspaceEmail(env, {
        to: env.ADMIN_FEEDBACK_EMAIL,
        subject: "Simsa — new feedback",
        text,
        html,
      });
    }
  } catch (err) {
    console.warn("[workspace/feedback] admin notify failed (non-fatal):", err);
  }
}

export function createWorkspaceFeedbackRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.options("/workspace/feedback", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  app.post("/workspace/feedback", async (c) => {
    const origin = c.req.header("origin") ?? null;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    const kind = typeof b["kind"] === "string" ? b["kind"] : "";
    const message = typeof b["message"] === "string" ? b["message"].trim() : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    if (!KINDS.has(kind)) return json({ ok: false, error: "invalid_kind" }, 400, origin);
    if (!message) return json({ ok: false, error: "message_required" }, 400, origin);

    const route = typeof b["route"] === "string" ? b["route"].slice(0, 200) : null;
    const projectId = typeof b["projectId"] === "string" ? b["projectId"].slice(0, 80) : null;
    const userAgent = (c.req.header("user-agent") ?? "").slice(0, 300);
    const id = `fb_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const now = new Date().toISOString();

    try {
      await c.env.DB.prepare(
        `INSERT INTO workspace_feedback
           (id, user_key, kind, message, route, project_id, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, userKey, kind, message.slice(0, MAX_MESSAGE), route, projectId, userAgent, now)
        .run();
    } catch (err) {
      console.error("[workspace/feedback] insert failed:", err);
      return json({ ok: false, error: "save_failed" }, 500, origin);
    }

    // Admin notify with a userKey HASH (never the raw key) — context, not identity.
    const ukHash = (await sha256Hex(userKey)).slice(0, 12);
    const summary =
      `[Simsa feedback · ${kind}]\n` +
      `${message.slice(0, 800)}\n` +
      `— route: ${route ?? "-"} · project: ${projectId ?? "-"} · user: ${ukHash}`;
    // c.executionCtx throws (not undefined) outside a Worker — guard it.
    try {
      c.executionCtx.waitUntil(notifyAdmin(c.env, summary));
    } catch {
      void notifyAdmin(c.env, summary);
    }

    return json({ ok: true }, 200, origin);
  });

  return app;
}

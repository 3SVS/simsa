/**
 * workspace/email-notify.ts
 *
 * Workspace email notifications via the Resend HTTP API — the simple default
 * alternative to Telegram for "PR review complete" notifications.
 *
 * Dormant until RESEND_API_KEY is provisioned: every entry point returns
 * { ok: false, error: "not_configured" } instead of throwing when the key is
 * unset. `fetch` is injectable for tests (mirrors telegram-notify.ts).
 *
 * PRIVACY: never log or store a full email address — use maskEmailAddress()
 * ("a***@domain") in logs and notification-history previews.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { BRAND } from "./brand.js";
import {
  getNotificationSettings,
  insertNotificationRecord,
} from "./notification-db.js";
import { insertUsageEvent } from "./usage-events-db.js";
import {
  buildPrReviewTelegramMessage,
  type PrReviewTelegramMessageOptions,
} from "./telegram-notify.js";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Simsa <notify@trysimsa.com>";

/** Loose format check: something@something.tld (no RFC 5322 pedantry). */
export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** "alice@example.com" → "a***@example.com". Never returns the full local part. */
export function maskEmailAddress(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const first = email.slice(0, 1);
  return `${first}***@${email.slice(at + 1)}`;
}

export type SendEmailResult = { ok: boolean; error?: string };

/**
 * Send a plain-text email via Resend. Never throws.
 * Missing RESEND_API_KEY → { ok: false, error: "not_configured" }.
 */
export async function sendWorkspaceEmail(
  env: Env,
  input: { to: string; subject: string; text: string },
  fetchImpl?: FetchLike,
): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "not_configured" };

  const doFetch: FetchLike = fetchImpl ?? (fetch.bind(globalThis) as FetchLike);
  try {
    const res = await doFetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.NOTIFY_EMAIL_FROM ?? DEFAULT_FROM,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!res.ok) {
      // Do NOT log the response body — it may echo the recipient address.
      console.warn(`[email-notify] Resend API error ${res.status} sending to ${maskEmailAddress(input.to)}`);
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[email-notify] send failed to ${maskEmailAddress(input.to)}: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Subject + plain-text body for the "PR review complete" email.
 * Body reuses the Telegram plain-text builder so both channels stay in sync.
 */
export function buildPrReviewEmailContent(
  opts: PrReviewTelegramMessageOptions,
): { subject: string; text: string } {
  return {
    subject: `[${BRAND.productName}] PR 확인 완료 — ${opts.repoFullName} #${opts.prNumber}`,
    text: buildPrReviewTelegramMessage(opts),
  };
}

export type PrReviewEmailNotifyInput = {
  userKey: string;
  projectId: string;
  repoFullName: string;
  prNumber: number;
  prTitle?: string;
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  /** Full per-item results; non-passed items are listed in the email. */
  results: Array<{ title: string; status: string }>;
};

/**
 * Self-contained "PR review complete" email dispatch: loads the user's email
 * notification settings, applies the notify policy, sends via Resend, and
 * records notification history + a usage event. NEVER throws — designed to be
 * a single non-fatal call site in the PR review completion path.
 */
export async function notifyPrReviewCompleteByEmail(
  env: Env,
  input: PrReviewEmailNotifyInput,
  fetchImpl?: FetchLike,
): Promise<void> {
  try {
    const settings = await getNotificationSettings(env, input.userKey, "email").catch(() => null);
    if (!settings || !settings.enabled || settings.notifyPolicy === "disabled") return;

    const address = settings.chatId; // email channel stores the address in the chat_id column
    const masked = maskEmailAddress(address);
    const hasProblems =
      input.summary.failed > 0 ||
      input.summary.inconclusive > 0 ||
      input.summary.needsDecision > 0;

    if (settings.notifyPolicy === "problems_only" && !hasProblems) {
      await insertNotificationRecord(env, {
        userKey: input.userKey,
        projectId: input.projectId,
        channel: "email",
        eventType: "pr_review_complete",
        status: "skipped",
        destinationPreview: `email:${masked}`,
      });
      return;
    }

    const problematicItems = input.results
      .filter((r) => r.status !== "passed")
      .map((r) => ({ title: r.title, status: r.status }));

    const dashboardBase = env.DASHBOARD_BASE_URL ?? BRAND.appUrl;
    const { subject, text } = buildPrReviewEmailContent({
      repoFullName: input.repoFullName,
      prNumber: input.prNumber,
      prTitle: input.prTitle,
      summary: input.summary,
      problematicItems,
      dashboardUrl: `${dashboardBase}/projects/${input.projectId}/github`,
    });

    const sendResult = await sendWorkspaceEmail(env, { to: address, subject, text }, fetchImpl);

    await insertNotificationRecord(env, {
      userKey: input.userKey,
      projectId: input.projectId,
      channel: "email",
      eventType: "pr_review_complete",
      status: sendResult.ok ? "sent" : "error",
      destinationPreview: `email:${masked}`,
      messagePreview: text.slice(0, 100),
      errorMessage: sendResult.ok ? undefined : sendResult.error,
    });

    await insertUsageEvent(env, {
      userKey: input.userKey,
      projectId: input.projectId,
      eventType: sendResult.ok
        ? "workspace_email_notification_sent"
        : "workspace_email_notification_error",
    });
  } catch (err) {
    console.warn("[email-notify] pr_review_complete dispatch failed (non-fatal):", err);
  }
}

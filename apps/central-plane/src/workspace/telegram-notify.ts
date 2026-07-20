/**
 * workspace/telegram-notify.ts
 *
 * Workspace-specific Telegram notification helpers.
 * Uses the existing TelegramClient for transport.
 * Message content: plain text only (no markdown), max 3500 chars.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { TelegramClient } from "../telegram.js";

const MAX_MESSAGE_CHARS = 3500;

export function truncateTelegramMessage(
  text: string,
  maxLen = MAX_MESSAGE_CHARS,
  locale: "ko" | "en" = "ko",
): string {
  if (text.length <= maxLen) return text;
  const suffix =
    locale === "en"
      ? "\n\n[Message truncated — it was too long.]"
      : "\n\n[메시지가 너무 길어 일부가 생략됐습니다.]";
  return text.slice(0, maxLen - suffix.length) + suffix;
}

export type PrReviewTelegramMessageOptions = {
  projectName?: string;
  repoFullName: string;
  prNumber: number;
  prTitle?: string;
  summary: {
    passed: number;
    failed: number;
    inconclusive: number;
    needsDecision: number;
  };
  problematicItems?: Array<{ title: string; status: string }>;
  dashboardUrl?: string;
  prHtmlUrl?: string;
  /** Train E (2026-07-21): 리뷰 요청의 locale을 알림에도 관통. 미지정 = ko. */
  locale?: "ko" | "en";
};

const STATUS_LABEL: Record<"ko" | "en", Record<string, string>> = {
  ko: { failed: "안 맞음", inconclusive: "확인 부족", needs_decision: "결정 필요", passed: "통과" },
  en: { failed: "Not matching", inconclusive: "Not enough evidence", needs_decision: "Needs a decision", passed: "Passed" },
};

const NOTIFY_COPY = {
  ko: {
    title: "Simsa PR 확인 완료",
    project: "프로젝트",
    repo: "저장소",
    results: "결과:",
    passed: "통과",
    failed: "안 맞음",
    inconclusive: "확인 부족",
    needsDecision: "결정 필요",
    remaining: "아직 봐야 할 항목:",
    dashboard: "대시보드에서 자세히 보기:",
    pr: "PR 바로가기:",
  },
  en: {
    title: "Simsa PR check complete",
    project: "Project",
    repo: "Repository",
    results: "Results:",
    passed: "Passed",
    failed: "Not matching",
    inconclusive: "Not enough evidence",
    needsDecision: "Needs a decision",
    remaining: "Items that still need a look:",
    dashboard: "See details on the dashboard:",
    pr: "Open the PR:",
  },
} as const;

export function buildPrReviewTelegramMessage(opts: PrReviewTelegramMessageOptions): string {
  const loc: "ko" | "en" = opts.locale === "en" ? "en" : "ko";
  const C = NOTIFY_COPY[loc];
  const lines: string[] = [C.title, ""];

  if (opts.projectName) lines.push(`${C.project}: ${opts.projectName}`);
  lines.push(`${C.repo}: ${opts.repoFullName}`);
  lines.push(`PR: #${opts.prNumber}${opts.prTitle ? ` ${opts.prTitle}` : ""}`);
  lines.push("");

  lines.push(C.results);
  lines.push(`- ${C.passed}: ${opts.summary.passed}`);
  lines.push(`- ${C.failed}: ${opts.summary.failed}`);
  lines.push(`- ${C.inconclusive}: ${opts.summary.inconclusive}`);
  lines.push(`- ${C.needsDecision}: ${opts.summary.needsDecision}`);

  const problemItems = opts.problematicItems ?? [];
  if (problemItems.length > 0) {
    lines.push("");
    lines.push(C.remaining);
    for (const item of problemItems.slice(0, 10)) {
      lines.push(`- ${item.title} (${STATUS_LABEL[loc][item.status] ?? item.status})`);
    }
    if (problemItems.length > 10) {
      lines.push(loc === "en" ? `- ...and ${problemItems.length - 10} more` : `- 외 ${problemItems.length - 10}건`);
    }
  }

  if (opts.dashboardUrl) {
    lines.push("");
    lines.push(`${C.dashboard} ${opts.dashboardUrl}`);
  }
  if (opts.prHtmlUrl) {
    lines.push(`${C.pr} ${opts.prHtmlUrl}`);
  }

  return truncateTelegramMessage(lines.join("\n"), MAX_MESSAGE_CHARS, loc);
}

export async function sendWorkspaceTelegramMessage(
  env: Env,
  chatId: string,
  text: string,
  fetchImpl?: FetchLike,
): Promise<{ ok: boolean; error?: string }> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "telegram_not_configured" };

  try {
    const client = new TelegramClient({ token, fetch: fetchImpl });
    await client.sendMessage({ chatId: parseInt(chatId, 10), text });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

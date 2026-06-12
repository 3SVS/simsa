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

export function truncateTelegramMessage(text: string, maxLen = MAX_MESSAGE_CHARS): string {
  if (text.length <= maxLen) return text;
  const suffix = "\n\n[메시지가 너무 길어 일부가 생략됐습니다.]";
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
};

const STATUS_KO: Record<string, string> = {
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
  passed: "통과",
};

export function buildPrReviewTelegramMessage(opts: PrReviewTelegramMessageOptions): string {
  const lines: string[] = ["Conclave PR 확인 완료", ""];

  if (opts.projectName) lines.push(`프로젝트: ${opts.projectName}`);
  lines.push(`저장소: ${opts.repoFullName}`);
  lines.push(`PR: #${opts.prNumber}${opts.prTitle ? ` ${opts.prTitle}` : ""}`);
  lines.push("");

  lines.push("결과:");
  lines.push(`- 통과: ${opts.summary.passed}`);
  lines.push(`- 안 맞음: ${opts.summary.failed}`);
  lines.push(`- 확인 부족: ${opts.summary.inconclusive}`);
  lines.push(`- 결정 필요: ${opts.summary.needsDecision}`);

  const problemItems = opts.problematicItems ?? [];
  if (problemItems.length > 0) {
    lines.push("");
    lines.push("아직 봐야 할 항목:");
    for (const item of problemItems.slice(0, 5)) {
      const label = STATUS_KO[item.status] ?? item.status;
      lines.push(`- ${item.title} (${label})`);
    }
    if (problemItems.length > 5) {
      lines.push(`- 외 ${problemItems.length - 5}개`);
    }
  }

  lines.push("");
  lines.push("다음 행동:");
  if (opts.dashboardUrl) {
    lines.push(`- dashboard에서 확인 결과 보기: ${opts.dashboardUrl}`);
  } else {
    lines.push("- dashboard에서 확인 결과 보기");
  }
  if (opts.prHtmlUrl) {
    lines.push(`- PR 보기: ${opts.prHtmlUrl}`);
  } else {
    lines.push("- 필요하면 GitHub PR에 코멘트 남기기");
  }

  return truncateTelegramMessage(lines.join("\n"));
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

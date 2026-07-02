/**
 * workspace/pr-comment.ts
 *
 * Builds the Markdown body for GitHub PR comments generated from a
 * PR code review run. Deterministic — no LLM.
 *
 * GitHub issue comments support GFM; we keep the body readable both
 * as raw text and rendered markdown.
 *
 * Locale-aware: every user-visible literal comes from the LABELS table
 * below ("ko" | "en"). Default is "ko" for full backward compatibility.
 */
import type { FetchLike } from "../github.js";
import type { SpecificRunComparison } from "./pr-review-compare.js";
import { BRAND } from "./brand.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CommentLocale = "en" | "ko";

export type CommentResultItem = {
  itemId: string;
  title: string;
  status: "passed" | "failed" | "inconclusive" | "needs_decision";
  userLabel: string;
  reason: string;
  evidence: string[];
  nextAction: string;
};

export type CommentSummary = {
  failed: number;
  inconclusive: number;
  needsDecision: number;
  passed: number;
};

export type ComparisonDataForComment = {
  previousSummary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  latestSummary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  improved: Array<{ itemId: string; title: string; from: string; to: string; reason: string }>;
  stillOpen: Array<{ itemId: string; title: string; status: string; reason: string }>;
  newlyProblematic: Array<{ itemId: string; title: string; from: string; to: string; reason: string }>;
};

export type BuildCommentOptions = {
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  selectedItems: CommentResultItem[];
  summary: CommentSummary;
  includeFixBrief?: boolean;
  fixBriefSummary?: string;
  includeComparison?: boolean;
  comparisonData?: ComparisonDataForComment;
  /** ISO timestamp of the specific review run this comment is based on. */
  runTimestamp?: string;
  /** Stage 38: include source-vs-new run rerun comparison section */
  includeRerunComparison?: boolean;
  rerunComparisonData?: SpecificRunComparison;
  /** Comment body language. Defaults to "ko" when absent (backward compat). */
  locale?: CommentLocale;
};

export type PostCommentInput = {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  token: string;
};

export type PostCommentResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: string; status: number };

const MAX_COMMENT_CHARS = 60000;
const PREVIEW_CHARS = 300;

// ─── Locale labels ────────────────────────────────────────────────────────────
// One table per locale; markdown structure and emoji are identical across
// locales — only the words change. EN status terms align with the dashboard:
// passed = "Passed", failed = "Issue found", inconclusive = "Not verified",
// needs_decision = "Needs decision".

type StatusKey = "passed" | "failed" | "inconclusive" | "needs_decision";

type CommentLabels = {
  /** BCP-47 locale for run-timestamp formatting. */
  dateLocale: string;
  /** Status label with emoji (item headings). */
  status: Record<StatusKey, string>;
  /** Status label without emoji (comparison lines). */
  statusPlain: Record<StatusKey, string>;
  /** Transition source label when the item only exists in the current run. */
  newItem: string;
  title: string;
  repoLabel: string;
  disclaimer1: string;
  disclaimer2: string;
  runTimestampNote: (formatted: string) => string;
  summaryHeading: string;
  tableHeader: string;
  itemsToFixLabel: string;
  noFixableItems: string;
  reasonLabel: string;
  evidenceLabel: string;
  nextStepLabel: string;
  /** Count formatter — KO appends the counter "개". */
  count: (n: number) => string;
  comparisonHeading: string;
  comparisonIntro: string;
  improvedLabel: string;
  stillOpenLabel: string;
  newlyProblematicLabel: string;
  unchangedLabel: string;
  previousLabel: string;
  latestLabel: string;
  statusInlineLabel: string;
  reasonInlineLabel: string;
  rerunComparisonHeading: string;
  rerunComparisonIntro: string;
  nextActionLabel: string;
  fixBriefHeading: string;
  footerSummary: string;
  footerGeneratedBy: (productName: string, appUrl: string) => string;
  footerNoAutoFix: string;
  truncationNotice: string;
};

const LABELS: Record<CommentLocale, CommentLabels> = {
  ko: {
    dateLocale: "ko-KR",
    status: {
      passed: "✅ 통과",
      failed: "❌ 안 맞음",
      inconclusive: "⚠️ 확인 부족",
      needs_decision: "🟣 결정 필요",
    },
    statusPlain: {
      passed: "통과",
      failed: "안 맞음",
      inconclusive: "확인 부족",
      needs_decision: "결정 필요",
    },
    newItem: "새 항목",
    title: "## 🔍 Simsa Review (PR 확인 결과)",
    repoLabel: "저장소",
    disclaimer1: "> 이 코멘트는 연결된 제품 설명서와 선택된 항목 기준으로 생성되었습니다.  ",
    disclaimer2: "> 전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다.",
    runTimestampNote: (formatted) => `\n_이 코멘트는 ${formatted}에 실행된 PR 확인 기록 기준입니다._\n`,
    summaryHeading: "### 요약",
    tableHeader: "| 결과 | 개수 |",
    itemsToFixLabel: "고쳐야 할 항목",
    noFixableItems: "선택된 항목 중 수정이 필요한 항목이 없습니다.",
    reasonLabel: "**이유:**",
    evidenceLabel: "**확인 근거:**",
    nextStepLabel: "**다음 단계:**",
    count: (n) => `${n}개`,
    comparisonHeading: "## 이전/최신 비교",
    comparisonIntro:
      "이 비교는 같은 PR을 다시 확인한 결과를 이전 결과와 비교한 것입니다. 연결된 PR의 변경 내용 기준이며, 전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다.",
    improvedLabel: "좋아진 항목",
    stillOpenLabel: "아직 남은 항목",
    newlyProblematicLabel: "새로 생긴 문제",
    unchangedLabel: "변화 없음",
    previousLabel: "이전",
    latestLabel: "최신",
    statusInlineLabel: "상태",
    reasonInlineLabel: "이유",
    rerunComparisonHeading: "## 다시 확인 결과 비교",
    rerunComparisonIntro:
      "이 비교는 선택한 이전 확인 기록과 다시 확인한 결과를 비교한 것입니다. 연결된 PR의 변경 내용 기준이며, 전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다.",
    nextActionLabel: "다음 조치",
    fixBriefHeading: "### 수정 제안 요약",
    footerSummary: "이 코멘트에 대하여",
    // Stage 92: link to the live Simsa app domain (app.trysimsa.com, wired in
    // Stage 90B). Sourced from BRAND.appUrl so the brand + URL move in lockstep.
    footerGeneratedBy: (productName, appUrl) =>
      `이 코멘트는 [${productName}](${appUrl})에서 PR 코드 확인 결과를 바탕으로 자동 생성했습니다.  `,
    footerNoAutoFix: "이 단계에서는 코드를 자동으로 고치지 않습니다.",
    truncationNotice: "\n\n> ⚠️ 코멘트가 너무 길어 일부 내용이 잘렸습니다.",
  },
  en: {
    dateLocale: "en-US",
    status: {
      passed: "✅ Passed",
      failed: "❌ Issue found",
      inconclusive: "⚠️ Not verified",
      needs_decision: "🟣 Needs decision",
    },
    statusPlain: {
      passed: "Passed",
      failed: "Issue found",
      inconclusive: "Not verified",
      needs_decision: "Needs decision",
    },
    newItem: "New item",
    title: "## 🔍 Simsa Review (PR review results)",
    repoLabel: "Repository",
    disclaimer1: "> This comment was generated from the linked product spec and the selected items.  ",
    disclaimer2: "> It does not cover the entire repository or the deployed service as a whole.",
    runTimestampNote: (formatted) => `\n_This comment is based on the PR review run executed at ${formatted}._\n`,
    summaryHeading: "### Summary",
    tableHeader: "| Result | Count |",
    itemsToFixLabel: "Items to fix",
    noFixableItems: "None of the selected items need fixes.",
    reasonLabel: "**Reason:**",
    evidenceLabel: "**Evidence:**",
    nextStepLabel: "**Next step:**",
    count: (n) => `${n}`,
    comparisonHeading: "## Previous vs latest comparison",
    comparisonIntro:
      "This comparison checks the latest re-review of the same PR against the previous result. It is based on the linked code changes (PR) — it does not cover the entire repository or the deployed service as a whole.",
    improvedLabel: "Improved items",
    stillOpenLabel: "Still open items",
    newlyProblematicLabel: "New problems",
    unchangedLabel: "Unchanged",
    previousLabel: "Previous",
    latestLabel: "Latest",
    statusInlineLabel: "Status",
    reasonInlineLabel: "Reason",
    rerunComparisonHeading: "## Re-review comparison",
    rerunComparisonIntro:
      "This comparison checks the re-review result against the selected previous review run. It is based on the linked code changes (PR) — it does not cover the entire repository or the deployed service as a whole.",
    nextActionLabel: "Next action",
    fixBriefHeading: "### Suggested fix summary",
    footerSummary: "About this comment",
    footerGeneratedBy: (productName, appUrl) =>
      `This comment was generated automatically by [${productName}](${appUrl}) based on PR code review results.  `,
    footerNoAutoFix: "This step does not change your code automatically.",
    truncationNotice: "\n\n> ⚠️ This comment was too long, so some content was truncated.",
  },
};

function labelsFor(locale: CommentLocale | undefined): CommentLabels {
  return LABELS[locale ?? "ko"];
}

// Stage 49: "이전 상태 → 현재 상태" label for the rerun comparison section.
// A missing source status (current-only item) reads "새 항목" / "New item".
function plainStatusOr(L: CommentLabels, status: string | undefined, fallback: string): string {
  if (!status) return fallback;
  return L.statusPlain[status as StatusKey] ?? status;
}

function transitionLabel(L: CommentLabels, from: string | undefined, to: string | undefined): string {
  return `${plainStatusOr(L, from, L.newItem)} → ${plainStatusOr(L, to, "")}`;
}

// Keep nextAction lines short so the PR thread stays readable.
function truncateAction(action: string, max = 140): string {
  const trimmed = action.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildRequiredPart(opts: BuildCommentOptions, L: CommentLabels): string {
  const { repoFullName, prNumber, prTitle, selectedItems, summary, runTimestamp } = opts;

  const fixable = selectedItems.filter(
    (i) => i.status === "failed" || i.status === "inconclusive" || i.status === "needs_decision",
  );

  // Format run timestamp to a human-readable string in the comment locale
  let runTimestampLine = "";
  if (runTimestamp) {
    try {
      const d = new Date(runTimestamp);
      const formatted = d.toLocaleString(L.dateLocale, {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
      });
      runTimestampLine = L.runTimestampNote(formatted);
    } catch { /* ignored */ }
  }

  const lines: string[] = [
    L.title,
    "",
    `**${L.repoLabel}:** \`${repoFullName}\`  `,
    `**PR:** #${prNumber} ${prTitle}`,
    "",
    L.disclaimer1,
    L.disclaimer2,
    ...(runTimestampLine ? [runTimestampLine] : []),
    "",
    L.summaryHeading,
    "",
    L.tableHeader,
    `|------|------|`,
    `| ${L.status.failed} | ${summary.failed} |`,
    `| ${L.status.inconclusive} | ${summary.inconclusive} |`,
    `| ${L.status.needs_decision} | ${summary.needsDecision} |`,
    `| ${L.status.passed} | ${summary.passed} |`,
    "",
  ];

  if (fixable.length === 0) {
    lines.push(`### ${L.itemsToFixLabel}`, "", L.noFixableItems, "");
  } else {
    lines.push(`### ${L.itemsToFixLabel} (${L.count(fixable.length)})`, "");
    for (const item of fixable) {
      lines.push(`#### ${L.status[item.status] ?? item.status} — ${item.title}`, "");
      lines.push(`${L.reasonLabel} ${item.reason}`, "");
      if (item.evidence.length > 0) {
        lines.push(L.evidenceLabel);
        for (const e of item.evidence) lines.push(`- \`${e}\``);
        lines.push("");
      }
      if (item.nextAction) {
        lines.push(`${L.nextStepLabel} ${item.nextAction}`, "");
      }
      lines.push("---", "");
    }
  }

  return lines.join("\n");
}

function buildCompSummaryPart(data: ComparisonDataForComment, L: CommentLabels): string {
  const { previousSummary: prev, latestSummary: latest } = data;

  const fmt = (from: number, to: number) =>
    from === to ? L.count(to) : `${L.count(from)} → ${L.count(to)}`;

  const lines: string[] = [
    "",
    L.comparisonHeading,
    "",
    L.comparisonIntro,
    "",
    L.summaryHeading,
    "",
    `- ${L.statusPlain.failed}: ${fmt(prev.failed, latest.failed)}`,
    `- ${L.statusPlain.inconclusive}: ${fmt(prev.inconclusive, latest.inconclusive)}`,
    `- ${L.statusPlain.needs_decision}: ${fmt(prev.needsDecision, latest.needsDecision)}`,
    `- ${L.statusPlain.passed}: ${fmt(prev.passed, latest.passed)}`,
    "",
  ];

  return lines.join("\n");
}

function buildCompDetailPart(data: ComparisonDataForComment, L: CommentLabels): string {
  const { improved, stillOpen, newlyProblematic } = data;
  if (improved.length === 0 && stillOpen.length === 0 && newlyProblematic.length === 0) return "";

  const lines: string[] = [];

  if (improved.length > 0) {
    lines.push(`### ${L.improvedLabel} (${L.count(improved.length)})`, "");
    for (const item of improved) {
      lines.push(`- ${item.title}`);
      lines.push(`  - ${L.previousLabel}: ${plainStatusOr(L, item.from, item.from)}`);
      lines.push(`  - ${L.latestLabel}: ${plainStatusOr(L, item.to, item.to)}`);
      lines.push(`  - ${L.reasonInlineLabel}: ${item.reason}`);
      lines.push("");
    }
  }

  if (stillOpen.length > 0) {
    lines.push(`### ${L.stillOpenLabel} (${L.count(stillOpen.length)})`, "");
    for (const item of stillOpen) {
      lines.push(`- ${item.title}`);
      lines.push(`  - ${L.statusInlineLabel}: ${plainStatusOr(L, item.status, item.status)}`);
      lines.push(`  - ${L.reasonInlineLabel}: ${item.reason}`);
      lines.push("");
    }
  }

  if (newlyProblematic.length > 0) {
    lines.push(`### ${L.newlyProblematicLabel} (${L.count(newlyProblematic.length)})`, "");
    for (const item of newlyProblematic) {
      lines.push(`- ${item.title}`);
      lines.push(`  - ${L.previousLabel}: ${plainStatusOr(L, item.from, item.from)}`);
      lines.push(`  - ${L.latestLabel}: ${plainStatusOr(L, item.to, item.to)}`);
      lines.push(`  - ${L.reasonInlineLabel}: ${item.reason}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function buildRerunComparisonPart(data: SpecificRunComparison, L: CommentLabels): string {
  if (!data.comparable) return "";

  const lines: string[] = [
    "",
    L.rerunComparisonHeading,
    "",
    L.rerunComparisonIntro,
    "",
    L.summaryHeading,
    "",
    `- ${L.improvedLabel}: ${L.count(data.improved.length)}`,
    `- ${L.stillOpenLabel}: ${L.count(data.stillOpen.length)}`,
    `- ${L.newlyProblematicLabel}: ${L.count(data.newlyProblematic.length)}`,
    `- ${L.unchangedLabel}: ${L.count(data.unchanged.length)}`,
    "",
  ];

  if (data.improved.length > 0) {
    lines.push(`### ${L.improvedLabel} (${L.count(data.improved.length)})`, "");
    for (const item of data.improved) {
      lines.push(`- ${item.title}: ${transitionLabel(L, item.from, item.to)}`);
    }
    lines.push("");
  }

  if (data.stillOpen.length > 0) {
    lines.push(`### ${L.stillOpenLabel} (${L.count(data.stillOpen.length)})`, "");
    for (const item of data.stillOpen) {
      lines.push(`- ${item.title}: ${transitionLabel(L, item.from, item.status)}`);
      if (item.nextAction) lines.push(`  - ${L.nextActionLabel}: ${truncateAction(item.nextAction)}`);
    }
    lines.push("");
  }

  if (data.newlyProblematic.length > 0) {
    lines.push(`### ${L.newlyProblematicLabel} (${L.count(data.newlyProblematic.length)})`, "");
    for (const item of data.newlyProblematic) {
      lines.push(`- ${item.title}: ${transitionLabel(L, item.from, item.to)}`);
      if (item.nextAction) lines.push(`  - ${L.nextActionLabel}: ${truncateAction(item.nextAction)}`);
    }
    lines.push("");
  }

  if (data.unchanged.length > 0) {
    lines.push(`### ${L.unchangedLabel} (${L.count(data.unchanged.length)})`, "");
    for (const item of data.unchanged) {
      lines.push(`- ${item.title}: ${transitionLabel(L, item.from, item.status)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildFixBriefPart(summary: string, L: CommentLabels): string {
  return ["", L.fixBriefHeading, "", summary, ""].join("\n");
}

function buildFooterPart(L: CommentLabels): string {
  return [
    "<details>",
    `<summary>${L.footerSummary}</summary>`,
    "",
    L.footerGeneratedBy(BRAND.productName, BRAND.appUrl),
    L.footerNoAutoFix,
    "",
    "</details>",
  ].join("\n");
}

// ─── Comment body builder ─────────────────────────────────────────────────────

export function buildCommentBody(opts: BuildCommentOptions): {
  body: string;
  truncated: boolean;
  comparisonIncluded: boolean;
  rerunComparisonIncluded: boolean;
} {
  const L = labelsFor(opts.locale);
  const TRUNCATION = L.truncationNotice;

  const required = buildRequiredPart(opts, L);
  const footer = buildFooterPart(L);
  const fixBrief =
    opts.includeFixBrief === true && opts.fixBriefSummary
      ? buildFixBriefPart(opts.fixBriefSummary, L)
      : "";

  // Rerun comparison takes priority over latest-two comparison when both requested.
  const hasRerunComparison = opts.includeRerunComparison === true && opts.rerunComparisonData?.comparable === true;
  const rerunComp = hasRerunComparison ? buildRerunComparisonPart(opts.rerunComparisonData!, L) : "";

  // Latest-two comparison only when rerun comparison is NOT included.
  const hasComparison = !hasRerunComparison && opts.includeComparison === true && opts.comparisonData !== undefined;
  const compSummary = hasComparison ? buildCompSummaryPart(opts.comparisonData!, L) : "";
  const compDetail = hasComparison ? buildCompDetailPart(opts.comparisonData!, L) : "";

  const fits = (...parts: string[]) => parts.join("").length <= MAX_COMMENT_CHARS;

  // Priority: required > rerunComp > compSummary > compDetail > fixBrief > footer
  if (fits(required, rerunComp, compSummary, compDetail, fixBrief, footer)) {
    return {
      body: required + rerunComp + compSummary + compDetail + fixBrief + footer,
      truncated: false, comparisonIncluded: hasComparison, rerunComparisonIncluded: hasRerunComparison,
    };
  }
  if (fits(required, rerunComp, compSummary, compDetail, footer)) {
    return { body: required + rerunComp + compSummary + compDetail + footer, truncated: false, comparisonIncluded: hasComparison, rerunComparisonIncluded: hasRerunComparison };
  }
  if (fits(required, rerunComp, compSummary, footer)) {
    return { body: required + rerunComp + compSummary + footer, truncated: false, comparisonIncluded: hasComparison, rerunComparisonIncluded: hasRerunComparison };
  }
  if (fits(required, rerunComp, footer)) {
    return { body: required + rerunComp + footer, truncated: false, comparisonIncluded: false, rerunComparisonIncluded: hasRerunComparison };
  }
  if (fits(required, footer)) {
    return { body: required + footer, truncated: false, comparisonIncluded: false, rerunComparisonIncluded: false };
  }

  // Even the base is too long — truncate
  const base = required + footer;
  const cutAt = MAX_COMMENT_CHARS - TRUNCATION.length;
  return { body: base.slice(0, cutAt) + TRUNCATION, truncated: true, comparisonIncluded: false, rerunComparisonIncluded: false };
}

// ─── Preview helper ───────────────────────────────────────────────────────────

export function bodyPreview(body: string): string {
  if (body.length <= PREVIEW_CHARS) return body;
  return body.slice(0, PREVIEW_CHARS) + "…";
}

// ─── GitHub Issues Comments API ───────────────────────────────────────────────

export async function postGitHubComment(
  input: PostCommentInput,
  fetchImpl: FetchLike,
): Promise<PostCommentResult> {
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`;
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "conclave-ai/1.0",
      },
      body: JSON.stringify({ body: input.body }),
    });
  } catch (err) {
    return { ok: false, error: `network_error: ${(err as Error).message}`, status: 0 };
  }

  if (!resp.ok) {
    // 403 = scope/auth issue, 404 = repo not found or private
    const errBody = await resp.json().catch(() => ({})) as Record<string, unknown>;
    const msg = typeof errBody["message"] === "string" ? errBody["message"] : `HTTP ${resp.status}`;
    return { ok: false, error: msg, status: resp.status };
  }

  const data = await resp.json().catch(() => ({})) as { id?: number; html_url?: string };
  return {
    ok: true,
    id: String(data.id ?? ""),
    url: data.html_url ?? `https://github.com/${input.owner}/${input.repo}/issues/${input.issueNumber}#issuecomment-${data.id ?? ""}`,
  };
}

// ─── GitHub Issues Comments Update API ───────────────────────────────────────

export type UpdateCommentInput = {
  owner: string;
  repo: string;
  githubCommentId: string;
  body: string;
  token: string;
};

export async function updateGitHubComment(
  input: UpdateCommentInput,
  fetchImpl: FetchLike,
): Promise<PostCommentResult> {
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/issues/comments/${input.githubCommentId}`;
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "conclave-ai/1.0",
      },
      body: JSON.stringify({ body: input.body }),
    });
  } catch (err) {
    return { ok: false, error: `network_error: ${(err as Error).message}`, status: 0 };
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({})) as Record<string, unknown>;
    const msg = typeof errBody["message"] === "string" ? errBody["message"] : `HTTP ${resp.status}`;
    return { ok: false, error: msg, status: resp.status };
  }

  const data = await resp.json().catch(() => ({})) as { id?: number; html_url?: string };
  return {
    ok: true,
    id: String(data.id ?? input.githubCommentId),
    url: data.html_url ?? `https://github.com/${input.owner}/${input.repo}/issues/comments/${input.githubCommentId}`,
  };
}

// ─── Scope check ─────────────────────────────────────────────────────────────

export function hasPrCommentScope(scopes: string | undefined): boolean {
  if (!scopes) return false;
  const parts = scopes.split(/[\s,]+/);
  return parts.includes("public_repo") || parts.includes("repo");
}

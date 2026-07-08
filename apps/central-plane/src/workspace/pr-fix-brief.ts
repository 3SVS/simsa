/**
 * workspace/pr-fix-brief.ts
 *
 * Deterministic generator for the "PR Fix Pack" —
 * a set of Markdown files that guide Claude Code or Codex to fix problems
 * found in a PR code review.
 *
 * Completely separate from the Builder Pack (export.ts):
 *   Builder Pack = first-time build guide
 *   PR Fix Pack  = targeted fix guide for an already-existing PR
 *
 * No LLM — built entirely from structured review results.
 */
import type { CheckResultItem, CheckableItem } from "./check.js";
import type { PullRequestMeta } from "./github-pr.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FixBriefTarget = "claude_code" | "codex" | "both";

export type FixBriefItem = CheckableItem & {
  criteria?: string[];
};

export type FixBriefProductSpec = {
  productName: string;
  oneLine?: string;
  included?: string[];
  excluded?: string[];
  openQuestions?: string[];
};

export type FixBriefRequest = {
  projectId: string;
  productSpec: FixBriefProductSpec;
  allItems: FixBriefItem[];
  selectedItemIds: string[];
  reviewResults: CheckResultItem[];
  prMeta: PullRequestMeta;
  repoFullName: string;
  runId: string;
  target: FixBriefTarget;
};

export type FixBriefFile = {
  path: string;
  content: string;
};

export type FixBriefResponse = {
  ok: true;
  source: "deterministic";
  projectId: string;
  repoFullName: string;
  prNumber: number;
  runId: string;
  selectedItemIds: string[];
  brief: {
    plainSummary: string;
    claudeCodePrompt?: string;
    codexPrompt?: string;
    files: FixBriefFile[];
  };
  warnings?: string[];
};

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_KO: Record<string, string> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
};

function fixableStatuses(): string[] {
  return ["failed", "inconclusive", "needs_decision"];
}

// ─── File generators ──────────────────────────────────────────────────────────

function genReadme(
  projectName: string,
  prMeta: PullRequestMeta,
  repoFullName: string,
  target: FixBriefTarget,
  itemCount: number,
): string {
  const lines = [
    `# PR 수정 지시서 — ${projectName}`,
    "",
    `**저장소:** ${repoFullName}`,
    `**PR:** #${prMeta.number} ${prMeta.title}`,
    `**브랜치:** ${prMeta.headBranch} → ${prMeta.baseBranch}`,
    "",
    `이 패키지는 위 PR의 코드 확인 결과를 바탕으로 만든 수정 지시서입니다.`,
    `총 **${itemCount}개** 항목에 대한 수정이 필요합니다.`,
    "",
    "## 이 단계에서 하는 것",
    "",
    "- 코드 확인 결과에서 문제가 있는 항목을 개발 AI에게 알려줍니다.",
    "- 각 항목에 대해 무엇이 문제인지, 어떻게 고쳐야 하는지 안내합니다.",
    "",
    "## 이 단계에서 하지 않는 것",
    "",
    "- Simsa가 코드를 자동으로 고치지 않습니다.",
    "- PR을 자동으로 닫거나 수정하지 않습니다.",
    "- PR 외 다른 파일을 고치라고 하지 않습니다.",
    "",
    "## 개발 AI에 넘기는 방법",
    "",
  ];

  if (target !== "codex") {
    lines.push(
      "### Claude Code 사용 시",
      "`CLAUDE_CODE_FIX_PROMPT.md` 파일 내용을 Claude Code 대화창에 붙여넣으세요.",
      "",
    );
  }
  if (target !== "claude_code") {
    lines.push(
      "### Codex 사용 시",
      "`CODEX_FIX_PROMPT.md` 파일 내용을 Codex 대화창에 붙여넣으세요.",
      "",
    );
  }

  lines.push(
    "## 파일 읽는 순서",
    "",
    "1. `product.md` — 제품 설명서",
    "2. `items.md` — 수정할 항목 목록",
    "3. `pr-review-results.md` — PR 코드 확인 결과",
    "4. `fix-brief.md` — 고쳐야 할 항목 요약",
  );

  return lines.join("\n");
}

function genProductMd(spec: FixBriefProductSpec): string {
  const lines = [
    `# 제품 설명서 — ${spec.productName}`,
    "",
  ];
  if (spec.oneLine) lines.push(spec.oneLine, "");
  if (spec.included?.length) {
    lines.push("## 이번 버전에 포함", "", ...spec.included.map((i) => `- ${i}`), "");
  }
  if (spec.excluded?.length) {
    lines.push("## 이번 버전에 제외", "", ...spec.excluded.map((e) => `- ${e}`), "");
  }
  if (spec.openQuestions?.length) {
    lines.push("## 아직 결정 안 된 사항", "", ...spec.openQuestions.map((q) => `- ${q}`), "");
  }
  return lines.join("\n").trimEnd();
}

function genItemsMd(items: FixBriefItem[]): string {
  if (items.length === 0) return "# 수정할 항목\n\n(선택된 항목 없음)";
  const lines = [
    "# 수정할 항목",
    "",
    `총 ${items.length}개 항목`,
    "",
  ];
  items.forEach((item, i) => {
    lines.push(`## ${i + 1}. ${item.title}`, "");
    lines.push(`**확인 결과:** ${STATUS_KO[item.status] ?? item.status}`, "");
    if (item.criteria?.length) {
      lines.push("**완성 기준:**", ...item.criteria.map((c) => `- ${c}`), "");
    }
  });
  return lines.join("\n").trimEnd();
}

function genPrReviewResultsMd(
  results: CheckResultItem[],
  prMeta: PullRequestMeta,
  repoFullName: string,
): string {
  const lines = [
    `# PR 코드 확인 결과`,
    "",
    `> **중요:** 이 결과는 연결된 GitHub PR의 변경 내용 기준입니다. 전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다.`,
    "",
    `**저장소:** ${repoFullName}`,
    `**PR:** #${prMeta.number} ${prMeta.title}`,
    `**브랜치:** ${prMeta.headBranch} → ${prMeta.baseBranch}`,
    "",
    "## 항목별 결과",
    "",
  ];

  for (const r of results) {
    lines.push(`### ${r.title}`, "");
    lines.push(`- **결과:** ${STATUS_KO[r.status] ?? r.status}`);
    lines.push(`- **이유:** ${r.reason}`);
    if (r.evidence.length > 0) {
      lines.push(`- **근거:**`);
      r.evidence.forEach((e) => lines.push(`  - ${e}`));
    }
    if (r.nextAction) {
      lines.push(`- **다음 단계:** ${r.nextAction}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function genFixBriefMd(
  items: FixBriefItem[],
  results: CheckResultItem[],
): string {
  const resultMap = new Map(results.map((r) => [r.itemId, r]));

  const failed = items.filter((i) => resultMap.get(i.id)?.status === "failed");
  const inconclusive = items.filter((i) => resultMap.get(i.id)?.status === "inconclusive");
  const needsDecision = items.filter((i) => resultMap.get(i.id)?.status === "needs_decision");

  const lines = [
    "# 고쳐야 할 항목 요약",
    "",
    "이 파일은 개발 AI에게 넘길 수정 작업의 핵심 내용입니다.",
    "",
  ];

  if (failed.length > 0) {
    lines.push("## 안 맞음 — 반드시 수정 필요", "");
    for (const item of failed) {
      const r = resultMap.get(item.id);
      lines.push(`### ${item.title}`, "");
      if (r) {
        lines.push(`**문제:** ${r.reason}`, "");
        if (r.evidence.length > 0) {
          lines.push("**관련 파일:**", ...r.evidence.map((e) => `- ${e}`), "");
        }
        lines.push(`**수정 방향:** ${r.nextAction}`, "");
      }
      if (item.criteria?.length) {
        lines.push("**완료 기준:**", ...item.criteria.map((c) => `- [ ] ${c}`), "");
      }
    }
  }

  if (inconclusive.length > 0) {
    lines.push("## 확인 부족 — 구현 여부 확인 후 필요시 보완", "");
    for (const item of inconclusive) {
      const r = resultMap.get(item.id);
      lines.push(`### ${item.title}`, "");
      if (r) {
        lines.push(`**상황:** ${r.reason}`, "");
        lines.push(`**확인/보완 방향:** ${r.nextAction}`, "");
      }
      if (item.criteria?.length) {
        lines.push("**완료 기준:**", ...item.criteria.map((c) => `- [ ] ${c}`), "");
      }
    }
  }

  if (needsDecision.length > 0) {
    lines.push("## 결정 필요 — 코딩 전에 사용자에게 질문", "");
    for (const item of needsDecision) {
      const r = resultMap.get(item.id);
      lines.push(`### ${item.title}`, "");
      if (r) {
        lines.push(`**왜 결정이 필요한가:** ${r.reason}`, "");
        lines.push(`**질문 방향:** ${r.nextAction}`, "");
      }
    }
  }

  return lines.join("\n").trimEnd();
}

function genClaudeCodePrompt(
  projectName: string,
  prMeta: PullRequestMeta,
  repoFullName: string,
  items: FixBriefItem[],
  results: CheckResultItem[],
): string {
  const resultMap = new Map(results.map((r) => [r.itemId, r]));
  const failed = items.filter((i) => resultMap.get(i.id)?.status === "failed");
  const inconclusive = items.filter((i) => resultMap.get(i.id)?.status === "inconclusive");
  const needsDecision = items.filter((i) => resultMap.get(i.id)?.status === "needs_decision");

  const lines = [
    `# Claude Code용 수정 지시서 — ${projectName}`,
    "",
    "## 먼저 읽을 것",
    "",
    "- `product.md` — 제품 설명서",
    "- `pr-review-results.md` — PR 코드 확인 결과",
    "- `fix-brief.md` — 고쳐야 할 항목 요약",
    "",
    "## 목표",
    "",
    `PR #${prMeta.number} (${prMeta.title}) 에서 확인된 문제 항목만 수정한다.`,
    `저장소: ${repoFullName}`,
    `브랜치: ${prMeta.headBranch}`,
    "",
    "## 중요한 제약",
    "",
    "- **포함된 항목만** 수정한다.",
    "- 전체 제품을 새로 만들지 않는다.",
    "- 관련 없는 리팩터링을 하지 않는다.",
    "- PR 밖의 큰 구조 변경을 하지 않는다.",
    "- 애매하면 코딩 전에 질문한다.",
    "",
    "## 작업",
    "",
  ];

  if (failed.length > 0) {
    lines.push("### 안 맞음 → 수정 필요", "");
    for (const item of failed) {
      const r = resultMap.get(item.id);
      lines.push(`**${item.title}**`);
      if (r) lines.push(`- 문제: ${r.reason}`);
      if (r?.evidence?.length) lines.push(`- 관련 파일: ${r.evidence.join(", ")}`);
      if (r?.nextAction) lines.push(`- 수정 방향: ${r.nextAction}`);
      if (item.criteria?.length) {
        lines.push(`- 완료 기준: ${item.criteria.join(" / ")}`);
      }
      lines.push("");
    }
  }

  if (inconclusive.length > 0) {
    lines.push("### 확인 부족 → 확인 후 필요시 보완", "");
    for (const item of inconclusive) {
      const r = resultMap.get(item.id);
      lines.push(`**${item.title}**`);
      if (r) lines.push(`- 상황: ${r.reason}`);
      if (r?.nextAction) lines.push(`- 방향: ${r.nextAction}`);
      lines.push("");
    }
  }

  if (needsDecision.length > 0) {
    lines.push("### 결정 필요 → 코딩 전에 사용자에게 질문", "");
    for (const item of needsDecision) {
      const r = resultMap.get(item.id);
      lines.push(`**${item.title}**`);
      if (r) lines.push(`- ${r.reason}`);
      lines.push("");
    }
  }

  lines.push(
    "## 완료 기준",
    "",
    "- 각 항목의 완성 기준을 만족한다.",
    "- 기존 테스트를 깨지 않는다.",
    "",
    "## 완료 보고",
    "",
    "작업 완료 후 다음을 보고하세요.",
    "",
    "1. 수정한 파일 목록",
    "2. 실행한 테스트 결과",
    "3. 남은 위험 또는 질문",
  );

  return lines.join("\n").trimEnd();
}

function genCodexPrompt(
  projectName: string,
  prMeta: PullRequestMeta,
  repoFullName: string,
  items: FixBriefItem[],
  results: CheckResultItem[],
): string {
  const resultMap = new Map(results.map((r) => [r.itemId, r]));
  const failed = items.filter((i) => resultMap.get(i.id)?.status === "failed");
  const inconclusive = items.filter((i) => resultMap.get(i.id)?.status === "inconclusive");
  const needsDecision = items.filter((i) => resultMap.get(i.id)?.status === "needs_decision");

  const tasksLines: string[] = [];
  for (const item of failed) {
    const r = resultMap.get(item.id);
    const line = r ? `Fix "${item.title}": ${r.reason}` : `Fix "${item.title}"`;
    tasksLines.push(`- [ ] ${line}`);
  }
  for (const item of inconclusive) {
    const r = resultMap.get(item.id);
    const line = r ? `Verify "${item.title}": ${r.reason}` : `Verify "${item.title}"`;
    tasksLines.push(`- [ ] ${line}`);
  }
  for (const item of needsDecision) {
    tasksLines.push(`- [ ] Ask user before coding: "${item.title}"`);
  }

  const doneWhen = items
    .filter((i) => i.criteria?.length)
    .flatMap((i) => i.criteria!.map((c) => `- ${i.title}: ${c}`));

  const lines = [
    `# Codex Fix Prompt — ${projectName}`,
    "",
    "## Goal",
    "",
    `Fix issues found in PR #${prMeta.number} (${prMeta.title}).`,
    `Repository: ${repoFullName} | Branch: ${prMeta.headBranch}`,
    "",
    "## Context",
    "",
    "- Read product.md for product scope and constraints.",
    "- Read pr-review-results.md for the full PR review findings.",
    "- Read fix-brief.md for fix priorities.",
    "",
    "## PR Review Findings",
    "",
    failed.length > 0 ? `Failed items (must fix): ${failed.map((i) => i.title).join(", ")}` : "",
    inconclusive.length > 0 ? `Inconclusive items (verify): ${inconclusive.map((i) => i.title).join(", ")}` : "",
    needsDecision.length > 0 ? `Needs decision (ask user first): ${needsDecision.map((i) => i.title).join(", ")}` : "",
    "",
    "## Selected Fix Tasks",
    "",
    ...tasksLines,
    "",
    "## Constraints",
    "",
    "- Only fix items listed above.",
    "- Do not refactor unrelated code.",
    "- Do not create new branches or commits.",
    "- Do not close or modify the PR itself.",
    "- Ask before coding if intent is unclear.",
    "",
    "## Done When",
    "",
    doneWhen.length > 0 ? doneWhen.join("\n") : "All listed tasks are completed.",
    "",
    "## Do Not Do",
    "",
    "- Implement features not in the failed/inconclusive list",
    "- Rename, refactor, or restructure outside the fix scope",
    "- Touch files unrelated to the listed items",
    "",
    "## Verify By",
    "",
    "- Run existing tests — none should break",
    "- Confirm each fixed item meets its completion criteria",
    "",
    "## Final Response Format",
    "",
    "1. Files changed",
    "2. Tests run and results",
    "3. Remaining risks or questions",
  ].filter((l) => l !== null);

  return lines.join("\n").trimEnd();
}

function buildPlainSummary(
  items: FixBriefItem[],
  results: CheckResultItem[],
): string {
  const resultMap = new Map(results.map((r) => [r.itemId, r]));
  const failed = items.filter((i) => resultMap.get(i.id)?.status === "failed");
  const inconclusive = items.filter((i) => resultMap.get(i.id)?.status === "inconclusive");
  const needsDecision = items.filter((i) => resultMap.get(i.id)?.status === "needs_decision");

  const parts: string[] = [];
  if (failed.length > 0) parts.push(`안 맞음 ${failed.length}개 수정 필요`);
  if (inconclusive.length > 0) parts.push(`확인 부족 ${inconclusive.length}개 확인 필요`);
  if (needsDecision.length > 0) parts.push(`결정 필요 ${needsDecision.length}개 질문 필요`);
  return parts.join(", ") || "수정할 항목 없음";
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export function generatePRFixBrief(req: FixBriefRequest): FixBriefResponse {
  const warnings: string[] = [];

  // Filter to fixable results within selectedItemIds
  const fixableResults = req.reviewResults.filter(
    (r) => req.selectedItemIds.includes(r.itemId) && fixableStatuses().includes(r.status),
  );

  if (fixableResults.length === 0) {
    warnings.push("선택된 항목 중 수정이 필요한 항목이 없습니다. passed 항목은 수정 지시서에 포함되지 않습니다.");
  }

  // Items to include (only the fixable ones)
  const selectedItems: FixBriefItem[] = req.allItems
    .filter((i) => req.selectedItemIds.includes(i.id))
    .map((i) => {
      const r = req.reviewResults.find((r) => r.itemId === i.id);
      return { ...i, status: r?.status ?? i.status };
    })
    .filter((i) => fixableStatuses().includes(i.status));

  const root = "simsa-pr-fix-pack";
  const files: FixBriefFile[] = [];

  files.push({ path: `${root}/README.md`, content: genReadme(req.productSpec.productName, req.prMeta, req.repoFullName, req.target, selectedItems.length) });
  files.push({ path: `${root}/product.md`, content: genProductMd(req.productSpec) });
  files.push({ path: `${root}/items.md`, content: genItemsMd(selectedItems) });
  files.push({ path: `${root}/pr-review-results.md`, content: genPrReviewResultsMd(fixableResults, req.prMeta, req.repoFullName) });
  files.push({ path: `${root}/fix-brief.md`, content: genFixBriefMd(selectedItems, fixableResults) });

  let claudeCodePrompt: string | undefined;
  let codexPrompt: string | undefined;

  if (req.target !== "codex") {
    claudeCodePrompt = genClaudeCodePrompt(req.productSpec.productName, req.prMeta, req.repoFullName, selectedItems, fixableResults);
    files.push({ path: `${root}/CLAUDE_CODE_FIX_PROMPT.md`, content: claudeCodePrompt });
  }
  if (req.target !== "claude_code") {
    codexPrompt = genCodexPrompt(req.productSpec.productName, req.prMeta, req.repoFullName, selectedItems, fixableResults);
    files.push({ path: `${root}/CODEX_FIX_PROMPT.md`, content: codexPrompt });
  }

  const plainSummary = buildPlainSummary(selectedItems, fixableResults);

  return {
    ok: true,
    source: "deterministic",
    projectId: req.projectId,
    repoFullName: req.repoFullName,
    prNumber: req.prMeta.number,
    runId: req.runId,
    selectedItemIds: req.selectedItemIds,
    brief: {
      plainSummary,
      claudeCodePrompt,
      codexPrompt,
      files,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}

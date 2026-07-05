/**
 * workspace/export.ts
 *
 * Deterministic "만들기 패키지" (builder pack) generation.
 * No LLM calls — pure string assembly from structured project data.
 * Produces Markdown files ready for Claude Code or Codex.
 *
 * Stage 7: supports selectedItemIds filtering + stronger task-focus prompts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExportTarget = "claude_code" | "codex" | "both";
export type ExportFormat = "json" | "markdown_bundle";

export type ExportProductSpec = {
  productName: string;
  oneLine: string;
  targetUsers: string[];
  problem: string;
  included: string[];
  excluded: string[];
  userFlow: string[];
  decisions: string[];
  openQuestions: string[];
};

export type ExportItem = {
  id: string;
  title: string;
  status: string;
  criteria: string[];
};

export type ExportCheckResult = {
  itemId: string;
  status: string;
  title: string;
  reason: string;
  evidence: string[];
  nextAction: string;
};

export type ExportCheckResults = {
  results: ExportCheckResult[];
  summary: {
    passed: number;
    failed: number;
    inconclusive: number;
    needsDecision: number;
  };
};

export type ExportFixSuggestion = {
  itemId: string;
  suggestion: {
    plainSummary: string;
    builderBrief: {
      title: string;
      goal: string;
      tasks: string[];
      doneWhen: string[];
      doNotDo: string[];
      verifyBy: string[];
    };
  };
};

export type WorkspaceExportBuilderPackRequest = {
  projectId?: string;
  /** D1-b regression loop: resolved app base URL (e.g. https://app.trysimsa.com).
   *  Passed in by the route so the pure generator stays env-free. When present
   *  together with projectId, the pack embeds a `/p/{projectId}/connect`
   *  re-entry instruction; when either is absent, the block is omitted cleanly. */
  appBaseUrl?: string;
  project?: {
    title: string;
    idea?: string;
    productSpec: ExportProductSpec;
    items: ExportItem[];
    checkResults?: ExportCheckResults;
    fixSuggestions?: Record<string, ExportFixSuggestion>;
  };
  /** When provided, only these item IDs are included in items.md, checks.md, fixes.md, and prompts.
   *  product.md always contains the full product context.
   *  If empty or omitted, all items are included. */
  selectedItemIds?: string[];
  target: ExportTarget;
  format: ExportFormat;
  locale?: "ko" | "en";
};

export type ExportFile = {
  path: string;
  content: string;
};

export type WorkspaceExportBuilderPackResponse = {
  ok: true;
  source: "deterministic";
  bundle: {
    files: ExportFile[];
  };
  summary: {
    fileCount: number;
    totalItems: number;
    selectedItems: number;
    recommendedNextStep: string;
  };
};

// ─── Status label mapping ─────────────────────────────────────────────────────

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    passed: "통과",
    failed: "안 맞음",
    inconclusive: "확인 부족",
    needs_decision: "결정 필요",
    not_started: "시작 전",
  };
  return map[status] ?? status;
}

// ─── File generators ──────────────────────────────────────────────────────────

function genReadme(
  title: string,
  target: ExportTarget,
  totalItems: number,
  selectedItems: number,
): string {
  const isFiltered = selectedItems < totalItems;
  const lines = [
    `# 만들기 패키지 — ${title}`,
    "",
    "이 패키지는 Simsa Workspace에서 내보낸 제품 설명서와 개발 지시서입니다.",
    "",
  ];

  if (isFiltered) {
    lines.push(
      `> **이번 패키지에 포함된 항목: ${selectedItems}개** (전체 ${totalItems}개 중)`,
      "> 포함되지 않은 항목은 건드리지 마세요.",
      "",
    );
  } else {
    lines.push(
      `> 이번 패키지에 포함된 항목: ${selectedItems}개 (전체)`,
      "",
    );
  }

  lines.push("## 개발 AI에 넘기는 방법", "");

  if (target !== "codex") {
    lines.push(
      "### Claude Code 사용 시",
      "`CLAUDE_CODE_PROMPT.md` 파일 내용을 복사해서 Claude Code 대화창에 붙여넣으세요.",
      "",
    );
  }
  if (target !== "claude_code") {
    lines.push(
      "### Codex 사용 시",
      "`CODEX_PROMPT.md` 파일 내용을 복사해서 Codex 대화창에 붙여넣으세요.",
      "",
    );
  }

  lines.push(
    "## 읽어야 할 파일 순서",
    "",
    "1. `product.md` — 제품 설명서 (무엇을 만드는지)",
    "2. `items.md` — 꼭 들어가야 할 항목 (무엇을 구현해야 하는지)",
    "3. `checks.md` — 확인 결과 (어떤 항목에 문제가 있는지)",
    "4. `fixes.md` — 고쳐야 할 항목 (어떻게 고쳐야 하는지)",
    "",
    "## 주의사항",
    "",
    "- 범위를 벗어난 기능은 구현하지 마세요.",
    "- 확인 결과는 제품 설명서 기준의 사전 점검입니다. 실제 코드나 GitHub PR을 확인한 결과가 아닙니다.",
    "- 애매한 점이 있으면 구현 전에 질문하세요.",
  );

  return lines.join("\n");
}

function genProductMd(spec: ExportProductSpec): string {
  const sections: string[] = [
    `# 제품 설명서 — ${spec.productName}`,
    "",
    spec.oneLine,
  ];

  if (spec.targetUsers.length > 0) {
    sections.push("", "## 누가 쓰는 제품", "", ...spec.targetUsers.map((u) => `- ${u}`));
  }

  sections.push("", "## 해결하려는 문제", "", spec.problem);

  if (spec.included.length > 0) {
    sections.push("", "## 이번 버전에 포함", "", ...spec.included.map((i) => `- ${i}`));
  }

  if (spec.excluded.length > 0) {
    sections.push("", "## 이번 버전에서 제외", "", ...spec.excluded.map((e) => `- ~~${e}~~`));
  }

  if (spec.userFlow.length > 0) {
    sections.push("", "## 사용자 흐름", "", ...spec.userFlow.map((f, i) => `${i + 1}. ${f}`));
  }

  if (spec.decisions.length > 0) {
    sections.push("", "## 결정된 사항", "", ...spec.decisions.map((d) => `- ${d}`));
  }

  if (spec.openQuestions.length > 0) {
    sections.push("", "## 아직 결정이 필요한 사항", "", ...spec.openQuestions.map((q) => `- [ ] ${q}`));
  }

  return sections.join("\n");
}

function genItemsMd(items: ExportItem[], totalItems: number): string {
  if (items.length === 0) {
    return "# 꼭 들어가야 할 항목\n\n항목이 없습니다.";
  }

  const header =
    items.length < totalItems
      ? `# 꼭 들어가야 할 항목 (이번 패키지: ${items.length}개 / 전체: ${totalItems}개)\n`
      : `# 꼭 들어가야 할 항목 (${items.length}개)\n`;

  const lines = [header];
  if (items.length < totalItems) {
    lines.push("> 포함되지 않은 항목은 이번 패키지에서 건드리지 마세요.\n");
  }

  for (const item of items) {
    lines.push(`## ${item.title}`);
    lines.push(`**상태:** ${statusLabel(item.status)}`);
    if (item.criteria.length > 0) {
      lines.push("", "**완성 기준:**", "");
      for (const c of item.criteria) lines.push(`- [ ] ${c}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function genChecksMd(checkResults?: ExportCheckResults, totalItems?: number): string {
  const disclaimer =
    "> **안내:** 이 확인 결과는 제품 설명서 기준의 사전 점검입니다. 아직 실제 코드나 GitHub PR을 확인한 결과가 아닙니다.";

  if (!checkResults || checkResults.results.length === 0) {
    return [
      "# 확인 결과",
      "",
      disclaimer,
      "",
      "확인 결과가 없습니다. Simsa Workspace에서 확인을 실행해주세요.",
    ].join("\n");
  }

  const { summary, results } = checkResults;
  const isFiltered = totalItems !== undefined && results.length < totalItems;
  const title = isFiltered
    ? `# 확인 결과 (이번 패키지: ${results.length}개 항목)`
    : "# 확인 결과";

  const lines = [title, "", disclaimer, ""];

  lines.push(
    "## 요약",
    "",
    "| 통과 | 안 맞음 | 확인 부족 | 결정 필요 |",
    "|------|---------|-----------|----------|",
    `| ${summary.passed} | ${summary.failed} | ${summary.inconclusive} | ${summary.needsDecision} |`,
    "",
  );

  const order = ["passed", "failed", "inconclusive", "needs_decision"];
  const grouped = new Map<string, ExportCheckResult[]>();
  for (const r of results) {
    if (!grouped.has(r.status)) grouped.set(r.status, []);
    grouped.get(r.status)!.push(r);
  }

  for (const status of order) {
    const group = grouped.get(status);
    if (!group || group.length === 0) continue;
    lines.push(`## ${statusLabel(status)} (${group.length}개)`, "");
    for (const r of group) {
      lines.push(`### ${r.title}`, "");
      lines.push(`**이유:** ${r.reason}`, "");
      if (r.evidence.length > 0) {
        lines.push("**확인 근거:**", "");
        for (const e of r.evidence) lines.push(`- ${e}`);
        lines.push("");
      }
      if (r.status !== "passed" && r.nextAction) {
        lines.push(`**다음 행동:** ${r.nextAction}`, "");
      }
    }
  }

  return lines.join("\n");
}

function genFixesMd(
  items: ExportItem[],
  fixSuggestions?: Record<string, ExportFixSuggestion>,
): string {
  const needsFix = items.filter(
    (i) => i.status === "failed" || i.status === "inconclusive" || i.status === "needs_decision",
  );

  if (needsFix.length === 0) {
    return "# 고쳐야 할 항목\n\n모든 항목이 통과됐습니다.";
  }

  const lines = ["# 고쳐야 할 항목", ""];

  for (const item of needsFix) {
    const fix = fixSuggestions?.[item.id];
    lines.push(`## ${item.title}`);
    lines.push(`**상태:** ${statusLabel(item.status)}`, "");

    if (fix) {
      const { plainSummary, builderBrief } = fix.suggestion;
      lines.push("### 수정 제안", "", plainSummary, "");
      lines.push("### 개발 AI에게 줄 작업 지시", "");
      lines.push(`**${builderBrief.title}**`, "");
      lines.push(`**목표:** ${builderBrief.goal}`, "");

      if (builderBrief.tasks.length > 0) {
        lines.push("**해야 할 작업:**", "");
        for (const t of builderBrief.tasks) lines.push(`- ${t}`);
        lines.push("");
      }
      if (builderBrief.doneWhen.length > 0) {
        lines.push("**완료 기준:**", "");
        for (const d of builderBrief.doneWhen) lines.push(`- [ ] ${d}`);
        lines.push("");
      }
      if (builderBrief.doNotDo.length > 0) {
        lines.push("**하지 말아야 할 것:**", "");
        for (const d of builderBrief.doNotDo) lines.push(`- ${d}`);
        lines.push("");
      }
    } else {
      lines.push(
        "> 아직 수정 제안이 없습니다. Simsa Workspace에서 고쳐보기를 실행해주세요.",
        "",
      );
    }
  }

  return lines.join("\n");
}

function genClaudeCodePrompt(
  title: string,
  effectiveItems: ExportItem[],
  totalItems: number,
): string {
  const isFiltered = effectiveItems.length < totalItems;
  const itemList = effectiveItems.map((i) => `- [ ] ${i.title}`).join("\n");

  return [
    `# Claude Code용 지시서 — ${title}`,
    "",
    "이 파일 내용을 Claude Code 대화창에 그대로 붙여넣으세요.",
    "",
    isFiltered
      ? `> **이번 패키지에 포함된 항목: ${effectiveItems.length}개** (전체 ${totalItems}개 중)`
      : `> 이번 패키지에 포함된 항목: ${effectiveItems.length}개 (전체)`,
    ">",
    "> 포함되지 않은 항목은 건드리지 마세요.",
    "",
    "---",
    "",
    "## 지시사항",
    "",
    "1. 먼저 `product.md`를 읽어 전체 맥락을 이해한다.",
    `2. \`items.md\`에서 이번에 포함된 항목만 확인한다. (총 ${effectiveItems.length}개)`,
    "3. `checks.md`에서 각 항목의 문제가 된 이유를 확인한다.",
    "4. `fixes.md`의 수정 지시를 따른다.",
    "5. 코딩 전에 관련 파일을 탐색하고 짧은 구현 계획을 작성한다.",
    "6. 구현 후 각 항목의 완성 기준별로 스스로 확인한다.",
    "7. 변경 파일, 완료한 항목, 실행한 테스트, 남은 위험을 보고한다.",
    "",
    "## 중요한 제약",
    "",
    "- **이번 패키지에 포함된 항목만 구현하거나 수정한다.**",
    "- 포함되지 않은 항목은 건드리지 않는다.",
    "- `product.md`의 '이번 버전에서 제외' 항목은 절대 구현하지 않는다.",
    "- 전체 제품을 한 번에 만들지 않는다. 이번 패키지 범위만 구현한다.",
    "- 애매한 점이 있으면 코드 작성 전에 질문한다.",
    "",
    "## 포함된 항목 목록",
    "",
    itemList,
  ].join("\n");
}

function genCodexPrompt(
  title: string,
  spec: ExportProductSpec,
  effectiveItems: ExportItem[],
  totalItems: number,
  fixSuggestions?: Record<string, ExportFixSuggestion>,
): string {
  const isFiltered = effectiveItems.length < totalItems;

  const tasksLines: string[] = [];
  for (const item of effectiveItems) {
    tasksLines.push(`- ${item.title}`);
    const fix = fixSuggestions?.[item.id];
    if (fix?.suggestion.builderBrief.tasks.length) {
      for (const t of fix.suggestion.builderBrief.tasks) {
        tasksLines.push(`  - ${t}`);
      }
    }
  }

  const doneWhenLines: string[] = [];
  for (const item of effectiveItems) {
    const fix = fixSuggestions?.[item.id];
    const criteria = fix?.suggestion.builderBrief.doneWhen.length
      ? fix.suggestion.builderBrief.doneWhen
      : item.criteria;
    for (const d of criteria) doneWhenLines.push(`- [ ] ${d}`);
  }
  if (doneWhenLines.length === 0) {
    doneWhenLines.push("- (완성 기준을 items.md에서 확인하세요)");
  }

  const doNotDoLines: string[] = [
    isFiltered
      ? `- 이번 패키지에 포함되지 않은 항목 (전체 ${totalItems}개 중 ${effectiveItems.length}개만 포함)은 건드리지 마세요.`
      : "- 이번 버전 범위를 벗어난 기능은 구현하지 마세요.",
    ...spec.excluded.map((e) => `- ${e}을(를) 구현하지 마세요`),
    ...Object.values(fixSuggestions ?? {}).flatMap(
      (f) => f.suggestion.builderBrief.doNotDo.map((d) => `- ${d}`)
    ),
  ];

  return [
    `# Codex용 지시서 — ${title}`,
    "",
    "이 파일 내용을 Codex 대화창에 그대로 붙여넣으세요.",
    "",
    "---",
    "",
    "## Goal",
    "",
    spec.oneLine,
    "",
    "## Context",
    "",
    `제품: ${spec.productName}`,
    `대상 사용자: ${spec.targetUsers.join(", ") || "미정"}`,
    `핵심 문제: ${spec.problem}`,
    "",
    "이번 버전에 포함할 기능:",
    ...spec.included.map((i) => `- ${i}`),
    "",
    "## Selected tasks",
    "",
    isFiltered
      ? `**이번에 구현할 항목 (${effectiveItems.length}개 / 전체 ${totalItems}개 중):**`
      : `**이번에 구현할 항목 (${effectiveItems.length}개):**`,
    "",
    ...(tasksLines.length > 0 ? tasksLines : ["- (items.md 참고)"]),
    "",
    "> 포함되지 않은 항목은 건드리지 마세요.",
    "",
    "## Constraints",
    "",
    "- 위 'Selected tasks' 목록의 항목만 구현한다.",
    "- 전체 제품을 한 번에 만들지 않는다.",
    "- 아래 'Do not do' 항목은 절대 구현하지 않는다.",
    "- 코딩 전에 관련 파일을 탐색하고 짧은 구현 계획을 작성한다.",
    "- 기존 코드베이스가 있다면 기존 패턴을 따른다.",
    "",
    "## Done when",
    "",
    ...doneWhenLines,
    "",
    "## Do not do",
    "",
    ...doNotDoLines,
    "",
    "## Verify by",
    "",
    "- 각 항목의 완성 기준(items.md)을 기준으로 직접 확인한다.",
    "- 포함되지 않은 항목이 변경되지 않았는지 확인한다.",
    "- 범위 밖 기능이 추가되지 않았는지 확인한다.",
    "- 아직 결정이 필요한 사항(product.md)이 구현에 영향을 미치지 않았는지 확인한다.",
    "",
    "## Final response format",
    "",
    "완료 시 다음 형식으로 보고하라:",
    "",
    "```",
    "완료한 항목:",
    "- [항목명]",
    "",
    "변경한 파일:",
    "- [파일명]",
    "",
    "실행한 테스트:",
    "- [테스트명]",
    "",
    "남은 위험:",
    "- [위험 항목 또는 없음]",
    "```",
  ].join("\n");
}

// ─── D1-b regression hook ─────────────────────────────────────────────────────

/**
 * Fixed closing instruction that closes the idea-only loop: it tells the
 * building agent to self-check against the acceptance criteria and then send
 * the user back to Simsa with their deployed URL, via a project-scoped deep
 * link. Deterministic and English (it is an instruction to a coding agent).
 *
 * Returns null when projectId or baseUrl is missing so the pack never emits a
 * broken `/p//connect` link. The base URL is normalised (trailing slashes
 * stripped) to avoid `//p/...`.
 */
export function regressionHookBlock(projectId?: string, appBaseUrl?: string): string | null {
  const pid = (projectId ?? "").trim();
  const base = (appBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!pid || !base) return null;
  const connectUrl = `${base}/p/${encodeURIComponent(pid)}/connect`;
  return [
    "## After building",
    "",
    "After you finish building, self-check the result against the acceptance criteria above.",
    `Then tell the user to paste their deployed app URL at \`${connectUrl}\` so Simsa can review the live app.`,
  ].join("\n");
}

// ─── Main export function ─────────────────────────────────────────────────────

export function generateBuilderPack(
  req: WorkspaceExportBuilderPackRequest,
): WorkspaceExportBuilderPackResponse {
  const project = req.project;
  if (!project) {
    return {
      ok: true,
      source: "deterministic",
      bundle: { files: [] },
      summary: {
        fileCount: 0,
        totalItems: 0,
        selectedItems: 0,
        recommendedNextStep: "project 데이터를 포함해서 다시 요청해주세요.",
      },
    };
  }

  const { title, productSpec, items: allItems, checkResults, fixSuggestions } = project;
  const target = req.target;

  // ── Apply selectedItemIds filter ──────────────────────────────────────────
  const selectedSet =
    req.selectedItemIds && req.selectedItemIds.length > 0
      ? new Set(req.selectedItemIds)
      : null;
  const effectiveItems = selectedSet
    ? allItems.filter((i) => selectedSet.has(i.id))
    : allItems;

  // ── Filter check results and fix suggestions to selected items ─────────────
  const effectiveCheckResults: ExportCheckResults | undefined = (() => {
    if (!checkResults) return undefined;
    const results = selectedSet
      ? checkResults.results.filter((r) => selectedSet.has(r.itemId))
      : checkResults.results;
    const summary = {
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      inconclusive: results.filter((r) => r.status === "inconclusive").length,
      needsDecision: results.filter((r) => r.status === "needs_decision").length,
    };
    return { results, summary };
  })();

  const effectiveFixSuggestions: Record<string, ExportFixSuggestion> | undefined =
    fixSuggestions && selectedSet
      ? Object.fromEntries(
          Object.entries(fixSuggestions).filter(([id]) => selectedSet.has(id)),
        )
      : fixSuggestions;

  // ── D1-b regression hook (omitted cleanly when projectId/baseUrl absent) ───
  const hook = regressionHookBlock(req.projectId, req.appBaseUrl);
  const hookSuffix = hook ? `\n\n${hook}` : "";

  // ── Generate files ────────────────────────────────────────────────────────
  const baseFiles: ExportFile[] = [
    {
      path: "conclave-build-pack/README.md",
      content: genReadme(title, target, allItems.length, effectiveItems.length) + hookSuffix,
    },
    {
      path: "conclave-build-pack/product.md",
      content: genProductMd(productSpec), // always full context
    },
    {
      path: "conclave-build-pack/items.md",
      content: genItemsMd(effectiveItems, allItems.length),
    },
    {
      path: "conclave-build-pack/checks.md",
      content: genChecksMd(effectiveCheckResults, allItems.length),
    },
    {
      path: "conclave-build-pack/fixes.md",
      content: genFixesMd(effectiveItems, effectiveFixSuggestions),
    },
  ];

  if (target !== "codex") {
    baseFiles.push({
      path: "conclave-build-pack/CLAUDE_CODE_PROMPT.md",
      content: genClaudeCodePrompt(title, effectiveItems, allItems.length) + hookSuffix,
    });
  }
  if (target !== "claude_code") {
    baseFiles.push({
      path: "conclave-build-pack/CODEX_PROMPT.md",
      content:
        genCodexPrompt(title, productSpec, effectiveItems, allItems.length, effectiveFixSuggestions) +
        hookSuffix,
    });
  }

  const hasIssues =
    effectiveCheckResults &&
    (effectiveCheckResults.summary.failed > 0 ||
      effectiveCheckResults.summary.inconclusive > 0 ||
      effectiveCheckResults.summary.needsDecision > 0);

  const recommendedNextStep = hasIssues
    ? "fixes.md에서 고쳐야 할 항목을 확인하고, 해당 지시서를 개발 AI에 넘기세요."
    : "CLAUDE_CODE_PROMPT.md 또는 CODEX_PROMPT.md를 복사해서 개발 AI에 붙여넣으세요.";

  return {
    ok: true,
    source: "deterministic",
    bundle: { files: baseFiles },
    summary: {
      fileCount: baseFiles.length,
      totalItems: allItems.length,
      selectedItems: effectiveItems.length,
      recommendedNextStep,
    },
  };
}

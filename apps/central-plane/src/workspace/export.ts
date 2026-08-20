/**
 * workspace/export.ts
 *
 * Deterministic "만들기 패키지" (builder pack) generation.
 * No LLM calls — pure string assembly from structured project data.
 * Produces Markdown files ready for Claude Code or Codex.
 *
 * Stage 7: supports selectedItemIds filtering + stronger task-focus prompts.
 */

import { pickServiceExampleBlocks } from "./service-examples.js";
import { detectNonWebBuildable } from "./generate.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** "web_builder" (D10, 2026-07-17): one shared prompt for chat-driven web
 *  builders (Lovable / Replit / v0 / Bolt) — no file tree, no terminal, no git;
 *  secrets go in the builder's own settings UI and deploy is its Publish
 *  button. "both" keeps its original meaning (claude_code + codex).
 *
 *  "handoff" (#296 Phase 4-lite, 2026-07-17): deliverables for handing the
 *  project to a HUMAN — an outside developer, a specialist team, or a native
 *  app shop. No agent prompt; instead a HANDOFF_BRIEF.md that states the
 *  target platform, what's decided/undecided, what is OUT of the web-review
 *  scope (when the idea needs a native build), and the acceptance checklist. */
export type ExportTarget = "claude_code" | "codex" | "both" | "web_builder" | "handoff";
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

/**
 * A single environment variable the app needs (prep layer). `value` is the real
 * value the in-Simsa setup UI collected IN THE BROWSER and passes at export time
 * — it is NEVER stored server-side (no-store, Rule 3). It lands only in the
 * generated `.env.local` (gitignored). `.env.example` always uses `example`/a
 * placeholder, never the real value. `secret: true` = server-only (e.g. a
 * Supabase service_role key) — must never go in the frontend.
 */
export type BuilderPackEnvVar = {
  key: string;
  description: string;
  secret?: boolean;
  example?: string;
  value?: string;
};

/** An external service the app connects to (database, hosting, auth, …). */
export type BuilderPackService = {
  id: string;
  label: string;
  setupUrl?: string;
  setupSteps?: string[];
  envVars: BuilderPackEnvVar[];
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
  /** Prep layer (in-Simsa setup): external services + their env vars. When present
   *  and non-empty, the pack gets `.env.example` + `SETUP.md` (+ `.env.local` when
   *  the setup UI supplied real values). No-store: values arrive here per-export
   *  and are only written into the pack, never persisted server-side (Rule 3). */
  services?: BuilderPackService[];
  /** #296 Phase 3: onboarding interview profile. githubLevel picks the deploy
   *  path the prompts lead with; aiToolLevel "no" adds first-timer pacing.
   *  Absent → neutral guidance (unchanged pre-Phase-3 behavior). */
  userProfile?: ExportUserProfile;
  target: ExportTarget;
  format: ExportFormat;
  locale?: "ko" | "en";
};

export type ExportUserProfile = {
  platform?: "web" | "mobile" | "unknown";
  githubLevel?: "fluent" | "heard" | "new";
  aiToolLevel?: "yes" | "some" | "no";
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

/** G14-b: pack language. KO output stays byte-identical to pre-locale code —
 *  every gen* function branches EN at the top and leaves the KO body untouched.
 *  Keep the two branches structurally in sync when editing either. */
type PackLocale = "ko" | "en";

function statusLabel(status: string, locale: PackLocale = "ko"): string {
  const map: Record<string, string> =
    locale === "en"
      ? {
          passed: "passed",
          failed: "doesn't match",
          inconclusive: "needs checking",
          needs_decision: "decision needed",
          not_started: "not started",
        }
      : {
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
  locale: PackLocale = "ko",
): string {
  const isFiltered = selectedItems < totalItems;
  if (locale === "en") {
    const lines = [
      `# Build pack — ${title}`,
      "",
      target === "web_builder"
        ? "This pack is the product spec and build brief exported from Simsa. Paste the brief into a web builder's chat (Lovable, Replit, v0, Bolt, …) and it carries the work from implementation to Publish inside the builder — no installs, no terminal."
        : target === "handoff"
          ? "This pack was exported from Simsa **to hand to a developer or a specialist team**. Send `HANDOFF_BRIEF.md` as-is — it contains what to build, what's decided, and the acceptance criteria."
          : "This pack is the product spec and build brief exported from Simsa. Hand the prompt to a coding AI and it is instructed to carry the work through implementation and a run check. **For deployment to finish automatically, the coding AI needs a deploy tool connected (e.g. Vercel/GitHub MCP or CLI)**; if none is connected, it falls back to walking the user through a deploy path that fits their situation (with or without GitHub), step by step.",
      "",
    ];

    if (isFiltered) {
      lines.push(
        `> **Items included in this pack: ${selectedItems}** (of ${totalItems} total)`,
        "> Do not touch items that are not included.",
        "",
      );
    } else {
      lines.push(`> Items included in this pack: ${selectedItems} (all)`, "");
    }

    lines.push("## How to hand this to a coding AI", "");

    if (target === "claude_code" || target === "both") {
      lines.push(
        "### Using Claude Code",
        "Copy the contents of `CLAUDE_CODE_PROMPT.md` and paste them into the Claude Code chat.",
        "",
      );
    }
    if (target === "codex" || target === "both") {
      lines.push(
        "### Using Codex",
        "Copy the contents of `CODEX_PROMPT.md` and paste them into the Codex chat.",
        "",
      );
    }
    if (target === "web_builder") {
      lines.push(
        "### Using a web builder like Lovable / Replit / v0 / Bolt",
        "Copy the contents of `WEB_BUILDER_PROMPT.md` and paste them into the builder's chat. That one brief contains everything needed (the builder cannot read the other files in this folder).",
        "",
      );
    }
    if (target === "handoff") {
      lines.push(
        "### Handing off to a developer or team",
        "Send `HANDOFF_BRIEF.md` as-is — it contains what to build, what is decided vs. still open, and the acceptance criteria.",
        "",
      );
    }

    lines.push(
      "## Read the files in this order",
      "",
      "1. `product.md` — the product spec (what is being built)",
      "2. `items.md` — the must-have items (what to implement)",
      "3. `checks.md` — check results (which items have problems)",
      "4. `fixes.md` — items to fix (how to fix them)",
      "",
      "## Cautions",
      "",
      "- Do not implement features outside the scope.",
      "- The check results are a pre-check against the product spec — not a review of real code or a GitHub PR.",
      "- If anything is ambiguous, ask before implementing.",
      "",
      "## What this pack does NOT guarantee",
      "",
      "- **Automatic deployment**: if the coding AI has no deploy tool connected, deployment proceeds as guided manual steps. Follow the AI's guidance to finish.",
      "- **Result verification**: Simsa does not directly verify what the coding AI actually built. When it's done, put the deployed URL (or the project files) back into Simsa for review.",
    );

    return lines.join("\n");
  }
  const lines = [
    `# 만들기 패키지 — ${title}`,
    "",
    target === "web_builder"
      ? "이 패키지는 Simsa에서 내보낸 제품 설명서와 개발 지시서입니다. 웹 빌더(Lovable·Replit·v0·Bolt 등)의 채팅창에 지시서를 붙여넣으면 구현부터 게시(Publish)까지 빌더 안에서 진행됩니다 — 별도 설치나 터미널이 필요 없습니다."
      : target === "handoff"
        ? "이 패키지는 Simsa에서 내보낸, **개발자·전문팀에게 전달하기 위한** 자료입니다. 무엇을 만들지·결정된 것·완성 기준이 담긴 `HANDOFF_BRIEF.md`를 그대로 보내면 됩니다."
        : "이 패키지는 Simsa에서 내보낸 제품 설명서와 개발 지시서입니다. 개발 AI에게 프롬프트를 넘기면 구현과 실행 확인까지 진행하도록 지시합니다. **인터넷 배포까지 자동으로 이어지려면 개발 AI에 배포 도구(예: Vercel·GitHub의 MCP 또는 CLI)가 연결돼 있어야 하고**, 연결돼 있지 않으면 개발 AI가 사용자 상황에 맞는 배포 길(GitHub 유무에 따라)을 단계별로 안내하는 방식으로 대신합니다.",
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

  if (target === "claude_code" || target === "both") {
    lines.push(
      "### Claude Code 사용 시",
      "`CLAUDE_CODE_PROMPT.md` 파일 내용을 복사해서 Claude Code 대화창에 붙여넣으세요.",
      "",
    );
  }
  if (target === "codex" || target === "both") {
    lines.push(
      "### Codex 사용 시",
      "`CODEX_PROMPT.md` 파일 내용을 복사해서 Codex 대화창에 붙여넣으세요.",
      "",
    );
  }
  if (target === "web_builder") {
    lines.push(
      "### Lovable / Replit / v0 / Bolt 같은 웹 빌더 사용 시",
      "`WEB_BUILDER_PROMPT.md` 파일 내용을 복사해서 빌더의 채팅창에 붙여넣으세요. 그 지시서 하나에 필요한 내용이 모두 들어 있습니다(빌더는 이 폴더의 다른 파일을 읽지 못합니다).",
      "",
    );
  }
  if (target === "handoff") {
    lines.push(
      "### 개발자·전문팀에 전달할 때",
      "`HANDOFF_BRIEF.md`를 그대로 보내세요 — 무엇을 만들지, 결정된 것과 아직 결정할 것, 완성 기준이 모두 들어 있습니다.",
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
    "",
    "## 이 패키지가 보장하지 않는 것",
    "",
    "- **배포 자동 완료**: 개발 AI에 배포 도구가 연결돼 있지 않으면 배포는 수동 안내로 진행됩니다. 개발 AI의 안내를 따라 마무리해주세요.",
    "- **결과 검증**: Simsa는 개발 AI가 실제로 무엇을 만들었는지 직접 확인하지 않습니다. 완성되면 배포된 주소(또는 프로젝트 파일)를 Simsa에 다시 넣어 확인받으세요.",
  );

  return lines.join("\n");
}

function genProductMd(spec: ExportProductSpec, locale: PackLocale = "ko"): string {
  if (locale === "en") {
    const sections: string[] = [`# Product spec — ${spec.productName}`, "", spec.oneLine];
    if (spec.targetUsers.length > 0) {
      sections.push("", "## Who this is for", "", ...spec.targetUsers.map((u) => `- ${u}`));
    }
    sections.push("", "## Problem being solved", "", spec.problem);
    if (spec.included.length > 0) {
      sections.push("", "## Included in this version", "", ...spec.included.map((i) => `- ${i}`));
    }
    if (spec.excluded.length > 0) {
      sections.push("", "## Excluded from this version", "", ...spec.excluded.map((e) => `- ~~${e}~~`));
    }
    if (spec.userFlow.length > 0) {
      sections.push("", "## User flow", "", ...spec.userFlow.map((f, i) => `${i + 1}. ${f}`));
    }
    if (spec.decisions.length > 0) {
      sections.push("", "## Decided", "", ...spec.decisions.map((d) => `- ${d}`));
    }
    if (spec.openQuestions.length > 0) {
      sections.push("", "## Still to decide", "", ...spec.openQuestions.map((q) => `- [ ] ${q}`));
    }
    return sections.join("\n");
  }
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

function genItemsMd(items: ExportItem[], totalItems: number, locale: PackLocale = "ko"): string {
  if (locale === "en") {
    if (items.length === 0) {
      return "# Must-have items\n\nThere are no items.";
    }
    const header =
      items.length < totalItems
        ? `# Must-have items (this pack: ${items.length} of ${totalItems})\n`
        : `# Must-have items (${items.length})\n`;
    const lines = [header];
    if (items.length < totalItems) {
      lines.push("> Do not touch items that are not included in this pack.\n");
    }
    for (const item of items) {
      lines.push(`## ${item.title}`);
      lines.push(`**Status:** ${statusLabel(item.status, "en")}`);
      if (item.criteria.length > 0) {
        lines.push("", "**Done when:**", "");
        for (const c of item.criteria) lines.push(`- [ ] ${c}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
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

function genChecksMd(checkResults?: ExportCheckResults, totalItems?: number, locale: PackLocale = "ko"): string {
  if (locale === "en") {
    const disclaimer =
      "> **Note:** these check results are a pre-check against the product spec — not a review of real code or a GitHub PR.";
    if (!checkResults || checkResults.results.length === 0) {
      return [
        "# Check results",
        "",
        disclaimer,
        "",
        "There are no check results yet. Run a check in the Simsa workspace.",
      ].join("\n");
    }
    const { summary, results } = checkResults;
    const isFiltered = totalItems !== undefined && results.length < totalItems;
    const title = isFiltered ? `# Check results (this pack: ${results.length} items)` : "# Check results";
    const lines = [title, "", disclaimer, ""];
    lines.push(
      "## Summary",
      "",
      "| Passed | Doesn't match | Needs checking | Decision needed |",
      "|--------|---------------|----------------|-----------------|",
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
      lines.push(`## ${statusLabel(status, "en")} (${group.length})`, "");
      for (const r of group) {
        lines.push(`### ${r.title}`, "");
        lines.push(`**Reason:** ${r.reason}`, "");
        if (r.evidence.length > 0) {
          lines.push("**Evidence:**", "");
          for (const e of r.evidence) lines.push(`- ${e}`);
          lines.push("");
        }
        if (r.status !== "passed" && r.nextAction) {
          lines.push(`**Next action:** ${r.nextAction}`, "");
        }
      }
    }
    return lines.join("\n");
  }
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
  locale: PackLocale = "ko",
): string {
  if (locale === "en") {
    const needsFix = items.filter(
      (i) => i.status === "failed" || i.status === "inconclusive" || i.status === "needs_decision",
    );
    if (needsFix.length === 0) {
      return "# Items to fix\n\nAll items passed.";
    }
    const lines = ["# Items to fix", ""];
    for (const item of needsFix) {
      const fix = fixSuggestions?.[item.id];
      lines.push(`## ${item.title}`);
      lines.push(`**Status:** ${statusLabel(item.status, "en")}`, "");
      if (fix) {
        const { plainSummary, builderBrief } = fix.suggestion;
        lines.push("### Fix suggestion", "", plainSummary, "");
        lines.push("### Brief for the coding AI", "");
        lines.push(`**${builderBrief.title}**`, "");
        lines.push(`**Goal:** ${builderBrief.goal}`, "");
        if (builderBrief.tasks.length > 0) {
          lines.push("**Tasks:**", "");
          for (const t of builderBrief.tasks) lines.push(`- ${t}`);
          lines.push("");
        }
        if (builderBrief.doneWhen.length > 0) {
          lines.push("**Done when:**", "");
          for (const d of builderBrief.doneWhen) lines.push(`- [ ] ${d}`);
          lines.push("");
        }
        if (builderBrief.doNotDo.length > 0) {
          lines.push("**Do not do:**", "");
          for (const d of builderBrief.doNotDo) lines.push(`- ${d}`);
          lines.push("");
        }
      } else {
        lines.push("> No fix suggestion yet. Run \"Fix it\" in the Simsa workspace.", "");
      }
    }
    return lines.join("\n");
  }
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

/**
 * Beginner hand-holding directive shared by both agent prompts. The end user may
 * be a complete non-developer, so the building agent must never say "set this up
 * yourself" for external services / API keys / env vars — it walks them through
 * signup URLs and exact click-paths, one step at a time. Korean, matching the
 * surrounding prompt and the KO-first audience.
 */
function beginnerSetupGuidance(specText: string, profile?: ExportUserProfile, locale: PackLocale = "ko"): string {
  if (locale === "en") {
    return [
      "## User guidance principle — assume a complete beginner",
      "",
      "This project's user may be a non-developer with zero coding experience. Whenever an external service (database, hosting, auth, payments, …), an API key, an environment variable, or a terminal command comes up, NEVER wave it off with \"set that up yourself\" — hold their hand like this:",
      "",
      ...(profile?.aiToolLevel === "no"
        ? [
            "**This user has never built anything with an AI tool before (confirmed in onboarding):**",
            "- In your first response, lay out the plan in 3 lines or fewer before starting. (e.g. \"① I'll build the app → ② run it and show you → ③ help you put it on the internet.\")",
            "- Ask for one thing at a time, and never move to the next step without the user's \"done\".",
            "- If the user answers oddly or stalls, don't push — ask what they currently see on screen and re-sync.",
            "",
          ]
        : []),
      "- Explain in one plain sentence why it's needed. (e.g. \"To save data we need a free database.\")",
      "- Give the full signup/setup URL as-is.",
      "- Walk them through **exactly where to click, one step at a time**. Unpack jargon (API key, environment variable, .env, …) in one line as it comes up.",
      "- Tell them **exactly where the copied value goes (e.g. which line of the `.env` file)**, and only move on after they confirm \"done\".",
      "- Never hardcode keys/passwords in code or logs — environment variables only.",
      "- If the user gets stuck, ask \"what do you see on your screen right now?\" or request a screenshot, then adjust the next step.",
      "",
      "Common service walkthroughs — matched to what this product needs (if a UI changed, adapt to the current screens, but keep this level of detail):",
      "",
      ...pickServiceExampleBlocks(specText, profile?.githubLevel, "en"),
      "",
      "**Deploy-readiness (important):** never hardcode any address the app uses to point at itself — the prefix of a short link, a share URL, a redirect target, an API base — to a development address like `http://localhost:3000`. Read it from the runtime origin (`window.location.origin` in the browser; the request host or an env var like `NEXT_PUBLIC_APP_URL` on the server). That way the address is right both locally and after deploy; skipping this ships user-visible links broken as `localhost`.",
    ].join("\n");
  }
  return [
    "## 사용자 안내 원칙 — 완전 초보자 가정",
    "",
    "이 프로젝트의 사용자는 개발 경험이 전혀 없는 비개발자일 수 있다. 외부 서비스(데이터베이스·호스팅·인증·결제 등)나 API 키, 환경변수, 터미널 명령이 필요한 순간에는 절대 \"알아서 준비하세요\"라고 넘기지 말고, 다음처럼 손을 잡고 안내하라:",
    "",
    // #296 Phase 3: the interview said this user has never used an AI tool —
    // pace the whole session for a first-timer, not just the service setup.
    ...(profile?.aiToolLevel === "no"
      ? [
          "**이 사용자는 AI 도구로 무언가 만드는 것 자체가 처음이다 (온보딩에서 확인됨):**",
          "- 첫 응답에서 앞으로의 진행 순서를 3줄 이내로 먼저 알려주고 시작하라. (예: \"①제가 앱을 만들고 → ②실행해서 보여드리고 → ③인터넷에 올리는 것까지 도와드려요.\")",
          "- 한 번에 하나만 부탁하고, 사용자의 \"했어요\" 확인 없이는 다음 단계로 넘어가지 마라.",
          "- 사용자가 이상한 답을 하거나 멈춰 있어도 재촉하지 말고, 지금 화면에 무엇이 보이는지부터 다시 물어라.",
          "",
        ]
      : []),
    "- 왜 필요한지 한 문장으로 쉽게 설명한다. (예: \"데이터를 저장하려면 무료 데이터베이스가 필요해요.\")",
    "- 가입·설정 URL을 전체 주소 그대로 준다.",
    "- 화면에서 **어디를 눌러야 하는지 단계별로, 한 번에 하나씩** 안내한다. 전문용어(API 키, 환경변수, .env 등)는 그때그때 한 줄로 풀어 설명한다.",
    "- 복사한 값을 **어디에 붙여넣는지(예: `.env` 파일의 어떤 줄)**까지 알려주고, 사용자가 \"했어요\"라고 확인하면 다음 단계로 넘어간다.",
    "- 키·비밀번호는 절대 코드나 로그에 하드코딩하지 말고 환경변수로만 안내한다.",
    "- 사용자가 막히면 \"지금 화면에 뭐가 보이세요?\"라고 묻거나 스크린샷을 요청해 다음 단계를 맞춘다.",
    "",
    "자주 쓰는 서비스 예시 — 이 제품에 필요한 것 기준 (UI가 바뀌었으면 현재 화면에 맞게 조정하되, 이 정도로 상세하게):",
    "",
    // D12: base + need-matched walkthroughs + the D11 deploy-path chooser
    // (#296 Phase 3: profile-aware — a known githubLevel skips the asking).
    ...pickServiceExampleBlocks(specText, profile?.githubLevel),
    "",
    "**배포 대응(중요):** 앱이 스스로를 가리키는 주소 — 짧은 링크의 앞부분, 공유 URL, 리다이렉트 대상, API 주소 등 — 를 절대 `http://localhost:3000` 같은 개발용 주소로 하드코딩하지 마라. 런타임 origin에서 가져와라(브라우저는 `window.location.origin`, 서버는 요청 host 또는 `NEXT_PUBLIC_APP_URL` 같은 환경변수). 그래야 로컬에서도, 배포 후에도 주소가 자동으로 맞는다. 이걸 안 하면 배포했을 때 사용자에게 보이는 링크가 `localhost`로 깨진다.",
  ].join("\n");
}

/**
 * "Build like it's for a non-developer, and finish with a RESULT" directive.
 * From dogfooding: the agent dragged the user through developer ceremony
 * (branches, migrations, TDD) and ended by ASKING "merge to master / open a PR /
 * discard?" instead of delivering a working app. A non-dev can't answer those
 * and just wants the outcome.
 */
const NONDEV_WORKFLOW_GUIDANCE: string = [
  "## 작업 방식 — 비개발자 우선",
  "",
  "이 사용자는 개발자가 아니다. 개발 절차 자체를 사용자에게 결정하게 하지 마라:",
  "- **묻지 말 것**: 브랜치를 딸지, 커밋을 어떻게 나눌지, main/master에 병합할지, PR을 만들지 같은 개발 프로세스 선택. 이런 건 네가 알아서 처리하거나 생략하라. 사용자에게 이런 선택 메뉴를 던지면 막힌다.",
  "- **손잡고 안내할 것은 딱 하나**: 외부 서비스 가입·키처럼 사용자만 할 수 있는 일. 위 '초보자 안내' 방식으로 단계별로.",
  "- 진행 상황은 개발 용어 없이 '지금 무엇을 만들고 있고, 다음에 무엇이 필요한지'로만 알린다.",
  "",
  "## 마무리 — 질문이 아니라 결과물",
  "",
  "다 만들었으면 절대 '어떻게 마무리할까요(병합/PR/브랜치/폐기)?'처럼 개발 절차를 나열해 묻지 마라. 대신 이렇게 끝맺어라:",
  "1. 앱을 실제로 **실행해서 동작하는 모습을 보여준다** (예: 개발 서버를 켠 뒤 접속할 로컬 주소를 알려준다).",
  "2. 실제로 쓰려면 어떻게 **배포**하는지 위 '초보자 안내' 방식으로 단계별 안내한다(Vercel 등).",
  "3. 배포된 URL(또는 프로젝트 파일)을 **Simsa에 다시 넣어 확인받게** 안내한다(아래 참고).",
  "끝은 언제나 '완성된 결과물 + 다음에 할 한 가지 행동'이어야 한다. 개발 절차 선택 메뉴로 끝내지 마라.",
].join("\n");

const NONDEV_WORKFLOW_GUIDANCE_EN: string = [
  "## Working style — non-developer first",
  "",
  "This user is not a developer. Never make them decide development process:",
  "- **Do not ask**: whether to branch, how to split commits, whether to merge to main/master, whether to open a PR. Handle or skip these yourself — a menu of such choices stalls the user.",
  "- **Hand-hold exactly one kind of thing**: work only the user can do (service signups, key issuance) — step by step, per the beginner guidance above.",
  "- Report progress without dev jargon: only \"what I'm building now, and what's needed next\".",
  "",
  "## Finishing — a result, not a question",
  "",
  "When it's built, never end with a process menu like \"how shall we wrap up (merge/PR/branch/discard)?\". End like this instead:",
  "1. Actually **run the app and show it working** (e.g. start the dev server and give the local address to open).",
  "2. Walk them through how to **deploy** for real use, step by step per the beginner guidance above (Vercel etc.).",
  "3. Guide them to **put the deployed URL (or the project files) back into Simsa** for review (see below).",
  "The ending is always \"a finished result + the one next action\" — never a menu of development choices.",
].join("\n");

/**
 * "Deploy in one shot with YOUR OWN connected tools" directive (prep-layer
 * option A). The user builds with an agent that has its own Vercel/GitHub MCP or
 * CLI authenticated in their editor — so the agent should deploy + push itself,
 * in one shot, and NEVER handle raw deploy tokens. Simsa never sees a token; the
 * only thing collected in Simsa is guidance, so the prompt reinforces the
 * token-safety invariant on the agent side too.
 */
const DEPLOY_VIA_MCP_GUIDANCE: string = [
  "## 한 번에 배포 — 네게 연결된 도구로 네가 직접",
  "",
  "이 사용자는 배포를 직접 손으로 하기 어렵다. 가능하면 **네게 연결된 배포·저장소 도구(예: Vercel·GitHub의 MCP 또는 CLI)를 사용해 네가 직접 배포와 저장소 푸시를 끝내라.** 사용자를 여러 화면으로 왕복시키지 말고, 한 번에 실제 배포 URL이 나오게 하라.",
  "",
  "**토큰·비밀 취급 (반드시 지킬 것):**",
  "- 배포·저장소 토큰이나 비밀 키를 코드·커밋·파일·이 지시서 어디에도 하드코딩하거나 기록하지 마라.",
  "- 사용자에게 배포 토큰이나 개인 액세스 토큰(PAT) 같은 raw 비밀을 붙여넣으라고 요구하지 마라. 그 인증은 사용자 에디터에 연결된 도구가 이미 갖고 있다고 가정한다.",
  "- 도구가 아직 연결돼 있지 않으면, 토큰을 물어보지 말고 **\"에디터에서 Vercel(또는 GitHub) 연결을 한 번 해주세요\"**라고 그 도구를 연결(로그인)하는 방법만 한 단계 안내한 뒤, 연결되면 네가 배포를 이어간다.",
  "- 사용자에게 **GitHub 계정 자체가 없다면 연결을 강요하지 마라** — 위 '초보자 안내'의 '배포 — 사용자 상황에 맞는 길'을 따라, GitHub 없이 되는 길(드래그앤드롭 배포)과 GitHub부터 만드는 길(계정 생성 → 저장소 생성 → 연결)을 쉽게 설명하고 사용자가 고르게 하라.",
  "",
  "**저장소:** 코드를 GitHub에 올릴 때도 같은 방식 — 연결된 GitHub 도구로 네가 푸시하고, 사용자에게 토큰을 묻지 마라.",
  "",
  "**배포 후:** 실제 배포된 URL을 사용자에게 그대로 알려주고, 그 URL을 Simsa에 다시 넣어 확인받게 안내한다(아래 참고). 연결된 도구가 전혀 없어 자동 배포가 정말 불가능한 경우에만, 위 '초보자 안내' 방식의 수동 배포로 대체한다.",
].join("\n");

const DEPLOY_VIA_MCP_GUIDANCE_EN: string = [
  "## Deploy in one shot — with YOUR connected tools, yourself",
  "",
  "This user can't easily deploy by hand. Whenever possible, **use the deploy/repository tools connected to you (e.g. Vercel/GitHub MCP or CLI) and finish the deploy and repo push yourself.** Don't bounce the user between screens — end with a real deployed URL in one shot.",
  "",
  "**Token & secret handling (non-negotiable):**",
  "- Never hardcode or record deploy/repository tokens or secret keys in code, commits, files, or anywhere in this brief.",
  "- Never ask the user to paste raw secrets like deploy tokens or personal access tokens (PATs). Assume the tool connected to their editor already holds that auth.",
  "- If a tool isn't connected yet, don't ask for a token — guide exactly one step: **\"please connect Vercel (or GitHub) in your editor once\"**, then continue the deploy yourself once it's connected.",
  "- If the user **has no GitHub account at all, don't force one** — follow the beginner guidance's \"deploy paths that fit the user\": explain the no-GitHub path (drag-and-drop deploy) and the GitHub-first path (create account → create repo → connect) simply, and let them choose.",
  "",
  "**Repository:** same rule for pushing code to GitHub — push it yourself via the connected GitHub tool; never ask the user for a token.",
  "",
  "**After deploying:** give the user the actual deployed URL as-is, and guide them to put that URL back into Simsa for review (see below). Only when no tool is connected at all and automatic deploy is truly impossible, fall back to the beginner-guided manual deploy.",
].join("\n");

/**
 * Closing "bring it back to Simsa" guidance, appended after the beginner setup
 * block. Broader than the deep-link hook: reminds the agent that the user can
 * return with a deployed URL OR the project files/spec for another review.
 */
const RETURN_TO_SIMSA_GUIDANCE: string = [
  "## 완성한 뒤 — Simsa로 다시 확인받기",
  "",
  "구현·자가 점검이 끝나면 사용자에게 이렇게 안내하라:",
  "- **배포까지 했다면**: 배포된 앱 URL을 Simsa에 다시 넣어 라이브 화면을 검수받게 한다.",
  "- **아직 배포 전이라면**: 프로젝트 파일(또는 기획서)을 Simsa에 다시 넣어 이번 결과를 재확인받게 한다.",
  "이렇게 하면 남은 문제를 Simsa가 다시 잡아주고, 다음 패키지로 이어갈 수 있다.",
].join("\n");

const RETURN_TO_SIMSA_GUIDANCE_EN: string = [
  "## When it's done — get it reviewed in Simsa again",
  "",
  "After implementation and self-checks, guide the user like this:",
  "- **If it's deployed**: put the deployed app URL back into Simsa so the live screens get inspected.",
  "- **If not deployed yet**: put the project files (or the spec) back into Simsa to re-check this round's result.",
  "That way Simsa catches what's left and the next pack picks up from there.",
].join("\n");

/**
 * The spine that turns the pack from an "implement these items" checklist into a
 * self-driving, one-shot runbook. From Bae's dogfooding: a user should be able
 * to download the pack, drop it into their agent, and have the WHOLE thing —
 * build → service setup → run → deploy → hand back the live URL — finish on its
 * own, without babysitting or dev-ceremony questions. Placed FIRST in both
 * prompts so the agent reads the end-to-end mission before the detailed steps;
 * the guidance blocks below are the "how" for each phase.
 */
const ONE_SHOT_RUNBOOK: string = [
  "## 이 지시 하나로 끝까지 — 사용자는 개발자가 아니다",
  "",
  "너는 이 사용자를 대신해 **처음부터 끝까지 한 번에** 진행한다. 목표는 '항목 구현'이 아니라 **실제로 돌아가는, 인터넷에 배포된 앱과 그 접속 주소(URL)를 사용자 손에 쥐여주는 것**이다. 아래 순서를 스스로 끝까지 밟아라. 중간에 개발 절차를 사용자에게 되묻지 말고, 배포된 결과가 나올 때까지 멈추지 마라. 단, **네게 배포·저장소 도구가 연결돼 있지 않아 자동 배포가 불가능하면** 그 사실을 사용자에게 솔직히 알리고 아래 '한 번에 배포'의 대체 절차(수동 안내)로 전환하라 — 되는 척하지 마라.",
  "",
  "1. **이해** — 이 폴더의 파일을 모두 읽는다(`product.md`·`items.md`·`checks.md`·`fixes.md`, 그리고 있으면 `SETUP.md`·`.env.example`).",
  "2. **구현** — 짧은 계획을 세우고, 이번 패키지에 포함된 항목만 구현한다.",
  "3. **서비스 설정** — 외부 서비스가 필요하면 `SETUP.md`를 따라 설정한다. 가입·키 발급처럼 사용자만 할 수 있는 일만 아래 '초보자 안내'처럼 한 단계씩 손잡아 부탁하고, 받은 값은 `.env.local`에 넣는다(코드에 하드코딩 금지). 그 외는 네가 알아서 한다.",
  "4. **실행 확인** — 앱을 실제로 실행해 각 항목의 완성 기준을 스스로 점검하고, 안 되는 부분은 될 때까지 고친다.",
  "5. **배포 + 저장소** — 아래 '한 번에 배포' 원칙대로, 네게 연결된 도구로 **네가 직접** 배포하고 코드를 GitHub에 올린다(토큰 무취급).",
  "6. **전달** — 배포된 실제 URL을 사용자에게 알려주고, 그 URL을 Simsa에 다시 넣어 확인받으라고 안내한다.",
  "",
  "**멈추지 않기:** 각 단계에서 막히면 스스로 해결을 시도하라. 정말 사용자만 할 수 있는 것(가입·키 입력, 도구 최초 연결)만 콕 집어 부탁하고 곧바로 이어간다. '어떻게 마무리할까요(병합/PR/브랜치)?' 같은 선택지로 끝내지 마라 — 끝은 언제나 '배포된 URL + 다음 한 가지 행동'이다.",
].join("\n");

const ONE_SHOT_RUNBOOK_EN: string = [
  "## This one brief, all the way — the user is not a developer",
  "",
  "You carry this through **start to finish in one go** on the user's behalf. The goal is not \"implement the items\" — it is **putting a genuinely working, internet-deployed app and its URL in the user's hands**. Walk the steps below to the end yourself. Don't quiz the user on development process along the way, and don't stop until a deployed result exists. However, **if no deploy/repository tool is connected to you and automatic deploy is impossible**, say so honestly and switch to the manual fallback in \"Deploy in one shot\" below — never pretend.",
  "",
  "1. **Understand** — read every file in this folder (`product.md`, `items.md`, `checks.md`, `fixes.md`, plus `SETUP.md`/`.env.example` if present).",
  "2. **Implement** — make a short plan, then build only the items included in this pack.",
  "3. **Service setup** — if external services are needed, follow `SETUP.md`. Ask the user only for what only they can do (signups, key issuance) — one hand-held step at a time per the beginner guidance — and put received values in `.env.local` (never hardcoded). Handle everything else yourself.",
  "4. **Run check** — actually run the app, check every item's done-criteria yourself, and fix what fails until it works.",
  "5. **Deploy + repository** — per \"Deploy in one shot\" below, deploy **yourself** with your connected tools and push the code to GitHub (zero token handling).",
  "6. **Deliver** — give the user the real deployed URL and guide them to put it back into Simsa for review.",
  "",
  "**Don't stall:** if a step blocks, try to solve it yourself first. Ask only for the things truly only the user can do (signup/key entry, first-time tool connection), then continue immediately. Never end with \"how shall we wrap up (merge/PR/branch)?\" — the ending is always \"a deployed URL + one next action\".",
].join("\n");

/**
 * "이미 준비된 서비스" — a prompt-facing REFERENCE block for the services the
 * user set up in Simsa. Lists service names + env var KEYS + where the value
 * lives (`.env.local`), and points the agent at code-side `process.env` access.
 *
 * SECURITY (B): this string must NEVER contain a real secret value. Only
 * `v.key`, `v.description`, `v.secret`, `svc.label`, `svc.setupUrl` are read —
 * `v.value` is deliberately untouched. The pasted-into-chat prompt is a leak
 * surface; values live only in the gitignored `.env.local`. Enforced by
 * builder-pack-prompt-no-secret.test.mjs (the prompt version of the #271 guard).
 */
function genServicesContext(services: BuilderPackService[], locale: PackLocale = "ko"): string {
  if (services.length === 0) return "";
  if (locale === "en") {
    const lines: string[] = [
      "## Services already prepared (no key values in this brief)",
      "",
      "The user pre-configured the services below in Simsa. **The actual key values are NOT in this brief** — they're already filled into the pack's `.env.local` file (gitignored) and never pasted into this chat.",
      "- In code, never hardcode values — read them via `process.env.<KEY>` (or the framework's convention).",
      "- Never expose actual key values in this chat, code, commits, or logs.",
      "",
    ];
    for (const svc of services) {
      lines.push(`### ${svc.label}`);
      if (svc.setupUrl) lines.push(`- Service: ${svc.setupUrl}`);
      lines.push("- Environment variables to use (values read from `.env.local`):");
      for (const v of svc.envVars) {
        const secret = v.secret ? " · server-only (never frontend/browser)" : "";
        lines.push(`  - \`${v.key}\` — ${v.description}${secret}`);
      }
      lines.push("");
    }
    lines.push(
      "- See `SETUP.md` for detailed setup and how to fill any still-empty values.",
      "- If a key has no value yet, ask the user to issue it per `SETUP.md`/`.env.example` and continue right away.",
    );
    return lines.join("\n");
  }
  const lines: string[] = [
    "## 이미 준비된 서비스 (키 값은 지시서에 없음)",
    "",
    "사용자가 Simsa에서 아래 서비스를 미리 설정했다. **실제 키 값은 이 지시서에 들어있지 않다** — 팩의 `.env.local` 파일에 이미 채워져 있고(gitignore됨), 이 대화창에도 절대 붙지 않는다.",
    "- 코드에서는 값을 하드코딩하지 말고 `process.env.<KEY>`(또는 프레임워크 규칙)로 읽어라.",
    "- 실제 키 값을 이 대화, 코드, 커밋, 로그 어디에도 노출하지 마라.",
    "",
  ];
  for (const svc of services) {
    lines.push(`### ${svc.label}`);
    if (svc.setupUrl) lines.push(`- 서비스: ${svc.setupUrl}`);
    lines.push("- 사용할 환경변수 (값은 `.env.local`에서 읽음):");
    for (const v of svc.envVars) {
      const secret = v.secret ? " · 서버 전용(프론트/브라우저 금지)" : "";
      lines.push(`  - \`${v.key}\` — ${v.description}${secret}`);
    }
    lines.push("");
  }
  lines.push(
    "- 자세한 설정과 아직 비어 있는 값을 채우는 법은 `SETUP.md`를 참고하라.",
    "- 값이 비어 있는 키가 있으면 `SETUP.md`/`.env.example` 안내대로 사용자에게 발급을 부탁하고 곧바로 이어가라.",
  );
  return lines.join("\n");
}

/** The spec text the need-matchers (D12) scan — what the product actually asks for. */
function specTextOf(spec: ExportProductSpec, items: ExportItem[]): string {
  return [
    spec.oneLine,
    spec.problem,
    ...spec.included,
    ...spec.userFlow,
    ...items.map((i) => [i.title, ...i.criteria].join(" ")),
  ].join(" ");
}

function genClaudeCodePrompt(
  title: string,
  spec: ExportProductSpec,
  effectiveItems: ExportItem[],
  totalItems: number,
  services: BuilderPackService[] = [],
  profile?: ExportUserProfile,
  locale: PackLocale = "ko",
): string {
  const isFiltered = effectiveItems.length < totalItems;
  const itemList = effectiveItems.map((i) => `- [ ] ${i.title}`).join("\n");

  if (locale === "en") {
    return [
      `# Brief for Claude Code — ${title}`,
      "",
      "Paste the contents of this file into the Claude Code chat as-is.",
      "",
      isFiltered
        ? `> **Items included in this pack: ${effectiveItems.length}** (of ${totalItems} total)`
        : `> Items included in this pack: ${effectiveItems.length} (all)`,
      ">",
      "> Do not touch items that are not included.",
      "",
      "---",
      "",
      ONE_SHOT_RUNBOOK_EN,
      "",
      "---",
      "",
      "## Detailed instructions",
      "",
      "1. Read `product.md` first for full context.",
      `2. In \`items.md\`, confirm only the items included this time. (${effectiveItems.length} total)`,
      "3. In `checks.md`, see why each item was flagged.",
      "4. Follow the fix instructions in `fixes.md`.",
      "5. Before coding, explore the relevant files and write a short implementation plan.",
      "6. After implementing, self-check each item against its done-criteria.",
      "7. Report changed files, completed items, tests run, and remaining risks.",
      "",
      "## Hard constraints",
      "",
      "- **Implement or modify only the items included in this pack.**",
      "- Do not touch items that are not included.",
      "- Never implement anything in `product.md`'s \"Excluded from this version\".",
      "- Do not build the whole product at once — this pack's scope only.",
      "- If anything is ambiguous, ask before writing code.",
      ...(services.length > 0 ? ["", genServicesContext(services, "en")] : []),
      "",
      beginnerSetupGuidance(specTextOf(spec, effectiveItems), profile, "en"),
      "",
      NONDEV_WORKFLOW_GUIDANCE_EN,
      "",
      DEPLOY_VIA_MCP_GUIDANCE_EN,
      "",
      RETURN_TO_SIMSA_GUIDANCE_EN,
      "",
      "## Included items",
      "",
      itemList,
    ].join("\n");
  }

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
    ONE_SHOT_RUNBOOK,
    "",
    "---",
    "",
    "## 세부 지시사항",
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
    ...(services.length > 0 ? ["", genServicesContext(services)] : []),
    "",
    beginnerSetupGuidance(specTextOf(spec, effectiveItems), profile),
    "",
    NONDEV_WORKFLOW_GUIDANCE,
    "",
    DEPLOY_VIA_MCP_GUIDANCE,
    "",
    RETURN_TO_SIMSA_GUIDANCE,
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
  services: BuilderPackService[] = [],
  profile?: ExportUserProfile,
  locale: PackLocale = "ko",
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
    doneWhenLines.push(locale === "en" ? "- (see items.md for the done-criteria)" : "- (완성 기준을 items.md에서 확인하세요)");
  }

  if (locale === "en") {
    const doNotDoLines: string[] = [
      isFiltered
        ? `- Do not touch items not included in this pack (only ${effectiveItems.length} of ${totalItems} are included).`
        : "- Do not implement features outside this version's scope.",
      ...spec.excluded.map((e) => `- Do not implement ${e}`),
      ...Object.values(fixSuggestions ?? {}).flatMap(
        (f) => f.suggestion.builderBrief.doNotDo.map((d) => `- ${d}`)
      ),
    ];

    return [
      `# Brief for Codex — ${title}`,
      "",
      "Paste the contents of this file into the Codex chat as-is.",
      "",
      "---",
      "",
      ONE_SHOT_RUNBOOK_EN,
      "",
      "---",
      "",
      "## Goal",
      "",
      spec.oneLine,
      "",
      "## Context",
      "",
      `Product: ${spec.productName}`,
      `Target users: ${spec.targetUsers.join(", ") || "TBD"}`,
      `Core problem: ${spec.problem}`,
      "",
      "Features included in this version:",
      ...spec.included.map((i) => `- ${i}`),
      ...(services.length > 0 ? ["", genServicesContext(services, "en")] : []),
      "",
      "## Selected tasks",
      "",
      isFiltered
        ? `**Items to implement this time (${effectiveItems.length} of ${totalItems}):**`
        : `**Items to implement this time (${effectiveItems.length}):**`,
      "",
      ...(tasksLines.length > 0 ? tasksLines : ["- (see items.md)"]),
      "",
      "> Do not touch items that are not included.",
      "",
      "## Constraints",
      "",
      "- Implement only the items in the 'Selected tasks' list above.",
      "- Do not build the whole product at once.",
      "- Never implement anything under 'Do not do' below.",
      "- Before coding, explore the relevant files and write a short implementation plan.",
      "- If there is an existing codebase, follow its patterns.",
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
      "- Check directly against each item's done-criteria (items.md).",
      "- Confirm items not included were left unchanged.",
      "- Confirm no out-of-scope features were added.",
      "- Confirm the still-open decisions (product.md) did not leak into the implementation.",
      "",
      "## Final response format",
      "",
      beginnerSetupGuidance(specTextOf(spec, effectiveItems), profile, "en"),
      "",
      NONDEV_WORKFLOW_GUIDANCE_EN,
      "",
      DEPLOY_VIA_MCP_GUIDANCE_EN,
      "",
      RETURN_TO_SIMSA_GUIDANCE_EN,
      "",
      "When done, report in this format:",
      "",
      "```",
      "Completed items:",
      "- [item]",
      "",
      "Changed files:",
      "- [file]",
      "",
      "Tests run:",
      "- [test]",
      "",
      "Remaining risks:",
      "- [risk, or none]",
      "```",
    ].join("\n");
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
    ONE_SHOT_RUNBOOK,
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
    ...(services.length > 0 ? ["", genServicesContext(services)] : []),
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
    beginnerSetupGuidance(specTextOf(spec, effectiveItems), profile),
    "",
    NONDEV_WORKFLOW_GUIDANCE,
    "",
    DEPLOY_VIA_MCP_GUIDANCE,
    "",
    RETURN_TO_SIMSA_GUIDANCE,
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

/**
 * D10 (P1, 2026-07-17 target-fit eval): the prompt for chat-driven WEB BUILDERS
 * (Lovable / Replit / v0 / Bolt). These have no file tree the agent can read, no
 * terminal, no `.env.local`, no git — so unlike the Claude Code/Codex prompts
 * this one is FULLY SELF-CONTAINED (spec + items + criteria inlined), secrets go
 * in the builder's own settings/Secrets UI, and deploy is the builder's Publish
 * button. The eval measured the old CLI-shaped instructions as unusable in
 * these environments (10/10 packs assumed .env.local/터미널/MCP).
 */
function genWebBuilderPrompt(
  title: string,
  spec: ExportProductSpec,
  effectiveItems: ExportItem[],
  totalItems: number,
  services: BuilderPackService[] = [],
  locale: PackLocale = "ko",
): string {
  const isFiltered = effectiveItems.length < totalItems;

  if (locale === "en") {
    const itemBlocks: string[] = [];
    for (const item of effectiveItems) {
      itemBlocks.push(`### ${item.title}`);
      if (item.criteria.length > 0) {
        itemBlocks.push("Done when:", ...item.criteria.map((c) => `- [ ] ${c}`));
      }
      itemBlocks.push("");
    }

    const serviceLines: string[] = [];
    if (services.length > 0) {
      serviceLines.push(
        "",
        "## External services and keys needed",
        "",
        "The keys below are needed. **Never paste the actual key values into this chat** — have the user put them into this builder's environment-variable/Secrets settings screen (e.g. Replit `Secrets`, Lovable project settings) and read them from environment variables in code. Guide key issuance one step at a time: signup URL → where the key is → where to paste it.",
        "",
      );
      for (const svc of services) {
        serviceLines.push(`### ${svc.label}`);
        if (svc.setupUrl) serviceLines.push(`- Signup/setup: ${svc.setupUrl}`);
        for (const v of svc.envVars) {
          const secret = v.secret ? " · **server-only — never in frontend code**" : "";
          serviceLines.push(`- \`${v.key}\` — ${v.description}${secret}`);
        }
        serviceLines.push("");
      }
    }

    return [
      `# Brief for a web builder — ${title}`,
      "",
      "Paste the contents of this file into the chat of a web builder like Lovable, Replit, v0, or Bolt.",
      "",
      isFiltered
        ? `> **Items to build this time: ${effectiveItems.length}** (of ${totalItems} total) — do not build items that are not included.`
        : `> Items to build this time: ${effectiveItems.length} (all)`,
      "",
      "---",
      "",
      "## Mission — this one brief, all the way",
      "",
      "The user is not a developer. From this brief alone, deliver **an app that genuinely works and is published on the internet, URL included**. Don't quiz the user on development choices (file structure, tech picks) — decide yourself. Ask the user for exactly two things: issuing external service keys (step by step, per the guidance below) and pressing this builder's **Publish/Deploy button**.",
      "",
      "1. Read the product description and items below and make a short plan.",
      "2. Build only the items included this time — never build the 'excluded' list.",
      "3. If external services are needed, guide key issuance one step at a time and have the values go into this builder's **environment-variable/Secrets settings** (never exposed in chat or code).",
      "4. Self-check each item's done-criteria in the preview, and fix what fails until it works.",
      "5. Guide the user to publish with this builder's **Publish/Deploy feature**, and confirm the resulting URL.",
      "6. Guide them to put that URL back into Simsa for review.",
      "",
      "## Product description",
      "",
      `**${spec.productName}** — ${spec.oneLine}`,
      "",
      `Problem being solved: ${spec.problem}`,
      `Target users: ${spec.targetUsers.join(", ") || "general users"}`,
      "",
      "Included in this version:",
      ...spec.included.map((i) => `- ${i}`),
      "",
      "Excluded from this version (never build these):",
      ...(spec.excluded.length > 0 ? spec.excluded.map((e) => `- ${e}`) : ["- (none)"]),
      "",
      "User flow:",
      ...spec.userFlow.map((f, i) => `${i + 1}. ${f}`),
      "",
      "## Items to build and their done-criteria",
      "",
      ...itemBlocks,
      ...serviceLines,
      "## How to proceed — non-developer first",
      "",
      "- Report progress without dev jargon: only \"what I'm building now, and what's needed next\".",
      "- If the user gets stuck, ask \"what do you see on your screen right now?\" and adjust the next step.",
      "- The ending is always \"a published URL + one next action\" — never a menu of tech choices.",
      "",
      RETURN_TO_SIMSA_GUIDANCE_EN,
    ].join("\n");
  }

  const itemBlocks: string[] = [];
  for (const item of effectiveItems) {
    itemBlocks.push(`### ${item.title}`);
    if (item.criteria.length > 0) {
      itemBlocks.push("완성 기준:", ...item.criteria.map((c) => `- [ ] ${c}`));
    }
    itemBlocks.push("");
  }

  const serviceLines: string[] = [];
  if (services.length > 0) {
    serviceLines.push(
      "",
      "## 필요한 외부 서비스와 키",
      "",
      "아래 키들이 필요하다. **실제 키 값은 이 채팅에 절대 붙이지 말고**, 이 빌더의 환경변수/Secrets 설정 화면(예: Replit `Secrets`, Lovable 프로젝트 설정)에 사용자가 직접 넣게 한 뒤 코드에서는 환경변수로만 읽어라. 발급 방법은 사용자에게 '가입 URL → 키 위치 → 붙여넣을 곳' 순서로 한 단계씩 안내한다.",
      "",
    );
    for (const svc of services) {
      serviceLines.push(`### ${svc.label}`);
      if (svc.setupUrl) serviceLines.push(`- 가입·설정: ${svc.setupUrl}`);
      for (const v of svc.envVars) {
        const secret = v.secret ? " · **서버 전용 — 화면 코드에 넣지 말 것**" : "";
        serviceLines.push(`- \`${v.key}\` — ${v.description}${secret}`);
      }
      serviceLines.push("");
    }
  }

  return [
    `# 웹 빌더용 지시서 — ${title}`,
    "",
    "이 파일 내용을 Lovable, Replit, v0, Bolt 같은 웹 빌더의 채팅창에 그대로 붙여넣으세요.",
    "",
    isFiltered
      ? `> **이번에 만들 항목: ${effectiveItems.length}개** (전체 ${totalItems}개 중) — 포함되지 않은 항목은 만들지 마세요.`
      : `> 이번에 만들 항목: ${effectiveItems.length}개 (전체)`,
    "",
    "---",
    "",
    "## 임무 — 이 지시 하나로 끝까지",
    "",
    "사용자는 개발자가 아니다. 이 지시서만으로 **실제로 작동하고, 인터넷에 게시된 앱과 그 주소(URL)**까지 만들어 사용자 손에 쥐여줘라. 개발 절차(파일 구조, 기술 선택)를 사용자에게 되묻지 말고 네가 정하라. 사용자에게 부탁할 것은 딱 두 가지 — 외부 서비스 키 발급(아래 안내대로 한 단계씩)과 이 빌더의 **게시(Publish/Deploy) 버튼 누르기**뿐이다.",
    "",
    "1. 아래 제품 설명과 항목을 읽고 짧은 계획을 세운다.",
    "2. 이번에 만들 항목만 구현한다 — '제외' 목록은 절대 만들지 않는다.",
    "3. 외부 서비스가 필요하면 키 발급을 한 단계씩 안내하고, 값은 이 빌더의 **환경변수/Secrets 설정 화면**에 넣게 한다(채팅·코드에 값 노출 금지).",
    "4. 미리보기로 각 항목의 완성 기준을 스스로 점검하고, 안 되는 부분은 될 때까지 고친다.",
    "5. 이 빌더의 **게시(Publish/Deploy) 기능**으로 인터넷에 올리게 안내하고, 나온 URL을 확인한다.",
    "6. 그 URL을 Simsa에 다시 넣어 검수받으라고 안내한다.",
    "",
    "## 제품 설명",
    "",
    `**${spec.productName}** — ${spec.oneLine}`,
    "",
    `해결하려는 문제: ${spec.problem}`,
    `대상 사용자: ${spec.targetUsers.join(", ") || "일반 사용자"}`,
    "",
    "이번 버전에 포함:",
    ...spec.included.map((i) => `- ${i}`),
    "",
    "이번 버전에서 제외 (절대 만들지 말 것):",
    ...(spec.excluded.length > 0 ? spec.excluded.map((e) => `- ${e}`) : ["- (없음)"]),
    "",
    "사용자 흐름:",
    ...spec.userFlow.map((f, i) => `${i + 1}. ${f}`),
    "",
    "## 만들 항목과 완성 기준",
    "",
    ...itemBlocks,
    ...serviceLines,
    "## 진행 방식 — 비개발자 우선",
    "",
    "- 진행 상황은 개발 용어 없이 '지금 무엇을 만들고 있고, 다음에 무엇이 필요한지'로만 알린다.",
    "- 사용자가 막히면 \"지금 화면에 뭐가 보이세요?\"라고 묻고 다음 단계를 맞춘다.",
    "- 끝은 언제나 '게시된 URL + 다음 한 가지 행동'이다. 기술 선택 메뉴로 끝내지 마라.",
    "",
    RETURN_TO_SIMSA_GUIDANCE,
  ].join("\n");
}

/**
 * #296 Phase 4-lite: the handoff brief — what you give a human (an outside
 * developer, a team, a native-app shop) so they build the RIGHT thing. The
 * PISTA failure was handing a web-assuming pack to a Kotlin project; this
 * document states the platform verdict honestly, separates decided from
 * undecided, marks what is outside Simsa's web-review scope, and carries the
 * acceptance checklist in the user's own language.
 */
const HANDOFF_KIND_LABEL: Record<string, string> = {
  mobile: "휴대폰 네이티브 앱 (iOS/Android)",
  desktop: "데스크톱 설치형 프로그램",
  game: "3D·게임엔진 게임",
  hardware: "하드웨어·기기 연동",
  extension: "브라우저 확장 프로그램",
};

const HANDOFF_KIND_LABEL_EN: Record<string, string> = {
  mobile: "a native mobile app (iOS/Android)",
  desktop: "an installable desktop program",
  game: "a 3D/game-engine game",
  hardware: "hardware/device integration",
  extension: "a browser extension",
};

function genHandoffBrief(
  title: string,
  idea: string,
  spec: ExportProductSpec,
  items: ExportItem[],
  checkResults?: ExportCheckResults,
  profile?: ExportUserProfile,
  locale: PackLocale = "ko",
): string {
  // #296 Phase 4: the interview's platform answer seeds the verdict here too —
  // the brief must not contradict what generation already told the user (P2).
  const feas = detectNonWebBuildable({
    idea: `${idea} ${spec.oneLine} ${spec.included.join(" ")}`,
    ...(profile?.platform ? { platform: profile.platform } : {}),
  });
  if (locale === "en") {
    const lines: string[] = [
      `# Handoff brief — ${title}`,
      "",
      "This document exists to **hand this product to a developer or a specialist team**. Send or print it as-is. If the recipient uses an AI coding tool, this whole document can be pasted in.",
      "",
      "## What to build",
      "",
      `**${spec.productName}** — ${spec.oneLine}`,
      "",
      `Problem being solved: ${spec.problem}`,
      `Target users: ${spec.targetUsers.join(", ") || "general users"}`,
    ];

    if (feas.hit) {
      const label = HANDOFF_KIND_LABEL_EN[feas.kind] ?? feas.kind;
      lines.push(
        "",
        "## Target platform (important — an honest verdict)",
        "",
        `This product requires building **${label}**. It cannot be fully implemented as a web app alone.`,
        `- The web-feasible parts (admin screens, landing, prototype) can proceed right away from the material Simsa produced.`,
        `- Building **${label}** itself (native build, store release, …) **belongs to the professional team receiving this document**, and is outside Simsa's web-review scope.`,
      );
    } else {
      lines.push(
        "",
        "## Target platform",
        "",
        "This product can be built as a **web app**. No specific stack is imposed — as long as the requirements below are met, the recipient chooses the stack.",
      );
    }

    lines.push("", "## Decided", "");
    const decided = [...spec.decisions, ...spec.included.map((i) => `Included: ${i}`)];
    lines.push(...(decided.length ? decided.map((d) => `- ${d}`) : ["- (none yet)"]));

    lines.push("", "## Excluded from this version (do not build)", "");
    lines.push(...(spec.excluded.length ? spec.excluded.map((e) => `- ${e}`) : ["- (none)"]));

    lines.push("", "## Still to decide (confirm with the owner before starting)", "");
    lines.push(...(spec.openQuestions.length ? spec.openQuestions.map((q) => `- [ ] ${q}`) : ["- (none)"]));

    if (checkResults && checkResults.results.length > 0) {
      const s = checkResults.summary;
      lines.push(
        "",
        "## Latest check results (Simsa review)",
        "",
        `Passed ${s.passed} · Doesn't match ${s.failed} · Needs checking ${s.inconclusive} · Decision needed ${s.needsDecision}`,
        "",
      );
      const notPassed = checkResults.results.filter((r) => r.status !== "passed");
      if (notPassed.length > 0) {
        lines.push("Problems still open at handoff time:", "");
        for (const r of notPassed) {
          const next = r.nextAction ? ` (next action: ${r.nextAction})` : "";
          lines.push(`- **${r.title}** — ${statusLabel(r.status, "en")}: ${r.reason}${next}`);
        }
      } else {
        lines.push("All checked items passed as of handoff time.");
      }
      lines.push("", "These results are a snapshot at handoff time. The recipient should do the final check against the acceptance checklist below.");
    }

    lines.push("", "## Acceptance checklist (done when all of this holds)", "");
    for (const item of items) {
      lines.push(`### ${item.title}`);
      for (const c of item.criteria) lines.push(`- [ ] ${c}`);
      if (item.criteria.length === 0) lines.push("- [ ] (criteria not written — define with the owner)");
      lines.push("");
    }

    lines.push(
      "## User flow",
      "",
      ...spec.userFlow.map((f, i) => `${i + 1}. ${f.replace(/^\s*\d+[.)]\s*/, "")}`),
      "",
      "---",
      "",
      "This brief was produced by Simsa from the user's idea. Once built, the web-accessible parts can be reviewed by putting the URL into Simsa.",
    );
    return lines.join("\n");
  }
  const lines: string[] = [
    `# 전달용 브리프 — ${title}`,
    "",
    "이 문서는 이 제품을 **개발자·전문팀에게 전달**하기 위한 자료입니다. 그대로 보내거나 인쇄해서 쓰세요. 받는 사람이 AI 코딩 도구를 쓴다면 이 문서를 통째로 붙여넣어도 됩니다.",
    "",
    "## 무엇을 만들어야 하나",
    "",
    `**${spec.productName}** — ${spec.oneLine}`,
    "",
    `해결하려는 문제: ${spec.problem}`,
    `대상 사용자: ${spec.targetUsers.join(", ") || "일반 사용자"}`,
  ];

  if (feas.hit) {
    const label = HANDOFF_KIND_LABEL[feas.kind] ?? feas.kind;
    lines.push(
      "",
      "## 대상 플랫폼 (중요 — 정직한 판정)",
      "",
      `이 제품은 **${label}** 개발이 필요합니다. 웹앱만으로는 완전히 구현할 수 없습니다.`,
      `- 웹으로 되는 부분(관리 화면·랜딩·프로토타입)은 Simsa가 만든 자료로 바로 진행할 수 있습니다.`,
      `- ${label} 자체(네이티브 빌드·스토어 출시 등)는 **이 문서를 받은 전문 개발이 담당**해야 하며, Simsa의 웹 검수 범위 밖입니다.`,
    );
  } else {
    lines.push(
      "",
      "## 대상 플랫폼",
      "",
      "이 제품은 **웹앱**으로 구현 가능합니다. 특정 기술을 강요하지 않습니다 — 아래 요구사항을 만족하면 스택은 받는 분이 선택하세요.",
    );
  }

  lines.push("", "## 결정된 것", "");
  const decided = [...spec.decisions, ...spec.included.map((i) => `포함: ${i}`)];
  lines.push(...(decided.length ? decided.map((d) => `- ${d}`) : ["- (아직 없음)"]));

  lines.push("", "## 이번 버전에서 제외 (만들지 말 것)", "");
  lines.push(...(spec.excluded.length ? spec.excluded.map((e) => `- ${e}`) : ["- (없음)"]));

  lines.push("", "## 아직 결정 필요 (시작 전에 발주자와 확인)", "");
  lines.push(...(spec.openQuestions.length ? spec.openQuestions.map((q) => `- [ ] ${q}`) : ["- (없음)"]));

  // #296 Phase 4: inspection report — what Simsa's review already found, in
  // plain language, so the recipient starts from known problems instead of
  // rediscovering them. Omitted cleanly when no check has run.
  if (checkResults && checkResults.results.length > 0) {
    const s = checkResults.summary;
    lines.push(
      "",
      "## 최근 점검 결과 (Simsa 검수)",
      "",
      `통과 ${s.passed} · 안 맞음 ${s.failed} · 확인 부족 ${s.inconclusive} · 결정 필요 ${s.needsDecision}`,
      "",
    );
    const notPassed = checkResults.results.filter((r) => r.status !== "passed");
    if (notPassed.length > 0) {
      lines.push("전달 시점에 남아 있던 문제:", "");
      for (const r of notPassed) {
        const next = r.nextAction ? ` (다음 할 일: ${r.nextAction})` : "";
        lines.push(`- **${r.title}** — ${statusLabel(r.status)}: ${r.reason}${next}`);
      }
    } else {
      lines.push("전달 시점 기준 모든 점검 항목이 통과했습니다.");
    }
    lines.push("", "이 결과는 전달 시점의 스냅샷입니다. 받은 분은 아래 수용 기준 체크리스트로 최종 확인해주세요.");
  }

  lines.push("", "## 수용 기준 체크리스트 (이대로 되면 완성)", "");
  for (const item of items) {
    lines.push(`### ${item.title}`);
    for (const c of item.criteria) lines.push(`- [ ] ${c}`);
    if (item.criteria.length === 0) lines.push("- [ ] (기준 미작성 — 발주자와 정의 필요)");
    lines.push("");
  }

  lines.push(
    "## 사용자 흐름",
    "",
    ...spec.userFlow.map((f, i) => `${i + 1}. ${f.replace(/^\s*\d+[.)]\s*/, "")}`),
    "",
    "---",
    "",
    "이 브리프는 Simsa(심사)가 사용자의 아이디어에서 만든 것입니다. 완성 후 웹으로 접근 가능한 부분은 Simsa에 주소를 넣어 검수받을 수 있습니다.",
  );
  return lines.join("\n");
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

// ─── Prep layer: .env + SETUP.md generation ──────────────────────────────────

/** `.env.example` — every key with a PLACEHOLDER only. Never a real value, even
 *  when the setup UI supplied one. Safe to commit. */
function genEnvExample(services: BuilderPackService[], locale: PackLocale = "ko"): string {
  const lines: string[] =
    locale === "en"
      ? [
          "# Environment variable examples — safe to commit (no real values).",
          "# Put real values in .env.local (never commit that).",
        ]
      : [
          "# 환경변수 예시 — 이 파일은 커밋해도 안전합니다(실제 값 없음).",
          "# 실제 값은 .env.local 에 넣으세요(커밋 금지).",
        ];
  for (const svc of services) {
    lines.push("", `# ${svc.label}`);
    for (const v of svc.envVars) {
      const note = v.secret
        ? locale === "en"
          ? ` (server-only · never put this in frontend/browser code)`
          : ` (서버 전용 · 절대 프론트엔드/브라우저에 넣지 마세요)`
        : "";
      lines.push(`# ${v.description}${note}`);
      lines.push(`${v.key}=${v.example ?? ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** `.env.local` — real values the setup UI collected. Returns null when NO value
 *  was supplied (so an empty secret file is never emitted). Gitignored; loud
 *  never-commit/never-share warning at the top. */
function genEnvLocal(services: BuilderPackService[], locale: PackLocale = "ko"): string | null {
  const withValue = services.flatMap((s) => s.envVars.filter((v) => typeof v.value === "string" && v.value.length > 0));
  if (withValue.length === 0) return null;
  const lines: string[] =
    locale === "en"
      ? [
          "# WARNING: real secret values. Never commit or share this file.",
          "# It must be in .gitignore; admin keys like service_role are server-only.",
        ]
      : [
          "# 주의: 실제 비밀 값입니다. 절대 커밋하거나 공유하지 마세요.",
          "# 이 파일은 .gitignore 에 포함되어야 하며, service_role 같은 관리자 키는 서버에서만 사용하세요.",
        ];
  for (const svc of services) {
    const vals = svc.envVars.filter((v) => typeof v.value === "string" && v.value.length > 0);
    if (vals.length === 0) continue;
    lines.push("", `# ${svc.label}`);
    for (const v of vals) lines.push(`${v.key}=${v.value}`);
  }
  return lines.join("\n") + "\n";
}

/** `SETUP.md` — human guide: what each service is, exactly where to get each key,
 *  where the value goes, with security warnings. Reuses the beginner hand-holding
 *  style so the agent/user can finish anything the UI didn't pre-fill. */
function genSetupMd(services: BuilderPackService[], hasValues: boolean, locale: PackLocale = "ko"): string {
  if (locale === "en") {
    const lines: string[] = [
      "# Service & environment variable setup",
      "",
      hasValues
        ? "The values you entered in Simsa are already filled into `.env.local`. Below is what each value is, where it came from, and how to fill in anything still missing."
        : "This app needs the services below. Follow each section's guidance to sign up, issue keys, and put them in `.env.local`.",
      "",
      "> **Security:** never commit or share `.env.local` (keep it in .gitignore). Admin keys like `service_role` are **server-only** — never in frontend/browser code.",
    ];
    for (const svc of services) {
      lines.push("", `## ${svc.label}`);
      if (svc.setupUrl) lines.push("", `- Signup/setup: ${svc.setupUrl}`);
      for (const step of svc.setupSteps ?? []) lines.push(`- ${step}`);
      lines.push("", "Values needed:");
      for (const v of svc.envVars) {
        const filled = typeof v.value === "string" && v.value.length > 0 ? " — [filled · .env.local]" : "";
        const secret = v.secret ? " · **server-only, never frontend**" : "";
        lines.push(`- \`${v.key}\` — ${v.description}${secret}${filled}`);
      }
    }
    return lines.join("\n");
  }
  const lines: string[] = [
    "# 서비스·환경변수 설정",
    "",
    hasValues
      ? "Simsa에서 입력하신 값은 `.env.local` 에 이미 채워져 있습니다. 아래는 각 값이 무엇이고 어디서 온 것인지, 그리고 채우지 못한 것을 마저 채우는 방법입니다."
      : "이 앱은 아래 서비스가 필요합니다. 각 항목의 안내대로 가입·키 발급 후 `.env.local` 에 넣으세요.",
    "",
    "> **보안:** `.env.local` 은 절대 커밋하거나 공유하지 마세요(.gitignore 포함). `service_role` 같은 관리자 키는 **서버에서만** 쓰고 프론트엔드/브라우저에 넣지 마세요.",
  ];
  for (const svc of services) {
    lines.push("", `## ${svc.label}`);
    if (svc.setupUrl) lines.push("", `- 가입·설정: ${svc.setupUrl}`);
    for (const step of svc.setupSteps ?? []) lines.push(`- ${step}`);
    lines.push("", "필요한 값:");
    for (const v of svc.envVars) {
      const filled = typeof v.value === "string" && v.value.length > 0 ? " — [입력됨 · .env.local]" : "";
      const secret = v.secret ? " · **서버 전용, 프론트 금지**" : "";
      lines.push(`- \`${v.key}\` — ${v.description}${secret}${filled}`);
    }
  }
  return lines.join("\n");
}

// ─── Main export function ─────────────────────────────────────────────────────

export function generateBuilderPack(
  req: WorkspaceExportBuilderPackRequest,
): WorkspaceExportBuilderPackResponse {
  const project = req.project;
  // G14-b: the pack follows the user's UI language (absent → ko, unchanged).
  const locale: PackLocale = req.locale === "en" ? "en" : "ko";
  if (!project) {
    return {
      ok: true,
      source: "deterministic",
      bundle: { files: [] },
      summary: {
        fileCount: 0,
        totalItems: 0,
        selectedItems: 0,
        recommendedNextStep:
          locale === "en" ? "Please retry with the project data included." : "project 데이터를 포함해서 다시 요청해주세요.",
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
      path: "simsa-build-pack/README.md",
      content: genReadme(title, target, allItems.length, effectiveItems.length, locale) + hookSuffix,
    },
    {
      path: "simsa-build-pack/product.md",
      content: genProductMd(productSpec, locale), // always full context
    },
    {
      path: "simsa-build-pack/items.md",
      content: genItemsMd(effectiveItems, allItems.length, locale),
    },
    {
      path: "simsa-build-pack/checks.md",
      content: genChecksMd(effectiveCheckResults, allItems.length, locale),
    },
    {
      path: "simsa-build-pack/fixes.md",
      content: genFixesMd(effectiveItems, effectiveFixSuggestions, locale),
    },
  ];

  // ── Prep layer: env + setup files (only when the setup UI provided services) ─
  const services = req.services ?? [];
  if (services.length > 0) {
    baseFiles.push({
      path: "simsa-build-pack/.env.example",
      content: genEnvExample(services, locale),
    });
    const envLocal = genEnvLocal(services, locale);
    if (envLocal) {
      baseFiles.push({ path: "simsa-build-pack/.env.local", content: envLocal });
    }
    baseFiles.push({
      path: "simsa-build-pack/SETUP.md",
      content: genSetupMd(services, envLocal !== null, locale),
    });
  }

  if (target === "claude_code" || target === "both") {
    baseFiles.push({
      path: "simsa-build-pack/CLAUDE_CODE_PROMPT.md",
      content: genClaudeCodePrompt(title, productSpec, effectiveItems, allItems.length, services, req.userProfile, locale) + hookSuffix,
    });
  }
  if (target === "codex" || target === "both") {
    baseFiles.push({
      path: "simsa-build-pack/CODEX_PROMPT.md",
      content:
        genCodexPrompt(title, productSpec, effectiveItems, allItems.length, effectiveFixSuggestions, services, req.userProfile, locale) +
        hookSuffix,
    });
  }
  if (target === "web_builder") {
    baseFiles.push({
      path: "simsa-build-pack/WEB_BUILDER_PROMPT.md",
      content:
        genWebBuilderPrompt(title, productSpec, effectiveItems, allItems.length, services, locale) + hookSuffix,
    });
  }
  if (target === "handoff") {
    baseFiles.push({
      path: "simsa-build-pack/HANDOFF_BRIEF.md",
      content: genHandoffBrief(title, project.idea ?? "", productSpec, effectiveItems, effectiveCheckResults, req.userProfile, locale),
    });
  }

  const hasIssues =
    effectiveCheckResults &&
    (effectiveCheckResults.summary.failed > 0 ||
      effectiveCheckResults.summary.inconclusive > 0 ||
      effectiveCheckResults.summary.needsDecision > 0);

  const recommendedNextStep =
    locale === "en"
      ? hasIssues
        ? "Check the items to fix in fixes.md, then hand the matching brief to your coding AI."
        : target === "web_builder"
          ? "Copy WEB_BUILDER_PROMPT.md and paste it into your web builder's chat (Lovable, Replit, v0, Bolt, …)."
          : target === "handoff"
            ? "Send HANDOFF_BRIEF.md to your developer or team as-is."
            : "Copy CLAUDE_CODE_PROMPT.md or CODEX_PROMPT.md and paste it into your coding AI."
      : hasIssues
        ? "fixes.md에서 고쳐야 할 항목을 확인하고, 해당 지시서를 개발 AI에 넘기세요."
        : target === "web_builder"
          ? "WEB_BUILDER_PROMPT.md를 복사해서 사용 중인 웹 빌더(Lovable·Replit·v0·Bolt 등)의 채팅창에 붙여넣으세요."
          : target === "handoff"
            ? "HANDOFF_BRIEF.md를 개발자·전문팀에게 그대로 전달하세요."
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

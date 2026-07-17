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

// ─── Types ────────────────────────────────────────────────────────────────────

/** "web_builder" (D10, 2026-07-17): one shared prompt for chat-driven web
 *  builders (Lovable / Replit / v0 / Bolt) — no file tree, no terminal, no git;
 *  secrets go in the builder's own settings UI and deploy is its Publish
 *  button. "both" keeps its original meaning (claude_code + codex). */
export type ExportTarget = "claude_code" | "codex" | "both" | "web_builder";
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
    target === "web_builder"
      ? "이 패키지는 Simsa에서 내보낸 제품 설명서와 개발 지시서입니다. 웹 빌더(Lovable·Replit·v0·Bolt 등)의 채팅창에 지시서를 붙여넣으면 구현부터 게시(Publish)까지 빌더 안에서 진행됩니다 — 별도 설치나 터미널이 필요 없습니다."
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

/**
 * Beginner hand-holding directive shared by both agent prompts. The end user may
 * be a complete non-developer, so the building agent must never say "set this up
 * yourself" for external services / API keys / env vars — it walks them through
 * signup URLs and exact click-paths, one step at a time. Korean, matching the
 * surrounding prompt and the KO-first audience.
 */
function beginnerSetupGuidance(specText: string): string {
  return [
    "## 사용자 안내 원칙 — 완전 초보자 가정",
    "",
    "이 프로젝트의 사용자는 개발 경험이 전혀 없는 비개발자일 수 있다. 외부 서비스(데이터베이스·호스팅·인증·결제 등)나 API 키, 환경변수, 터미널 명령이 필요한 순간에는 절대 \"알아서 준비하세요\"라고 넘기지 말고, 다음처럼 손을 잡고 안내하라:",
    "",
    "- 왜 필요한지 한 문장으로 쉽게 설명한다. (예: \"데이터를 저장하려면 무료 데이터베이스가 필요해요.\")",
    "- 가입·설정 URL을 전체 주소 그대로 준다.",
    "- 화면에서 **어디를 눌러야 하는지 단계별로, 한 번에 하나씩** 안내한다. 전문용어(API 키, 환경변수, .env 등)는 그때그때 한 줄로 풀어 설명한다.",
    "- 복사한 값을 **어디에 붙여넣는지(예: `.env` 파일의 어떤 줄)**까지 알려주고, 사용자가 \"했어요\"라고 확인하면 다음 단계로 넘어간다.",
    "- 키·비밀번호는 절대 코드나 로그에 하드코딩하지 말고 환경변수로만 안내한다.",
    "- 사용자가 막히면 \"지금 화면에 뭐가 보이세요?\"라고 묻거나 스크린샷을 요청해 다음 단계를 맞춘다.",
    "",
    "자주 쓰는 서비스 예시 — 이 제품에 필요한 것 기준 (UI가 바뀌었으면 현재 화면에 맞게 조정하되, 이 정도로 상세하게):",
    "",
    // D12: base + need-matched walkthroughs + the D11 deploy-path chooser.
    ...pickServiceExampleBlocks(specText),
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
function genServicesContext(services: BuilderPackService[]): string {
  if (services.length === 0) return "";
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
    beginnerSetupGuidance(specTextOf(spec, effectiveItems)),
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
    beginnerSetupGuidance(specTextOf(spec, effectiveItems)),
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
): string {
  const isFiltered = effectiveItems.length < totalItems;

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
function genEnvExample(services: BuilderPackService[]): string {
  const lines: string[] = [
    "# 환경변수 예시 — 이 파일은 커밋해도 안전합니다(실제 값 없음).",
    "# 실제 값은 .env.local 에 넣으세요(커밋 금지).",
  ];
  for (const svc of services) {
    lines.push("", `# ${svc.label}`);
    for (const v of svc.envVars) {
      const note = v.secret ? ` (서버 전용 · 절대 프론트엔드/브라우저에 넣지 마세요)` : "";
      lines.push(`# ${v.description}${note}`);
      lines.push(`${v.key}=${v.example ?? ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** `.env.local` — real values the setup UI collected. Returns null when NO value
 *  was supplied (so an empty secret file is never emitted). Gitignored; loud
 *  never-commit/never-share warning at the top. */
function genEnvLocal(services: BuilderPackService[]): string | null {
  const withValue = services.flatMap((s) => s.envVars.filter((v) => typeof v.value === "string" && v.value.length > 0));
  if (withValue.length === 0) return null;
  const lines: string[] = [
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
function genSetupMd(services: BuilderPackService[], hasValues: boolean): string {
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
      path: "simsa-build-pack/README.md",
      content: genReadme(title, target, allItems.length, effectiveItems.length) + hookSuffix,
    },
    {
      path: "simsa-build-pack/product.md",
      content: genProductMd(productSpec), // always full context
    },
    {
      path: "simsa-build-pack/items.md",
      content: genItemsMd(effectiveItems, allItems.length),
    },
    {
      path: "simsa-build-pack/checks.md",
      content: genChecksMd(effectiveCheckResults, allItems.length),
    },
    {
      path: "simsa-build-pack/fixes.md",
      content: genFixesMd(effectiveItems, effectiveFixSuggestions),
    },
  ];

  // ── Prep layer: env + setup files (only when the setup UI provided services) ─
  const services = req.services ?? [];
  if (services.length > 0) {
    baseFiles.push({
      path: "simsa-build-pack/.env.example",
      content: genEnvExample(services),
    });
    const envLocal = genEnvLocal(services);
    if (envLocal) {
      baseFiles.push({ path: "simsa-build-pack/.env.local", content: envLocal });
    }
    baseFiles.push({
      path: "simsa-build-pack/SETUP.md",
      content: genSetupMd(services, envLocal !== null),
    });
  }

  if (target === "claude_code" || target === "both") {
    baseFiles.push({
      path: "simsa-build-pack/CLAUDE_CODE_PROMPT.md",
      content: genClaudeCodePrompt(title, productSpec, effectiveItems, allItems.length, services) + hookSuffix,
    });
  }
  if (target === "codex" || target === "both") {
    baseFiles.push({
      path: "simsa-build-pack/CODEX_PROMPT.md",
      content:
        genCodexPrompt(title, productSpec, effectiveItems, allItems.length, effectiveFixSuggestions, services) +
        hookSuffix,
    });
  }
  if (target === "web_builder") {
    baseFiles.push({
      path: "simsa-build-pack/WEB_BUILDER_PROMPT.md",
      content:
        genWebBuilderPrompt(title, productSpec, effectiveItems, allItems.length, services) + hookSuffix,
    });
  }

  const hasIssues =
    effectiveCheckResults &&
    (effectiveCheckResults.summary.failed > 0 ||
      effectiveCheckResults.summary.inconclusive > 0 ||
      effectiveCheckResults.summary.needsDecision > 0);

  const recommendedNextStep = hasIssues
    ? "fixes.md에서 고쳐야 할 항목을 확인하고, 해당 지시서를 개발 AI에 넘기세요."
    : target === "web_builder"
      ? "WEB_BUILDER_PROMPT.md를 복사해서 사용 중인 웹 빌더(Lovable·Replit·v0·Bolt 등)의 채팅창에 붙여넣으세요."
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

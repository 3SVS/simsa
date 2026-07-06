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

/**
 * Beginner hand-holding directive shared by both agent prompts. The end user may
 * be a complete non-developer, so the building agent must never say "set this up
 * yourself" for external services / API keys / env vars — it walks them through
 * signup URLs and exact click-paths, one step at a time. Korean, matching the
 * surrounding prompt and the KO-first audience.
 */
const BEGINNER_SETUP_GUIDANCE: string = [
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
  "자주 쓰는 서비스 예시 (UI가 바뀌었으면 현재 화면에 맞게 조정하되, 이 정도로 상세하게):",
  "",
  "- **Supabase (데이터베이스)**: https://supabase.com 가입 → `New project` 생성 → 왼쪽 하단 `Project Settings`(톱니바퀴) → `API` → `Project URL`과 `anon public` 키를 복사. 관리자 키가 필요하면 `API Keys` 탭 → `service_role` → `Reveal` 클릭 → 복사. **`service_role` 키는 관리자용이라 절대 프론트엔드/브라우저에 넣지 말라고 사용자에게 경고**하고, 서버 환경변수로만 쓰게 한다.",
  "- **Vercel (배포)**: https://vercel.com 에 GitHub 계정으로 로그인 → `Add New → Project` → 저장소 선택 → `Environment Variables`에 위에서 복사한 키를 이름 그대로 추가 → `Deploy`. 배포가 끝나면 나오는 URL을 사용자에게 그대로 알려준다.",
  "- 그 외 서비스(이메일·결제 등)도 같은 순서로: **가입 URL → 키를 찾는 정확한 위치 → 붙여넣을 곳** 순으로 상세히 안내한다.",
  "",
  "**배포 대응(중요):** 앱이 스스로를 가리키는 주소 — 짧은 링크의 앞부분, 공유 URL, 리다이렉트 대상, API 주소 등 — 를 절대 `http://localhost:3000` 같은 개발용 주소로 하드코딩하지 마라. 런타임 origin에서 가져와라(브라우저는 `window.location.origin`, 서버는 요청 host 또는 `NEXT_PUBLIC_APP_URL` 같은 환경변수). 그래야 로컬에서도, 배포 후에도 주소가 자동으로 맞는다. 이걸 안 하면 배포했을 때 사용자에게 보이는 링크가 `localhost`로 깨진다.",
].join("\n");

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
    BEGINNER_SETUP_GUIDANCE,
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
    BEGINNER_SETUP_GUIDANCE,
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

  // ── Prep layer: env + setup files (only when the setup UI provided services) ─
  const services = req.services ?? [];
  if (services.length > 0) {
    baseFiles.push({
      path: "conclave-build-pack/.env.example",
      content: genEnvExample(services),
    });
    const envLocal = genEnvLocal(services);
    if (envLocal) {
      baseFiles.push({ path: "conclave-build-pack/.env.local", content: envLocal });
    }
    baseFiles.push({
      path: "conclave-build-pack/SETUP.md",
      content: genSetupMd(services, envLocal !== null),
    });
  }

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

/**
 * workspace/fix.ts
 *
 * Generates a fix suggestion for a workspace item that failed check.
 * Produces: plain summary + spec patch + builder brief (개발 AI에게 줄 지시서).
 * LLM failure → deterministic mock fallback.
 */
import { anthropicMessages, anthropicEndpoint } from "./anthropic-fetch.js";

export type WorkspaceFixSuggestionRequest = {
  projectId?: string;
  item: {
    id: string;
    title: string;
    status: "failed" | "inconclusive" | "needs_decision";
    criteria: string[];
  };
  checkResult: {
    reason: string;
    evidence: string[];
    nextAction: string;
  };
  productSpec: unknown;
  target?: "product_spec" | "builder_brief" | "both";
  locale?: "ko" | "en";
};

export type FixSuggestion = {
  plainSummary: string;
  productSpecPatch: {
    addDecisions: string[];
    addCriteria: string[];
    addOpenQuestions: string[];
    removeOrClarify?: string[];
  };
  builderBrief: {
    title: string;
    goal: string;
    context: string[];
    tasks: string[];
    doneWhen: string[];
    doNotDo: string[];
    verifyBy: string[];
  };
};

export type WorkspaceFixSuggestionResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  itemId: string;
  suggestion: FixSuggestion;
  warnings?: string[];
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildFixPrompt(req: WorkspaceFixSuggestionRequest): string {
  return `다음 항목에서 문제가 발견됐습니다. 수정 제안과 개발 AI에게 줄 지시서를 만들어주세요.

[문제 항목]
제목: ${req.item.title}
상태: ${req.item.status}
현재 완성 기준: ${req.item.criteria.join(", ") || "(없음)"}

[확인 결과]
이유: ${req.checkResult.reason}
근거: ${req.checkResult.evidence.join(", ") || "(없음)"}
다음 행동: ${req.checkResult.nextAction}

[제품 설명서 (요약)]
${JSON.stringify(req.productSpec, null, 2).slice(0, 800)}

작성 규칙:
- 모든 텍스트는 한국어
- PRD, Requirement, Acceptance Criteria 같은 개발자 용어 금지
- tasks는 구체적인 할 일 동사로 시작 (예: "추가한다", "수정한다", "제거한다")
- doneWhen은 확인 가능한 동작 기준 (예: "버튼 클릭 시 ~가 된다")
- doNotDo는 이번 수정에서 범위 밖인 것
- verifyBy는 기능 완성 여부를 확인할 방법

다음 JSON 형식으로만 응답:
{
  "plainSummary": "한국어 1~2줄 요약",
  "productSpecPatch": {
    "addDecisions": ["제품 설명서에 추가할 결정 사항"],
    "addCriteria": ["추가할 완성 기준"],
    "addOpenQuestions": ["아직 결정이 필요한 것 (있으면)"],
    "removeOrClarify": ["수정·삭제가 필요한 기존 내용 (있으면)"]
  },
  "builderBrief": {
    "title": "지시서 제목",
    "goal": "목표 1~2문장",
    "context": ["배경 설명 항목들"],
    "tasks": ["할 일 1", "할 일 2", "..."],
    "doneWhen": ["완료 기준 1", "완료 기준 2"],
    "doNotDo": ["하지 말 것 1", "하지 말 것 2"],
    "verifyBy": ["확인 방법 1", "확인 방법 2"]
  }
}`;
}

// ─── Anthropic call ───────────────────────────────────────────────────────────

async function callAnthropic(apiKey: string, prompt: string, baseUrl: string | undefined, timeoutMs = 20000): Promise<string> {
  const data = (await anthropicMessages(
    apiKey,
    { model: "claude-haiku-4-5-20251001", max_tokens: 3000, messages: [{ role: "user", content: prompt }] },
    timeoutMs,
    undefined,
    anthropicEndpoint(baseUrl),
  )) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

function buildMockFixFallback(req: WorkspaceFixSuggestionRequest): WorkspaceFixSuggestionResponse {
  const { item, checkResult } = req;
  const isFailedScope = item.status === "failed";
  const isVague = item.status === "inconclusive";
  const isDecision = item.status === "needs_decision";

  let plainSummary: string;
  let addDecisions: string[];
  let addCriteria: string[];
  let addOpenQuestions: string[];
  let tasks: string[];
  let doneWhen: string[];
  let doNotDo: string[];

  if (isFailedScope) {
    plainSummary = `이 항목(${item.title})은 현재 제품 설명서의 범위와 맞지 않습니다. 제품 설명서를 수정하거나 이 항목을 이번 버전에서 제외해야 합니다.`;
    addDecisions = [`${item.title} — 이번 버전 포함 여부 결정 필요`];
    addCriteria = [];
    addOpenQuestions = [`${item.title}을 이번 버전에 포함할지 다음 버전으로 미룰지 결정 필요`];
    tasks = [
      "제품 설명서의 포함/제외 범위를 다시 확인한다.",
      "이 항목을 포함하기로 했다면, 제품 설명서의 '포함 범위'에 추가한다.",
      "제외하기로 했다면, 이 항목을 삭제하거나 다음 버전 목록으로 옮긴다.",
    ];
    doneWhen = ["제품 설명서와 이 항목이 일치한다.", "포함/제외 결정이 기록됐다."];
    doNotDo = ["기능 자체를 바로 구현하지 말 것.", "범위를 결정하기 전에 코드를 작성하지 말 것."];
  } else if (isVague) {
    plainSummary = `이 항목(${item.title})은 완성 기준이 부족해서 실제로 구현됐는지 확인하기 어렵습니다. 구체적인 기준을 추가해야 합니다.`;
    addDecisions = [];
    addCriteria = [
      `${item.title} — 정상 동작 기준 (예: 특정 입력 시 특정 결과가 나타남)`,
      `${item.title} — 실패 시 동작 기준 (예: 오류 발생 시 안내 메시지가 보임)`,
      `${item.title} — 권한/접근 기준 (해당 시)`,
    ];
    addOpenQuestions = [];
    tasks = [
      "이 항목의 완성 기준을 최소 2개 이상 구체적으로 작성한다.",
      "정상 동작, 실패 동작, 권한 조건 중 해당되는 것을 추가한다.",
      "완성 기준을 업데이트한 후 다시 확인한다.",
    ];
    doneWhen = [
      `${item.title}의 완성 기준이 2개 이상이다.`,
      "각 기준은 '~가 되어야 한다' 형태로 확인 가능하다.",
    ];
    doNotDo = ["추상적인 표현('잘 된다', '좋아 보인다')만으로 기준을 작성하지 말 것."];
  } else {
    // needs_decision
    plainSummary = `이 항목(${item.title})은 아직 결정되지 않은 내용과 연결됩니다. 먼저 방향을 결정해야 구현 방법을 정할 수 있습니다.`;
    addDecisions = [`${item.title} 관련 결정 사항`];
    addCriteria = [];
    addOpenQuestions = [checkResult.nextAction || `${item.title} — 구체적인 구현 방향 결정 필요`];
    tasks = [
      `관련 의사결정을 먼저 확정한다: ${checkResult.reason}`,
      "결정 내용을 제품 설명서의 결정 사항에 기록한다.",
      "결정 후 이 항목의 완성 기준을 업데이트한다.",
    ];
    doneWhen = ["관련 결정이 제품 설명서에 기록됐다.", "이 항목의 완성 기준이 결정 내용을 반영한다."];
    doNotDo = ["결정 없이 임의로 구현하지 말 것.", "여러 선택지를 동시에 구현하지 말 것."];
  }

  return {
    ok: true,
    source: "mock-fallback",
    itemId: item.id,
    suggestion: {
      plainSummary,
      productSpecPatch: {
        addDecisions,
        addCriteria,
        addOpenQuestions,
      },
      builderBrief: {
        title: item.title,
        goal: plainSummary,
        context: [
          `현재 상태: ${checkResult.reason}`,
          ...(checkResult.evidence.length > 0 ? [`근거: ${checkResult.evidence.join(", ")}`] : []),
        ],
        tasks,
        doneWhen,
        doNotDo,
        verifyBy: [
          "제품 설명서를 다시 읽고 이 항목과 일치하는지 확인한다.",
          "완성 기준을 하나씩 직접 테스트한다.",
        ],
      },
    },
  };
}

// ─── Shape validation ─────────────────────────────────────────────────────────

function isValidFixResponse(v: unknown): v is { plainSummary: string; builderBrief: { tasks: string[] } } {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["plainSummary"] === "string" &&
    r["builderBrief"] !== undefined &&
    typeof (r["builderBrief"] as Record<string, unknown>)["title"] === "string"
  );
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generateFixSuggestion(
  req: WorkspaceFixSuggestionRequest,
  anthropicApiKey: string | undefined,
  anthropicBaseUrl?: string,
): Promise<WorkspaceFixSuggestionResponse | { ok: false; error: "llm_unavailable" }> {
  if (!anthropicApiKey) {
    console.warn("[workspace/fix] no API key — using mock fallback");
    return buildMockFixFallback(req);
  }

  const prompt = buildFixPrompt(req);
  let rawText = "";
  try {
    rawText = await callAnthropic(anthropicApiKey, prompt, anthropicBaseUrl);
  } catch (err) {
    console.error("[workspace/fix] LLM call failed:", err);
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[workspace/fix] LLM returned non-JSON. head:", rawText.slice(0, 200));
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("[workspace/fix] JSON parse failed");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  if (!isValidFixResponse(parsed)) {
    console.warn("[workspace/fix] response failed shape validation");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const p = parsed as FixSuggestion;
  return {
    ok: true,
    source: "llm",
    itemId: req.item.id,
    suggestion: p,
  };
}

/**
 * workspace/unstick.ts — G2 막힘 도우미 (2026-07-18 backlog).
 *
 * 비개발자가 실패하는 지점은 검수가 아니라 만들기 도중이다(에이전트 에러,
 * 키 발급 막힘, 빌더가 멈춤). 붙여넣은 에러/상황을 쉬운 말로 번역하고 다음
 * 행동 1~3개를 준다 — 만들기 중간의 복귀 접점.
 *
 * recommend.ts의 계약을 그대로 따른다:
 *   ① 게이트웨이 경유 (직행 Worker 이그레스 403)
 *   ② 조용한 날조 금지 — 실패 시 { ok:false, error:"llm_unavailable" }.
 *      지어낸 해결책은 막힌 비개발자를 더 깊이 막는다.
 *   ③ 영문 스캐폴드 + 한국어 출력 (recommend.ts의 검증된 기법, 2026-07-07 결정)
 */
import { anthropicMessages, anthropicEndpoint } from "./anthropic-fetch.js";

export type WorkspaceUnstickRequest = {
  /** 붙여넣은 에러 메시지 또는 상황 설명 (서버에서 8000자 컷). */
  problemText: string;
  productName?: string;
  /** 어떤 도구로 만들던 중인지 (claude_code/codex/lovable/… 자유 텍스트). */
  buildTool?: string;
  locale?: "ko" | "en";
};

export type UnstickAdvice = {
  /** 무슨 일이 난 건지 — 쉬운 말 1~2문장, 전문용어는 그 자리에서 풀이. */
  whatHappened: string;
  /** 다음 행동 1~3개 — 비개발자가 지금 할 수 있는 것만. */
  nextSteps: string[];
  /** 개발 AI에게 그대로 붙여넣을 한 문단 (AI가 고칠 문제일 때만). */
  askAgentMessage?: string;
};

export type WorkspaceUnstickResponse =
  | ({ ok: true; source: "llm" } & UnstickAdvice)
  | { ok: false; error: "llm_unavailable" };

const MAX_PROBLEM_CHARS = 8000;

function buildUnstickPrompt(req: WorkspaceUnstickRequest): string {
  const ko = (req.locale ?? "ko") !== "en";
  const ctx: string[] = [];
  if (req.productName) ctx.push(`Product: ${req.productName}`);
  if (req.buildTool) ctx.push(`Building with: ${req.buildTool}`);
  const context = ctx.length > 0 ? ctx.join("\n") : "(no extra context)";
  const langLine = ko
    ? "Write whatHappened, every nextSteps entry, and askAgentMessage in natural, warm Korean (한국어). Explain any technical term inline in plain words."
    : "Write whatHappened, nextSteps, and askAgentMessage in plain English.";

  return `A NON-DEVELOPER building an app with an AI tool is stuck. They pasted an error message or described their situation. Translate what happened into plain language and give the smallest set of concrete next actions.

[Context]
${context}

[What they pasted]
${req.problemText.slice(0, MAX_PROBLEM_CHARS)}

Rules:
- whatHappened: 1-2 sentences. What actually went wrong, no jargon (or explain the term inline). Base ONLY on what they pasted — never invent file names, keys, or causes that are not visible in it.
- nextSteps: 1-3 actions THIS person can do right now (click here, copy this, paste that to your AI). If the pasted text is not enough to diagnose, the FIRST step must be exactly what to look for or copy (e.g. the red text in the terminal, the browser console message).
- askAgentMessage: include ONLY if the fix is something their coding AI should do — one paragraph they can paste verbatim into their AI chat, written as an instruction to that AI. Omit the field otherwise.
- Never tell them to "check the documentation" or "debug the code" — those are developer moves.
- ${langLine}

Reply with ONLY this JSON (no markdown, no prose):
{ "whatHappened": "...", "nextSteps": ["..."], "askAgentMessage": "..." }`;
}

async function callAnthropic(
  apiKey: string,
  prompt: string,
  baseUrl: string | undefined,
  timeoutMs = 20000,
): Promise<string> {
  const data = (await anthropicMessages(
    apiKey,
    { model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: prompt }] },
    timeoutMs,
    undefined,
    anthropicEndpoint(baseUrl),
    "unstick",
  )) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
}

function isValidAdvice(v: unknown): v is UnstickAdvice {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.whatHappened === "string" &&
    o.whatHappened.trim().length > 0 &&
    Array.isArray(o.nextSteps) &&
    o.nextSteps.length > 0 &&
    o.nextSteps.every((s) => typeof s === "string" && s.trim().length > 0)
  );
}

export async function generateUnstickAdvice(
  req: WorkspaceUnstickRequest,
  anthropicApiKey: string | undefined,
  anthropicBaseUrl?: string,
): Promise<WorkspaceUnstickResponse> {
  if (!anthropicApiKey) {
    console.warn("[workspace/unstick] no API key — honest failure");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  let rawText = "";
  try {
    rawText = await callAnthropic(anthropicApiKey, buildUnstickPrompt(req), anthropicBaseUrl);
  } catch (err) {
    console.error("[workspace/unstick] LLM call failed:", err);
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[workspace/unstick] non-JSON response. head:", rawText.slice(0, 200));
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false as const, error: "llm_unavailable" as const };
  }
  if (!isValidAdvice(parsed)) {
    console.warn("[workspace/unstick] shape validation failed");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const p = parsed as UnstickAdvice & { askAgentMessage?: unknown };
  return {
    ok: true,
    source: "llm",
    whatHappened: p.whatHappened.trim(),
    nextSteps: p.nextSteps.map((s) => s.trim()).slice(0, 3),
    ...(typeof p.askAgentMessage === "string" && p.askAgentMessage.trim().length > 0
      ? { askAgentMessage: p.askAgentMessage.trim() }
      : {}),
  };
}

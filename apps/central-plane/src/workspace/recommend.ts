/**
 * workspace/recommend.ts
 *
 * C2 (openQuestions 질문화): generate a recommended answer for a SINGLE open
 * decision the spec left undecided (e.g. "통계 보관 기간을 며칠로 할지").
 *
 * Bae's C pre-condition, applied literally:
 *   ① 게이트웨이 경유 — the LLM call routes through the Cloudflare AI Gateway
 *      (anthropicEndpoint(baseUrl)); direct egress ~90% 403.
 *   ② 조용한 기본값 금지 — on NO key / throw / bad shape we return an honest
 *      { ok:false, error:"llm_unavailable" }. There is deliberately NO mock
 *      fallback (unlike fix.ts): a fabricated recommendation for a real
 *      product decision would be worse than saying "추천을 못 가져왔어요".
 */

import { anthropicMessages, anthropicEndpoint } from "./anthropic-fetch.js";

export type WorkspaceRecommendAnswerRequest = {
  /** The open decision to resolve, verbatim from productSpec.openQuestions. */
  question: string;
  /** Optional spec context so the recommendation fits THIS product. */
  productName?: string;
  oneLine?: string;
  targetUsers?: string[];
  locale?: "ko" | "en";
};

export type RecommendedAnswer = {
  /** Short, concrete answer the user can accept as-is (e.g. "30일"). */
  recommendation: string;
  /** One line, non-developer friendly, why this default is sensible. */
  reason: string;
  /** 2–4 concrete alternatives the user could pick instead. */
  options: string[];
};

export type WorkspaceRecommendAnswerResponse =
  | ({ ok: true; source: "llm" } & RecommendedAnswer)
  | { ok: false; error: "llm_unavailable" };

function buildRecommendPrompt(req: WorkspaceRecommendAnswerRequest): string {
  const ko = (req.locale ?? "ko") !== "en";
  const ctx: string[] = [];
  if (req.productName) ctx.push(`제품 이름: ${req.productName}`);
  if (req.oneLine) ctx.push(`한 줄 설명: ${req.oneLine}`);
  if (req.targetUsers && req.targetUsers.length > 0) ctx.push(`대상 사용자: ${req.targetUsers.join(", ")}`);
  const context = ctx.length > 0 ? ctx.join("\n") : "(추가 맥락 없음)";

  // The instruction is deterministic; only the decision + context vary. Ask for
  // a concrete, non-developer-friendly default the user can accept in one click.
  return [
    ko
      ? "너는 비개발자가 만드는 앱의 제품 결정을 돕는 조력자다. 아래 '아직 결정하지 못한 사항' 하나에 대해, 대부분의 경우에 무난한 기본값을 하나 추천하라."
      : "You help a non-developer decide one open product question. Recommend one sensible default that works for most cases.",
    "",
    "제품 맥락:",
    context,
    "",
    "아직 결정하지 못한 사항:",
    req.question,
    "",
    ko
      ? [
          "규칙:",
          "- recommendation: 사용자가 그대로 채택할 수 있는 짧고 구체적인 답 (예: \"30일\", \"무료로 제공\").",
          "- reason: 왜 이게 무난한지 한 줄, 전문용어 없이.",
          "- options: 사용자가 대신 고를 수 있는 구체적 대안 2~4개.",
          "- 개발/기술 용어를 쓰지 마라. 실제 값을 지어내지 말고, 결정의 성격에 맞는 합리적 기본을 제시하라.",
          "",
          "아래 JSON 형식으로만 답하라(설명 문장 없이):",
        ].join("\n")
      : [
          "Rules:",
          "- recommendation: a short concrete answer the user can accept as-is.",
          "- reason: one line, no jargon, why it is sensible.",
          "- options: 2–4 concrete alternatives.",
          "",
          "Reply with ONLY this JSON (no prose):",
        ].join("\n"),
    '{ "recommendation": "...", "reason": "...", "options": ["...", "..."] }',
  ].join("\n");
}

async function callAnthropic(
  apiKey: string,
  prompt: string,
  baseUrl: string | undefined,
  timeoutMs = 15000,
): Promise<string> {
  const data = (await anthropicMessages(
    apiKey,
    { model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: prompt }] },
    timeoutMs,
    undefined,
    anthropicEndpoint(baseUrl),
  )) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
}

function isValidRecommendation(v: unknown): v is RecommendedAnswer {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.recommendation === "string" &&
    o.recommendation.trim().length > 0 &&
    typeof o.reason === "string" &&
    Array.isArray(o.options)
  );
}

/**
 * Generate a recommended answer for one open decision. Honest by contract:
 * every failure path (no key, network throw, non-JSON, bad shape) returns
 * { ok:false, error:"llm_unavailable" } so the UI can show "추천을 못 가져왔어요,
 * 다시 시도" — never a silently fabricated default.
 */
export async function generateRecommendedAnswer(
  req: WorkspaceRecommendAnswerRequest,
  anthropicApiKey: string | undefined,
  anthropicBaseUrl?: string,
): Promise<WorkspaceRecommendAnswerResponse> {
  if (!anthropicApiKey) {
    console.warn("[workspace/recommend] no API key — honest failure (no silent default)");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const prompt = buildRecommendPrompt(req);
  let rawText = "";
  try {
    rawText = await callAnthropic(anthropicApiKey, prompt, anthropicBaseUrl);
  } catch (err) {
    console.error("[workspace/recommend] LLM call failed:", err);
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[workspace/recommend] LLM returned non-JSON. head:", rawText.slice(0, 200));
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("[workspace/recommend] JSON parse failed");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  if (!isValidRecommendation(parsed)) {
    console.warn("[workspace/recommend] response failed shape validation");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const p = parsed as RecommendedAnswer;
  return {
    ok: true,
    source: "llm",
    recommendation: p.recommendation.trim(),
    reason: (p.reason ?? "").trim(),
    // Keep only string options, trimmed, capped at 4.
    options: p.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim()).slice(0, 4),
  };
}

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
  // Context labels are English on purpose (see the language note below); the
  // VALUES stay in whatever language the user wrote (usually Korean).
  const ctx: string[] = [];
  if (req.productName) ctx.push(`Product name: ${req.productName}`);
  if (req.oneLine) ctx.push(`One-liner: ${req.oneLine}`);
  if (req.targetUsers && req.targetUsers.length > 0) ctx.push(`Target users: ${req.targetUsers.join(", ")}`);
  const context = ctx.length > 0 ? ctx.join("\n") : "(no extra context)";

  // Why the scaffolding is English while the output is Korean:
  //
  // HONEST HISTORY (do not "fix" this back to a fully-Korean prompt without
  // reading this). During live verification the Korean path appeared to fail —
  // the model reported the input as "corrupted/인코딩 오류". That was NOT a real
  // model or prompt bug: the manual test harness (Windows Git Bash `curl -d`)
  // was sending the Korean body as mojibake, and the model correctly reported
  // the garbled bytes. With a proper UTF-8 payload every prompt variant works.
  // Three prompt PRs (#286 few-shot, #287 check-draft-style, #288 this English
  // scaffold) were merged chasing that phantom before it was isolated.
  //
  // We KEEP the English scaffold (decision, 2026-07-07): it is verified live to
  // produce high-quality Korean ("90일" + sensible reason + options), and
  // English framing + localized output is a standard, defensible technique. A
  // pure-Korean prompt would also work now — this is a preference, not a fix.
  // The context labels are English; the VALUES stay in the user's language, and
  // langLine forces the OUTPUT into it. See gotcha-windows-gitbash-curl-utf8.
  const langLine = ko
    ? "Write recommendation, reason, and every option value in natural Korean (한국어)."
    : "Write recommendation, reason, and options in English.";

  return `Recommend one sensible default a non-developer can accept as-is for a single undecided product question.

[Product context]
${context}

[Question to decide]
${req.question}

Rules:
- recommendation: a short concrete answer the user can accept as-is (e.g. "30 days").
- reason: one sentence, no jargon, why it is sensible.
- options: 2-4 concrete alternatives.
- ${langLine}

Reply with ONLY this JSON (no markdown, no prose):
{ "recommendation": "...", "reason": "...", "options": ["...", "..."] }`;
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
    "recommend",
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

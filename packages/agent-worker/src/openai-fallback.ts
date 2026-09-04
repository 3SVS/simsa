/**
 * openai-fallback.ts — 자동수리 워커의 벤더 폴백 (2026-08-26).
 *
 * ## 왜 필요한가
 *
 * Anthropic이 Cloudflare egress에서 **완전 차단**됐다(2026-08-25 실측: 같은 키가
 * 노트북에서 200, Worker에서 403). 중앙 플레인의 LLM 호출에는 폴백을 붙였지만
 * **자동수리 컨테이너에는 붙이지 않았다** — 그래서 "고쳐줘"를 눌러도 아무 일도
 * 일어나지 않는 상태였을 가능성이 높다.
 *
 * 검수가 문제를 정확히 짚어주는 것과, 그 문제를 **실제로 고쳐주는 것**은 다른 일이다.
 * 앞의 것만 되면 제품은 절반이다.
 *
 * ## 매핑
 *
 * 워커는 패치를 **도구 호출(tool_use)**로 받는다 — 자유 텍스트로 diff를 받으면
 * 형식이 흔들려 적용이 깨지기 때문이다. OpenAI의 함수 호출이 같은 일을 하므로
 * 그대로 옮긴다:
 *
 *   Anthropic `tools[] + tool_choice`      → OpenAI `tools[](function) + tool_choice`
 *   OpenAI `tool_calls[0].function.args`   → Anthropic `content[{type:"tool_use", input}]`
 *
 * ## 정직성
 *
 * 폴백이 없거나 그마저 실패하면 **원래 에러를 그대로 던진다.** 조용히 빈 패치를
 * 돌려주면 "고쳤다"는 거짓말이 된다. 어느 벤더가 응답했는지도 로그에 남긴다.
 */
import type { AnthropicCreateParams, AnthropicLike, AnthropicResponse } from "./anthropic-types.js";

export const OPENAI_FALLBACK_MODEL = "gpt-5.4";

export type FallbackOptions = {
  openaiApiKey: string;
  /** CF AI Gateway의 OpenAI 베이스(없으면 직행). */
  openaiBaseUrl?: string;
  model?: string;
  /**
   * 킬스위치. 참이면 Anthropic을 **아예 시도하지 않고** 곧장 폴백으로 간다.
   * 막힌 게 실측으로 확정됐을 때 재시도로 시간을 태우지 않기 위함
   * (중앙 플레인의 `ANTHROPIC_ENABLED="off"`와 같은 뜻).
   */
  preferFallback?: boolean;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

function openAiUrl(baseUrl?: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
}

/**
 * 추론 모델은 **같은 예산에서 추론 토큰을 먼저 쓴다**(2026-08-24 실측: 응답이 중간에서
 * 끊겨 파싱이 깨졌다). 패치는 잘리면 통째로 못 쓰므로 여유를 넉넉히 준다.
 * 실제로 쓴 만큼만 과금되므로 상한을 크게 잡는 비용은 낮다.
 */
export function fallbackOutputBudget(anthropicMaxTokens: number): number {
  return Math.min(Math.max(anthropicMaxTokens * 3, 16_000), 64_000);
}

/** Anthropic의 system(문자열 또는 블록 배열)을 하나의 문자열로. */
function systemText(system: AnthropicCreateParams["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

function toOpenAiBody(params: AnthropicCreateParams, model: string): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  const sys = systemText(params.system);
  if (sys) messages.push({ role: "system", content: sys });
  for (const m of params.messages) messages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: fallbackOutputBudget(params.max_tokens),
    messages,
  };

  if (params.tools?.length) {
    body["tools"] = params.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    // 워커는 도구를 **반드시** 쓰게 강제한다 — 자유 텍스트 패치는 형식이 흔들린다.
    const forced = params.tool_choice && "name" in params.tool_choice ? params.tool_choice.name : null;
    body["tool_choice"] = forced
      ? { type: "function", function: { name: forced } }
      : params.tool_choice?.type === "any"
        ? "required"
        : "auto";
  }
  return body;
}

type OpenAiChoice = {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string;
};

function toAnthropicResponse(json: unknown, model: string): AnthropicResponse {
  const j = json as {
    id?: string;
    choices?: OpenAiChoice[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = j.choices?.[0];
  const content: AnthropicResponse["content"][number][] = [];

  for (const call of choice?.message?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = JSON.parse(call.function?.arguments ?? "{}");
    } catch {
      // 인자가 깨졌으면 도구 블록을 만들지 않는다 — 빈 입력으로 넘기면
      // 호출부가 "빈 패치"를 정상 결과로 오해한다.
      continue;
    }
    content.push({ type: "tool_use", id: call.id ?? "call_0", name: call.function?.name ?? "", input });
  }

  const text = choice?.message?.content;
  if (typeof text === "string" && text.trim()) content.push({ type: "text", text });

  return {
    id: j.id ?? "openai_fallback",
    model,
    content,
    ...(choice?.finish_reason === "length" ? { stop_reason: "max_tokens" } : {}),
    usage: {
      input_tokens: j.usage?.prompt_tokens ?? 0,
      output_tokens: j.usage?.completion_tokens ?? 0,
    },
  };
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ event, component: "agent-worker", ...extra }));
  } catch {
    /* 로깅이 호출을 깨뜨리면 안 된다 */
  }
}

/** OpenAI로 한 번 호출하고 Anthropic 형태로 돌려준다. */
export async function callOpenAiAsAnthropic(
  params: AnthropicCreateParams,
  opts: FallbackOptions,
): Promise<AnthropicResponse> {
  const model = opts.model ?? OPENAI_FALLBACK_MODEL;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch.bind(globalThis) as FallbackOptions["fetchImpl"]);
  const r = await fetchImpl!(openAiUrl(opts.openaiBaseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${opts.openaiApiKey}`, "content-type": "application/json" },
    body: JSON.stringify(toOpenAiBody(params, model)),
  });
  if (!r.ok) {
    const tail = await r.text().catch(() => "");
    throw new Error(`OpenAI ${r.status}: ${tail.slice(0, 200)}`);
  }
  return toAnthropicResponse(await r.json(), model);
}

/**
 * Anthropic 클라이언트를 감싸 폴백을 붙인다.
 *
 * `primary`가 없으면(키 없음) 폴백만으로 동작한다 — Anthropic 키 없이도 자동수리가
 * 가능해야 한다. 둘 다 없으면 애초에 이 함수를 부르지 않는다.
 */
export function withOpenAiFallback(primary: AnthropicLike | null, opts: FallbackOptions): AnthropicLike {
  return {
    messages: {
      async create(params: AnthropicCreateParams): Promise<AnthropicResponse> {
        if (primary && !opts.preferFallback) {
          try {
            const res = await primary.messages.create(params);
            log("worker_llm_ok", { vendor: "anthropic" });
            return res;
          } catch (err) {
            log("worker_llm_fallback", {
              from: "anthropic",
              to: "openai",
              reason: String(err).slice(0, 160),
            });
            try {
              const res = await callOpenAiAsAnthropic(params, opts);
              // 폴백으로 답했다는 사실을 반드시 남긴다 — 조용한 벤더 교체 금지.
              log("worker_llm_ok", { vendor: "openai" });
              return res;
            } catch (fbErr) {
              log("worker_llm_fallback_failed", { reason: String(fbErr).slice(0, 160) });
              // 원래 원인이 더 유용하다 — 폴백 실패로 덮지 않는다.
              throw err;
            }
          }
        }
        if (primary && opts.preferFallback) log("worker_llm_primary_skipped", { reason: "anthropic_disabled" });
        const res = await callOpenAiAsAnthropic(params, opts);
        log("worker_llm_ok", { vendor: "openai" });
        return res;
      },
    },
  };
}

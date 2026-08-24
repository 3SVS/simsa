/**
 * anthropic-fetch.ts — shared Anthropic Messages call with retry.
 *
 * Live finding (2026-07-05 tail): Anthropic intermittently returns
 * 403 {"type":"forbidden","message":"Request not allowed"} to Cloudflare
 * Workers — shared egress IPs get flagged; the very next attempt (different
 * egress) succeeds. Observed success/403/success back-to-back on identical
 * requests. Every workspace LLM call therefore retries transient statuses.
 */

/**
 * A-1 (2026-08-21 QA): 재시도 정책을 **오류 종류로 가른다**.
 *
 * 종전엔 한 정책(500ms × attempt, 총 ~7.5초)으로 전부 재시도했는데, 그 예산은
 * 403(공유 egress가 플래그됨 — 다음 시도가 다른 IP라 즉시 재시도가 정답)에
 * 맞춘 것이다. 반면 **429/503/529는 용량**이고 분 단위로 리셋되므로 7.5초로는
 * 절대 넘길 수 없다 → 6회를 9초에 다 태우고 llm_unavailable.
 * 실측(라이브 QA): 동일 페이로드 동시 4건 → 2건 성공 / 2건 503, 항목 수 무관.
 *
 * 그래서: FAST는 종전 그대로 촘촘히, CAPACITY는 지수 백오프 + `retry-after`
 * 준수. 단 사용자가 무한정 기다리면 안 되므로 **총 예산(maxTotalMs)으로 컷**한다
 * — 예산을 넘길 대기라면 시도하지 않고 정직하게 실패한다.
 */
const FAST_RETRY = new Set([403, 500, 502, 504]);
const CAPACITY_RETRY = new Set([429, 503, 529]);
const RETRYABLE = new Set([...FAST_RETRY, ...CAPACITY_RETRY]);
const MAX_ATTEMPTS = 6; // 403 "Request not allowed" hits ~60% of CF egress
// attempts; more attempts + jitter is the only lever that raises success.

/**
 * 재시도 대기 총합의 상한. 호출자 쪽 타임아웃(대시보드 check-draft 25s)보다
 * 짧게 잡아, 서버가 붙들고 있다가 클라이언트가 먼저 끊는 상황을 만들지 않는다.
 */
const DEFAULT_MAX_TOTAL_MS = 12_000;

/**
 * A′-1 (2026-08-21 실측): 재시도할 때 **경로를 번갈아 쓴다**.
 *
 * A-2 계측이 밝힌 진범은 용량이 아니라 **403 egress**였다 — Anthropic이 Cloudflare
 * egress IP에 "Request not allowed"를 준다. 종전엔 6회 재시도가 **모두 같은 경로**로
 * 나갔고, 그 경로가 막히면 6회가 통째로 막혔다(라이브: 동시 4건 중 2~4건 실패,
 * 로그상 attempt 1~6 전부 403).
 *
 * 게이트웨이와 직행은 서로 다른 출구다. 둘이 완전히 상관되지 않는 한 번갈아 쓰는
 * 편이 한 경로로 6번 두드리는 것보다 낫다. 어느 쪽이 실제로 잘 되는지는 추측하지
 * 않고 **로그로 집계**한다(성공·실패 양쪽에 endpoint_kind를 남긴다).
 */
export const DIRECT_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
export type EndpointKind = "gateway" | "direct";

export function endpointRotation(primary: string): Array<{ url: string; kind: EndpointKind }> {
  if (!primary || primary === DIRECT_ANTHROPIC_ENDPOINT) {
    return [{ url: DIRECT_ANTHROPIC_ENDPOINT, kind: "direct" }];
  }
  return [
    { url: primary, kind: "gateway" },
    { url: DIRECT_ANTHROPIC_ENDPOINT, kind: "direct" },
  ];
}

/** `retry-after`(초 또는 HTTP date) → ms. 파싱 불가/과대값은 무시한다. */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) return secs >= 0 && secs <= 60 ? Math.round(secs * 1000) : null;
  const at = Date.parse(header);
  if (!Number.isFinite(at)) return null;
  const delta = at - nowMs;
  return delta > 0 && delta <= 60_000 ? delta : null;
}

/**
 * 다음 시도까지의 대기. FAST는 종전 공식 유지(회귀 없음), CAPACITY는 지수
 * 백오프(1s·2s·4s…, 상한 6s)에 `retry-after`가 있으면 그것을 우선한다.
 */
export function retryDelayMs(
  status: number | null,
  attempt: number,
  retryAfterMs: number | null,
  /** A′-4: 지터 난수(테스트 주입). */
  rand: () => number = Math.random,
): number {
  // A′-4 (2026-08-21 라이브 로그): 종전 지터는 `(attempt*137)%400` — **결정론적**이라
  // 같은 순간 실패한 요청들이 **정확히 같은 시각에 함께 재시도**했다. 그래서 동시
  // 4건이 6회 내내 뭉쳐 다니며 매번 같이 거절당했다(성공한 건은 전부 attempt 1에서
  // 성공, 첫 시도에 실패한 건은 6회 전부 실패 — 재시도가 무력했던 정확한 이유).
  // equal jitter(base/2 + rand*base)로 재시도 시각을 흩어 동시성을 스스로 낮춘다.
  if (status !== null && CAPACITY_RETRY.has(status) && retryAfterMs !== null) {
    // 서버가 명시한 대기는 **하한**으로 존중하고, 그 위에만 흩뿌린다.
    return retryAfterMs + Math.round(rand() * 500);
  }
  const base =
    status !== null && CAPACITY_RETRY.has(status)
      ? Math.min(1000 * 2 ** (attempt - 1), 6000)
      : 500 * attempt; // 403 등 egress성 오류 + 네트워크 예외
  return Math.round(base / 2 + rand() * base);
}

/**
 * A-2 (2026-08-21 QA): 실패도 한 줄로 남긴다. 종전엔 모든 실패가 클라이언트에
 * `llm_unavailable` 하나로만 보여 **무엇이 문제인지 집계할 수 없었다**(용량인지
 * egress인지 타임아웃인지). 성공 로그(anthropic_usage)와 짝을 이루는 실패 로그로,
 * Workers 로그에서 `event:"llm_failure"`를 집계하면 원인 분포가 나온다.
 */
export function logAnthropicFailure(
  callSite: string,
  model: string,
  info: {
    finalStatus: number | null;
    attempts: number;
    latencyMs: number;
    reason: string;
    /** A′-1: 마지막으로 시도한 경로와 경로별 시도 횟수 — 어느 출구가 막히는지 집계용. */
    endpointKind?: EndpointKind;
    triedByEndpoint?: Record<string, number>;
  },
): void {
  try {
    console.log(
      JSON.stringify({
        event: "llm_failure",
        vendor: "anthropic",
        call_site: callSite,
        model,
        final_status: info.finalStatus,
        failure_class:
          info.finalStatus === null
            ? "network"
            : CAPACITY_RETRY.has(info.finalStatus)
              ? "capacity"
              : FAST_RETRY.has(info.finalStatus)
                ? "egress"
                : "other",
        attempts: info.attempts,
        latency_ms: info.latencyMs,
        reason: info.reason,
        ...(info.endpointKind ? { endpoint_kind: info.endpointKind } : {}),
        ...(info.triedByEndpoint ? { tried_by_endpoint: info.triedByEndpoint } : {}),
      }),
    );
  } catch {
    // never let logging break the call
  }
}

export type AnthropicMessagesBody = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
};

export type AnthropicMessagesData = {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

/**
 * One structured JSON line per successful LLM call — the minimal cost/usage
 * observability layer (2026-07-08 ADR: prompt caching deferred; these fields
 * are the evidence base for re-evaluating it, and tomorrow's Langfuse wiring
 * ingests this exact shape). Never throws: observability must not break the
 * user-facing call.
 */
export function logAnthropicUsage(
  callSite: string,
  model: string,
  usage: AnthropicMessagesData["usage"],
  latencyMs: number,
  /** A′-1: 성공한 경로와 몇 번째 시도였는지 — 경로별 성공률 집계의 반쪽.
   *  vendor: 실제로 응답한 벤더(폴백 시 openai). 정직성상 반드시 남긴다. */
  meta?: { endpointKind?: EndpointKind; attempt?: number; vendor?: string },
): void {
  try {
    console.log(
      JSON.stringify({
        event: "anthropic_usage",
        call_site: callSite,
        model,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
        latency_ms: latencyMs,
        vendor: meta?.vendor ?? "anthropic",
        ...(meta?.endpointKind ? { endpoint_kind: meta.endpointKind } : {}),
        ...(meta?.attempt ? { attempt: meta.attempt } : {}),
      }),
    );
  } catch {
    // never let logging break the call
  }
}

/** POST /v1/messages with bounded retries. Throws on final failure. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * ★벤더 폴백 (2026-08-22) — 이 파일의 가장 중요한 장치.
 *
 * `/internal/llm-probe` 실측(동시성 1·4 각각):
 *   anthropic:gateway 0/1·0/4 (403 forbidden)   anthropic:direct 0/1·0/4 (403)
 *   **openai:gateway 1/1·4/4 (200, 평균 2.9초)**  gemini:gateway 0/1·0/4
 *     (400 "User location is not supported" — 지역 제한)
 *
 * 즉 Worker egress에서 **Anthropic은 완전 차단**이고 **OpenAI만 열려 있다**.
 * 재시도·백오프·경로 교대·지터로는 절대 못 넘는다(네 번 시도해 네 번 실패했다).
 * 그래서 마지막 수단으로 **다른 벤더로 같은 프롬프트를 던진다**.
 *
 * 정직성: 조용한 품질 저하가 아니다 — 같은 프롬프트·같은 출력 계약이고,
 * **어느 벤더가 응답했는지 로그에 남긴다**(anthropic_usage.vendor / llm_fallback).
 * 폴백이 없으면(키 없음·폴백도 실패) 종전처럼 정직하게 실패한다.
 */
export const OPENAI_FALLBACK_MODEL = "gpt-5.4";

export type VendorFallback = {
  openaiApiKey?: string;
  /** CF AI Gateway의 OpenAI 베이스(없으면 직행). */
  openaiBaseUrl?: string;
  model?: string;
};

/**
 * ★추론 모델은 **같은 예산에서 추론 토큰을 먼저 쓴다** (2026-08-24 실측).
 *
 * Anthropic의 `max_tokens`를 그대로 `max_completion_tokens`로 넘겼더니, gpt-5.4가
 * 그 예산을 추론에 나눠 쓰고 **본문이 중간에서 끊겼다**: 스펙 생성에서 정상
 * Anthropic 응답이 12,449자인데 폴백은 6,179자에서 잘려 `JSON parse failed`.
 * 폴백이 "성공"으로 보이는데 결과는 못 쓰는 상태 — 가장 나쁜 실패 모양이다.
 *
 * 그래서 폴백에는 **여유 예산**을 준다. 배수는 실측 전까지의 잠정값이고,
 * `llm_fallback_truncated` 로그의 reasoning_tokens로 조정한다(추측 대신 계측).
 * OpenAI는 실제로 쓴 만큼만 과금하므로 상한을 넉넉히 잡는 비용은 낮다.
 */
const FALLBACK_BUDGET_MULTIPLIER = 3;
const FALLBACK_BUDGET_MIN = 8000;
const FALLBACK_BUDGET_MAX = 32000;

/**
 * ★assistant prefill을 벤더 간에 번역한다 (2026-08-24, 라이브 실측으로 잡힘).
 *
 * Anthropic은 마지막 메시지가 assistant면 **그 뒤를 이어서** 쓴다. 그래서
 * `generate.ts`는 `{ role:"assistant", content:"{" }`를 붙여 "반드시 JSON으로
 * 시작"을 강제하고, 응답 앞에 `"{"`를 **되붙인다**.
 *
 * OpenAI는 이어쓰기를 하지 않는다 — **완전한 JSON**을 돌려준다. 그래서 되붙이면
 * `{{...}`가 되어 파싱이 깨졌다. 실제 로그가 정확히 `head: {{` 였다.
 *
 * 즉 **폴백은 prefill을 쓰는 모든 호출부에서 조용히 망가져 있었다.** prefill을
 * 안 쓰는 검수(check)는 멀쩡했기에 더 늦게 드러났다.
 *
 * 폴백의 계약은 "호출부는 폴백을 모른다"이므로, 여기서 **Anthropic의 이어쓰기
 * 모양으로 맞춰서** 돌려준다: 응답이 prefill로 시작하면 그만큼 떼어낸다.
 * 떼어낼 것이 없으면 그대로 둔다(이미 이어쓰기 모양).
 */
export function stripAssistantPrefill(text: string, messages: AnthropicMessagesBody["messages"]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return text;
  const prefill = (last.content ?? "").trim();
  if (!prefill) return text;
  const lead = text.replace(/^\s+/, "");
  return lead.startsWith(prefill) ? lead.slice(prefill.length) : text;
}

export function fallbackOutputBudget(anthropicMaxTokens: number): number {
  const wanted = Math.max(anthropicMaxTokens * FALLBACK_BUDGET_MULTIPLIER, FALLBACK_BUDGET_MIN);
  return Math.min(wanted, FALLBACK_BUDGET_MAX);
}

function openAiUrl(baseUrl?: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
}

/** OpenAI 응답을 Anthropic 응답 형태로 옮긴다 — 호출부는 폴백을 몰라도 된다. */
async function callOpenAiAsAnthropic(
  fb: VendorFallback,
  body: AnthropicMessagesBody,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<AnthropicMessagesData> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(openAiUrl(fb.openaiBaseUrl), {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${fb.openaiApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: fb.model ?? OPENAI_FALLBACK_MODEL,
        max_completion_tokens: fallbackOutputBudget(body.max_tokens),
        messages: body.messages,
      }),
    });
    if (!r.ok) {
      const tail = await r.text().catch(() => "");
      throw new Error(`OpenAI ${r.status}: ${tail.slice(0, 200)}`);
    }
    const j = (await r.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = j.choices?.[0];
    // prefill을 쓴 호출부는 응답 앞에 그 조각을 되붙인다 — 벤더 차이를 여기서 흡수한다.
    const text = stripAssistantPrefill(choice?.message?.content ?? "", body.messages);
    const reasoning = j.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    // ★잘림을 호출부에 보이게 한다. 종전엔 stop_reason을 안 넘겨서 잘린 JSON이
    //  그냥 "파싱 실패"로만 보였다 — 원인을 알 수 없는 실패였다(2026-08-24 실측).
    const stop = choice?.finish_reason === "length" ? "max_tokens" : (choice?.finish_reason ?? undefined);
    if (choice?.finish_reason === "length") {
      try {
        console.log(
          JSON.stringify({
            event: "llm_fallback_truncated",
            model: fb.model ?? OPENAI_FALLBACK_MODEL,
            requested_max: fallbackOutputBudget(body.max_tokens),
            completion_tokens: j.usage?.completion_tokens ?? 0,
            reasoning_tokens: reasoning,
            text_chars: text.length,
          }),
        );
      } catch { /* logging must not break the call */ }
    }
    return {
      content: [{ type: "text", text }],
      ...(stop ? { stop_reason: stop } : {}),
      usage: { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0 },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Base URL for the Anthropic Messages API. When CF_AI_GATEWAY_ANTHROPIC_URL is
 * set (e.g. https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/anthropic) the
 * call routes through Cloudflare AI Gateway, which sidesteps the direct
 * Worker→api.anthropic.com egress that intermittently 403s.
 */
export function anthropicEndpoint(baseUrl?: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/v1/messages` : "https://api.anthropic.com/v1/messages";
}

/**
 * Anthropic이 끝내 실패했을 때의 마지막 수단. 폴백이 없거나 그마저 실패하면
 * **원래 에러를 그대로 던진다** — 조용히 성공한 척하지 않는다.
 */
async function fallbackOrThrow(
  fb: VendorFallback | undefined,
  body: AnthropicMessagesBody,
  timeoutMs: number,
  fetchImpl: FetchLike,
  callSite: string,
  now: () => number,
  startedAt: number,
  lastStatus: number | null,
  lastErr: unknown,
): Promise<AnthropicMessagesData> {
  const primaryErr = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  if (!fb?.openaiApiKey) throw primaryErr;
  try {
    const data = await callOpenAiAsAnthropic(fb, body, timeoutMs, fetchImpl);
    logAnthropicUsage(callSite, fb.model ?? OPENAI_FALLBACK_MODEL, data.usage, now() - startedAt, {
      vendor: "openai",
    });
    try {
      console.log(
        JSON.stringify({
          event: "llm_fallback",
          call_site: callSite,
          from: "anthropic",
          to: "openai",
          primary_status: lastStatus,
          latency_ms: now() - startedAt,
        }),
      );
    } catch { /* logging must not break the call */ }
    return data;
  } catch (fbErr) {
    try {
      console.log(
        JSON.stringify({
          event: "llm_fallback_failed",
          call_site: callSite,
          primary_status: lastStatus,
          fallback_error: String(fbErr).slice(0, 200),
        }),
      );
    } catch { /* ignore */ }
    // 폴백도 실패 — 사용자에겐 원래 원인이 더 유용하다.
    throw primaryErr;
  }
}

/**
 * ★회로 차단기 (2026-08-22) — 폴백의 짝.
 *
 * Anthropic이 100% 403인 지금, 호출마다 6회 재시도로 ~12초를 태우고 나서야
 * 폴백에 들어간다. 그 12초는 실측상 **순손실**이다(네 번 시도해 네 번 실패한
 * 경로를 다시 여섯 번 두드리는 것). 그래서 연속 실패가 임계에 닿으면 이후
 * 호출은 Anthropic을 건너뛰고 바로 폴백으로 간다.
 *
 * 영구적으로 포기하진 않는다 — 쿨다운이 지나면 딱 한 번 다시 통과시켜
 * (half-open) 살아났는지 실측한다. 살아나면 즉시 원복, 또 죽으면 재차단.
 * 상태는 isolate 단위 메모리이므로 정확한 전역 합의가 아니라 **최적화**다.
 * 폴백이 없으면 차단하지 않는다 — 유일한 경로를 스스로 끊으면 안 된다.
 */
const BREAKER_THRESHOLD = 2;
const BREAKER_COOLDOWN_MS = 60_000;
let breakerFailures = 0;
let breakerOpenedAt = 0;

function breakerIsOpen(t: number): boolean {
  return breakerFailures >= BREAKER_THRESHOLD && t - breakerOpenedAt < BREAKER_COOLDOWN_MS;
}
function breakerRecordFailure(t: number): void {
  breakerFailures += 1;
  breakerOpenedAt = t;
}
function breakerRecordSuccess(): void {
  breakerFailures = 0;
  breakerOpenedAt = 0;
}
/** 테스트 전용 — isolate 전역 상태가 테스트 간에 새지 않도록. */
export function __resetAnthropicBreaker(): void {
  breakerRecordSuccess();
}

export async function anthropicMessages(
  apiKey: string,
  body: AnthropicMessagesBody,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
  endpoint: string = anthropicEndpoint(),
  /** Which workspace feature made this call (generate·check·fix·pr-review·recommend). */
  callSite = "unknown",
  /** A-1: 재시도 예산·시계 주입(테스트에서 실제로 자지 않고 예산 계약을 검증). */
  opts: {
    maxTotalMs?: number;
    sleepImpl?: (ms: number) => Promise<void>;
    nowImpl?: () => number;
    /** A′-4: 지터 난수 주입(테스트 결정론화). */
    randomImpl?: () => number;
    /** ★벤더 폴백: Anthropic이 끝내 실패하면 여기로 같은 프롬프트를 던진다. */
    fallback?: VendorFallback;
  } = {},
): Promise<AnthropicMessagesData> {
  let lastErr: unknown = null;
  let lastStatus: number | null = null;
  let attemptsMade = 0;
  /** 예산은 **재시도 대기의 총합**만 센다. 요청 자체의 소요는 포함하지 않는다 —
   *  포함하면 generate(성공도 ~45초)처럼 느린 호출이 재시도를 한 번도 못 받는다. */
  let sleptTotalMs = 0;
  const maxTotalMs = opts.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.nowImpl ?? (() => Date.now());
  const startedAt = now();
  // A′-1: 시도마다 경로를 번갈아 쓴다(게이트웨이 → 직행 → 게이트웨이 …).
  const rotation = endpointRotation(endpoint);
  const triedByEndpoint: Record<string, number> = {};
  // 차단기가 열려 있고 갈 곳이 있으면 12초를 태우지 않고 곧장 폴백으로.
  if (opts.fallback?.openaiApiKey && breakerIsOpen(startedAt)) {
    try {
      console.log(
        JSON.stringify({ event: "llm_breaker_open", call_site: callSite, skipped: "anthropic", failures: breakerFailures }),
      );
    } catch { /* logging must not break the call */ }
    return fallbackOrThrow(
      opts.fallback, body, timeoutMs, fetchImpl, callSite, now, startedAt,
      null, new Error("Anthropic skipped: circuit breaker open"),
    );
  }
  let lastKind: EndpointKind = rotation[0]!.kind;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    const target = rotation[(attempt - 1) % rotation.length]!;
    lastKind = target.kind;
    triedByEndpoint[target.kind] = (triedByEndpoint[target.kind] ?? 0) + 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: Response | null = null;
    try {
      resp = await fetchImpl(target.url, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          // Some WAF rules 403 requests with no/blank UA — set an explicit one.
          "user-agent": "simsa-central-plane/1.0",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = err; // network/abort — retryable
      lastStatus = null;
    } finally {
      clearTimeout(timer);
    }
    let retryAfterMs: number | null = null;
    if (resp) {
      if (resp.ok) {
        const data = (await resp.json()) as AnthropicMessagesData;
        breakerRecordSuccess(); // Anthropic이 살아 있다 — 차단 해제.
        // latency_ms is wall time including retries — what the user waited.
        logAnthropicUsage(callSite, body.model, data.usage, now() - startedAt, {
          endpointKind: target.kind,
          attempt,
          vendor: "anthropic",
        });
        return data;
      }
      const tail = await resp.text().catch(() => "");
      lastStatus = resp.status;
      lastErr = new Error(`Anthropic ${resp.status}: ${tail.slice(0, 200)}`);
      if (!RETRYABLE.has(resp.status)) {
        logAnthropicFailure(callSite, body.model, {
          finalStatus: resp.status,
          attempts: attempt,
          latencyMs: now() - startedAt,
          reason: "non_retryable",
          endpointKind: target.kind,
          triedByEndpoint,
        });
        throw lastErr;
      }
      retryAfterMs = parseRetryAfterMs(resp.headers.get("retry-after"), now());
      console.warn(`[anthropic-fetch] attempt ${attempt} via ${target.kind} got ${resp.status} — retrying`);
    }
    if (attempt >= MAX_ATTEMPTS) break;
    // A-1: 오류 종류별 대기. 남은 예산을 넘길 대기라면 더 시도하지 않고
    // 정직하게 실패한다 — 클라이언트 타임아웃까지 붙들고 있는 것이 더 나쁘다.
    const delay = retryDelayMs(lastStatus, attempt, retryAfterMs, opts.randomImpl);
    if (sleptTotalMs + delay > maxTotalMs) {
      logAnthropicFailure(callSite, body.model, {
        finalStatus: lastStatus,
        attempts: attempt,
        latencyMs: now() - startedAt,
        reason: "budget_exhausted",
        endpointKind: lastKind,
        triedByEndpoint,
      });
      breakerRecordFailure(now());
      return fallbackOrThrow(opts.fallback, body, timeoutMs, fetchImpl, callSite, now, startedAt, lastStatus, lastErr);
    }
    sleptTotalMs += delay;
    await sleep(delay);
  }
  logAnthropicFailure(callSite, body.model, {
    finalStatus: lastStatus,
    attempts: attemptsMade,
    latencyMs: now() - startedAt,
    reason: "attempts_exhausted",
    endpointKind: lastKind,
    triedByEndpoint,
  });
  breakerRecordFailure(now());
  return fallbackOrThrow(opts.fallback, body, timeoutMs, fetchImpl, callSite, now, startedAt, lastStatus, lastErr);
}

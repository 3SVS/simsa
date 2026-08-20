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
export function retryDelayMs(status: number | null, attempt: number, retryAfterMs: number | null): number {
  const jitter = (attempt * 137) % 400;
  if (status !== null && CAPACITY_RETRY.has(status)) {
    if (retryAfterMs !== null) return retryAfterMs + jitter;
    return Math.min(1000 * 2 ** (attempt - 1), 6000) + jitter;
  }
  // 403 등 egress성 오류 + 네트워크 예외: 종전 그대로 촘촘하게.
  return 500 * attempt + jitter;
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
  info: { finalStatus: number | null; attempts: number; latencyMs: number; reason: string },
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
      }),
    );
  } catch {
    // never let logging break the call
  }
}

/** POST /v1/messages with bounded retries. Throws on final failure. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
  // 예산은 **사용자가 기다린 실제 시간** 기준 — 대기뿐 아니라 요청 지연도 포함한다.
  const now = opts.nowImpl ?? (() => Date.now());
  const startedAt = now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: Response | null = null;
    try {
      resp = await fetchImpl(endpoint, {
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
        // latency_ms is wall time including retries — what the user waited.
        logAnthropicUsage(callSite, body.model, data.usage, now() - startedAt);
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
        });
        throw lastErr;
      }
      retryAfterMs = parseRetryAfterMs(resp.headers.get("retry-after"), now());
      console.warn(`[anthropic-fetch] attempt ${attempt} got ${resp.status} — retrying`);
    }
    if (attempt >= MAX_ATTEMPTS) break;
    // A-1: 오류 종류별 대기. 남은 예산을 넘길 대기라면 더 시도하지 않고
    // 정직하게 실패한다 — 클라이언트 타임아웃까지 붙들고 있는 것이 더 나쁘다.
    const delay = retryDelayMs(lastStatus, attempt, retryAfterMs);
    if (sleptTotalMs + delay > maxTotalMs) {
      logAnthropicFailure(callSite, body.model, {
        finalStatus: lastStatus,
        attempts: attempt,
        latencyMs: now() - startedAt,
        reason: "budget_exhausted",
      });
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
    sleptTotalMs += delay;
    await sleep(delay);
  }
  logAnthropicFailure(callSite, body.model, {
    finalStatus: lastStatus,
    attempts: attemptsMade,
    latencyMs: now() - startedAt,
    reason: "attempts_exhausted",
  });
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

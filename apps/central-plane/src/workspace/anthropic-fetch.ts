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
  /** A′-1: 성공한 경로와 몇 번째 시도였는지 — 경로별 성공률 집계의 반쪽. */
  meta?: { endpointKind?: EndpointKind; attempt?: number },
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
    /** A′-4: 지터 난수 주입(테스트 결정론화). */
    randomImpl?: () => number;
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
        // latency_ms is wall time including retries — what the user waited.
        logAnthropicUsage(callSite, body.model, data.usage, now() - startedAt, {
          endpointKind: target.kind,
          attempt,
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
    endpointKind: lastKind,
    triedByEndpoint,
  });
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

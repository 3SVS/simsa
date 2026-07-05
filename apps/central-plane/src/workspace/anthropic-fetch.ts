/**
 * anthropic-fetch.ts — shared Anthropic Messages call with retry.
 *
 * Live finding (2026-07-05 tail): Anthropic intermittently returns
 * 403 {"type":"forbidden","message":"Request not allowed"} to Cloudflare
 * Workers — shared egress IPs get flagged; the very next attempt (different
 * egress) succeeds. Observed success/403/success back-to-back on identical
 * requests. Every workspace LLM call therefore retries transient statuses.
 */

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 6; // 403 "Request not allowed" hits ~60% of CF egress
// attempts; more attempts + jitter is the only lever that raises success.

export type AnthropicMessagesBody = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
};

export type AnthropicMessagesData = {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
};

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
): Promise<AnthropicMessagesData> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
    } finally {
      clearTimeout(timer);
    }
    if (resp) {
      if (resp.ok) return (await resp.json()) as AnthropicMessagesData;
      const tail = await resp.text().catch(() => "");
      lastErr = new Error(`Anthropic ${resp.status}: ${tail.slice(0, 200)}`);
      if (!RETRYABLE.has(resp.status)) throw lastErr;
      console.warn(`[anthropic-fetch] attempt ${attempt} got ${resp.status} — retrying`);
    }
    if (attempt < MAX_ATTEMPTS) {
      // Jittered backoff — a longer, varied gap gives CF a chance to re-route
      // egress before the next attempt (retries otherwise reuse a hot IP).
      const base = 500 * attempt;
      await new Promise((r) => setTimeout(r, base + Math.floor((attempt * 137) % 400)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

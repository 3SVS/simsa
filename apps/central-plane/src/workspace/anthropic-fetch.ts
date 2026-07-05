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
const MAX_ATTEMPTS = 3;

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

export async function anthropicMessages(
  apiKey: string,
  body: AnthropicMessagesBody,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<AnthropicMessagesData> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: Response | null = null;
    try {
      resp = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
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
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

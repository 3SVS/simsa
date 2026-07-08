/**
 * workspace/langfuse.ts — minimal Langfuse wiring for the Simsa flow.
 *
 * Workers-safe: talks to the Langfuse public ingestion API with plain fetch
 * (no SDK — the Node SDK's batching/timers don't fit the Worker lifecycle;
 * packages/observability-langfuse is the Conclave/Node-side sink and stays
 * untouched). One trace + one generation per LLM call, carrying exactly the
 * `anthropic_usage` record (4 usage fields + model/call_site/latency_ms).
 *
 * Privacy: NO user content (idea/spec text) is sent — metadata only. That is
 * deliberate; revisit only with an explicit decision.
 *
 * Fail-open: misconfiguration or Langfuse downtime must never break or slow
 * a user call — callers fire this through ctx.waitUntil and every error is
 * swallowed into a single console.warn.
 */

export type LangfuseEnv = {
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
};

/** The observability record for one LLM call — same fields as the
 *  `anthropic_usage` console line, plus a trace name and safe metadata. */
export type LlmUsageRecord = {
  traceName: string;
  callSite: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  latencyMs: number;
  /** Safe, non-content metadata (locale, source, verification coverage …). */
  metadata?: Record<string, unknown>;
};

export function langfuseConfigured(env: LangfuseEnv): boolean {
  return Boolean(env.LANGFUSE_HOST && env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

/** Pure batch builder (Langfuse public ingestion envelope) — unit-testable. */
export function buildIngestionBatch(
  rec: LlmUsageRecord,
  ids: { traceId: string; generationId: string; eventId1: string; eventId2: string },
  endedAt: Date,
): { batch: unknown[] } {
  const end = endedAt.toISOString();
  const start = new Date(endedAt.getTime() - rec.latencyMs).toISOString();
  const metadata = {
    call_site: rec.callSite,
    cache_creation_input_tokens: rec.cacheCreationInputTokens,
    cache_read_input_tokens: rec.cacheReadInputTokens,
    latency_ms: rec.latencyMs,
    ...(rec.metadata ?? {}),
  };
  return {
    batch: [
      {
        id: ids.eventId1,
        type: "trace-create",
        timestamp: end,
        body: {
          id: ids.traceId,
          name: rec.traceName,
          timestamp: start,
          metadata,
        },
      },
      {
        id: ids.eventId2,
        type: "generation-create",
        timestamp: end,
        body: {
          id: ids.generationId,
          traceId: ids.traceId,
          name: rec.callSite,
          model: rec.model,
          startTime: start,
          endTime: end,
          usage: {
            input: rec.inputTokens,
            output: rec.outputTokens,
            total: rec.inputTokens + rec.outputTokens,
            unit: "TOKENS",
          },
          metadata,
        },
      },
    ],
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Send one LLM call's usage to Langfuse. No-op when env is not configured.
 * Never throws. Meant to run inside ctx.waitUntil (off the response path).
 */
export async function sendLangfuseGeneration(
  env: LangfuseEnv,
  rec: LlmUsageRecord,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<boolean> {
  if (!langfuseConfigured(env)) return false;
  try {
    const host = (env.LANGFUSE_HOST ?? "").trim().replace(/\/+$/, "");
    const body = buildIngestionBatch(
      rec,
      {
        traceId: crypto.randomUUID(),
        generationId: crypto.randomUUID(),
        eventId1: crypto.randomUUID(),
        eventId2: crypto.randomUUID(),
      },
      new Date(),
    );
    const resp = await fetchImpl(`${host}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${btoa(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`)}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok && resp.status !== 207) {
      console.warn(`[langfuse] ingestion ${resp.status} — trace dropped (fail-open)`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[langfuse] send failed — trace dropped (fail-open):", err);
    return false;
  }
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Langfuse minimal wiring (2026-07-09): one trace + one generation per LLM
// call via the public ingestion API. Env-gated, fail-open, metadata only —
// user content must never appear in the payload.

const { langfuseConfigured, buildIngestionBatch, sendLangfuseGeneration } =
  await import("../dist/workspace/langfuse.js");
const { generateIdeaToSpecDraft } = await import("../dist/workspace/generate.js");

const ENV = {
  LANGFUSE_HOST: "https://langfuse.example.test/",
  LANGFUSE_PUBLIC_KEY: "pk-lf-x",
  LANGFUSE_SECRET_KEY: "sk-lf-y",
};

const REC = {
  traceName: "workspace/idea-to-spec-draft",
  callSite: "generate",
  model: "claude-haiku-4-5-20251001",
  inputTokens: 1226,
  outputTokens: 5196,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  latencyMs: 39534,
  metadata: { source: "llm", locale: "ko", verification_ok: true },
};

describe("langfuseConfigured", () => {
  it("requires all three env values", () => {
    assert.equal(langfuseConfigured(ENV), true);
    assert.equal(langfuseConfigured({}), false);
    assert.equal(langfuseConfigured({ ...ENV, LANGFUSE_SECRET_KEY: undefined }), false);
  });
});

describe("buildIngestionBatch", () => {
  const ids = { traceId: "t1", generationId: "g1", eventId1: "e1", eventId2: "e2" };
  const end = new Date("2026-07-09T01:00:00.000Z");

  it("emits trace-create + generation-create with the usage fields", () => {
    const { batch } = buildIngestionBatch(REC, ids, end);
    assert.equal(batch.length, 2);
    const [trace, gen] = batch;
    assert.equal(trace.type, "trace-create");
    assert.equal(trace.body.id, "t1");
    assert.equal(trace.body.name, "workspace/idea-to-spec-draft");
    assert.equal(gen.type, "generation-create");
    assert.equal(gen.body.traceId, "t1");
    assert.equal(gen.body.model, "claude-haiku-4-5-20251001");
    assert.deepEqual(gen.body.usage, { input: 1226, output: 5196, total: 6422, unit: "TOKENS" });
    assert.equal(gen.body.metadata.cache_read_input_tokens, 0);
    assert.equal(gen.body.metadata.latency_ms, 39534);
    assert.equal(gen.body.metadata.locale, "ko");
    // startTime = endTime - latency
    assert.equal(new Date(gen.body.endTime) - new Date(gen.body.startTime), 39534);
  });

  it("never contains user content fields (key whitelist)", () => {
    const { batch } = buildIngestionBatch(REC, ids, end);
    const [trace, gen] = batch;
    // No `input`/`output` bodies (where Langfuse would carry content) — metadata only.
    assert.deepEqual(Object.keys(trace.body).sort(), ["id", "metadata", "name", "timestamp"]);
    assert.deepEqual(
      Object.keys(gen.body).sort(),
      ["endTime", "id", "metadata", "model", "name", "startTime", "traceId", "usage"],
    );
  });
});

describe("sendLangfuseGeneration", () => {
  it("posts to /api/public/ingestion with basic auth (trailing slash trimmed)", async () => {
    const calls = [];
    const ok = await sendLangfuseGeneration(ENV, REC, async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 207 });
    });
    assert.equal(ok, true);
    assert.equal(calls[0].url, "https://langfuse.example.test/api/public/ingestion");
    assert.ok(calls[0].init.headers.authorization.startsWith("Basic "));
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.batch.length, 2);
  });

  it("is a no-op when env is not configured", async () => {
    let called = false;
    const ok = await sendLangfuseGeneration({}, REC, async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    assert.equal(ok, false);
    assert.equal(called, false);
  });

  it("fail-open: fetch throw and non-2xx both return false, never throw", async () => {
    assert.equal(
      await sendLangfuseGeneration(ENV, REC, async () => {
        throw new Error("boom");
      }),
      false,
    );
    assert.equal(
      await sendLangfuseGeneration(ENV, REC, async () => new Response("no", { status: 401 })),
      false,
    );
  });
});

describe("generate llmUsage exposure", () => {
  it("mock path (no API key) carries no llmUsage — nothing to send to Langfuse", async () => {
    const res = await generateIdeaToSpecDraft({ idea: "동네 러닝 모임 앱", locale: "ko" }, undefined);
    assert.equal(res.ok, true);
    assert.equal(res.source, "mock-fallback");
    assert.equal(res.llmUsage, undefined);
  });
});

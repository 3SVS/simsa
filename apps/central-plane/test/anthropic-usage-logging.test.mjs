import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Minimal cost/usage observability (2026-07-08): every successful LLM call
// emits ONE structured JSON line — 4 usage fields + model + call_site +
// latency_ms — that tomorrow's Langfuse wiring ingests as-is. This pins that
// the usage fields survive from the API response to the logger.

const { anthropicMessages, logAnthropicUsage } = await import("../dist/workspace/anthropic-fetch.js");

const USAGE = {
  input_tokens: 2100,
  output_tokens: 900,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function okFetch() {
  return async () =>
    new Response(
      JSON.stringify({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: USAGE }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

function capturedUsageLines(logMock) {
  return logMock.mock.calls
    .map((c) => c.arguments[0])
    .filter((a) => typeof a === "string" && a.includes('"anthropic_usage"'))
    .map((a) => JSON.parse(a));
}

describe("anthropic usage logging", () => {
  it("usage fields reach the logger as one structured JSON line", async (t) => {
    const logMock = t.mock.method(console, "log");
    const data = await anthropicMessages(
      "key",
      { model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "x" }] },
      5000,
      okFetch(),
      "https://example.test/v1/messages",
      "generate",
    );
    assert.equal(data.usage.input_tokens, 2100, "usage must not be dropped from the response");

    const lines = capturedUsageLines(logMock);
    assert.equal(lines.length, 1, "exactly one structured usage line per call");
    const line = lines[0];
    assert.equal(line.event, "anthropic_usage");
    assert.equal(line.call_site, "generate");
    assert.equal(line.model, "claude-haiku-4-5-20251001");
    assert.equal(line.input_tokens, 2100);
    assert.equal(line.output_tokens, 900);
    assert.equal(line.cache_creation_input_tokens, 0);
    assert.equal(line.cache_read_input_tokens, 0);
    assert.equal(typeof line.latency_ms, "number");
    assert.ok(line.latency_ms >= 0);
  });

  it("missing usage in the response logs zeros, never throws", async (t) => {
    const logMock = t.mock.method(console, "log");
    await anthropicMessages(
      "key",
      { model: "m", max_tokens: 10, messages: [{ role: "user", content: "x" }] },
      5000,
      async () => new Response(JSON.stringify({ content: [] }), { status: 200 }),
      "https://example.test/v1/messages",
      "check",
    );
    const [line] = capturedUsageLines(logMock);
    assert.ok(line, "usage line still emitted");
    assert.equal(line.call_site, "check");
    assert.equal(line.input_tokens, 0);
    assert.equal(line.cache_read_input_tokens, 0);
  });

  it("logAnthropicUsage never throws on weird input", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    assert.doesNotThrow(() => logAnthropicUsage("x", "m", cyclic, 1));
  });

  it("failed calls emit no usage line", async (t) => {
    const logMock = t.mock.method(console, "log");
    await assert.rejects(
      anthropicMessages(
        "key",
        { model: "m", max_tokens: 10, messages: [{ role: "user", content: "x" }] },
        5000,
        async () => new Response("bad", { status: 400 }),
        "https://example.test/v1/messages",
        "fix",
      ),
    );
    assert.equal(capturedUsageLines(logMock).length, 0);
  });
});

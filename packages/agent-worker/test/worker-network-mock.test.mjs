import { test } from "node:test";
import assert from "node:assert/strict";
import { EfficiencyGate } from "@simsa/core";
import { ClaudeWorker } from "../dist/index.js";

/**
 * v0.14 update: rewrites the network-mock tests to use submit_rewrite
 * (full-file-rewrite) instead of submit_patch (unified diff).
 *
 * These tests exercise the full worker → SDK serialize → custom fetch
 * → SDK deserialize → worker code path.
 */

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

const VALID_REWRITES = [
  {
    path: "src/x.ts",
    content: "export const x: number = 1;\nexport const y = 2;\nexport const z = 3;\n",
  },
];

function makeAnthropicResponse({
  rewrites = VALID_REWRITES,
  commitMessage = "fix(x): annotate x as number",
  summary = "Resolves the type-error blocker.",
  inputTokens = 2_000,
  outputTokens = 400,
  cacheRead = 0,
} = {}) {
  return {
    id: "msg_network_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [
      {
        type: "tool_use",
        id: "toolu_01abc",
        name: "submit_rewrite",
        input: { rewrites, commitMessage, summary },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cacheRead,
    },
  };
}

const reviewCtx = {
  repo: "acme/x",
  pullNumber: 1,
  newSha: "abc123",
  reviews: [
    {
      agent: "claude",
      verdict: "rework",
      summary: "ts type missing",
      blockers: [
        { severity: "blocker", category: "type-error", message: "add explicit type annotation", file: "src/x.ts", line: 1 },
      ],
    },
  ],
  fileSnapshots: [
    { path: "src/x.ts", contents: "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n" },
  ],
};

async function makeAnthropicClient(fetchImpl) {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  return new Anthropic({ apiKey: "sk-ant-test-fake-key", fetch: fetchImpl });
}

test("network-mock: SDK + custom fetch returns the rewrite tool_use through the worker", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: typeof url === "string" ? url : url.toString(), method: init?.method, body: init?.body });
    return jsonResponse(makeAnthropicResponse());
  };
  const client = await makeAnthropicClient(fetchImpl);
  const worker = new ClaudeWorker({ apiKey: "sk-ant-test-fake-key", client, gate: new EfficiencyGate({ perPrUsd: 1 }) });
  const outcome = await worker.work(reviewCtx);

  assert.ok(Array.isArray(outcome.rewrites), "outcome.rewrites must be an array");
  assert.equal(outcome.rewrites.length, 1);
  assert.equal(outcome.rewrites[0].path, "src/x.ts");
  assert.equal(outcome.message, "fix(x): annotate x as number");
  assert.deepEqual(outcome.appliedFiles, ["src/x.ts"]);
  // SDK actually issued the HTTP call.
  assert.ok(calls.length >= 1, "expected at least one HTTP call");
  assert.match(calls[0].url, /\/v1\/messages/);
  assert.equal(calls[0].method, "POST");
});

test("network-mock: request body includes the worker system prompt + submit_rewrite tool", async () => {
  let capturedBody = null;
  const fetchImpl = async (url, init) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(makeAnthropicResponse());
  };
  const client = await makeAnthropicClient(fetchImpl);
  const worker = new ClaudeWorker({ apiKey: "sk-ant-test", client, gate: new EfficiencyGate({ perPrUsd: 1 }) });
  await worker.work(reviewCtx);

  assert.ok(capturedBody, "body was not captured");
  assert.ok(Array.isArray(capturedBody.system) || typeof capturedBody.system === "string");
  assert.ok(Array.isArray(capturedBody.tools), "tools must be an array");
  const toolNames = capturedBody.tools.map((t) => t.name);
  assert.ok(toolNames.includes("submit_rewrite"), `submit_rewrite missing; got ${toolNames.join(",")}`);
  assert.equal(capturedBody.tool_choice?.type, "tool");
  assert.equal(capturedBody.tool_choice?.name, "submit_rewrite");
});

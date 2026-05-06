import { test } from "node:test";
import assert from "node:assert/strict";
import { EfficiencyGate } from "@conclave-ai/core";
import { ClaudeWorker, parseRewriteToolUse, WORKER_SYSTEM_PROMPT } from "../dist/index.js";

function makeMockClient(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        const r = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return r;
      },
    },
  };
}

const VALID_REWRITES = [
  {
    path: "src/x.ts",
    content: "export const x: number = 1;\nexport const y = 2;\nexport const z = 3;\n",
  },
];

function rewriteResponse({
  rewrites = VALID_REWRITES,
  commitMessage = "fix(x): annotate x as number",
  summary = "Addresses type-error blocker from Claude.",
  inputTokens = 2_000,
  outputTokens = 400,
  cacheRead = 0,
} = {}) {
  return {
    id: "msg_test",
    model: "claude-sonnet-4-6",
    content: [
      {
        type: "tool_use",
        id: "tool_1",
        name: "submit_rewrite",
        input: { rewrites, commitMessage, summary },
      },
    ],
    stop_reason: "tool_use",
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
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

test("ClaudeWorker: returns a WorkerOutcome with rewrites, message, and appliedFiles", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([rewriteResponse()]);
  const worker = new ClaudeWorker({ apiKey: "test-key", gate, client });
  const outcome = await worker.work(reviewCtx);
  assert.ok(Array.isArray(outcome.rewrites), "outcome.rewrites must be an array");
  assert.equal(outcome.rewrites.length, 1);
  assert.equal(outcome.rewrites[0].path, "src/x.ts");
  assert.ok(outcome.rewrites[0].content.includes("x: number"));
  assert.equal(outcome.message, "fix(x): annotate x as number");
  assert.deepEqual(outcome.appliedFiles, ["src/x.ts"]);
  assert.ok(typeof outcome.costUsd === "number" && outcome.costUsd > 0);
  assert.ok(typeof outcome.tokensUsed === "number" && outcome.tokensUsed === 2_400);
});

test("ClaudeWorker: preserves empty-rewrites signal when worker gives up", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([
    rewriteResponse({ rewrites: [], commitMessage: "chore: no fix possible", summary: "Need the contents of src/other.ts to proceed." }),
  ]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  const outcome = await worker.work(reviewCtx);
  assert.deepEqual(outcome.rewrites, []);
  assert.deepEqual(outcome.appliedFiles, []);
});

test("ClaudeWorker: trims whitespace from rewrite paths and drops empty paths", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([
    rewriteResponse({
      rewrites: [
        { path: "  src/x.ts  ", content: "content-x" },
        { path: "", content: "should-be-dropped" },
        { path: "src/y.ts", content: "content-y" },
      ],
    }),
  ]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  const outcome = await worker.work(reviewCtx);
  assert.deepEqual(outcome.appliedFiles, ["src/x.ts", "src/y.ts"]);
});

test("ClaudeWorker: throws when response has no submit_rewrite tool_use block", async () => {
  const client = {
    calls: [],
    messages: {
      create: async () => ({
        id: "msg",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "here is some prose" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    },
  };
  const worker = new ClaudeWorker({ apiKey: "k", client, gate: new EfficiencyGate({ perPrUsd: 1 }) });
  await assert.rejects(() => worker.work(reviewCtx), /did not include a submit_rewrite tool_use/);
});

test("ClaudeWorker: throws when commitMessage is empty", async () => {
  const client = makeMockClient([rewriteResponse({ commitMessage: "   " })]);
  const worker = new ClaudeWorker({ apiKey: "k", client, gate: new EfficiencyGate({ perPrUsd: 1 }) });
  await assert.rejects(() => worker.work(reviewCtx), /commitMessage must be a non-empty string/);
});

test("ClaudeWorker: throws when rewrites is not an array", async () => {
  const client = makeMockClient([
    {
      id: "msg_test",
      model: "claude-sonnet-4-6",
      content: [
        {
          type: "tool_use",
          id: "t",
          name: "submit_rewrite",
          input: { rewrites: "not-an-array", commitMessage: "fix", summary: "ok" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 10 },
    },
  ]);
  const worker = new ClaudeWorker({ apiKey: "k", client, gate: new EfficiencyGate({ perPrUsd: 1 }) });
  await assert.rejects(() => worker.work(reviewCtx), /rewrites must be an array/);
});

test("ClaudeWorker: throws when a rewrite entry is missing path or content", async () => {
  const client = makeMockClient([
    rewriteResponse({ rewrites: [{ path: "src/x.ts" }] }), // missing content
  ]);
  const worker = new ClaudeWorker({ apiKey: "k", client, gate: new EfficiencyGate({ perPrUsd: 1 }) });
  await assert.rejects(() => worker.work(reviewCtx), /path and content/);
});

test("ClaudeWorker: sends system prompt with cache_control ephemeral", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([rewriteResponse()]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  await worker.work(reviewCtx);
  const params = client.calls[0];
  assert.ok(Array.isArray(params.system), "system should be an array of blocks for cache control");
  assert.equal(params.system[0].cache_control?.type, "ephemeral");
});

test("ClaudeWorker: forces submit_rewrite tool via tool_choice", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([rewriteResponse()]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  await worker.work(reviewCtx);
  const params = client.calls[0];
  assert.equal(params.tool_choice.type, "tool");
  assert.equal(params.tool_choice.name, "submit_rewrite");
});

test("ClaudeWorker: records a metric on the shared gate", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([rewriteResponse({ inputTokens: 5_000, outputTokens: 800 })]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  await worker.work(reviewCtx);
  const summary = gate.metrics.summary();
  assert.equal(summary.callCount, 1);
  assert.equal(summary.byAgent["worker"].calls, 1);
  assert.ok(summary.totalCostUsd > 0);
});

test("ClaudeWorker: respects a shared budget cap", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 0.005 });
  const client = makeMockClient([rewriteResponse({ inputTokens: 10_000, outputTokens: 1_000 })]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  await assert.rejects(() => worker.work(reviewCtx), /budget/);
});

test("ClaudeWorker: missing API key AND no injected client throws in constructor", () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.throws(() => new ClaudeWorker());
  } finally {
    if (orig !== undefined) process.env.ANTHROPIC_API_KEY = orig;
  }
});

test("ClaudeWorker: prompt includes blocker text and file snapshot contents", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([rewriteResponse()]);
  const worker = new ClaudeWorker({ apiKey: "k", gate, client });
  await worker.work(reviewCtx);
  const prompt = client.calls[0].messages[0].content;
  assert.ok(prompt.includes("add explicit type annotation"), "prompt should include blocker text");
  assert.ok(prompt.includes("export const x = 1;"), "prompt should include file snapshot contents");
  assert.ok(prompt.includes("src/x.ts"), "prompt should include file path");
  assert.ok(prompt.includes("abc123"), "prompt should include the head sha");
});

test("parseRewriteToolUse: direct parser happy path (no LLM)", () => {
  const response = {
    id: "m",
    model: "claude-sonnet-4-6",
    content: [
      {
        type: "tool_use",
        id: "t",
        name: "submit_rewrite",
        input: {
          rewrites: [{ path: "src/x.ts", content: "export const x: number = 1;\n" }],
          commitMessage: "fix: something",
          summary: "ok",
        },
      },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const parsed = parseRewriteToolUse(response);
  assert.equal(parsed.rewrites.length, 1);
  assert.equal(parsed.rewrites[0].path, "src/x.ts");
  assert.equal(parsed.message, "fix: something");
  assert.deepEqual(parsed.appliedFiles, ["src/x.ts"]);
});

test("WORKER_SYSTEM_PROMPT: instructs worker to write complete file contents", () => {
  const p = WORKER_SYSTEM_PROMPT;
  assert.match(p, /complete new file contents|full new content/i, "prompt must instruct worker to write full file");
  assert.match(p, /submit_rewrite/i, "prompt must mention submit_rewrite tool");
  assert.match(p, /every line/i, "prompt must emphasize preserving every line");
});

test("WORKER_SYSTEM_PROMPT: does not mention unified diff or git apply", () => {
  const p = WORKER_SYSTEM_PROMPT;
  assert.doesNotMatch(p, /unified.diff/i, "new prompt must NOT mention unified diff");
  assert.doesNotMatch(p, /git apply/i, "new prompt must NOT mention git apply");
  assert.doesNotMatch(p, /@@ .* @@/, "new prompt must NOT contain hunk headers");
});

// Edit mode (oversize files) — workEdits + parseEditToolUse + prompt shape.
// Pins: single submit_edits tool call, exact context echo, empty-edits signal
// preserved, parse validation, and that the prompt carries excerpts verbatim
// with line labels OUTSIDE the code fences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EfficiencyGate } from "@simsa/core";
import {
  ClaudeWorker,
  parseEditToolUse,
  buildEditWorkerPrompt,
  WorkerParseError,
  EDIT_TOOL_NAME,
} from "../dist/index.js";

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

const VALID_EDITS = [
  {
    path: "index.html",
    search: "const API = 'http://localhost:3000';",
    replace: "const API = 'https://api.example.com';",
  },
];

function editResponse({
  edits = VALID_EDITS,
  commitMessage = "fix(api): point API base at production",
  summary = "Replaces the localhost API base flagged by the blocker.",
  inputTokens = 2_000,
  outputTokens = 200,
} = {}) {
  return {
    id: "msg_test",
    model: "claude-sonnet-4-6",
    content: [
      {
        type: "tool_use",
        id: "tool_1",
        name: EDIT_TOOL_NAME,
        input: { edits, commitMessage, summary },
      },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0 },
  };
}

const editCtx = {
  repo: "acme/x",
  pullNumber: 0,
  newSha: "abc123",
  reviews: [
    {
      agent: "simsa",
      verdict: "rework",
      summary: "API base points at localhost",
      blockers: [
        { severity: "blocker", category: "wiring", message: "API base must not be localhost", file: "index.html", line: 812 },
      ],
    },
  ],
  fileExcerpts: [
    {
      path: "index.html",
      totalBytes: 398_336,
      totalLines: 9_120,
      regions: [
        {
          startLine: 800,
          endLine: 820,
          text: "  <script>\n    const API = 'http://localhost:3000';\n    fetch(API + '/items');\n  </script>",
        },
      ],
    },
  ],
};

test("workEdits: returns edits, message, appliedFiles via the submit_edits tool", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([editResponse()]);
  const worker = new ClaudeWorker({ apiKey: "test-key", gate, client });
  const outcome = await worker.workEdits(editCtx);

  assert.equal(outcome.edits.length, 1);
  assert.equal(outcome.edits[0].path, "index.html");
  assert.deepEqual(outcome.appliedFiles, ["index.html"]);
  assert.equal(outcome.message, "fix(api): point API base at production");
  assert.ok(outcome.tokensUsed > 0);

  // Single-tool contract: exactly one tool, forced choice.
  const call = client.calls[0];
  assert.equal(call.tools.length, 1);
  assert.equal(call.tools[0].name, EDIT_TOOL_NAME);
  assert.deepEqual(call.tool_choice, { type: "tool", name: EDIT_TOOL_NAME });
});

test("workEdits: empty edits array is preserved as a give-up signal", async () => {
  const gate = new EfficiencyGate({ perPrUsd: 1 });
  const client = makeMockClient([editResponse({ edits: [] })]);
  const worker = new ClaudeWorker({ apiKey: "test-key", gate, client });
  const outcome = await worker.workEdits(editCtx);
  assert.deepEqual(outcome.edits, []);
  assert.deepEqual(outcome.appliedFiles, []);
});

test("parseEditToolUse: drops entries with empty path or empty search", () => {
  const parsed = parseEditToolUse(
    editResponse({
      edits: [
        { path: "", search: "a", replace: "b" },
        { path: "index.html", search: "", replace: "b" },
        { path: "index.html", search: "keep me", replace: "kept" },
      ],
    }),
  );
  assert.equal(parsed.edits.length, 1);
  assert.equal(parsed.edits[0].search, "keep me");
});

test("parseEditToolUse: rejects malformed entries and missing tool block", () => {
  assert.throws(
    () =>
      parseEditToolUse(
        editResponse({ edits: [{ path: "x", search: 42, replace: "y" }] }),
      ),
    WorkerParseError,
  );
  assert.throws(
    () =>
      parseEditToolUse({
        id: "m",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "no tool" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    WorkerParseError,
  );
});

test("buildEditWorkerPrompt: excerpts are verbatim inside fences, line labels outside", () => {
  const prompt = buildEditWorkerPrompt(editCtx);
  assert.ok(prompt.includes("### lines 800-820"));
  assert.ok(prompt.includes("const API = 'http://localhost:3000';"));
  // The verbatim region must not have line numbers injected into it.
  assert.ok(!prompt.includes("800:"), "line numbers must not be mixed into region text");
  assert.ok(prompt.includes("398336 bytes"));
  assert.ok(prompt.includes("API base must not be localhost"));
});

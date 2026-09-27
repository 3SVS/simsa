/**
 * B5 — OpenAI 폴백의 다중 턴 블록 변환. 프로덕션은 Anthropic 킬스위치 상태라 빌드 루프가 OpenAI만으로 돌아야 한다.
 * 왕복 고정: Anthropic 블록 → OpenAI 메시지 → (가짜 OpenAI 응답) → Anthropic 응답, tool_use id 보존.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { toOpenAiMessages, callOpenAiAsAnthropic, withOpenAiFallback } = await import("../dist/openai-fallback.js");
const { runBuildLoop } = await import("../dist/build-loop.js");

describe("toOpenAiMessages", () => {
  it("문자열 content는 그대로", () => {
    assert.deepEqual(toOpenAiMessages({ role: "user", content: "hi" }), [{ role: "user", content: "hi" }]);
  });
  it("assistant: text + tool_use → content + tool_calls(arguments JSON)", () => {
    const out = toOpenAiMessages({ role: "assistant", content: [{ type: "text", text: "읽겠습니다" }, { type: "tool_use", id: "call_1", name: "read_file", input: { path: "src/worker.ts" } }] });
    assert.deepEqual(out, [{ role: "assistant", content: "읽겠습니다", tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"src/worker.ts"}' } }] }]);
  });
  it("assistant: tool_use만 있으면 content null", () => {
    const [m] = toOpenAiMessages({ role: "assistant", content: [{ type: "tool_use", id: "c", name: "finish", input: {} }] });
    assert.equal(m.content, null);
  });
  it("user: tool_result → role tool 메시지 하나씩, text는 user로", () => {
    const out = toOpenAiMessages({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "old" }, { type: "tool_result", tool_use_id: "call_2", content: "REFUSED", is_error: true }, { type: "text", text: "계속" }] });
    assert.deepEqual(out, [{ role: "tool", tool_call_id: "call_1", content: "old" }, { role: "tool", tool_call_id: "call_2", content: "REFUSED" }, { role: "user", content: "계속" }]);
  });
});

describe("빌드 루프가 OpenAI 폴백만으로 완주한다", () => {
  it("2턴: read_file → finish, 요청 본문에 tool 메시지·tool_choice required가 실린다", async () => {
    const bodies = [];
    let turn = 0;
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      turn += 1;
      const call = turn === 1
        ? { id: "call_read", function: { name: "read_file", arguments: JSON.stringify({ path: "src/worker.ts" }) } }
        : { id: "call_fin", function: { name: "finish", arguments: JSON.stringify({ status: "done", summary: "끝" }) } };
      return new Response(JSON.stringify({ id: "x", choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    };
    const client = withOpenAiFallback(null, { openaiApiKey: "sk-test", fetchImpl });
    const gate = { run: async (_i, ex) => { const r = await ex({ model: "gpt-5.4" }); return { result: r.result, metric: { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, latencyMs: r.latencyMs } }; } };
    const r = await runBuildLoop(
      { specMarkdown: "spec", wbsId: "WBS-001", wbsTitle: "t", acceptanceIds: [], locale: "ko", fileList: ["src/worker.ts"] },
      { client, executor: { readFile: async () => "old content", listFiles: async () => [], createFile: async () => {}, runCommand: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }) }, model: "gpt-5.4", gate },
    );
    assert.equal(r.status, "done", JSON.stringify(r));
    assert.equal(r.turns, 2);
    assert.equal(bodies[0].tool_choice, "required");
    assert.equal(bodies[0].tools.length, 5);
    // 두 번째 요청: assistant tool_calls + tool 결과가 OpenAI 형식으로 들어갔다
    const second = bodies[1].messages;
    const asst = second.find((m) => m.role === "assistant" && m.tool_calls);
    assert.equal(asst.tool_calls[0].id, "call_read");
    const toolMsg = second.find((m) => m.role === "tool");
    assert.deepEqual(toolMsg, { role: "tool", tool_call_id: "call_read", content: "old content" });
  });
  it("callOpenAiAsAnthropic은 블록 메시지를 거부하지 않는다(옛 코드는 throw)", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ id: "x", choices: [{ message: { content: "ok" } }], usage: {} }), { status: 200 });
    const res = await callOpenAiAsAnthropic({ model: "m", max_tokens: 10, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "c", name: "x", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "r" }] }] }, { openaiApiKey: "k", fetchImpl });
    assert.equal(res.content[0].text, "ok");
  });
});

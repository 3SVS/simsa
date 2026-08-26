/**
 * openai-fallback.test.mjs — 자동수리 워커의 벤더 폴백 (2026-08-26).
 *
 * 고정하는 계약:
 *   ① Anthropic이 실패하면 OpenAI로 넘어간다
 *   ② 패치는 **도구 호출**로 온다 — 자유 텍스트로 받으면 형식이 흔들려 적용이 깨진다
 *   ③ **조용히 빈 패치를 돌려주지 않는다** — "고쳤다"는 거짓말이 가장 나쁘다
 *   ④ 폴백이 실패하면 **원래 에러**를 던진다
 *   ⑤ 어느 벤더가 응답했는지 로그에 남는다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { withOpenAiFallback, callOpenAiAsAnthropic, fallbackOutputBudget } = await import(
  "../dist/openai-fallback.js"
);

const PARAMS = {
  model: "claude-sonnet-4-6",
  max_tokens: 16384,
  system: "you fix code",
  messages: [{ role: "user", content: "fix it" }],
  tools: [{ name: "rewrite_files", description: "rewrite", input_schema: { type: "object" } }],
  tool_choice: { type: "tool", name: "rewrite_files" },
};

const okToolCall = (args) =>
  new Response(
    JSON.stringify({
      id: "cc_1",
      choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "rewrite_files", arguments: args } }] }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    { status: 200 },
  );

async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(String(a[0]));
  try { return { result: await fn(), lines }; }
  catch (error) { return { error, lines }; }
  finally { console.log = orig; }
}
const events = (lines) => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

describe("①② Anthropic 실패 → OpenAI, 도구 호출로 받는다", () => {
  it("★패치가 tool_use 블록으로 온다", async () => {
    const primary = { messages: { create: async () => { throw new Error("403 forbidden"); } } };
    const c = withOpenAiFallback(primary, {
      openaiApiKey: "k",
      fetchImpl: async () => okToolCall('{"files":[{"path":"a.ts","content":"x"}]}'),
    });
    const res = await c.messages.create(PARAMS);
    assert.equal(res.content[0].type, "tool_use");
    assert.equal(res.content[0].name, "rewrite_files");
    assert.deepEqual(res.content[0].input, { files: [{ path: "a.ts", content: "x" }] });
  });

  it("도구를 반드시 쓰도록 강제해서 보낸다", async () => {
    let sent = null;
    await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "k",
      fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return okToolCall("{}"); },
    });
    assert.equal(sent.tools[0].type, "function");
    assert.equal(sent.tools[0].function.name, "rewrite_files");
    assert.deepEqual(sent.tool_choice, { type: "function", function: { name: "rewrite_files" } });
  });

  it("system 블록 배열도 하나의 system 메시지로 옮긴다", async () => {
    let sent = null;
    await callOpenAiAsAnthropic(
      { ...PARAMS, system: [{ type: "text", text: "A" }, { type: "text", text: "B" }] },
      { openaiApiKey: "k", fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return okToolCall("{}"); } },
    );
    assert.equal(sent.messages[0].role, "system");
    assert.match(sent.messages[0].content, /A[\s\S]*B/);
  });

  it("★추론 모델을 위해 출력 예산에 여유를 준다 — 잘린 패치는 통째로 못 쓴다", () => {
    assert.ok(fallbackOutputBudget(16384) > 16384);
    assert.ok(fallbackOutputBudget(1_000_000) <= 64_000, "상한은 있다");
  });
});

describe("③ 조용히 빈 패치를 돌려주지 않는다", () => {
  it("★도구 인자가 깨졌으면 tool_use 블록을 만들지 않는다", async () => {
    // 빈 입력으로 넘기면 호출부가 "빈 패치"를 정상 결과로 오해한다.
    const res = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "k",
      fetchImpl: async () => okToolCall("{깨진 JSON"),
    });
    assert.equal(res.content.filter((b) => b.type === "tool_use").length, 0);
  });

  it("잘린 응답은 stop_reason으로 드러난다", async () => {
    const res = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "k",
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "부분" }, finish_reason: "length" }] }), { status: 200 }),
    });
    assert.equal(res.stop_reason, "max_tokens");
  });
});

describe("④ 정직한 실패", () => {
  it("★폴백도 실패하면 원래 Anthropic 에러를 던진다", async () => {
    const primary = { messages: { create: async () => { throw new Error("Anthropic 403 forbidden"); } } };
    const c = withOpenAiFallback(primary, {
      openaiApiKey: "k",
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    await assert.rejects(c.messages.create(PARAMS), /Anthropic 403/);
  });

  it("Anthropic이 성공하면 폴백을 부르지 않는다", async () => {
    let called = false;
    const primary = { messages: { create: async () => ({ id: "a", model: "m", content: [], usage: {} }) } };
    const c = withOpenAiFallback(primary, {
      openaiApiKey: "k",
      fetchImpl: async () => { called = true; return okToolCall("{}"); },
    });
    await c.messages.create(PARAMS);
    assert.equal(called, false);
  });
});

describe("⑤ 킬스위치와 로그", () => {
  it("preferFallback이면 Anthropic을 아예 안 부른다", async () => {
    let primaryCalled = false;
    const primary = { messages: { create: async () => { primaryCalled = true; return {}; } } };
    const c = withOpenAiFallback(primary, {
      openaiApiKey: "k", preferFallback: true,
      fetchImpl: async () => okToolCall("{}"),
    });
    await c.messages.create(PARAMS);
    assert.equal(primaryCalled, false);
  });

  it("어느 벤더가 응답했는지 남는다", async () => {
    const primary = { messages: { create: async () => { throw new Error("boom"); } } };
    const c = withOpenAiFallback(primary, { openaiApiKey: "k", fetchImpl: async () => okToolCall("{}") });
    const { lines } = await captureLogs(() => c.messages.create(PARAMS));
    const ev = events(lines);
    assert.ok(ev.find((e) => e.event === "worker_llm_fallback"), "폴백 사실");
    assert.ok(ev.find((e) => e.event === "worker_llm_ok" && e.vendor === "openai"), "응답 벤더");
  });

  it("Anthropic 키가 없어도 폴백만으로 동작한다", async () => {
    const c = withOpenAiFallback(null, { openaiApiKey: "k", fetchImpl: async () => okToolCall('{"files":[]}') });
    const res = await c.messages.create(PARAMS);
    assert.equal(res.content[0].type, "tool_use");
  });
});

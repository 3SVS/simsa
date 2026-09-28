/**
 * Train L — L-2 실응답 모델 과금 (agent-worker: openai-fallback · build-loop · ClaudeWorker).
 *
 * 고정하는 계약:
 *   ⑤ OpenAI 폴백 응답이 실제 model·vendor·cached_tokens(→cache_read_input_tokens)를 싣는다.
 *   ⑥ 빌드 루프는 **응답의 실제 모델** 단가로 과금한다(요청 sonnet, 응답 gpt-5.4 → gpt-5.4 단가).
 *   ② 미지 모델 응답은 $0이 아니다(보수 단가 + unpricedCalls).
 *   ⑦ ClaudeWorker는 호출마다 usage 레코드를 onUsage로 내보낸다(파싱 실패해도 — 돈은 이미 나갔다).
 * 네트워크 0: fetch·client 주입.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { callOpenAiAsAnthropic, withOpenAiFallback } = await import("../dist/openai-fallback.js");
const { runBuildLoop } = await import("../dist/build-loop.js");
const { ClaudeWorker } = await import("../dist/index.js");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ""} expected ${b}, got ${a}`);

const openAiJson = (extra = {}) => ({
  id: "cc_1",
  choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "rewrite_files", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 1_000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } },
  ...extra,
});
const PARAMS = {
  model: "claude-sonnet-4-6",
  max_tokens: 1000,
  messages: [{ role: "user", content: "fix it" }],
  tools: [{ name: "rewrite_files", description: "rewrite", input_schema: { type: "object" } }],
  tool_choice: { type: "tool", name: "rewrite_files" },
};

describe("L-2 OpenAI 폴백 응답이 실제 모델·벤더·캐시 토큰을 싣는다", () => {
  it("⑤ model = 응답의 model, vendor = openai, cached_tokens → cache_read_input_tokens, input은 캐시 제외분", async () => {
    const res = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "test-openai-key",
      fetchImpl: async () => new Response(JSON.stringify(openAiJson({ model: "gpt-5.4-2026-03-05" })), { status: 200 }),
    });
    assert.equal(res.model, "gpt-5.4-2026-03-05");
    assert.equal(res.vendor, "openai");
    assert.equal(res.usage.input_tokens, 200);
    assert.equal(res.usage.cache_read_input_tokens, 800);
    assert.equal(res.usage.output_tokens, 50);
  });

  it("⑤ 응답에 model이 없으면 요청한 폴백 모델을 쓴다", async () => {
    const res = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "test-openai-key",
      fetchImpl: async () => new Response(JSON.stringify(openAiJson()), { status: 200 }),
    });
    assert.equal(res.model, "gpt-5.4");
  });

  it("⑤ primary(Anthropic)가 답하면 vendor = anthropic으로 표시된다", async () => {
    const primary = { messages: { create: async () => ({ id: "m", model: "claude-sonnet-4-6", content: [], usage: { input_tokens: 1, output_tokens: 1 } }) } };
    const c = withOpenAiFallback(primary, { openaiApiKey: "test-openai-key", fetchImpl: async () => { throw new Error("must not call"); } });
    const res = await c.messages.create(PARAMS);
    assert.equal(res.vendor, "anthropic");
    assert.equal(res.model, "claude-sonnet-4-6");
  });
});

const passGate = { run: async (_i, ex) => { const r = await ex({ model: "claude-sonnet-4-6" }); return { result: r.result, metric: { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, latencyMs: r.latencyMs } }; } };
const noopExecutor = { readFile: async () => "x", listFiles: async () => [], createFile: async () => {}, runCommand: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }) };
const TASK = { specMarkdown: "# 빵집 예약\nAC-001", wbsId: "WBS-001", wbsTitle: "예약 저장", acceptanceIds: ["AC-001"], locale: "ko", fileList: ["src/worker.ts"] };
const finishResponse = (model, usage, vendor) => ({
  id: "m1", model, ...(vendor ? { vendor } : {}),
  content: [{ type: "tool_use", id: "t1", name: "finish", input: { status: "done", summary: "끝" } }],
  usage,
});

describe("L-2 빌드 루프는 실제 응답 모델로 과금한다", () => {
  it("⑥ 요청 claude-sonnet-4-6 / 응답 gpt-5.4 → gpt-5.4 단가 + usage 레코드에 요청·실제 모델", async () => {
    const client = { messages: { create: async () => finishResponse("gpt-5.4", { input_tokens: 1_000, output_tokens: 500 }, "openai") } };
    const r = await runBuildLoop(TASK, { client, executor: noopExecutor, model: "claude-sonnet-4-6", gate: passGate });
    assert.equal(r.status, "done");
    near(r.costUsd, (1_000 * 2.5 + 500 * 15) / 1_000_000, "gpt-5.4 price");
    assert.equal(r.usage.length, 1);
    assert.equal(r.usage[0].modelRequested, "claude-sonnet-4-6");
    assert.equal(r.usage[0].modelActual, "gpt-5.4");
    assert.equal(r.usage[0].vendor, "openai");
    assert.equal(r.usage[0].inputTokens, 1_000);
    assert.equal(r.usage[0].outputTokens, 500);
    assert.equal(r.usage[0].unpriced, false);
    assert.equal(r.unpricedCalls, 0);
  });

  it("⑥ 캐시 읽기 토큰도 과금에 들어간다(OpenAI cached_tokens 매핑 경로)", async () => {
    const client = { messages: { create: async () => finishResponse("gpt-5.4", { input_tokens: 200, output_tokens: 0, cache_read_input_tokens: 800 }, "openai") } };
    const r = await runBuildLoop(TASK, { client, executor: noopExecutor, model: "claude-sonnet-4-6", gate: passGate });
    near(r.costUsd, (200 * 2.5 + 800 * 0.25) / 1_000_000);
    assert.equal(r.usage[0].cacheReadTokens, 800);
  });

  it("② 미지 모델 응답은 $0이 아니다 — 보수 단가 + unpricedCalls 집계 (실제 EfficiencyGate: forceModel을 따른다)", async () => {
    // #562 결함 8: 예전엔 passGate(모델을 claude-sonnet-4-6으로 고정, forceModel 무시)를 써서 옛 코드에서도
    // sonnet 단가 $3이 나왔다 — '$0으로 삼킴'(D-7 우회)을 재현하지 못했다. 실제 게이트는 forceModel(=요청 모델)을
    // 실행 함수에 넘기므로, 요청·응답이 모두 미지 모델이면 옛 safeEstimate/safeActual은 $0을 냈다.
    const { EfficiencyGate } = await import("@simsa/core");
    const gate = new EfficiencyGate({ perPrUsd: 100 });
    const client = { messages: { create: async () => finishResponse("test-model", { input_tokens: 1_000_000, output_tokens: 0 }) } };
    const r = await runBuildLoop(TASK, { client, executor: noopExecutor, model: "test-model", gate });
    assert.equal(r.status, "done");
    near(r.costUsd, 5);
    assert.equal(r.unpricedCalls, 1);
    assert.equal(r.usage[0].unpriced, true);
    assert.equal(r.usage[0].modelRequested, "test-model", "게이트가 넘긴 모델 = 요청 모델");
  });

  it("⑥ onUsage로 턴마다 한 번씩 흘려보낸다(컨테이너 콜백 usage[]의 원천)", async () => {
    const seen = [];
    const client = { messages: { create: async () => finishResponse("gpt-5.4", { input_tokens: 10, output_tokens: 5 }, "openai") } };
    await runBuildLoop(TASK, { client, executor: noopExecutor, model: "claude-sonnet-4-6", gate: passGate, onUsage: (u) => seen.push(u) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].modelActual, "gpt-5.4");
  });
});

const rewriteResponse = (model, vendor) => ({
  id: "msg", model, ...(vendor ? { vendor } : {}),
  content: [{ type: "tool_use", id: "t", name: "submit_rewrite", input: { rewrites: [{ path: "src/x.ts", content: "export const x = 1;\n" }], commitMessage: "fix: x", summary: "s" } }],
  usage: { input_tokens: 2_000, output_tokens: 400 },
});
const ctx = {
  repo: "acme/x", pullNumber: 0, newSha: "abc",
  reviews: [{ agent: "simsa", verdict: "rework", summary: "버튼이 안 눌려요", blockers: [{ severity: "blocker", category: "ui", message: "결제 버튼 무반응", file: "src/x.ts" }] }],
  fileSnapshots: [{ path: "src/x.ts", contents: "export const x = 0;\n" }],
};

describe("L-2 ClaudeWorker(수리 워커) — 실응답 모델 과금 + onUsage", () => {
  it("⑦ 요청 sonnet / 응답 gpt-5.4 → costUsd는 gpt-5.4 단가, onUsage 레코드에 요청·실제 모델·벤더", async () => {
    const seen = [];
    const client = { messages: { create: async () => rewriteResponse("gpt-5.4", "openai") } };
    const worker = new ClaudeWorker({ client, onUsage: (u) => seen.push(u) });
    const out = await worker.work(ctx);
    near(out.costUsd, (2_000 * 2.5 + 400 * 15) / 1_000_000);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].vendor, "openai");
    assert.equal(seen[0].modelRequested, "claude-sonnet-4-6");
    assert.equal(seen[0].modelActual, "gpt-5.4");
    assert.equal(seen[0].inputTokens, 2_000);
    assert.equal(seen[0].outputTokens, 400);
    assert.equal(typeof seen[0].latencyMs, "number");
  });

  it("⑦ 응답 파싱이 실패해도(도구 호출 없음) usage는 먼저 내보낸다 — 돈은 이미 나갔다", async () => {
    const seen = [];
    const client = { messages: { create: async () => ({ id: "m", model: "gpt-5.4", vendor: "openai", content: [{ type: "text", text: "말로만 답함" }], usage: { input_tokens: 7, output_tokens: 3 } }) } };
    const worker = new ClaudeWorker({ client, onUsage: (u) => seen.push(u) });
    await assert.rejects(worker.work(ctx));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].inputTokens, 7);
  });

  it("⑦ onUsage가 던져도 수리 호출은 깨지지 않는다", async () => {
    const client = { messages: { create: async () => rewriteResponse("claude-sonnet-4-6") } };
    const worker = new ClaudeWorker({ client, onUsage: () => { throw new Error("sink down"); } });
    const out = await worker.work(ctx);
    assert.equal(out.rewrites.length, 1);
  });
});

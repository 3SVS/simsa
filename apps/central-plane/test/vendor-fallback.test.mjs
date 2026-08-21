/**
 * vendor-fallback.test.mjs — Anthropic 차단 시 OpenAI 폴백 (2026-08-22).
 *
 * 실측 근거(/internal/llm-probe, 동시성 1·4):
 *   anthropic gateway 0/1·0/4 · direct 0/1·0/4 (403 forbidden)
 *   **openai 1/1·4/4 (200)** · gemini 400 "User location is not supported"
 * 재시도·백오프·경로 교대·지터로 네 번 시도해 네 번 실패한 뒤의 마지막 수단.
 *
 * 고정하는 계약:
 *   ① Anthropic이 끝내 실패하면 OpenAI로 같은 프롬프트를 던진다
 *   ② 응답은 **Anthropic 형태로 변환**되어 호출부는 폴백을 모른다
 *   ③ 폴백이 없거나(키 없음) 폴백도 실패하면 **원래 에러로 정직하게 실패**
 *   ④ 어느 벤더가 응답했는지 로그에 남는다(조용한 대체 금지)
 *   ⑤ Anthropic이 성공하면 폴백을 호출하지 않는다(무회귀)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { anthropicMessages, OPENAI_FALLBACK_MODEL, __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");

// 차단기는 isolate 전역이다 — 테스트 간에 상태가 새면 서로를 오염시킨다.
beforeEach(() => __resetAnthropicBreaker());

const GATEWAY = "https://gateway.example/anthropic/v1/messages";
const BODY = { model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: "hi" }] };
const FB = { openaiApiKey: "sk-openai", openaiBaseUrl: "https://gateway.example/openai" };

const forbidden = () => new Response('{"error":{"type":"forbidden","message":"Request not allowed"}}', { status: 403 });
const anthropicOk = () => new Response(JSON.stringify({ content: [{ type: "text", text: "from-anthropic" }], usage: { input_tokens: 1, output_tokens: 2 } }), { status: 200 });
const openAiOk = () => new Response(JSON.stringify({ choices: [{ message: { content: "from-openai" } }], usage: { prompt_tokens: 11, completion_tokens: 22 } }), { status: 200 });

const isOpenAi = (url) => String(url).includes("/chat/completions");
function recorder() {
  let clock = 1_000_000;
  return { sleepImpl: async (ms) => { clock += ms; }, nowImpl: () => clock, randomImpl: () => 0.5 };
}
async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(String(a[0])); };
  try { return { result: await fn(), lines }; }
  catch (error) { return { error, lines }; }
  finally { console.log = orig; }
}
const parsed = (lines) => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

describe("벤더 폴백 — Anthropic 차단 시 OpenAI (①②④)", () => {
  it("★Anthropic이 403으로 전멸해도 OpenAI로 응답을 받아온다", async () => {
    const opts = { ...recorder(), fallback: FB };
    const urls = [];
    const fetchImpl = async (url) => { urls.push(url); return isOpenAi(url) ? openAiOk() : forbidden(); };
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts);
    assert.equal(data.content[0].text, "from-openai", "OpenAI 응답이 반환된다");
    assert.equal(data.content[0].type, "text", "Anthropic 형태로 변환된다(②)");
    assert.ok(urls.some(isOpenAi), "OpenAI가 호출됐다");
    assert.equal(urls.filter((u) => !isOpenAi(u)).length, 6, "Anthropic은 6회 다 시도한 뒤 폴백");
  });

  it("usage가 OpenAI 필드에서 옮겨진다", async () => {
    const opts = { ...recorder(), fallback: FB };
    const fetchImpl = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts);
    assert.equal(data.usage.input_tokens, 11);
    assert.equal(data.usage.output_tokens, 22);
  });

  it("④ 어느 벤더가 응답했는지 로그에 남는다 — 조용한 대체 금지", async () => {
    const opts = { ...recorder(), fallback: FB };
    const fetchImpl = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    const { lines } = await captureLogs(() => anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts));
    const logs = parsed(lines);
    const usage = logs.find((j) => j.event === "anthropic_usage");
    assert.equal(usage.vendor, "openai", "실제 응답 벤더가 기록된다");
    assert.equal(usage.model, OPENAI_FALLBACK_MODEL);
    const fb = logs.find((j) => j.event === "llm_fallback");
    assert.ok(fb, "폴백 사실이 별도 이벤트로 남는다");
    assert.equal(fb.from, "anthropic");
    assert.equal(fb.to, "openai");
    assert.equal(fb.primary_status, 403);
  });
});

describe("벤더 폴백 — 정직한 실패 (③)", () => {
  it("OpenAI 키가 없으면 종전처럼 원래 에러로 실패한다", async () => {
    const opts = { ...recorder() }; // fallback 없음
    const fetchImpl = async () => forbidden();
    await assert.rejects(
      anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts),
      /Anthropic 403/,
    );
  });

  it("폴백도 실패하면 **원래 Anthropic 에러**를 던진다 (원인이 더 유용)", async () => {
    const opts = { ...recorder(), fallback: FB };
    const fetchImpl = async (url) => (isOpenAi(url) ? new Response("nope", { status: 500 }) : forbidden());
    await assert.rejects(
      anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts),
      /Anthropic 403/,
    );
  });

  it("폴백 실패도 로그에 남는다", async () => {
    const opts = { ...recorder(), fallback: FB };
    const fetchImpl = async (url) => (isOpenAi(url) ? new Response("nope", { status: 500 }) : forbidden());
    const { lines } = await captureLogs(() => anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts));
    assert.ok(parsed(lines).some((j) => j.event === "llm_fallback_failed"));
  });
});

describe("벤더 폴백 — 무회귀 (⑤)", () => {
  it("Anthropic이 성공하면 OpenAI를 호출하지 않는다", async () => {
    const opts = { ...recorder(), fallback: FB };
    const urls = [];
    const fetchImpl = async (url) => { urls.push(url); return anthropicOk(); };
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", opts);
    assert.equal(data.content[0].text, "from-anthropic");
    assert.ok(!urls.some(isOpenAi), "폴백 미호출");
  });

  it("성공 로그의 vendor는 anthropic으로 남는다", async () => {
    const opts = { ...recorder(), fallback: FB };
    const fetchImpl = async () => anthropicOk();
    const { lines } = await captureLogs(() => anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "generate", opts));
    const usage = parsed(lines).find((j) => j.event === "anthropic_usage");
    assert.equal(usage.vendor, "anthropic");
  });
});

describe("회로 차단기 — 죽은 벤더를 반복해 두드리지 않는다", () => {
  it("연속 실패 후 다음 호출은 Anthropic을 아예 건너뛰고 폴백으로 간다", async () => {
    const fetchFail = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    // 임계(2회)까지 실패시킨다.
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });

    const urls = [];
    const data = await anthropicMessages(
      "k", BODY, 1000,
      async (url) => { urls.push(url); return isOpenAi(url) ? openAiOk() : forbidden(); },
      GATEWAY, "check", { ...recorder(), fallback: FB },
    );
    assert.equal(data.content[0].text, "from-openai");
    assert.ok(!urls.some((u) => !isOpenAi(u)), "★Anthropic을 한 번도 두드리지 않는다 — 12초 낭비 제거");
  });

  it("차단 사실이 로그에 남는다", async () => {
    const fetchFail = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    const opts = () => ({ ...recorder(), fallback: FB });
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", opts());
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", opts());
    const { lines } = await captureLogs(() => anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", opts()));
    const ev = parsed(lines).find((j) => j.event === "llm_breaker_open");
    assert.ok(ev, "무엇을 건너뛰었는지 남는다");
    assert.equal(ev.skipped, "anthropic");
  });

  it("★폴백이 없으면 차단하지 않는다 — 유일한 경로를 스스로 끊지 않는다", async () => {
    const fetchFail = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });

    const urls = [];
    await assert.rejects(
      anthropicMessages("k", BODY, 1000, async (url) => { urls.push(url); return forbidden(); }, GATEWAY, "check", recorder()),
      /Anthropic 403/,
    );
    assert.equal(urls.length, 6, "폴백 없으면 종전대로 6회 다 시도한다");
  });

  it("쿨다운이 지나면 한 번 다시 통과시켜 살아났는지 확인한다 (half-open)", async () => {
    const fetchFail = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });

    // 60초 뒤의 시계로 호출 — 차단이 풀려 Anthropic을 다시 시도해야 한다.
    let clock = Date.now() + 120_000;
    const urls = [];
    const data = await anthropicMessages(
      "k", BODY, 1000,
      async (url) => { urls.push(url); return anthropicOk(); },
      GATEWAY, "check",
      { sleepImpl: async (ms) => { clock += ms; }, nowImpl: () => clock, randomImpl: () => 0.5, fallback: FB },
    );
    assert.equal(data.content[0].text, "from-anthropic", "살아났으면 원래 벤더로 돌아온다");
    assert.ok(urls.some((u) => !isOpenAi(u)), "Anthropic을 다시 시도했다");
  });

  it("Anthropic이 한 번 성공하면 차단기가 즉시 리셋된다", async () => {
    const fetchFail = async (url) => (isOpenAi(url) ? openAiOk() : forbidden());
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });
    let clock = Date.now() + 120_000;
    const late = { sleepImpl: async (ms) => { clock += ms; }, nowImpl: () => clock, randomImpl: () => 0.5, fallback: FB };
    await anthropicMessages("k", BODY, 1000, async () => anthropicOk(), GATEWAY, "check", late);

    // 실패 카운트가 0이므로, 다음 실패 1회로는 차단되지 않는다.
    const urls = [];
    await anthropicMessages("k", BODY, 1000, fetchFail, GATEWAY, "check", { ...recorder(), fallback: FB });
    await anthropicMessages("k", BODY, 1000, async (url) => { urls.push(url); return isOpenAi(url) ? openAiOk() : forbidden(); }, GATEWAY, "check", { ...recorder(), fallback: FB });
    assert.ok(urls.some((u) => !isOpenAi(u)), "리셋 후엔 다시 Anthropic부터 시도한다");
  });
});

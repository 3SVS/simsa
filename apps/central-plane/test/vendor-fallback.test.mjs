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

const { anthropicMessages, OPENAI_FALLBACK_MODEL, __resetAnthropicBreaker, fallbackOutputBudget, stripAssistantPrefill } = await import("../dist/workspace/anthropic-fetch.js");

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

describe("★추론 모델의 잘림 (2026-08-24 라이브 실측으로 잡힘)", () => {
  // 실측: Anthropic max_tokens를 그대로 넘겼더니 gpt-5.4가 예산을 추론에 나눠 쓰고
  // 본문이 6,179자에서 끊겨 JSON 파싱이 실패했다(정상 Anthropic 응답은 12,449자).
  // 폴백이 "성공"으로 보이는데 결과는 못 쓰는, 가장 나쁜 실패 모양이었다.

  it("폴백 예산은 원래 예산보다 넉넉하다 — 추론 토큰이 같은 주머니에서 나간다", () => {
    assert.ok(fallbackOutputBudget(4000) > 4000);
    assert.ok(fallbackOutputBudget(500) >= 8000, "작은 요청도 최소 여유는 준다");
  });

  it("상한이 있다 — 무한정 키우지 않는다", () => {
    assert.ok(fallbackOutputBudget(1_000_000) <= 32000);
  });

  it("실제 요청에 늘어난 예산이 실린다", async () => {
    let sent = null;
    const fetchImpl = async (url, init) => {
      if (isOpenAi(url)) { sent = JSON.parse(init.body); return openAiOk(); }
      return forbidden();
    };
    await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "generate", { ...recorder(), fallback: FB });
    assert.equal(sent.max_completion_tokens, fallbackOutputBudget(BODY.max_tokens));
    assert.ok(sent.max_completion_tokens > BODY.max_tokens);
  });

  it("★잘리면 stop_reason으로 호출부에 보인다 — 종전엔 원인 모를 파싱 실패였다", async () => {
    const truncated = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"partial":' }, finish_reason: "length" }],
          usage: { prompt_tokens: 10, completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 3800 } },
        }),
        { status: 200 },
      );
    const fetchImpl = async (url) => (isOpenAi(url) ? truncated() : forbidden());
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "generate", { ...recorder(), fallback: FB });
    assert.equal(data.stop_reason, "max_tokens", "Anthropic 어휘로 옮겨 호출부가 알아본다");
  });

  it("잘림이 추론 토큰과 함께 로그에 남는다 — 예산을 계측으로 조정하려고", async () => {
    const fetchImpl = async (url) =>
      isOpenAi(url)
        ? new Response(
            JSON.stringify({
              choices: [{ message: { content: "x" }, finish_reason: "length" }],
              usage: { completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 3800 } },
            }),
            { status: 200 },
          )
        : forbidden();
    const { lines } = await captureLogs(() =>
      anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "generate", { ...recorder(), fallback: FB }),
    );
    const ev = parsed(lines).find((j) => j.event === "llm_fallback_truncated");
    assert.ok(ev, "잘림 이벤트가 있어야 한다");
    assert.equal(ev.reasoning_tokens, 3800);
  });

  it("정상 종료면 stop_reason을 지어내지 않는다", async () => {
    const fetchImpl = async (url) =>
      isOpenAi(url)
        ? new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 })
        : forbidden();
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "generate", { ...recorder(), fallback: FB });
    assert.notEqual(data.stop_reason, "max_tokens");
  });
});

describe("★assistant prefill의 벤더 간 번역 (2026-08-24 실측)", () => {
  // Anthropic은 마지막 assistant 메시지 **뒤를 이어서** 쓴다. generate.ts는 그걸
  // 이용해 `{`를 prefill로 주고 응답 앞에 `{`를 되붙인다. OpenAI는 이어쓰기를
  // 하지 않고 완전한 JSON을 준다 — 되붙이면 `{{...}`가 되어 파싱이 깨졌다.
  // 실제 라이브 로그가 정확히 `head: {{` 였고, **폴백은 prefill을 쓰는 모든
  // 호출부에서 조용히 망가져 있었다.**
  const PREFILLED = [
    { role: "user", content: "make json" },
    { role: "assistant", content: "{" },
  ];

  it("완전한 JSON이 오면 prefill 조각을 떼어낸다 — 호출부가 되붙여도 정상", () => {
    const out = stripAssistantPrefill('{"a":1}', PREFILLED);
    assert.equal(out, '"a":1}');
    assert.equal("{" + out, '{"a":1}', "호출부의 되붙이기와 합쳐 유효한 JSON");
  });

  it("앞 공백이 있어도 떼어낸다", () => {
    const leading = String.fromCharCode(10) + '  {"a":1}';
    assert.equal("{" + stripAssistantPrefill(leading, PREFILLED), '{"a":1}');
  });

  it("이미 이어쓰기 모양이면 손대지 않는다", () => {
    assert.equal(stripAssistantPrefill('"a":1}', PREFILLED), '"a":1}');
  });

  it("prefill이 없는 호출부는 영향받지 않는다 (검수·수정 등 — 이들은 멀쩡했다)", () => {
    const plain = [{ role: "user", content: "hi" }];
    assert.equal(stripAssistantPrefill('{"a":1}', plain), '{"a":1}');
  });

  it("빈 prefill·빈 메시지에도 던지지 않는다", () => {
    assert.equal(stripAssistantPrefill("x", [{ role: "assistant", content: "" }]), "x");
    assert.equal(stripAssistantPrefill("x", []), "x");
  });

  it("★폴백 전체 경로에서 실증 — prefill 호출부가 유효한 JSON을 얻는다", async () => {
    const body = { model: "m", max_tokens: 500, messages: PREFILLED };
    const fetchImpl = async (url) =>
      isOpenAi(url)
        ? new Response(
            JSON.stringify({ choices: [{ message: { content: '{"productName":"내 앱"}' }, finish_reason: "stop" }], usage: {} }),
            { status: 200 },
          )
        : forbidden();
    const data = await anthropicMessages("k", body, 1000, fetchImpl, GATEWAY, "generate", { ...recorder(), fallback: FB });
    const reassembled = "{" + data.content[0].text;
    assert.deepEqual(JSON.parse(reassembled), { productName: "내 앱" }, "한글 값도 온전하다 (Rule 6)");
  });
});

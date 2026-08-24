/**
 * vendor-routing.test.mjs — 벤더 라우팅 단일 출처 (2026-08-25).
 *
 * 고정하는 계약:
 *   ① OpenAI 키가 없으면 폴백 자체가 없다 — 종전과 완전히 동일하게 동작
 *   ② 킬스위치는 **명시적으로 "off"** 일 때만 켜진다(값 없음 = 종전 동작)
 *   ③ 켜지면 Anthropic을 **한 번도** 두드리지 않는다 — 그게 이 스위치의 목적
 *   ④ 폴백이 없으면 스위치가 켜져 있어도 Anthropic을 쓴다 — 유일한 경로를 끊지 않는다
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { vendorFallback } = await import("../dist/workspace/vendor-routing.js");
const { anthropicMessages, __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");

beforeEach(() => __resetAnthropicBreaker());

const BODY = { model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: "hi" }] };
const GATEWAY = "https://gateway.example/anthropic/v1/messages";
const isOpenAi = (u) => String(u).includes("/chat/completions");
const clock = () => {
  let t = 1_000_000;
  return { sleepImpl: async (ms) => { t += ms; }, nowImpl: () => t, randomImpl: () => 0.5 };
};

describe("설정 해석 (①②)", () => {
  it("OpenAI 키가 없으면 undefined — 종전 동작 유지", () => {
    assert.equal(vendorFallback({}), undefined);
    assert.equal(vendorFallback({ ANTHROPIC_ENABLED: "off" }), undefined, "키 없이 스위치만 켜도 폴백은 없다");
  });

  it('명시적 "off"일 때만 preferFallback', () => {
    assert.equal(vendorFallback({ OPENAI_API_KEY: "k" }).preferFallback, undefined);
    assert.equal(vendorFallback({ OPENAI_API_KEY: "k", ANTHROPIC_ENABLED: "on" }).preferFallback, undefined);
    assert.equal(vendorFallback({ OPENAI_API_KEY: "k", ANTHROPIC_ENABLED: "" }).preferFallback, undefined);
    assert.equal(vendorFallback({ OPENAI_API_KEY: "k", ANTHROPIC_ENABLED: "off" }).preferFallback, true);
  });

  it("게이트웨이 주소를 그대로 전달한다", () => {
    const fb = vendorFallback({ OPENAI_API_KEY: "k", CF_AI_GATEWAY_OPENAI_URL: "https://gw/openai" });
    assert.equal(fb.openaiBaseUrl, "https://gw/openai");
  });
});

describe("★스위치가 켜지면 Anthropic을 한 번도 안 두드린다 (③)", () => {
  it("첫 요청부터 곧장 폴백 — 차단기와 달리 학습이 필요 없다", async () => {
    const urls = [];
    const fetchImpl = async (u) => {
      urls.push(u);
      return isOpenAi(u)
        ? new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 })
        : new Response("{}", { status: 403 });
    };
    const fb = vendorFallback({ OPENAI_API_KEY: "k", ANTHROPIC_ENABLED: "off" });
    const data = await anthropicMessages("ant", BODY, 1000, fetchImpl, GATEWAY, "check", { ...clock(), fallback: fb });
    assert.equal(data.content[0].text, "ok");
    assert.equal(urls.filter((u) => !isOpenAi(u)).length, 0, "★Anthropic 호출 0회 — 7초 낭비 제거");
  });

  it("건너뛴 사실이 로그에 남는다 — 조용히 벤더가 바뀌지 않는다", async () => {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(String(a[0]));
    try {
      await anthropicMessages(
        "ant", BODY, 1000,
        async (u) => (isOpenAi(u)
          ? new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
          : new Response("{}", { status: 403 })),
        GATEWAY, "generate",
        { ...clock(), fallback: vendorFallback({ OPENAI_API_KEY: "k", ANTHROPIC_ENABLED: "off" }) },
      );
    } finally { console.log = orig; }
    const ev = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean).find((j) => j.event === "llm_primary_skipped");
    assert.ok(ev, "건너뛴 이벤트가 있어야 한다");
    assert.equal(ev.reason, "anthropic_disabled");
  });

  it("★폴백이 없으면 스위치가 켜져 있어도 Anthropic을 쓴다 (④)", async () => {
    const urls = [];
    await assert.rejects(
      anthropicMessages("ant", BODY, 1000, async (u) => { urls.push(u); return new Response("{}", { status: 403 }); },
        GATEWAY, "check", { ...clock(), fallback: vendorFallback({ ANTHROPIC_ENABLED: "off" }) }),
      /Anthropic 403/,
    );
    assert.equal(urls.length, 6, "유일한 경로를 스스로 끊지 않는다");
  });

  it("스위치가 꺼져 있으면 종전대로 Anthropic부터 (무회귀)", async () => {
    const urls = [];
    const fetchImpl = async (u) => {
      urls.push(u);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "from-anthropic" }], usage: {} }), { status: 200 });
    };
    const data = await anthropicMessages("ant", BODY, 1000, fetchImpl, GATEWAY, "check", {
      ...clock(), fallback: vendorFallback({ OPENAI_API_KEY: "k" }),
    });
    assert.equal(data.content[0].text, "from-anthropic");
    assert.ok(!urls.some(isOpenAi));
  });
});

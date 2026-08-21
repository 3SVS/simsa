/**
 * llm-probe.test.mjs — 관측 도구의 안전 계약.
 * 이 엔드포인트는 프로덕션 키로 외부를 때리므로, 보호와 무누출이 계약이다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const TOKEN = "tok_probe_test";
const ORIGIN = "https://app.trysimsa.com";

function envWith(overrides = {}) {
  return {
    INTERNAL_CALLBACK_TOKEN: TOKEN,
    ANTHROPIC_API_KEY: "sk-ant-secret-value",
    OPENAI_API_KEY: "sk-openai-secret-value",
    GEMINI_API_KEY: "gemini-secret-value",
    CF_AI_GATEWAY_ANTHROPIC_URL: "https://gateway.example/anthropic",
    ...overrides,
  };
}

async function post(env, { token = TOKEN, query = "" } = {}) {
  return createApp().request(
    `/internal/llm-probe${query}`,
    { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN } },
    env,
  );
}

describe("/internal/llm-probe — 보호", () => {
  it("토큰 없으면 401", async () => {
    const res = await post(envWith(), { token: "" });
    assert.equal(res.status, 401);
  });

  it("틀린 토큰이면 401", async () => {
    const res = await post(envWith(), { token: "wrong" });
    assert.equal(res.status, 401);
  });

  it("서버에 토큰이 설정 안 됐으면 503 — 무보호로 열리지 않는다", async () => {
    const res = await post(envWith({ INTERNAL_CALLBACK_TOKEN: undefined }), { token: "anything" });
    assert.equal(res.status, 503);
  });
});

describe("/internal/llm-probe — 결과 형태와 무누출", () => {
  it("키가 없는 벤더는 no_key로 표기되고 호출하지 않는다", async () => {
    const res = await post(envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.results.every((r) => r.status === "no_key"), "키 없으면 전부 no_key");
    assert.ok(body.results.every((r) => r.ms === 0), "호출 자체를 하지 않는다");
  });

  it("★응답에 어떤 벤더 키도 담기지 않는다", async () => {
    const res = await post(envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined }));
    const text = JSON.stringify(await res.json());
    for (const secret of ["sk-ant-secret-value", "sk-openai-secret-value", "gemini-secret-value"]) {
      assert.ok(!text.includes(secret), `키가 응답에 노출되면 안 된다: ${secret}`);
    }
  });

  it("동시성 n은 1~4로 제한된다 (프로덕션 예산 보호)", async () => {
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    const big = await (await post(env, { query: "?n=99" })).json();
    assert.equal(big.concurrency, 4, "상한 4");
    const zero = await (await post(env, { query: "?n=0" })).json();
    assert.equal(zero.concurrency, 1, "하한 1");
  });

  it("벤더·경로별 요약이 함께 나온다 (사람이 한눈에 판단)", async () => {
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    const body = await (await post(env)).json();
    assert.ok(body.summary["anthropic:gateway"], "게이트웨이 경로 집계");
    assert.ok(body.summary["anthropic:direct"], "직행 경로 집계");
    assert.ok(body.summary["openai:direct"] || body.summary["openai:gateway"]);
    assert.ok(body.summary["gemini:direct"] || body.summary["gemini:gateway"]);
  });
});

describe("/internal/llm-probe — usable (200 ≠ 쓸 만하다)", () => {
  it("★요약이 ok와 usable을 따로 센다", async () => {
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    const body = await (await post(env)).json();
    for (const [key, s] of Object.entries(body.summary)) {
      assert.equal(typeof s.usable, "number", `${key}에 usable 집계가 있어야 한다`);
      assert.equal(typeof s.ok, "number");
    }
  });

  it("키가 없으면 usable은 0이다 — 호출하지 않았으니 쓸 만함도 증명 못 한다", async () => {
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    const body = await (await post(env)).json();
    assert.ok(Object.values(body.summary).every((s) => s.usable === 0));
  });
});

describe("/internal/llm-probe — 전용 토큰 (관측/콜백 분리)", () => {
  it("LLM_PROBE_TOKEN이 있으면 그것으로 연다", async () => {
    const env = envWith({ LLM_PROBE_TOKEN: "probe_only", ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    assert.equal((await post(env, { token: "probe_only" })).status, 200);
  });

  it("전용 토큰이 설정되면 내부 콜백 토큰으로는 열리지 않는다 (권한 분리)", async () => {
    const env = envWith({ LLM_PROBE_TOKEN: "probe_only", ANTHROPIC_API_KEY: undefined });
    assert.equal((await post(env, { token: TOKEN })).status, 401);
  });

  it("전용 토큰이 없으면 기존 내부 토큰으로 연다 (하위호환)", async () => {
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    assert.equal((await post(env, { token: TOKEN })).status, 200);
  });
});

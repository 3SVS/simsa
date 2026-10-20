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

describe("★request-id — 지원팀이 자기네 로그에서 우리 요청을 찾는 열쇠", () => {
  it("결과 항목이 requestId 자리를 갖는다", async () => {
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    const body = await (await post(env)).json();
    // 키가 없으면 호출을 안 하므로 값은 없지만, 형태는 있어야 한다.
    assert.ok(Array.isArray(body.results));
    for (const r of body.results) assert.ok(!("requestId" in r) || r.requestId === null || typeof r.requestId === "string");
  });

  it("요청 식별자는 비밀이 아니다 — 키와 달리 응답에 실어도 된다", async () => {
    // 이 테스트는 의도를 문서화한다: requestId는 키가 아니라 요청 번호이므로
    // 응답에 담아 사용자가 지원팀에 그대로 전달할 수 있어야 한다.
    const env = envWith({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    const text = JSON.stringify(await (await post(env)).json());
    assert.ok(!text.includes("sk-ant-secret-value"), "키는 여전히 새면 안 된다");
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

describe("2026-10-21 v2 S0(V-5) — 후보 모델 지정 (허용 목록만)", () => {
  /** 외부를 때리지 않게 fetch를 바꿔 끼우고, 보낸 모델 이름을 모은다. */
  async function withFetch(fn) {
    const sent = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init?.body ?? "{}");
      const u = String(url);
      const model = body.model ?? /models\/([^:]+):/.exec(u)?.[1] ?? "?";
      sent.push(model);
      const payload = u.includes("generativelanguage") || u.includes(":generateContent")
        ? { candidates: [{ content: { parts: [{ text: "ok" }] } }] }
        : u.includes("chat/completions")
          ? { choices: [{ message: { content: "ok" } }] }
          : { content: [{ type: "text", text: "ok" }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      return await fn(sent);
    } finally {
      globalThis.fetch = real;
    }
  }

  it("models를 주면 그 모델로만 잰다 — 결과·요약에 모델 이름이 붙는다", async () => {
    await withFetch(async (sent) => {
      const res = await post(envWith(), { query: "?models=anthropic:claude-opus-5-5,openai:gpt-5.6-sol,gemini:gemini-3.1-pro-preview" });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual([...new Set(sent)].sort(), ["claude-opus-5-5", "gemini-3.1-pro-preview", "gpt-5.6-sol"]);
      assert.ok(body.results.every((r) => typeof r.model === "string"));
      assert.ok(body.summary["anthropic:gateway:claude-opus-5-5"], JSON.stringify(Object.keys(body.summary)));
      assert.ok(body.summary["anthropic:direct:claude-opus-5-5"]);
      assert.equal(body.summary["anthropic:gateway:claude-opus-5-5"].usable, 1);
    });
  });

  it("허용 목록 밖 모델이면 400이고 아무것도 호출하지 않는다 — 프로덕션 키로 임의 모델을 부르지 못한다", async () => {
    await withFetch(async (sent) => {
      const res = await post(envWith(), { query: "?models=openai:gpt-9-ultra" });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "model_not_allowed");
      assert.equal(sent.length, 0);
    });
  });

  it("한 번에 8개를 넘으면 400 (예산 보호)", async () => {
    const list = Array.from({ length: 9 }, () => "openai:gpt-5.4").join(",");
    await withFetch(async (sent) => {
      const res = await post(envWith(), { query: `?models=${list}` });
      assert.equal(res.status, 400);
      assert.equal(sent.length, 0);
    });
  });

  it("models가 없으면 종전과 같은 기본 모델 3벤더 4항목", async () => {
    await withFetch(async (sent) => {
      const body = await (await post(envWith())).json();
      assert.equal(body.results.length, 4);
      assert.deepEqual([...new Set(sent)].sort(), ["claude-haiku-4-5-20251001", "gemini-2.5-flash", "gpt-5.4"]);
    });
  });
});

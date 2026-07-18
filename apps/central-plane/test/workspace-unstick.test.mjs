import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

// G2 막힘 도우미 (docs/simsa-gap-backlog-2026-07-18.md): 붙여넣은 에러 →
// 쉬운 설명 + 다음 행동 1~3개. recommend.ts와 같은 계약 — 실패 시 정직한
// llm_unavailable(지어낸 해결책은 막힌 비개발자를 더 깊이 막는다).

const { generateUnstickAdvice } = await import("../dist/workspace/unstick.js");

const REQ = {
  problemText: "Error: Missing SUPABASE_URL environment variable\n  at loadConfig (config.js:12)",
  productName: "할 일 앱",
  buildTool: "claude_code",
  locale: "ko",
};

function stubFetch(text) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text }] }),
    text: async () => "",
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("generateUnstickAdvice (G2, honest by contract)", () => {
  it("no API key → honest failure (no fabricated advice)", async () => {
    const res = await generateUnstickAdvice(REQ, undefined, "https://gw.example/anthropic");
    assert.deepEqual(res, { ok: false, error: "llm_unavailable" });
  });

  it("valid JSON → whatHappened + nextSteps (capped 3) + askAgentMessage", async () => {
    globalThis.fetch = stubFetch(
      JSON.stringify({
        whatHappened: "앱이 데이터베이스 주소를 못 찾았어요.",
        nextSteps: ["Supabase 화면에서 Project URL을 복사하세요", ".env 파일에 붙여넣으세요", "다시 실행해보세요", "네 번째는 잘려야"],
        askAgentMessage: "SUPABASE_URL 환경변수를 .env에서 읽도록 설정을 확인해줘.",
      }),
    );
    const res = await generateUnstickAdvice(REQ, "sk-test", "https://gw.example/anthropic");
    assert.equal(res.ok, true);
    assert.match(res.whatHappened, /데이터베이스/);
    assert.equal(res.nextSteps.length, 3);
    assert.ok(res.askAgentMessage.length > 0);
  });

  it("askAgentMessage omitted/empty → field absent (never an empty string)", async () => {
    globalThis.fetch = stubFetch(
      JSON.stringify({ whatHappened: "네트워크가 잠깐 끊겼어요.", nextSteps: ["다시 시도해보세요"], askAgentMessage: "  " }),
    );
    const res = await generateUnstickAdvice(REQ, "sk-test");
    assert.equal(res.ok, true);
    assert.equal("askAgentMessage" in res, false);
  });

  it("empty nextSteps / non-JSON → llm_unavailable", async () => {
    globalThis.fetch = stubFetch(JSON.stringify({ whatHappened: "x", nextSteps: [] }));
    assert.equal((await generateUnstickAdvice(REQ, "sk-test")).ok, false);
    globalThis.fetch = stubFetch("죄송합니다, JSON이 아닙니다");
    assert.equal((await generateUnstickAdvice(REQ, "sk-test")).ok, false);
  });
});

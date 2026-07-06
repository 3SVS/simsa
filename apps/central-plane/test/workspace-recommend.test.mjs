import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

// C2 recommend-answer generator. Bae's condition: ① gateway-routed, ② NO silent
// default — every failure path returns an honest { ok:false, error:"llm_unavailable" }
// so the UI can show "추천을 못 가져왔어요, 다시 시도".

const { generateRecommendedAnswer } = await import("../dist/workspace/recommend.js");

const REQ = {
  question: "통계를 며칠 동안 보관할지",
  productName: "회의록 요약 앱",
  oneLine: "회의를 녹음하면 요약이 정리됩니다",
  targetUsers: ["회의 많은 팀"],
  locale: "ko",
};

// Minimal fetch stub returning a 200 Anthropic response whose text block is `text`.
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

describe("generateRecommendedAnswer (C2, honest by contract)", () => {
  it("no API key → honest failure, no silent default", async () => {
    const res = await generateRecommendedAnswer(REQ, undefined, "https://gw.example/anthropic");
    assert.equal(res.ok, false);
    assert.equal(res.error, "llm_unavailable");
  });

  it("valid LLM JSON → ok:true with recommendation/reason/options", async () => {
    globalThis.fetch = stubFetch(
      '여기 추천입니다: { "recommendation": "30일", "reason": "대부분의 앱에 무난한 기본입니다.", "options": ["7일", "30일", "90일", "무기한"] }',
    );
    const res = await generateRecommendedAnswer(REQ, "sk-test", "https://gw.example/anthropic");
    assert.equal(res.ok, true);
    assert.equal(res.source, "llm");
    assert.equal(res.recommendation, "30일");
    assert.ok(res.reason.length > 0);
    assert.deepEqual(res.options, ["7일", "30일", "90일", "무기한"]);
  });

  it("caps options at 4 and drops non-string/empty options", async () => {
    globalThis.fetch = stubFetch(
      '{ "recommendation": "무료", "reason": "초기엔 무료가 낫습니다.", "options": ["무료", "", "유료", 42, "구독", "일회성", "광고"] }',
    );
    const res = await generateRecommendedAnswer(REQ, "sk-test");
    assert.equal(res.ok, true);
    assert.equal(res.options.length, 4);
    assert.deepEqual(res.options, ["무료", "유료", "구독", "일회성"]);
  });

  it("non-JSON LLM output → honest failure", async () => {
    globalThis.fetch = stubFetch("추천을 드릴 수 없습니다. 죄송합니다.");
    const res = await generateRecommendedAnswer(REQ, "sk-test");
    assert.equal(res.ok, false);
    assert.equal(res.error, "llm_unavailable");
  });

  it("JSON missing a recommendation field → honest failure (bad shape)", async () => {
    globalThis.fetch = stubFetch('{ "reason": "이유만 있음", "options": ["a", "b"] }');
    const res = await generateRecommendedAnswer(REQ, "sk-test");
    assert.equal(res.ok, false);
    assert.equal(res.error, "llm_unavailable");
  });

  it("empty-string recommendation → honest failure (not a usable answer)", async () => {
    globalThis.fetch = stubFetch('{ "recommendation": "   ", "reason": "x", "options": [] }');
    const res = await generateRecommendedAnswer(REQ, "sk-test");
    assert.equal(res.ok, false);
    assert.equal(res.error, "llm_unavailable");
  });
});

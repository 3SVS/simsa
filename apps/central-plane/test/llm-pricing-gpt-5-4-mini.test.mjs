// gpt-5.4-mini 공식 단가(2026-10-05, developers.openai.com/api/docs/pricing Standard) — 검사 agent 엔진의 싼 단계가
// 실제로 답하는 모델. 표에 없으면 보수(최대) 단가로 잡혀 무료 런 상한·하루 예산이 실제보다 빨리 닿는다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { priceTokens } = await import("../dist/workspace/llm-pricing.js");

describe("gpt-5.4-mini 단가", () => {
  it("날짜 붙은 실응답 모델명도 공식 단가로 계산하고 unpriced가 아니다", () => {
    const r = priceTokens("gpt-5.4-mini-2026-03-17", { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 1_000_000 });
    assert.equal(r.unpriced, false);
    assert.equal(r.pricedAs, "gpt-5.4-mini");
    assert.ok(Math.abs(r.costUsd - (0.75 + 0.075 + 4.5)) < 1e-9, `got ${r.costUsd}`);
  });
  it("gpt-5.4(큰 모델)보다 싸다", () => {
    const u = { inputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2_000 };
    assert.ok(priceTokens("gpt-5.4-mini", u).costUsd < priceTokens("gpt-5.4", u).costUsd);
  });
});

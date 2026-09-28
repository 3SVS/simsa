import { test } from "node:test";
import assert from "node:assert/strict";
import { actualCost, estimateCallCost, PRICING } from "../dist/index.js";

test("PRICING: table has primary review models", () => {
  assert.ok(PRICING["gpt-5-mini"]);
  assert.ok(PRICING["gpt-5"]);
  assert.ok(PRICING["gpt-4.1"]);
});

test("actualCost: baseline gpt-5-mini no cache", () => {
  // 1000 * 0.5 + 500 * 2.0 = 500 + 1000 = 1500 / 1M = 0.0015
  const cost = actualCost("gpt-5-mini", { inputTokens: 1_000, outputTokens: 500 });
  assert.equal(cost.toFixed(4), "0.0015");
});

test("actualCost: cached input gets discount", () => {
  const noCache = actualCost("gpt-5", { inputTokens: 10_000, outputTokens: 0 });
  const cached = actualCost("gpt-5", { inputTokens: 10_000, outputTokens: 0, cachedInputTokens: 10_000 });
  assert.ok(cached < noCache);
  // gpt-5: 5 / 2.5 = 50% discount on cached
  assert.equal((cached / noCache).toFixed(2), "0.50");
});

test("actualCost: model without cached pricing treats cache at full rate", () => {
  const model = "o5";
  const p = PRICING[model];
  assert.equal(p.cachedInputPerMTok, undefined);
  const withCache = actualCost(model, { inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 500 });
  const noCache = actualCost(model, { inputTokens: 1_000, outputTokens: 0 });
  assert.equal(withCache, noCache);
});

test("actualCost: throws on unknown model", () => {
  assert.throws(() => actualCost("gpt-nope", { inputTokens: 1, outputTokens: 1 }));
});

test("estimateCallCost: deterministic pre-flight", () => {
  // gpt-5-mini: 5_000 * 0.5/M + 1_000 * 2.0/M = 0.0025 + 0.002 = 0.0045
  const est = estimateCallCost("gpt-5-mini", 5_000, 1_000);
  assert.equal(est.toFixed(4), "0.0045");
});

// PR #562 결함 7 회귀 전수 — `PRICING[model]`은 상속 키(constructor·__proto__·toString…)도 truthy로
// 돌려줘 비용이 NaN인 채 "알려진 모델"처럼 통과했다. 모르는 모델은 조용히 NaN이 아니라 던져야 한다.
test("pricing: Object.prototype keys are unknown models (throw, never NaN)", () => {
  for (const m of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    assert.throws(() => actualCost(m, { inputTokens: 1_000, outputTokens: 1_000 }), /unknown/, `actualCost ${m}`);
    assert.throws(() => estimateCallCost(m, 1_000, 1_000), /unknown/, `estimateCallCost ${m}`);
  }
});

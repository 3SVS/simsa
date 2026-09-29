import { test } from "node:test";
import assert from "node:assert/strict";
import { actualCost, estimateCallCost, PRICING } from "../dist/index.js";

test("PRICING table has all three Claude tiers", () => {
  assert.ok(PRICING["claude-sonnet-4-6"]);
  assert.ok(PRICING["claude-haiku-4-5"]);
  assert.ok(PRICING["claude-opus-4-7"]);
});

test("actualCost: Sonnet baseline — 1000 in, 500 out, no cache", () => {
  const cost = actualCost("claude-sonnet-4-6", { inputTokens: 1_000, outputTokens: 500 });
  // 1000 * 3 + 500 * 15 = 3000 + 7500 = 10_500 / 1_000_000 = 0.0105
  assert.equal(cost.toFixed(4), "0.0105");
});

// Anthropic usage semantics: `input_tokens` EXCLUDES cache reads/writes (total prompt =
// input + cache_creation + cache_read). The caller (claude-agent.ts) passes
// response.usage.input_tokens as-is, so `inputTokens` here is the non-cached part.
test("actualCost: cache read discount applied (same 10k prompt, 9k of it read from cache)", () => {
  const noCache = actualCost("claude-sonnet-4-6", { inputTokens: 10_000, outputTokens: 200 });
  const cached = actualCost("claude-sonnet-4-6", {
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 9_000,
  });
  // 9k cache read at 0.3/MTok instead of 3.0/MTok = 0.0027 vs 0.027 → $0.0243 savings
  assert.ok(cached < noCache, "cached call must cost less");
  assert.equal((noCache - cached).toFixed(4), "0.0243");
});

test("actualCost: cache write premium applied", () => {
  const noCache = actualCost("claude-sonnet-4-6", { inputTokens: 5_000, outputTokens: 100 });
  const cacheWrite = actualCost("claude-sonnet-4-6", {
    inputTokens: 0,
    outputTokens: 100,
    cacheCreationTokens: 5_000,
  });
  // cache write is 1.25× input cost
  assert.ok(cacheWrite > noCache);
});

// PR #562 결함 5 — 형제 패키지 회귀 전수. agent-worker(L-1)가 고친 옛 단가·옛 input 의미가 여기 그대로 남아 있었다.
// 출처(접근일 2026-09-28): https://platform.claude.com/docs/en/about-claude/pricing — agent-worker/src/pricing.ts와 같은 행.
test("PRICING: official Anthropic rates (haiku was 4× under, opus-4-7 3× over)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PRICING)), {
    "claude-sonnet-4-6": { inputPerMTok: 3, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outputPerMTok: 15 },
    "claude-haiku-4-5": { inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 },
    "claude-opus-4-7": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  });
  assert.equal(actualCost("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 6);
  assert.equal(actualCost("claude-opus-4-7", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 30);
});

test("actualCost: a cache hit does not zero out the non-cached input (input_tokens already excludes cache)", () => {
  // 옛 식 max(0, input − cacheRead − cacheWrite)는 캐시가 적중하면 비캐시 입력 1k를 0으로 깎았다(과소 청구).
  const c = actualCost("claude-sonnet-4-6", { inputTokens: 1_000, cacheReadTokens: 10_000, outputTokens: 0 });
  assert.equal(c.toFixed(6), ((1_000 * 3 + 10_000 * 0.3) / 1_000_000).toFixed(6));
  const w = actualCost("claude-sonnet-4-6", { inputTokens: 1_000, cacheCreationTokens: 2_000, outputTokens: 0 });
  assert.equal(w.toFixed(6), ((1_000 * 3 + 2_000 * 3.75) / 1_000_000).toFixed(6));
});

test("actualCost: Sonnet is 3× Haiku per input token (official $3 vs $1)", () => {
  const sonnet = actualCost("claude-sonnet-4-6", { inputTokens: 100_000, outputTokens: 0 });
  const haiku = actualCost("claude-haiku-4-5", { inputTokens: 100_000, outputTokens: 0 });
  assert.ok(Math.abs(sonnet / haiku - 3) < 1e-9, `expected ratio 3, got ${sonnet / haiku}`);
});

test("actualCost: throws on unknown model", () => {
  assert.throws(() => actualCost("claude-does-not-exist", { inputTokens: 1, outputTokens: 1 }));
});

test("estimateCallCost: pessimistic pre-flight matches reserve-before-call flow", () => {
  const est = estimateCallCost("claude-sonnet-4-6", 5_000, 1_000);
  // 5k * 3/M + 1k * 15/M = 15e-3 + 15e-3 = 0.03
  assert.equal(est.toFixed(3), "0.030");
});

// PR #562 결함 7 회귀 전수 — `PRICING[model]`은 상속 키(constructor·__proto__·toString…)도 truthy로
// 돌려줘 비용이 NaN인 채 "알려진 모델"처럼 통과했다. 모르는 모델은 조용히 NaN이 아니라 던져야 한다.
test("pricing: Object.prototype keys are unknown models (throw, never NaN)", () => {
  for (const m of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    assert.throws(() => actualCost(m, { inputTokens: 1_000, outputTokens: 1_000 }), /unknown/, `actualCost ${m}`);
    assert.throws(() => estimateCallCost(m, 1_000, 1_000), /unknown/, `estimateCallCost ${m}`);
  }
});

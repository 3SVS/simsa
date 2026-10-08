/**
 * Train L — L-1 공식 단가 (agent-worker pricing.ts).
 *
 * 고정하는 계약:
 *   ① PRICING = 2026-09-28 공식 가격 페이지 값(스냅샷). 옛 표는 haiku $0.25/$1.25·opus-4-7 $15/$75였다.
 *   ② 가격표에 없는 모델은 **조용히 $0이 아니다** — 알려진 최고 단가로 보수 계산 + unpriced:true.
 *   ③ 날짜 붙은 모델 id(claude-haiku-4-5-20251001, gpt-5.4-2026-03-05)는 본 모델 단가로.
 *   ④ input_tokens는 Anthropic 의미(캐시 제외분) — 캐시 읽기가 있어도 나머지 입력이 0으로 깎이지 않는다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const pricing = await import("../dist/pricing.js");
const { PRICING, actualCost, estimateCallCost } = pricing;

const OFFICIAL = {
  "claude-haiku-4-5": { inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outputPerMTok: 15 },
  "claude-sonnet-5": { inputPerMTok: 2, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2, outputPerMTok: 10 },
  "claude-opus-4-7": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  "claude-opus-5": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  // 공식 페이지 각주 2: Opus 5.5의 캐시 적중은 0.05x($0.20) — 일반 0.1x 규칙의 예외.
  "claude-opus-5-5": { inputPerMTok: 4, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2, outputPerMTok: 20 },
  // OpenAI는 캐시 쓰기 할증이 없다(쓰기 = 기본 입력가). ≤272K 컨텍스트 표준 티어.
  "gpt-5.4": { inputPerMTok: 2.5, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.25, outputPerMTok: 15, maxPricedInputTokens: 272_000 },
  // 2026-10-05 공식 페이지(Standard): gpt-5.4-mini $0.75 / 캐시 $0.075 / 출력 $4.50 — 긴 문맥 단가 칸 없음.
  "gpt-5.4-mini": { inputPerMTok: 0.75, cacheWritePerMTok: 0.75, cacheReadPerMTok: 0.075, outputPerMTok: 4.5 },
  // 2026-10-07 공식 페이지(Standard): GPT-5.6 sol $4/$0.40/$20 · terra $2/$0.20/$12 · luna $0.20/$0.02/$1.20.
  // 2026-10-07 Anthropic 공식(Fable 5.1): $10 / 캐시 쓰기 $12.50 / 캐시 적중 $0.25 / 출력 $50.
  "claude-fable-5-1": { inputPerMTok: 10, cacheWritePerMTok: 12.5, cacheReadPerMTok: 0.25, outputPerMTok: 50 },
  "gpt-5.6-sol": { inputPerMTok: 4, cacheWritePerMTok: 4, cacheReadPerMTok: 0.4, outputPerMTok: 20 },
  "gpt-5.6-terra": { inputPerMTok: 2, cacheWritePerMTok: 2, cacheReadPerMTok: 0.2, outputPerMTok: 12 },
  "gpt-5.6-luna": { inputPerMTok: 0.2, cacheWritePerMTok: 0.2, cacheReadPerMTok: 0.02, outputPerMTok: 1.2 },
};

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ""} expected ${b}, got ${a}`);

describe("L-1 공식 단가 스냅샷", () => {
  it("① PRICING이 2026-09-28 공식 페이지 값과 정확히 같다", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(PRICING)), OFFICIAL);
  });

  it("① haiku 한 번 호출(1M in / 1M out)이 $6 — 옛 표의 $1.50가 아니다", () => {
    near(actualCost("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 6);
  });

  it("② 미지 모델은 throw도 $0도 아니고, 알려진 최고 단가로 보수 계산 + unpriced:true", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const p = pricing.priceUsage("mystery-model-9", u);
    assert.equal(p.unpriced, true);
    assert.equal(p.pricedAs, null);
    // 최고 입력가 $10 + 최고 출력가 $50(claude-fable-5-1, 2026-10-07) — 표에서 성분별 최대값
    near(p.costUsd, 60);
    // 기존 API(actualCost/estimateCallCost)도 미지 모델에서 던지지 않고 같은 보수값을 쓴다
    near(actualCost("mystery-model-9", u), 60);
    near(estimateCallCost("mystery-model-9", 1_000_000, 1_000_000), 60);
  });

  it("② 보수 단가는 표의 성분별 최대값이다(가격표가 바뀌어도 자동으로 따라간다)", () => {
    const max = (k) => Math.max(...Object.values(PRICING).map((p) => p[k]));
    assert.deepEqual(pricing.CONSERVATIVE_PRICING, {
      inputPerMTok: max("inputPerMTok"),
      cacheWritePerMTok: max("cacheWritePerMTok"),
      cacheReadPerMTok: max("cacheReadPerMTok"),
      outputPerMTok: max("outputPerMTok"),
    });
  });

  it("③ 날짜 붙은 id는 본 모델 단가(unpriced 아님)", () => {
    const a = pricing.priceUsage("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 0 });
    assert.equal(a.pricedAs, "claude-haiku-4-5");
    assert.equal(a.unpriced, false);
    near(a.costUsd, 1);
    const b = pricing.priceUsage("gpt-5.4-2026-03-05", { inputTokens: 0, outputTokens: 1_000_000 });
    assert.equal(b.pricedAs, "gpt-5.4");
    near(b.costUsd, 15);
  });

  it("③ gpt-5.4가 272K 입력을 넘으면 공식 단가가 없으므로 unpriced(보수)로 표시한다", () => {
    const p = pricing.priceUsage("gpt-5.4", { inputTokens: 300_000, outputTokens: 0 });
    assert.equal(p.unpriced, true);
    assert.equal(p.pricedAs, null);
    near(p.costUsd, 300_000 * 10 / 1_000_000);
  });

  it("★⑤ Object.prototype 키 모델명은 '알려진 모델'이 아니다 — 보수 단가 + unpriced, NaN 없음 (#562 결함 7)", () => {
    // `raw in PRICING`은 상속 키도 참이다: 'constructor' in {} === true, PRICING.constructor는 Object 함수(truthy)
    // → 단가 필드가 undefined라 비용이 NaN인데 unpriced:false로 "알려진 모델"처럼 통과했다.
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    for (const m of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "constructor-20251001"]) {
      const p = pricing.priceUsage(m, u);
      assert.equal(p.unpriced, true, `${m}: unpriced`);
      assert.equal(p.pricedAs, null, `${m}: pricedAs`);
      near(p.costUsd, 60, `${m}: 보수 단가`);
      near(actualCost(m, u), 60, `${m}: actualCost`);
      near(estimateCallCost(m, 1_000_000, 1_000_000), 60, `${m}: estimateCallCost`);
    }
  });

  it("★⑤ 실응답 model이 프로토타입 키여도 D-7 예산 게이트가 꺼지지 않는다(NaN spent 금지)", async () => {
    const { EfficiencyGate, BudgetExceededError } = await import("@simsa/core");
    const rec = pricing.usageRecordFromResponse("claude-sonnet-4-6", { model: "constructor", usage: { input_tokens: 10_000_000, output_tokens: 10_000_000 } }, 1);
    assert.ok(Number.isFinite(rec.costUsd), `costUsd는 유한수여야 한다: ${rec.costUsd}`);
    assert.equal(rec.unpriced, true);
    const gate = new EfficiencyGate({ perPrUsd: 1 });
    gate.budget.commit(rec.costUsd);
    assert.throws(() => gate.budget.reserve(0.9), BudgetExceededError, "상한을 넘긴 뒤 다음 호출은 막혀야 한다");
  });

  it("④ input_tokens는 캐시 제외분이다 — 캐시 읽기 10k가 있어도 입력 1k는 과금된다", () => {
    const c = actualCost("claude-sonnet-4-6", { inputTokens: 1_000, cacheReadTokens: 10_000, outputTokens: 0 });
    near(c, (1_000 * 3 + 10_000 * 0.3) / 1_000_000);
    const w = actualCost("claude-sonnet-4-6", { inputTokens: 1_000, cacheCreationTokens: 2_000, outputTokens: 0 });
    near(w, (1_000 * 3 + 2_000 * 3.75) / 1_000_000);
  });
});


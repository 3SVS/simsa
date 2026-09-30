/**
 * usage-unknown.test.mjs — PR #576 검증 P2-8: usage 없는 과금 응답을 $0으로 치지 않는다.
 *
 * 벤더가 응답했는데 usage 블록이 없으면(관측된 적은 없지만 계약상 가능) 종전엔:
 *   - OpenAI 폴백 변환이 토큰을 0으로 만들어 → costUsd 0(유한수) → 예산 게이트가 "공짜 호출"로 셌다.
 *   - Anthropic 형태 응답은 usageRecordFromResponse가 response.usage.input_tokens에서 TypeError →
 *     onUsage가 불리지 않았다(호출은 이미 과금됐다).
 * 이제:
 *   - 폴백 변환은 usage가 없으면 `usageUnknown: true`를 싣는다(0 토큰과 구별).
 *   - usageRecordFromResponse는 던지지 않고, usage를 모르면 토큰 0 · `unpriced: true` · `usageUnknown: true`
 *     · costUsd = 호출자가 준 추정(입력 추정 + 최대 출력)을 **보수 단가(표의 성분별 최대)**로 매긴 값.
 *   - ClaudeWorker는 그 추정을 넘기고, 계측이 호출을 깨지 않는다.
 * 네트워크 0: fetch·client 주입.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { callOpenAiAsAnthropic } = await import("../dist/openai-fallback.js");
const pricing = await import("../dist/pricing.js");
const { ClaudeWorker } = await import("../dist/index.js");

const PARAMS = {
  model: "claude-sonnet-4-6",
  max_tokens: 1000,
  messages: [{ role: "user", content: "빵 목록이 비어 있어요 — 고쳐 주세요" }],
  tools: [{ name: "submit_rewrite", description: "rewrite", input_schema: { type: "object" } }],
  tool_choice: { type: "tool", name: "submit_rewrite" },
};
const openAiJson = (extra = {}) => ({
  id: "cc_1",
  model: "gpt-5.4-2026-03-05",
  choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: "submit_rewrite", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
  ...extra,
});
const conservative = (input, output) =>
  (input * pricing.CONSERVATIVE_PRICING.inputPerMTok + output * pricing.CONSERVATIVE_PRICING.outputPerMTok) / 1_000_000;

describe("OpenAI 폴백: usage 없음은 0 토큰과 다르다", () => {
  it("usage 블록이 없으면 usageUnknown: true", async () => {
    const res = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "test-openai-key",
      fetchImpl: async () => new Response(JSON.stringify(openAiJson()), { status: 200 }),
    });
    assert.equal(res.usageUnknown, true);
  });

  it("usage가 객체가 아니거나 토큰 수가 하나도 없으면 역시 모름", async () => {
    for (const usage of [null, "n/a", {}, { prompt_tokens: "12" }]) {
      const res = await callOpenAiAsAnthropic(PARAMS, {
        openaiApiKey: "test-openai-key",
        fetchImpl: async () => new Response(JSON.stringify(openAiJson({ usage })), { status: 200 }),
      });
      assert.equal(res.usageUnknown, true, `usage ${JSON.stringify(usage)}`);
    }
  });

  it("행동 보존: usage가 있으면(0 토큰이어도 숫자면) 모름 표시 없음 · 토큰 변환 그대로", async () => {
    const res = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "test-openai-key",
      fetchImpl: async () => new Response(JSON.stringify(openAiJson({ usage: { prompt_tokens: 1_000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } })), { status: 200 }),
    });
    assert.notEqual(res.usageUnknown, true);
    assert.equal(res.usage.input_tokens, 200);
    assert.equal(res.usage.cache_read_input_tokens, 800);
    const zero = await callOpenAiAsAnthropic(PARAMS, {
      openaiApiKey: "test-openai-key",
      fetchImpl: async () => new Response(JSON.stringify(openAiJson({ usage: { prompt_tokens: 0, completion_tokens: 0 } })), { status: 200 }),
    });
    assert.notEqual(zero.usageUnknown, true, "a vendor that says 0 tokens said something");
  });
});

describe("usageRecordFromResponse: 모르는 사용량은 보수 추정 + unpriced + usageUnknown, 던지지 않는다", () => {
  it("usage 블록이 없는 Anthropic 형태 응답 → 던지지 않음 · 보수 단가 × 추정", () => {
    const rec = pricing.usageRecordFromResponse("claude-sonnet-4-6", { model: "claude-sonnet-4-6", content: [] }, 12, { inputTokens: 40_000, outputTokens: 16_384 });
    assert.equal(rec.usageUnknown, true);
    assert.equal(rec.unpriced, true);
    assert.equal(rec.inputTokens, 0, "we do not invent token counts");
    assert.equal(rec.outputTokens, 0);
    assert.ok(Math.abs(rec.costUsd - conservative(40_000, 16_384)) < 1e-12, `cost ${rec.costUsd}`);
    assert.ok(rec.costUsd > 0);
  });

  it("폴백이 표시한 usageUnknown도 같은 처리(0 토큰 usage가 있어도)", () => {
    const rec = pricing.usageRecordFromResponse("claude-sonnet-4-6", { model: "gpt-5.4", vendor: "openai", usageUnknown: true, usage: { input_tokens: 0, output_tokens: 0 } }, 3, { inputTokens: 1_000, outputTokens: 500 });
    assert.equal(rec.usageUnknown, true);
    assert.equal(rec.unpriced, true);
    assert.ok(Math.abs(rec.costUsd - conservative(1_000, 500)) < 1e-12);
  });

  it("추정이 없거나 잘못돼도 던지지 않고 모름으로 표시한다", () => {
    for (const est of [undefined, null, { inputTokens: -1, outputTokens: Number.NaN }]) {
      const rec = pricing.usageRecordFromResponse("gpt-5.4", { model: "gpt-5.4" }, 1, est);
      assert.equal(rec.usageUnknown, true);
      assert.equal(rec.unpriced, true);
      assert.ok(Number.isFinite(rec.costUsd) && rec.costUsd >= 0);
    }
  });

  it("행동 보존: usage가 있으면 종전 값 그대로(모름 표시 없음)", () => {
    const rec = pricing.usageRecordFromResponse("claude-sonnet-4-6", { model: "gpt-5.4", usage: { input_tokens: 1_000, output_tokens: 100 } }, 5);
    assert.notEqual(rec.usageUnknown, true);
    assert.equal(rec.unpriced, false);
    assert.ok(Math.abs(rec.costUsd - (1_000 * 2.5 + 100 * 15) / 1_000_000) < 1e-12);
  });
});

describe("ClaudeWorker: usage 없는 응답도 계측하고, 계측이 호출을 깨지 않는다", () => {
  const REVIEW = { agent: "simsa", verdict: "rework", blockers: [{ severity: "major", category: "bug", message: "빵 목록이 비어 있어요" }], summary: "목록이 비어 있음" };
  const CTX = { repo: "bakery/pickup", pullNumber: 0, newSha: "abc123", reviews: [REVIEW], fileSnapshots: [{ path: "app.js", contents: "const list = [];\n" }] };

  it("usage 없는 응답 → onUsage 1회(usageUnknown, 비용 > 0) · 결과는 정상 처리(TypeError 아님)", async () => {
    const records = [];
    const client = {
      messages: {
        async create(params) {
          return { id: "m", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "tu", name: params.tools[0].name, input: { rewrites: [{ path: "app.js", content: "const list = [1];\n" }], commitMessage: "fix: 목록" } }], stop_reason: "tool_use" };
        },
      },
    };
    const worker = new ClaudeWorker({ client, onUsage: (u) => records.push(u) });
    const out = await worker.work(CTX);
    assert.equal(records.length, 1);
    assert.equal(records[0].usageUnknown, true);
    assert.equal(records[0].unpriced, true);
    assert.ok(records[0].costUsd > 0, "an unknown-usage call is never free");
    assert.ok(Array.isArray(out.rewrites) && out.rewrites.length === 1, "the answer is still used");
  });
});

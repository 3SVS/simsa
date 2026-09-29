/**
 * PR #562 결함 5 — 형제 패키지 회귀 전수. agent-worker(Train L · L-1)가 고친 Anthropic 옛 단가
 * (haiku $0.25/$1.25 → 공식 $1/$5, opus-4-7 $15/$75 → 공식 $5/$25)와 옛 input 의미
 * (`input − cacheRead − cacheWrite`를 0으로 자름 → 캐시 적중 시 비캐시 입력이 과금에서 빠짐)가
 * DesignAgent의 estimateActualCost에도 그대로 있었다. 출처(접근일 2026-09-28):
 * https://platform.claude.com/docs/en/about-claude/pricing
 * 네트워크 0: client 주입.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EfficiencyGate } from "@simsa/core";
import { DesignAgent, REVIEW_TOOL_NAME } from "../dist/index.js";

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const ctx = {
  diff: "diff --git a/x b/x\n+added",
  repo: "acme/빵집-app",
  pullNumber: 7,
  newSha: "abc123",
  domain: "design",
  visualArtifacts: [{ route: "/예약", before: tinyPng, after: tinyPng }],
};

function agentWith(model, usage) {
  const client = {
    messages: {
      create: async () => ({
        id: "msg_test",
        model,
        content: [{ type: "tool_use", id: "tool_1", name: REVIEW_TOOL_NAME, input: { verdict: "approve", blockers: [], summary: "괜찮아요" } }],
        stop_reason: "tool_use",
        usage,
      }),
    },
  };
  return new DesignAgent({ apiKey: "test-key", model, gate: new EfficiencyGate({ perPrUsd: 5 }), client });
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ""} expected ${b}, got ${a}`);

test("DesignAgent cost: claude-opus-4-7 at the official $5/$25 (was $15/$75)", async () => {
  const r = await agentWith("claude-opus-4-7", { input_tokens: 10_000, output_tokens: 2_000 }).review(ctx);
  near(r.costUsd, (10_000 * 5 + 2_000 * 25) / 1_000_000);
});

test("DesignAgent cost: claude-haiku-4-5 at the official $1/$5 (was $0.25/$1.25)", async () => {
  const r = await agentWith("claude-haiku-4-5", { input_tokens: 100_000, output_tokens: 10_000 }).review(ctx);
  near(r.costUsd, (100_000 * 1 + 10_000 * 5) / 1_000_000);
});

test("DesignAgent cost: a cache hit does not zero out the non-cached input (input_tokens excludes cache)", async () => {
  const r = await agentWith("claude-sonnet-4-6", { input_tokens: 1_000, output_tokens: 0, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2_000 }).review(ctx);
  near(r.costUsd, (1_000 * 3 + 10_000 * 0.3 + 2_000 * 3.75) / 1_000_000);
});

test("DesignAgent cost: unknown / prototype-key model → conservative (table max), never NaN", async () => {
  for (const model of ["claude-future-9", "constructor"]) {
    const r = await agentWith(model, { input_tokens: 10_000, output_tokens: 2_000 }).review(ctx);
    assert.ok(Number.isFinite(r.costUsd), `${model}: finite`);
    near(r.costUsd, (10_000 * 5 + 2_000 * 25) / 1_000_000, `${model}: `);
  }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// RC-3 협의체 (design: docs/simsa-review-consensus-design-2026-07-17.md):
// 독립 소견 → 다수결 → 불일치만 2라운드 반박 → 미합의는 council_split(단정 금지).
// 벤더 2개 미만 = council_unavailable (조용한 대체 금지).

const { runCouncilCheck } = await import("../dist/workspace/council-review.js");

const REQ = {
  productSpec: {
    productName: "할 일 앱", oneLine: "할 일 관리", targetUsers: [], problem: "p",
    included: ["할 일 추가"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [],
  },
  items: [
    { id: "r1", title: "할 일 추가", status: "not_started", criteria: ["a", "b"] },
    { id: "r2", title: "결제 받기", status: "not_started", criteria: ["c"] },
  ],
  locale: "ko",
};

const verdictJson = (map) =>
  JSON.stringify({
    results: Object.entries(map).map(([itemId, status]) => ({
      itemId, status, reason: `${status}-사유`, evidence: [], nextAction: "n",
    })),
  });

/**
 * Vendor-aware fetch stub. answers = { anthropic: [round1, round2?], ... }.
 * Each entry is a verdict map or "fail". Tracks per-vendor call counts.
 */
function stubFetch(answers, calls = {}) {
  return async (url) => {
    const u = String(url);
    const vendor = u.includes("anthropic") ? "anthropic" : u.includes("openai") ? "openai" : "gemini";
    const n = (calls[vendor] = (calls[vendor] ?? 0) + 1);
    const spec = answers[vendor]?.[n - 1];
    if (!spec || spec === "fail") return new Response("err", { status: 500 });
    const text = verdictJson(spec);
    if (vendor === "anthropic") {
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
    }
    if (vendor === "openai") {
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  };
}

const ENV3 = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" };

describe("runCouncilCheck — RC-3", () => {
  it("unanimous round 1 → council_agreed, rounds=1, one call per vendor", async () => {
    const calls = {};
    const all = { r1: "passed", r2: "failed" };
    const out = await runCouncilCheck(REQ, ENV3, {
      fetchImpl: stubFetch({ anthropic: [all], openai: [all], gemini: [all] }, calls),
    });
    assert.equal(out.ok, true);
    assert.equal(out.reviewMode, "council");
    assert.equal(out.council.rounds, 1);
    assert.equal(out.council.disagreements, 0);
    assert.deepEqual(calls, { anthropic: 1, openai: 1, gemini: 1 });
    assert.equal(out.results.find((r) => r.itemId === "r2").status, "failed");
    for (const r of out.results) assert.equal(r.verification, "council_agreed");
  });

  it("split item goes to round 2; post-rebuttal majority wins", async () => {
    const calls = {};
    const out = await runCouncilCheck(REQ, ENV3, {
      fetchImpl: stubFetch({
        anthropic: [{ r1: "passed", r2: "failed" }, { r2: "failed" }],
        openai: [{ r1: "passed", r2: "passed" }, { r2: "failed" }],
        gemini: [{ r1: "passed", r2: "inconclusive" }, { r2: "failed" }],
      }, calls),
    });
    assert.equal(out.ok, true);
    assert.equal(out.council.rounds, 2);
    assert.deepEqual(calls, { anthropic: 2, openai: 2, gemini: 2 });
    const r2 = out.results.find((r) => r.itemId === "r2");
    assert.equal(r2.status, "failed");
    assert.equal(r2.verification, "council_agreed");
    assert.equal(out.council.disagreements, 0);
  });

  it("still split after round 2 → inconclusive + council_split with all perspectives", async () => {
    const out = await runCouncilCheck(REQ, ENV3, {
      fetchImpl: stubFetch({
        anthropic: [{ r1: "passed", r2: "failed" }, { r2: "failed" }],
        openai: [{ r1: "passed", r2: "passed" }, { r2: "passed" }],
        gemini: [{ r1: "passed", r2: "inconclusive" }, { r2: "inconclusive" }],
      }),
    });
    const r2 = out.results.find((r) => r.itemId === "r2");
    assert.equal(r2.status, "inconclusive");
    assert.equal(r2.verification, "council_split");
    assert.match(r2.reason, /갈렸습니다/);
    assert.equal(out.council.disagreements, 1);
  });

  it("fewer than 2 vendor keys → council_unavailable (honest, no silent fallback)", async () => {
    const out = await runCouncilCheck(REQ, { ANTHROPIC_API_KEY: "a" }, { fetchImpl: stubFetch({}) });
    assert.deepEqual(out, { ok: false, error: "council_unavailable" });
  });

  it("one vendor fails in round 1 → council proceeds with the remaining two", async () => {
    const all = { r1: "passed", r2: "failed" };
    const out = await runCouncilCheck(REQ, ENV3, {
      fetchImpl: stubFetch({ anthropic: [all], openai: ["fail"], gemini: [all] }),
    });
    assert.equal(out.ok, true);
    assert.deepEqual([...out.council.vendors].sort(), ["anthropic", "gemini"]);
  });

  it("two vendors, 1:1 split that persists → council_split (no fake majority)", async () => {
    const out = await runCouncilCheck(REQ, { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }, {
      fetchImpl: stubFetch({
        anthropic: [{ r1: "passed", r2: "failed" }, { r2: "failed" }],
        openai: [{ r1: "passed", r2: "passed" }, { r2: "passed" }],
      }),
    });
    const r2 = out.results.find((r) => r.itemId === "r2");
    assert.equal(r2.verification, "council_split");
  });

  it("uses gateway URLs when configured", async () => {
    const seen = [];
    const all = { r1: "passed", r2: "failed" };
    await runCouncilCheck(REQ, {
      ...ENV3,
      CF_AI_GATEWAY_ANTHROPIC_URL: "https://gw.example/anthropic",
      CF_AI_GATEWAY_OPENAI_URL: "https://gw.example/openai",
      CF_AI_GATEWAY_GOOGLE_URL: "https://gw.example/google-ai-studio",
    }, {
      fetchImpl: async (url) => {
        seen.push(String(url));
        return stubFetch({ anthropic: [all], openai: [all], gemini: [all] })(url);
      },
    });
    assert.ok(seen.some((u) => u.startsWith("https://gw.example/anthropic/")));
    assert.ok(seen.some((u) => u.startsWith("https://gw.example/openai/")));
    assert.ok(seen.some((u) => u.startsWith("https://gw.example/google-ai-studio/")));
  });
});

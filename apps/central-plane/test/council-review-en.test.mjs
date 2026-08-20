import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G14-b (2026-08-20): RC-3 협의체의 EN locale — 라운드2 반박 프롬프트와
// 합의/미합의 사용자 문구가 사용자 언어를 따른다. locale 분기 이전 코드에서는
// 실패한다(옛 코드는 EN 요청에도 한국어 split 문구 반환).

const { runCouncilCheck } = await import("../dist/workspace/council-review.js");

const HANGUL = /[가-힣]/;

const REQ_EN = {
  productSpec: {
    productName: "Todo app", oneLine: "manage todos", targetUsers: [], problem: "p",
    included: ["add todo"], excluded: ["payments"], userFlow: [], decisions: [], openQuestions: [],
  },
  items: [
    { id: "r1", title: "Add a todo", status: "not_started", criteria: ["a", "b"] },
  ],
  locale: "en",
};

const verdictJsonEn = (map) =>
  JSON.stringify({
    results: Object.entries(map).map(([itemId, status]) => ({
      itemId, status, reason: `${status}-reason`, evidence: [], nextAction: "n",
    })),
  });

function stubFetch(answers, calls = {}, bodies = []) {
  return async (url, init) => {
    const u = String(url);
    bodies.push(String(init?.body ?? ""));
    const vendor = u.includes("anthropic") ? "anthropic" : u.includes("openai") ? "openai" : "gemini";
    const n = (calls[vendor] = (calls[vendor] ?? 0) + 1);
    const spec = answers[vendor]?.[n - 1];
    if (!spec || spec === "fail") return new Response("err", { status: 500 });
    const text = verdictJsonEn(spec);
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

describe("runCouncilCheck — EN locale (G14-b)", () => {
  it("persistent split → EN split reason/nextAction, no Hangul", async () => {
    // Three vendors disagree in both rounds → council_split.
    const out = await runCouncilCheck(REQ_EN, ENV3, {
      fetchImpl: stubFetch({
        anthropic: [{ r1: "passed" }, { r1: "passed" }],
        openai: [{ r1: "failed" }, { r1: "failed" }],
        gemini: [{ r1: "inconclusive" }, { r1: "inconclusive" }],
      }),
    });
    assert.equal(out.ok, true);
    const r = out.results[0];
    assert.equal(r.verification, "council_split");
    assert.match(r.reason, /stayed split/);
    assert.doesNotMatch(r.reason, HANGUL);
    assert.doesNotMatch(r.nextAction, HANGUL);
  });

  it("locale=en round-2 rebuttal prompt is English", async () => {
    const bodies = [];
    await runCouncilCheck(REQ_EN, ENV3, {
      fetchImpl: stubFetch({
        anthropic: [{ r1: "passed" }, { r1: "passed" }],
        openai: [{ r1: "failed" }, { r1: "passed" }],
        gemini: [{ r1: "inconclusive" }, { r1: "passed" }],
      }, {}, bodies),
    });
    // round 2 = last three request bodies
    const round2 = bodies.slice(-3);
    for (const b of round2) {
      assert.match(b, /re-decide your final verdict/);
      assert.doesNotMatch(b, /판정이 갈렸습니다/);
    }
  });

  it("KO split copy unchanged for locale=ko (legacy)", async () => {
    const out = await runCouncilCheck({ ...REQ_EN, locale: "ko" }, ENV3, {
      fetchImpl: stubFetch({
        anthropic: [{ r1: "passed" }, { r1: "passed" }],
        openai: [{ r1: "failed" }, { r1: "failed" }],
        gemini: [{ r1: "inconclusive" }, { r1: "inconclusive" }],
      }),
    });
    assert.match(out.results[0].reason, /협의체 의견이 끝까지 갈렸습니다/);
  });
});

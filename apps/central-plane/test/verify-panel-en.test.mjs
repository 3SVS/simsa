import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G14-b (2026-08-20): RC-2 검증 패널의 EN locale — 2차 소견 요청 언어와 강등
// 사유 문구가 사용자 언어를 따른다. locale 옵션 도입 전 코드에서는 실패한다.

const { applyVerifyPanel } = await import("../dist/workspace/verify-panel.js");

const HANGUL = /[가-힣]/;

const EN_SPEC = {
  productName: "Test app", oneLine: "test", targetUsers: [], problem: "p",
  included: ["feature A"], excluded: ["payments"], userFlow: [], decisions: [], openQuestions: [],
};

const enItem = (id, status) => ({
  itemId: id, status, title: `item ${id}`,
  userLabel: status === "failed" ? "안 맞음" : "통과",
  reason: "conflicts with excluded scope", evidence: ["payments"], nextAction: "check",
});

const resp = (results) => ({
  ok: true, source: "llm",
  summary: {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: 0,
  },
  results,
});

function stubFetch(opinion, prompts = []) {
  return async (url, init) => {
    prompts.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(opinion) } }],
    }), { status: 200 });
  };
}

const ENV = { OPENAI_API_KEY: "k" };

describe("applyVerifyPanel — EN locale (G14-b)", () => {
  it("locale=en → second-opinion prompt asks for an English note", async () => {
    const prompts = [];
    await applyVerifyPanel(
      resp([enItem("a", "failed")]), EN_SPEC, ENV,
      { locale: "en", fetchImpl: stubFetch({ supported: true, note_ko: "agree" }, prompts) },
    );
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /in English/);
    assert.doesNotMatch(prompts[0], /한국어/);
  });

  it("locale=en disagreement → downgrade reason is English, no Hangul", async () => {
    const out = await applyVerifyPanel(
      resp([enItem("a", "failed")]), EN_SPEC, ENV,
      { locale: "en", fetchImpl: stubFetch({ supported: false, note_ko: "the evidence is weak" }) },
    );
    const r = out.results[0];
    assert.equal(r.status, "inconclusive");
    assert.equal(r.verification, "downgraded");
    assert.match(r.reason, /First opinion/);
    assert.match(r.reason, /the evidence is weak/);
    assert.doesNotMatch(r.reason, HANGUL);
  });

  it("a `note` key (instead of note_ko) is also accepted from the second reviewer", async () => {
    const out = await applyVerifyPanel(
      resp([enItem("a", "failed")]), EN_SPEC, ENV,
      { locale: "en", fetchImpl: stubFetch({ supported: false, note: "scope reading differs" }) },
    );
    assert.match(out.results[0].reason, /scope reading differs/);
  });

  it("KO default unchanged when locale omitted (legacy callers)", async () => {
    const out = await applyVerifyPanel(
      resp([enItem("a", "failed")]), EN_SPEC, ENV,
      { fetchImpl: stubFetch({ supported: false, note_ko: "충돌 근거 약함" }) },
    );
    assert.match(out.results[0].reason, /1차 판단/);
    assert.match(out.results[0].reason, /충돌 근거 약함/);
  });
});

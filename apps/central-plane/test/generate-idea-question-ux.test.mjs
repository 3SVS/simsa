import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Idea-stage question UX (2026-07-16). Three fixes from Bae's live complaint —
// "I want a solo web app but Simsa keeps asking who to grant permissions to":
//   D1 solo-use guard, D2 extra context, D3 rejected-question steer.
// Design: docs/simsa-idea-question-ux-2026-07-16.md.

const { detectSoloUse, buildPrompt, generateIdeaToSpecDraft } = await import("../dist/workspace/generate.js");

const specText = (res) => JSON.stringify(res.productSpec) + " " + JSON.stringify(res.items) + " " + JSON.stringify(res.questions);

describe("D1 — detectSoloUse (deterministic, no LLM)", () => {
  it("detects explicit solo phrasing (ko + en)", () => {
    for (const idea of [
      "나 혼자 집에서 쓰는 개인 가계부 웹앱",
      "혼자 쓰는 독서기록 앱, 로그인 필요 없음",
      "a habit tracker just for me",
      "personal notes app, no login, single user",
    ]) {
      assert.equal(detectSoloUse({ idea }), true, `should be solo: ${idea}`);
    }
  });

  it("a multi-user marker VETOES solo — 혼자 관리하지만 팀이 쓰는 앱은 solo가 아니다", () => {
    for (const idea of [
      "혼자 만들지만 우리 팀이 같이 쓰는 협업 앱",
      "a dashboard I run alone but my customers log into",
      "개인이 만들어 고객에게 파는 예약 서비스",
    ]) {
      assert.equal(detectSoloUse({ idea }), false, `multi-user context must veto solo: ${idea}`);
    }
  });

  it("silence is not solo — an idea with no personal/multi signal returns false", () => {
    assert.equal(detectSoloUse({ idea: "A tool to summarize customer reviews" }), false);
    assert.equal(detectSoloUse({ idea: "리뷰를 요약하는 앱" }), false);
  });

  it("solo signal is read from context and answers too, not just the idea", () => {
    assert.equal(detectSoloUse({ idea: "가계부 앱", context: "이건 나 혼자만 쓸 거예요" }), true);
    assert.equal(detectSoloUse({ idea: "budget app", answers: [{ questionId: "q1", answer: "just for me, no login" }] }), true);
  });
});

describe("D1 — the LLM prompt carries the solo guard only when solo", () => {
  it("solo idea → prompt forbids permission/multi-user questions (ko + en)", () => {
    const ko = buildPrompt({ idea: "나 혼자 쓰는 가계부", locale: "ko" });
    assert.match(ko, /혼자.*개인용|권한.*멀티유저|만들지 마라/, "ko prompt should carry the solo guard");
    const en = buildPrompt({ idea: "a budget app just for me", locale: "en" });
    assert.match(en, /solo\/personal use/i);
    assert.match(en, /Do NOT create any question or item about permissions/i);
  });

  it("non-solo idea → NO solo guard (permissions stays a valid axis)", () => {
    const ko = buildPrompt({ idea: "우리 팀이 쓰는 협업 툴", locale: "ko" });
    assert.doesNotMatch(ko, /만들지 마라/);
    const en = buildPrompt({ idea: "a team collaboration tool", locale: "en" });
    assert.doesNotMatch(en, /Do NOT create any question or item about permissions/i);
  });
});

describe("D2 — extra context is injected into the prompt", () => {
  it("context text appears in both locale prompts", () => {
    const ctx = "예산은 매달 초기화되고 카드값 자동 분류가 제일 중요해요";
    assert.match(buildPrompt({ idea: "가계부", context: ctx, locale: "ko" }), /추가로 알려준 내용/);
    assert.ok(buildPrompt({ idea: "가계부", context: ctx, locale: "ko" }).includes(ctx));
    const en = "budget resets monthly and auto-categorizing card charges matters most";
    assert.ok(buildPrompt({ idea: "budget app", context: en, locale: "en" }).includes(en));
  });

  it("no context → no context block", () => {
    assert.doesNotMatch(buildPrompt({ idea: "가계부", locale: "ko" }), /추가로 알려준 내용/);
  });
});

describe("D3 — rejected questions steer the next generation away", () => {
  it("rejected question + reason appear with an avoid instruction (ko + en)", () => {
    const rq = [{ question: "여러 사용자가 쓰나요?", reason: "저 혼자만 써요" }];
    const ko = buildPrompt({ idea: "가계부", rejectedQuestions: rq, locale: "ko" });
    assert.match(ko, /맞지 않는다.*피하고|피하고.*대체/s);
    assert.ok(ko.includes("여러 사용자가 쓰나요?") && ko.includes("저 혼자만 써요"));
    const en = buildPrompt({ idea: "budget", rejectedQuestions: [{ question: "Multi-user?", reason: "solo" }], locale: "en" });
    assert.match(en, /Avoid questions in the same direction/i);
    assert.ok(en.includes("Multi-user?"));
  });

  it("no rejections → no steer block", () => {
    assert.doesNotMatch(buildPrompt({ idea: "가계부", locale: "ko" }), /맞지 않는다/);
  });
});

describe("D1 — mock fallback drops the multi-user question + isolation item when solo", () => {
  it("solo idea (no LLM key) → no '여러 사용자' question, no '다른 사용자 데이터' item (ko)", async () => {
    const res = await generateIdeaToSpecDraft({ idea: "나 혼자 쓰는 가계부 앱, 로그인 필요 없음", locale: "ko" }, undefined);
    assert.equal(res.source, "mock-fallback");
    const t = specText(res);
    assert.ok(!/여러 사용자/.test(t), `solo mock must not ask multi-user, got: ${t.slice(0, 200)}`);
    assert.ok(!/다른 사용자의 데이터/.test(t), "solo mock must not add the isolation item");
  });

  it("solo idea (no LLM key) → no multi-user question, no isolation item (en)", async () => {
    const res = await generateIdeaToSpecDraft({ idea: "a notes app just for me, no login", locale: "en" }, undefined);
    assert.equal(res.source, "mock-fallback");
    const t = specText(res);
    assert.ok(!/multi-user/i.test(t), "solo mock (en) must not ask multi-user");
    assert.ok(!/Other users' data/i.test(t), "solo mock (en) must not add the isolation item");
  });

  it("a NON-solo generic idea still gets the multi-user question (feature preserved)", async () => {
    const res = await generateIdeaToSpecDraft({ idea: "우리 팀이 함께 쓰는 업무 관리 도구", locale: "ko" }, undefined);
    assert.equal(res.source, "mock-fallback");
    assert.ok(/여러 사용자/.test(specText(res)), "team idea should still get the multi-user question");
  });
});

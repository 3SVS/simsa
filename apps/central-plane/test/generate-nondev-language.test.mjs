import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P1 non-developer language (2026-07-17). Live measurement found openQuestions
// naming developer tools in 3/6 drafts (Firebase/AWS/Chart.js/API) — decisions
// the target user cannot make. Fix = prompt rule + deterministic category
// rewrite at the single draft choke point. HANDOFF-2026-07-17 § 남은 것.

const { sanitizeOpenQuestions, buildPrompt, generateIdeaToSpecDraft } =
  await import("../dist/workspace/generate.js");

describe("sanitizeOpenQuestions — deterministic category rewrite", () => {
  it("rewrites the live-measured leaks into plain decisions (ko)", () => {
    const out = sanitizeOpenQuestions(
      [
        "Firebase와 AWS 중 어떤 것을 쓸지 결정",
        "Chart.js로 차트를 그릴지 결정",
        "외부 API 연동 범위 확정",
        "STT 서비스 선택",
      ],
      "ko",
      "동네 미용실 예약 웹앱",
    );
    for (const q of out) {
      assert.doesNotMatch(q, /firebase|aws|chart\.js|\bapi\b|\bstt\b/i, q);
    }
    assert.ok(out.includes("자료를 어디에 어떻게 보관할지 정하기"), JSON.stringify(out));
    assert.ok(out.includes("차트·그래프를 어떤 모습으로 보여줄지 정하기"), JSON.stringify(out));
    assert.ok(out.includes("외부 서비스와 무엇을 주고받을지 정하기"), JSON.stringify(out));
    assert.ok(out.includes("음성 인식을 어느 수준까지 지원할지 정하기"), JSON.stringify(out));
  });

  it("rewrites in English for locale=en", () => {
    const out = sanitizeOpenQuestions(
      ["Choose between Firebase and AWS", "Pick an OAuth provider"],
      "en",
      "a budget web app",
    );
    assert.deepEqual(out, [
      "Decide where and how your data is kept",
      "Decide how sign-in works",
    ]);
  });

  it("dedupes questions that collapse onto the same plain decision", () => {
    const out = sanitizeOpenQuestions(
      ["Firebase 요금제 확인", "PostgreSQL 스키마 설계", "결과 화면 구성 정하기"],
      "ko",
      "가계부 웹앱",
    );
    assert.deepEqual(out, ["자료를 어디에 어떻게 보관할지 정하기", "결과 화면 구성 정하기"]);
  });

  it("keeps jargon-free questions untouched", () => {
    const qs = ["파일 크기 상한선 (예: 500MB)", "구체적인 기능 범위 정하기"];
    assert.deepEqual(sanitizeOpenQuestions(qs, "ko", "메모 웹앱"), qs);
  });

  it("a term the user typed themselves is exempt — their words, not a leak", () => {
    const out = sanitizeOpenQuestions(
      ["Firebase 무료 요금제로 충분한지 확인", "AWS 요금 확인"],
      "ko",
      "Firebase에 데이터를 저장하는 재고 관리 웹앱",
    );
    // Firebase kept (user said it); AWS still rewritten.
    assert.equal(out[0], "Firebase 무료 요금제로 충분한지 확인");
    assert.equal(out[1], "자료를 어디에 어떻게 보관할지 정하기");
  });

  it("does not false-positive on ordinary words (rest, library app in user words)", () => {
    const out = sanitizeOpenQuestions(
      ["도서관 좌석 예약 규칙 정하기", "Decide the rest of the features later"],
      "ko",
      "도서관 좌석 예약 웹앱",
    );
    assert.deepEqual(out, ["도서관 좌석 예약 규칙 정하기", "Decide the rest of the features later"]);
  });
});

describe("the prompt forbids tool names in openQuestions (ko + en)", () => {
  it("ko prompt carries the rule and the schema hint", () => {
    const ko = buildPrompt({ idea: "가계부 웹앱", locale: "ko" });
    assert.match(ko, /openQuestions·decisions에도 개발 도구·서비스 이름/);
    assert.match(ko, /도구 이름 없이 일반인 언어로/);
  });
  it("en prompt carries the rule and the schema hint", () => {
    const en = buildPrompt({ idea: "a budget web app", locale: "en" });
    assert.match(en, /Do NOT name developer tools or services/);
    assert.match(en, /plain language, no tool names/);
  });
});

describe("the choke point sanitizes real drafts (mock path)", () => {
  it("meeting mock's 'STT 서비스 선택' never reaches the user", async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "회의 녹음을 요약해서 할 일을 뽑아주는 앱", locale: "ko" },
      undefined,
    );
    assert.equal(res.source, "mock-fallback");
    for (const q of res.productSpec.openQuestions) {
      assert.doesNotMatch(q, /\bstt\b|firebase|aws|\bapi\b/i, q);
    }
    assert.ok(
      res.productSpec.openQuestions.includes("음성 인식을 어느 수준까지 지원할지 정하기"),
      JSON.stringify(res.productSpec.openQuestions),
    );
  });
});

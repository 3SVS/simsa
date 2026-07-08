import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P0-honesty (audit v2): deterministic verify-against-user-words gate.
// The generated draft (mock OR LLM) must reflect the user's own words —
// a common word alone ("요약") must not fabricate an unrelated product.

const { contentWords, verifySpecAgainstUserWords, MIN_USER_WORD_COVERAGE } =
  await import("../dist/workspace/verify-spec.js");
const { generateIdeaToSpecDraft } = await import("../dist/workspace/generate.js");

describe("contentWords", () => {
  it("stems Korean particles and verb endings", () => {
    assert.deepEqual(contentWords("리뷰를 요약해줘"), ["리뷰", "요약"]);
    assert.deepEqual(contentWords("linear에 보내는 앱"), ["linear", "보내"]);
  });

  it("drops stopwords and short fragments", () => {
    // 앱/서비스/만들… carry no product meaning. Single-syllable ending strip is
    // aggressive ("강아지" → "강아") — safe because matching is substring-based.
    assert.deepEqual(contentWords("강아지 산책 앱 서비스"), ["강아", "산책"]);
  });

  it("dedupes and lowercases (English plural stem)", () => {
    assert.deepEqual(contentWords("Reviews reviews REVIEW"), ["review"]);
  });
});

describe("verifySpecAgainstUserWords", () => {
  it("fails when the draft misses most of the user's words, and names them", () => {
    const draft = { productSpec: { oneLine: "회의를 녹음하면 요약이 정리됩니다" } };
    const v = verifySpecAgainstUserWords("리뷰를 요약해줘", draft);
    assert.equal(v.ok, false, "half coverage must fail the gate");
    assert.ok(v.coverage < MIN_USER_WORD_COVERAGE);
    assert.deepEqual(v.missingWords, ["리뷰"], "rejection must say WHAT was missing (no silent gate)");
    assert.deepEqual(v.matchedWords, ["요약"]);
  });

  it("passes when the draft reflects the user's words", () => {
    const draft = { productSpec: { oneLine: "리뷰를 모아 요약해서 보여주는 앱" } };
    const v = verifySpecAgainstUserWords("리뷰를 요약해줘", draft);
    assert.equal(v.ok, true);
    assert.equal(v.coverage, 1);
  });

  it("passes trivially when there is too little signal (single word)", () => {
    const v = verifySpecAgainstUserWords("앱 요약", { productSpec: {} });
    assert.equal(v.ok, true, "one content word is not enough to judge — never block on it");
  });
});

describe("generate mock path behind the gate (no API key)", () => {
  it('"리뷰를 요약해줘" must NOT fabricate the meeting-notes app', async () => {
    const res = await generateIdeaToSpecDraft({ idea: "리뷰를 요약해줘", locale: "ko" }, undefined);
    assert.equal(res.ok, true);
    assert.notEqual(res.productSpec.productName, "회의록 자동 요약 앱", "fabricated meeting app leaked out");
    assert.ok(
      JSON.stringify(res.productSpec).includes("리뷰"),
      "the draft must reflect the user's own words",
    );
    assert.ok(res.specVerification, "verification result must be attached");
  });

  it('a real meeting idea still gets the tailored meeting draft', async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "회의 내용을 요약해서 할 일을 linear로 보내는 앱", locale: "ko" },
      undefined,
    );
    assert.equal(res.ok, true);
    assert.equal(res.productSpec.productName, "회의록 자동 요약 앱");
    assert.equal(res.specVerification?.ok, true);
  });

  it('"linear에 보내는 앱" passes — the user named linear themselves (not fabrication)', async () => {
    const res = await generateIdeaToSpecDraft({ idea: "linear에 보내는 앱", locale: "ko" }, undefined);
    assert.equal(res.ok, true);
    assert.equal(res.specVerification?.ok, true);
  });

  it("a low-coverage draft ships with a loud warning, never silently", async () => {
    // 30 unique pseudo-words (~135 chars) — the generic fallback only embeds the
    // first 60 chars of the idea, so coverage lands well under the threshold.
    const idea = Array.from({ length: 30 }, (_, i) => `단어${i}`).join(" ");
    const res = await generateIdeaToSpecDraft({ idea, locale: "ko" }, undefined);
    assert.equal(res.ok, true);
    assert.equal(res.specVerification?.ok, false);
    const warningText = (res.warnings ?? []).join(" ");
    assert.ok(warningText.includes("반영되지"), "user must be told the draft may not reflect their words");
    // The warning names the missing words (capped at 8) — never a silent gate.
    const firstMissing = res.specVerification.missingWords[0];
    assert.ok(firstMissing, "missingWords must be populated");
    assert.ok(warningText.includes(firstMissing), "the missing words must be named (no silent rejection)");
  });
});

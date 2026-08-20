import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G14-b (2026-08-20): 수정 제안(fix-suggestion)의 EN locale 지원 — 프롬프트와
// 결정론 폴백 모두. locale 분기 이전 코드에서는 실패한다.

const { generateFixSuggestion } = await import("../dist/workspace/fix.js");

const HANGUL = /[가-힣]/;

const EN_CHECK_RESULT = {
  reason: "This item is in the excluded scope.",
  evidence: ["live recording — excluded in this version"],
  nextAction: "Re-check the spec's included/excluded scope.",
};

const EN_SPEC = { productName: "Meeting summarizer", excluded: ["live recording"], openQuestions: ["decide the file size cap"] };

function assertNoHangulDeep(suggestion) {
  const strings = [
    suggestion.plainSummary,
    suggestion.builderBrief.title,
    suggestion.builderBrief.goal,
    ...suggestion.productSpecPatch.addDecisions,
    ...suggestion.productSpecPatch.addCriteria,
    ...suggestion.productSpecPatch.addOpenQuestions,
    ...suggestion.builderBrief.context,
    ...suggestion.builderBrief.tasks,
    ...suggestion.builderBrief.doneWhen,
    ...suggestion.builderBrief.doNotDo,
    ...suggestion.builderBrief.verifyBy,
  ];
  for (const s of strings) assert.doesNotMatch(s, HANGUL, `Korean leaked into: ${s}`);
}

describe("workspace fix-suggestion — EN locale (G14-b)", () => {
  it("failed item → EN fallback with no Hangul", async () => {
    const result = await generateFixSuggestion(
      {
        item: { id: "req_003", title: "Provide live recording", status: "failed", criteria: ["live mic input"] },
        checkResult: EN_CHECK_RESULT,
        productSpec: EN_SPEC,
        locale: "en",
      },
      undefined,
    );
    assert.equal(result.ok, true);
    assert.equal(result.source, "mock-fallback");
    assertNoHangulDeep(result.suggestion);
  });

  it("inconclusive item → EN fallback with no Hangul", async () => {
    const result = await generateFixSuggestion(
      {
        item: { id: "req_002", title: "Uploaded audio becomes text", status: "inconclusive", criteria: [] },
        checkResult: EN_CHECK_RESULT,
        productSpec: EN_SPEC,
        locale: "en",
      },
      undefined,
    );
    assert.equal(result.ok, true);
    assertNoHangulDeep(result.suggestion);
  });

  it("needs_decision item → EN fallback with no Hangul", async () => {
    const result = await generateFixSuggestion(
      {
        item: { id: "req_004", title: "Show the file size cap", status: "needs_decision", criteria: ["cap notice"] },
        checkResult: EN_CHECK_RESULT,
        productSpec: EN_SPEC,
        locale: "en",
      },
      undefined,
    );
    assert.equal(result.ok, true);
    assertNoHangulDeep(result.suggestion);
  });

  it("KO fallback unchanged when locale omitted (legacy callers)", async () => {
    const result = await generateFixSuggestion(
      {
        item: { id: "req_002", title: "업로드된 녹음을 텍스트로 바꿔야 함", status: "inconclusive", criteria: [] },
        checkResult: { reason: "완성 기준이 없습니다.", evidence: [], nextAction: "기준을 추가하세요." },
        productSpec: EN_SPEC,
      },
      undefined,
    );
    assert.match(result.suggestion.plainSummary, HANGUL);
  });
});

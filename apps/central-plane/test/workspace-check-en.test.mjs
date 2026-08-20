import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G14-b (2026-08-20): EN 유저가 한국어 검수 판정을 받던 하드코딩 제거.
// 프롬프트와 휴리스틱 폴백 모두 locale을 따른다. 이 테스트들은 locale 분기
// 이전 코드로 되돌리면 실패한다(옛 코드는 EN 요청에도 한국어 프로즈 반환).

const { generateCheckDraft, buildCheckPrompt } = await import("../dist/workspace/check.js");

const HANGUL = /[가-힣]/;

const EN_SPEC = {
  productName: "Meeting summarizer",
  oneLine: "Record a meeting and get a summary with action items",
  targetUsers: ["busy teams"],
  problem: "Writing up meetings takes too long.",
  included: ["audio upload", "summary generation", "action item extraction"],
  excluded: ["live recording", "video calls"],
  userFlow: ["upload", "summarize", "review"],
  decisions: ["only confirmed action items are exported"],
  openQuestions: ["decide the file size cap"],
};

const EN_ITEMS = [
  { id: "req_001", title: "Users can upload an audio file", status: "not_started", criteria: ["mp3 supported", "error message shown on failure"] },
  { id: "req_002", title: "Uploaded audio becomes text", status: "not_started", criteria: [] },
  { id: "req_003", title: "Provide live recording", status: "not_started", criteria: ["live mic input"] },
  { id: "req_004", title: "Show the file size cap", status: "not_started", criteria: ["cap notice shown"] },
];

describe("workspace check-draft — EN locale (G14-b)", () => {
  it("EN prompt asks for English output and drops the Korean-only instruction", () => {
    const en = buildCheckPrompt({ productSpec: EN_SPEC, items: EN_ITEMS, locale: "en" });
    assert.match(en, /Write ALL user-facing text in English/);
    assert.doesNotMatch(en, /한국어로 작성/);
    // KO path unchanged (regression guard)
    const ko = buildCheckPrompt({ productSpec: EN_SPEC, items: EN_ITEMS, locale: "ko" });
    assert.match(ko, /모든 사용자 대상 텍스트는 한국어로 작성/);
  });

  it("EN heuristic fallback prose (reason/nextAction) contains no Hangul", async () => {
    const result = await generateCheckDraft({ productSpec: EN_SPEC, items: EN_ITEMS, locale: "en" }, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.source, "mock-fallback");
    for (const r of result.results) {
      assert.doesNotMatch(r.reason, HANGUL, `reason for ${r.itemId} leaked Korean: ${r.reason}`);
      assert.doesNotMatch(r.nextAction, HANGUL, `nextAction for ${r.itemId} leaked Korean: ${r.nextAction}`);
    }
    // branch coverage stays intact in EN: excluded → failed, no criteria → inconclusive
    assert.equal(result.results.find((r) => r.itemId === "req_003").status, "failed");
    assert.equal(result.results.find((r) => r.itemId === "req_002").status, "inconclusive");
  });

  it("EN security keywords trigger the thin-criteria rule (KO-only regex missed them)", async () => {
    const items = [
      { id: "sec_1", title: "Only the signed-in user can access their own data", status: "not_started", criteria: ["owner check", "redirect on logout"] },
    ];
    const result = await generateCheckDraft({ productSpec: EN_SPEC, items, locale: "en" }, undefined);
    assert.equal(result.results[0].status, "inconclusive", "permission item with thin criteria must not silently pass in EN");
  });

  it("empty items warning is localized", async () => {
    const en = await generateCheckDraft({ productSpec: EN_SPEC, items: [], locale: "en" }, undefined);
    assert.doesNotMatch(en.warnings[0], HANGUL);
    const ko = await generateCheckDraft({ productSpec: EN_SPEC, items: [], locale: "ko" }, undefined);
    assert.equal(ko.warnings[0], "확인할 항목이 없습니다.");
  });

  it("KO fallback prose unchanged when locale omitted (legacy callers)", async () => {
    const result = await generateCheckDraft({ productSpec: EN_SPEC, items: EN_ITEMS }, undefined);
    const noCriteria = result.results.find((r) => r.itemId === "req_002");
    assert.equal(noCriteria.reason, "완성 기준이 없어서 실제로 구현이 됐는지 확인하기 어렵습니다.");
  });
});

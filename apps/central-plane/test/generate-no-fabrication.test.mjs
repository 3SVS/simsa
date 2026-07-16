import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P0 honesty guard: the LLM-unavailable mock fallback must never fabricate a
// specific unrelated product from a single common word. The old trigger fired on
// "요약" or "linear" ALONE, so a review-summary app or a meeting-ROOM booking app
// got a canned "회의록 → Linear 전송" spec. This locks the narrowed trigger.

const { generateIdeaToSpecDraft } = await import("../dist/workspace/generate.js");

function specText(res) {
  return JSON.stringify(res.productSpec) + " " + JSON.stringify(res.items);
}

describe("mock fallback never fabricates an unrelated meeting/Linear product", () => {
  it("a review-summary idea (요약, no meeting context) is NOT turned into a 회의록/Linear app", async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "고객 리뷰를 요약해서 한눈에 정리해주는 앱", answers: [] },
      undefined, // no key → mock fallback
    );
    assert.equal(res.source, "mock-fallback");
    const text = specText(res);
    assert.ok(!/회의록|Linear/i.test(text), `should not fabricate a meeting/Linear spec, got: ${text.slice(0, 200)}`);
    // It should echo the actual idea instead.
    assert.ok(res.productSpec.oneLine.includes("리뷰") || res.productSpec.productName.includes("리뷰"), "should reflect the real idea");
  });

  it("a meeting-ROOM booking idea (회의 but no 요약/할일) is NOT turned into a 회의록/Linear app", async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "회의실을 예약하고 시간표를 관리하는 앱", answers: [] },
      undefined,
    );
    assert.equal(res.source, "mock-fallback");
    assert.ok(!/회의록|Linear/i.test(specText(res)), "meeting-room booking must not become meeting-notes");
  });

  it("a genuine meeting-notes idea (회의 + 요약) still gets the meeting spec (feature preserved)", async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "회의를 녹음하면 요약하고 할 일을 정리해주는 앱", answers: [] },
      undefined,
    );
    assert.equal(res.source, "mock-fallback");
    assert.ok(/회의|요약/.test(specText(res)), "genuine meeting idea should still produce a meeting-shaped draft");
  });
});

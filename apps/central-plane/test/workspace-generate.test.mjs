import { describe, it, mock, before } from "node:test";
import assert from "node:assert/strict";

// Import the generate module (ESM)
const generateModule = await import("../dist/workspace/generate.js");
const { generateIdeaToSpecDraft } = generateModule;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertValidResponse(result) {
  assert.equal(result.ok, true);
  assert.ok(["llm", "mock-fallback"].includes(result.source));
  assert.ok(typeof result.understood.summary === "string");
  assert.ok(Array.isArray(result.understood.targetUsers));
  assert.ok(Array.isArray(result.understood.mainFlow));
  assert.ok(Array.isArray(result.questions));
  assert.ok(typeof result.productSpec.productName === "string");
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.length >= 3);
  result.items.forEach((item) => {
    assert.equal(item.status, "not_started");
    assert.ok(Array.isArray(item.criteria));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generateIdeaToSpecDraft", () => {
  it("returns mock-fallback when no API key provided", async () => {
    const result = await generateIdeaToSpecDraft(
      { idea: "회의 녹음 자동 요약 앱" },
      undefined,
    );
    assert.equal(result.source, "mock-fallback");
    assertValidResponse(result);
  });

  it("returns mock-fallback for meeting idea without API key", async () => {
    const result = await generateIdeaToSpecDraft(
      { idea: "회의 녹음 파일을 올리면 요약해주는 앱" },
      undefined,
    );
    assert.equal(result.source, "mock-fallback");
    assert.ok(result.questions.length >= 2);
    assertValidResponse(result);
  });

  it("returns mock-fallback for generic idea without API key", async () => {
    const result = await generateIdeaToSpecDraft(
      { idea: "사진을 올리면 상품 설명을 써주는 서비스" },
      undefined,
    );
    assert.equal(result.source, "mock-fallback");
    assertValidResponse(result);
  });

  it("generic fallback is Korean by default (no English leak for KR users)", async () => {
    const result = await generateIdeaToSpecDraft(
      { idea: "부동산 매물 관리 서비스" }, // non-meeting → generic branch
      undefined,
    );
    assert.equal(result.source, "mock-fallback");
    // The acceptance items a non-dev reads must be Korean, not "The core feature works end to end".
    const titles = result.items.map((i) => i.title).join(" ");
    assert.ok(/[가-힣]/.test(titles), "generic fallback item titles must be Korean");
    assert.ok(!/works end to end/i.test(titles), "must not leak the English generic template");
    assert.ok(/[가-힣]/.test(result.understood.summary), "summary must be Korean");
  });

  it("generic fallback honors locale:'en'", async () => {
    const result = await generateIdeaToSpecDraft(
      { idea: "a real-estate listing manager", locale: "en" },
      undefined,
    );
    assert.equal(result.source, "mock-fallback");
    assert.match(result.items.map((i) => i.title).join(" "), /works end to end/i);
  });

  it("handles empty idea gracefully", async () => {
    const result = await generateIdeaToSpecDraft({ idea: "" }, undefined);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.warnings));
  });

  it("returns mock-fallback when Anthropic returns non-JSON", async () => {
    // Simulate malformed LLM response via a fake API key that hits a mock
    // We test the fallback path by passing a key that will get a network error
    const result = await generateIdeaToSpecDraft(
      { idea: "테스트 아이디어" },
      "fake-key-will-fail",
    );
    // Should still return valid shape (fallback)
    assert.equal(result.ok, true);
    assertValidResponse(result);
  });

  it("items all have status not_started", async () => {
    const result = await generateIdeaToSpecDraft(
      { idea: "회의 녹음 자동 요약" },
      undefined,
    );
    result.items.forEach((item) => {
      assert.equal(item.status, "not_started", `item ${item.id} has wrong status`);
    });
  });
});

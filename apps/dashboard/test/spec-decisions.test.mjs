import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decisionLine,
  applyResolvedDecision,
  applyAllResolvedDecisions,
} from "../src/lib/spec-decisions.mjs";

// P0-honesty (audit v2 2.3): a C2 answer must reach the productSpec that
// checks/export/builder-pack read — decisions gains "질문 — 답" and the
// question leaves openQuestions. Previously the answer was stored only in
// resolvedOpenDecisions and silently never reached the builder.

const SPEC = {
  productName: "동네 러닝 모임",
  oneLine: "동네 러닝 모임 앱",
  targetUsers: [],
  problem: "",
  included: [],
  excluded: [],
  userFlow: [],
  decisions: ["로그인은 이메일만"],
  openQuestions: ["모임 정원 제한?", "지도 표시 방식?"],
};

describe("applyResolvedDecision", () => {
  it("answer moves the question into decisions and out of openQuestions", () => {
    const next = applyResolvedDecision(SPEC, "모임 정원 제한?", "10명까지");
    assert.deepEqual(next.openQuestions, ["지도 표시 방식?"]);
    assert.deepEqual(next.decisions, ["로그인은 이메일만", decisionLine("모임 정원 제한?", "10명까지")]);
    // immutable — the original is untouched
    assert.deepEqual(SPEC.openQuestions, ["모임 정원 제한?", "지도 표시 방식?"]);
  });

  it("re-answering replaces the previous decision line (no duplicates)", () => {
    const once = applyResolvedDecision(SPEC, "모임 정원 제한?", "10명까지");
    const twice = applyResolvedDecision(once, "모임 정원 제한?", "20명까지");
    assert.deepEqual(twice.decisions, ["로그인은 이메일만", "모임 정원 제한? — 20명까지"]);
    assert.equal(twice.decisions.filter((d) => d.startsWith("모임 정원 제한?")).length, 1);
  });

  it("empty answer (취소) restores the question and removes the decision", () => {
    const answered = applyResolvedDecision(SPEC, "모임 정원 제한?", "10명까지");
    const restored = applyResolvedDecision(answered, "모임 정원 제한?", "");
    assert.deepEqual(restored.decisions, ["로그인은 이메일만"]);
    assert.ok(restored.openQuestions.includes("모임 정원 제한?"));
    assert.equal(restored.openQuestions.filter((q) => q === "모임 정원 제한?").length, 1);
  });

  it("pre-existing unrelated decisions are never touched", () => {
    const next = applyResolvedDecision(SPEC, "지도 표시 방식?", "목록만");
    assert.ok(next.decisions.includes("로그인은 이메일만"));
  });

  it("blank question is a no-op", () => {
    assert.equal(applyResolvedDecision(SPEC, "  ", "답"), SPEC);
  });
});

describe("applyAllResolvedDecisions", () => {
  it("applies a whole resolved map", () => {
    const next = applyAllResolvedDecisions(SPEC, {
      "모임 정원 제한?": "10명까지",
      "지도 표시 방식?": "목록만",
    });
    assert.deepEqual(next.openQuestions, []);
    assert.equal(next.decisions.length, 3);
  });

  it("handles undefined map", () => {
    assert.deepEqual(applyAllResolvedDecisions(SPEC, undefined), SPEC);
  });
});

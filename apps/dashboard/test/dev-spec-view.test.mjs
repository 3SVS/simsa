import { describe, it } from "node:test";
import assert from "node:assert/strict";

// SI 티어 A4 · D-17: 개발 지시서 화면의 순수 로직. 초보자 4줄은 개수와 제목만(점수 없음),
// 생성 버튼은 설명서·항목이 있어야 켜진다, 실패는 종류별로 말한다.

const { devSpecView, generateButtonState, generateErrorKey } = await import("../src/lib/dev-spec-view.mjs");

const spec = {
  meta: { version: 1, source: "inferred", locale: "ko", generatedAt: "2026-09-24T03:00:00Z" },
  brief: { productName: "댕댕 산책 기록", oneLine: "반려견 산책을 기록하는 웹앱", excluded: ["훈련 기능", 3] },
  features: [{ id: "FR-001", title: "산책 기록", priority: "must" }, { id: "FR-002", title: "통계", priority: "should" }],
  acceptance: [{ id: "AC-001", featureId: "FR-001", verifiedBy: "browser" }, { id: "AC-002", featureId: "FR-002", verifiedBy: "human" }],
  screens: [{ id: "SCR-001" }],
  dataModel: [{ name: "walks" }, { name: "dogs" }],
  apis: [],
  workBreakdown: [{ id: "WBS-001" }],
  testPlan: [{ kind: "browser", acceptanceId: "AC-001" }],
  openQuestions: ["공유 범위"],
};

describe("devSpecView", () => {
  it("초보자 4줄 + 개수 + 사람 판단 개수", () => {
    const v = devSpecView(spec);
    assert.equal(v.what, "반려견 산책을 기록하는 웹앱");
    assert.equal(v.screenCount, 1);
    assert.equal(v.entityCount, 2);
    assert.deepEqual(v.excluded, ["훈련 기능"]);
    assert.deepEqual(v.mustFeatureTitles, ["산책 기록"]);
    assert.deepEqual(v.counts, { features: 2, acceptance: 2, screens: 1, entities: 2, apis: 0, wbs: 1, tests: 1, openQuestions: 1 });
    assert.equal(v.source, "inferred");
    assert.equal(v.humanOnlyCount, 1);
    assert.ok(!Object.keys(v).some((k) => /score|rating|grade/i.test(k)));
  });

  it("DevSpec 모양이 아니면 null (화면은 '아직 없어요')", () => {
    assert.equal(devSpecView(null), null);
    assert.equal(devSpecView({ garbage: true }), null);
    assert.equal(devSpecView({ features: [], acceptance: [] }), null);
  });
});

describe("generateButtonState", () => {
  it("설명서 없음 → 비활성 + needSpec, 항목 없음 → needItems", () => {
    assert.deepEqual(generateButtonState({ hasSpec: false, hasItems: false, hasDevSpec: false, phase: "idle" }), { enabled: false, labelKey: "make", hintKey: "needSpec" });
    assert.deepEqual(generateButtonState({ hasSpec: true, hasItems: false, hasDevSpec: false, phase: "idle" }), { enabled: false, labelKey: "make", hintKey: "needItems" });
  });
  it("둘 다 있으면 켜지고, 이미 있으면 '다시 만들기', 진행 중이면 잠금", () => {
    assert.deepEqual(generateButtonState({ hasSpec: true, hasItems: true, hasDevSpec: false, phase: "idle" }), { enabled: true, labelKey: "make", hintKey: null });
    assert.deepEqual(generateButtonState({ hasSpec: true, hasItems: true, hasDevSpec: true, phase: "idle" }), { enabled: true, labelKey: "remake", hintKey: null });
    assert.equal(generateButtonState({ hasSpec: true, hasItems: true, hasDevSpec: true, phase: "loading" }).enabled, false);
  });
});

describe("generateErrorKey — 실패는 종류별로, 예시 대체 없음", () => {
  it("매핑", () => {
    assert.equal(generateErrorKey({ error: "llm_unavailable" }), "errLlm");
    assert.equal(generateErrorKey({ error: "dev_spec_invalid", stage: "integrity", issueCount: 3 }), "errInvalid");
    assert.equal(generateErrorKey({ error: "rate_limited", retryAfterSeconds: 60 }), "errRateLimited");
    assert.equal(generateErrorKey({ error: "not_found" }), "errNotSynced");
    assert.equal(generateErrorKey({ error: "network" }), "errNetwork");
    assert.equal(generateErrorKey({ error: "server" }), "errServer");
  });
});

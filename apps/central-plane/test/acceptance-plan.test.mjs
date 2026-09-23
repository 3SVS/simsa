import { describe, it } from "node:test";
import assert from "node:assert/strict";

// SI 티어 A5: 지시서 테스트 계획 → 검수 시나리오. must 먼저, human 제외, 상한, 깨진 지시서는 빈 배열.

const { acceptancePlanFromDevSpec, DEFAULT_MAX_SCENARIOS } = await import("../dist/acceptance-plan.js");

function spec() {
  return {
    meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-24T03:00:00.000Z" },
    brief: { productName: "댕댕 산책 기록", oneLine: "산책 기록 웹앱", targetUsers: [], problem: "p", included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
    features: [
      { id: "FR-001", title: "산책 기록", description: "d", priority: "must" },
      { id: "FR-002", title: "주간 통계", description: "d", priority: "should" },
      { id: "FR-003", title: "공유", description: "d", priority: "could" },
      { id: "FR-004", title: "디자인 느낌", description: "d", priority: "must" },
    ],
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "g", when: "w", then: "목록에 1건이 보인다", verifiedBy: "browser" },
      { id: "AC-002", featureId: "FR-002", given: "g", when: "w", then: "합계가 보인다", verifiedBy: "browser" },
      { id: "AC-003", featureId: "FR-003", given: "g", when: "w", then: "링크가 복사된다", verifiedBy: "browser" },
      { id: "AC-004", featureId: "FR-004", given: "g", when: "w", then: "따뜻한 느낌이다", verifiedBy: "human" },
      { id: "AC-005", featureId: "FR-001", given: "g", when: "w", then: "빌드가 된다", verifiedBy: "build" },
    ],
    screens: [{ id: "SCR-001", route: "/", purpose: "p", components: ["시작"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001", "FR-004"] }],
    dataModel: [],
    apis: [{ id: "API-001", method: "GET", path: "/api/stats", errors: [], auth: "none", featureIds: ["FR-002"] }],
    nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "전부", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002", "AC-003", "AC-004", "AC-005"] }],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-003", steps: ["/ 열기", "공유 누름"] },
      { kind: "browser", acceptanceId: "AC-002", steps: ["/stats 열기"] },
      { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "시작 누름", "종료 누름"] },
    ],
    assumptions: [],
    openQuestions: [],
  };
}

describe("acceptancePlanFromDevSpec", () => {
  it("browser 계획만, must→should→could 순, 앵커는 then + steps", () => {
    const plan = acceptancePlanFromDevSpec(spec());
    assert.deepEqual(plan.map((p) => p.acceptanceId), ["AC-001", "AC-002", "AC-003"]);
    assert.equal(plan[0].featureTitle, "산책 기록");
    assert.equal(plan[0].priority, "must");
    assert.equal(plan[0].anchor, "목록에 1건이 보인다. / 열기 → 시작 누름 → 종료 누름");
    assert.deepEqual(plan[0].steps, ["/ 열기", "시작 누름", "종료 누름"]);
  });

  it("human·build AC는 시나리오가 되지 않는다(사람 판단은 기계가 대신 못 한다)", () => {
    const ids = acceptancePlanFromDevSpec(spec()).map((p) => p.acceptanceId);
    assert.ok(!ids.includes("AC-004") && !ids.includes("AC-005"));
  });

  it("상한(기본 4)과 max 옵션", () => {
    assert.equal(DEFAULT_MAX_SCENARIOS, 4);
    assert.equal(acceptancePlanFromDevSpec(spec(), { max: 1 }).length, 1);
    assert.equal(acceptancePlanFromDevSpec(spec(), { max: 1 })[0].acceptanceId, "AC-001");
    assert.equal(acceptancePlanFromDevSpec(spec(), { max: 0 }).length, 0);
  });

  it("지시서가 없거나 깨졌으면 빈 배열 — 검수는 종전대로", () => {
    assert.deepEqual(acceptancePlanFromDevSpec(null), []);
    assert.deepEqual(acceptancePlanFromDevSpec(undefined), []);
    assert.deepEqual(acceptancePlanFromDevSpec({ garbage: true }), []);
    const s = spec();
    s.workBreakdown[0].acceptanceIds = ["AC-999"]; // 무결성 위반 → 신뢰 불가 → 빈 배열
    assert.deepEqual(acceptancePlanFromDevSpec(s), []);
  });
});

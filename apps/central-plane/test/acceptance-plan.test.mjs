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

// ─── 2026-10-18 문 (b) 격차 §1-2 · HANDOFF §3-3: 상한에 잘릴 때 사용자 작성 우선 + 기준 차이(diff) ───────────────

const { agentAcsFromDevSpec, diffAcs } = await import("../dist/acceptance-plan.js");
const { validateDevSpec } = await import("../dist/workspace/dev-spec.js");

/** 역추론 지시서: 체크한 기능 6개(AC 2개씩 = AC-001~012) + 사용자가 "빠진 것"에 직접 적은 기능 4개(AC 1개씩 = AC-013~016). */
function inferredSpecUserTextLast() {
  const features = [];
  const acceptance = [];
  const testPlan = [];
  let acN = 0;
  const ac = (fid) => {
    acN += 1;
    const id = `AC-${String(acN).padStart(3, "0")}`;
    acceptance.push({ id, featureId: fid, given: "예약 화면", when: `행동 ${acN}`, then: `결과 ${acN}이 보인다`, verifiedBy: "browser" });
    testPlan.push({ kind: "browser", acceptanceId: id, steps: ["/ 열기", `행동 ${acN}`] });
    return id;
  };
  for (let i = 1; i <= 6; i += 1) {
    features.push({ id: `FR-00${i}`, title: `체크한 기능 ${i}`, description: "d", priority: "must" });
    ac(`FR-00${i}`);
    ac(`FR-00${i}`);
  }
  const userTextAcIds = [];
  for (let i = 7; i <= 10; i += 1) {
    const fid = `FR-${String(i).padStart(3, "0")}`;
    features.push({ id: fid, title: `직접 적은 기능 ${i}`, description: "d", priority: "must" });
    userTextAcIds.push(ac(fid));
  }
  const checkedAcIds = acceptance.map((a) => a.id).filter((id) => !userTextAcIds.includes(id));
  return {
    meta: {
      version: 1, source: "inferred", locale: "ko", generatedAt: "2026-10-18T00:00:00.000Z",
      provenance: { builtWith: "lovable", entryPath: "code", userConfirmedAcIds: [...checkedAcIds, ...userTextAcIds], userTextAcIds },
    },
    brief: { productName: "(주)트루픽셀 예약 앱", oneLine: "미용실 예약", targetUsers: [], problem: "p", included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
    features,
    acceptance,
    screens: [{ id: "SCR-001", route: "/", purpose: "p", components: ["예약"], states: {}, entryFrom: [], exitTo: [], featureIds: features.map((f) => f.id) }],
    dataModel: [],
    apis: [],
    nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "전부", order: 1, dependsOn: [], acceptanceIds: acceptance.map((a) => a.id) }],
    testPlan,
    assumptions: [],
    openQuestions: [],
  };
}

describe("agentAcsFromDevSpec — 상한에 잘릴 때 사용자가 직접 적은 기준이 먼저 남는다(옛 코드: 저장 순서라 전부 잘림)", () => {
  it("10칸: 직접 적은 4개 전부 + 체크한 기능 6개마다 첫 AC 1개", () => {
    const spec = inferredSpecUserTextLast();
    assert.equal(validateDevSpec(spec).ok, true, "픽스처가 무결성을 통과해야 비교가 뜻이 있다");
    const acs = agentAcsFromDevSpec(spec, { max: 10 });
    assert.equal(acs.length, 10);
    const ids = acs.map((a) => a.id);
    for (const id of ["AC-013", "AC-014", "AC-015", "AC-016"]) assert.ok(ids.includes(id), `${id}(user_text) 포함`);
    assert.deepEqual(acs.slice(0, 4).map((a) => a.origin), ["user_text", "user_text", "user_text", "user_text"], "직접 적은 것이 맨 앞");
    for (let i = 1; i <= 6; i += 1) assert.ok(acs.some((a) => a.title === `체크한 기능 ${i}`), `체크한 기능 ${i}에 AC ≥1`);
    assert.ok(acs.every((a) => a.priority === "must" && a.confirmed === true));
  });

  it("같은 출처 안에서는 기능마다 첫 AC를 먼저(라운드로빈), 그 다음 둘째 AC — 저장 순서는 마지막 열쇠", () => {
    const spec = inferredSpecUserTextLast();
    const acs = agentAcsFromDevSpec(spec, { max: 16 });
    const checked = acs.filter((a) => a.origin === "user_checked").map((a) => a.id);
    assert.deepEqual(checked, ["AC-001", "AC-003", "AC-005", "AC-007", "AC-009", "AC-011", "AC-002", "AC-004", "AC-006", "AC-008", "AC-010", "AC-012"]);
  });

  it("기본 풀 상한은 16 — 체크 12 + 직접 4가 전부 실린다(옛 코드 10)", () => {
    assert.equal(agentAcsFromDevSpec(inferredSpecUserTextLast()).length, 16);
  });
});

describe("diffAcs — 기획 변경 재생성 뒤 이전 기준과의 차이(제목+결과로 대응, id 무관)", () => {
  const a = (id, title, then) => ({ id, title, then, given: "g", when: "w", priority: "must", confirmed: true });
  it("id가 달라도 제목·결과가 같으면 유지, 없어진 것은 removed, 새것은 added", () => {
    const prev = [a("AC-001", "예약하기", "예약이 된다"), a("AC-002", "취소", "취소된다")];
    const next = [a("AC-007", "예약하기", "예약이  된다."), a("AC-003", "관리 화면", "오늘 목록이 보인다")];
    const d = diffAcs(prev, next);
    assert.deepEqual(d.kept, [{ prevId: "AC-001", nextId: "AC-007", title: "예약하기" }]);
    assert.deepEqual(d.removed.map((x) => x.id), ["AC-002"]);
    assert.deepEqual(d.added.map((x) => x.id), ["AC-003"]);
  });
  it("같은 기준이 둘이면 하나씩만 짝짓는다(중복이 kept를 부풀리지 않는다)", () => {
    const prev = [a("AC-001", "예약하기", "예약이 된다")];
    const next = [a("AC-001", "예약하기", "예약이 된다"), a("AC-002", "예약하기", "예약이 된다")];
    const d = diffAcs(prev, next);
    assert.equal(d.kept.length, 1);
    assert.deepEqual(d.added.map((x) => x.id), ["AC-002"]);
    assert.equal(d.removed.length, 0);
  });
});

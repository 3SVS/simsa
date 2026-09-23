import { describe, it } from "node:test";
import assert from "node:assert/strict";

// SI 티어 D-3 (LOCKED 2026-09-24): 다단계 생성기. LLM은 심(seam)으로 주입 — 네트워크 없음.
// 규칙: 예시 폴백 없음(못 만들면 정직하게 실패), 무결성 위반은 해당 패스부터 1회만 재생성,
// 출구는 validateDevSpec 통과본뿐.

const { generateDevSpec, buildPassPrompt, repairStartPass } = await import("../dist/workspace/generate-dev-spec.js");
const { validateDevSpec } = await import("../dist/workspace/dev-spec.js");

const brief = {
  productName: "댕댕 산책 기록",
  oneLine: "반려견과의 산책을 쉽게 기록하고 주간 거리 변화를 한눈에 보는 웹앱",
  targetUsers: ["반려견 보호자"],
  problem: "얼마나 자주, 얼마나 멀리 걸었는지 한눈에 보기 어렵다",
  included: ["산책 시작·종료 기록", "주간 누적 거리"],
  excluded: ["훈련 기능"],
  userFlow: ["시작 누름 → 종료 누름 → 목록에 보임"],
  decisions: [],
  openQuestions: [],
};
const items = [
  { id: "req_001", title: "산책을 기록할 수 있다", status: "not_started", criteria: ["시작·종료를 누르면 목록에 1건이 생긴다"] },
  { id: "req_002", title: "주간 합계를 볼 수 있다", status: "not_started", criteria: ["통계 화면에 합계 거리가 보인다"] },
];

const P1 = {
  features: [
    { id: "FR-001", title: "산책 기록", description: "시작·종료를 눌러 산책 1건을 저장한다", priority: "must" },
    { id: "FR-002", title: "주간 통계", description: "이번 주 누적 거리를 보여준다", priority: "should" },
  ],
  acceptance: [
    { id: "AC-001", featureId: "FR-001", given: "빈 목록", when: "시작 후 종료를 누르면", then: "목록에 1건이 보인다", verifiedBy: "browser" },
    { id: "AC-002", featureId: "FR-002", given: "산책 2건 저장됨", when: "통계 화면을 열면", then: "합계 거리가 보인다", verifiedBy: "browser" },
  ],
};
const P2 = {
  screens: [
    { id: "SCR-001", route: "/", purpose: "산책 시작·종료와 최근 목록", components: ["시작 버튼", "산책 목록"], states: { empty: "아직 기록이 없어요" }, entryFrom: ["첫 진입"], exitTo: ["/stats"], featureIds: ["FR-001"] },
    { id: "SCR-002", route: "/stats", purpose: "주간 합계", components: ["합계 카드"], states: {}, entryFrom: ["/"], exitTo: ["/"], featureIds: ["FR-002"] },
  ],
  dataModel: [{ name: "walks", fields: [{ name: "id", type: "text", required: true }], relations: [], ownership: "unknown" }],
  apis: [{ id: "API-001", method: "POST", path: "/api/walks", errors: ["400 invalid"], auth: "none", featureIds: ["FR-001"] }],
  nonFunctional: [{ kind: "performance", requirement: "unknown" }],
};
const P3 = {
  workBreakdown: [
    { id: "WBS-001", title: "walks 저장", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] },
    { id: "WBS-002", title: "통계 화면", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-002"] },
  ],
  testPlan: [
    { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "시작 누름", "종료 누름", "목록 확인"] },
    { kind: "browser", acceptanceId: "AC-002", steps: ["/stats 열기", "합계 확인"] },
  ],
  assumptions: ["거리는 브라우저 위치 권한으로 잰다"],
  openQuestions: [],
};

const usage = { model: "mock", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, latencyMs: 1 };
/** 프롬프트 내용으로 패스를 판별하는 모크 — 호출 순서에 의존하지 않는다. */
function passOf(prompt) {
  if (/작업 분해|work breakdown/i.test(prompt)) return "plan";
  if (/화면·데이터·API|screens · data/i.test(prompt)) return "surfaces";
  return "requirements";
}
function mockCaller(responses, log = []) {
  return async (prompt) => {
    const pass = passOf(prompt);
    log.push({ pass, prompt });
    const r = responses[pass];
    const body = typeof r === "function" ? r(log.filter((l) => l.pass === pass).length, prompt) : r;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { text, usage };
  };
}

describe("generateDevSpec — 정상 3패스", () => {
  it("브리프+항목 → 무결성 통과 DevSpec, meta.source/locale 반영, 재생성 없음", async () => {
    const log = [];
    const r = await generateDevSpec({ brief, items, idea: "댕댕 산책 기록 앱", locale: "ko", source: "generated" }, mockCaller({ requirements: P1, surfaces: P2, plan: P3 }, log), { now: () => new Date("2026-09-24T03:00:00Z") });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.repaired, false);
    assert.equal(r.devSpec.meta.source, "generated");
    assert.equal(r.devSpec.meta.locale, "ko");
    assert.equal(r.devSpec.brief.productName, "댕댕 산책 기록");
    assert.deepEqual(log.map((l) => l.pass), ["requirements", "surfaces", "plan"]);
    assert.equal(validateDevSpec(r.devSpec).ok, true);
    assert.equal(r.llmUsage.length, 3);
  });

  it("P2 프롬프트에는 P1의 FR id가, P3 프롬프트에는 P1·P2가 들어간다(참조 무결성의 전제)", async () => {
    const log = [];
    await generateDevSpec({ brief, items, locale: "en", source: "inferred" }, mockCaller({ requirements: P1, surfaces: P2, plan: P3 }, log));
    const p2 = log.find((l) => l.pass === "surfaces").prompt;
    const p3 = log.find((l) => l.pass === "plan").prompt;
    assert.ok(p2.includes("FR-001") && p2.includes("FR-002"));
    assert.ok(p3.includes("AC-002") && p3.includes("SCR-001"));
    assert.ok(/Return \*\*JSON only\*\*/.test(p2), "EN 규칙 블록");
  });

  it("한국어 브리프 원문이 프롬프트에 그대로 실린다(Rule 6 — 한글 리얼 입력)", () => {
    const p = buildPassPrompt("requirements", "ko", { brief, items: [{ title: "산책을 기록할 수 있다", criteria: ["목록에 1건"] }], idea: "댕댕이 산책" });
    assert.ok(p.includes("반려견과의 산책을 쉽게 기록하고"));
    assert.ok(p.includes("산책을 기록할 수 있다 — 목록에 1건"));
    assert.ok(p.includes("JSON만"));
  });
});

describe("generateDevSpec — 무결성 위반 → 해당 패스부터 1회 재생성 (D-3)", () => {
  it("P3가 없는 AC를 가리키면 P3만 다시 만들고(P1·P2 재호출 없음) 성공한다", async () => {
    const log = [];
    const badP3 = { ...P3, workBreakdown: [{ id: "WBS-001", title: "x", order: 1, dependsOn: [], acceptanceIds: ["AC-077"] }, P3.workBreakdown[1]] };
    const plan = (n) => (n === 1 ? badP3 : P3);
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mockCaller({ requirements: P1, surfaces: P2, plan }, log));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.repaired, true);
    assert.deepEqual(log.map((l) => l.pass), ["requirements", "surfaces", "plan", "plan"]);
    assert.ok(log[3].prompt.includes("wbs_unknown_acceptance @ WBS-001→AC-077"), "재생성 프롬프트에 위반이 실린다");
  });

  it("must 기능이 화면·API 어디에도 없으면 P2부터 다시 만든다(P3 포함)", async () => {
    const log = [];
    const badP2 = { ...P2, screens: P2.screens.map((s) => ({ ...s, featureIds: [] })), apis: P2.apis.map((a) => ({ ...a, featureIds: [] })) };
    const surfaces = (n) => (n === 1 ? badP2 : P2);
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mockCaller({ requirements: P1, surfaces, plan: P3 }, log));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(log.map((l) => l.pass), ["requirements", "surfaces", "plan", "surfaces", "plan"]);
  });

  it("두 번째도 틀리면 예시로 대체하지 않고 dev_spec_invalid(integrity)로 실패한다", async () => {
    const badP3 = { ...P3, workBreakdown: [{ id: "WBS-001", title: "x", order: 1, dependsOn: [], acceptanceIds: ["AC-077"] }] };
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mockCaller({ requirements: P1, surfaces: P2, plan: badP3 }));
    assert.equal(r.ok, false);
    assert.equal(r.error, "dev_spec_invalid");
    assert.equal(r.stage, "integrity");
    assert.ok(r.issues.some((i) => i.rule === "wbs_unknown_acceptance"));
  });

  it("repairStartPass — 규칙→패스 매핑", () => {
    assert.equal(repairStartPass([{ rule: "feature_without_ac", where: "FR-002" }]), "requirements");
    assert.equal(repairStartPass([{ rule: "duplicate_id", where: "AC-001" }]), "requirements");
    assert.equal(repairStartPass([{ rule: "must_feature_without_surface", where: "FR-001" }]), "surfaces");
    assert.equal(repairStartPass([{ rule: "duplicate_id", where: "SCR-001" }]), "surfaces");
    assert.equal(repairStartPass([{ rule: "acceptance_without_test_plan", where: "AC-001" }]), "plan");
  });
});

describe("generateDevSpec — 정직한 실패(예시 폴백 없음)", () => {
  it("모델이 산문을 두 번 내면 dev_spec_invalid(schema) — 절대 샘플로 대체하지 않는다", async () => {
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mockCaller({ requirements: "죄송하지만 도와드릴 수 없습니다." }));
    assert.equal(r.ok, false);
    assert.equal(r.error, "dev_spec_invalid");
    assert.equal(r.stage, "schema");
    assert.equal(r.passes.filter((p) => p.outcome === "shape_failure").length, 2);
  });

  it("스키마 위반 1회 → 위반 목록을 실어 같은 패스를 재시도하고 성공한다", async () => {
    const log = [];
    const requirements = (n) => (n === 1 ? { features: P1.features, acceptance: P1.acceptance.map((a) => ({ ...a, verifiedBy: "maybe" })) } : P1);
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mockCaller({ requirements, surfaces: P2, plan: P3 }, log));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(log[1].prompt.includes("acceptance.0.verifiedBy"), "재시도 프롬프트에 zod 경로가 실린다");
    assert.equal(r.passes[0].outcome, "schema_retry");
  });

  it("LLM 호출 자체가 던지면 llm_unavailable", async () => {
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, async () => { throw new Error("403 forbidden"); });
    assert.equal(r.ok, false);
    assert.equal(r.error, "llm_unavailable");
  });

  it("점수 필드를 섞어 보내면 스키마가 거부하고, 두 번째 시도에서 고치면 통과한다", async () => {
    const requirements = (n) => (n === 1 ? { ...P1, features: P1.features.map((f) => ({ ...f, score: 90 })) } : P1);
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mockCaller({ requirements, surfaces: P2, plan: P3 }));
    assert.equal(r.ok, true);
    assert.equal(JSON.stringify(r.devSpec).includes('"score"'), false);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// SI 티어 D-2 (LOCKED 2026-09-24): T0 개발 지시서 스키마 + 결정론 무결성.
// 규칙: 무결성 위반 픽스처는 전부 실패해야 하고, 정상 1종은 통과해야 한다.
// 숫자 점수 키는 스키마(.strict)와 스캔 양쪽에서 잡힌다(PRD §5.1).

const { DevSpecSchema, validateDevSpec, checkDevSpecIntegrity, findScoreLikeKeys, summarizeForBeginner } =
  await import("../dist/workspace/dev-spec.js");
const { parseDevSpecUpsert, DEV_SPEC_JSON_CAP } = await import("../dist/routes/workspace-dev-spec.js");

/** 한국어 리얼 입력 기준 정상 픽스처(Rule 6) — 반려견 산책 기록 앱. */
function validSpec() {
  return {
    meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-24T03:00:00.000Z" },
    brief: {
      productName: "댕댕 산책 기록",
      oneLine: "반려견과의 산책을 쉽게 기록하고 주간 거리 변화를 한눈에 보는 웹앱",
      targetUsers: ["반려견 보호자"],
      problem: "얼마나 자주, 얼마나 멀리 걸었는지 한눈에 보기 어렵다",
      included: ["산책 시작·종료 기록", "주간 누적 거리"],
      excluded: ["훈련 기능", "커뮤니티 피드"],
      userFlow: ["시작 누름 → 종료 누름 → 목록에 보임"],
      decisions: ["로그인 없음"],
      openQuestions: [],
    },
    features: [
      { id: "FR-001", title: "산책 기록", description: "시작·종료를 눌러 산책 1건을 저장한다", priority: "must" },
      { id: "FR-002", title: "주간 통계", description: "이번 주 누적 거리를 보여준다", priority: "should" },
    ],
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "빈 목록", when: "시작 후 종료를 누르면", then: "목록에 1건이 보인다", verifiedBy: "browser" },
      { id: "AC-002", featureId: "FR-002", given: "산책 2건 저장됨", when: "통계 화면을 열면", then: "합계 거리가 보인다", verifiedBy: "browser" },
    ],
    screens: [
      {
        id: "SCR-001", route: "/", purpose: "산책 시작·종료와 최근 목록",
        components: ["시작 버튼", "종료 버튼", "산책 목록"],
        states: { empty: "아직 산책 기록이 없어요", error: "저장에 실패했어요" },
        entryFrom: ["첫 진입"], exitTo: ["/stats"], featureIds: ["FR-001"],
      },
      {
        id: "SCR-002", route: "/stats", purpose: "주간 합계",
        components: ["주간 합계 카드"], states: { empty: "이번 주 기록이 없어요" },
        entryFrom: ["/"], exitTo: ["/"], featureIds: ["FR-002"],
      },
    ],
    dataModel: [
      {
        name: "walks",
        fields: [
          { name: "id", type: "text", required: true },
          { name: "started_at", type: "datetime", required: true },
          { name: "distance_m", type: "integer", required: false, default: "0" },
        ],
        relations: [],
        ownership: "unknown",
      },
    ],
    apis: [
      { id: "API-001", method: "POST", path: "/api/walks", errors: ["400 invalid"], auth: "none", featureIds: ["FR-001"] },
    ],
    nonFunctional: [{ kind: "performance", requirement: "unknown" }],
    workBreakdown: [
      { id: "WBS-001", title: "walks 테이블 + 저장 API", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] },
      { id: "WBS-002", title: "통계 화면", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-002"] },
    ],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "시작 누름", "종료 누름", "목록 1건 확인"] },
      { kind: "browser", acceptanceId: "AC-002", steps: ["/stats 열기", "합계 카드 확인"] },
    ],
    assumptions: ["거리는 브라우저 위치 권한으로 잰다"],
    openQuestions: [],
  };
}

describe("DevSpec — 정상 픽스처", () => {
  it("스키마·무결성 통과", () => {
    const v = validateDevSpec(validSpec());
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(checkDevSpecIntegrity(v.spec), []);
  });

  it("초보자 4줄 요약은 개수와 제목만 낸다(점수 없음)", () => {
    const v = validateDevSpec(validSpec());
    const s = summarizeForBeginner(v.spec);
    assert.equal(s.screenCount, 2);
    assert.equal(s.entityCount, 1);
    assert.deepEqual(s.excluded, ["훈련 기능", "커뮤니티 피드"]);
    assert.deepEqual(s.mustFeatureTitles, ["산책 기록"]);
    assert.equal(findScoreLikeKeys(s).length, 0);
  });
});

describe("DevSpec — 무결성 위반 픽스처(전부 실패해야 한다)", () => {
  const cases = [
    ["AC가 없는 FR", (s) => { s.acceptance = s.acceptance.filter((a) => a.featureId !== "FR-002"); s.testPlan = s.testPlan.filter((t) => t.acceptanceId !== "AC-002"); s.workBreakdown[1].acceptanceIds = ["AC-001"]; }, "feature_without_ac"],
    ["없는 FR을 가리키는 AC", (s) => { s.acceptance[0].featureId = "FR-099"; }, "ac_unknown_feature"],
    ["화면·API 어디에도 없는 must FR", (s) => { s.screens[0].featureIds = []; s.apis[0].featureIds = []; }, "must_feature_without_surface"],
    ["없는 AC를 가리키는 WBS(고아)", (s) => { s.workBreakdown[0].acceptanceIds = ["AC-077"]; }, "wbs_unknown_acceptance"],
    ["기계 검증 AC인데 테스트 계획 없음", (s) => { s.testPlan = s.testPlan.filter((t) => t.acceptanceId !== "AC-001"); }, "acceptance_without_test_plan"],
    ["중복 id", (s) => { s.features[1].id = "FR-001"; s.acceptance[1].featureId = "FR-001"; }, "duplicate_id"],
    ["WBS 순환 의존", (s) => { s.workBreakdown[0].dependsOn = ["WBS-002"]; }, "wbs_dependency_cycle"],
    ["WBS 자기 의존", (s) => { s.workBreakdown[0].dependsOn = ["WBS-001"]; }, "wbs_self_dependency"],
  ];
  for (const [name, mutate, rule] of cases) {
    it(`${name} → ${rule}`, () => {
      const s = validSpec();
      mutate(s);
      const v = validateDevSpec(s);
      assert.equal(v.ok, false, `${name}: 통과하면 안 된다`);
      assert.equal(v.stage, "integrity", `${name}: 스키마가 아니라 무결성에서 걸려야 한다 — ${JSON.stringify(v.issues)}`);
      assert.ok(v.issues.some((i) => i.rule === rule), `${name}: ${rule} 기대, 실제 ${JSON.stringify(v.issues)}`);
    });
  }
});

describe("DevSpec — 숫자 점수 금지(PRD §5.1)", () => {
  it("모르는 키(score)는 strict 스키마가 거부한다", () => {
    const s = validSpec();
    s.features[0].score = 82;
    const v = validateDevSpec(s);
    assert.equal(v.ok, false);
    assert.equal(v.stage, "schema");
    assert.ok(v.issues.some((i) => /features\.0/.test(i)), JSON.stringify(v.issues));
  });

  it("스캐너는 중첩 어디서든 점수류 키를 찾는다", () => {
    assert.deepEqual(findScoreLikeKeys({ a: { Rating: 1 }, b: [{ grade: "A" }] }), ["$.a.Rating", "$.b[0].grade"]);
    assert.deepEqual(findScoreLikeKeys(validSpec()), []);
  });

  it("human 검증 AC는 테스트 계획 면제", () => {
    const s = validSpec();
    s.acceptance[1].verifiedBy = "human";
    s.testPlan = s.testPlan.filter((t) => t.acceptanceId !== "AC-002");
    assert.equal(validateDevSpec(s).ok, true);
  });

  it("브리프에 모르는 키가 있으면 거부(브리프도 경계)", () => {
    const s = validSpec();
    s.brief.founderScore = 90;
    assert.equal(DevSpecSchema.safeParse(s).success, false);
  });
});

describe("PUT /dev-spec 입구 — parseDevSpecUpsert", () => {
  it("정상 → userKey + JSON", () => {
    const out = parseDevSpecUpsert({ userKey: " u1 ", devSpec: validSpec() });
    assert.equal(out.ok, true);
    assert.equal(out.userKey, "u1");
    assert.ok(out.devSpecJson.includes("FR-001"));
  });

  it("userKey 없음 / 본문 아님", () => {
    assert.equal(parseDevSpecUpsert({ devSpec: validSpec() }).error, "userKey_required");
    assert.equal(parseDevSpecUpsert(null).error, "invalid_body");
  });

  it("무결성 위반은 detail에 stage·issues를 싣는다(생성기가 섹션 재생성에 쓴다)", () => {
    const s = validSpec();
    s.workBreakdown[0].acceptanceIds = ["AC-077"];
    const out = parseDevSpecUpsert({ userKey: "u", devSpec: s });
    assert.equal(out.ok, false);
    assert.equal(out.error, "dev_spec_invalid");
    assert.equal(out.detail.stage, "integrity");
    assert.ok(out.detail.issues.some((i) => i.rule === "wbs_unknown_acceptance"));
  });

  it("512KB 상한", () => {
    assert.equal(DEV_SPEC_JSON_CAP, 524_288);
    const s = validSpec();
    // 200자 상한을 지키며 개수로 불린다(스키마 max 60 안에서 최대치로)
    s.assumptions = Array.from({ length: 40 }, (_, i) => `${i} `.padEnd(1990, "가"));
    s.openQuestions = Array.from({ length: 40 }, (_, i) => `${i} `.padEnd(1990, "나"));
    const out = parseDevSpecUpsert({ userKey: "u", devSpec: s });
    // 이 픽스처는 ~330KB — 상한 아래여야 정상 저장(상한 자체는 상수 테스트로 고정)
    assert.equal(out.ok, true);
  });
});

// v2 S3 (2026-10-21, `train v2-S3 start approved.`) — 가설·계획 생성(결정론), 계획은 증거물로 저장.
// 설계 §2.2-2·3 · 완료 증거(§5 S3) "계획 스냅샷 테스트". 정적 사실 입력은 S2가 실제 벤치 #1 앱에서 뽑은 것(docs/v2/s1-s2-2026-10-21.md 표).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const P = await import("../dist/v2-plan.js");
const E = await import("../dist/evidence-chain.js");

// 벤치 #1 사전 등록 조건(tools/simsa-inspection-fixtures/agent-bench1-local.mjs BENCH1_PREREG_ACS — 실행 전 고정본 복사).
const ACS = [
  { id: "A1", title: "10:00~19:00, 30분 단위로 시간 선택", given: "예약 화면에서 날짜를 골랐다", when: "시간 목록을 본다", then: "오전 10시부터 오후 7시까지 30분 단위 시간을 고를 수 있다", priority: "must" },
  { id: "A2", title: "이름·휴대폰 번호 없이는 예약되지 않는다", given: "날짜와 시간을 골랐다", when: "이름이나 휴대폰 번호를 비우거나 형식에 맞지 않게 넣고 예약한다", then: "예약되지 않고 무엇이 잘못됐는지 알려 준다", priority: "must" },
  { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", given: "어떤 날짜·시간에 예약이 하나 있다", when: "다른 손님(새 브라우저)이 같은 날짜·시간을 고르려 한다", then: "그 시간은 고를 수 없다(이중 예약이 되지 않는다)", priority: "must" },
  { id: "A4", title: "예약하면 완료 화면에 예약 내용이 보인다", given: "날짜·시간·이름·휴대폰 번호를 넣었다", when: "예약한다", then: "완료 화면에 날짜·시간·이름이 보인다", priority: "must" },
  { id: "A5", title: "새로고침해도 예약이 남는다", given: "예약을 마쳤다", when: "새로고침하거나 새 브라우저로 다시 연다", then: "예약이 사라지지 않고 남아 있다(다른 방문자에게도 그 시간은 마감으로 보인다)", priority: "must" },
  { id: "A6", title: "관리 화면에 오늘 예약이 시간순으로 보인다", given: "오늘 날짜에 예약이 1건 이상 있다", when: "사장님이 관리 화면을 연다", then: "오늘 예약 목록이 시간순으로 보인다", priority: "must" },
  { id: "A7", title: "취소하면 그 시간을 다시 예약할 수 있다", given: "관리 화면에 예약이 1건 보인다", when: "그 예약을 취소한다", then: "목록에서 사라지고 손님이 그 시간을 다시 고를 수 있다", priority: "must" },
  { id: "A8", title: "가격이 원 단위로 보인다", given: "첫 화면 또는 예약 화면", when: "가격을 본다", then: "커트 15,000원처럼 원 단위 형식으로 보인다", priority: "should" },
  { id: "A9", title: "휴대폰 폭(390px)에서 쓸 수 있다", given: "휴대폰 폭 화면", when: "예약 흐름을 밟는다", then: "글자·버튼이 잘리지 않고 예약까지 할 수 있다", priority: "should" },
  { id: "A10", title: "모든 글이 한국어다", given: "앱의 모든 화면", when: "글을 읽는다", then: "영어 등 다른 언어 문구가 없다", priority: "should" },
].map((a) => ({ ...a, confirmed: true }));

// S2 실측(KST 2026-10-21 02시대) 정적 사실 + 정답지 must 실패.
const APPS = {
  chatgpt: { classes: ["missing_backend_config"], mustFailed: ["A3", "A4", "A5", "A6", "A7"] },
  gemini: { classes: ["client_only_storage", "timezone_date"], mustFailed: ["A3", "A6"] },
  v0: { classes: ["server_rendered_dates"], mustFailed: ["A6", "A7"] },
  bolt: { classes: ["timezone_date"], mustFailed: ["A6", "A7"] },
  claude: { classes: ["client_only_storage"], mustFailed: ["A3", "A6"] },
  lovable: { classes: [], mustFailed: [] },
};
const RULE_OF = { missing_backend_config: "R1", client_only_storage: "R2", timezone_date: "R3", needs_api_key: "R4", server_rendered_dates: "R5" };

function factsFor(classes) {
  const store = E.createEvidenceStore();
  const recorded = classes.map((cls) => {
    const fact = { rule: RULE_OF[cls], cls, file: "/app.js", excerpt: `근거 ${cls}` };
    return { fact, artifactId: store.add("source", `${fact.rule} ${cls}`, fact.excerpt, { url: "/app.js" }) };
  });
  return { store, recorded };
}

describe("가설이 정답지의 must 실패를 덮는다 (벤치 #1 6앱 — 실제 정적 사실 입력)", () => {
  for (const [app, { classes, mustFailed }] of Object.entries(APPS)) {
    it(`${app}: must 실패 ${mustFailed.join(",") || "없음"} 전부 가설에 덮인다${mustFailed.length ? "" : " · 가설 0(정상 앱 헛짚음 없음)"}`, () => {
      const { recorded } = factsFor(classes);
      const plan = P.buildPlan({ acs: ACS, facts: recorded, nowKstHour: 14 });
      const covered = new Set(plan.hypotheses.flatMap((h) => h.coversAcIds));
      for (const id of mustFailed) assert.ok(covered.has(id), `${app} ${id} 덮임: ${[...covered].join(",")}`);
      if (!classes.length) assert.equal(plan.hypotheses.length, 0);
    });
  }
  it("합계: 13/13 셀이 가설로 덮인다(v1 엔진 0/13)", () => {
    let hit = 0;
    let total = 0;
    for (const { classes, mustFailed } of Object.values(APPS)) {
      const covered = new Set(P.buildPlan({ acs: ACS, facts: factsFor(classes).recorded, nowKstHour: 14 }).hypotheses.flatMap((h) => h.coversAcIds));
      total += mustFailed.length;
      hit += mustFailed.filter((id) => covered.has(id)).length;
    }
    assert.equal(`${hit}/${total}`, "13/13");
  });
});

describe("계획 스냅샷 (설계 §5 S3 완료 증거)", () => {
  it("gemini: 가설 2개·근거 증거물 id·덮는 기준·확인 실험·기준별 경로가 이 모양 그대로", () => {
    const { recorded } = factsFor(["client_only_storage", "timezone_date"]);
    const plan = P.buildPlan({ acs: ACS, facts: recorded, nowKstHour: 14 });
    assert.deepEqual(
      plan.hypotheses.map((h) => ({ id: h.id, cls: h.cls, basis: h.basisArtifactIds, covers: h.coversAcIds, experiment: h.experiment.kind, runnableNow: h.runnableNow })),
      [
        { id: "H1", cls: "client_only_storage", basis: ["E1"], covers: ["A3", "A5", "A6", "A7"], experiment: "fresh_browser_lookup", runnableNow: true },
        { id: "H2", cls: "timezone_date", basis: ["E2"], covers: ["A1", "A6", "A7"], experiment: "clock_early_morning_kst", runnableNow: true },
      ],
    );
    assert.equal(plan.version, "v2-plan-1");
    assert.deepEqual(plan.acPlans.filter((p) => p.priority === "must").map((p) => [p.acId, p.hypothesisIds]), [
      ["A1", ["H2"]], ["A2", []], ["A3", ["H1"]], ["A4", []], ["A5", ["H1"]], ["A6", ["H1", "H2"]], ["A7", ["H1", "H2"]],
    ]);
    // 가설마다 "무엇을 하면 무엇이 보여야 참/거짓인가"(설계 §2.2-2).
    for (const h of plan.hypotheses) {
      assert.ok(h.experiment.steps.length >= 1);
      assert.ok(h.experiment.confirmsIf && h.experiment.refutesIf, h.id);
    }
  });
  it("같은 입력이면 같은 계획(결정론) — 재검사가 같은 계획을 다시 쓴다", () => {
    const a = P.buildPlan({ acs: ACS, facts: factsFor(["missing_backend_config"]).recorded, nowKstHour: 14 });
    const b = P.buildPlan({ acs: ACS, facts: factsFor(["missing_backend_config"]).recorded, nowKstHour: 14 });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
  it("계획은 증거물(kind context)로 저장되고 그대로 되읽힌다", () => {
    const { store, recorded } = factsFor(["timezone_date"]);
    const plan = P.buildPlan({ acs: ACS, facts: recorded, nowKstHour: 14 });
    const id = P.recordPlan(store, plan);
    assert.equal(store.get(id).kind, "context");
    assert.deepEqual(P.parseRecordedPlan(store.get(id).raw), plan);
    assert.equal(P.parseRecordedPlan("{broken"), null);
  });
});

describe("시간 조건 — 기기 시계로 서버를 속일 수 없다", () => {
  it("서버 렌더 날짜(R5) 가설은 실제 KST 00~09시에만 실행 가능 — 낮엔 runnableNow=false와 그 이유", () => {
    const day = P.buildPlan({ acs: ACS, facts: factsFor(["server_rendered_dates"]).recorded, nowKstHour: 14 });
    assert.equal(day.hypotheses[0].experiment.kind, "real_time_window_kst");
    assert.deepEqual(day.hypotheses[0].experiment.windowKst, [0, 9]);
    assert.equal(day.hypotheses[0].runnableNow, false);
    const night = P.buildPlan({ acs: ACS, facts: factsFor(["server_rendered_dates"]).recorded, nowKstHour: 2 });
    assert.equal(night.hypotheses[0].runnableNow, true);
  });
  it("클라이언트 UTC 날짜(R3)는 실행기 시계 변형으로 언제든 확인 가능", () => {
    const plan = P.buildPlan({ acs: ACS, facts: factsFor(["timezone_date"]).recorded, nowKstHour: 14 });
    assert.equal(plan.hypotheses[0].runnableNow, true);
  });
});

describe("경계", () => {
  it("백엔드 미설정(R1)은 기록을 만드는 기준(A3~A7)을 덮고 시간 목록(A1)·형식 확인(A2)은 덮지 않는다", () => {
    const plan = P.buildPlan({ acs: ACS, facts: factsFor(["missing_backend_config"]).recorded, nowKstHour: 14 });
    assert.deepEqual(plan.hypotheses[0].coversAcIds, ["A3", "A4", "A5", "A6", "A7"]);
  });
  it("사용자 API 키(R4)는 must 기준 전부를 덮고 사람 확인으로 표시한다", () => {
    const plan = P.buildPlan({ acs: ACS, facts: factsFor(["needs_api_key"]).recorded, nowKstHour: 14 });
    assert.deepEqual(plan.hypotheses[0].coversAcIds, ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    assert.equal(plan.hypotheses[0].experiment.kind, "human_key_required");
  });
  it("알 수 없는 사실 분류는 가설을 만들지 않는다(지어내지 않는다)", () => {
    const plan = P.buildPlan({ acs: ACS, facts: [{ fact: { rule: "R9", cls: "unknown_thing", file: "/", excerpt: "x" }, artifactId: "E1" }], nowKstHour: 14 });
    assert.equal(plan.hypotheses.length, 0);
  });
  it("증거물 id가 없는 사실(저장 상한 초과)은 근거가 없으므로 가설을 만들지 않는다", () => {
    const plan = P.buildPlan({ acs: ACS, facts: [{ fact: { rule: "R2", cls: "client_only_storage", file: "/", excerpt: "x" }, artifactId: null }], nowKstHour: 14 });
    assert.equal(plan.hypotheses.length, 0);
  });
});

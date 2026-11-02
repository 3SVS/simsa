// train L2 (2026-10-27) — 라벨링 에이전트(설계 §0.0): 라벨러 패스 → 라벨 행 · 두 패스 일치도(§6) · 사전 등록 정답지 채점.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const LB = await import("../dist/dataset/labeler.js");
const AG = await import("../dist/dataset/agreement.js");
const GD = await import("../dist/dataset/gold.js");
const L = await import("../dist/dataset/labels.js");
const R = await import("../dist/v2-report.js");

const ACS = [
  { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", then: "그 시간은 고를 수 없다", priority: "must" },
  { id: "A4", title: "예약하면 완료 화면에 예약 내용이 보인다", then: "완료 화면에 날짜·시간·이름이 보인다", priority: "must" },
  { id: "A6", title: "관리 화면에 오늘 예약이 보인다", then: "오늘 예약 목록", priority: "must" },
  { id: "A9", title: "카카오로 로그인한 손님만 리뷰를 쓸 수 있다", then: "리뷰가 저장된다", priority: "should" },
];
/** 라벨러 모드 실행 결과(실행기 출력 모양). */
function runnerResult(over = {}) {
  return {
    engine: "agent_v2", runnerRev: "agent-v2-1", profile: "labeler", targetUrl: "https://salon.example/", decision: "Needs Fix",
    intentMismatch: [], defectGroups: [], fix: { attempted: false, reason: "labeler_profile" },
    actions: { A3: ['"이름"에 "심사테스트" 입력', '"예약하기" 누르기', "새 브라우저(다른 손님)"], A4: ['"예약하기" 누르기'] },
    entry: { broken: null }, facts: [], plan: { hypotheses: [], acPlans: [] },
    verdicts: [
      { acId: "A3", verdict: "fail", confirmed: true, repro: { k: 3, n: 3 }, reasons: [], claim: "다른 손님에게 10:30이 여전히 열려 있다", quotes: ["10:30 예약 가능"], artifactIds: ["E9"] },
      { acId: "A4", verdict: "pass", confirmed: true, reasons: [], claim: "완료 화면이 보인다", quotes: ["예약이 완료되었어요"], artifactIds: ["E5"] },
      { acId: "A6", verdict: "not_verified", reasons: ["not_reached"], claim: "정해진 단계 안에 판정까지 가지 못했어요", quotes: [], artifactIds: [] },
      { acId: "A9", verdict: "not_verified", reasons: [], claim: "카카오 로그인이 필요해 확인할 수 없어요", quotes: [], artifactIds: [] },
    ],
    artifacts: {
      artifacts: [
        { id: "E5", kind: "screen", summary: "same /done: 예약이 완료되었어요", raw: "예약이 완료되었어요", meta: {} },
        { id: "E9", kind: "screen", summary: "fresh /book: 10:30 예약 가능", raw: "10:30 예약 가능", meta: {} },
      ],
    },
    ...over,
  };
}
const ctxOf = (runId, appId = "app_salon") => ({ runId, appId, createdAt: "2026-10-27T01:00:00.000Z", acs: ACS });
const reportOf = (r) => R.buildV2Report(r, { targetUrl: "https://salon.example/", intent: "미용실 예약", acs: ACS, acSource: "dev_spec" }).report;
const PASS_A = { passId: "A", vendor: "openai", model: "gpt-5.6-sol" };
const PASS_B = { passId: "B", vendor: "anthropic", model: "claude-opus-5-5" };

describe("라벨러 패스 → 라벨 행", () => {
  it("출처 labeler_agent · 패스·모델 표지 · 행 id에 패스 · 스키마 통과", () => {
    const { acLabels, failureEvents } = LB.labelerRowsFromV2Report(reportOf(runnerResult()), ctxOf("vc_a"), PASS_A);
    assert.equal(acLabels.length, 4);
    for (const l of acLabels) {
      assert.equal(l.source, "labeler_agent");
      assert.equal(l.producer, "labeler-v1:A");
      assert.equal(l.model, "gpt-5.6-sol");
      assert.match(l.labelId, /^vc_a:A\d:A$/);
      assert.equal(l.machineReasons, undefined, "기계 전용 사유는 라벨러 행에 없다");
      assert.ok(L.AcLabel.safeParse(l).success, JSON.stringify(L.AcLabel.safeParse(l).error?.issues));
    }
    assert.equal(failureEvents.length, 1);
    const e = failureEvents[0];
    assert.equal(e.failureId, "vc_a:A3:A:F1");
    assert.equal(e.labelId, "vc_a:A3:A");
    assert.ok(L.FailureEvent.safeParse(e).success, JSON.stringify(L.FailureEvent.safeParse(e).error?.issues));
  });

  it("재현성 R: 3/3 → always + 확신 sure, 1/3 → sometimes + mostly · 확인 못 한 기준은 H2 사유 필수(시간 → labeler_limit, 카카오 → sms_or_oauth)", () => {
    const a = LB.labelerRowsFromV2Report(reportOf(runnerResult()), ctxOf("vc_a"), PASS_A);
    assert.equal(a.failureEvents[0].r, "always");
    assert.deepEqual(a.failureEvents[0].reproduced, { k: 3, n: 3 });
    assert.equal(a.acLabels.find((l) => l.acId === "A3").h3, "sure");
    assert.equal(a.acLabels.find((l) => l.acId === "A6").h2, "labeler_limit");
    assert.equal(a.acLabels.find((l) => l.acId === "A9").h2, "sms_or_oauth");

    const r = runnerResult();
    r.verdicts[0] = { ...r.verdicts[0], repro: { k: 1, n: 3 } };
    const b = LB.labelerRowsFromV2Report(reportOf(r), ctxOf("vc_b"), PASS_B);
    assert.equal(b.failureEvents[0].r, "sometimes");
    assert.equal(b.acLabels.find((l) => l.acId === "A3").h3, "mostly");
  });

  it("검수 엔진 리포트(profile 없음)는 라벨러 라벨로 바꾸지 않는다 — 엔진 결과를 라벨러 출처로 적는 사고 방지", () => {
    const { profile: _p, ...engine } = runnerResult();
    const out = LB.labelerRowsFromV2Report(reportOf(engine), ctxOf("vc_e"), PASS_A);
    assert.deepEqual(out, { acLabels: [], failureEvents: [] });
  });

  it("reproClass: 횟수가 모자라면 단정하지 않는다(2/2 → null)", () => {
    assert.equal(LB.reproClass({ k: 2, n: 2 }), null);
    assert.equal(LB.reproClass({ k: 3, n: 3 }), "always");
    assert.equal(LB.reproClass({ k: 2, n: 3 }), "sometimes");
    assert.equal(LB.reproClass(undefined), null);
  });
});

describe("실패 사건 칸을 라벨러 모델이 다시 고르기", () => {
  it("프롬프트는 블라인드 — 기계 판정·원인 분류 문구가 없고 자기 증거·재현 횟수만", () => {
    const { system, user } = LB.labelerEventPrompt({ ac: ACS[0], claim: "다른 손님에게 열려 있다", quotes: ["10:30 예약 가능"], actions: ["새 브라우저(다른 손님)"], evidence: ["screen fresh /book"], repro: { k: 3, n: 3 } });
    assert.match(user, /failed 3 of 3 times/);
    assert.doesNotMatch(system + user, /machine|engine verdict|Needs Fix/i);
  });

  it("어휘 밖 칸만 버리고 나머지는 쓴다 · 깨진 답은 빈 선택", () => {
    assert.deepEqual(LB.parseLabelerEventChoice('{"w1":"share","y":"teleported","s":"S2","p":true}'), { w1: "share", s: "S2", p: true });
    assert.deepEqual(LB.parseLabelerEventChoice("not json"), {});
  });

  it("모델 선택으로 칸을 바꾸되, 근거 없는 원인(C)은 unknown 유지 · 호출 실패면 규칙 값 그대로", async () => {
    const rep = reportOf(runnerResult());
    const { failureEvents } = LB.labelerRowsFromV2Report(rep, ctxOf("vc_a"), PASS_A);
    const refined = await LB.refineEventsWithLabeler(failureEvents, rep, ACS, async () => '{"w1":"share","y":"not_visible_to_others","c":"backend_missing","s":"S2","a":"builder","p":false,"memo":"다른 손님에게 보이지 않음"}');
    assert.equal(refined.calls, 1);
    assert.equal(refined.events[0].s, "S2");
    assert.equal(refined.events[0].c, "unknown", "콘솔·네트워크·설정 근거가 없으면 원인 층을 대지 않는다");
    assert.equal(refined.events[0].memo, "다른 손님에게 보이지 않음");
    assert.ok(L.FailureEvent.safeParse(refined.events[0]).success);

    const broken = await LB.refineEventsWithLabeler(failureEvents, rep, ACS, async () => {
      throw new Error("llm 429");
    });
    assert.equal(broken.failed, 1);
    assert.deepEqual(broken.events, failureEvents);
  });
});

describe("두 패스 일치도(§6) · 합치기", () => {
  const rowsA = LB.labelerRowsFromV2Report(reportOf(runnerResult()), ctxOf("vc_a"), PASS_A);
  const passOf = (pass, rows) => ({ passId: pass.passId, vendor: pass.vendor, ...rows });

  it("완전히 같은 두 패스(다른 벤더) → H1 κ 1, 다툼 0, 합의 4", () => {
    const rowsB = LB.labelerRowsFromV2Report(reportOf(runnerResult()), ctxOf("vc_b"), PASS_B);
    const r = AG.comparePasses(passOf(PASS_A, rowsA), passOf(PASS_B, rowsB));
    assert.equal(r.sameVendor, false);
    assert.equal(r.pairedAcs, 4, "앱 × 기준으로 짝 짓는다(런 id가 달라도)");
    assert.equal(r.h1.kappa, 1);
    assert.equal(r.disputes.length, 0);
    assert.equal(r.consensus.length, 4);
    assert.equal(r.w1.rate, 1);
  });

  it("판정이 갈린 기준은 다툼(next ask_user) · 합의에서 빠진다", () => {
    const r2 = runnerResult();
    r2.verdicts[1] = { ...r2.verdicts[1], verdict: "fail", repro: { k: 3, n: 3 }, claim: "완료 화면에 시간이 없다" };
    const rowsB = LB.labelerRowsFromV2Report(reportOf(r2), ctxOf("vc_b"), PASS_B);
    const r = AG.comparePasses(passOf(PASS_A, rowsA), passOf(PASS_B, rowsB));
    const d = r.disputes.find((x) => x.acId === "A4");
    assert.equal(d.field, "h1");
    assert.equal(d.next, "ask_user");
    assert.deepEqual(d.values, { A: "pass", B: "fail" });
    assert.ok(!r.consensus.some((c) => c.acId === "A4"));
    assert.ok(r.h1.kappa < 1);
  });

  it("같은 벤더 두 패스는 이중 라벨이 아니다 — 목표 충족 전부 false", () => {
    const rowsB = LB.labelerRowsFromV2Report(reportOf(runnerResult()), ctxOf("vc_b"), { ...PASS_B, vendor: "OpenAI" });
    const r = AG.comparePasses(passOf(PASS_A, rowsA), passOf({ ...PASS_B, vendor: "OpenAI" }, rowsB));
    assert.equal(r.sameVendor, true);
    assert.deepEqual(Object.values(r.meetsTargets), [false, false, false, false, false]);
  });

  it("Cohen κ 손계산 대조: 10쌍, 일치 8 · 기대 0.5 → 0.6 / 가중 κ: 한 칸 어긋남이 세 칸 어긋남보다 높다", () => {
    const a = ["pass", "pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail"];
    const b = ["pass", "pass", "pass", "pass", "fail", "fail", "fail", "fail", "fail", "pass"];
    const k = AG.cohenKappa(a, b);
    assert.equal(k.po, 0.8);
    assert.ok(Math.abs(k.kappa - 0.6) < 1e-9);
    const near = AG.weightedKappa(["S1", "S2", "S3", "S1"], ["S2", "S2", "S3", "S1"], L.S_SEVERITY);
    const far = AG.weightedKappa(["S1", "S2", "S3", "S1"], ["S4", "S2", "S3", "S1"], L.S_SEVERITY);
    assert.ok(near.kappa > far.kappa);
    assert.equal(AG.cohenKappa([], []).kappa, null);
  });
});

describe("사전 등록 정답지 채점(§0.0 · §6 자격)", () => {
  const lab = (h1, h2 = null) => ({ h1, h2 });
  const gold = (appKey, h1, extra = {}) => ({ appKey, acId: "CORE-1", h1, source: "test", ...extra });

  it("허용 답 여러 개 · cannot_verify 사유까지 맞아야 정답 · 거짓 통과는 자격 박탈", () => {
    const items = [
      { gold: gold("F1", ["pass"]), label: lab("pass"), events: [] },
      { gold: gold("F3", ["fail"], { s: "S1" }), label: lab("fail"), events: [{ acId: "CORE-1", s: "S1" }] },
      { gold: gold("F13", ["fail", "cannot_verify"], { h2: ["needs_own_api_key"] }), label: lab("cannot_verify", "needs_own_api_key"), events: [] },
      { gold: gold("F13b", ["fail", "cannot_verify"], { h2: ["needs_own_api_key"] }), label: lab("cannot_verify", "labeler_limit"), events: [] },
    ];
    const s = GD.scoreAgainstGold(items);
    assert.equal(s.n, 4);
    assert.equal(s.h1Correct, 3);
    assert.equal(s.h1Rate, 0.75);
    assert.equal(s.sRate, 1);
    assert.equal(s.gate.pass, false, "H1 75% < 90%");
    assert.equal(s.misses[0].appKey, "F13b");

    const ok = GD.scoreAgainstGold(items.slice(0, 3));
    assert.equal(ok.gate.pass, true);
    const withFalsePass = GD.scoreAgainstGold([...Array(10)].map(() => items[0]).concat([{ gold: gold("F4", ["fail"]), label: lab("pass"), events: [] }]));
    assert.ok(withFalsePass.h1Rate >= 0.9);
    assert.equal(withFalsePass.falsePass, 1);
    assert.equal(withFalsePass.gate.pass, false, "거짓 통과가 하나라도 있으면 자격 없음");
  });

  it("라벨을 못 단 기준(null)은 오답", () => {
    const s = GD.scoreAgainstGold([{ gold: gold("F5", ["fail"]), label: null, events: [] }]);
    assert.equal(s.h1Correct, 0);
    assert.equal(s.misses[0].got, "none");
  });
});

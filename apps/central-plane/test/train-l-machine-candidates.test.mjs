// train L2 (2026-10-24) — v2 검수 리포트 → 라벨링 설계 v1의 **기계 후보** 라벨(§7): 기준 판정(H) + 실패 사건(F).
// 정답이 아니라 후보다(source "machine") — 사람·라벨링 에이전트 라벨을 덮어쓰지 않고 나란히 둔다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const M = await import("../dist/dataset/machine-candidates.js");
const L = await import("../dist/dataset/labels.js");

const ACS = [
  { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", then: "그 시간은 고를 수 없다", priority: "must" },
  { id: "A4", title: "예약하면 완료 화면에 예약 내용이 보인다", then: "완료 화면에 날짜·시간·이름이 보인다", priority: "must" },
  { id: "A6", title: "관리 화면에 오늘 예약이 시간순으로 보인다", then: "오늘 예약 목록", priority: "must" },
  { id: "A8", title: "가격이 원 단위로 보인다", then: "커트 15,000원", priority: "should" },
];
function report(over = {}) {
  return {
    engine: "agent", engineVersion: "v2", target: "https://salon.example/",
    acTable: [
      { id: "A3", priority: "must", status: "fail", actions: ['"이름"에 "심사테스트" 입력', '"예약하기" 누르기', "새 브라우저(다른 손님)"] },
      { id: "A4", priority: "must", status: "pass", actions: ['"예약하기" 누르기'] },
      { id: "A6", priority: "must", status: "not_verified", actions: [] },
      { id: "A8", priority: "should", status: "fail", actions: ['"가격" 보기'] },
    ],
    agent: { builder: "gemini" },
    v2: {
      runnerRev: "agent-v2-1",
      entry: null,
      intentMismatch: [],
      defectGroups: [{ key: "H1:client_only_storage", cls: "client_only_storage", hypothesisId: "H1", acIds: ["A3"], rootAcId: "A3" }],
      verdicts: [
        { acId: "A3", verdict: "fail", confirmed: true, reasons: [], claim: "다른 손님에게 10:30이 여전히 열려 있다", quotes: ["10:30 예약 가능"],
          evidence: [{ id: "E9", kind: "screen", summary: "fresh /book: 10:30 예약 가능", excerpt: "10:30 예약 가능" }],
          cause: { cls: "client_only_storage", basis: "static_fact", location: { file: "/app.js", line: null }, source: ["localStorage.setItem('b')"], seen: [] } },
        { acId: "A4", verdict: "pass", confirmed: true, reasons: [], claim: "완료 화면이 보인다", quotes: ["예약이 완료되었어요"],
          evidence: [{ id: "E7", kind: "storage", summary: "after 예약: 브라우저 저장소 바뀜", excerpt: "local=true" }, { id: "E5", kind: "screen", summary: "same /done: 예약이 완료되었어요", excerpt: "예약이 완료되었어요" }] },
        { acId: "A6", verdict: "not_verified", confirmed: false, reasons: ["not_reached"], claim: "정해진 단계 안에 판정까지 가지 못했어요", quotes: [], evidence: [] },
        { acId: "A8", verdict: "fail", confirmed: true, reasons: [], claim: "가격이 15000으로 표시된다", quotes: ["15000"],
          evidence: [{ id: "E20", kind: "screen", summary: "same /: 커트 15000", excerpt: "커트 15000" }],
          cause: { cls: "other", basis: "claim_text", location: null, source: [], seen: [] } },
      ],
      fix: { attempted: true, reason: "cannot_fix_in_single_file", validated: [], stillFailing: [], cannotFix: ["A3: 서버 필요"], assumptions: [] },
    },
    ...over,
  };
}
const ctx = { runId: "vc_1", appId: "app_h1", createdAt: "2026-10-24T01:00:00.000Z", acs: ACS };

describe("기계 후보 — 기준 판정(H)", () => {
  it("v2 판정 → H1(pass·fail·cannot_verify), 증거 인용, 행동, 기계 사유는 machineReasons로(대응표 밖)", () => {
    const out = M.machineCandidatesFromV2Report(report(), ctx);
    const h = Object.fromEntries(out.acLabels.map((x) => [x.acId, x]));
    assert.equal(h.A3.h1, "fail");
    assert.equal(h.A4.h1, "pass");
    assert.equal(h.A6.h1, "cannot_verify");
    assert.equal(h.A6.h2, null, "기계 전용 사유(not_reached)는 사람 H2 어휘로 옮기지 않는다(§7)");
    assert.deepEqual(h.A6.machineReasons, ["not_reached"]);
    assert.equal(h.A4.h5[0].artifactId, "E7");
    assert.deepEqual(h.A3.h6, ['"이름"에 "심사테스트" 입력', '"예약하기" 누르기', "새 브라우저(다른 손님)"]);
    assert.equal(h.A3.source, "machine");
    assert.equal(h.A3.producer, "agent-v2-1");
    assert.equal(h.A3.h3, "mostly", "기계 확정(재실행 확인)도 사람 기준 '확실'은 아니다");
    for (const x of out.acLabels) assert.ok(L.AcLabel.safeParse(x).success, JSON.stringify(L.AcLabel.safeParse(x).error?.issues));
  });
  it("첫 화면 즉시 고장 → 모든 기준 cannot_verify/app_down + 실패 사건 1개(entry, S1)", () => {
    const out = M.machineCandidatesFromV2Report(report({ acTable: ACS.map((a) => ({ id: a.id, priority: a.priority, status: "not_verified" })), v2: { runnerRev: "agent-v2-1", entry: { cause: "missing_index_file", status: 404 }, verdicts: [], defectGroups: [], intentMismatch: [], fix: null } }), ctx);
    assert.ok(out.acLabels.every((x) => x.h1 === "cannot_verify" && x.h2 === "app_down"));
    assert.equal(out.failureEvents.length, 1);
    assert.equal(out.failureEvents[0].w1, "entry");
    assert.equal(out.failureEvents[0].y, "blank_screen");
    assert.equal(out.failureEvents[0].k, "route_404_missing_index");
    assert.equal(out.failureEvents[0].c, "routing_deploy");
    assert.equal(out.failureEvents[0].s, "S1");
  });
});

describe("기계 후보 — 실패 사건(F)", () => {
  it("다른 손님 실패: W1 share · W3 new_browser · Y not_visible_to_others · C browser_only_storage(정적 사실 근거) · S2 · 재현 2/2 · 위치 · 묶음", () => {
    const f = M.machineCandidatesFromV2Report(report(), ctx).failureEvents.find((x) => x.acId === "A3");
    assert.equal(f.w1, "share");
    assert.equal(f.w2, "/book");
    assert.equal(f.w3, "new_browser");
    assert.equal(f.y, "not_visible_to_others");
    assert.equal(f.c, "browser_only_storage");
    assert.equal(f.k, "client_only_storage");
    assert.equal(f.s, "S2");
    assert.equal(f.r, null, "기계는 3회 재현을 하지 않는다 — 값을 단정하지 않는다");
    assert.deepEqual(f.reproduced, { k: 2, n: 2 });
    assert.equal(f.a, "builder");
    assert.deepEqual(f.location, { file: "/app.js", line: null });
    assert.equal(f.defectGroup, "H1:client_only_storage");
    assert.equal(f.x, "structural", "한 파일로 못 고침 → 구조적");
    assert.ok(L.FailureEvent.safeParse(f).success, JSON.stringify(L.FailureEvent.safeParse(f).error?.issues));
  });
  it("관찰 근거 없이 판정 문장으로만 정한 원인은 C=unknown(§3 'C는 관찰 근거가 있을 때만') · should는 S3", () => {
    const f = M.machineCandidatesFromV2Report(report(), ctx).failureEvents.find((x) => x.acId === "A8");
    assert.equal(f.c, "unknown");
    assert.equal(f.s, "S3");
  });
  it("재실행 확인이 안 된 실패는 실패 사건을 만들지 않는다(기계 후보도 증거 사슬 기준)", () => {
    const r = report();
    r.v2.verdicts[0].confirmed = false;
    assert.equal(M.machineCandidatesFromV2Report(r, ctx).failureEvents.some((x) => x.acId === "A3"), false);
  });
  it("포템킨(P): 완료처럼 보이는데 저장·공유 안 됨이면 true", () => {
    const r = report();
    r.v2.verdicts[0].claim = "예약 완료 화면은 나오지만 다른 손님에게 10:30이 열려 있다";
    assert.equal(M.machineCandidatesFromV2Report(r, ctx).failureEvents.find((x) => x.acId === "A3").p, true);
    assert.equal(M.machineCandidatesFromV2Report(report(), ctx).failureEvents.find((x) => x.acId === "A8").p, false);
  });
  it("v2가 아닌 리포트(v1)는 후보를 만들지 않는다(근거 사슬이 없다)", () => {
    const out = M.machineCandidatesFromV2Report({ engine: "agent", acTable: [] }, ctx);
    assert.deepEqual(out, { acLabels: [], failureEvents: [] });
  });
});

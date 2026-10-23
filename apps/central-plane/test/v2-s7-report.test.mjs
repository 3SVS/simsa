// v2 S7b (2026-10-23) — v2 결과 → 기존 agent 리포트 모양(대시보드가 그대로 그린다) + v2 전용 블록(원인·묶음·고침·증거 사슬).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const R = await import("../dist/v2-report.js");

const ACS = [
  { id: "A1", title: "예약 완료", then: "완료 화면", priority: "must", confirmed: true },
  { id: "A2", title: "다른 손님", then: "그 시간은 막힌다", priority: "must", confirmed: true },
  { id: "A3", title: "가격 표시", then: "원 단위", priority: "should", confirmed: true },
];
const ART = [
  { id: "E5", kind: "screen", summary: "same /done: 예약이 완료되었어요", raw: "예약이 완료되었어요".repeat(50), meta: { session: "same" } },
  { id: "E7", kind: "storage", summary: "after 예약: 브라우저 저장소 바뀜", raw: "local=true", meta: { changed: true } },
  { id: "E9", kind: "screen", summary: "fresh /: 10:30 예약 가능", raw: "10:30 예약 가능", meta: { session: "fresh" } },
  { id: "E2", kind: "source", summary: "R2 client_only_storage — /app.js", raw: "localStorage.setItem('b')", meta: {} },
];
function v2Result(over = {}) {
  return {
    engine: "agent_v2", runnerRev: "agent-v2-1", decision: "Needs Fix", intentMismatch: [],
    entry: { broken: null },
    verdicts: [
      { acId: "A1", verdict: "pass", claim: "예약하면 완료 화면이 보인다", artifactIds: ["E7", "E5"], quotes: ["예약이 완료되었어요"], reasons: [], confirmed: true },
      { acId: "A2", verdict: "fail", claim: "다른 손님에게 10:30이 열려 있다", artifactIds: ["E9"], reproArtifactIds: ["E9"], quotes: ["10:30 예약 가능"], reasons: [], confirmed: true,
        cause: { cls: "client_only_storage", basis: "static_fact", evidenceIds: [], sourceIds: ["E2"], location: { file: "/app.js", line: null } } },
      { acId: "A3", verdict: "not_verified", claim: "정해진 단계 안에 판정까지 가지 못했어요", artifactIds: [], quotes: [], reasons: ["not_reached"] },
    ],
    defectGroups: [{ key: "H1:client_only_storage", cls: "client_only_storage", hypothesisId: "H1", acIds: ["A2"], rootAcId: "A2" }],
    fix: { attempted: true, reason: "cannot_fix_in_single_file", validated: [], stillFailing: [], cannotFix: ["A2: 서버가 필요합니다"], assumptions: ["이 브라우저에만 저장"] },
    actions: { A1: ['"이름"에 "심사테스트" 입력', '"예약하기" 누르기'], A2: ["새 브라우저"] },
    artifacts: { artifacts: ART, truncated: false },
    ...over,
  };
}

describe("v2 → agent 리포트", () => {
  it("판정이 기준 표로 옮겨지고(pass는 상태 변화+재실행 확인으로 exercised), 결정은 기존 규칙과 같다", () => {
    const out = R.buildV2Report(v2Result(), { targetUrl: "https://s.example/", intent: "미용실", acs: ACS, acSource: "interview" }, "ko");
    const rows = Object.fromEntries(out.report.acTable.map((r) => [r.id, r]));
    assert.equal(rows.A1.status, "pass");
    assert.deepEqual(rows.A1.exercised, { stateChange: true, verified: true });
    assert.deepEqual(rows.A1.actions, ['"이름"에 "심사테스트" 입력', '"예약하기" 누르기']);
    assert.equal(rows.A2.status, "fail");
    assert.equal(rows.A3.status, "not_verified");
    assert.equal(out.decision, "Needs Fix");
    assert.equal(out.works, false);
    assert.equal(out.report.engine, "agent", "대시보드가 agent 리포트로 그린다");
    assert.equal(out.report.engineVersion, "v2");
  });

  it("v2 블록: 원인(분류·위치·코드 조각)·결함 묶음·고침 결과·가정·인용 증거물 요약(원문 상한)", () => {
    const { report } = R.buildV2Report(v2Result(), { targetUrl: "https://s.example/", intent: "미용실", acs: ACS, acSource: "interview" }, "ko");
    const a2 = report.v2.verdicts.find((v) => v.acId === "A2");
    assert.equal(a2.cause.cls, "client_only_storage");
    assert.deepEqual(a2.cause.location, { file: "/app.js", line: null });
    assert.deepEqual(a2.cause.source, ["localStorage.setItem('b')"]);
    assert.deepEqual(report.v2.defectGroups.map((g) => g.key), ["H1:client_only_storage"]);
    assert.deepEqual(report.v2.fix.cannotFix, ["A2: 서버가 필요합니다"]);
    assert.deepEqual(report.v2.fix.assumptions, ["이 브라우저에만 저장"]);
    const a1 = report.v2.verdicts.find((v) => v.acId === "A1");
    assert.deepEqual(a1.evidence.map((e) => e.id), ["E7", "E5"]);
    assert.ok(a1.evidence.every((e) => e.excerpt.length <= 300), "증거 원문은 잘라서만 싣는다");
    assert.ok(!report.notes.some((n) => /이 브라우저에만 저장/.test(n)), "고친 파일을 주지 않으면 그 가정도 메모에 없다");
    const ok = v2Result({ fix: { attempted: true, validated: ["A2"], stillFailing: [], cannotFix: [], assumptions: ["이 브라우저에만 저장"], diff: "@@", correctedHtml: "<html/>" } });
    const withFix = R.buildV2Report(ok, { targetUrl: "https://s.example/", intent: "미용실", acs: ACS, acSource: "interview" }, "ko").report;
    assert.ok(withFix.notes.some((n) => /고친 파일 참고: 이 브라우저에만 저장/.test(n)), "고친 파일을 줄 때는 가정·한계가 사용자 메모에 보인다");
  });

  it("의도 불일치는 표에서 fail(이유 앞에 '생각과 달라요')이고 v2.intentMismatch로도 표시", () => {
    const r = v2Result({
      intentMismatch: ["A1"],
      verdicts: [{ acId: "A1", verdict: "mismatch", claim: "직접 체크하게 한다", artifactIds: ["E5"], reproArtifactIds: ["E5"], quotes: ["예약이"], reasons: [], confirmed: true, cause: { cls: "intent_mismatch", basis: "verdict", evidenceIds: [], sourceIds: [], location: null } }],
    });
    const out = R.buildV2Report(r, { targetUrl: "https://s.example/", intent: "i", acs: ACS.slice(0, 1), acSource: "interview" }, "ko");
    const row = out.report.acTable[0];
    assert.equal(row.status, "fail");
    assert.match(row.reason, /^생각과 달라요/);
    assert.deepEqual(out.report.v2.intentMismatch, ["A1"]);
    assert.equal(out.decision, "Needs Fix");
  });

  it("첫 화면 즉시 고장(404·index 없음) → 앱 없음 리포트", () => {
    const r = v2Result({ entry: { broken: { cause: "missing_index_file", status: 404 } }, verdicts: [], defectGroups: [], fix: { attempted: false, reason: "entry_broken" } });
    const out = R.buildV2Report(r, { targetUrl: "https://s.example/", intent: "i", acs: ACS, acSource: "interview" }, "ko");
    assert.equal(out.decision, "Needs Fix");
    assert.equal(out.report.agent.basis, "app_missing");
    assert.equal(out.report.v2.entry.cause, "missing_index_file");
  });

  it("고친 파일이 검증을 통과했을 때만 correctedHtml을 싣는다", () => {
    const ok = v2Result({ fix: { attempted: true, validated: ["A2"], stillFailing: [], cannotFix: [], assumptions: [], diff: "@@", correctedHtml: "<html>fixed</html>" } });
    assert.equal(R.buildV2Report(ok, { targetUrl: "https://s.example/", intent: "i", acs: ACS, acSource: "interview" }, "ko").report.v2.fix.correctedHtml, "<html>fixed</html>");
    const no = v2Result({ fix: { attempted: true, validated: [], stillFailing: ["A2"], cannotFix: [], assumptions: [], diff: "@@", correctedHtml: "<html>x</html>" } });
    assert.equal(R.buildV2Report(no, { targetUrl: "https://s.example/", intent: "i", acs: ACS, acSource: "interview" }, "ko").report.v2.fix.correctedHtml, undefined);
  });
});

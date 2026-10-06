/**
 * 검사 엔진 v2 · S1 — 증거물 저장소 + 판정 스키마 + 기계 검증기(설계 §2.1).
 * "옛 코드 실패" 대조: v1 finalizeJudge는 화면 글자에 인용이 있기만 하면 pass를 받아 줬다(Lovable 파일럿: 소개 문구로 must 통과).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const v2 = await import("../dist/agent-v2.js");
const v1 = await import("../dist/agent-inspection.js");

const MUST = { id: "AC-1", title: "예약하면 사장님 화면에 보인다", given: "", when: "", then: "예약이 관리 화면 목록에 나온다", priority: "must", confirmed: true };
const SHOULD = { ...MUST, id: "AC-2", priority: "should" };
const acs = new Map([[MUST.id, MUST], [SHOULD.id, SHOULD]]);
const judge = (store, j) => v2.validateV2Verdict({ quotes: [], artifactIds: [], claim: "", ...j }, acs.get(j.acId), store);

describe("S1 EvidenceStore — 브라우저 상태 기계", () => {
  it("입력 뒤 클릭 = 제출, 새 브라우저는 상호작용을 지우고 제출 이력은 남긴다", () => {
    const s = new v2.EvidenceStore();
    const first = s.add("screen", "observe", { summary: "첫 화면" });
    assert.equal(first.interacted, false);
    assert.equal(s.noteAction("click").submitted, false, "입력 없는 클릭은 제출이 아니다");
    s.noteAction("fill");
    assert.equal(s.noteAction("click").submitted, true);
    const after = s.add("diff", "click", { summary: "완료", stateChange: true });
    assert.equal(after.afterSubmit, true);
    assert.equal(after.firstSubmitContext, 0);
    s.newContext();
    const other = s.add("context", "new_context", { summary: "새 브라우저 관리 화면", stateChange: true });
    assert.equal(other.context, 1);
    assert.equal(other.interacted, false);
    assert.equal(other.afterSubmit, true);
    assert.equal(v2.isVerifiedOutcome(other), true, "제출한 브라우저가 아닌 곳에서 본 결과");
    assert.equal(v2.isHardArtifact(first), false, "처음 열린 화면 글자는 단단한 증거물이 아니다");
    assert.equal(v2.isHardArtifact(other), true);
  });
  it("원문은 잘라서 보관한다", () => {
    const s = new v2.EvidenceStore();
    const a = s.add("source", "read_source", { summary: "app.js", raw: "x".repeat(100_000) });
    assert.equal(a.raw.length, v2.ARTIFACT_RAW_MAX);
  });
});

describe("S1 기계 검증기 — 증거 없는 판정은 오르지 않는다", () => {
  it("★옛 코드 대조: 소개 문구 인용 pass를 v1은 받았고, v2는 거절한다", () => {
    const marketing = "AI가 만든 앱을 자동으로 점검하고 결과를 안내합니다";
    const old = v1.finalizeJudge(
      { type: "judge", verdict: "pass", reason: "결과를 안내한다고 적혀 있다", evidenceQuote: "결과를 안내합니다" },
      { corpus: marketing, loginGate: null, hasCredentials: false, locale: "ko" },
    );
    assert.equal(old.status, "pass", "v1은 화면 글자 인용만으로 통과시켰다(파일럿 Lovable 반대 판정의 원인)");
    const s = new v2.EvidenceStore();
    const landing = s.add("screen", "observe", { summary: marketing, raw: marketing });
    const r = judge(s, { acId: "AC-1", verdict: "pass", claim: "결과를 안내한다고 적혀 있다", artifactIds: [landing.id], quotes: ["결과를 안내합니다"] });
    assert.equal(r.accept, false);
    assert.equal(r.problem, "no_hard_artifact");
  });
  it("① 증거물 id 없음·없는 id → 거절", () => {
    const s = new v2.EvidenceStore();
    assert.equal(judge(s, { acId: "AC-2", verdict: "fail", claim: "저장되지 않는다" }).problem, "no_artifacts");
    assert.equal(judge(s, { acId: "AC-2", verdict: "fail", claim: "저장되지 않는다", artifactIds: ["ev-99"], quotes: ["x"] }).problem, "unknown_artifacts");
  });
  it("② 핵심 값이 인용한 증거물 원문에 없으면 거절(지어낸 관찰 금지)", () => {
    const s = new v2.EvidenceStore();
    s.noteAction("fill");
    s.noteAction("click");
    const req = s.add("request", "network_log", { summary: "POST /api/bookings 201", raw: 'POST https://x.app/api/bookings 201 {"id":7}', stateChange: true });
    const bad = judge(s, { acId: "AC-2", verdict: "pass", claim: "예약 저장됨", artifactIds: [req.id], quotes: ["booking_id: 99"] });
    assert.equal(bad.problem, "quote_not_found");
    const noq = judge(s, { acId: "AC-2", verdict: "pass", claim: "예약 저장됨", artifactIds: [req.id] });
    assert.equal(noq.problem, "no_quotes");
    const ok = judge(s, { acId: "AC-2", verdict: "pass", claim: "예약 저장됨", artifactIds: [req.id], quotes: ["/api/bookings 201"] });
    assert.equal(ok.accept, true);
  });
  it("③ pass는 상태 변화 증거물이 있어야, must는 제출 + 남는지/다른 곳 확인까지", () => {
    const s = new v2.EvidenceStore();
    s.noteAction("click");
    const clicked = s.add("screen", "click", { summary: "목록 화면 예약 0건", raw: "예약 0건" });
    assert.equal(judge(s, { acId: "AC-2", verdict: "pass", claim: "목록이 보인다", artifactIds: [clicked.id], quotes: ["예약 0건"] }).problem, "no_state_change");
    s.noteAction("fill");
    s.noteAction("click");
    const done = s.add("diff", "click", { summary: "예약 완료 심사테스트 10:30", raw: "예약 완료 심사테스트 10:30", stateChange: true });
    const onlySame = judge(s, { acId: "AC-1", verdict: "pass", claim: "예약 완료", artifactIds: [done.id], quotes: ["예약 완료"] });
    assert.equal(onlySame.problem, "not_exercised", "같은 브라우저 완료 화면만으로 must 통과 불가 — 남는지 확인 필요");
    s.newContext();
    s.noteAction("navigate");
    const admin = s.add("context", "new_context", { summary: "관리 화면 심사테스트 10:30", raw: "오늘 예약 심사테스트 10:30", stateChange: true });
    const ok = judge(s, { acId: "AC-1", verdict: "pass", claim: "새 브라우저 관리 화면에 예약이 보인다", artifactIds: [done.id, admin.id], quotes: ["심사테스트 10:30"] });
    assert.equal(ok.accept, true);
    assert.deepEqual(ok.exercised, { stateChange: true, verified: true });
  });
  it("③ 소개 문구를 근거로 든 pass는 상태 변화가 없으면 거절", () => {
    const s = new v2.EvidenceStore();
    s.noteAction("click");
    const page = s.add("diff", "click", { summary: "소개 페이지 열림", raw: "자동 점검 결과를 안내합니다", stateChange: true });
    const r = judge(s, { acId: "AC-2", verdict: "pass", claim: "점검 결과를 안내한다고 적혀 있다", artifactIds: [page.id], quotes: ["결과를 안내합니다"] });
    assert.equal(r.problem, "description_only");
  });
  it("④ must fail은 같은 값이 새 브라우저에서도 나온 재현 쌍이 있어야", () => {
    const s = new v2.EvidenceStore();
    s.noteAction("fill");
    s.noteAction("click");
    const a = s.add("diff", "click", { summary: "제출 뒤 오류", raw: "예약에 실패했습니다 (500)", stateChange: true });
    const once = judge(s, { acId: "AC-1", verdict: "fail", claim: "예약이 저장되지 않고 오류가 난다", artifactIds: [a.id], quotes: ["예약에 실패했습니다"] });
    assert.equal(once.problem, "not_reproduced");
    s.newContext();
    s.noteAction("fill");
    s.noteAction("click");
    const b = s.add("diff", "click", { summary: "새 브라우저 제출 뒤 오류", raw: "예약에 실패했습니다 (500)", stateChange: true });
    const twice = judge(s, { acId: "AC-1", verdict: "fail", claim: "예약이 저장되지 않고 오류가 난다", artifactIds: [a.id, b.id], quotes: ["예약에 실패했습니다"] });
    assert.equal(twice.accept, true);
  });
  it("④ 화면 구성 해석은 실패가 아니다", () => {
    const s = new v2.EvidenceStore();
    s.noteAction("click");
    const x = s.add("diff", "click", { summary: "시간이 한 화면에 이미 보임", raw: "10:00 10:30", stateChange: true });
    const r = judge(s, { acId: "AC-2", verdict: "fail", claim: "시간 선택이 날짜보다 먼저 한 화면에 보인다", artifactIds: [x.id], quotes: ["10:00"] });
    assert.equal(r.problem, "not_outcome");
  });
  it("의도 판정(INTENT): mismatch는 실제 능력 증거로, 기준에는 mismatch 금지", () => {
    const s = new v2.EvidenceStore();
    const src = s.add("source", "grep_source", { summary: "app.js: 점검 항목 체크박스 배열, fetch 없음", raw: 'const items=["화면이 열리나요?","버튼이 되나요?"]; // no fetch' });
    const ok = judge(s, { acId: "INTENT", verdict: "mismatch", claim: "주소를 넣어도 대상 앱에 요청하지 않고, 사용자가 직접 체크하는 목록만 있다", artifactIds: [src.id], quotes: ["화면이 열리나요?"] });
    assert.equal(ok.accept, true);
    assert.equal(judge(s, { acId: "AC-1", verdict: "mismatch", claim: "x", artifactIds: [src.id], quotes: ["화면이"] }).problem, "mismatch_on_criterion");
  });
  it("확인 못 함은 증거가 있을 때만 막힘 사유를 단다", () => {
    const s = new v2.EvidenceStore();
    const wall = s.add("screen", "observe", { summary: "비밀번호 입력 화면", raw: "비밀번호" });
    assert.equal(judge(s, { acId: "AC-1", verdict: "not_verified", claim: "로그인 필요", reasonCode: "login_required", artifactIds: [wall.id] }).reasonCode, "login_required");
    assert.equal(judge(s, { acId: "AC-1", verdict: "not_verified", claim: "로그인 필요", reasonCode: "login_required" }).reasonCode, "not_reached");
  });
  it("인용률과 원인 인용 검사", () => {
    const s = new v2.EvidenceStore();
    const src = s.add("source", "read_source", { summary: "app.js", raw: "x" });
    const recs = [
      { acId: "AC-1", verdict: "fail", claim: "", artifactIds: [src.id], quotes: [], exercised: { stateChange: false, verified: false }, refusals: 0 },
      { acId: "AC-2", verdict: "not_verified", claim: "", artifactIds: [], quotes: [], exercised: { stateChange: false, verified: false }, refusals: 2 },
    ];
    assert.deepEqual(v2.citationRate(recs, s), { decided: 1, cited: 1, pct: 100 });
    const sources = new Map([["https://a.app/app.js", "function save(b){ localStorage.setItem('bookings', JSON.stringify(b)) }"]]);
    assert.equal(v2.causeIsGrounded({ file: "app.js", where: "save", snippet: "localStorage.setItem('bookings',", explanation: "" }, sources), true);
    assert.equal(v2.causeIsGrounded({ file: "app.js", where: "save", snippet: "fetch('/api/bookings')", explanation: "" }, sources), false);
  });
});

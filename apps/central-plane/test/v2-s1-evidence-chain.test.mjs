// v2 S1 (2026-10-21, `train v2-S1 start approved.`) — 증거물 저장소 · 판정 스키마 · 기계 검증기.
// 설계: docs/simsa-inspector-v2-design-2026-10-07.md §2.1 · V-1(증거물 인용 필수) · V-2(pass = 상태 변화 증거물) · V-3(fail = 재현 쌍).
// 완료 증거(§5 S1): "증거 없는 판정 강등 테스트(옛 코드 실패)" — 옛 코드엔 이 모듈이 없다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const E = await import("../dist/evidence-chain.js");

/** 미용실 예약 한 바퀴의 증거물(제출 → 서버 쓰기 → 새 브라우저에서 다시 봄). */
function salonStore() {
  const s = E.createEvidenceStore();
  const form = s.add("screen", "예약 폼", "동네 미용실 예약 이름 휴대폰 10:30 예약하기", { url: "/", session: "same" });
  const write = s.add("request", "POST /api/bookings 201", "POST https://salon.example/api/bookings → 201", { method: "POST", status: 201, url: "/api/bookings" });
  const done = s.add("screen", "완료 화면", "예약이 완료되었어요 심사테스트 2026-10-19 10:30", { url: "/done", session: "same" });
  const fresh = s.add("screen", "새 브라우저 첫 화면", "동네 미용실 예약 10:30 예약 가능", { url: "/", session: "fresh" });
  const freshAgain = s.add("screen", "새 브라우저 재실행", "동네 미용실 예약 10:30 예약 가능", { url: "/", session: "fresh", reproOf: fresh });
  return { s, ids: { form, write, done, fresh, freshAgain } };
}

describe("증거물 저장소", () => {
  it("id는 E1, E2 … 순서이고 원문은 상한으로 자른다 · 가림 함수를 거친다", () => {
    const s = E.createEvidenceStore({ maxRaw: 10, redact: (t) => t.replace(/sk-[a-z]+/g, "[가림]") });
    const a = s.add("console", "에러", "TypeError sk-secret at app.js:12");
    const b = s.add("context", "메모", "x");
    assert.equal(a, "E1");
    assert.equal(b, "E2");
    assert.equal(s.get("E1").raw, "TypeError ");
    assert.ok(!JSON.stringify(s.toJSON()).includes("sk-secret"));
  });
  it("알 수 없는 kind는 받지 않는다(닫힌 어휘)", () => {
    const s = E.createEvidenceStore();
    assert.throws(() => s.add("guess", "x", "y"), /unknown_artifact_kind/);
  });
  it("상한을 넘으면 더 쌓지 않고 truncated를 표시한다(런 메모리 보호)", () => {
    const s = E.createEvidenceStore({ maxArtifacts: 2 });
    s.add("context", "1", "a");
    s.add("context", "2", "b");
    assert.equal(s.add("context", "3", "c"), null);
    assert.equal(s.toJSON().truncated, true);
  });
});

describe("판정 파서 — LLM 출력은 경계(엄격)", () => {
  it("정상 판정을 받는다", () => {
    const r = E.parseV2Verdict('{"acId":"A4","verdict":"pass","claim":"완료 화면에 예약이 보인다","artifactIds":["E2","E3"],"quotes":["예약이 완료되었어요"]}');
    assert.equal(r.ok, true);
    assert.deepEqual(r.verdict.artifactIds, ["E2", "E3"]);
  });
  it("verdict 어휘 밖·artifactIds 형식 오류·quotes 없음은 거절한다", () => {
    assert.equal(E.parseV2Verdict('{"acId":"A4","verdict":"maybe","claim":"x","artifactIds":["E1"],"quotes":["x"]}').ok, false);
    assert.equal(E.parseV2Verdict('{"acId":"A4","verdict":"pass","claim":"x","artifactIds":["screen1"],"quotes":["x"]}').ok, false);
    assert.equal(E.parseV2Verdict('{"acId":"A4","verdict":"pass","claim":"x","artifactIds":["E1"]}').ok, false);
    assert.equal(E.parseV2Verdict("not json").ok, false);
  });
});

describe("기계 검증기 (LLM 없음)", () => {
  it("V-1 ① 인용한 증거물이 없으면 not_verified로 강등", () => {
    const { s } = salonStore();
    const v = E.verifyVerdict({ acId: "A4", verdict: "pass", claim: "완료", artifactIds: [], quotes: ["예약이 완료되었어요"] }, s);
    assert.equal(v.verdict, "not_verified");
    assert.ok(v.reasons.includes("no_artifacts"));
  });
  it("V-1 ① 없는 증거물 id를 인용하면 강등", () => {
    const { s } = salonStore();
    const v = E.verifyVerdict({ acId: "A4", verdict: "pass", claim: "완료", artifactIds: ["E99"], quotes: ["예약이 완료되었어요"] }, s);
    assert.equal(v.verdict, "not_verified");
    assert.ok(v.reasons.includes("unknown_artifact"));
  });
  it("② 인용 문구가 인용한 증거물 원문에 실제로 없으면 강등(지어낸 인용)", () => {
    const { s, ids } = salonStore();
    const v = E.verifyVerdict({ acId: "A4", verdict: "pass", claim: "완료", artifactIds: [ids.write, ids.done], quotes: ["예약이 확정되었습니다"] }, s);
    assert.equal(v.verdict, "not_verified");
    assert.ok(v.reasons.includes("quote_not_in_artifacts"));
  });
  it("③ V-2 pass는 상태 변화 증거물이 있어야 한다 — 화면 글자만으로는 강등", () => {
    const { s, ids } = salonStore();
    const screenOnly = E.verifyVerdict({ acId: "A4", verdict: "pass", claim: "완료", artifactIds: [ids.done], quotes: ["예약이 완료되었어요"] }, s);
    assert.equal(screenOnly.verdict, "not_verified");
    assert.ok(screenOnly.reasons.includes("pass_without_state_change"));
    const withWrite = E.verifyVerdict({ acId: "A4", verdict: "pass", claim: "완료", artifactIds: [ids.write, ids.done], quotes: ["예약이 완료되었어요"] }, s);
    assert.equal(withWrite.verdict, "pass");
    assert.deepEqual(withWrite.reasons, []);
  });
  it("③ 상태 변화 종류 — 쓰기 2xx · 저장소 변화 · 조작 전후 차이 · 다른 브라우저 관찰(쓰기 4xx·변화 없음은 아님)", () => {
    const s = E.createEvidenceStore();
    const w4 = s.add("request", "POST 400", "POST /api → 400", { method: "POST", status: 400, url: "/api" });
    const get = s.add("request", "GET 200", "GET /api → 200", { method: "GET", status: 200, url: "/api" });
    const st = s.add("storage", "localStorage 바뀜", "bookings=[…]", { changed: true, area: "local" });
    const st0 = s.add("storage", "변화 없음", "", { changed: false, area: "local" });
    const df = s.add("diff", "조작 전후", "+ 예약됨", { changed: true });
    const fr = s.add("screen", "새 브라우저", "10:30 예약됨", { session: "fresh", url: "/" });
    for (const [id, want] of [[w4, false], [get, false], [st, true], [st0, false], [df, true], [fr, true]]) {
      assert.equal(E.isStateChangeArtifact(s.get(id)), want, `${s.get(id).summary}`);
    }
  });
  it("④ V-3 fail은 재현 쌍(같은 문구가 독립 재실행 증거물에도)이 있어야 한다", () => {
    const { s, ids } = salonStore();
    const once = E.verifyVerdict({ acId: "A3", verdict: "fail", claim: "다른 손님에게 10:30이 열려 있다(이중 예약)", artifactIds: [ids.write, ids.fresh], quotes: ["10:30 예약 가능"] }, s);
    assert.equal(once.verdict, "not_verified");
    assert.ok(once.reasons.includes("fail_not_reproduced"));
    const twice = E.verifyVerdict({ acId: "A3", verdict: "fail", claim: "이중 예약", artifactIds: [ids.write, ids.fresh], reproArtifactIds: [ids.freshAgain], quotes: ["10:30 예약 가능"] }, s);
    assert.equal(twice.verdict, "fail");
  });
  it("④ 재현 증거물이 원래 증거물과 같은 것이면 재현이 아니다", () => {
    const { s, ids } = salonStore();
    const v = E.verifyVerdict({ acId: "A3", verdict: "fail", claim: "이중 예약", artifactIds: [ids.fresh], reproArtifactIds: [ids.fresh], quotes: ["10:30 예약 가능"] }, s);
    assert.equal(v.verdict, "not_verified");
    assert.ok(v.reasons.includes("fail_not_reproduced"));
  });
  it("not_verified는 그대로 둔다(강등할 것이 없다) · mismatch(의도 불일치, V-7)는 증거물·인용이 있어야 한다", () => {
    const { s, ids } = salonStore();
    assert.equal(E.verifyVerdict({ acId: "A1", verdict: "not_verified", claim: "로그인 필요", artifactIds: [], quotes: [] }, s).verdict, "not_verified");
    assert.equal(E.verifyVerdict({ acId: "I", verdict: "mismatch", claim: "x", artifactIds: [], quotes: ["x"] }, s).verdict, "not_verified");
    // S5(2026-10-22): mismatch도 fail처럼 독립 재실행 증거가 있어야 한다(설계 §2.2-5).
    const m = { acId: "I", verdict: "mismatch", claim: "예약 대신 소개 페이지", artifactIds: [ids.form], quotes: ["동네 미용실 예약"] };
    assert.deepEqual(E.verifyVerdict(m, s).reasons, ["mismatch_not_reproduced"]);
    const again = s.add("screen", "confirm /: 동네 미용실 예약", "동네 미용실 예약", { session: "confirm" });
    assert.equal(E.verifyVerdict({ ...m, reproArtifactIds: [again] }, s).verdict, "mismatch");
  });
  it("검증기를 통과하지 못한 판정은 리포트에 오르지 않는다 — verifyAll은 통과분과 강등분을 나눈다", () => {
    const { s, ids } = salonStore();
    const out = E.verifyAll(
      [
        { acId: "A4", verdict: "pass", claim: "완료", artifactIds: [ids.write, ids.done], quotes: ["예약이 완료되었어요"] },
        { acId: "A5", verdict: "pass", claim: "새로고침 뒤 남음", artifactIds: [ids.done], quotes: ["예약이 완료되었어요"] },
      ],
      s,
    );
    assert.deepEqual(out.accepted.map((v) => v.acId), ["A4"]);
    assert.deepEqual(out.downgraded.map((v) => [v.acId, v.reasons[0]]), [["A5", "pass_without_state_change"]]);
  });
});

// v2 S5 (2026-10-22) — 판정 규칙 보강: 소개 문구 pass 금지 · 의도 불일치(V-7)는 관찰 증거 + 독립 재실행이 있어야 한다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const E = await import("../dist/evidence-chain.js");

/** 미용실 첫 화면(소개 문구) → "예약하기" 눌러 화면 이동(diff changed) — 상태 변화처럼 보이지만 아무것도 저장하지 않았다. */
function landingStore() {
  const s = E.createEvidenceStore();
  const first = s.add("screen", "same /: 동네 미용실 — 온라인으로 쉽게 예약하세요", "동네 미용실\n온라인으로 쉽게 예약하세요\n예약하기", { session: "same", url: "https://x/" });
  const nav = s.add("diff", '"예약하기" 누르기 — 화면 바뀜', '"예약하기" 누르기\nclicked → https://x/book', { changed: true });
  const book = s.add("screen", "same /book: 동네 미용실 — 날짜를 고르세요", "동네 미용실\n온라인으로 쉽게 예약하세요\n날짜를 고르세요", { session: "same", url: "https://x/book" });
  return { s, first, nav, book };
}

describe("소개 문구 pass 금지", () => {
  it("인용이 전부 기준 시작 화면에 이미 있던 글자면 pass가 아니다(화면 이동 diff가 있어도) — 옛 검증기는 통과시켰다", () => {
    const { s, first, nav, book } = landingStore();
    const v = { acId: "A4", verdict: "pass", claim: "온라인 예약이 된다", artifactIds: [nav, book], quotes: ["온라인으로 쉽게 예약하세요"] };
    assert.equal(E.verifyVerdict(v, s).verdict, "pass", "전제: 기준선 없이는 통과(이 테스트가 막으려는 구멍)");
    const r = E.verifyVerdict(v, s, { baselineIds: [first] });
    assert.equal(r.verdict, "not_verified");
    assert.deepEqual(r.reasons, ["pass_quotes_only_initial_screen"]);
  });
  it("행동 뒤에 새로 나타난 글자를 하나라도 인용하면 통과", () => {
    const { s, first, nav, book } = landingStore();
    const done = s.add("screen", "same /done: 예약이 완료되었어요 심사테스트 10:30", "예약이 완료되었어요 심사테스트 10:30", { session: "same" });
    const r = E.verifyVerdict({ acId: "A4", verdict: "pass", claim: "완료", artifactIds: [nav, book, done], quotes:["온라인으로 쉽게 예약하세요", "예약이 완료되었어요"] }, s, { baselineIds: [first] });
    assert.deepEqual(r.reasons, []);
  });
});

describe("의도 불일치(V-7)", () => {
  it("코드·메모만 인용한 mismatch는 강등 — 앱이 실제로 그렇게 동작하는 관찰이 있어야 한다", () => {
    const s = E.createEvidenceStore();
    const src = s.add("source", "R3 canned_result — /app.js", "const result = { score: 78 }");
    const r = E.verifyVerdict({ acId: "CORE-1", verdict: "mismatch", claim: "늘 같은 결과", artifactIds: [src], quotes: ["score: 78"] }, s);
    assert.equal(r.verdict, "not_verified");
    assert.ok(r.reasons.includes("mismatch_without_observation"), r.reasons.join(","));
  });
  it("관찰 증거가 있어도 독립 재실행 증거가 없으면 강등, 있으면 통과", () => {
    const s = E.createEvidenceStore();
    const a = s.add("screen", "same /result: 점수 78점", "점수 78점 — 검사 완료", { session: "same" });
    const b = s.add("screen", "confirm /result: 점수 78점", "점수 78점 — 검사 완료", { session: "confirm" });
    const v = { acId: "CORE-1", verdict: "mismatch", claim: "어떤 주소를 넣어도 같은 결과", artifactIds: [a], quotes: ["점수 78점"] };
    assert.deepEqual(E.verifyVerdict(v, s).reasons, ["mismatch_not_reproduced"]);
    assert.deepEqual(E.verifyVerdict({ ...v, reproArtifactIds: [b] }, s).reasons, []);
  });
});

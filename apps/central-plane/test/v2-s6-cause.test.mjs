// v2 S6a·b (2026-10-23) — 결함 원인 분류를 판정 문장의 단어 맞추기에서 **증거물·정적 사실** 기반으로.
// 실측 S5(10-23): 판정은 맞았는데 F3(서버 주소 오류)·F10(고정 결과)의 분류가 other — 데이터 라벨로 쓸 수 없었다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const J = await import("../dist/v2-judge.js");
const E = await import("../dist/evidence-chain.js");

const fail = (acId, claim, quotes, ids = []) => ({ acId, verdict: "fail", claim, quotes, artifactIds: ids, reasons: [] });

describe("원인 분류 — 증거물·정적 사실 우선", () => {
  it("F3 모양: 문장엔 원인이 없어도 그 기준 실행 중 콘솔에 서버 주소 해석 실패 → missing_backend_config (옛 분류 other)", () => {
    const s = E.createEvidenceStore();
    const scr = s.add("screen", "same /: 💬 (아직 저장된 메모가 없습니다)", "💬 (아직 저장된 메모가 없습니다)", { session: "same" });
    s.add("console", "Failed to load resource: net::ERR_NAME_NOT_RESOLVED", "Failed to load resource: net::ERR_NAME_NOT_RESOLVED", {});
    const v = fail("CORE-1", "고객 메모를 저장해도 목록에 나타나지 않습니다.", ["💬 (아직 저장된 메모가 없습니다)"], [scr]);
    const c = J.classifyFailure(v, { acArtifacts: s.list(), facts: [], hypotheses: [] });
    assert.equal(c.cls, "missing_backend_config");
    assert.equal(c.basis, "console");
    assert.equal(c.evidenceIds.length, 1);
  });
  it("콘솔의 잡히지 않은 오류 → runtime_error, 오류 줄의 파일 위치를 원인 위치로", () => {
    const s = E.createEvidenceStore();
    s.add("console", "Uncaught TypeError: Cannot read properties of undefined (reading 'USD')", "Uncaught TypeError: Cannot read properties of undefined (reading 'USD')\n    at convert (https://x.example/app.js:42:17)", {});
    const c = J.classifyFailure(fail("A1", "계산해도 그대로", ["화면 그대로"]), { acArtifacts: s.list(), facts: [], hypotheses: [] });
    assert.equal(c.cls, "runtime_error");
    assert.deepEqual(c.location, { file: "https://x.example/app.js", line: 42 });
  });
  it("정적 사실(R2 기기 저장)이 있고 그 가설이 이 기준을 덮으며 증거(다른 브라우저 화면·저장소 변화)가 맞으면 그 분류 + 소스 증거물", () => {
    const s = E.createEvidenceStore();
    const src = s.add("source", "R2 client_only_storage — /app.js", "localStorage.setItem('bookings', JSON.stringify(list))", { url: "/app.js" });
    const fresh = s.add("screen", "fresh /: 10:30 예약 가능", "10:30 예약 가능", { session: "fresh" });
    const facts = [{ fact: { rule: "R2", cls: "client_only_storage", file: "/app.js", excerpt: "localStorage.setItem('bookings'" }, artifactId: src }];
    const v = fail("A6", "다른 손님에게 10:30이 열려 있다", ["10:30 예약 가능"], [fresh]);
    const c = J.classifyFailure(v, { acArtifacts: [s.get(fresh)], facts, hypotheses: [{ id: "H1", cls: "client_only_storage", coversAcIds: ["A6"] }] });
    assert.equal(c.cls, "client_only_storage");
    assert.equal(c.basis, "static_fact");
    assert.deepEqual(c.sourceIds, [src]);
    assert.deepEqual(c.location, { file: "/app.js", line: null });
  });
  it("가설이 덮어도 증거가 맞지 않으면(다른 브라우저·저장소 증거 없음) 정적 사실로 단정하지 않는다", () => {
    const s = E.createEvidenceStore();
    const src = s.add("source", "R2 client_only_storage — /app.js", "localStorage.setItem('x')", { url: "/app.js" });
    const scr = s.add("screen", "same /: 버튼을 눌러도 반응이 없다", "버튼", { session: "same" });
    const facts = [{ fact: { rule: "R2", cls: "client_only_storage", file: "/app.js", excerpt: "localStorage" }, artifactId: src }];
    const c = J.classifyFailure(fail("A6", "예약하기를 눌러도 반응이 없다", ["버튼"], [scr]), { acArtifacts: [s.get(scr)], facts, hypotheses: [{ id: "H1", cls: "client_only_storage", coversAcIds: ["A6"] }] });
    assert.equal(c.cls, "broken_action");
    assert.equal(c.basis, "claim_text");
  });
  it("의도 불일치 판정 → intent_mismatch", () => {
    const c = J.classifyFailure({ ...fail("C", "x", ["x"]), verdict: "mismatch" }, { acArtifacts: [], facts: [], hypotheses: [] });
    assert.equal(c.cls, "intent_mismatch");
  });
});

describe("결함 묶음이 증거 기반 분류를 쓴다", () => {
  it("groupFailures에 분류 함수를 넘기면 그 분류로 묶는다", () => {
    const vs = [fail("A1", "x", ["x"]), fail("A2", "y", ["y"])];
    const g = J.groupFailures(vs, [], ["A1", "A2"], () => "missing_backend_config");
    assert.deepEqual(g.map((x) => [x.key, x.acIds]), [["A1:missing_backend_config", ["A1"]], ["A2:missing_backend_config", ["A2"]]]);
  });
});

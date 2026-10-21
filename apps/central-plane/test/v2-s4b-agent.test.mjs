// v2 S4b (2026-10-21, `train v2-S4 start approved.`) — 실행 고리 턴 프롬프트·증거물 목록·턴 파서.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const A = await import("../dist/v2-agent.js");
const E = await import("../dist/evidence-chain.js");

const AC = { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", given: "어떤 날짜·시간에 예약이 하나 있다", when: "다른 손님(새 브라우저)이 같은 날짜·시간을 고르려 한다", then: "그 시간은 고를 수 없다", priority: "must" };
const OBS = { url: "https://salon.example/", title: "t", aria: "- button 10:30", text: "동네 미용실 예약 10:30 예약 가능", networkErrors: [], consoleErrors: [], hasPasswordField: false };
const H = [{ id: "H1", statement: "기록이 그 브라우저에만 저장된다", experiment: { kind: "fresh_browser_lookup", steps: ["같은 브라우저에서 1건", "새 브라우저로 같은 시간"], confirmsIf: "새 브라우저에서 그 시간이 열려 있다", refutesIf: "새 브라우저에서도 막혀 있다" } }];

describe("턴 파서 — 판정은 v2 형식, 행동은 v1 어휘", () => {
  it("v2 판정을 읽고 acId는 실행기가 붙인다", () => {
    const t = A.parseV2Turn('{"thought":"x","action":{"type":"judge","verdict":"fail","claim":"다른 손님에게 10:30이 열려 있다","artifactIds":["E4","E9"],"quotes":["10:30 예약 가능"],"reproArtifactIds":["E12"]}}', { acId: "A3", origin: "https://salon.example" });
    assert.equal(t.ok, true);
    assert.equal(t.kind, "judge");
    assert.deepEqual(t.verdict, { acId: "A3", verdict: "fail", claim: "다른 손님에게 10:30이 열려 있다", artifactIds: ["E4", "E9"], reproArtifactIds: ["E12"], quotes: ["10:30 예약 가능"] });
  });
  it("행동은 v1 파서 그대로(클릭·입력·새 브라우저)", () => {
    const t = A.parseV2Turn('{"action":{"type":"click","target":{"role":"button","name":"10:30"}}}', { acId: "A3", origin: "https://salon.example" });
    assert.deepEqual(t, { ok: true, kind: "action", action: { type: "click", target: { role: "button", name: "10:30" } } });
    assert.equal(A.parseV2Turn('{"action":{"type":"new_session"}}', { acId: "A3", origin: "https://salon.example" }).action.type, "new_session");
  });
  it("v1 형식 판정(evidenceQuote)·증거물 없는 판정·인용 없는 판정은 거절 — 다시 묻는다", () => {
    const ctx = { acId: "A3", origin: "https://salon.example" };
    assert.equal(A.parseV2Turn('{"action":{"type":"judge","verdict":"pass","reason":"r","evidenceQuote":"q"}}', ctx).ok, false);
    assert.equal(A.parseV2Turn('{"action":{"type":"judge","verdict":"pass","claim":"c","artifactIds":["screen"],"quotes":["q"]}}', ctx).ok, false);
    assert.equal(A.parseV2Turn('{"action":{"type":"judge","verdict":"pass","claim":"c","artifactIds":["E1"]}}', ctx).ok, false);
  });
  it("에이전트의 시계 이동은 받지 않는다(실행기 몫 — 2026-10-21 기준 3 위반 교훈)", () => {
    assert.deepEqual(A.parseV2Turn('{"action":{"type":"set_clock","iso":"2026-10-21T10:00:00+09:00"}}', { acId: "A6", origin: "https://x" }), { ok: false, error: "set_clock_runner_only" });
  });
  it("JSON이 아니면 거절", () => {
    assert.deepEqual(A.parseV2Turn("그냥 글", { acId: "A3", origin: "https://x" }), { ok: false, error: "no_json_object" });
  });
});

describe("증거물 목록", () => {
  it("종류·세션·상태 코드·변화 여부가 보이는 한 줄씩", () => {
    const s = E.createEvidenceStore();
    s.add("screen", "새 브라우저 첫 화면 10:30 예약 가능", "x", { session: "fresh", url: "/" });
    s.add("request", "POST /api/bookings", "x", { method: "POST", status: 201 });
    s.add("storage", "localStorage bookings", "x", { changed: true });
    s.add("diff", "제출 전후", "x", { changed: false });
    s.add("source", "R2 client_only_storage — /", "localStorage.setItem");
    assert.equal(
      A.artifactDigest(s),
      ["E1 · screen(fresh) · 새 브라우저 첫 화면 10:30 예약 가능", "E2 · request(201) · POST /api/bookings", "E3 · storage(changed) · localStorage bookings", "E4 · diff(same) · 제출 전후", "E5 · source · R2 client_only_storage — /"].join("\n"),
    );
  });
  it("최근 N개만, 생략 수를 알린다", () => {
    const s = E.createEvidenceStore();
    for (let i = 0; i < 30; i += 1) s.add("context", `메모 ${i}`, "x");
    const d = A.artifactDigest(s, { limit: 5 });
    assert.match(d, /^\(… 25 older artifacts omitted\)/);
    assert.match(d, /E30 · context · 메모 29$/);
  });
});

describe("프롬프트", () => {
  it("시스템 프롬프트가 검증기 규칙(V1~V3)과 판정 형식을 미리 알린다 · 시계 이동 금지", () => {
    const sys = A.v2SystemPrompt("ko");
    assert.match(sys, /"artifactIds":\["E3","E7"\]/);
    assert.match(sys, /V2\. pass needs a STATE-CHANGE artifact/);
    assert.match(sys, /V3\. fail needs the SAME quote observed again in an independent repeat/);
    assert.match(sys, /W4\. Do not move the device clock yourself/);
    assert.doesNotMatch(sys, /set_clock/);
  });
  it("턴 프롬프트에 이 기준의 가설·실험·참/거짓 조건과 증거물 목록이 들어간다", () => {
    const s = E.createEvidenceStore();
    s.add("source", "R2 client_only_storage — /", "localStorage.setItem");
    const p = A.v2TurnPrompt({ ac: AC, intent: "미용실 예약", hypotheses: H, observation: OBS, evidence: A.artifactDigest(s), history: [], testData: { name: "심사테스트", altName: "심사테스트둘", phone: "010-1234-5678" }, stepsLeft: 20, nowLabel: "2026-10-21 14:00 (Asia/Seoul, UTC+9)" });
    assert.match(p, /- H1: 기록이 그 브라우저에만 저장된다\. Experiment: 같은 브라우저에서 1건 → 새 브라우저로 같은 시간\. It is a defect if: 새 브라우저에서 그 시간이 열려 있다/);
    assert.match(p, /Evidence so far:\nE1 · source · R2 client_only_storage — \//);
    assert.match(p, /second customer=심사테스트둘/);
  });
});

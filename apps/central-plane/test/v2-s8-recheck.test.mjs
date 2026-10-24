// v2 S8 (2026-10-24) — 재검사 고리(설계 §2.2-8): 같은 계획으로 다시 돌린 결과를 원 런과 기준별·결함별로 비교하고,
// 지난번에 준 고친 파일이 사용자가 반영한 뒤 실제로 통과하는지(G4) · 고리를 끝낼지(모든 must 통과 또는 N회)를 낸다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const C = await import("../dist/v2-recheck.js");

const v = (acId, verdict, cls) => ({ acId, verdict, confirmed: verdict !== "not_verified", reasons: [], claim: "", quotes: [], evidence: [], ...(cls ? { cause: { cls, basis: "static_fact", location: null, source: [], seen: [] } } : {}) });
function rep({ verdicts, groups = [], fix = null, round, must = ["A3", "A5", "A6"] }) {
  return {
    engine: "agent", engineVersion: "v2",
    acTable: verdicts.map((x) => ({ id: x.acId, priority: must.includes(x.acId) ? "must" : "should", status: x.verdict === "mismatch" ? "fail" : x.verdict === "not_verified" ? "not_verified" : x.verdict })),
    v2: { verdicts, defectGroups: groups, fix, ...(round !== undefined ? { recheck: { round } } : {}) },
  };
}
const storageGroup = { key: "H1:client_only_storage", cls: "client_only_storage", hypothesisId: "H1", acIds: ["A5", "A6"], rootAcId: "A5" };

describe("기준별 비교", () => {
  it("고쳐짐 · 여전히 · 새로 깨짐 · 확인 못 함으로 바뀜(고쳐졌다고 하지 않는다)", () => {
    const before = rep({ verdicts: [v("A3", "fail", "timezone_date"), v("A5", "fail", "client_only_storage"), v("A6", "fail", "client_only_storage"), v("A8", "pass")], groups: [storageGroup] });
    const after = rep({ verdicts: [v("A3", "pass"), v("A5", "fail", "client_only_storage"), v("A6", "not_verified"), v("A8", "fail", "wrong_language")] });
    const c = C.compareV2Reports(before, after);
    assert.deepEqual(c.fixed, ["A3"]);
    assert.deepEqual(c.stillBroken, ["A5"]);
    assert.deepEqual(c.newlyBroken, ["A8"]);
    assert.deepEqual(c.unverifiedNow, ["A6"], "실패였다가 확인 못 함 → 고쳐짐으로 세지 않는다");
  });
});

describe("결함별 비교(첫 지점 규칙 묶음)", () => {
  it("묶음의 기준이 모두 통과 → 해결 · 하나라도 같은 원인으로 실패 → 남음 · 새 분류 → 새 결함", () => {
    const before = rep({ verdicts: [v("A3", "fail", "timezone_date"), v("A5", "fail", "client_only_storage"), v("A6", "fail", "client_only_storage")], groups: [storageGroup] });
    const fixedAll = rep({ verdicts: [v("A3", "fail", "timezone_date"), v("A5", "pass"), v("A6", "pass")] });
    const c1 = C.compareV2Reports(before, fixedAll);
    assert.deepEqual(c1.defects.resolved.map((d) => d.cls), ["client_only_storage"]);
    assert.deepEqual(c1.defects.persisting.map((d) => d.cls), ["timezone_date"]);
    const half = rep({ verdicts: [v("A3", "pass"), v("A5", "pass"), v("A6", "fail", "client_only_storage"), v("A7", "fail", "runtime_error")], must: ["A3", "A5", "A6", "A7"] });
    const c2 = C.compareV2Reports(before, half);
    assert.deepEqual(c2.defects.persisting.map((d) => d.cls), ["client_only_storage"]);
    assert.deepEqual(c2.defects.resolved.map((d) => d.cls), ["timezone_date"]);
    assert.deepEqual(c2.defects.introduced.map((d) => d.cls), ["runtime_error"]);
  });
});

describe("고친 파일이 실제로 통과했나(G4) · 고리 끝", () => {
  it("지난번 고친 파일(검증 통과)을 반영한 뒤 그 기준이 통과/실패하는지", () => {
    const before = rep({ verdicts: [v("A3", "fail", "runtime_error"), v("A5", "fail", "client_only_storage")], fix: { attempted: true, validated: ["A3", "A5"], stillFailing: [] } });
    const after = rep({ verdicts: [v("A3", "pass"), v("A5", "fail", "client_only_storage")] });
    assert.deepEqual(C.compareV2Reports(before, after).fixLive, { delivered: ["A3", "A5"], passNow: ["A3"], stillFailing: ["A5"], notVerified: [] });
  });
  it("회차: 원 런 0 → 1, 1 → 2 · 모든 must 통과면 끝 · 최대 회차(기본 3)면 끝", () => {
    const before = rep({ verdicts: [v("A3", "fail", "x")] , must: ["A3"] });
    const passAll = rep({ verdicts: [v("A3", "pass")], must: ["A3"] });
    const still = rep({ verdicts: [v("A3", "fail", "x")], must: ["A3"] });
    assert.deepEqual(C.compareV2Reports(before, passAll).loop, { round: 1, allMustPass: true, done: true, reason: "all_must_pass" });
    assert.deepEqual(C.compareV2Reports(before, still).loop, { round: 1, allMustPass: false, done: false, reason: "continue" });
    assert.deepEqual(C.compareV2Reports(rep({ verdicts: [v("A3", "fail", "x")], must: ["A3"], round: 2 }), still).loop, { round: 3, allMustPass: false, done: true, reason: "max_rounds" });
  });
  it("v2가 아닌 쪽이 있으면 비교하지 않는다(v1 비교 agentComparison이 따로 있다)", () => {
    assert.equal(C.compareV2Reports({ engine: "agent", acTable: [] }, rep({ verdicts: [] })), null);
    assert.equal(C.compareV2Reports(rep({ verdicts: [] }), null), null);
  });
});

describe("같은 계획으로 다시(실행기)", () => {
  it("previousPlan을 주면 정적 사실이 달라져도 그 계획(가설·실험)을 그대로 쓰고, 재사용을 증거물에 남긴다", async () => {
    const { runAgentV2Inspection } = await import("../inspector-container/agent-v2-run.mjs");
    const { makeFakeDriver } = await import("./_agent-fakes.mjs");
    const AC = { id: "A3", title: "다른 손님은 같은 시간을 못 고른다", given: "예약이 있다", when: "새 브라우저", then: "그 시간은 막힌다", priority: "must", confirmed: true };
    const pl = await import("../dist/v2-plan.js");
    const previousPlan = pl.buildPlan({ acs: [AC], facts: [{ fact: { rule: "R2", cls: "client_only_storage", file: "/app.js", excerpt: "localStorage.setItem('b')" }, artifactId: "E2" }], nowKstHour: 12 });
    assert.equal(previousPlan.hypotheses.length, 1, "전제: 원 런 계획에는 가설 H1");
    const prompts = [];
    // 고친 뒤의 앱: 더 이상 localStorage를 쓰지 않는다(정적 사실 R2 없음) — 그래도 같은 계획(H1)으로 확인해야 한다.
    const out = await runAgentV2Inspection({
      targetUrl: "https://salon.example/", intent: "예약", acs: [AC], testDataSeed: 1, previousPlan,
      fetchImpl: async () => new Response("<!doctype html><html><body><h1>동네 미용실</h1></body></html>", { status: 200 }),
      driver: makeFakeDriver({ "/": { status: 200, text: "동네 미용실 예약", buttons: ["예약하기"] } }, { origin: "https://salon.example" }),
      llm: async ({ user }) => {
        prompts.push(user);
        return JSON.stringify({ thought: "t", action: { type: "judge", verdict: "not_verified", claim: "확인 못 함", artifactIds: [], quotes: [] } });
      },
    });
    assert.deepEqual(out.plan.hypotheses.map((h) => h.id + ":" + h.cls), ["H1:client_only_storage"]);
    assert.ok(prompts[0].includes(`- H1: ${previousPlan.hypotheses[0].statement}`), "원 런 가설이 프롬프트에 실린다");
    assert.ok(out.artifacts.artifacts.some((a) => a.kind === "context" && /재사용/.test(a.summary)), "계획 재사용이 증거물에 남는다");
  });
  it("계획 형식이 깨졌거나 기준이 다르면 새로 만든다", async () => {
    const { runAgentV2Inspection } = await import("../inspector-container/agent-v2-run.mjs");
    const { makeFakeDriver } = await import("./_agent-fakes.mjs");
    const AC = { id: "A9", title: "t", given: "g", when: "w", then: "t", priority: "must", confirmed: true };
    const out = await runAgentV2Inspection({
      targetUrl: "https://salon.example/", intent: "i", acs: [AC], testDataSeed: 1, previousPlan: { version: "v2-plan-1", hypotheses: [], acPlans: [{ acId: "A3" }], generatedFrom: {} },
      fetchImpl: async () => new Response("<!doctype html><html><body><h1>x 앱</h1></body></html>", { status: 200 }),
      driver: makeFakeDriver({ "/": { status: 200, text: "x" } }, { origin: "https://salon.example" }),
      llm: async () => JSON.stringify({ thought: "t", action: { type: "judge", verdict: "not_verified", claim: "x", artifactIds: [], quotes: [] } }),
    });
    assert.ok(!out.artifacts.artifacts.some((a) => /재사용/.test(a.summary)));
  });
});

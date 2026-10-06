/**
 * 검사 엔진 v2 · S3 — 가설·계획(계획은 증거물로 저장되고 재검사에 그대로 재사용, X-4).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const v2 = await import("../dist/agent-v2.js");

const ACS = [
  { id: "AC-1", title: "예약이 사장님 화면에 보인다", given: "", when: "", then: "", priority: "must", confirmed: true },
  { id: "AC-2", title: "가격이 원 단위", given: "", when: "", then: "", priority: "should", confirmed: false },
];

describe("S3 시작 가설(결정론, 일반 규칙)", () => {
  it("스냅샷: 기기에만 저장 · 자리표시자 · UTC 날짜 · 난수 · 브라우저 직통 AI · 의도 불일치(항상)", () => {
    const facts = v2.extractStaticFacts([
      {
        url: "https://a.app/index.js",
        text: [
          'localStorage.setItem("bookings", x)',
          'createClient("https://YOUR_PROJECT.supabase.co")',
          "new Date().toISOString().slice(0, 10)",
          "Math.random() * 5",
          'fetch("https://api.anthropic.com/v1/messages")',
        ].join("\n"),
      },
    ]);
    const hs = v2.seedHypotheses(facts);
    assert.deepEqual(
      hs.map((h) => [h.id, h.basis ?? null]),
      [
        // 자리표시자 백엔드는 백엔드가 아니다 → 기기에만 저장 가설도 선다.
        ["H1", "local_storage_key:bookings"],
        ["H2", "placeholder_config:YOUR_PROJECT"],
        ["H3", "utc_date:toISOString().slice(0, 10)"],
        ["H4", "random_result:Math.random() *"],
        ["H5", "external_endpoint:https://api.anthropic.com/v1/messages"],
        ["H6", null],
      ],
    );
    assert.match(hs.at(-1).risk, /different job/);
  });
  it("백엔드가 없고 localStorage만 쓰면 '이 기기에만' 가설이 먼저", () => {
    const hs = v2.seedHypotheses(v2.extractStaticFacts([{ url: "u", text: 'localStorage.getItem("salon")' }]));
    assert.match(hs[0].risk, /only in this browser/);
    assert.match(hs[0].test, /new_context/);
  });
  it("사실이 없어도 의도 불일치 가설은 늘 있다(X-1)", () => {
    assert.equal(v2.seedHypotheses([]).length, 1);
  });
});

describe("S3 계획 정리 · 저장 · 재사용", () => {
  it("모르는 기준·중복은 버리고, 계획이 빠진 must를 알려 준다", () => {
    const { plan, missingMust } = v2.normalizePlan(
      { hypotheses: [{ risk: "r", test: "t" }], items: [{ acId: "AC-2", steps: ["가격 보기"], probes: [] }, { acId: "AC-9", steps: ["x"], probes: [] }] },
      ACS,
    );
    assert.deepEqual(plan.items.map((i) => i.acId), ["AC-2"]);
    assert.deepEqual(missingMust, ["AC-1"]);
    assert.equal(plan.hypotheses[0].id, "H1");
  });
  it("리포트에 실린 계획을 재검사가 그대로 꺼낸다(v2 리포트만)", () => {
    const plan = { hypotheses: [{ id: "H1", risk: "기기에만 저장", test: "새 브라우저" }], items: [{ acId: "AC-1", steps: ["예약", "관리 화면"], probes: ["새 브라우저에서 관리 화면"] }] };
    const json = JSON.stringify({ engine: "agent", engineVersion: "v2", agent: { v2: { plan } } });
    assert.deepEqual(v2.v2PlanFromReport(json), plan);
    assert.equal(v2.v2PlanFromReport(JSON.stringify({ engine: "agent", agent: { v2: { plan } } })), null, "v1 리포트는 계획이 없다");
    assert.equal(v2.wasAgentV2Report(json), true);
    assert.equal(v2.wasAgentV2Report(JSON.stringify({ engine: "agent" })), false);
  });
  it("첫 메시지에 기준·정적 사실·가설·(재검사면) 이전 계획이 실린다", () => {
    const text = v2.v2Kickoff({
      targetUrl: "https://a.app/",
      intent: "동네 미용실 예약",
      acs: ACS,
      landing: { status: 200 },
      loginNote: "none",
      facts: [],
      hypotheses: v2.seedHypotheses([]),
      sourceArtifactId: "ev-2",
      priorPlan: { hypotheses: [], items: [{ acId: "AC-1", steps: ["예약"], probes: ["새 브라우저"] }] },
    });
    assert.match(text, /\[AC-1\] \(must, confirmed by the owner\)/);
    assert.match(text, /RE-CHECK/);
    assert.match(text, /새 브라우저/);
  });
  it("도구 정의는 strict 함수 도구이고 record_verdict는 의도 판정(mismatch)을 받는다", () => {
    const names = v2.V2_TOOLS.map((t) => t.name);
    for (const n of ["observe", "network_log", "storage_dump", "read_source", "grep_source", "console_errors", "new_context", "set_clock", "set_viewport", "record_plan", "record_verdict", "finish"]) assert.ok(names.includes(n), n);
    const rv = v2.V2_TOOLS.find((t) => t.name === "record_verdict");
    assert.deepEqual(rv.parameters.properties.verdict.enum, ["pass", "fail", "not_verified", "mismatch"]);
    for (const t of v2.V2_TOOLS) assert.deepEqual(t.parameters.required, Object.keys(t.parameters.properties), `${t.name}: strict는 모든 속성 required`);
  });
});

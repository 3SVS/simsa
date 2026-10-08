/**
 * 만든 AI의 자기 설명(Builder self-report, Bae 2026-10-09):
 *   파싱(Zod) · 비밀 지우기 · 주장 → 가설 · "설명 vs 실제"에서 다름은 증거물이 있어야만(주장은 증거가 아니다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const sr = await import("../dist/workspace/builder-self-report.js");
const v2 = await import("../dist/agent-v2.js");
const { runAgentV2 } = await import("../inspector-container/agent-v2-run.mjs");
const { createApp } = await import("../dist/router.js");

const FAKE_OPENAI = "sk-proj-" + "x".repeat(40);
const ANSWER = `1) 동네 미용실 예약 앱. 손님이 예약하고 사장님이 오늘 예약을 봐요.
2) 예약 화면은 실제로 동작. 가격표는 예시 데이터예요.
3) 예약은 Supabase 공용 DB에 저장돼요. OPENAI_API_KEY=${FAKE_OPENAI}
4) 취소 기능은 시험 안 해 봤어요.
5) 사장님은 /admin에서 이메일로 로그인. 비밀번호: hunter2-secret`;

describe("비밀 지우기 — 원문 값이 남지 않는다", () => {
  it("API 키·비밀번호 줄을 지우고 지운 개수를 센다", () => {
    const { text, removed } = sr.scrubSelfReport(ANSWER);
    assert.ok(!text.includes(FAKE_OPENAI));
    assert.ok(!text.includes("hunter2-secret"));
    assert.ok(removed >= 2);
    assert.match(text, /Supabase 공용 DB/, "나머지 내용은 그대로");
  });
  it("요청 경계: 런 요청의 builderReport도 같은 스키마로 다시 검사하고 비밀을 다시 지운다", () => {
    const r = sr.sanitizeBuilderReport({ intent: "예약 앱", claims: [{ id: "C1", kind: "storage", text: `DB 키 ${FAKE_OPENAI}` }], access: { loginMethod: "이메일", testAccountHow: "" } });
    assert.ok(!JSON.stringify(r).includes(FAKE_OPENAI));
    assert.equal(sr.sanitizeBuilderReport({ intent: "x", claims: [{ id: "bad", kind: "works", text: "t" }] }), null, "모르는 모양은 거절");
    assert.equal(sr.sanitizeBuilderReport({ intent: "x", claims: [{ id: "C1", kind: "evidence", text: "t" }] }), null);
  });
  it("질문 원문 KO/EN 고정(5문항, 비밀번호 적지 말라)", () => {
    assert.match(sr.BUILDER_SELF_REPORT_PROMPT.ko, /^이 앱을 다른 검수자가 확인하려고 해/);
    assert.match(sr.BUILDER_SELF_REPORT_PROMPT.ko, /5\) 로그인 방법과 시험용 계정을 만드는 방법\(비밀번호는 적지 마\)/);
    assert.match(sr.BUILDER_SELF_REPORT_PROMPT.en, /do not write any password/);
  });
});

describe("파싱 — LLM 추출 + Zod, 실패는 정직하게", () => {
  const extracted = { intent: "동네 미용실 예약", users: ["손님", "사장님"], mustFlows: ["예약하면 사장님 화면에 보인다"], claims: [{ id: "C1", kind: "storage", text: "예약은 Supabase 공용 DB에 저장" }, { id: "C2", kind: "fake", text: "가격표는 예시 데이터" }, { id: "C3", kind: "untested", text: "취소는 시험 안 함" }], access: { loginMethod: "/admin 이메일 로그인", testAccountHow: "" } };
  async function withFetch(reply, fn) {
    const orig = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (_u, init) => {
      sent.push(init?.body ? String(init.body) : "");
      return new Response(JSON.stringify({ content: [{ type: "text", text: reply }], model: "claude-haiku-4-5-20251001", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    };
    try {
      return { result: await fn(), sent };
    } finally {
      globalThis.fetch = orig;
    }
  }
  it("정상: 구조 + 지운 비밀 수, LLM에는 지운 뒤 글만 간다", async () => {
    const { result, sent } = await withFetch(JSON.stringify(extracted), () => sr.parseBuilderSelfReport(ANSWER, "ko", "test-key"));
    assert.equal(result.ok, true);
    assert.equal(result.report.claims.length, 3);
    assert.ok(result.removedSecrets >= 2);
    assert.ok(sent.every((b) => !b.includes(FAKE_OPENAI) && !b.includes("hunter2-secret")), "비밀은 LLM으로도 가지 않는다");
  });
  it("모양이 틀리면 unparseable(지어낸 구조 없음), 글이 비면 empty", async () => {
    const { result } = await withFetch('{"intent":""}', () => sr.parseBuilderSelfReport(ANSWER, "ko", "test-key"));
    assert.deepEqual([result.ok, result.error], [false, "unparseable"]);
    assert.equal((await sr.parseBuilderSelfReport("짧음", "ko", "k")).error, "empty");
  });
  it("라우트: 키 없으면 503 llm_unavailable, 응답에 비밀 없음", async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}), all: async () => ({ results: [] }) }) }) } };
    const res = await createApp().request("/workspace/builder-self-report", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.trysimsa.com" }, body: JSON.stringify({ text: ANSWER }) }, env);
    const text = await res.text();
    assert.ok([503, 429].includes(res.status), `status ${res.status}`);
    assert.ok(!text.includes(FAKE_OPENAI));
  });
});

describe("주장 → 가설 · 설명 vs 실제(다름은 증거물로만)", () => {
  const claims = [{ id: "C1", kind: "storage", text: "예약은 Supabase 공용 DB에 저장" }, { id: "C2", kind: "fake", text: "가격표는 예시" }];
  it("주장마다 가설(판정 id CLAIM-Cn) · 확인 방법이 종류별", () => {
    const hs = v2.claimHypotheses(claims);
    assert.deepEqual(hs.map((h) => h.id), ["CLAIM-C1", "CLAIM-C2"]);
    assert.match(hs[0].test, /storage_dump|network_log/);
    assert.match(v2.builderReportBlock({ intent: "예약", mustFlows: [], claims, access: { loginMethod: "", testAccountHow: "" } }), /CLAIMS, not evidence/);
  });
  it("검증기: 주장 '다름'은 처음 화면만으로는 거절, 저장소 증거물 + 핵심 값이 있어야 받는다", () => {
    const s = new v2.EvidenceStore();
    const landing = s.add("screen", "observe", { summary: "첫 화면", raw: "동네 미용실 예약" });
    const j = { acId: "CLAIM-C1", verdict: "mismatch", claim: "예약이 브라우저 저장소에만 있고 서버로 가는 요청이 없다", artifactIds: [landing.id], quotes: ["동네 미용실"] };
    assert.equal(v2.validateV2Verdict(j, undefined, s).problem, "no_hard_artifact");
    s.noteAction("fill");
    s.noteAction("click");
    const st = s.add("storage", "storage_dump", { summary: "저장소: salon-bookings (바뀜)", raw: 'localStorage:\n  salon-bookings (40 chars): [{"name":"심사테스트"}]', stateChange: true });
    assert.equal(v2.validateV2Verdict({ ...j, artifactIds: [st.id], quotes: ["salon-bookings"] }, undefined, s).accept, true);
    assert.equal(v2.validateV2Verdict({ ...j, verdict: "fail" }, undefined, s).problem, "verdict_on_intent");
  });
});

describe("실행기 — 자기 설명이 가설로 들어가고 '다름'은 고칠 것", () => {
  const ORIGIN = "https://salon.example";
  function driver() {
    let saved = false;
    const text = () => (saved ? "예약 완료 심사테스트" : "동네 미용실 예약\n이름\n예약하기");
    return {
      async start() {},
      async goto(u) { saved = false; return { status: 200, url: u }; },
      url: () => ORIGIN + "/",
      async bodyText() { return text(); },
      async html() { return text(); },
      async screenshot(n) { return { name: n, path: n }; },
      async listSources() { return [ORIGIN + "/"]; },
      async readSourceText() { return { ok: true, status: 200, url: ORIGIN + "/", text: 'localStorage.setItem("salon-bookings", x)' }; },
      async signature() { return text(); },
      async observe() { return { url: ORIGIN + "/", title: "", aria: "", text: text(), networkErrors: [], consoleErrors: [], hasPasswordField: false }; },
      async links() { return []; },
      async act(a) { if (a.type === "click") saved = true; return { ok: true, note: "ok" }; },
      netLog() { return []; },
      async storageDump() { return { local: saved ? [{ key: "salon-bookings", size: 30, preview: '[{"name":"심사테스트"}]' }] : [], session: [], indexedDB: [], cookies: [] }; },
      consoleErrorList: () => [],
      async newContextAt(u) { return this.goto(u); },
      async close() {},
    };
  }
  it("주장 'Supabase 공용 DB' vs 저장소만 → 표에 differs + builder_claim_contradicted(증거물 인용) + 빌더팩", async () => {
    let i = 0;
    let firstInput = null;
    const T = (o) => ({ role: null, name: null, label: null, placeholder: null, text: null, ...o });
    const turns = [
      () => [["record_plan", { hypotheses: [], items: [{ acId: "CORE-1", steps: ["예약"], probes: [] }] }]],
      () => [["fill", { target: T({ label: "이름" }), value: "심사테스트" }], ["click", { target: T({ role: "button", name: "예약하기" }) }]],
      () => [["storage_dump", {}], ["network_log", { filter: null, last: 20 }]],
      ({ evOf }) => [
        ["record_verdict", { acId: "CLAIM-C1", verdict: "mismatch", claim: "예약이 이 브라우저 저장소(salon-bookings)에만 있고 서버로 보내는 요청이 없습니다", artifactIds: [evOf(/storage/), evOf(/요청|request/)], quotes: ["salon-bookings"], reasonCode: null, cause: null }],
        ["record_verdict", { acId: "CLAIM-C2", verdict: "not_verified", claim: "", artifactIds: [], quotes: [], reasonCode: null, cause: null }],
        ["record_verdict", { acId: "INTENT", verdict: "pass", claim: "예약 앱", artifactIds: [evOf(/storage/)], quotes: ["salon-bookings"], reasonCode: null, cause: null }],
      ],
      () => [["finish", { note: "" }]],
      () => [["finish", { note: "" }]],
    ];
    const llm = async ({ input }) => {
      firstInput ??= input[0].content;
      const outs = input.filter((x) => x.type === "function_call_output").map((x) => x.output);
      const evOf = (re) => [...outs].reverse().map((o) => (re.test(o) ? /^(ev-\d+)/.exec(o)?.[1] : null)).find(Boolean);
      const t = turns[i++];
      return { model: "claude-fable-5-1", output: t ? t({ evOf }).map(([name, args], k) => ({ type: "function_call", call_id: `c${i}${k}`, name, arguments: JSON.stringify(args) })) : [] };
    };
    const r = await runAgentV2({
      targetUrl: ORIGIN + "/", intent: "동네 미용실 예약", locale: "ko", acs: [], acSource: "inferred_at_run", driver: driver(), llm, budgetMs: 120_000,
      builderReport: { intent: "예약", mustFlows: [], claims: [{ id: "C1", kind: "storage", text: "예약은 Supabase 공용 DB에 저장" }, { id: "C2", kind: "fake", text: "가격표는 예시" }], access: { loginMethod: "", testAccountHow: "" } },
    });
    assert.match(firstInput, /CLAIM-C1 \[storage\]/, "주장이 첫 메시지에 가설로");
    const rows = r.report.builderClaims;
    assert.deepEqual(rows.map((x) => [x.id, x.result]), [["C1", "differs"], ["C2", "not_verified"]]);
    const f = r.report.findings.find((x) => x.code === "builder_claim_contradicted");
    assert.ok(f, "다름은 고칠 것");
    assert.match(f.evidence, /CLAIM-C1 \| 저장소: salon-bookings/);
    assert.match(r.agentPrompt, /만든 AI의 설명과 실제가 달라요/);
  });
});

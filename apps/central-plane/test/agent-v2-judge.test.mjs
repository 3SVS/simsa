/**
 * 검사 엔진 v2 · S5 — 확인·판정·의도 불일치(V-3·V-7·X-1).
 *   ① Bolt형: "AI 앱을 자동 점검" 의도인데 앱은 사용자가 스스로 체크하는 목록(대상 주소로 요청 0건) → "생각과 달라요"(독립 판정)
 *   ② Lovable형: 소개 문구("자동으로 점검해 결과를 안내합니다")로 must 통과 시도 → 실행기가 끝까지 거절 → 확인 못 함
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAgentV2 } = await import("../inspector-container/agent-v2-run.mjs");
const { buildAgentAcFixPrompt } = await import("../dist/agent-inspection.js");

const ORIGIN = "https://checker.example";
const T = (o) => ({ role: null, name: null, label: null, placeholder: null, text: null, ...o });

/** 자가 점검표 앱: 주소 입력 → "점검 시작" → 체크 항목 목록이 뜰 뿐, 대상 주소로 아무 요청도 없다. */
function checklistDriver() {
  let started = false;
  let url = "";
  const net = [];
  const src = 'const ITEMS=["화면이 열리나요?","버튼이 눌리나요?","저장이 되나요?"]; function start(u){ setUrl(u); setItems(ITEMS) } // 요청 없음';
  const text = () => (started ? `점검 목록 (${url})\n☐ 화면이 열리나요?\n☐ 버튼이 눌리나요?\n☐ 저장이 되나요?` : "AI 앱 자동 점검\nAI가 만든 앱을 자동으로 점검해 결과를 안내합니다\n앱 주소\n점검 시작");
  return {
    async start() {},
    async goto(u) {
      started = false;
      return { status: 200, url: u };
    },
    url: () => ORIGIN + "/",
    async bodyText() {
      return text();
    },
    async html() {
      return `<script src="/main.js"></script>${text()}`;
    },
    async screenshot(n) {
      return { name: `screenshots/${n}`, path: `/tmp/${n}` };
    },
    async listSources() {
      return [ORIGIN + "/", ORIGIN + "/main.js"];
    },
    async readSourceText(u) {
      return u.endsWith("/main.js") ? { ok: true, status: 200, url: ORIGIN + "/main.js", text: src } : { ok: true, status: 200, url: ORIGIN + "/", text: "<html></html>" };
    },
    async signature() {
      return text();
    },
    async observe() {
      return { url: ORIGIN + "/", title: "점검", aria: "", text: text(), networkErrors: [], consoleErrors: [], hasPasswordField: false };
    },
    async links() {
      return [];
    },
    async act(a) {
      if (a.type === "fill") url = a.value;
      if (a.type === "click") started = true;
      return { ok: true, note: "ok" };
    },
    netLog() {
      return net;
    },
    async storageDump() {
      return { local: [], session: [], indexedDB: [], cookies: [] };
    },
    consoleErrorList: () => [],
    async newContextAt(u) {
      return this.goto(u);
    },
    async close() {},
  };
}

function scripted(turns) {
  let i = 0;
  return async ({ input }) => {
    const outs = input.filter((x) => x.type === "function_call_output").map((x) => x.output);
    const evOf = (re) => [...outs].reverse().map((o) => (re.test(o) ? /^(ev-\d+)/.exec(o)?.[1] : null)).find(Boolean);
    const turn = turns[i++];
    if (!turn) return { output: [], model: "claude-fable-5-1" };
    return { model: "claude-fable-5-1", output: turn({ evOf, outs }).map(([name, args], k) => ({ type: "function_call", call_id: `c${i}_${k}`, name, arguments: JSON.stringify(args) })) };
  };
}

const MUST = [{ id: "AC-001", title: "주소를 넣으면 앱을 자동으로 점검해 고장을 알려 준다", given: "점검 화면", when: "앱 주소를 넣고 점검을 시작한다", then: "앱을 실제로 열어 본 결과(작동/고장과 원인)가 나온다", priority: "must", confirmed: true, origin: "user_text" }];
const PLAN = ["record_plan", { hypotheses: [{ risk: "자가 점검표일 수 있다", test: "대상 주소로 요청이 가는가" }], items: [{ acId: "AC-001", steps: ["주소 입력", "점검 시작", "요청 확인"], probes: ["다른 주소로 결과가 바뀌는가"] }, { acId: "CORE-1", steps: ["점검"], probes: [] }] }];

describe("S5 의도 불일치(Bolt형) — 독립 판정 · 증거 인용 · 고칠 것", () => {
  it("대상으로 요청 0건 + 고정 체크 목록 소스 → '생각과 달라요', Needs Fix, 고칠 것·원인 코드", async () => {
    const llm = scripted([
      () => [PLAN],
      () => [["fill", { target: T({ label: "앱 주소" }), value: "https://salon.example.app/" }], ["click", { target: T({ role: "button", name: "점검 시작" }) }]],
      () => [["network_log", { filter: null, last: 40 }], ["grep_source", { pattern: "ITEMS" }]],
      ({ evOf }) => [
        ["record_verdict", { acId: "INTENT", verdict: "mismatch", claim: "주소를 넣어도 그 앱을 열어 보지 않고(요청 0건), 사용자가 직접 체크하는 고정 질문 목록만 보여 줍니다.", artifactIds: [evOf(/request/), evOf(/ITEMS=/)], quotes: ["화면이 열리나요?"], reasonCode: null, cause: { file: "main.js", where: "start", snippet: 'const ITEMS=["화면이 열리나요?","버튼이 눌리나요?","저장이 되나요?"]', explanation: "점검 결과 대신 고정 질문 목록을 띄웁니다" } }],
      ],
      () => [["finish", { note: "" }]],
      () => [["finish", { note: "" }]],
    ]);
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "비개발자가 만든 앱을 자동으로 점검해 고장과 원인을 알려 주는 서비스", locale: "ko", acs: MUST, acSource: "confirmed_inferred", driver: checklistDriver(), llm, budgetMs: 120_000 });
    assert.equal(r.decision, "Needs Fix");
    assert.equal(r.report.verdict, "생각과 달라요");
    assert.equal(r.report.agent.basis, "intent_mismatch");
    const f = r.report.findings[0];
    assert.equal(f.code, "intent_mismatch");
    assert.match(f.why, /요청 0건/);
    assert.match(f.why, /코드에서 찾은 원인/);
    assert.match(f.evidence, /main\.js · start/);
    assert.ok(r.report.agent.defects.some((d) => d.defectClass === "intent_mismatch"));
    assert.equal(r.report.agent.v2.citation.pct, 100);
    assert.ok(r.agentPrompt.length > 0, "고칠 것(빌더팩)이 반드시 나온다 — X-3");
    assert.match(buildAgentAcFixPrompt(r.report, "ko"), /생각과 달라요|다른 일/);
    assert.ok(!/HTTP|console|stack|DOM/.test(`${r.report.oneLine} ${f.what} ${f.how}`), "비개발자 문장 — X-2");
  });
});

describe("S5 소개 문구 통과 금지(Lovable형)", () => {
  it("소개 문구만으로 must 통과를 세 번 시도 → 전부 거절 → 확인 못 함(evidence_missing), '작동해요'가 아님", async () => {
    const pass = ({ evOf }) => [["record_verdict", { acId: "AC-001", verdict: "pass", claim: "자동으로 점검해 결과를 안내한다고 소개되어 있습니다", artifactIds: [evOf(/screen/)], quotes: ["결과를 안내합니다"], reasonCode: null, cause: null }]];
    const llm = scripted([() => [PLAN], () => [["observe", { screenshot: false }]], pass, pass, pass, () => [["finish", { note: "" }]], () => [["finish", { note: "" }]]]);
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "앱 자동 점검", locale: "ko", acs: MUST, acSource: "confirmed_inferred", driver: checklistDriver(), llm, budgetMs: 120_000 });
    const row = r.report.acTable.find((x) => x.id === "AC-001");
    assert.equal(row.status, "not_verified");
    assert.equal(row.reasonCode, "evidence_missing");
    assert.notEqual(r.decision, "Ready");
    assert.notEqual(r.decision, "Conditionally Ready");
  });
});

describe("실서비스 안전 — 사람에게 메시지를 보내는 제출은 하지 않는다(2026-10-08 daehwa bake-off 사고)", () => {
  it("문의 칸을 채운 뒤 '제출'·엔터·'문의 보내기' 모두 거절, 드라이버에 닿지 않는다", async () => {
    const d = checklistDriver();
    const acted = [];
    const origAct = d.act.bind(d);
    d.act = async (a) => {
      acted.push(a);
      return origAct(a);
    };
    const llm = scripted([
      () => [PLAN],
      () => [["fill", { target: T({ label: "궁금한 점을 적어주세요" }), value: "심사테스트 문의" }]],
      () => [["click", { target: T({ role: "button", name: "제출" }) }], ["press", { key: "Enter", target: T({}) }], ["click", { target: T({ role: "button", name: "문의 보내기" }) }]],
      () => [["finish", { note: "" }]],
      () => [["finish", { note: "" }]],
    ]);
    await runAgentV2({ targetUrl: ORIGIN + "/", intent: "x", locale: "ko", acs: MUST, acSource: "confirmed_inferred", driver: d, llm, budgetMs: 60_000 });
    assert.deepEqual(acted.map((a) => a.type), ["fill"], "제출 행동은 드라이버에 닿지 않는다");
  });
});

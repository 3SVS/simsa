/**
 * 검사 엔진 v2 · S6 — 고치기: 한 파일 앱의 고친 파일 + 원 계획으로 재실행해 **통과한 기준만** 고쳐짐(설계 §2.2-7, X-3).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAgentV2 } = await import("../inspector-container/agent-v2-run.mjs");

const ORIGIN = "https://memo.example";
const BROKEN = `<!doctype html><html><body><h1>메모</h1><input id="m"><button id="add">추가</button><ul id="list"></ul><script>
  const items = [];
  document.getElementById("add").addEventListener("click", () => { items.push(document.getElementById("m").value); render(); });
  function render(){ document.getElementById("list").innerHTML = items.map(t => "<li>"+t+"</li>").join(""); }
  // 저장하지 않는다 — 새로고침하면 사라진다
</script></body></html>`;

/** 한 파일 메모 앱: 원본은 저장 안 함, 고친 파일(localStorage)이 끼워지면 다시 열어도 남는다. */
function memoDriver() {
  let override = null;
  let shown = [];
  let saved = [];
  let typed = "";
  const persists = () => Boolean(override && override.includes("localStorage.setItem"));
  const text = () => `메모\n${shown.join("\n") || "(비어 있음)"}`;
  const net = [];
  return {
    calls: { serve: [] },
    async start() {},
    async goto(u) {
      shown = persists() ? [...saved] : [];
      return { status: 200, url: u };
    },
    url: () => ORIGIN + "/",
    async bodyText() {
      return text();
    },
    async html() {
      return override ?? BROKEN;
    },
    async fetchSource() {
      return BROKEN;
    },
    async serveOverride(_u, html) {
      this.calls.serve.push(html ? "on" : "off");
      override = html;
      shown = [];
    },
    async screenshot(n) {
      return { name: `screenshots/${n}`, path: `/tmp/${n}` };
    },
    async listSources() {
      return [ORIGIN + "/"];
    },
    async readSourceText() {
      return { ok: true, status: 200, url: ORIGIN + "/", text: override ?? BROKEN };
    },
    async signature() {
      return text();
    },
    async observe() {
      return { url: ORIGIN + "/", title: "메모", aria: "", text: text(), networkErrors: [], consoleErrors: [], hasPasswordField: false };
    },
    async links() {
      return [];
    },
    async act(a) {
      if (a.type === "fill") typed = a.value;
      if (a.type === "click") {
        shown.push(typed);
        if (persists()) saved.push(typed);
      }
      if (a.type === "reload") shown = persists() ? [...saved] : [];
      return { ok: true, note: "ok" };
    },
    netLog() {
      return net;
    },
    async storageDump() {
      return { local: persists() && saved.length ? [{ key: "memos", size: 20, preview: JSON.stringify(saved) }] : [], session: [], indexedDB: [], cookies: [] };
    },
    consoleErrorList: () => [],
    async newContextAt(u) {
      return this.goto(u);
    },
    async close() {},
  };
}

const T = (o) => ({ role: null, name: null, label: null, placeholder: null, text: null, ...o });
const MUST = [{ id: "AC-001", title: "메모를 추가하면 다시 열어도 남는다", given: "메모 화면", when: "메모를 추가하고 다시 연다", then: "추가한 메모가 남아 있다", priority: "must", confirmed: true, origin: "user_checked" }];
const PLAN = ["record_plan", { hypotheses: [{ risk: "저장 안 함", test: "새 브라우저" }], items: [{ acId: "AC-001", steps: ["추가", "새 브라우저"], probes: [] }, { acId: "CORE-1", steps: ["추가"], probes: [] }] }];

/** 판정을 실제 관찰에 맞춰 내는 대본 모델 — 바깥 런(실패)·고친 파일 제안·안쪽 검증 런(통과)을 다 돈다. */
function adaptiveModel({ edit }) {
  const state = new WeakMap();
  return async ({ input, tools }) => {
    if (tools.some((t) => t.name === "propose_edits")) {
      return { model: "claude-fable-5-1", output: [{ type: "function_call", call_id: "fx", name: "propose_edits", arguments: JSON.stringify({ edits: [edit], cannotFix: [] }) }] };
    }
    const outs = input.filter((x) => x.type === "function_call_output").map((x) => x.output);
    const step = outs.length;
    const evOf = (re) => [...outs].reverse().map((o) => (re.test(o) ? /^(ev-\d+)/.exec(o)?.[1] : null)).find(Boolean);
    void state;
    const call = (calls) => ({ model: "claude-fable-5-1", output: calls.map(([name, args], k) => ({ type: "function_call", call_id: `c${step}_${k}_${Math.random().toString(36).slice(2, 6)}`, name, arguments: JSON.stringify(args) })) });
    if (!outs.some((o) => /plan saved/.test(o))) return call([PLAN]);
    if (!outs.some((o) => /this was a submit/.test(o))) return call([["fill", { target: T({ label: "메모" }), value: "심사테스트 메모" }], ["click", { target: T({ role: "button", name: "추가" }) }]]);
    if (!outs.some((o) => /\(context/.test(o))) return call([["new_context", { url: ORIGIN + "/", timezone: null }]]);
    const ctxOut = [...outs].reverse().find((o) => /\(context/.test(o));
    const kept = /심사테스트 메모/.test(ctxOut);
    if (!kept && outs.filter((o) => /\(context/.test(o)).length < 2) return call([["new_context", { url: ORIGIN + "/", timezone: null }]]);
    if (outs.some((o) => /Verdict accepted: AC-001/.test(o))) return call([["finish", { note: "" }]]);
    const ctxIds = outs.filter((o) => /\(context/.test(o)).map((o) => /^(ev-\d+)/.exec(o)[1]);
    const v = kept
      ? { acId: "AC-001", verdict: "pass", claim: "추가한 메모가 새 브라우저에서도 남아 있다", artifactIds: [evOf(/this was a submit/), evOf(/\(context/), evOf(/storage|memos/) ?? evOf(/\(context/)], quotes: ["심사테스트 메모"], reasonCode: null, cause: null }
      : { acId: "AC-001", verdict: "fail", claim: "메모를 추가해도 저장되지 않아 새 브라우저에서는 사라진다", artifactIds: ctxIds, quotes: ["(비어 있음)"], reasonCode: null, cause: null };
    return call([["record_verdict", v], ["record_verdict", { acId: "INTENT", verdict: "pass", claim: "메모 앱이다", artifactIds: [evOf(/this was a submit/)], quotes: ["메모"], reasonCode: null, cause: null }]]);
  };
}

const GOOD_EDIT = { search: "  // 저장하지 않는다 — 새로고침하면 사라진다", replace: '  localStorage.setItem("memos", JSON.stringify(items));' };

describe("S6 한 파일 고친 파일 — 원 계획 재실행으로 검증된 것만 고쳐짐", () => {
  it("저장 안 하는 메모 앱 → 실패 → 고친 파일 끼워 재실행 → AC-001 validated · correctedHtml · 원본 복구", async () => {
    const driver = memoDriver();
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "다시 열어도 남는 메모", acs: MUST, acSource: "confirmed_inferred", driver, llm: adaptiveModel({ edit: GOOD_EDIT }), budgetMs: 10 * 60_000 });
    assert.equal(r.report.acTable.find((x) => x.id === "AC-001").status, "fail", "원본은 실패");
    const fix = r.report.agent.singleFileFix;
    assert.deepEqual(fix.validated, ["AC-001"]);
    assert.match(fix.correctedHtml, /localStorage\.setItem\("memos"/);
    assert.match(fix.diff, /^@@ edit 1/);
    assert.deepEqual(driver.calls.serve, ["on", "off"], "검증 뒤 원본으로 되돌린다");
    assert.ok(r.report.notes.some((n) => /고친 index\.html/.test(n)));
    assert.ok(r.agentPrompt.length > 0, "빌더팩도 함께(X-3)");
  });

  it("편집이 파일에 없으면 고친 파일을 내놓지 않는다(지어낸 수정 금지)", async () => {
    const driver = memoDriver();
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "메모", acs: MUST, acSource: "confirmed_inferred", driver, llm: adaptiveModel({ edit: { search: "this text is not in the file", replace: "x" } }), budgetMs: 10 * 60_000 });
    const fix = r.report.agent.singleFileFix;
    assert.equal(fix.error, "edit_0_not_found");
    assert.equal(fix.correctedHtml, undefined);
    assert.deepEqual(driver.calls.serve, [], "끼워 넣지도 않는다");
  });
});

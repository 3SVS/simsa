// v2 S6c (2026-10-23) — 고치기(F): 한 파일 앱이면 실패 기준의 원인(S6a)과 재현 순서를 주고 정확한 편집만 받아, 고친 파일을
// 그 주소에 끼워 넣고 실패했던 기준을 v2 실행(검증기 + 재실행 확인 포함)으로 다시 돌린다. 확인된 통과만 "고쳐짐".
// 설계 §2.2-7 · S6 완료 증거 "수정본 재실행 통과 테스트".
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAgentV2Inspection } = await import("../inspector-container/agent-v2-run.mjs");
const { makeFakeDriver } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://calc.example";
const AC = { id: "CORE-1", title: "환율 계산", given: "앱을 연다", when: "원화를 넣고 계산한다", then: "달러 금액이 보인다", priority: "must", confirmed: true };
const BROKEN_LINE = "const rate = rates.USD; // 깨진 줄";
const HTML = `<!doctype html><html><body><h1>환율 계산기</h1><input id="krw"><button>계산하기</button><p id="out"></p><script>
function calc(){ const rates = undefined; ${BROKEN_LINE}
  document.getElementById('out').textContent = (Number(document.getElementById('krw').value) * rate).toFixed(2) + ' 달러';
}
document.querySelector('button').onclick = calc; /* 이 주석은 인라인 스크립트를 200자 넘게 만들어 한 파일 앱으로 보이게 한다 ......... */
</script></body></html>`;
const reply = (action) => JSON.stringify({ thought: "t", action });
const lastId = (prompt, re) => prompt.split("\n").filter((l) => re.test(l)).map((l) => /^(E\d+) ·/.exec(l)?.[1]).filter(Boolean).at(-1);

/** 계산 앱: 원본은 클릭하면 콘솔 오류·화면 그대로, 고친 파일(FIXED 포함)이 끼워져 있으면 달러 금액이 나온다. */
function calcDriver({ html = HTML } = {}) {
  const site = {
    "/": (s) => ({
      status: 200,
      text: `환율 계산기 계산하기 ${s.clicked && s.fixed ? "7.20 달러" : ""}`,
      buttons: ["계산하기"],
      consoleErrors: s.clicked && !s.fixed ? ["Uncaught TypeError: Cannot read properties of undefined (reading 'USD')\n    at calc (https://calc.example/:2:40)"] : [],
    }),
  };
  const onAct = (a, s) => {
    if (a.type === "click") s.clicked = true;
    return null;
  };
  const d = makeFakeDriver(site, { origin: ORIGIN, onAct });
  const baseNew = d.newSession.bind(d);
  d.newSession = async (url) => {
    d.state.clicked = false;
    return baseNew(url);
  };
  d.fetchSource = async () => html;
  d.serveOverride = async (_url, body) => {
    d.state.fixed = Boolean(body && body.includes("FIXED"));
    d.state.overrides = [...(d.state.overrides ?? []), body ? "on" : "off"];
  };
  return d;
}

/** 에이전트: 원본에선 fail(콘솔 오류 인용), 고친 파일에선 pass(달러 금액 + 화면 변화 인용). 고치기 요청엔 편집 JSON. */
function agent({ edits }) {
  let turns = 0;
  const calls = { fix: 0 };
  const llm = async ({ system, user }) => {
    if (/You fix single-file web apps/.test(system)) {
      calls.fix += 1;
      calls.fixPrompt = user;
      return JSON.stringify({ edits, cannotFix: [] });
    }
    turns += 1;
    if (!/Recent action results:\n"계산하기"/.test(user) && !/누르기 → ok/.test(user)) return reply({ type: "click", target: { role: "button", name: "계산하기" } });
    if (/7\.20 달러/.test(user)) {
      const scr = lastId(user, /screen\(same\) · .*7\.20 달러/);
      const diff = lastId(user, /diff\(changed\)/);
      return reply({ type: "judge", verdict: "pass", claim: "계산하면 달러 금액이 보인다", artifactIds: [diff, scr], quotes: ["7.20 달러"] });
    }
    const err = lastId(user, /console · Uncaught TypeError/);
    return reply({ type: "judge", verdict: "fail", claim: "계산하기를 눌러도 금액이 안 나오고 오류가 난다", artifactIds: [err], quotes: ["Uncaught TypeError"] });
  };
  return { llm, calls };
}

describe("고치기 — 한 파일 앱", () => {
  it("편집 적용 → 고친 파일을 끼워 실패 기준을 다시 돌려 확인된 pass면 validated + 고친 파일 · 원래 판정은 그대로 · 끼움은 되돌린다", async () => {
    const driver = calcDriver();
    const { llm, calls } = agent({ edits: [{ search: BROKEN_LINE, replace: "const rate = 0.00072; // FIXED" }] });
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "환율", acs: [AC], fetchImpl: async () => new Response(HTML, { status: 200 }), driver, llm, testDataSeed: 1 });
    assert.equal(out.verdicts[0].verdict, "fail", "원래 판정은 고침과 무관하게 그대로");
    assert.equal(out.decision, "Needs Fix");
    assert.equal(calls.fix, 1);
    assert.match(calls.fixPrompt, /runtime_error/, "원인 분류가 고침 요청에 실린다");
    assert.match(calls.fixPrompt, /calc\.example\/:2/, "원인 위치가 고침 요청에 실린다");
    assert.deepEqual(out.fix.validated, ["CORE-1"], JSON.stringify(out.fix));
    assert.deepEqual(out.fix.stillFailing, []);
    assert.match(out.fix.correctedHtml, /FIXED/);
    assert.match(out.fix.diff, /- const rate = rates\.USD/);
    assert.deepEqual(driver.state.overrides, ["on", "off"], "검증 뒤 원래 주소로 되돌린다");
  });

  it("검증 실행에는 원래 실행의 증거물이 보이지 않고, 다른 실행의 증거물을 인용한 판정은 기각된다 — 실측 F4(10-23): 옛 오류 로그를 인용해 첫 턴에 fail", async () => {
    const driver = calcDriver();
    const prompts = [];
    let originalErr = null;
    let phase = "inspect";
    const llm = async ({ system, user }) => {
      if (/You fix single-file web apps/.test(system)) {
        phase = "validate";
        return JSON.stringify({ edits: [{ search: BROKEN_LINE, replace: "const rate = 0.00072; // FIXED" }], cannotFix: [] });
      }
      if (phase === "inspect") {
        if (!/누르기 → ok/.test(user)) return reply({ type: "click", target: { role: "button", name: "계산하기" } });
        originalErr = lastId(user, /console · Uncaught TypeError/);
        return reply({ type: "judge", verdict: "fail", claim: "오류", artifactIds: [originalErr], quotes: ["Uncaught TypeError"] });
      }
      prompts.push(user);
      // 게으른 검증: 아무것도 안 하고 원래 실행의 오류 증거물을 인용
      return reply({ type: "judge", verdict: "fail", claim: "여전히 오류", artifactIds: [originalErr], quotes: ["Uncaught TypeError"] });
    };
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "환율", acs: [AC], fetchImpl: async () => new Response(HTML, { status: 200 }), driver, llm, testDataSeed: 1 });
    assert.ok(prompts.length > 0);
    assert.ok(prompts.every((p) => !/Uncaught TypeError/.test(p.slice(p.indexOf("Evidence so far"), p.indexOf("Recent action results")))), "원래 실행의 오류 증거물이 목록에 없다");
    assert.ok(prompts.some((p) => /cites_other_run/.test(p)), "다른 실행 인용은 기각 사유와 함께 되묻는다");
    assert.deepEqual(out.fix.stillFailing, ["CORE-1"]);
  });

  it("고친 파일로도 여전히 실패면 stillFailing, 고친 파일을 내주지 않는다", async () => {
    const driver = calcDriver();
    const { llm } = agent({ edits: [{ search: BROKEN_LINE, replace: "const rate = rates.USD; // still broken" }] });
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "환율", acs: [AC], fetchImpl: async () => new Response(HTML, { status: 200 }), driver, llm, testDataSeed: 1 });
    assert.deepEqual(out.fix.validated, []);
    assert.deepEqual(out.fix.stillFailing, ["CORE-1"]);
    assert.equal(out.fix.correctedHtml, undefined);
  });

  it("편집이 파일에 정확히 한 번 맞지 않으면 끼우지 않는다(잘린·지어낸 편집 거절)", async () => {
    const driver = calcDriver();
    const { llm } = agent({ edits: [{ search: "이 문장은 파일에 없다 ...", replace: "x" }] });
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "환율", acs: [AC], fetchImpl: async () => new Response(HTML, { status: 200 }), driver, llm, testDataSeed: 1 });
    assert.equal(out.fix.attempted, true);
    assert.ok(out.fix.error);
    assert.equal(driver.state.overrides, undefined, "끼워 넣지 않았다");
  });

  it("편집 없이 못 고치는 이유만 답하면(서버·DB 필요) 오류가 아니라 cannot_fix_in_single_file — 실측 F3·F6·F13", async () => {
    const driver = calcDriver();
    const { llm } = agent({ edits: [] });
    const wrapped = async (args) => (/You fix single-file web apps/.test(args.system) ? JSON.stringify({ edits: [], cannotFix: ["CORE-1: 서버가 필요합니다"] }) : llm(args));
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "환율", acs: [AC], fetchImpl: async () => new Response(HTML, { status: 200 }), driver, llm: wrapped, testDataSeed: 1 });
    assert.equal(out.fix.reason, "cannot_fix_in_single_file");
    assert.equal(out.fix.error, undefined);
    assert.deepEqual(out.fix.cannotFix, ["CORE-1: 서버가 필요합니다"]);
  });

  it("한 파일 앱이 아니면(번들 스크립트) 고치기를 하지 않는다", async () => {
    const bundled = '<!doctype html><html><body><h1>환율 계산기</h1><p>원화를 넣으면 달러로 바꿔 드려요</p><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>';
    const driver = calcDriver({ html: bundled });
    const { llm, calls } = agent({ edits: [] });
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "환율", acs: [AC], fetchImpl: async () => new Response(bundled, { status: 200 }), driver, llm, testDataSeed: 1 });
    assert.equal(calls.fix, 0);
    assert.deepEqual(out.fix, { attempted: false, reason: "not_single_file" });
  });
});

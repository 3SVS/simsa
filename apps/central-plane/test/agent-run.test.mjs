import { describe, it } from "node:test";
import assert from "node:assert/strict";

// agent 엔진 실행기(inspector-container/agent-run.mjs)를 가짜 브라우저·가짜 LLM으로 끝까지 돈다.
// 고정하는 것: 로그인 세 갈래 · 시험 계정이 LLM 프롬프트·리포트·고침 지시·위상 로그 어디에도 없음 ·
// 로그인 벽 = not_verified("로그인 필요") · 점검 상한(화면 25·버튼 60)·위험 버튼 미클릭 · 내 기록만 취소 ·
// 기준 추정(미확인) · 판정 사다리.

const { runAgentInspection } = await import("../inspector-container/agent-run.mjs");
const { makeFakeDriver, makeScriptedLlm } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://salon.example";
const USER = "owner@salon.kr";
const PASS = "s3cret-pw!9";

const acs = [
  { id: "AC-001", title: "예약하기", given: "예약 화면", when: "10:30 예약", then: "예약 완료 화면에 예약 내용이 보인다", priority: "must", confirmed: true },
  { id: "AC-002", title: "중복 예약 막기", given: "10:30 예약됨", when: "다른 손님", then: "10:30은 고를 수 없다", priority: "must", confirmed: true },
  { id: "AC-003", title: "사장님 오늘 예약", given: "예약 1건", when: "관리 화면", then: "오늘 예약 목록에 보인다", priority: "must", confirmed: true },
];

/** 예약을 이 브라우저 저장소에만 두는 앱(벤치마크 #1의 Claude·Gemini 앱과 같은 결함). 관리 화면은 비밀번호. */
function salonSite({ manyLinks = 0, buttons = [], buttonEffects = {} } = {}) {
  const extraLinks = Array.from({ length: manyLinks }, (_, i) => `/menu-${i}`);
  const site = {
    "/": (s) => ({
      status: 200,
      text: s.store.booking ? "동네 미용실 예약 10:30 예약됨 예약하기" : "동네 미용실 예약 10:30 예약 가능 예약하기",
      links: ["/", "/admin", "/logout", ...extraLinks],
      buttons: ["예약하기", "예약 삭제", ...buttons],
      buttonEffects,
    }),
    "/done": (s) => ({ status: 200, text: `예약이 완료되었어요 ${s.store.booking?.name ?? ""} 10:30` }),
    "/admin": (s) =>
      s.loggedIn
        ? { status: 200, text: `${USER} 님 환영합니다. 오늘 예약 없음` }
        : { status: 200, text: "관리자 로그인 비밀번호를 입력하세요", password: true },
  };
  for (const l of extraLinks) site[l] = { status: 200, text: `메뉴 ${l}`, links: extraLinks, buttons };
  return site;
}

function salonOnAct(action, state) {
  if (action.type === "click" && action.target.name === "예약하기" && state.fills.length > 0) {
    state.store.booking = { name: state.fills[0] };
    state.path = "/done";
  }
  return null;
}

const bookScript = [
  { type: "fill", target: { label: "이름" }, value: "$NAME" },
  { type: "click", target: { role: "button", name: "예약하기" } },
  { type: "judge", verdict: "pass", reason: "예약 완료 화면에 이름과 시간이 보였어요", evidenceQuote: "예약이 완료되었어요 $NAME 10:30" },
];

/** 기본 기준(핵심 일 끝까지): 입력 → 제출(상태 변화) → 새로고침(확인) → 근거 인용 통과. */
const coreScript = [
  { type: "fill", target: { label: "이름" }, value: "$NAME" },
  { type: "click", target: { role: "button", name: "예약하기" } },
  { type: "reload" },
  { type: "judge", verdict: "pass", reason: "새로고침해도 예약이 남아 있어요", evidenceQuote: "예약이 완료되었어요 $NAME 10:30" },
];

describe("agent 실행기 — 핵심 일을 해 보지 않은 통과는 '작동'이 아니다", () => {
  it("표시만 보고 통과한 must뿐이면 Not Verified(벤치마크 #1 run-1 반대 판정 재현 방지)", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "CORE-1": [{ type: "judge", verdict: "pass", reason: "예약 버튼이 보여요", evidenceQuote: "예약하기" }],
      "AC-001": [{ type: "judge", verdict: "pass", reason: "시간이 보여요", evidenceQuote: "10:30 예약 가능" }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [acs[0]], acSource: "interview", llm, driver });
    assert.equal(out.decision, "Not Verified");
    assert.equal(out.report.agent.basis, "core_goal_not_exercised");
    assert.notEqual(out.report.verdict, "정상 작동해요");
  });
});

describe("A2 탐침 · A3 판정 재확인", () => {
  it("probe_storage: 서버 쓰기 0 + 브라우저 저장소만 변함 → 근거로 인용해 fail 가능", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "CORE-1": [
        ...bookScript.slice(0, 2),
        { type: "probe_storage" },
        { type: "judge", verdict: "fail", reason: "예약이 이 브라우저에만 저장돼 다른 손님·사장님이 볼 수 없어요", evidenceQuote: "saved only in this browser" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], acSource: "interview", llm, driver });
    const core = out.report.acTable.find((r) => r.id === "CORE-1");
    assert.equal(core.status, "fail");
    assert.deepEqual(core.exercised, { stateChange: true, verified: true });
    assert.equal(out.decision, "Needs Fix");
  });
  it("두 번째 판단이 동의하지 않으면 pass도 fail도 결과로 치지 않는다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({ "CORE-1": coreScript }, { review: () => false });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], acSource: "interview", llm, driver });
    const core = out.report.acTable.find((r) => r.id === "CORE-1");
    assert.equal(core.status, "not_verified");
    assert.equal(core.reasonCode, "judge_disagreed");
    assert.notEqual(out.decision, "Ready");
  });
});

describe("agent 실행기 — 시험 계정 로그인 + 점검 + AC", () => {
  it("결함 있는 앱: Needs Fix, 실패 AC만 고침 지시, 비밀은 어디에도 없음", async () => {
    const driver = makeFakeDriver(salonSite({ manyLinks: 40, buttons: ["고장 버튼"], buttonEffects: { "고장 버튼": "error" } }), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-001": bookScript,
      "AC-002": [
        ...bookScript.slice(0, 2),
        { type: "new_session" },
        { type: "judge", verdict: "fail", reason: "다른 손님 화면에서 10:30이 여전히 예약 가능해요", evidenceQuote: "10:30 예약 가능" },
      ],
      "AC-003": [
        ...bookScript.slice(0, 2),
        { type: "login" },
        { type: "goto", path: "/admin" },
        { type: "judge", verdict: "fail", reason: "관리 화면에 오늘 예약이 없어요", evidenceQuote: "오늘 예약 없음" },
      ],
    });
    const phases = [];
    const out = await runAgentInspection({
      targetUrl: ORIGIN + "/", intent: "동네 미용실 예약", locale: "ko", budgetMs: 120_000,
      acs, acSource: "confirmed_inferred", loginMode: "credentials", credentials: { username: USER, password: PASS },
      llm, driver, onPhase: (l) => phases.push(l),
    });
    assert.equal(out.decision, "Needs Fix");
    assert.equal(out.works, false);
    assert.deepEqual(out.report.acTable.map((r) => [r.id, r.status]), [["CORE-1", "not_verified"], ["AC-001", "pass"], ["AC-002", "fail"], ["AC-003", "fail"]]);
    assert.equal(out.report.agent.loginMethod, "credentials");
    assert.equal(out.report.agent.testData.names.length, 2, "C8: 남겼을 수 있는 시험 기록 표지");
    assert.ok(out.report.notes.some((n) => n.includes("시험 기록")));
    assert.match(out.agentPrompt, /AC-002/);
    assert.match(out.agentPrompt, /AC-003/);
    assert.doesNotMatch(out.agentPrompt, /\[AC-001/);
    // 점검 상한·안전
    assert.ok(out.report.sweep.screensChecked <= 25, `screens ${out.report.sweep.screensChecked}`);
    assert.ok(out.report.sweep.buttonsChecked <= 60);
    assert.ok(!driver.state.clicks.includes("probe:예약 삭제"), "위험한 버튼은 점검에서 누르지 않는다");
    assert.ok(out.report.sweep.buttonsSkippedUnsafe >= 1);
    assert.ok(out.report.sweep.buttonErrors >= 1, "오류 나는 버튼은 고장으로");
    assert.ok(driver.state.closed, "드라이버는 닫힌다");
    assert.deepEqual(driver.state.logins, [USER, USER], "처음 로그인 + AC-003의 login 행동");
    // 비밀: LLM 프롬프트·리포트·고침 지시·위상 로그 어디에도
    const everything = [JSON.stringify(out.report), out.agentPrompt, ...prompts, ...phases].join("\n");
    assert.ok(!everything.includes(USER), "아이디가 새면 안 된다");
    assert.ok(!everything.includes(PASS), "비밀번호가 새면 안 된다");
    assert.ok(prompts.some((p) => p.includes("[REDACTED] 님 환영합니다")), "화면에 뜬 아이디도 LLM 전에 가린다");
  });

  it("시험 계정 없음 + 로그인 벽: fail이 아니라 not_verified('로그인 필요')", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "AC-001": bookScript,
      "AC-003": [
        { type: "goto", path: "/admin" },
        { type: "judge", verdict: "fail", reason: "관리 화면이 안 보여요", evidenceQuote: "관리자 로그인 비밀번호를 입력하세요" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [acs[0], acs[2]], acSource: "document", llm, driver });
    const row = out.report.acTable.find((r) => r.id === "AC-003");
    assert.equal(row.status, "not_verified");
    assert.equal(row.reason, "로그인 필요 — 시험 계정을 주시면 들어가서 확인해요");
    assert.equal(out.decision, "Not Verified");
    assert.notEqual(out.report.verdict, "문제를 찾지 못했어요");
    assert.equal(out.agentPrompt, "", "고칠 실패가 없으면 고침 지시도 없다");
  });

  it("직접 로그인 넘겨주기: 사람 대기 → 상태 이어받기, 사람이 친 글자도 가림", async () => {
    const typed = "handover-pass-123";
    const site = salonSite();
    site["/admin"] = (s) => (s.loggedIn ? { status: 200, text: `오늘 예약 10:30 김서연 (입력값 ${typed})` } : { status: 200, text: "카카오로 로그인" });
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct: salonOnAct });
    const states = [];
    const live = {
      setState: (s) => states.push(s),
      waitDone: async () => {
        driver.state.loggedIn = true; // 사람이 라이브 화면에서 카카오 로그인을 끝냈다
        return true;
      },
      typedSecrets: () => [typed],
    };
    const { llm, prompts } = makeScriptedLlm({
      "CORE-1": coreScript,
      "AC-003": [
        { type: "new_session" },
        { type: "login" },
        { type: "goto", path: "/admin" },
        { type: "judge", verdict: "pass", reason: "오늘 예약이 보여요", evidenceQuote: "오늘 예약 10:30 김서연" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [acs[2]], acSource: "interview", loginMode: "handover", live, llm, driver });
    assert.deepEqual(states, ["awaiting_login", "running"]);
    assert.equal(out.report.agent.loginMethod, "handover");
    assert.equal(out.report.acTable.find((r) => r.id === "AC-003").status, "pass", "new_session 뒤 login이 넘겨받은 상태를 되살린다");
    assert.equal(out.decision, "Ready");
    assert.ok(![JSON.stringify(out.report), ...prompts].join("\n").includes(typed));
  });

  it("기준이 없으면 첫 화면을 보고 추정(미확인) → 다 통과해도 Conditionally Ready", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({ "R-1": bookScript, "CORE-1": coreScript }, { inferred: [{ title: "예약", given: "g", when: "w", then: "예약 완료가 보인다", priority: "must" }] });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], llm, driver });
    assert.equal(out.report.agent.acSource, "inferred_at_run");
    assert.equal(out.report.acTable.find((r) => r.id === "R-1").confirmed, false);
    assert.equal(out.decision, "Conditionally Ready");
  });

  it("되돌릴 수 없는 클릭은 막고, 내가 만든 기록의 취소만 허용", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-001": [
        { type: "click", target: { role: "button", name: "예약 삭제" } },
        ...bookScript.slice(0, 2),
        { type: "click", target: { role: "button", name: "예약 삭제" }, ownRecord: true },
        { type: "judge", verdict: "pass", reason: "r", evidenceQuote: "예약이 완료되었어요" },
      ],
    });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [acs[0]], acSource: "interview", llm, driver });
    const deleteClicks = driver.state.clicks.filter((c) => c === "예약 삭제");
    assert.equal(deleteClicks.length, 1, "내 기록(김서연)일 때만 한 번 눌렀다");
    assert.ok(prompts.some((p) => /BLOCKED \(unsafe: delete/.test(p)), "막힌 이유가 다음 턴에 보인다");
  });

  it("짐작한 주소 404로는 '안 됨'이라 하지 않는다 · 링크된 실제 화면은 근거가 된다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "AC-001": [
        { type: "goto", path: "/result" },
        { type: "judge", verdict: "fail", reason: "결과 화면이 없어요", evidenceQuote: "404 Not Found" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [acs[0]], acSource: "interview", llm, driver });
    assert.equal(out.report.acTable.find((r) => r.id === "AC-001").status, "not_verified");
    assert.equal(out.report.acTable.find((r) => r.id === "AC-001").reasonCode, "guessed_address");
    assert.equal(out.agentPrompt, "");
  });

  it("없는 앱(404): AC를 돌리지 않고 Needs Fix + 404 신호", async () => {
    const driver = makeFakeDriver({}, { origin: ORIGIN });
    const { llm, prompts } = makeScriptedLlm({});
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 60_000, acs: [acs[0]], acSource: "interview", llm, driver });
    assert.equal(out.decision, "Needs Fix");
    assert.equal(prompts.length, 0, "없는 앱에 LLM을 쓰지 않는다");
    assert.ok(out.report.findings.some((f) => f.code === "page_not_found"));
  });
});

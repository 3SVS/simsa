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
    // 2026-10-19: 내 기록 표지는 번호 — 번호를 채웠으면 함께 저장한다(ownsRecordNear가 번호로 본다).
    state.store.booking = { name: state.fills[0], ...(state.fills[1] ? { phone: state.fills[1] } : {}) };
    state.path = "/done";
  }
  return null;
}

/** 사용자가 꼭 되어야 한다고 체크한 기준(있어야 기본 기준 CORE-1도 must — 2026-10-06 Bae 결정). */
const userMust = { id: "AC-U", title: "사용자가 체크한 기준", given: "g", when: "w", then: "t", priority: "must", confirmed: true };
const userMustScript = [{ type: "judge", verdict: "not_verified", reason: "키 필요", evidenceQuote: "", reasonCode: "api_key_required" }];

const bookScript = [
  { type: "fill", target: { label: "이름" }, value: "$NAME" },
  { type: "click", target: { role: "button", name: "예약하기" } },
  { type: "judge", verdict: "pass", reason: "예약 완료 화면에 이름과 시간이 보였어요", evidenceQuote: "예약이 완료되었어요 $NAME 10:30" },
];

/** 기본 기준(핵심 일 끝까지): 입력 → 제출(상태 변화) → 새로고침(확인) → 근거 인용 통과. */
const coreScript = [
  { type: "fill", target: { label: "이름" }, value: "$NAME" },
  { type: "click", target: { role: "button", name: "예약하기" } },
  { type: "goto", path: "/" },
  { type: "judge", verdict: "pass", reason: "첫 화면에서 그 시간이 예약됨으로 보여요", evidenceQuote: "10:30 예약됨" },
];

describe("(1) 시각 경계 · (3) 로그인 벽 공개 범위", () => {
  const todayAc = { id: "AC-T", title: "사장님 오늘 예약 목록", given: "예약 1건", when: "관리 화면", then: "오늘 날짜의 예약이 보인다", priority: "must", confirmed: true };
  it("날짜 기준이 통과하면 한국 새벽 00:30으로 다시 — 그때 실패면 실패", async () => {
    const site = salonSite();
    site["/today"] = (s) => ({ status: 200, text: s.clock ? "오늘 예약 0건 (2026-10-04)" : "오늘 예약 1건 10:30" });
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "CORE-1": coreScript,
      "AC-T": [
        { type: "goto", path: "/today" },
        { type: "judge", verdict: "pass", reason: "오늘 예약이 보여요", evidenceQuote: "오늘 예약 1건 10:30" },
        { type: "goto", path: "/today" },
        { type: "judge", verdict: "fail", reason: "새벽에는 오늘이 어제 날짜로 보여 예약이 0건이에요", evidenceQuote: "오늘 예약 0건 (2026-10-04)" },
      ],
    });
    site["/"] = ((orig) => (s) => ({ ...orig(s), links: [...orig(s).links, "/today"] }))(site["/"]);
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 300_000, acs: [todayAc], acSource: "interview", llm, driver });
    const row = out.report.acTable.find((r) => r.id === "AC-T");
    assert.equal(row.status, "fail");
    assert.match(row.reason, /한국 시간 새벽 0시 30분/);
    assert.equal(row.clockVariant.status, "fail");
    assert.match(driver.state.clock, /T15:30:00\.000Z$/, "KST 00:30 = UTC 전날 15:30");
    assert.ok(prompts.some((p) => p.includes("00:30 Korea time")));
    assert.equal(out.decision, "Needs Fix");
  });
  it("시간과 무관한 기준은 변형을 돌리지 않는다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({ "CORE-1": coreScript });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], acSource: "interview", llm, driver });
    assert.equal(driver.state.clock, undefined);
  });
  it("로그인 벽: 공개 범위 통과는 pass(scope public) → '문제를 찾지 못했어요 — 로그인 뒤는 못 봄'", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "CORE-1": [...coreScript.slice(0, 3), { type: "judge", verdict: "pass", reason: "손님 쪽은 됐고 관리 화면은 로그인 뒤라 못 봤어요", evidenceQuote: "10:30 예약됨", scope: "public" }],
      "AC-U": [{ type: "judge", verdict: "pass", reason: "로그인 없이 되는 부분은 됐어요", evidenceQuote: "예약하기", scope: "public" }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust], acSource: "interview", llm, driver });
    assert.equal(out.report.acTable[0].scope, "public");
    assert.equal(out.decision, "Conditionally Ready");
    assert.equal(out.report.agent.basis, "public_scope_only");
    assert.match(out.report.oneLine, /로그인 뒤 화면은 확인하지 못했어요/);
  });
});

describe("2026-10-06 프로덕션 진단 교정(F1~F4) — 모두 옛 코드에서 실패한다", () => {
  const one = (id) => ({ id, title: `기준 ${id}`, given: "g", when: "w", then: "예약이 된다", priority: "should", confirmed: true });

  it("F1 기준마다 새 브라우저: 앞 기준이 만든 상태가 다음 기준 첫 화면에 남지 않는다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "생략", evidenceQuote: "", reasonCode: "app_missing" }],
      "AC-1": [...bookScript],
      "AC-2": [{ type: "judge", verdict: "not_verified", reason: "끝", evidenceQuote: "", reasonCode: "app_missing" }],
    });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1"), one("AC-2")], acSource: "interview", llm, driver });
    const firstAc2 = prompts.find((p) => p.includes("Criterion AC-2 ("));
    assert.ok(firstAc2.includes("10:30 예약 가능"), "AC-2는 깨끗한 상태에서 시작한다");
    assert.ok(!firstAc2.includes("10:30 예약됨"), "AC-1이 만든 예약이 남아 있으면 안 된다");
  });

  // (H3, 2026-10-06 run 3) 강한 모델 재질문은 must 기준의 pass/fail 판정에만 — 싼 모델의 pass를 강한 모델이 fail로 뒤집는 경우.
  it("F2 판정은 강한 모델: must 기준에서 싼 모델이 '통과'라 해도 강한 모델이 근거와 함께 실패로 보면 실패", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm(
      { "AC-1": [...bookScript.slice(0, 2), { type: "judge", verdict: "pass", reason: "된 것 같아요", evidenceQuote: "예약이 완료되었어요" }] },
      {
        strong: { "AC-1": (last) => (/된 것 같아요/.test(last ?? "") ? { type: "judge", verdict: "fail", reason: "완료 화면에 시간이 틀리게 나와요", evidenceQuote: "예약이 완료되었어요" } : JSON.parse(last).action) },
        // (G1) 재현 런에서도 같은 실패가 보인다
        reproduce: { "AC-1": [...bookScript.slice(0, 2), { type: "judge", verdict: "fail", reason: "완료 화면에 시간이 틀리게 나와요", evidenceQuote: "예약이 완료되었어요" }] },
      },
    );
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [{ ...one("AC-1"), priority: "must" }], acSource: "interview", llm, driver });
    assert.equal(out.report.acTable.find((r) => r.id === "AC-1").status, "fail");
  });

  it("F3 이른 포기 되돌림: 사유 없는 '확인 못 함'을 첫 걸음에 내면 계속 해 보게 한다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-1": [{ type: "judge", verdict: "not_verified", reason: "아직 확인하지 못했어요", evidenceQuote: "" }, ...bookScript],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1")], acSource: "interview", llm, driver });
    assert.equal(out.report.acTable.find((r) => r.id === "AC-1").status, "pass");
    assert.ok(prompts.some((p) => p.includes("not accepted: you still have")));
  });

  it("F6 지어낸 주소는 열지 않는다(Gemini /admin/today 404 오판) — 앱이 보여 준 주소·기준에 적힌 경로만", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-1": [
        { type: "goto", path: "/admin/today" },
        { type: "judge", verdict: "not_verified", reason: "관리 화면이 404", evidenceQuote: "", reasonCode: "app_missing" },
      ],
    });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1")], acSource: "interview", llm, driver });
    assert.ok(!driver.state.visited?.includes("/admin/today"), "짐작한 주소로 가지 않는다");
    assert.ok(prompts.some((p) => p.includes("BLOCKED (this address was never shown by the app")));
    // 기준 문장에 적힌 경로는 열 수 있다
    const d2 = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm: l2 } = makeScriptedLlm({
      "AC-2": [{ type: "goto", path: "/reports" }, { type: "judge", verdict: "not_verified", reason: "x", evidenceQuote: "", reasonCode: "app_missing" }],
    });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [{ ...one("AC-2"), when: "사장님이 /reports 화면을 연다" }], acSource: "interview", llm: l2, driver: d2 });
    assert.ok(d2.state.visited.includes("/reports"));
  });

  it("F5 같은 단추를 눌러도 화면이 그대로면 알려 주고, 두 번째부터 다음 수는 강한 모델이 고른다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN });
    const tiers = [];
    const { llm: base, prompts } = makeScriptedLlm({
      "AC-1": [
        { type: "click", target: { role: "button", name: "예약하기" } },
        { type: "click", target: { role: "button", name: "예약하기" } },
        { type: "fill", target: { label: "이름" }, value: "$NAME" },
        { type: "judge", verdict: "not_verified", reason: "끝", evidenceQuote: "", reasonCode: "app_missing" },
      ],
    });
    const llm = async (req) => {
      if (/Criterion AC-1 \(/.test(req.user) && !/skeptical/.test(req.user)) tiers.push(req.tier);
      return base({ ...req, tier: "cheap" });
    };
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1")], acSource: "interview", llm, driver });
    assert.ok(prompts.some((p) => p.includes("NO VISIBLE CHANGE")), "변화 없음을 알린다");
    assert.equal(tiers[2], "strong", "같은 행동이 두 번 헛돌면 다음 턴은 강한 모델");
    assert.equal(tiers[0], "cheap");
  });

  it("F4 재확인 불일치 한 번은 이유를 들고 더 해 본다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    let reviews = 0;
    const { llm, prompts } = makeScriptedLlm(
      { "AC-1": [{ type: "judge", verdict: "pass", reason: "버튼이 보여요", evidenceQuote: "예약하기" }, ...bookScript] },
      { review: () => ++reviews > 1 },
    );
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [{ ...one("AC-1"), priority: "must" }], acSource: "interview", llm, driver });
    assert.equal(out.report.acTable.find((r) => r.id === "AC-1").status, "pass");
    assert.ok(prompts.some((p) => p.includes("gather the missing proof")));
  });
});

describe("prod bench1 run 2 교정(G1·G3) — 옛 코드에서 실패한다", () => {
  const one = (id) => ({ id, title: `기준 ${id}`, given: "g", when: "w", then: "예약이 된다", priority: "must", confirmed: true });

  it("G1 실패는 새 브라우저에서 강한 모델로 재현돼야 남는다 — 재현 안 되면 확인 못 함(fail_not_reproduced)", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const tiers = [];
    const { llm: base } = makeScriptedLlm(
      {
        "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "생략", evidenceQuote: "", reasonCode: "api_key_required" }],
        // 첫 시도: 이름을 안 넣고 제출 → "완료 화면이 안 나와요"(우리 실수로 생긴 거짓 실패)
        "AC-1": [{ type: "click", target: { role: "button", name: "예약하기" } }, { type: "judge", verdict: "fail", reason: "제출해도 완료 화면이 안 나와요", evidenceQuote: "10:30 예약 가능" }],
      },
      { reproduce: { "AC-1": [...bookScript] } },
    );
    const llm = async (req) => {
      if (/earlier attempt concluded FAIL/.test(req.user)) tiers.push(req.tier);
      return base(req);
    };
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1")], acSource: "interview", llm, driver });
    const row = out.report.acTable.find((r) => r.id === "AC-1");
    assert.equal(row.status, "not_verified");
    assert.equal(row.reasonCode, "fail_not_reproduced");
    assert.ok(tiers.length > 0 && tiers.every((t) => t === "strong"), "재현 런의 행동은 강한 모델");
    assert.equal(out.agentPrompt, "", "재현 안 된 실패로는 고침 지시를 만들지 않는다");
  });

  it("G1 앱이 우리 입력 형식을 거절한 '실패'는 입력을 고쳐 다시 — 고장이 아니다", async () => {
    const site = salonSite();
    site["/"] = (s) => ({ status: 200, text: s.badPhone ? "휴대폰 번호 형식이 올바르지 않습니다" : s.store.booking ? "예약됨" : "예약 화면 예약하기", links: ["/"], buttons: [] });
    const driver = makeFakeDriver(site, {
      origin: ORIGIN,
      onAct: (a, s) => {
        if (a.type === "fill" && a.target.label === "휴대폰") s.badPhone = a.value.includes("-");
        if (a.type === "click" && !s.badPhone) {
          s.store.booking = { name: "x" };
          s.path = "/done";
        }
        return null;
      },
    });
    const { llm, prompts } = makeScriptedLlm({
      "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "생략", evidenceQuote: "", reasonCode: "api_key_required" }],
      "AC-1": [
        { type: "fill", target: { label: "휴대폰" }, value: "010-1234-5678" },
        { type: "judge", verdict: "fail", reason: "휴대폰 번호 오류로 예약이 안 돼요", evidenceQuote: "휴대폰 번호 형식이 올바르지 않습니다" },
        { type: "fill", target: { label: "휴대폰" }, value: "01012345678" },
        { type: "click", target: { role: "button", name: "예약하기" } },
        { type: "judge", verdict: "pass", reason: "예약이 완료됐어요", evidenceQuote: "예약이 완료되었어요" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1")], acSource: "interview", llm, driver });
    assert.ok(prompts.some((p) => p.includes("rejecting OUR input format")));
    assert.notEqual(out.report.acTable.find((r) => r.id === "AC-1").status, "fail");
  });

  it("G3 화면이 열린 뒤 에이전트가 고른 app_missing은 인정하지 않는다('앱 첫 화면이 열리지 않아' 거짓 표시 방지)", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "생략", evidenceQuote: "", reasonCode: "api_key_required" }],
      "AC-1": [
        { type: "click", target: { role: "button", name: "예약하기" } },
        { type: "judge", verdict: "not_verified", reason: "모르겠어요", evidenceQuote: "", reasonCode: "app_missing" },
        ...bookScript,
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [one("AC-1")], acSource: "interview", llm, driver });
    const row = out.report.acTable.find((r) => r.id === "AC-1");
    assert.notEqual(row.reasonCode, "app_missing");
    assert.doesNotMatch(row.reason, /앱 첫 화면이 열리지 않아/);
    assert.ok(prompts.some((p) => p.includes("not accepted: you still have")), "사유 없는 이른 포기로 되돌려졌다");
    assert.equal(row.status, "pass");
  });
});

describe("prod bench1 run 3 교정(H1~H3) — 옛 코드에서 실패한다", () => {
  const must = (id) => ({ id, title: `기준 ${id}`, given: "g", when: "w", then: "예약이 된다", priority: "must", confirmed: true });
  const should = (id) => ({ ...must(id), priority: "should" });

  it("H1 화면 구성 해석('시간을 고르지 않아도 정보 입력 단계가 이미 보임')은 실패가 아니다 → 확인 못 함", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "CORE-1": userMustScript,
      "AC-1": [{ type: "judge", verdict: "fail", reason: "시간을 고르지 않아도 예약자 정보 입력 단계가 이미 보여서 시간 선택이 필요하다는 상태가 유지되지 않았습니다.", evidenceQuote: "예약하기" }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [must("AC-1")], acSource: "interview", llm, driver });
    const row = out.report.acTable.find((r) => r.id === "AC-1");
    assert.equal(row.status, "not_verified");
    assert.equal(row.reasonCode, "ui_interpretation");
    assert.notEqual(out.decision, "Needs Fix");
  });

  it("H2 핵심 기준: 처음 제출 직후 저장 위치를 자동으로 재고, 서버 쓰기 0이면 새 브라우저로 확인하라고 알린다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": [...bookScript.slice(0, 2), { type: "judge", verdict: "not_verified", reason: "끝", evidenceQuote: "", reasonCode: "api_key_required" }],
    });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust], acSource: "interview", llm, driver });
    const p = prompts.find((x) => x.includes("automatic check after your submit"));
    assert.ok(p, "자동 저장 탐침 결과가 다음 턴에 보인다");
    assert.match(p, /server write requests since this check started = 0[\s\S]*verify with new_session/);
  });

  it("H3 비용: should 기준의 판정은 강한 모델에 다시 묻지도, 재확인하지도 않는다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const strongForShould = [];
    const { llm: base } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": userMustScript,
      "AC-S": [...bookScript],
    });
    const llm = async (req) => {
      if (/Criterion AC-S \(/.test(req.user) && (req.tier === "strong" || /skeptical/.test(req.user))) strongForShould.push(req.tier);
      return base(req);
    };
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust, should("AC-S")], acSource: "interview", llm, driver });
    assert.deepEqual(strongForShould, []);
    assert.equal(out.report.acTable.find((r) => r.id === "AC-S").status, "pass");
  });

  it("H3 비용: 행동 예산이 40% 아래로 남으면 should 기준은 건너뛴다(must 먼저)", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "CORE-1": [...bookScript.slice(0, 2), { type: "click", target: { role: "button", name: "예약하기" } }, { type: "judge", verdict: "not_verified", reason: "끝", evidenceQuote: "", reasonCode: "api_key_required" }],
      "AC-U": userMustScript,
      "AC-S": [...bookScript],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust, should("AC-S")], acSource: "interview", llm, driver, caps: { maxActions: 8 } });
    assert.equal(out.report.acTable.find((r) => r.id === "AC-S").reasonCode, "budget");
  });
});

describe("C11 시간 초과 시 부분 리포트", () => {
  it("돌던 중 멈춰도 잰 만큼 리포트 — 실패한 must는 그대로, 못 돈 기준은 시간 한도", async () => {
    const { partialAgentResult } = await import("../inspector-container/agent-run.mjs");
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const progress = {};
    let calls = 0;
    const { llm: base } = makeScriptedLlm({
      "CORE-1": [...bookScript.slice(0, 2), { type: "new_session" }, { type: "judge", verdict: "fail", reason: "다른 손님에게 안 보여요", evidenceQuote: "10:30 예약 가능" }],
    });
    // 두 번째 기준에서 영원히 멈춘다(무거운 사이트·컨테이너 하드 레일 흉내)
    const llm = async (req) => {
      calls += 1;
      if (/Criterion AC-001/.test(req.user)) return new Promise(() => {});
      return base(req);
    };
    const run = runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [acs[0]], acSource: "interview", llm, driver, progress });
    await new Promise((r) => setTimeout(r, 300));
    const out = await partialAgentResult(progress);
    void run;
    assert.ok(calls > 0);
    assert.equal(out.decision, "Needs Fix");
    assert.equal(out.report.acTable.find((r) => r.id === "CORE-1").status, "fail");
    assert.equal(out.report.acTable.find((r) => r.id === "AC-001").reasonCode, "budget");
    assert.ok(out.report.notes.some((n) => n.includes("여기까지 본 내용")));
    assert.match(out.agentPrompt, /CORE-1/);
  });
  it("기준을 하나도 못 잡았으면 null(종전처럼 실패 콜백)", async () => {
    const { partialAgentResult } = await import("../inspector-container/agent-run.mjs");
    assert.equal(await partialAgentResult({}), null);
  });
});

describe("(2) 남는다 = 만든 기록을 다른 곳에서 다시 찾음 — 새로고침만으로는 아니다", () => {
  it("입력→제출→새로고침→통과만 있으면 핵심 일 확인 안 됨(Not Verified)", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({
      "CORE-1": [
        { type: "fill", target: { label: "이름" }, value: "$NAME" },
        { type: "click", target: { role: "button", name: "예약하기" } },
        { type: "reload" },
        { type: "judge", verdict: "pass", reason: "새로고침해도 완료 화면이 남아 있어요", evidenceQuote: "예약이 완료되었어요 $NAME 10:30" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], acSource: "interview", llm, driver });
    const core = out.report.acTable.find((r) => r.id === "CORE-1");
    assert.deepEqual(core.exercised, { stateChange: true, verified: false });
    assert.equal(out.decision, "Not Verified");
  });
});

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
      "AC-U": userMustScript,
      "CORE-1": [
        ...bookScript.slice(0, 2),
        { type: "probe_storage" },
        { type: "judge", verdict: "fail", reason: "예약이 이 브라우저에만 저장돼 다른 손님·사장님이 볼 수 없어요", evidenceQuote: "saved only in this browser" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust], acSource: "interview", llm, driver });
    const core = out.report.acTable.find((r) => r.id === "CORE-1");
    assert.equal(core.status, "fail");
    assert.deepEqual(core.exercised, { stateChange: true, verified: true });
    assert.equal(out.decision, "Needs Fix");
  });
  it("두 번째 판단이 동의하지 않으면 pass도 fail도 결과로 치지 않는다", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    // (F4) 불일치 한 번은 이유를 들고 다시 해 본다 — 두 번째 불일치에서 끝난다.
    const { llm } = makeScriptedLlm({ "CORE-1": [...coreScript, coreScript.at(-1)], "AC-U": userMustScript }, { review: () => false });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust], acSource: "interview", llm, driver });
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
    // (F1) 기준마다 새 브라우저 + 시험 계정 재로그인(처음 1 + 기준 4 + AC-003의 login 행동 1).
    assert.ok(driver.state.logins.length >= 2 && driver.state.logins.every((u) => u === USER), JSON.stringify(driver.state.logins.length));
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

  it("기준이 없으면 첫 화면을 보고 추정(미확인) — 사용자가 체크한 must가 없으니 다 통과해도 '확인 못 함' + 체크 안내(옛 코드: Conditionally Ready)", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm } = makeScriptedLlm({ "R-1": bookScript, "CORE-1": coreScript }, { inferred: [{ title: "예약", given: "g", when: "w", then: "예약 완료가 보인다", priority: "must" }] });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], llm, driver });
    assert.equal(out.report.agent.acSource, "inferred_at_run");
    assert.equal(out.report.acTable.find((r) => r.id === "R-1").confirmed, false);
    assert.equal(out.report.acTable.find((r) => r.id === "CORE-1").priority, "should", "사용자 must가 없으면 기본 기준도 must가 아니다");
    assert.equal(out.decision, "Not Verified");
    assert.match(out.report.oneLine, /꼭 되어야 하는 것으로 체크하신 항목이 없어서/);
  });

  it("되돌릴 수 없는 클릭은 막고, 내가 만든 기록의 취소만 허용", async () => {
    const driver = makeFakeDriver(salonSite(), { origin: ORIGIN, onAct: salonOnAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-001": [
        { type: "click", target: { role: "button", name: "예약 삭제" } },
        bookScript[0],
        { type: "fill", target: { label: "휴대폰" }, value: "$PHONE" },
        bookScript[1],
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
    // (F6) 이제 짐작한 주소는 아예 열지 않는다 — 그 404를 근거로 한 판정은 화면에 없는 인용이라 결과로 치지 않는다.
    assert.ok(["guessed_address", "evidence_missing"].includes(out.report.acTable.find((r) => r.id === "AC-001").reasonCode));
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

// ─── 2026-10-19 given 셋업(격차 §3-10·§7, Bae 요구 a~e) — 옛 코드에서 실패한다 ──────────────────────────────────────

const { koreanTestData } = await import("../dist/agent-inspection.js");

describe("given 셋업: 전제(기록이 있다)를 먼저 만들고, 못 만들면 정직하게 건너뛴다", () => {
  const SEED = 4242;
  const TD = koreanTestData(SEED, "t1");
  const A3 = { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", given: "어떤 날짜·시간에 예약이 하나 있다", when: "다른 손님(새 브라우저)이 같은 날짜·시간을 고르려 한다", then: "그 시간은 고를 수 없다(이중 예약이 되지 않는다)", priority: "must", confirmed: true };
  const A6 = { id: "A6", title: "관리 화면에 오늘 예약이 시간순으로 보인다", given: "오늘 날짜에 예약이 1건 이상 있다", when: "사장님이 관리 화면을 연다", then: "오늘 예약 목록이 시간순으로 보인다", priority: "must", confirmed: true };
  const A7 = { id: "A7", title: "취소하면 그 시간을 다시 예약할 수 있다", given: "관리 화면에 예약이 1건 보인다", when: "그 예약을 취소한다", then: "목록에서 사라지고 손님이 그 시간을 다시 고를 수 있다", priority: "must", confirmed: true };

  /** 서버에 저장하는 예약 앱(세션 간 공유) — 이중 예약을 허용하는 결함. 관리 화면에 이전 런의 기록도 있다. */
  function serverSalon({ adminPassword = false } = {}) {
    const shared = { bookings: [{ name: "심사테스트", phone: "010-1111-2222", time: "10:00" }] };
    const site = {
      "/": () => ({ status: 200, text: "동네 미용실 예약 10:30 예약 가능 예약하기", links: ["/", "/admin"], buttons: ["예약하기", "10:30"] }),
      "/done": () => ({ status: 200, text: `예약이 완료되었어요 ${TD.name} 2026-10-19 10:30` }),
      "/admin": () =>
        adminPassword
          ? { status: 200, text: "관리자 로그인 비밀번호를 입력하세요", password: true }
          : { status: 200, text: `오늘 예약 ${shared.bookings.map((b) => `${b.time} ${b.name} ${b.phone}`).join(" / ")}`, buttons: shared.bookings.map((b) => `취소 ${b.phone}`) },
    };
    const onAct = (action, state) => {
      if (action.type === "click" && action.target.name === "예약하기" && state.fills.length > 0) {
        shared.bookings.push({ name: TD.name, phone: TD.phone, time: "10:30" });
        (state.serverWrites ??= []).push("POST /api/bookings");
        state.path = "/done";
      }
      if (action.type === "click" && /^취소 /.test(action.target.name ?? "")) {
        const phone = action.target.name.slice(3);
        const before = shared.bookings.length;
        shared.bookings = shared.bookings.filter((b) => b.phone !== phone);
        (state.serverWrites ??= []).push("DELETE /api/bookings");
        return { ok: true, note: before === shared.bookings.length ? "nothing removed" : "removed", acceptDialog: action.acceptDialog === true };
      }
      return null;
    };
    return { site, onAct, shared };
  }
  const book = [
    { type: "fill", target: { label: "이름" }, value: "$NAME" },
    { type: "fill", target: { label: "휴대폰" }, value: "$PHONE" },
    { type: "click", target: { role: "button", name: "예약하기" } },
    { type: "judge", verdict: "pass", reason: "완료 화면에 예약이 보여요", evidenceQuote: "예약이 완료되었어요 $NAME" },
  ];

  it("T2 CORE-1이 만든 기록을 A3 프롬프트·관찰 기록에 주입하고(다시 만들지 말 것), A3는 새 브라우저에서 이중 예약을 잡아 fail", async () => {
    const { site, onAct } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": book,
      A3: [
        { type: "new_session" },
        { type: "click", target: { role: "button", name: "10:30" } },
        { type: "judge", verdict: "fail", reason: "이미 예약된 10:30이 다른 손님에게도 예약 가능으로 보여서 같은 시간이 또 예약돼요", evidenceQuote: "10:30 예약 가능" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench" });
    const a3Prompt = prompts.find((p) => /Criterion A3 \(/.test(p));
    assert.ok(a3Prompt, "A3가 실행됐다");
    assert.match(a3Prompt, /Setup done earlier in this run \(by CORE-1\): a booking exists — name=심사테스트, phone=010-/);
    assert.match(a3Prompt, /Do NOT create it again/);
    assert.match(a3Prompt, /Known path to the booking form/);
    const row = out.report.acTable.find((r) => r.id === "A3");
    assert.equal(row.status, "fail");
    assert.equal(out.report.agent.setup.byAc, "CORE-1");
    assert.equal(out.report.agent.setup.serverWrites, 1);
    assert.equal(out.decision, "Needs Fix");
  });

  it("T3 아무 기준도 기록을 못 만들었고 SETUP-1도 실패하면 given 기준은 0걸음에 precondition_not_met(결함 목록 제외)", async () => {
    const { site, onAct } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "폼을 못 찾았어요", evidenceQuote: "", reasonCode: "not_reached" }],
      // SETUP-1 대본 없음 → not_verified(대본 끝) → 기록 없음
      A3: [{ type: "judge", verdict: "fail", reason: "틀린 판정이 나오면 안 된다", evidenceQuote: "" }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3, A6, A7], acSource: "interview", llm, driver, testDataSeed: SEED, setupPolicy: "bench" });
    assert.ok(prompts.some((p) => /Criterion SETUP-1 \(/.test(p)), "런당 1회 SETUP-1을 시도한다");
    assert.equal(prompts.filter((p) => /Criterion SETUP-1 \(/.test(p)).length <= 14, true);
    for (const id of ["A3", "A6", "A7"]) {
      const row = out.report.acTable.find((r) => r.id === id);
      assert.equal(row.status, "not_verified", id);
      assert.equal(row.reasonCode, "precondition_not_met", id);
    }
    assert.ok(!prompts.some((p) => /Criterion A3 \(/.test(p)), "A3 대본은 실행되지 않는다(0걸음)");
    assert.ok(!out.report.agent.defects.some((d) => d.acId === "A3"), "전제 미충족은 앱 결함이 아니다");
    assert.notEqual(out.decision, "Needs Fix");
  });

  it("T4 동의 없는 런(readOnly)은 셋업을 시도하지 않고 setup_not_consented — 대시보드가 '허용하고 다시 확인'으로 푼다", async () => {
    const { site, onAct } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm, prompts } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": userMustScript });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3], acSource: "interview", llm, driver, readOnly: true, testDataSeed: SEED });
    const row = out.report.acTable.find((r) => r.id === "A3");
    assert.equal(row.reasonCode, "setup_not_consented");
    assert.match(row.reason, /테스트 데이터 생성 미동의/);
    assert.ok(!prompts.some((p) => /Criterion SETUP-1 \(/.test(p)), "동의 없이는 만들지 않는다");
  });

  it("T4b 실유저(user) 정책: 치울 예산이 없으면 만들지 않는다(setup_skipped_budget) · 벤치(bench) 정책은 만든다", async () => {
    for (const [policy, code] of [["user", "setup_skipped_budget"], ["bench", "precondition_not_met"]]) {
      const { site, onAct } = serverSalon();
      const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
      const { llm, prompts } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": userMustScript });
      // maxActions 20 → 정리 예산 floor(20*0.15)=3 < 4 → user는 셋업 금지
      const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3], acSource: "interview", llm, driver, testDataSeed: SEED, setupPolicy: policy, caps: { maxActions: 20, maxAcs: 11, maxScreens: 5 } });
      const row = out.report.acTable.find((r) => r.id === "A3");
      assert.equal(row.reasonCode, code, policy);
      assert.equal(prompts.some((p) => /Criterion SETUP-1 \(/.test(p)), policy === "bench", `${policy}: SETUP-1 시도 여부`);
    }
  });

  it("T5 런 끝 정리: 내 번호 기록만 취소(이전 런 기록은 BLOCKED) → leftover 0 · 관리 화면이 비밀번호면 leftover=만든 수 + 노트", async () => {
    const cleanupScript = [
      { type: "goto", path: "/admin" },
      { type: "click", target: { role: "button", name: "취소 010-1111-2222" }, ownRecord: true },
      { type: "click", target: { role: "button", name: "취소 $PHONE" }, ownRecord: true },
      { type: "judge", verdict: "pass", reason: "내 예약이 목록에서 사라졌어요", evidenceQuote: "오늘 예약" },
    ];
    {
      const { site, onAct, shared } = serverSalon();
      const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
      const { llm } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": book, "CLEANUP-1": cleanupScript });
      const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench" });
      const td = out.report.agent.testData;
      assert.equal(td.created, 1);
      assert.equal(td.cleaned, 1);
      assert.equal(td.leftover, 0);
      assert.equal(td.runTag, "t1");
      assert.ok(shared.bookings.some((b) => b.phone === "010-1111-2222"), "이전 런(다른 번호) 기록은 남는다");
      assert.ok(!shared.bookings.some((b) => b.phone === TD.phone), "내 기록은 지워졌다");
      assert.ok(!out.report.notes.some((n) => /테스트 데이터 \d+건 남음/.test(n)));
    }
    {
      const { site, onAct } = serverSalon({ adminPassword: true });
      const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
      const { llm } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": book, "CLEANUP-1": [{ type: "goto", path: "/admin" }, { type: "judge", verdict: "not_verified", reason: "로그인 필요", evidenceQuote: "", reasonCode: "login_required" }] });
      const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench" });
      const td = out.report.agent.testData;
      assert.equal(td.leftover, 1);
      assert.equal(td.cleanupSkipped, "login_wall");
      assert.ok(out.report.notes.some((n) => /테스트 데이터 1건 남음\(이름 '심사테스트', 번호 010-/.test(n)), JSON.stringify(out.report.notes));
    }
  });

  it("T8 (§8 c-3) 취소 버튼을 한 번도 못 눌렀는데 정리가 pass면 지운 수 0 · leftover=만든 수 · no_cancel_click — 옛 코드는 cleaned=1", async () => {
    const { site, onAct, shared } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": book,
      // v0 r2 모양: 취소 수단이 없는 화면을 보고 "목록에 없다"로 pass.
      "CLEANUP-1": [{ type: "judge", verdict: "pass", reason: "목록에 내 번호 예약이 없어요", evidenceQuote: "동네 미용실 예약" }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench" });
    const td = out.report.agent.testData;
    assert.equal(td.created, 1);
    assert.equal(td.cleaned, 0);
    assert.equal(td.leftover, 1);
    assert.equal(td.cleanupSkipped, "no_cancel_click");
    assert.ok(shared.bookings.some((b) => b.phone === TD.phone), "실제로 남아 있다");
    assert.ok(out.report.notes.some((n) => /테스트 데이터 1건 남음/.test(n)), JSON.stringify(out.report.notes));
  });

  it("T9 (§8 a-3) trace 켠 런은 재확인 기각 사유·턴별 생각·시작 상태를 기준별로 남긴다 · 끈 런(프로덕션)은 agent.trace 없음", async () => {
    const script = { "AC-U": userMustScript, "CORE-1": book, A3: [{ type: "new_session" }, { type: "judge", verdict: "pass", reason: "다른 손님에겐 10:30이 막혀 있어요", evidenceQuote: "10:30" }] };
    const run = async (trace) => {
      const { site, onAct } = serverSalon();
      const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
      const { llm } = makeScriptedLlm(script, { review: (id) => id !== "A3" });
      return runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench", trace });
    };
    const on = await run(true);
    const t = on.report.agent.trace.A3;
    assert.ok(t, JSON.stringify(Object.keys(on.report.agent.trace)));
    const disagreed = t.judgeTrail.find((j) => j.outcome === "review_disagreed");
    assert.ok(disagreed, JSON.stringify(t.judgeTrail));
    assert.equal(disagreed.review.why, "fake review");
    assert.equal(disagreed.finalStatus, "pass");
    assert.equal(t.startedWith, "fresh");
    assert.equal(typeof t.setupVisibleAtStart, "boolean");
    assert.ok(t.turns.length >= 1 && t.turns.every((x) => typeof x.thought === "string"));
    assert.equal(on.report.acTable.find((r) => r.id === "A3").status, "not_verified");
    assert.ok(!on.report.acTable.some((r) => "_trace" in r), "결과 행에는 안 들어간다");
    const off = await run(undefined);
    assert.equal(off.report.agent.trace, undefined);
  });

  it("T10 (§8 c-2) 표지 검사는 ownRecord 취소에서만 — 로그가 markerChecked와 markerMatch를 나눠 적는다", async () => {
    const { site, onAct } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": book,
      "CLEANUP-1": [
        { type: "goto", path: "/admin" },
        { type: "click", target: { role: "button", name: "취소 010-1111-2222" } },
        { type: "click", target: { role: "button", name: "취소 $PHONE" }, ownRecord: true },
        { type: "judge", verdict: "pass", reason: "내 예약이 목록에서 사라졌어요", evidenceQuote: "오늘 예약" },
      ],
    });
    const phases = [];
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench", onPhase: (l) => phases.push(l) });
    const lines = phases.filter((l) => /cancel-click CLEANUP-1/.test(l));
    assert.equal(lines.length, 2, lines.join("\n"));
    assert.match(lines[0], /ownRecord=false markerChecked=false markerMatch=null → blocked/);
    assert.match(lines[1], /ownRecord=true markerChecked=true markerMatch=true → allowed/);
    assert.equal(out.report.agent.testData.cleaned, 1);
    assert.equal(out.report.agent.testData.leftover, 0);
  });

  it("T7 seed가 같으면 번호가 같고(재현), 메모에 런 표지가 남는다 — 옛 코드는 Date.now만", async () => {
    const run = async () => {
      const { site, onAct } = serverSalon();
      const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
      const { llm } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": userMustScript });
      return runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "r3k9" });
    };
    const [a, b] = [await run(), await run()];
    assert.equal(a.report.agent.testData.phone, b.report.agent.testData.phone);
    assert.equal(a.report.agent.testData.phone, koreanTestData(SEED).phone);
    assert.match(a.report.agent.testData.memo, /테스트 r3k9/);
  });

  it("T10 회귀 잠금(F1): 기준마다 새 브라우저는 그대로 — 셋업이 있어도 '새로고침'류만 만든 쪽 브라우저를 잇는다", async () => {
    const { site, onAct } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const A5 = { id: "A5", title: "새로고침해도 예약이 남는다", given: "예약을 마쳤다", when: "새로고침하거나 새 브라우저로 다시 연다", then: "예약이 남아 있다", priority: "must", confirmed: true };
    const { llm } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": book, A3: [{ type: "judge", verdict: "not_verified", reason: "x", evidenceQuote: "" }] });
    const sessionsBefore = driver.state.session;
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3, A5], acSource: "interview", llm, driver, testDataSeed: SEED, setupPolicy: "bench" });
    assert.ok(driver.state.session - sessionsBefore >= 3, "기준마다 newSession");
  });

  /** v0 모양: 입력 → "시간 예약하기"(시간 고르기 화면만 연다, 쓰기 0) → "11:00" → "예약하기"(쓰기 1). */
  function pickerSalon() {
    const site = {
      "/": { status: 200, text: "동네 미용실 예약 이름 휴대폰 시간 예약하기", buttons: ["시간 예약하기"] },
      "/pick": { status: 200, text: "시간을 고르세요 11:00 예약하기", buttons: ["11:00", "예약하기"] },
      "/done": () => ({ status: 200, text: `예약이 완료되었어요 ${TD.name} 2026-10-19 11:00` }),
    };
    const onAct = (action, state) => {
      if (action.type === "click" && action.target.name === "시간 예약하기") state.path = "/pick";
      if (action.type === "click" && action.target.name === "예약하기" && state.path === "/pick" && state.fills.length > 0) {
        (state.serverWrites ??= []).push("POST /api/bookings");
        state.path = "/done";
      }
      return null;
    };
    return { site, onAct };
  }

  it("T11 (§8 b-3) 입력 뒤 첫 클릭이 시간 고르기 창을 열어도, 진짜 제출에서 기록을 잡아 셋업 공급자가 된다 — 옛 코드는 첫 클릭만 재서 셋업 없음", async () => {
    const { site, onAct } = pickerSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm, prompts } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": [
        { type: "fill", target: { label: "이름" }, value: "$NAME" },
        { type: "fill", target: { label: "휴대폰" }, value: "$PHONE" },
        { type: "click", target: { role: "button", name: "시간 예약하기" } },
        { type: "click", target: { role: "button", name: "11:00" } },
        { type: "click", target: { role: "button", name: "예약하기" } },
        { type: "judge", verdict: "pass", reason: "완료 화면에 예약이 보여요", evidenceQuote: "예약이 완료되었어요 $NAME" },
      ],
      A3: [{ type: "judge", verdict: "not_verified", reason: "x", evidenceQuote: "" }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A3], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench" });
    assert.equal(out.report.agent.setup?.byAc, "CORE-1", JSON.stringify(out.report.agent.setup));
    assert.equal(out.report.agent.setup.serverWrites, 1);
    assert.equal(out.report.agent.setup.time, "11:00", "완료 화면의 새 줄에서 읽는다");
    assert.ok(prompts.some((p) => /Criterion A3 \(/.test(p)), "A3가 실행됐다(0걸음 스킵 아님)");
    assert.notEqual(out.report.acTable.find((r) => r.id === "A3").reasonCode, "precondition_not_met");
  });

  it("T12 (§8 a-1) 브라우저에만 저장하는 앱: '새로고침하거나 새 브라우저' A5는 기록을 만든 브라우저 상태로 시작해 pass — 옛 코드는 빈 브라우저라 확인 못 함", async () => {
    const site = {
      "/": (state) => ({ status: 200, text: `동네 미용실 예약 이름 휴대폰 예약하기${state.store.booking ? ` 내 예약: ${state.store.booking}` : ""}`, buttons: ["예약하기"] }),
      "/done": (state) => ({ status: 200, text: `예약이 완료되었어요 ${state.store.booking ?? ""}` }),
    };
    const onAct = (action, state) => {
      if (action.type === "click" && action.target.name === "예약하기" && state.fills.length > 0) {
        state.store.booking = `${TD.name} 10:00`;
        state.path = "/done";
      }
      return null;
    };
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const A5 = { id: "A5", title: "새로고침해도 예약이 남는다", given: "예약을 마쳤다", when: "새로고침하거나 새 브라우저로 다시 연다", then: "예약이 남아 있다", priority: "must", confirmed: true };
    const { llm } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": book,
      A5: [{ type: "judge", verdict: "pass", reason: "다시 열어도 내 예약이 그대로 남아 있어요", evidenceQuote: `내 예약: ${TD.name} 10:00` }],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust, A5], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench", trace: true });
    const t = out.report.agent.trace.A5;
    assert.equal(t.startedWith, "restored_setup");
    assert.equal(t.setupVisibleAtStart, true);
    assert.equal(out.report.acTable.find((r) => r.id === "A5").status, "pass");
    assert.equal(out.report.agent.setup.serverWrites, 0);
    assert.equal(out.report.agent.testData.cleanupSkipped, "browser_only");
    assert.equal(out.report.agent.testData.leftover, 0);
  });

  it("T13 (§8 a-4·c-5) 버튼 글자 '예약 완료하기'와 번호 오류 문구, 쓰기 0 → 기록을 만든 것으로 치지 않는다 — 옛 코드는 created", async () => {
    const site = {
      "/": (state) => ({ status: 200, text: `예약 이름 휴대폰 예약 완료하기${state.err ? "\n휴대폰 번호가 잘못되었어요" : ""}`, buttons: ["예약 완료하기"] }),
    };
    const onAct = (action, state) => {
      if (action.type === "click" && action.target.name === "예약 완료하기") state.err = true;
      return null;
    };
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm } = makeScriptedLlm({
      "AC-U": userMustScript,
      "CORE-1": [
        { type: "fill", target: { label: "이름" }, value: "$NAME" },
        { type: "fill", target: { label: "휴대폰" }, value: "$PHONE" },
        { type: "click", target: { role: "button", name: "예약 완료하기" } },
        { type: "judge", verdict: "not_verified", reason: "x", evidenceQuote: "" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, runTag: "t1", setupPolicy: "bench" });
    assert.equal(out.report.agent.setup, undefined);
    assert.equal(out.report.agent.testData.created, 0);
  });

  it("T14 (§8 d) 프롬프트의 기기 시각은 한국 시각 표기 — 01:35 KST가 10-18 UTC로 보이지 않는다", async () => {
    const { site, onAct } = serverSalon();
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm, prompts } = makeScriptedLlm({ "AC-U": userMustScript, "CORE-1": userMustScript });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [userMust], acSource: "interview", llm, driver, testDataSeed: SEED, nowMs: Date.parse("2026-10-18T16:35:00Z") });
    const p = prompts.find((x) => /Device clock now:/.test(x));
    assert.match(p, /Device clock now: 2026-10-19 01:35 \(Asia\/Seoul, UTC\+9\)/);
  });
});

describe("2026-10-19 '취소'는 삭제 범주(내 기록 게이트) — 옛 코드는 자유 클릭", () => {
  it("취소·예약 취소 → delete, 이미지 사본(spike)도 같다", async () => {
    const { classifyActionSafety } = await import("../inspector-container/safety.mjs");
    const spike = await import("../../../tools/simsa-completion-loop-spike/lib/safety.mjs");
    for (const t of ["취소", "예약 취소", "삭제"]) {
      assert.deepEqual(classifyActionSafety(t), { safe: false, category: "delete" }, t);
      assert.deepEqual(spike.classifyActionSafety(t), { safe: false, category: "delete" }, `spike ${t}`);
    }
    assert.equal(classifyActionSafety("예약하기").safe, true);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// 2026-10-05 agent 엔진(수용 기준 실행기)의 순수 규칙: 행동 검증 · 증거 접지 · 로그인 벽 · 판정 사다리 ·
// 리포트(AC 표·화면·버튼 점검) · 고침 지시는 실제 실패만 · 비밀 가림 · 점검 상한·안전 스킵 · 재검수 같은 기준.

const P = await import("../dist/agent-inspection.js");
const { agentAcsFromDevSpec, devSpecAcSource } = await import("../dist/acceptance-plan.js");
const { salonSpec } = await import("./_salon-spec.mjs");

const ORIGIN = "https://salon.example";
const ac = (id, priority = "must", confirmed = true) => ({ id, title: `기준 ${id}`, given: "g", when: "w", then: `${id} 결과가 보인다`, priority, confirmed });

describe("parseAgentAction — LLM 출력은 검증된 행동만", () => {
  it("코드펜스·설명 섞인 답에서 행동을 꺼낸다", () => {
    const r = P.parseAgentAction('생각: 눌러야 함\n```json\n{"thought":"x","action":{"type":"click","target":{"role":"button","name":"예약하기"}}}\n```', ORIGIN);
    assert.equal(r.ok, true);
    assert.deepEqual(r.action, { type: "click", target: { role: "button", name: "예약하기" } });
  });
  it("다른 출처 goto · 허용 밖 키 · 긴 대기 · 대상 없는 클릭은 거절", () => {
    assert.equal(P.parseAgentAction({ type: "goto", path: "https://evil.example/x" }, ORIGIN).ok, false);
    assert.equal(P.parseAgentAction({ type: "goto", path: "javascript:alert(1)" }, ORIGIN).ok, false);
    assert.equal(P.parseAgentAction({ type: "press", key: "Control+A" }, ORIGIN).ok, false);
    assert.equal(P.parseAgentAction({ type: "wait", ms: 60000 }, ORIGIN).ok, false);
    assert.equal(P.parseAgentAction({ type: "click", target: { role: "button" } }, ORIGIN).ok, false);
    assert.equal(P.parseAgentAction({ type: "rm_rf" }, ORIGIN).ok, false);
  });
  it("같은 출처 상대 경로는 절대 주소로", () => {
    const r = P.parseAgentAction({ type: "goto", path: "/admin" }, ORIGIN + "/booking");
    assert.equal(r.ok && r.action.path, "https://salon.example/admin");
  });
  it("new_session · set_clock · login · judge", () => {
    assert.equal(P.parseAgentAction({ type: "new_session" }, ORIGIN).ok, true);
    const c = P.parseAgentAction({ type: "set_clock", iso: "2026-10-06T01:00:00+09:00" }, ORIGIN);
    assert.equal(c.ok && c.action.iso, "2026-10-05T16:00:00.000Z");
    assert.equal(P.parseAgentAction({ type: "login" }, ORIGIN).ok, true);
    const j = P.parseAgentAction({ type: "judge", verdict: "fail", reason: "다른 손님 화면에 예약이 없음", evidenceQuote: "예약 가능", reasonCode: "nope" }, ORIGIN);
    assert.equal(j.ok, true);
    assert.equal(j.action.reasonCode, undefined, "모르는 사유 코드는 버린다");
  });
});

describe("finalizeJudge — 증거 접지와 로그인 벽", () => {
  const corpus = "예약이 완료되었어요 10:30 김서연";
  it("관찰 기록에 있는 인용만 pass/fail로 인정", () => {
    assert.equal(P.finalizeJudge({ type: "judge", verdict: "pass", reason: "r", evidenceQuote: "예약이  완료되었어요" }, { corpus, loginGate: null, hasCredentials: false, locale: "ko" }).status, "pass");
    const fake = P.finalizeJudge({ type: "judge", verdict: "pass", reason: "r", evidenceQuote: "저장 성공" }, { corpus, loginGate: null, hasCredentials: false, locale: "ko" });
    assert.equal(fake.status, "not_verified");
    assert.equal(fake.reasonCode, "evidence_missing");
    const fakeFail = P.finalizeJudge({ type: "judge", verdict: "fail", reason: "r", evidenceQuote: "" }, { corpus, loginGate: null, hasCredentials: false, locale: "ko" });
    assert.equal(fakeFail.status, "not_verified", "지어낸 고장도 막는다");
  });
  it("로그인 벽 앞의 fail은 not_verified — 계정 없음/소셜/문자 인증 사유별", () => {
    const j = { type: "judge", verdict: "fail", reason: "관리 화면이 안 보임", evidenceQuote: "비밀번호" };
    const a = P.finalizeJudge(j, { corpus: "비밀번호", loginGate: "password", hasCredentials: false, locale: "ko" });
    assert.equal(a.status, "not_verified");
    assert.equal(a.reason, "로그인 필요 — 시험 계정을 주시면 들어가서 확인해요");
    assert.equal(P.finalizeJudge(j, { corpus: "x", loginGate: "oauth", hasCredentials: true, locale: "ko" }).reasonCode, "oauth_unsupported");
    assert.equal(P.finalizeJudge(j, { corpus: "x", loginGate: "sms", hasCredentials: true, locale: "ko" }).reasonCode, "sms_unsupported");
  });
  it("짐작한 주소의 '없음'은 고장 근거가 아니다(벤치마크 #1 로컬 실측)", () => {
    const f = P.finalizeJudge({ type: "judge", verdict: "fail", reason: "결과 화면 없음", evidenceQuote: "Page not found" }, { corpus: "Page not found", loginGate: null, hasCredentials: false, locale: "ko", onGuessedAddress: true });
    assert.equal(f.status, "not_verified");
    assert.equal(f.reasonCode, "guessed_address");
  });
  it("확인받지 않은 should 기준의 실패는 고칠 것·고침 지시에 넣지 않고 노트로", () => {
    const acs = [ac("AC-001"), ac("R-2", "should", false)];
    const results = [
      { id: "AC-001", status: "pass", reason: "ok", evidence: ["예약 완료"], steps: 3 },
      { id: "R-2", status: "fail", reason: "로딩 표시 없음", evidence: ["예약하기"], steps: 2 },
    ];
    const rep = P.buildAgentReport({ targetUrl: ORIGIN, intent: "i", acs, acSource: "inferred_at_run", results, sweep: null, signals: {}, loginDepth: "L1", loginMethod: "none" }, "ko");
    assert.equal(rep.findings.length, 0);
    assert.equal(P.buildAgentAcFixPrompt(rep, "ko"), "");
    assert.ok(rep.notes.some((n) => n.includes("고칠 것에 넣지 않음")));
  });
  it("detectLoginGate", () => {
    assert.equal(P.detectLoginGate({ hasPasswordField: true, text: "로그인" }), "password");
    assert.equal(P.detectLoginGate({ hasPasswordField: false, text: "카카오로 로그인" }), "oauth");
    assert.equal(P.detectLoginGate({ hasPasswordField: false, text: "Continue with Google" }), "oauth");
    assert.equal(P.detectLoginGate({ hasPasswordField: false, text: "인증번호를 입력하세요" }), "sms");
    assert.equal(P.detectLoginGate({ hasPasswordField: false, text: "예약하기" }), null);
  });
});

describe("decideAgentVerdict — 판정 사다리", () => {
  const acs = [ac("AC-001"), ac("AC-002"), ac("AC-003", "should")];
  const r = (id, status) => ({ id, status, reason: "r", evidence: [], steps: 1 });
  it("must 실패 하나 → Needs Fix", () => {
    assert.equal(P.decideAgentVerdict({ acs, results: [r("AC-001", "pass"), r("AC-002", "fail")] }).decision, "Needs Fix");
  });
  it("must 전부 통과(확인된 기준) → Ready / 추정 기준 → Conditionally Ready", () => {
    assert.equal(P.decideAgentVerdict({ acs, results: [r("AC-001", "pass"), r("AC-002", "pass"), r("AC-003", "fail")] }).decision, "Ready");
    const inferred = [ac("R-1", "must", false)];
    assert.equal(P.decideAgentVerdict({ acs: inferred, results: [r("R-1", "pass")] }).decision, "Conditionally Ready");
  });
  it("must 확인 못 함 → Not Verified (\"문제를 찾지 못했어요\" 금지)", () => {
    const v = P.decideAgentVerdict({ acs, results: [r("AC-001", "pass"), r("AC-002", "not_verified")] });
    assert.equal(v.decision, "Not Verified");
    const rep = P.buildAgentReport({ targetUrl: ORIGIN, intent: "i", acs, acSource: "confirmed_inferred", results: [r("AC-001", "pass"), r("AC-002", "not_verified")], sweep: null, signals: {}, loginDepth: "L1", loginMethod: "none" }, "ko");
    assert.notEqual(rep.verdict, "문제를 찾지 못했어요");
    assert.equal(rep.works, null);
  });
  it("must 없음 → Not Verified", () => {
    assert.equal(P.decideAgentVerdict({ acs: [ac("A", "should")], results: [r("A", "pass")] }).decision, "Not Verified");
  });
  it("화면 고장·버튼 오류 → Needs Fix(반응 없는 버튼은 판정 무영향)", () => {
    const ok = [r("AC-001", "pass"), r("AC-002", "pass")];
    const broken = { screens: [{ url: "/x", status: 500, ok: false, problem: "http_error" }], buttons: [], truncated: { screens: false, buttons: false, time: false } };
    assert.equal(P.decideAgentVerdict({ acs, results: ok, sweep: broken }).decision, "Needs Fix");
    const quiet = { screens: [{ url: "/", status: 200, ok: true }], buttons: [{ screen: "/", label: "장식", outcome: "no_reaction" }], truncated: { screens: false, buttons: false, time: false } };
    assert.equal(P.decideAgentVerdict({ acs, results: ok, sweep: quiet }).decision, "Ready");
  });
  it("없는 앱(404) → Needs Fix, AC는 app_missing", () => {
    const rep = P.buildAgentReport({ targetUrl: ORIGIN, intent: "i", acs, acSource: "interview", results: [], sweep: null, signals: { pageNotFound: true, loadStatus: 404 }, loginDepth: "L1", loginMethod: "none" }, "ko");
    assert.equal(rep.works, false);
    assert.ok(rep.acTable.every((x) => x.reasonCode === "app_missing"));
    assert.ok(rep.findings.some((f) => f.code === "page_not_found"), "#594 신호 유지");
  });
});

describe("리포트 · 고침 지시는 실제 실패에서만", () => {
  const acs = [ac("AC-001"), ac("AC-002"), ac("AC-003", "should")];
  const results = [
    { id: "AC-001", status: "pass", reason: "예약됨", evidence: ["예약 완료"], steps: 4 },
    { id: "AC-002", status: "fail", reason: "다른 손님 화면에서 10:30이 여전히 선택 가능", evidence: ["10:30 예약 가능"], steps: 7, actions: ["10:30 고르기", "다른 손님처럼 새 브라우저로 열기"] },
    { id: "AC-003", status: "not_verified", reason: P.reasonText("login_required"), reasonCode: "login_required", evidence: [], steps: 2 },
  ];
  const rep = P.buildAgentReport({ targetUrl: ORIGIN, intent: "미용실 예약", acs, acSource: "document", results, sweep: null, signals: {}, loginDepth: "L1", loginMethod: "none" }, "ko");
  it("AC 표 · 요약 · 출처 라벨 · 문서와 다름", () => {
    assert.equal(rep.engine, "agent");
    assert.deepEqual(rep.acTable.map((x) => x.status), ["pass", "fail", "not_verified"]);
    assert.equal(rep.acSummary.mustPass, 1);
    assert.equal(rep.agent.acSourceLabel, "올려 주신 기획서(문서)의 기준");
    assert.ok(rep.notes.some((n) => n.includes("생각하신 것과 달라요")));
    assert.ok(rep.notes.some((n) => n.startsWith("이렇게 이해하고 검사했어요")));
  });
  it("findings = 실패한 AC만(확인 못 한 AC는 노트)", () => {
    assert.equal(rep.findings.length, 1);
    assert.equal(rep.findings[0].code, "ac_broken");
    assert.match(rep.findings[0].what, /기준 AC-002/);
  });
  it("고침 지시: 실패 AC의 순서·기대·실제만, 실패가 없으면 빈 문자열", () => {
    const p = P.buildAgentAcFixPrompt(rep, "ko");
    assert.match(p, /AC-002/);
    assert.match(p, /다른 손님처럼 새 브라우저로 열기/);
    assert.doesNotMatch(p, /AC-001|AC-003/);
    const clean = P.buildAgentReport({ targetUrl: ORIGIN, intent: "i", acs: [ac("AC-001")], acSource: "interview", results: [results[0]], sweep: null, signals: {}, loginDepth: "L1", loginMethod: "none" }, "ko");
    assert.equal(P.buildAgentAcFixPrompt(clean, "ko"), "");
    assert.equal(clean.findings.length, 0);
  });
  it("EN 리포트에 한글 없음(기준 문장 제외)", () => {
    const en = P.buildAgentReport({ targetUrl: ORIGIN, intent: "booking", acs: [{ ...ac("AC-001"), title: "Booking", then: "booking shows" }], acSource: "interview", results: [{ id: "AC-001", status: "pass", reason: "seen", evidence: ["Booked"], steps: 2 }], sweep: null, signals: {}, loginDepth: "L1", loginMethod: "none" }, "en");
    assert.doesNotMatch(JSON.stringify({ v: en.verdict, o: en.oneLine, n: en.notes, s: en.nextSteps }), /[가-힣]/);
  });
});

describe("비밀 가림", () => {
  it("원문·URL 인코딩·JSON 이스케이프 변형까지, 깊은 객체 전부", () => {
    const secrets = ["owner@salon.kr", "p@ss \"word\"1"];
    const obj = { a: "로그인 owner@salon.kr 으로", b: ["?u=owner%40salon.kr"], c: { d: 'pw "p@ss \\"word\\"1"' } };
    const out = JSON.stringify(P.redactDeep(obj, secrets));
    assert.doesNotMatch(out, /owner@salon\.kr|owner%40salon|p@ss/);
    assert.ok(out.includes(P.REDACTED));
  });
  it("너무 짧은 값은 가림 기준으로 쓰지 않는다(본문 전체 파괴 방지)", () => {
    assert.equal(P.redactSecrets("abc def", ["a"]), "abc def");
  });
});

describe("화면·버튼 점검 — 상한과 안전", () => {
  const safe = (t) => !/삭제|결제|logout/i.test(t);
  it("같은 출처만 · 해시 무시 · 파일 제외 · 로그아웃 경로 제외 · 25개 상한", () => {
    const links = [
      { href: "/a#x" }, { href: "/a" }, { href: "https://other.example/" }, { href: "mailto:x@y" }, { href: "/file.pdf" }, { href: "/logout" },
      ...Array.from({ length: 40 }, (_, i) => ({ href: `/p${i}` })),
    ];
    const r = P.discoverSweepTargets(ORIGIN + "/", links, P.SWEEP_MAX_SCREENS, safe);
    assert.equal(r.targets.length, 25);
    assert.equal(r.truncated, true);
    assert.ok(r.targets.every((u) => u.startsWith(ORIGIN)));
    assert.ok(!r.targets.some((u) => /logout|pdf|#/.test(u)));
    assert.equal(r.targets.filter((u) => u.endsWith("/a")).length, 1);
  });
  it("버튼: 위험한 이름은 누르지 않고 기록, 화면당 8·남은 몫 상한, 이미 누른 이름 제외", () => {
    const labels = ["예약하기", "예약 삭제", "결제하기", "예약하기", ...Array.from({ length: 20 }, (_, i) => `버튼${i}`)];
    const r = P.selectSweepButtons(labels, { alreadyClicked: new Set(["버튼0"]), remaining: 60, isSafeText: safe });
    assert.deepEqual(r.skippedUnsafe, ["예약 삭제", "결제하기"]);
    assert.equal(r.click.length, P.SWEEP_MAX_BUTTONS_PER_SCREEN);
    assert.ok(!r.click.includes("버튼0"));
    assert.equal(P.selectSweepButtons(labels, { alreadyClicked: new Set(), remaining: 3, isSafeText: safe }).click.length, 3);
  });
  it("classifyScreen", () => {
    assert.equal(P.classifyScreen({ status: 500, bodyText: "x", newCrashes: 0 }).problem, "http_error");
    assert.equal(P.classifyScreen({ status: 401, bodyText: "로그인해 주세요", newCrashes: 0 }).ok, true);
    assert.equal(P.classifyScreen({ status: 200, bodyText: "", newCrashes: 0 }).problem, "blank");
    assert.equal(P.classifyScreen({ status: 200, bodyText: "Application error: a client-side exception", newCrashes: 0 }).problem, "error_text");
    assert.equal(P.classifyScreen({ status: 200, bodyText: "예약", newCrashes: 1 }).problem, "crash");
  });
});

describe("재검수는 같은 기준 · 지시서 AC 출처", () => {
  it("리포트에 남긴 AC 정의를 그대로 꺼낸다", () => {
    const acs = [ac("AC-001"), { ...ac("AC-002", "should", false), steps: ["예약 화면 열기"] }];
    const rep = P.buildAgentReport({ targetUrl: ORIGIN, intent: "i", acs, acSource: "confirmed_inferred", results: [], sweep: null, signals: {}, loginDepth: "L1", loginMethod: "none" }, "ko");
    assert.deepEqual(P.acsFromAgentReport(JSON.stringify(rep)), acs);
    assert.equal(P.acsFromAgentReport('{"engine":"classic"}'), null);
    assert.equal(P.acsFromAgentReport("not json"), null);
  });
  it("지시서 → AC: human 제외 · 기능 우선순위 · 역추론은 확인된 것만 confirmed", () => {
    // 역추론 지시서는 must AC가 전부 확인돼야 유효하다(D-2 amend) — 그래서 must 셋 모두 확인, should는 없음.
    const spec = salonSpec({ source: "inferred", confirmed: ["AC-001", "AC-002", "AC-003"] });
    const acs = agentAcsFromDevSpec(spec);
    assert.deepEqual(acs.map((a) => [a.id, a.priority, a.confirmed]), [["AC-001", "must", true], ["AC-002", "must", true], ["AC-003", "must", true]]);
    assert.deepEqual(acs[0].steps, ["/ 열기", "10:30 고르기", "예약하기 누름"]);
    assert.ok(!acs.some((a) => a.id === "AC-004"), "human 기준은 실행기가 하지 않는다");
    assert.equal(devSpecAcSource(spec, "code"), "confirmed_inferred");
    assert.equal(devSpecAcSource(salonSpec(), "spec"), "document");
    assert.equal(devSpecAcSource(salonSpec(), "idea"), "interview");
    assert.deepEqual(agentAcsFromDevSpec({ broken: true }), []);
  });
});

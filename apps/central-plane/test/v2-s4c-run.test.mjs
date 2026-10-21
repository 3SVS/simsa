// v2 S4c (2026-10-21) — 실행 고리 끝에서 끝: 정찰 → 즉시 고장 판정 → 정적 사실 → 계획 → 실행(증거물) → 기계 검증 → 리포트.
// 가짜 LLM이 프롬프트의 "Evidence so far"에서 실제 증거물 id를 골라 인용한다(검증기까지 진짜로 통과해야 한다).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAgentV2Inspection } = await import("../inspector-container/agent-v2-run.mjs");
const { makeFakeDriver } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://salon.example";
const A4 = { id: "A4", title: "예약하면 완료 화면에 예약 내용이 보인다", given: "날짜·시간·이름·휴대폰 번호를 넣었다", when: "예약한다", then: "완료 화면에 날짜·시간·이름이 보인다", priority: "must", confirmed: true };
const A3 = { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", given: "어떤 날짜·시간에 예약이 하나 있다", when: "다른 손님(새 브라우저)이 같은 날짜·시간을 고르려 한다", then: "그 시간은 고를 수 없다(이중 예약이 되지 않는다)", priority: "must", confirmed: true };

/** 같은 출처 파일들을 돌려주는 가짜 fetch(정찰용). */
function fakeFetch(files) {
  return async (url) => {
    const p = new URL(url).pathname;
    const f = files[p];
    return new Response(f?.body ?? "not found", { status: f?.status ?? 404, headers: { "content-type": p.endsWith(".js") ? "text/javascript" : "text/html" } });
  };
}

/** 브라우저에만 저장하는 미용실(gemini·claude 모양): 다른 브라우저에서는 이전 예약이 안 보여 같은 시간이 또 예약된다. */
function browserOnlySalon() {
  const site = {
    "/": (s) => ({ status: 200, text: `동네 미용실 예약 이름 휴대폰 10:30 예약하기${s.store.bookings ? ` 내 예약 ${s.store.bookings}` : ""}`, buttons: ["예약하기"] }),
    "/done": (s) => ({ status: 200, text: `예약이 완료되었어요 ${s.lastName ?? ""} 10:30` }),
  };
  const onAct = (action, s) => {
    if (action.type === "fill" && /이름/.test(action.target.label ?? "")) s.lastName = action.value;
    if (action.type === "click" && action.target.name === "예약하기" && s.fills.length > 0) {
      s.store.bookings = `${s.lastName} 10:30`;
      s.path = "/done";
    }
    return null;
  };
  return { site, onAct };
}

const RECON_FILES = {
  "/": { status: 200, body: '<!doctype html><html><body><h1>동네 미용실 예약</h1><script src="/app.js"></script></body></html>' },
  "/app.js": { status: 200, body: "function save(list){ localStorage.setItem('bookings', JSON.stringify(list)); }" },
};

/** 프롬프트의 증거물 목록에서 조건에 맞는 마지막 id. */
function lastId(prompt, re) {
  const ids = prompt.split("\n").filter((l) => re.test(l)).map((l) => /^(E\d+) ·/.exec(l)?.[1]).filter(Boolean);
  return ids.at(-1);
}
const reply = (action) => JSON.stringify({ thought: "t", action });

describe("정찰 단계", () => {
  it("첫 화면이 호스트 404면 LLM을 한 번도 부르지 않고 고장(원인) — 파일럿 Gemini 1차 모양", async () => {
    const netlify = "<html><body>Page not found Looks like you've followed a broken link or entered a URL that doesn't exist on this site.</body></html>";
    let calls = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "i", acs: [A4], llm: async () => { calls += 1; return "{}"; },
      driver: makeFakeDriver({}, { origin: ORIGIN }), fetchImpl: fakeFetch({ "/": { status: 404, body: netlify } }), testDataSeed: 1,
    });
    assert.equal(out.engine, "agent_v2");
    assert.equal(out.decision, "Needs Fix");
    assert.equal(out.entry.broken.cause, "missing_index_file");
    assert.equal(calls, 0);
    assert.equal(out.artifacts.artifacts[0].kind, "request");
  });
});

describe("계획 → 실행 → 기계 검증", () => {
  it("정적 사실(기기 저장) → 가설 H1이 A3 프롬프트에 실린다", async () => {
    const { site, onAct } = browserOnlySalon();
    const prompts = [];
    await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "미용실 예약", acs: [A3], fetchImpl: fakeFetch(RECON_FILES), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async ({ user, tier }) => { prompts.push({ user, tier }); return reply({ type: "judge", verdict: "not_verified", claim: "확인 못 함", artifactIds: [], quotes: [] }); },
    });
    assert.match(prompts[0].user, /- H1: 기록이 그 브라우저\(기기\)에만 저장돼 다른 손님·사장님 화면에서는 보이지 않는다/);
    assert.ok(prompts.every((p) => p.tier === "strong"), "V-5: 전부 강한 모델");
  });

  it("pass를 화면 글자만으로 내면 검증기가 기각하고 이유를 알려 준다 → 상태 변화 증거물을 인용하면 통과", async () => {
    const { site, onAct } = browserOnlySalon();
    const prompts = [];
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "미용실 예약", acs: [A4], fetchImpl: fakeFetch(RECON_FILES), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async ({ user }) => {
        prompts.push(user);
        turn += 1;
        if (turn === 1) return reply({ type: "fill", target: { label: "이름" }, value: "심사테스트" });
        if (turn === 2) return reply({ type: "fill", target: { label: "휴대폰" }, value: "010-1234-5678" });
        if (turn === 3) return reply({ type: "click", target: { role: "button", name: "예약하기" } });
        const done = lastId(user, /screen\(same\) · .*예약이 완료되었어요/);
        if (turn === 4) return reply({ type: "judge", verdict: "pass", claim: "완료 화면이 보인다", artifactIds: [done], quotes: ["예약이 완료되었어요"] });
        const stored = lastId(user, /storage\(changed\)/);
        return reply({ type: "judge", verdict: "pass", claim: "완료 화면이 보이고 예약이 저장됐다", artifactIds: [stored, done], quotes: ["예약이 완료되었어요"] });
      },
    });
    assert.ok(prompts.some((p) => /verifier rejected your pass: pass_without_state_change — show a state change/.test(p)), "기각 사유가 다음 턴에 보인다");
    const v = out.verdicts.find((x) => x.acId === "A4");
    assert.equal(v.verdict, "pass", JSON.stringify(v));
    assert.deepEqual(v.reasons, []);
    assert.equal(out.decision, "Ready");
  });

  it("이중 예약 fail은 별개 재실행 증거물이 있어야 통과 — 두 손님 모두 완료 화면이면 Needs Fix", async () => {
    const { site, onAct } = browserOnlySalon();
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "미용실 예약", acs: [A3], fetchImpl: fakeFetch(RECON_FILES), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async ({ user }) => {
        turn += 1;
        const script = [
          { type: "fill", target: { label: "이름" }, value: "심사테스트" },
          { type: "fill", target: { label: "휴대폰" }, value: "010-1234-5678" },
          { type: "click", target: { role: "button", name: "예약하기" } },
          { type: "new_session" },
          { type: "fill", target: { label: "이름" }, value: "심사테스트둘" },
          { type: "fill", target: { label: "휴대폰" }, value: "010-1234-5678" },
          { type: "click", target: { role: "button", name: "예약하기" } },
        ];
        if (turn <= script.length) return reply(script[turn - 1]);
        const first = lastId(user, /screen\(same\) · .*예약이 완료되었어요/);
        const second = lastId(user, /screen\(fresh\) · .*예약이 완료되었어요/);
        return reply({ type: "judge", verdict: "fail", claim: "다른 손님도 같은 10:30을 예약했다(이중 예약)", artifactIds: [first], reproArtifactIds: [second], quotes: ["예약이 완료되었어요"] });
      },
    });
    const v = out.verdicts.find((x) => x.acId === "A3");
    assert.equal(v.verdict, "fail", JSON.stringify(v));
    assert.equal(out.decision, "Needs Fix");
  });

  it("에이전트의 시계 이동은 거절되고(실행기 몫) 계속 거절하면 확인 못 함", async () => {
    const { site, onAct } = browserOnlySalon();
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "i", acs: [A4], fetchImpl: fakeFetch(RECON_FILES), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async () => reply({ type: "set_clock", iso: "2026-10-21T10:00:00+09:00" }),
    });
    const v = out.verdicts.find((x) => x.acId === "A4");
    assert.equal(v.verdict, "not_verified");
    assert.deepEqual(v.reasons, ["agent_error"]);
  });

  it("리포트에 증거물·계획·정적 사실이 실린다(판정의 근거를 다시 볼 수 있다)", async () => {
    const { site, onAct } = browserOnlySalon();
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "i", acs: [A3], fetchImpl: fakeFetch(RECON_FILES), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async () => reply({ type: "judge", verdict: "not_verified", claim: "확인 못 함", artifactIds: [], quotes: [] }),
    });
    assert.deepEqual(out.facts.map((f) => f.rule), ["R2"]);
    assert.equal(out.plan.hypotheses[0].cls, "client_only_storage");
    const kinds = new Set(out.artifacts.artifacts.map((a) => a.kind));
    for (const k of ["request", "source", "context", "screen"]) assert.ok(kinds.has(k), k);
  });
});

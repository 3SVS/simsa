// v2 S5 (2026-10-22) — 확인(V): 실행기가 판정 후보의 행동을 새 브라우저에서 **독립 재실행**해 같은 증거를 다시 얻는다(설계 §2.2-5, pass·fail·mismatch 모두).
// 판정(J): must의 의도 불일치(검증 통과)는 Needs Fix + intentMismatch. 소개 문구만 인용한 pass는 강등. 정찰 즉시 판정 때도 브라우저를 닫는다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAgentV2Inspection } = await import("../inspector-container/agent-v2-run.mjs");
const { makeFakeDriver } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://memo.example";
const AC = { id: "CORE-1", title: "메모 저장", given: "앱을 처음 연다", when: "메모를 쓰고 저장한다", then: "저장된 메모가 목록에 보인다", priority: "must", confirmed: true };
const RECON = { "/": { status: 200, body: "<!doctype html><html><body><h1>고객 메모</h1></body></html>" } };
function fakeFetch(files) {
  return async (url) => {
    const f = files[new URL(url).pathname];
    return new Response(f?.body ?? "not found", { status: f?.status ?? 404, headers: { "content-type": "text/html" } });
  };
}
const reply = (action) => JSON.stringify({ thought: "t", action });
/** 프롬프트 증거물 목록에서 조건에 맞는 마지막 id. */
const lastId = (prompt, re) => prompt.split("\n").filter((l) => re.test(l)).map((l) => /^(E\d+) ·/.exec(l)?.[1]).filter(Boolean).at(-1);

/** 저장을 눌러도 목록이 비어 있는 메모 앱(F3 포템킨 모양). flakyOnce면 첫 저장만 실패하고 그다음부터는 된다. */
function memoApp({ flakyOnce = false } = {}) {
  let saves = 0;
  const site = {
    "/": (s) => ({ status: 200, text: `고객 메모 저장 ${s.store.memo ? `목록: ${s.store.memo}` : "(아직 저장된 메모가 없습니다)"}`, buttons: ["저장"] }),
  };
  const onAct = (action, s) => {
    if (action.type === "click" && action.target.name === "저장") {
      saves += 1;
      if (flakyOnce && saves > 1) s.store.memo = "심사테스트";
    }
    return null;
  };
  return { site, onAct, saves: () => saves };
}
const script = [
  { type: "fill", target: { label: "메모" }, value: "심사테스트" },
  { type: "click", target: { role: "button", name: "저장" } },
];

describe("확인 — 실행기의 독립 재실행", () => {
  it("에이전트가 재현 없이 fail을 내도, 실행기가 새 브라우저에서 같은 행동을 다시 해 같은 글자를 얻으면 fail로 확정 — 옛 코드는 fail_not_reproduced 강등(F13)", async () => {
    const app = memoApp();
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "메모", acs: [AC], fetchImpl: fakeFetch(RECON), testDataSeed: 1,
      driver: makeFakeDriver(app.site, { origin: ORIGIN, onAct: app.onAct }),
      llm: async ({ user }) => {
        turn += 1;
        if (turn <= script.length) return reply(script[turn - 1]);
        const after = lastId(user, /screen\(same\) · .*아직 저장된 메모가 없습니다/);
        return reply({ type: "judge", verdict: "fail", claim: "저장해도 목록이 비어 있다", artifactIds: [after], quotes: ["(아직 저장된 메모가 없습니다)"] });
      },
    });
    const v = out.verdicts[0];
    assert.equal(v.verdict, "fail", JSON.stringify(v));
    assert.equal(v.confirmed, true);
    assert.ok(v.reproArtifactIds.length > 0);
    const confirmScreens = out.artifacts.artifacts.filter((a) => a.kind === "screen" && a.meta?.session === "confirm");
    assert.ok(confirmScreens.length > 0, "재실행 화면이 증거물로 남는다");
    assert.equal(app.saves(), 2, "같은 저장을 새 브라우저에서 한 번 더 눌렀다");
    assert.equal(out.decision, "Needs Fix");
  });

  it("재실행에서 같은 글자가 안 나오면(한 번만 난 실패) fail을 확정하지 않는다", async () => {
    const app = memoApp({ flakyOnce: true });
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "메모", acs: [AC], fetchImpl: fakeFetch(RECON), testDataSeed: 1,
      driver: makeFakeDriver(app.site, { origin: ORIGIN, onAct: app.onAct }),
      llm: async ({ user }) => {
        turn += 1;
        if (turn <= script.length) return reply(script[turn - 1]);
        const after = lastId(user, /screen\(same\) · .*아직 저장된 메모가 없습니다/);
        return reply({ type: "judge", verdict: "fail", claim: "저장해도 목록이 비어 있다", artifactIds: [after], quotes: ["(아직 저장된 메모가 없습니다)"] });
      },
    });
    const v = out.verdicts[0];
    assert.equal(v.verdict, "not_verified");
    assert.equal(v.originalVerdict, "fail");
    assert.ok(v.reasons.includes("fail_not_reproduced"), v.reasons.join(","));
    assert.equal(out.decision, "Not Verified");
  });
});

describe("판정", () => {
  it("must 의도 불일치(재실행 확인됨)는 Needs Fix + intentMismatch — 옛 코드는 Not Verified(F10·F11)", async () => {
    const site = { "/": (s) => ({ status: 200, text: `내 서비스 점검 ${s.clicked ? "점수 78점 — 검사 완료" : "주소를 넣으세요"}`, buttons: ["검사하기"] }) };
    const onAct = (a, s) => {
      if (a.type === "click") s.clicked = true;
      return null;
    };
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "주소를 넣으면 실제로 열어 검토", acs: [AC], fetchImpl: fakeFetch(RECON), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async ({ user }) => {
        turn += 1;
        if (turn === 1) return reply({ type: "fill", target: { label: "주소" }, value: "https://a.example" });
        if (turn === 2) return reply({ type: "click", target: { role: "button", name: "검사하기" } });
        const res = lastId(user, /screen\(same\) · .*점수 78점/);
        return reply({ type: "judge", verdict: "mismatch", claim: "주소를 열어 보지 않고 늘 같은 점수를 보여 준다", artifactIds: [res], quotes: ["점수 78점"] });
      },
    });
    assert.equal(out.verdicts[0].verdict, "mismatch", JSON.stringify(out.verdicts[0]));
    assert.equal(out.verdicts[0].confirmed, true);
    assert.equal(out.decision, "Needs Fix");
    assert.deepEqual(out.intentMismatch, ["CORE-1"]);
  });

  it("소개 문구만 인용한 pass는 강등(화면 이동은 상태 변화처럼 보여도)", async () => {
    const site = {
      "/": { status: 200, text: "동네 미용실 — 온라인으로 쉽게 예약하세요", buttons: ["예약하기"] },
      "/book": { status: 200, text: "동네 미용실 — 온라인으로 쉽게 예약하세요 날짜를 고르세요" },
    };
    const onAct = (a, s) => {
      if (a.type === "click") s.path = "/book";
      return null;
    };
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "예약", acs: [AC], fetchImpl: fakeFetch(RECON), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async ({ user }) => {
        turn += 1;
        if (turn === 1) return reply({ type: "click", target: { role: "button", name: "예약하기" } });
        const nav = lastId(user, /diff\(changed\)/);
        const book = lastId(user, /screen\(same\) · same \/book/);
        return reply({ type: "judge", verdict: "pass", claim: "온라인 예약이 된다", artifactIds: [nav, book], quotes: ["온라인으로 쉽게 예약하세요"] });
      },
    });
    assert.equal(out.verdicts[0].verdict, "not_verified");
    assert.ok(out.verdicts[0].reasons.includes("pass_quotes_only_initial_screen"), out.verdicts[0].reasons.join(","));
    assert.equal(out.decision, "Not Verified");
  });

  it("마감 시각 오독 fail은 확인 못 함으로 내리고, 실패는 결함 묶음(defectGroups)으로도 낸다", async () => {
    const A1 = { id: "A1", title: "10:00~19:00, 30분 단위로 시간 선택", given: "날짜를 골랐다", when: "시간 목록을 본다", then: "오전 10시부터 오후 7시까지 30분 단위 시간을 고를 수 있다", priority: "must", confirmed: true };
    const site = { "/": (s) => ({ status: 200, text: `시간 10:00 … 18:30 ${s.clicked ? "선택 완료" : ""}`, buttons: ["시간 보기"] }) };
    const onAct = (a, s) => {
      if (a.type === "click") s.clicked = true;
      return null;
    };
    let turn = 0;
    const out = await runAgentV2Inspection({
      targetUrl: `${ORIGIN}/`, intent: "예약", acs: [A1], fetchImpl: fakeFetch(RECON), testDataSeed: 1,
      driver: makeFakeDriver(site, { origin: ORIGIN, onAct }),
      llm: async ({ user }) => {
        turn += 1;
        if (turn === 1) return reply({ type: "click", target: { role: "button", name: "시간 보기" } });
        const s = lastId(user, /screen\(same\) · .*18:30/);
        return reply({ type: "judge", verdict: "fail", claim: "시간이 18:30까지만 있고 19:00은 고를 수 없다", artifactIds: [s], quotes: ["18:30"] });
      },
    });
    const v = out.verdicts[0];
    assert.equal(v.verdict, "not_verified", JSON.stringify(v));
    assert.ok(v.reasons.includes("closing_slot_interpretation"));
    assert.equal(out.decision, "Not Verified");
    assert.deepEqual(out.defectGroups, []);
  });

  it("첫 화면에서 바로 고장이어도 브라우저를 닫는다 — 옛 코드는 열린 채 돌아와 하네스가 끝나지 않았다(S4d 실측)", async () => {
    const driver = makeFakeDriver({}, { origin: ORIGIN });
    let closed = 0;
    driver.close = async () => {
      closed += 1;
    };
    const out = await runAgentV2Inspection({ targetUrl: `${ORIGIN}/`, intent: "i", acs: [AC], fetchImpl: fakeFetch({}), driver, llm: async () => "{}", testDataSeed: 1 });
    assert.equal(out.decision, "Needs Fix");
    assert.equal(closed, 1);
  });
});

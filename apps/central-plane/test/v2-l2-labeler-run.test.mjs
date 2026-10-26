// train L2 (2026-10-27) — 라벨러 모드: 같은 v2 실행기를 라벨링 에이전트로 쓴다(라벨링 설계 §0.0).
//   ① 블라인드(§5-1): 검수 엔진의 정적 사실·가설·이전 계획을 보지 않는다 — 앱 주소·기준·테스트 데이터만
//   ② 재현성(R, §3): 확정된 실패는 실행기가 새 브라우저에서 n번(기본 3) 다시 해 k/n을 센다
//   ③ 고치기는 하지 않는다(라벨만)
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAgentV2Inspection } = await import("../inspector-container/agent-v2-run.mjs");
const { makeFakeDriver } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://memo.example";
const AC = { id: "CORE-1", title: "메모 저장", given: "앱을 처음 연다", when: "메모를 쓰고 저장한다", then: "저장된 메모가 목록에 보인다", priority: "must", confirmed: true };
// 브라우저에만 저장하는 코드 — 검수 엔진은 여기서 정적 사실·가설을 세운다.
const RECON = {
  "/": { status: 200, body: '<!doctype html><html><body><h1>고객 메모</h1><script src="/app.js"></script></body></html>' },
  "/app.js": { status: 200, body: "function save(list){ localStorage.setItem('memos', JSON.stringify(list)); }" },
};
function fakeFetch(files) {
  return async (url) => {
    const f = files[new URL(url).pathname];
    return new Response(f?.body ?? "not found", { status: f?.status ?? 404, headers: { "content-type": "text/html" } });
  };
}
const reply = (action) => JSON.stringify({ thought: "t", action });
const lastId = (prompt, re) => prompt.split("\n").filter((l) => re.test(l)).map((l) => /^(E\d+) ·/.exec(l)?.[1]).filter(Boolean).at(-1);

/** 저장을 눌러도 목록이 비는 메모 앱. worksFrom=N이면 N번째 저장부터는 된다(가끔 나는 실패). */
function memoApp({ worksFrom = Infinity } = {}) {
  let saves = 0;
  const site = {
    "/": (s) => ({ status: 200, text: `고객 메모 저장 ${s.store.memo ? `목록: ${s.store.memo}` : "(아직 저장된 메모가 없습니다)"}`, buttons: ["저장"] }),
  };
  const onAct = (action, s) => {
    if (action.type === "click" && action.target.name === "저장") {
      saves += 1;
      if (saves >= worksFrom) s.store.memo = "심사테스트";
    }
    return null;
  };
  return { site, onAct, saves: () => saves };
}
const script = [
  { type: "fill", target: { label: "메모" }, value: "심사테스트" },
  { type: "click", target: { role: "button", name: "저장" } },
];
function failingAgent(prompts) {
  let turn = 0;
  return async ({ user }) => {
    prompts?.push(user);
    turn += 1;
    if (turn <= script.length) return reply(script[turn - 1]);
    const after = lastId(user, /screen\(same\) · .*아직 저장된 메모가 없습니다/);
    return reply({ type: "judge", verdict: "fail", claim: "저장해도 목록이 비어 있다", artifactIds: [after], quotes: ["(아직 저장된 메모가 없습니다)"] });
  };
}
const run = (app, extra = {}) =>
  runAgentV2Inspection({
    targetUrl: `${ORIGIN}/`, intent: "메모", acs: [AC], fetchImpl: fakeFetch(RECON), testDataSeed: 1,
    driver: makeFakeDriver(app.site, { origin: ORIGIN, onAct: app.onAct }), ...extra,
  });

describe("라벨러 모드 — 블라인드", () => {
  it("검수 엔진은 정적 사실·가설을 세우지만, 라벨러는 아무것도 세우지 않고 프롬프트에도 가설이 없다", async () => {
    const engine = await run(memoApp(), { llm: failingAgent() });
    assert.ok(engine.facts.length > 0, "대조군: 엔진은 브라우저 저장 사실을 본다");
    assert.ok(engine.plan.hypotheses.length > 0, "대조군: 엔진은 가설을 세운다");

    const prompts = [];
    const lab = await run(memoApp(), { llm: failingAgent(prompts), profile: "labeler" });
    assert.equal(lab.profile, "labeler");
    assert.deepEqual(lab.facts, []);
    assert.equal(lab.plan.hypotheses.length, 0);
    assert.ok(!lab.artifacts.artifacts.some((a) => a.kind === "source"), "정적 사실 증거물이 없다");
    assert.ok(prompts.every((p) => !/localStorage/.test(p)), "프롬프트에 엔진 분석이 새지 않는다");
  });

  it("이전 런의 계획(previousPlan)을 줘도 라벨러는 쓰지 않는다", async () => {
    const engine = await run(memoApp(), { llm: failingAgent() });
    const lab = await run(memoApp(), { llm: failingAgent(), profile: "labeler", previousPlan: engine.plan });
    assert.equal(lab.plan.hypotheses.length, 0);
    assert.ok(!lab.artifacts.artifacts.some((a) => /계획 재사용/.test(a.summary)));
  });
});

describe("라벨러 모드 — 재현성(R)", () => {
  it("늘 나는 실패: 확정 뒤 새 브라우저에서 3번 → repro 3/3, 저장은 에이전트 1 + 재실행 3 = 4번", async () => {
    const app = memoApp();
    const out = await run(app, { llm: failingAgent(), profile: "labeler" });
    const v = out.verdicts[0];
    assert.equal(v.verdict, "fail", JSON.stringify(v));
    assert.equal(v.confirmed, true);
    assert.deepEqual(v.repro, { k: 3, n: 3 });
    assert.equal(app.saves(), 4);
  });

  it("세 번째 저장부터 되는 앱: 첫 재실행은 재현(확정), 두 번째부터는 안 남 → repro 1/3", async () => {
    const app = memoApp({ worksFrom: 3 });
    const out = await run(app, { llm: failingAgent(), profile: "labeler" });
    const v = out.verdicts[0];
    assert.equal(v.verdict, "fail");
    assert.deepEqual(v.repro, { k: 1, n: 3 });
  });

  it("reproRuns로 횟수를 바꾼다(상한 5) · 검수 엔진 모드에는 repro가 없다(옛 동작 그대로)", async () => {
    const lab = await run(memoApp(), { llm: failingAgent(), profile: "labeler", reproRuns: 2 });
    assert.deepEqual(lab.verdicts[0].repro, { k: 2, n: 2 });
    const engine = await run(memoApp(), { llm: failingAgent() });
    assert.equal(engine.verdicts[0].repro, undefined);
    assert.equal(engine.verdicts[0].confirmed, true);
  });
});

describe("라벨러 모드 — 첫 화면 즉시 고장", () => {
  it("(실측 F5·F9·F14 2026-10-27) 일찍 끝난 반환에도 라벨러 표지가 붙는다 — 옛 코드는 표지가 없어 라벨이 통째로 버려졌다", async () => {
    const out = await run(memoApp(), { llm: failingAgent(), profile: "labeler", fetchImpl: fakeFetch({ "/": { status: 404, body: "Not Found" } }) });
    assert.ok(out.entry?.broken, "전제: 첫 화면 즉시 고장");
    assert.equal(out.profile, "labeler");
  });
});

describe("라벨러 모드 — 고치기 없음", () => {
  it("확정된 must 실패가 있어도 고치기를 시도하지 않는다", async () => {
    const out = await run(memoApp(), { llm: failingAgent(), profile: "labeler" });
    assert.deepEqual(out.fix, { attempted: false, reason: "labeler_profile" });
    assert.equal(out.decision, "Needs Fix");
  });
});

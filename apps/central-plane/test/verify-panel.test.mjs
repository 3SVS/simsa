import { describe, it } from "node:test";
import assert from "node:assert/strict";

// RC-2 검증 패널 (2026-07-17, design: docs/simsa-review-consensus-design-2026-07-17.md):
// failed 판정만 교차 확인, 동의→dual_confirmed, 불일치→inconclusive 강등+양관점,
// 실패→single 정직 표기. passed 등은 절대 건드리지 않는다.

const { applyVerifyPanel } = await import("../dist/workspace/verify-panel.js");

const SPEC = {
  productName: "테스트 앱", oneLine: "테스트", targetUsers: [], problem: "p",
  included: ["기능 A"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [],
};

const item = (id, status) => ({
  itemId: id, status, title: `항목 ${id}`,
  userLabel: status === "failed" ? "안 맞음" : "통과",
  reason: "제외 범위 충돌", evidence: ["결제"], nextAction: "확인",
});

const resp = (results) => ({
  ok: true, source: "llm",
  summary: {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: 0,
  },
  results,
});

/** OpenAI-shaped fetch stub returning the given opinion (or an HTTP error). */
function stubFetch(opinion, log = []) {
  return async (url, init) => {
    log.push(String(url));
    if (opinion === "http_error") return new Response("err", { status: 500 });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(opinion) } }],
    }), { status: 200 });
  };
}

const ENV = { OPENAI_API_KEY: "k" };

describe("applyVerifyPanel — RC-2", () => {
  it("agreement → status kept, verification dual_confirmed, summary unchanged", async () => {
    const out = await applyVerifyPanel(
      resp([item("a", "failed"), item("b", "passed")]), SPEC, ENV,
      { fetchImpl: stubFetch({ supported: true, note_ko: "동의" }) },
    );
    assert.equal(out.results[0].status, "failed");
    assert.equal(out.results[0].verification, "dual_confirmed");
    assert.equal(out.results[1].verification, undefined, "passed items untouched");
    assert.equal(out.summary.failed, 1);
  });

  it("disagreement → downgraded to inconclusive with BOTH perspectives, summary recomputed", async () => {
    const out = await applyVerifyPanel(
      resp([item("a", "failed")]), SPEC, ENV,
      { fetchImpl: stubFetch({ supported: false, note_ko: "충돌 근거 약함" }) },
    );
    const r = out.results[0];
    assert.equal(r.status, "inconclusive");
    assert.equal(r.userLabel, "확인 부족");
    assert.equal(r.verification, "downgraded");
    assert.match(r.reason, /1차 판단/);
    assert.match(r.reason, /충돌 근거 약함/);
    assert.equal(out.summary.failed, 0);
    assert.equal(out.summary.inconclusive, 1);
  });

  it("second-opinion failure → original verdict kept, honest 'single' tag (never silent dual)", async () => {
    const out = await applyVerifyPanel(
      resp([item("a", "failed")]), SPEC, { OPENAI_API_KEY: "k" },
      { fetchImpl: stubFetch("http_error") },
    );
    assert.equal(out.results[0].status, "failed");
    assert.equal(out.results[0].verification, "single");
  });

  it("no vendor keys at all → single tag, no fetch calls", async () => {
    const log = [];
    const out = await applyVerifyPanel(
      resp([item("a", "failed")]), SPEC, {},
      { fetchImpl: stubFetch({ supported: true }, log) },
    );
    assert.equal(out.results[0].verification, "single");
    assert.equal(log.length, 0);
  });

  it("cap: only maxChecks failed items get cross-checked", async () => {
    const log = [];
    const many = resp(["a", "b", "c", "d", "e", "f", "g"].map((id) => item(id, "failed")));
    const out = await applyVerifyPanel(many, SPEC, ENV, {
      maxChecks: 5,
      fetchImpl: stubFetch({ supported: true, note_ko: "" }, log),
    });
    assert.equal(log.length, 5);
    assert.equal(out.results.filter((r) => r.verification === "dual_confirmed").length, 5);
    assert.equal(out.results.filter((r) => r.verification === undefined).length, 2);
  });

  it("nothing failed → response returned untouched, zero calls", async () => {
    const log = [];
    const input = resp([item("a", "passed")]);
    const out = await applyVerifyPanel(input, SPEC, ENV, { fetchImpl: stubFetch({ supported: true }, log) });
    assert.equal(log.length, 0);
    assert.deepEqual(out, input);
  });

  it("RC-5: emits a vendor-tagged llm_usage log line per second-opinion call", async (t) => {
    const lines = [];
    const realLog = console.log;
    t.after(() => { console.log = realLog; });
    console.log = (s) => { lines.push(String(s)); };

    await applyVerifyPanel(
      resp([item("a", "failed")]), SPEC, ENV,
      { fetchImpl: stubFetch({ supported: true, note_ko: "" }) },
    );

    const usage = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && o.event === "llm_usage");
    assert.equal(usage.length, 1);
    assert.equal(usage[0].vendor, "openai");
    assert.equal(usage[0].call_site, "verify-panel");
  });

  it("G5: context-generalized panel works on PR-review-shaped responses (usage field survives)", async () => {
    const { applyVerifyPanelWithContext } = await import("../dist/workspace/verify-panel.js");
    const prResp = {
      ...resp([item("a", "failed")]),
      usage: { tokens_consumed: 123, model_used: "m" },
    };
    const out = await applyVerifyPanelWithContext(
      prResp,
      { label: "PR changes", text: "diff --git a/x b/x", judgeRule: "supported=true ONLY if the PR clearly fails to implement the item." },
      ENV,
      { fetchImpl: stubFetch({ supported: false, note_ko: "diff에 구현이 보임" }) },
    );
    assert.equal(out.results[0].status, "inconclusive");
    assert.equal(out.results[0].verification, "downgraded");
    assert.match(out.results[0].reason, /diff에 구현이 보임/);
    assert.deepEqual(out.usage, { tokens_consumed: 123, model_used: "m" });
  });

  it("uses the CF AI Gateway URL when configured (Worker direct egress 403 trap)", async () => {
    const log = [];
    await applyVerifyPanel(
      resp([item("a", "failed")]), SPEC,
      { OPENAI_API_KEY: "k", CF_AI_GATEWAY_OPENAI_URL: "https://gw.example/openai" },
      { fetchImpl: stubFetch({ supported: true, note_ko: "" }, log) },
    );
    assert.match(log[0], /^https:\/\/gw\.example\/openai\/chat\/completions$/);
  });
});

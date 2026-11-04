// train L3 (2026-11-02) — 라벨러 프로덕션 연결: 직원 런 수동 실행 · 패스별 벤더 고정(대체 금지) · 전용 콜백 · 일치도(숫자만).
// 실제 라우트 + 실제 SQLite(마이그레이션 전부). 가짜는 경계에만: 컨테이너 DO · 벤더 fetch.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSqliteD1, SQLITE_SKIP } from "./_sqlite-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { buildV2Report } = await import("../dist/v2-report.js");
const { mintRunToken, agentSpendTodayUsd } = await import("../dist/workspace/inspection-agent.js");
const { labelerRunOptions } = await import("../inspector-container/agent-v2-run.mjs");

const STAFF = "uk_staff_bench";
const FREE = "uk_free_user";
const ICT = "ict_test_token";
const KEK = Buffer.alloc(32, 7).toString("base64");
const BASE = "https://central.test";
const SITE = "https://salon.example/";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const auth = { authorization: `Bearer ${ICT}` };

const ACS = [
  { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", given: "예약이 있다", when: "다른 손님이 연다", then: "그 시간은 고를 수 없다", priority: "must", confirmed: true },
  { id: "A4", title: "예약하면 완료 화면이 보인다", given: "처음", when: "예약한다", then: "완료 화면", priority: "must", confirmed: true },
];

/** 끝난 직원 런의 리포트. 기준에 판정 칸이 섞여 있어도 라벨러에게는 안 가야 한다. */
const sourceReport = () => ({
  engine: "agent",
  engineVersion: "v2",
  agent: { builder: "lovable", acs: ACS.map((a) => ({ ...a, status: "fail", engineNote: "엔진분석비밀" })) },
  v2: { plan: { hypotheses: [{ id: "H1", text: "엔진가설비밀" }] }, verdicts: [] },
});

function labelerReport({ a3 = "fail" } = {}) {
  const result = {
    engine: "agent_v2", runnerRev: "agent-v2-1", profile: "labeler", targetUrl: SITE, decision: "Needs Fix",
    intentMismatch: [], defectGroups: [], fix: { attempted: false, reason: "labeler_profile" },
    actions: { A3: ['"예약하기" 누르기', "새 브라우저(다른 손님)"], A4: ['"예약하기" 누르기'] },
    entry: { broken: null }, facts: [], plan: { hypotheses: [], acPlans: [] },
    verdicts: [
      a3 === "fail"
        ? { acId: "A3", verdict: "fail", confirmed: true, repro: { k: 3, n: 3 }, reasons: [], claim: "다른 손님에게 10:30이 비공개화면글자 열려 있다", quotes: ["10:30 예약 가능"], artifactIds: ["E9"] }
        : { acId: "A3", verdict: "pass", confirmed: true, reasons: [], claim: "막혀 있다", quotes: ["예약 불가"], artifactIds: ["E5"] },
      { acId: "A4", verdict: "pass", confirmed: true, reasons: [], claim: "완료 화면이 보인다", quotes: ["예약이 완료되었어요"], artifactIds: ["E5"] },
    ],
    artifacts: {
      artifacts: [
        { id: "E5", kind: "screen", summary: "same /done: 예약이 완료되었어요 예약 불가", raw: "예약이 완료되었어요 예약 불가", meta: {} },
        { id: "E9", kind: "screen", summary: "fresh /book: 10:30 예약 가능", raw: "10:30 예약 가능", meta: {} },
      ],
    },
  };
  return buildV2Report(result, { targetUrl: SITE, intent: "예약", acs: ACS, acSource: "confirmed_inferred" }).report;
}

function setup({ vendor } = {}) {
  const opened = openSqliteD1();
  const { db, d1 } = opened;
  const dispatched = [];
  const vendorCalls = [];
  const INSPECTOR = {
    idFromName: (n) => n,
    get: () => ({
      async fetch(_url, init) {
        dispatched.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
      },
    }),
  };
  const defaultVendor = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).includes("chat/completions")) {
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ model: body.model, content: [{ type: "text", text: "{}" }], usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const fetchImpl = async (url, init) => {
    vendorCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return (vendor ?? defaultVendor)(url, init);
  };
  const env = {
    DB: d1,
    INSPECTOR,
    INTERNAL_CALLBACK_TOKEN: ICT,
    CONCLAVE_TOKEN_KEK: KEK,
    ANTHROPIC_API_KEY: "test-anthropic-key",
    OPENAI_API_KEY: "test-openai-key",
    // 프로덕션과 같은 값: 검수 프록시는 곧장 OpenAI로 간다 — 라벨러 B 패스는 그래도 Anthropic이어야 한다.
    ANTHROPIC_ENABLED: "off",
    INSPECTION_ENABLED: "on",
    PUBLIC_BASE_URL: BASE,
    // ★프로덕션 모양: CENTRAL_CACHE(KV)는 wrangler.toml에 바인딩이 없다. 예전 모크가 KV를 줘서
    // "상태 = KV 메모"가 테스트에선 통과하고 프로덕션에선 늘 running_or_unknown이었다(2026-11-04 첫 실행).
  };
  const app = createApp({ fetch: fetchImpl });
  const call = (path, init = {}) => app.fetch(new Request(BASE + path, init), env, ctx);
  const post = (path, body, headers = auth) => call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO plan_grants (user_key, plan, note, created_at) VALUES (?, 'staff', 'test', ?)`).run(STAFF, now);
  db.prepare(`INSERT INTO privacy_prefs (user_key, ops_meta, updated_at) VALUES (?, 'on', ?)`).run(STAFF, now);
  const addRun = (id, { userKey = STAFF, status = "done", report = sourceReport() } = {}) =>
    db.prepare(
      `INSERT INTO workspace_visual_checks (id, project_id, user_key, target_url, intent, decision, works, status, executor, report_json, evidence_keys_json, locale, created_at, updated_at)
       VALUES (?, 'pp', ?, ?, '예약', 'Needs Fix', 0, ?, 'container', ?, '[]', 'ko', ?, ?)`,
    ).run(id, userKey, SITE, status, JSON.stringify(report), now, now);
  return { ...opened, db, env, post, call, dispatched, vendorCalls, addRun };
}

describe("라벨러 실행 — 직원 런만 · 블라인드", { skip: SQLITE_SKIP }, () => {
  it("끝난 v2 직원 런 → 패스마다 잡 1개. 페이로드는 주소·의도·기준뿐이고 원 런의 분석·판정이 없다. 검수 행은 새로 안 생긴다", async () => {
    const t = setup();
    t.addRun("vc_1");
    const r = await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A", "B"] });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).passes, [{ pass: "A", status: "dispatched" }, { pass: "B", status: "dispatched" }]);
    assert.equal(t.dispatched.length, 2);
    const p = t.dispatched[0];
    assert.equal(p.runId, "lab_vc_1_A");
    assert.equal(p.callbackUrl, `${BASE}/internal/labeler-done`);
    assert.equal(p.runningUrl, undefined);
    assert.equal(p.agent.profile, "labeler");
    assert.equal(p.agent.reproRuns, 3);
    assert.equal(p.agent.previousPlan, undefined);
    assert.ok(p.agent.llmToken.startsWith("ilb1."));
    assert.deepEqual(p.agent.acs.map((a) => a.id), ["A3", "A4"]);
    const wire = JSON.stringify(p);
    assert.ok(!/엔진분석비밀|엔진가설비밀|"status":"fail"/.test(wire), "원 런 분석·판정이 새지 않는다");
    assert.equal(t.db.prepare(`SELECT COUNT(*) AS n FROM workspace_visual_checks`).get().n, 1);
    const again = await (await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A"] })).json();
    assert.deepEqual(again.passes, [{ pass: "A", status: "already_started" }]);
    assert.equal(t.dispatched.length, 2, "다시 눌러도 돈을 또 쓰지 않는다");
  });

  it("거절: 내부 토큰 없음 401 · 사용자 런 403 · 안 끝난 런 409 · v2 아님 409 · 라벨러 리포트 409 · 없는 런 404", async () => {
    const t = setup();
    t.addRun("vc_free", { userKey: FREE });
    t.addRun("vc_busy", { status: "running" });
    t.addRun("vc_v1", { report: { engine: "agent", agent: { acs: ACS } } });
    t.addRun("vc_lab", { report: { ...sourceReport(), v2: { profile: "labeler" } } });
    const go = (runId, headers = auth) => t.post("/admin/labeler-runs", { runId, passes: ["A"] }, headers);
    assert.equal((await go("vc_free", {})).status, 401);
    const free = await go("vc_free");
    assert.equal(free.status, 403);
    assert.equal((await free.json()).error, "staff_runs_only");
    assert.equal((await go("vc_busy")).status, 409);
    assert.equal((await go("vc_v1")).status, 409);
    assert.equal((await go("vc_lab")).status, 409);
    assert.equal((await go("vc_none")).status, 404);
    assert.equal(t.dispatched.length, 0);
  });

  it("실행기: profile이 문자 그대로 labeler일 때만 라벨러 옵션", () => {
    assert.deepEqual(labelerRunOptions({ profile: "labeler", reproRuns: 3 }), { profile: "labeler", reproRuns: 3 });
    assert.deepEqual(labelerRunOptions({ profile: "Labeler" }), {});
    assert.deepEqual(labelerRunOptions({}), {});
    assert.deepEqual(labelerRunOptions(undefined), {});
    // 컨테이너 진입점이 이 옵션을 실행기에 실제로 넘기는지(없으면 라벨러 잡이 검수 엔진으로 돈다).
    const server = readFileSync(new URL("../inspector-container/server.mjs", import.meta.url), "utf8");
    assert.match(server, /runAgentV2Inspection\(\{[\s\S]*?\.\.\.labelerRunOptions\(agent\)/);
  });
});

describe("LLM 프록시 — 패스별 벤더 고정, 대체 금지", { skip: SQLITE_SKIP }, () => {
  const LLM = "/internal/inspect-llm/v1/messages";
  const ask = async (t, jobId, kind = "labeler") => {
    const token = await mintRunToken(t.env, kind, jobId);
    return t.post(LLM, { system: "s", user: "u", maxTokens: 700, tier: "cheap" }, { authorization: `Bearer ${token}` });
  };
  const start = async (t, passes) => {
    t.addRun("vc_1");
    await t.post("/admin/labeler-runs", { runId: "vc_1", passes });
  };

  it("A = OpenAI gpt-5.6-sol만 · B = Anthropic opus-5-5만(effort high·max_tokens≥8000). 프로덕션의 Anthropic 끔 설정과 무관, 원장은 전용 호출 지점이라 사용자 하루 예산을 안 쓴다", async () => {
    const t = setup();
    await start(t, ["A", "B"]);
    const a = await ask(t, "lab_vc_1_A");
    assert.equal(a.status, 200);
    assert.ok(t.vendorCalls[0].url.includes("chat/completions"));
    assert.equal(t.vendorCalls[0].body.model, "gpt-5.6-sol");
    const b = await ask(t, "lab_vc_1_B");
    assert.equal(b.status, 200);
    assert.ok(t.vendorCalls[1].url.includes("anthropic"), t.vendorCalls[1].url);
    assert.equal(t.vendorCalls[1].body.model, "claude-opus-5-5");
    assert.equal(t.vendorCalls[1].body.max_tokens, 8000);
    assert.deepEqual(t.vendorCalls[1].body.output_config, { effort: "high" });
    const sites = t.db.prepare(`SELECT DISTINCT call_site FROM llm_usage`).all().map((r) => r.call_site);
    assert.deepEqual(sites, ["inspect_labeler"]);
    assert.equal(await agentSpendTodayUsd(t.env), 0);
  });

  it("B의 Anthropic이 막히면(403) OpenAI로 넘어가지 않고 그 패스가 실패한다 · A의 OpenAI가 죽으면 Anthropic으로 안 넘어간다", async () => {
    const t = setup({ vendor: async () => new Response("nope", { status: 403 }) });
    await start(t, ["A", "B"]);
    assert.equal((await ask(t, "lab_vc_1_B")).status, 502);
    assert.ok(t.vendorCalls.length > 0);
    assert.ok(t.vendorCalls.every((c) => !c.url.includes("chat/completions")), "B는 OpenAI를 부르지 않는다");
    t.vendorCalls.length = 0;
    assert.equal((await ask(t, "lab_vc_1_A")).status, 502);
    assert.ok(t.vendorCalls.every((c) => c.url.includes("chat/completions")), "A는 Anthropic을 부르지 않는다");
  });

  it("토큰 종류가 분기를 정한다: 잡 id를 담은 일반 검수 토큰은 라벨러 경로로 못 들어온다 · 시작 안 한 잡은 403 · 끝난 잡은 402", async () => {
    const t = setup();
    await start(t, ["A"]);
    assert.equal((await ask(t, "lab_vc_1_A", "llm")).status, 404);
    assert.equal(t.vendorCalls.length, 0);
    assert.equal((await ask(t, "lab_vc_1_B")).status, 403);
    await t.post("/internal/labeler-done", { runId: "lab_vc_1_A", ok: false, error: "x" });
    assert.equal((await ask(t, "lab_vc_1_A")).status, 402);
  });
});

describe("완료 콜백 → labeler_agent 행 · 읽기는 숫자만", { skip: SQLITE_SKIP }, () => {
  const done = (t, jobId, body) => t.post("/internal/labeler-done", { runId: jobId, ok: true, decision: "Needs Fix", works: false, report: labelerReport(), ...body });
  const status = async (t, runId) => (await t.call(`/admin/labeler-runs?runId=${runId}`, { headers: auth })).json();

  it("라벨 행은 출처 labeler_agent·패스 표지로만, 빌더는 원 런에서, 화면 글자는 저장 안 함. 실패 사건 보강은 그 패스 벤더로", async () => {
    const t = setup();
    t.addRun("vc_1");
    await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["B"] });
    const r = await (await done(t, "lab_vc_1_B")).json();
    assert.equal(r.stored, true);
    assert.equal(r.invalid, 0);
    const rows = t.db.prepare(`SELECT * FROM label_ac_verdicts ORDER BY ac_id`).all();
    assert.deepEqual(rows.map((x) => [x.ac_id, x.h1, x.source, x.producer, x.model, x.run_id]), [
      ["A3", "fail", "labeler_agent", "labeler-v1:B", "claude-opus-5-5", "vc_1"],
      ["A4", "pass", "labeler_agent", "labeler-v1:B", "claude-opus-5-5", "vc_1"],
    ]);
    const ev = t.db.prepare(`SELECT * FROM label_failure_events`).all();
    assert.equal(ev.length, 1);
    assert.equal(ev[0].builder, "lovable");
    assert.equal(ev[0].r, "always");
    assert.equal(ev[0].reproduced_k, 3);
    assert.ok(!JSON.stringify([rows, ev]).includes("비공개화면글자"));
    assert.ok(!JSON.stringify([rows, ev]).includes("salon.example"));
    assert.ok(t.vendorCalls.length > 0 && t.vendorCalls.every((c) => !c.url.includes("chat/completions")), "보강 호출도 패스 벤더");
    assert.equal(t.db.prepare(`SELECT COUNT(*) AS n FROM workspace_visual_checks WHERE id LIKE 'lab_%'`).get().n, 0);
    const s = await status(t, "vc_1");
    assert.equal(s.passes[0].status, "done");
    assert.equal(s.passes[0].acLabels, 2);
    assert.equal(s.passes[0].failures, 1);
  });

  it("라벨러 표지 없는 리포트는 행 0(엔진 리포트가 라벨러 출처로 둔갑하지 않는다) · 실패 콜백은 분류만 남고 원문은 안 나간다 · 없는 잡 404", async () => {
    const t = setup();
    t.addRun("vc_1");
    await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A", "B"] });
    const engineReport = labelerReport();
    delete engineReport.v2.profile;
    assert.equal((await (await done(t, "lab_vc_1_A", { report: engineReport })).json()).stored, false);
    assert.equal(t.db.prepare(`SELECT COUNT(*) AS n FROM label_ac_verdicts`).get().n, 0);
    await t.post("/internal/labeler-done", { runId: "lab_vc_1_B", ok: false, error: "agent v2 inspection timed out after 900s ||trace: https://salon.example/비밀" });
    const s = await status(t, "vc_1");
    assert.deepEqual(s.passes.map((p) => [p.pass, p.status]), [["A", "failed"], ["B", "failed"]]);
    assert.ok(!JSON.stringify(s).includes("salon.example"));
    assert.equal((await done(t, "lab_vc_9_A")).status, 404);
    assert.equal((await t.post("/internal/labeler-done", { runId: "vc_1", ok: false })).status, 400);
    assert.equal((await t.post("/internal/labeler-done", { runId: "lab_vc_1_A", ok: false }, {})).status, 401);
  });

  it("콜백 전에는 running — 상태는 D1(잡 닫힘 + 라벨 행)에서만 나온다", async () => {
    const t = setup();
    t.addRun("vc_1");
    await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A"] });
    assert.deepEqual((await status(t, "vc_1")).passes.map((p) => [p.pass, p.status]), [["A", "running"]]);
    await done(t, "lab_vc_1_A");
    assert.deepEqual((await status(t, "vc_1")).passes.map((p) => [p.pass, p.status]), [["A", "done"]]);
  });

  it("다시 실행: 라벨 없이 끝난 패스만(retry) · 라벨이 있으면 거절(append-only)", async () => {
    const t = setup();
    t.addRun("vc_1");
    await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A", "B"] });
    await t.post("/internal/labeler-done", { runId: "lab_vc_1_A", ok: false, error: "x" });
    await done(t, "lab_vc_1_B");
    const r = await (await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A", "B"], retry: true })).json();
    assert.deepEqual(r.passes, [{ pass: "A", status: "dispatched" }, { pass: "B", status: "already_labeled" }]);
  });

  it("두 패스가 끝나면 일치도는 숫자만: 분쟁 건수는 나오지만 어느 런·기준인지는 안 나온다", async () => {
    const t = setup();
    t.addRun("vc_1");
    await t.post("/admin/labeler-runs", { runId: "vc_1", passes: ["A", "B"] });
    await done(t, "lab_vc_1_A");
    assert.equal((await status(t, "vc_1")).agreement, null, "한 패스뿐이면 일치도 없음");
    await done(t, "lab_vc_1_B", { report: labelerReport({ a3: "pass" }) });
    const s = await status(t, "vc_1");
    assert.equal(s.agreement.pairedAcs, 2);
    assert.equal(s.agreement.sameVendor, false);
    assert.deepEqual(s.agreement.disputes, { askUser: 1, thirdPass: 0 });
    const all = await (await t.call("/admin/labeler-agreement", { headers: auth })).json();
    assert.equal(all.agreement.pairedAcs, 2);
    const wire = JSON.stringify(all);
    assert.ok(!wire.includes("vc_1") && !wire.includes("A3"), wire);
    assert.equal((await t.call("/admin/labeler-agreement")).status, 401);
  });
});

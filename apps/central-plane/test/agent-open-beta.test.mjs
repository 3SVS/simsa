/**
 * agent-open-beta.test.mjs — 오픈 베타 층(2026-10-05): 공개 스위치 · 티어 상한 · 서비스 하루 예산(기본 검수로 정직한 전환) ·
 * 싼 모델 라우팅 · 시험 데이터 동의(없으면 읽기 전용) · 30일 보관 스윕.
 * 실제 라우트 + 실제 SQLite(D1 엔진) + 실제 실행기 코드. 가짜는 경계(벤더 fetch·컨테이너 DO·브라우저)에만.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openSqliteD1, SQLITE_SKIP, makeMemoryR2 } from "./_sqlite-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { ENTITLEMENTS } = await import("../dist/workspace/entitlements.js");
const { WRITE_CONSENT_COPY, AGENT_FALLBACK_NOTES } = await import("../dist/routes/workspace-visual-check-runs.js");
const { sweepExpiredEvidence, EVIDENCE_RETENTION_DAYS } = await import("../dist/workspace/evidence-retention.js");
const { inspectAgentModelFor } = await import("../dist/workspace/inspection-agent.js");
const { runAgentInspection } = await import("../inspector-container/agent-run.mjs");
const { makeFakeDriver, makeScriptedLlm } = await import("./_agent-fakes.mjs");
const { salonSpec } = await import("./_salon-spec.mjs");

const ICT = "ict_open_beta";
const KEK = Buffer.alloc(32, 9).toString("base64");
const BASE = "https://central.test";
const SITE = "https://shop.example";
const ctx = { waitUntil() {}, passThroughOnException() {} };

function setup(vars = {}) {
  const { db, d1 } = openSqliteD1();
  const dispatched = [];
  const vendorBodies = [];
  const INSPECTOR = {
    idFromName: (n) => n,
    get: () => ({
      async fetch(_u, init) {
        dispatched.push(JSON.parse(init.body));
        return new Response("{}", { status: 202 });
      },
    }),
  };
  const vendorFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    vendorBodies.push(body);
    return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }], model: body.model, usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  };
  const env = { DB: d1, INSPECTOR, INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, ANTHROPIC_API_KEY: "test-key", INSPECTION_ENABLED: "on", PUBLIC_BASE_URL: BASE, ...vars };
  const app = createApp({ fetch: vendorFetch });
  const post = (path, body, headers = {}) =>
    app.fetch(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
  const now = new Date().toISOString();
  const addUser = (uk, plan) => plan && db.prepare(`INSERT INTO plan_grants (user_key, plan, note, created_at) VALUES (?, ?, 't', ?)`).run(uk, plan, now);
  const addProject = (id, uk) => {
    db.prepare(
      `INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, entry_path, dev_spec_json, created_at, updated_at)
       VALUES (?, ?, '가게', '', '{}', '{}', '[]', 'idea', ?, ?, ?)`,
    ).run(id, uk, JSON.stringify(salonSpec()), now, now);
    db.prepare(`INSERT INTO project_sources (id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at) VALUES (?, ?, ?, 'website', ?, '앱', NULL, NULL, ?)`).run(`s_${id}`, id, uk, SITE + "/", now);
  };
  const spend = (usd) =>
    db.prepare(
      `INSERT INTO llm_usage (id, created_at, job_kind, job_id, project_id, user_key_hash, vendor, model_requested, model_actual, call_site, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, unpriced, latency_ms, container_seconds)
       VALUES (?, ?, 'inspection', 'vc_x', NULL, NULL, 'openai', 'm', 'm', 'inspect_agent', 1, 0, 0, 1, ?, 0, 1, NULL)`,
    ).run(`lu_${Math.random().toString(36).slice(2)}`, new Date().toISOString(), usd);
  return { db, env, app, post, dispatched, vendorBodies, addUser, addProject, spend };
}

describe("티어 상한 — 단일 표(entitlements)", () => {
  it("무료 ≤5 기준 · ≤10 화면 · ≤40 행동 · ≤8분, 장비·프로가 더 크다", () => {
    assert.deepEqual(
      { ...ENTITLEMENTS.free.agentRun, budgetUsd: undefined },
      { maxAcs: 5, maxScreens: 10, maxActions: 40, maxMinutes: 8, budgetUsd: undefined },
    );
    for (const k of ["maxAcs", "maxScreens", "maxActions", "maxMinutes", "budgetUsd"]) {
      assert.ok(ENTITLEMENTS.pro.agentRun[k] >= ENTITLEMENTS.free.agentRun[k], k);
      assert.ok(ENTITLEMENTS.staff.agentRun[k] >= ENTITLEMENTS.free.agentRun[k], k);
    }
  });
});

describe("공개 스위치 · 하루 예산 · 동의", { skip: SQLITE_SKIP }, () => {
  it("스위치 off: 일반 사용자는 기본 검수, engine:agent 요청은 403", async () => {
    const T = setup({ INSPECTION_AGENT_PUBLIC: "off" });
    T.addProject("p1", "uk_free");
    const r = await T.post("/workspace/projects/p1/visual-checks/run", { userKey: "uk_free" });
    assert.equal((await r.json()).engine, "classic");
    T.db.prepare(`DELETE FROM workspace_visual_checks`).run();
    assert.equal((await T.post("/workspace/projects/p1/visual-checks/run", { userKey: "uk_free", engine: "agent" })).status, 403);
  });

  it("스위치 on: 일반 사용자의 기본이 agent · 무료 상한이 실린다 · 동의 없으면 읽기 전용, 있으면 쓰기", async () => {
    const T = setup({ INSPECTION_AGENT_PUBLIC: "on" });
    T.addProject("p2", "uk_free2");
    const r = await (await T.post("/workspace/projects/p2/visual-checks/run", { userKey: "uk_free2" })).json();
    assert.equal(r.engine, "agent");
    assert.equal(r.readOnly, true);
    const p = T.dispatched.at(-1);
    assert.deepEqual(p.agent.caps, ENTITLEMENTS.free.agentRun);
    assert.equal(p.agent.readOnly, true);
    const spend = T.db.prepare(`SELECT budget_usd, max_calls FROM inspection_agent_spend WHERE run_id = ?`).get(p.runId);
    assert.equal(spend.budget_usd, ENTITLEMENTS.free.agentRun.budgetUsd);
    T.db.prepare(`UPDATE workspace_visual_checks SET status = 'done'`).run();
    const r2 = await (await T.post("/workspace/projects/p2/visual-checks/run", { userKey: "uk_free2", writeConsent: true })).json();
    assert.equal(r2.readOnly, undefined);
    assert.equal(T.dispatched.at(-1).agent.readOnly, undefined);
  });

  it("하루 예산이 차면 일반 사용자는 기본 검수 + 정직한 안내(서버 노트), 장비는 그대로 agent", async () => {
    const T = setup({ INSPECTION_AGENT_PUBLIC: "on", AGENT_DAILY_BUDGET_USD: "5" });
    T.spend(3);
    T.spend(2.5);
    T.addProject("p3", "uk_free3");
    const r = await (await T.post("/workspace/projects/p3/visual-checks/run", { userKey: "uk_free3", locale: "ko" })).json();
    assert.equal(r.engine, "classic");
    assert.equal(r.engineFallback, "daily_budget");
    assert.equal(T.dispatched.at(-1).engine, undefined);
    assert.deepEqual(T.dispatched.at(-1).serverNotes, [AGENT_FALLBACK_NOTES.daily_budget.ko]);
    assert.match(AGENT_FALLBACK_NOTES.daily_budget.ko, /오늘 무료 정밀 검사 한도가 다 찼어요 — 기본 검사로 확인했어요/);
    T.addUser("uk_staff", "staff");
    T.addProject("p4", "uk_staff");
    const s = await (await T.post("/workspace/projects/p4/visual-checks/run", { userKey: "uk_staff" })).json();
    assert.equal(s.engine, "agent");
    assert.equal(s.readOnly, undefined, "장비는 동의 없이도 쓰기");
  });

  it("어제 사용액은 오늘 예산에 세지 않는다", async () => {
    const T = setup({ INSPECTION_AGENT_PUBLIC: "on", AGENT_DAILY_BUDGET_USD: "1" });
    T.db.prepare(
      `INSERT INTO llm_usage (id, created_at, job_kind, job_id, project_id, user_key_hash, vendor, model_requested, model_actual, call_site, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, unpriced, latency_ms, container_seconds)
       VALUES ('lu_old', ?, 'inspection', 'x', NULL, NULL, 'openai', 'm', 'm', 'inspect_agent', 1, 0, 0, 1, 99, 0, 1, NULL)`,
    ).run(new Date(Date.now() - 2 * 86400_000).toISOString());
    T.addProject("p5", "uk_free5");
    assert.equal((await (await T.post("/workspace/projects/p5/visual-checks/run", { userKey: "uk_free5" })).json()).engine, "agent");
  });

  it("동의 문구 KO/EN 고정(요청 화면과 같은 문장)", () => {
    assert.equal(WRITE_CONSENT_COPY.ko, "이 앱은 제 것이고, 확인을 위해 시험 데이터(이름 '심사테스트')를 만들어도 괜찮아요");
    assert.match(WRITE_CONSENT_COPY.en, /test data \(name '심사테스트'\)/);
  });
});

describe("싼 모델 라우팅", { skip: SQLITE_SKIP }, () => {
  it("cheap = 행동 단계용 싼 모델(+ 싼 폴백), strong = 판정용 기본 모델 — 요청이 모델을 못 고른다", async () => {
    assert.deepEqual(inspectAgentModelFor({}, "cheap"), { model: "claude-haiku-4-5-20251001", fallbackModel: "gpt-5.4-mini" });
    assert.deepEqual(inspectAgentModelFor({}, "strong"), { model: "claude-sonnet-4-6" });
    const T = setup({ INSPECTION_AGENT_PUBLIC: "on" });
    T.addProject("p6", "uk_free6");
    await T.post("/workspace/projects/p6/visual-checks/run", { userKey: "uk_free6", writeConsent: true });
    const tok = T.dispatched.at(-1).agent.llmToken;
    const res = await T.post("/internal/inspect-llm/v1/messages", { system: "s", user: "u", tier: "cheap" }, { authorization: `Bearer ${tok}` });
    assert.equal(res.status, 200);
    assert.equal(T.vendorBodies.at(-1).model, "claude-haiku-4-5-20251001");
    await T.post("/internal/inspect-llm/v1/messages", { system: "s", user: "u", tier: "strong" }, { authorization: `Bearer ${tok}` });
    assert.equal(T.vendorBodies.at(-1).model, "claude-sonnet-4-6");
    assert.equal((await T.post("/internal/inspect-llm/v1/messages", { system: "s", user: "u", model: "claude-opus-5" }, { authorization: `Bearer ${tok}` })).status, 400);
  });
});

describe("싼 단계의 실제 경로 — 프로덕션 설정(Anthropic 킬스위치 off · OpenAI 게이트웨이)", { skip: SQLITE_SKIP }, () => {
  it("haiku를 건너뛰고 게이트웨이로 gpt-5.4-mini · 원장은 실제로 답한 벤더·모델 · gpt-5.4-mini 공식 단가로 계산(#599)", async () => {
    const { db, d1 } = openSqliteD1();
    const calls = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), model: body.model });
      if (String(url).includes("anthropic")) return new Response("blocked", { status: 403 });
      return new Response(
        JSON.stringify({ model: "gpt-5.4-mini-2026-03-17", choices: [{ message: { content: "{\"action\":{}}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 50 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const env = {
      DB: d1, INSPECTOR: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("{}", { status: 202 }) }) },
      INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, INSPECTION_ENABLED: "on", PUBLIC_BASE_URL: BASE, INSPECTION_AGENT_PUBLIC: "on",
      ANTHROPIC_API_KEY: "k", ANTHROPIC_ENABLED: "off", OPENAI_API_KEY: "ok", CF_AI_GATEWAY_OPENAI_URL: "https://gateway.ai.cloudflare.com/v1/acct/simsa/openai",
    };
    const app = createApp({ fetch: fetchImpl });
    const post = (path, body, headers = {}) => app.fetch(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, entry_path, dev_spec_json, created_at, updated_at) VALUES ('pc', 'uk_c', 't', '', '{}', '{}', '[]', 'idea', NULL, ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO project_sources (id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at) VALUES ('sc', 'pc', 'uk_c', 'website', ?, 'a', NULL, NULL, ?)`).run(SITE + "/", now);
    let tok = null;
    env.INSPECTOR.get = () => ({ fetch: async (_u, init) => { tok = JSON.parse(init.body).agent.llmToken; return new Response("{}", { status: 202 }); } });
    await post("/workspace/projects/pc/visual-checks/run", { userKey: "uk_c", writeConsent: true });
    const r = await post("/internal/inspect-llm/v1/messages", { system: "s", user: "u", tier: "cheap" }, { authorization: `Bearer ${tok}` });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1, "막힌 Anthropic은 부르지 않는다(킬스위치)");
    assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/acct/simsa/openai/chat/completions");
    assert.equal(calls[0].model, "gpt-5.4-mini");
    const row = db.prepare(`SELECT vendor, model_requested, model_actual, call_site, cost_usd, unpriced FROM llm_usage`).get();
    assert.equal(row.vendor, "openai");
    assert.equal(row.model_requested, "claude-haiku-4-5-20251001");
    assert.equal(row.model_actual, "gpt-5.4-mini-2026-03-17");
    assert.equal(row.call_site, "inspect_agent");
    assert.equal(row.unpriced, 0, "gpt-5.4-mini 공식 단가(2026-10-05)가 표에 있다");
    assert.ok(Math.abs(row.cost_usd - (1000 * 0.75 + 50 * 4.5) / 1_000_000) < 1e-9, `cost ${row.cost_usd}`);
    assert.ok(row.cost_usd > 0);
  });
});

describe("실행기: 읽기 전용 · 상한", () => {
  const ORIGIN = "https://salon.example";
  const site = {
    "/": (s) => ({ status: 200, text: s.store.done ? `완료 ${s.fills[0]}` : "가게 예약하기 화면", links: ["/", ...Array.from({ length: 30 }, (_, i) => `/m${i}`)], buttons: ["예약하기"] }),
  };
  for (let i = 0; i < 30; i += 1) site[`/m${i}`] = { status: 200, text: `메뉴 화면 번호 ${i}`, links: [], buttons: [] };
  const onAct = (a, s) => {
    if (a.type === "click" && s.fills.length) s.store.done = true;
    return null;
  };
  it("읽기 전용: 입력을 막고 핵심 일은 '확인 못 함'(동의 안내)", async () => {
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm, prompts } = makeScriptedLlm({
      "CORE-1": [
        { type: "fill", target: { label: "이름" }, value: "$NAME" },
        { type: "judge", verdict: "not_verified", reason: "입력 불가", evidenceQuote: "", reasonCode: "write_not_allowed" },
      ],
    });
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: [], acSource: "interview", llm, driver, readOnly: true });
    assert.deepEqual(driver.state.fills, [], "입력하지 않았다");
    assert.ok(prompts.some((p) => p.includes("READ-ONLY RUN")));
    const core = out.report.acTable.find((r) => r.id === "CORE-1");
    assert.equal(core.reasonCode, "write_not_allowed");
    assert.match(core.reason, /시험 데이터를 만들어도 된다는 동의가 없어/);
    assert.equal(out.decision, "Not Verified");
  });
  it("시험 데이터 이름은 '심사테스트'", async () => {
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const { llm } = makeScriptedLlm({ "CORE-1": [{ type: "fill", target: { label: "이름" }, value: "$NAME" }] });
    await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 60_000, acs: [], acSource: "interview", llm, driver });
    assert.equal(driver.state.fills[0], "심사테스트");
  });
  it("무료 상한: 기준 수·점검 화면 수·행동 수를 넘지 않는다", async () => {
    const driver = makeFakeDriver(site, { origin: ORIGIN, onAct });
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `AC-${i + 1}`, title: `기준 ${i}`, given: "g", when: "w", then: "t", priority: "should", confirmed: true }));
    const { llm, prompts } = makeScriptedLlm({});
    const caps = { maxAcs: 5, maxScreens: 10, maxActions: 3, maxMinutes: 8 };
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 120_000, acs: many, acSource: "interview", llm, driver, caps });
    assert.equal(out.report.acTable.length, 5);
    assert.ok(out.report.sweep.screensChecked <= 10);
    const actionTurns = prompts.filter((p) => /Criterion [A-Z0-9-]+ \(/.test(p) && !/skeptical/.test(p)).length;
    assert.ok(actionTurns <= 3, `turns=${actionTurns}`);
    assert.ok(out.report.acTable.some((r) => r.reasonCode === "budget"));
  });
});

describe("S5-min 30일 보관 스윕", { skip: SQLITE_SKIP }, () => {
  it("30일 지난 런: 스크린샷 삭제 · 리포트의 화면 인용·고친 파일 제거 · 판정·기준은 남김 · 최근 런은 그대로", async () => {
    const { db, d1 } = openSqliteD1();
    const r2 = makeMemoryR2();
    const old = new Date(Date.now() - (EVIDENCE_RETENTION_DAYS + 1) * 86400_000).toISOString();
    const fresh = new Date().toISOString();
    const report = {
      engine: "agent", verdict: "작동 안 해요", oneLine: "x",
      acTable: [{ id: "CORE-1", status: "fail", reason: "r", evidence: ["화면 인용 김철수 010-1111-2222"], screenshot: "screenshots/a.png" }],
      findings: [{ code: "ac_broken", what: "w", evidence: "CORE-1 | 화면 인용" }],
      sweep: { problems: [{ kind: "screen", where: "/x", problem: "error_text", detail: "앱 오류 원문" }] },
      agent: { acs: [{ id: "CORE-1" }], singleFileFix: { validated: ["CORE-1"], correctedHtml: "<html>앱 소스</html>", diff: "- a\n+ b" } },
    };
    const ins = (id, created) =>
      db.prepare(
        `INSERT INTO workspace_visual_checks (id, project_id, user_key, target_url, intent, decision, works, status, executor, report_json, agent_prompt, evidence_keys_json, locale, created_at, updated_at)
         VALUES (?, 'pp', 'uk', 'https://a', 'i', 'Needs Fix', 0, 'done', 'container', ?, 'fix', '["screenshots/a.png"]', 'ko', ?, ?)`,
      ).run(id, JSON.stringify(report), created, created);
    ins("vc_old", old);
    ins("vc_new", fresh);
    await r2.put("checks/uk/pp/vc_old/screenshots/a.png", "x");
    await r2.put("checks/uk/pp/vc_new/screenshots/a.png", "y");
    const res = await sweepExpiredEvidence({ DB: d1, EVIDENCE: r2 });
    assert.deepEqual(res, { runs: 1, objects: 1 });
    assert.equal(r2.objects.has("checks/uk/pp/vc_old/screenshots/a.png"), false);
    assert.equal(r2.objects.has("checks/uk/pp/vc_new/screenshots/a.png"), true);
    const row = db.prepare(`SELECT evidence_keys_json, report_json, decision, agent_prompt FROM workspace_visual_checks WHERE id = 'vc_old'`).get();
    assert.equal(row.evidence_keys_json, "[]");
    assert.equal(row.decision, "Needs Fix");
    assert.equal(row.agent_prompt, "fix");
    assert.doesNotMatch(row.report_json, /김철수|앱 오류 원문|앱 소스|화면 인용/);
    const stripped = JSON.parse(row.report_json);
    assert.equal(stripped.acTable[0].status, "fail");
    assert.deepEqual(stripped.agent.singleFileFix.validated, ["CORE-1"]);
    assert.ok(stripped.retentionStrippedAt);
    assert.deepEqual(await sweepExpiredEvidence({ DB: d1, EVIDENCE: r2 }), { runs: 0, objects: 0 }, "다시 고르지 않는다");
  });
});

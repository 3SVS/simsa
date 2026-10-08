/**
 * 검사 엔진 v2 · S8 — 재검사 고리(L, X-4): 원 런이 v2면 "다시 확인"이 엔진·기준·**계획**을 그대로 물려받고, 완료 콜백이 기준별 전후를 비교한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openSqliteD1, SQLITE_SKIP } from "./_sqlite-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { salonSpec } = await import("./_salon-spec.mjs");

const ICT = "ict_v2_recheck";
const KEK = Buffer.alloc(32, 5).toString("base64");
const BASE = "https://central.test";
const ctx = { waitUntil() {}, passThroughOnException() {} };

describe("S8 재검사 고리 — 같은 계획 · 전후 비교", { skip: SQLITE_SKIP }, () => {
  it("v2 원 런 → 다시 확인(engine 지정 없음): agent_v2 · 같은 기준 · priorPlan 전달 · 고쳐진 것/새로 깨진 것 비교", async () => {
    const { db, d1 } = openSqliteD1();
    const dispatched = [];
    const INSPECTOR = { idFromName: (n) => n, get: () => ({ async fetch(_u, init) { dispatched.push(JSON.parse(init.body)); return new Response("{}", { status: 202 }); } }) };
    const env = { DB: d1, INSPECTOR, INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, OPENAI_API_KEY: "sk-test", INSPECTION_ENABLED: "on", PUBLIC_BASE_URL: BASE };
    const app = createApp({ fetch: async () => new Response("{}", { status: 500 }) });
    const post = (path, body, headers = {}) => app.fetch(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO plan_grants (user_key, plan, note, created_at) VALUES ('uk_s', 'staff', 't', ?)`).run(now);
    db.prepare(
      `INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, entry_path, dev_spec_json, created_at, updated_at)
       VALUES ('p1', 'uk_s', '가게', '', '{}', '{}', '[]', 'idea', ?, ?, ?)`,
    ).run(JSON.stringify(salonSpec()), now, now);
    db.prepare(`INSERT INTO project_sources (id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at) VALUES ('s1', 'p1', 'uk_s', 'website', 'https://shop.example/', '앱', NULL, NULL, ?)`).run(now);

    // 1) 첫 v2 런 + 완료(AC-001 실패, 계획 저장)
    await post("/workspace/projects/p1/visual-checks/run", { userKey: "uk_s", engine: "agent_v2" });
    const first = dispatched.at(-1);
    const acs = first.agent.acs;
    const plan = { hypotheses: [{ id: "H1", risk: "기기에만 저장", test: "새 브라우저" }], items: [{ acId: acs[0].id, steps: ["예약", "새 브라우저 관리 화면"], probes: ["다른 기기"] }] };
    const report1 = {
      engine: "agent", engineVersion: "v2", verdict: "x", oneLine: "x", findings: [], notes: [],
      acTable: acs.map((a, i) => ({ id: a.id, title: a.title, priority: a.priority, confirmed: a.confirmed, then: a.then, status: i === 0 ? "fail" : "pass", reason: "r", evidence: [] })),
      agent: { acs, acSource: first.agent.acSource, v2: { plan } },
    };
    assert.equal((await post("/internal/visual-check-done", { runId: first.runId, ok: true, decision: "Needs Fix", works: false, report: report1 }, { authorization: `Bearer ${ICT}` })).status, 200);

    // 2) 다시 확인 — engine을 안 줘도 원 런이 v2라 v2 + 같은 계획
    const r2 = await (await post("/workspace/projects/p1/visual-checks/run", { userKey: "uk_s", sourceCheckId: first.runId })).json();
    assert.equal(r2.engine, "agent_v2");
    const second = dispatched.at(-1);
    assert.equal(second.engine, "agent_v2");
    assert.equal(second.agent.acSource, "source_run");
    assert.deepEqual(second.agent.acs.map((a) => a.id), acs.map((a) => a.id), "같은 기준");
    assert.deepEqual(second.agent.priorPlan, plan, "같은 계획");

    // 3) 재검사 완료: AC-001 고쳐짐, 다른 하나 새로 깨짐 → 비교가 리포트에
    const report2 = { ...report1, acTable: report1.acTable.map((r, i) => ({ ...r, status: i === 0 ? "pass" : i === 1 ? "fail" : "pass" })) };
    assert.equal((await post("/internal/visual-check-done", { runId: second.runId, ok: true, decision: "Needs Fix", works: false, report: report2 }, { authorization: `Bearer ${ICT}` })).status, 200);
    const stored = JSON.parse(db.prepare(`SELECT report_json FROM workspace_visual_checks WHERE id = ?`).get(second.runId).report_json);
    assert.deepEqual(stored.agentComparison.fixed, [acs[0].id]);
    assert.deepEqual(stored.agentComparison.newlyBroken, [acs[1].id]);
  });
});

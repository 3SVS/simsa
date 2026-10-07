/**
 * 검사 엔진 v2 · S4 — 실행 고리(도구 전부) + 배선(스태프 전용 engine agent_v2, Responses 프록시, 비용·청구 예상).
 * 가짜 드라이버(작은 예약 앱 — 서버 저장소 공유)와 대본 모델로 실행기를 끝까지 돈다(네트워크·브라우저 없음).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openSqliteD1, SQLITE_SKIP } from "./_sqlite-d1.mjs";

const v2 = await import("../dist/agent-v2.js");
const { runAgentV2 } = await import("../inspector-container/agent-v2-run.mjs");
const { createApp } = await import("../dist/router.js");
const { salonSpec } = await import("./_salon-spec.mjs");

const ORIGIN = "https://salon.example";

/** 예약 앱: / 예약 폼(이름 입력 → 예약하기 → 완료 화면, 서버 저장), /admin 오늘 예약 목록(서버 저장소에서). */
export function bookingDriver({ persists = true } = {}) {
  const server = { bookings: [] };
  let path = "/";
  let ctx = 0;
  let name = "";
  let done = false;
  const net = [];
  let netI = 0;
  const pageText = () => {
    if (path === "/admin") return `오늘 예약\n${server.bookings.map((b) => `${b} 10:30`).join("\n") || "예약 없음"}`;
    return done ? `예약 완료\n${name} 10:30` : "동네 미용실 예약\n이름\n예약하기\n관리 화면";
  };
  const d = {
    acts: [],
    async start() {},
    async goto(u) {
      path = new URL(u, ORIGIN).pathname;
      done = false;
      return { status: 200, url: ORIGIN + path };
    },
    url: () => ORIGIN + path,
    async bodyText() {
      return pageText();
    },
    async html() {
      return `<html><body><script src="/app.js"></script>${pageText()}</body></html>`;
    },
    async screenshot(n) {
      return { name: `screenshots/${n}`, path: `/tmp/${n}` };
    },
    async listSources() {
      return [ORIGIN + "/", ORIGIN + "/app.js"];
    },
    async readSourceText(u) {
      if (u.endsWith("/app.js")) return { ok: true, status: 200, url: ORIGIN + "/app.js", text: 'const routes=[{path:"/admin"}]; fetch("/api/bookings",{method:"POST"})' };
      return { ok: true, status: 200, url: ORIGIN + "/", text: "<html></html>" };
    },
    async signature() {
      return `${path}#${pageText()}`;
    },
    async observe() {
      return { url: ORIGIN + path, title: "미용실", aria: `- heading "${pageText().split("\n")[0]}"`, text: pageText(), networkErrors: [], consoleErrors: [], hasPasswordField: false };
    },
    async links() {
      return [{ href: "/admin", text: "관리 화면" }];
    },
    async act(a) {
      d.acts.push(a);
      if (a.type === "fill") {
        name = a.value;
        return { ok: true, note: "filled" };
      }
      if (a.type === "click" && /예약하기/.test(a.target?.name ?? a.target?.text ?? "")) {
        done = true;
        net.push({ i: ++netI, method: "POST", url: ORIGIN + "/api/bookings", status: 201, type: "fetch", reqBody: JSON.stringify({ name }), resBody: '{"ok":true}' });
        if (persists) server.bookings.push(name);
        return { ok: true, note: "clicked" };
      }
      return { ok: true, note: "ok" };
    },
    netLog({ last = 40 } = {}) {
      return net.slice(-last);
    },
    async storageDump() {
      return { local: [], session: [], indexedDB: [], cookies: [] };
    },
    consoleErrorList: () => [],
    async newContextAt(u) {
      ctx += 1;
      return this.goto(u);
    },
    async setClock() {},
    async setViewport(w, h) {
      return { width: w, height: h, overflowPx: 0 };
    },
    async close() {},
  };
  return d;
}

/** 대본 모델: 턴마다 함수(직전 도구 결과들 → 이번 함수 호출들). 증거물 id는 결과 글에서 읽는다. */
function scriptedResponses(turns) {
  let i = 0;
  const seen = [];
  const fn = async ({ input, tools, instructions }) => {
    seen.push({ input: JSON.parse(JSON.stringify(input)), tools, instructions });
    const outs = input.filter((x) => x.type === "function_call_output").map((x) => x.output);
    const turn = turns[i++];
    if (!turn) return { output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], model: "gpt-5.6-sol" };
    const calls = turn({ outs, last: outs.at(-1) ?? "", evOf: (re) => [...outs].reverse().map((o) => (re.test(o) ? /^(ev-\d+)/.exec(o)?.[1] : null)).find(Boolean) });
    return {
      model: "gpt-5.6-sol",
      output: calls.map(([name, args], k) => ({ type: "function_call", call_id: `c${i}_${k}`, name, arguments: JSON.stringify(args) })),
    };
  };
  fn.seen = seen;
  return fn;
}

const T = (o) => ({ role: null, name: null, label: null, placeholder: null, text: null, ...o });
const MUST = [{ id: "AC-001", title: "예약이 사장님 화면에 보인다", given: "손님이 예약", when: "사장님이 관리 화면을 연다", then: "오늘 예약 목록에 보인다", priority: "must", confirmed: true, origin: "user_checked" }];
const PLAN = ["record_plan", { hypotheses: [{ risk: "기기에만 저장", test: "새 브라우저 관리 화면" }], items: [{ acId: "AC-001", steps: ["예약", "관리 화면"], probes: ["새 브라우저"] }, { acId: "CORE-1", steps: ["예약"], probes: [] }] }];

describe("S4 실행 고리 — 대본 모델 + 가짜 예약 앱", () => {
  it("계획 → 예약 → 새 브라우저 관리 화면 → 검증기 통과 판정 · 소개 문구 판정 거절 · 지어낸 주소 거절", async () => {
    const llm = scriptedResponses([
      () => [["observe", { screenshot: false }]],
      ({ evOf }) => [["record_verdict", { acId: "AC-001", verdict: "pass", claim: "예약하기 버튼이 안내되어 있다", artifactIds: [evOf(/screen/)], quotes: ["예약하기"], reasonCode: null, cause: null }]],
      () => [PLAN],
      () => [["navigate", { url: "/secret-admin" }]],
      () => [["fill", { target: T({ label: "이름" }), value: "심사테스트" }], ["click", { target: T({ role: "button", name: "예약하기" }) }]],
      () => [["network_log", { filter: null, last: 10 }]],
      () => [["new_context", { url: "/admin", timezone: null }]],
      ({ evOf }) => [
        ["record_verdict", { acId: "AC-001", verdict: "pass", claim: "예약 뒤 새 브라우저의 관리 화면 오늘 예약에 보인다", artifactIds: [evOf(/network_log|request/), evOf(/context/)], quotes: ["심사테스트 10:30"], reasonCode: null, cause: null }],
        ["record_verdict", { acId: "INTENT", verdict: "pass", claim: "예약 앱이다", artifactIds: [evOf(/request/)], quotes: ["/api/bookings"], reasonCode: null, cause: null }],
        ["record_verdict", { acId: "CORE-1", verdict: "pass", claim: "예약이 서버에 저장되고 다른 브라우저에서 보인다", artifactIds: [evOf(/request/), evOf(/context/)], quotes: ["심사테스트"], reasonCode: null, cause: null }],
      ],
      () => [["finish", { note: "done" }]],
    ]);
    const driver = bookingDriver();
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "동네 미용실 예약", locale: "ko", acs: MUST, acSource: "confirmed_inferred", driver, llm, budgetMs: 120_000 });
    const outs = llm.seen.at(-1).input.filter((x) => x.type === "function_call_output").map((x) => x.output);
    assert.ok(outs.some((o) => /record_plan first/.test(o)), "계획 전 판정은 거절");
    assert.ok(outs.some((o) => /not seen this address/.test(o)), "지어낸 주소 거절");
    assert.ok(outs.filter((o) => /Verdict accepted/.test(o)).length >= 3);
    const row = r.report.acTable.find((x) => x.id === "AC-001");
    assert.equal(row.status, "pass");
    assert.deepEqual(row.exercised, { stateChange: true, verified: true });
    assert.equal(r.decision, "Ready");
    assert.equal(r.report.engineVersion, "v2");
    assert.equal(r.report.agent.v2.citation.pct, 100);
    assert.ok(r.report.agent.v2.plan.items.length >= 1, "계획이 리포트에 남는다(재검사 재사용)");
    assert.ok(llm.seen[0].tools.every((t) => t.type === "function"));
    assert.match(llm.seen[0].input[0].content, /\[AC-001\] \(must, confirmed by the owner\)/);
  });

  it("must 실패는 새 브라우저 재현 쌍이 없으면 거절되고, 끝까지 없으면 확인 못 함(fail_not_reproduced)", async () => {
    const failVerdict = ({ evOf }) => [["record_verdict", { acId: "AC-001", verdict: "fail", claim: "관리 화면에 예약이 나오지 않는다", artifactIds: [evOf(/예약 없음/)], quotes: ["예약 없음"], reasonCode: null, cause: null }]];
    const llm = scriptedResponses([
      () => [PLAN],
      () => [["fill", { target: T({ label: "이름" }), value: "심사테스트" }], ["click", { target: T({ role: "button", name: "예약하기" }) }]],
      () => [["observe", { screenshot: false }]],
      () => [["navigate", { url: "/admin" }]],
      failVerdict,
      failVerdict,
      failVerdict,
      () => [["finish", { note: "" }]],
      () => [["finish", { note: "" }]],
    ]);
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "예약", acs: MUST, acSource: "confirmed_inferred", driver: bookingDriver({ persists: false }), llm, budgetMs: 120_000 });
    const row = r.report.acTable.find((x) => x.id === "AC-001");
    assert.equal(row.status, "not_verified");
    assert.equal(row.reasonCode, "fail_not_reproduced");
    assert.ok(r.report.agent.v2.judgments.find((j) => j.acId === "AC-001").refusals >= 3);
  });

  it("예산 소진(402)이면 멈추고 부분 리포트", async () => {
    const llm = async () => {
      throw new Error("budget_exhausted");
    };
    const r = await runAgentV2({ targetUrl: ORIGIN + "/", intent: "예약", acs: MUST, driver: bookingDriver(), llm, budgetMs: 60_000 });
    assert.equal(r.report.acTable.find((x) => x.id === "AC-001").reasonCode, "budget");
  });

  it("compactInput: 오래된 도구 결과는 첫 줄(증거물 id)만, 이미지는 마지막 1장만", () => {
    const input = [{ role: "user", content: "k" }];
    for (let k = 0; k < 40; k += 1) input.push({ type: "function_call_output", call_id: `c${k}`, output: `ev-${k} (screen)\n${"x".repeat(5000)}` });
    input.push({ role: "user", content: [{ type: "input_image", image_url: "data:a" }] }, { role: "user", content: [{ type: "input_image", image_url: "data:b" }] });
    const out = v2.compactInput(input, 100_000);
    assert.match(out[1].output, /^ev-0 \(screen\)\n\[compacted/);
    assert.equal(out.at(-1).content[0].image_url, "data:b");
    assert.equal(out.at(-2).content[0].type, "input_text");
    assert.equal(input[1].output.length > 1000, true, "원본은 그대로");
  });

  it("navigateAllowed · extractKnownUrls · usageFromResponses · 청구 예상", () => {
    const known = new Set(v2.extractKnownUrls('href="/admin" fetch("/api/x") https://other.site/a', ORIGIN));
    assert.ok(known.has(ORIGIN + "/admin"));
    assert.equal(v2.navigateAllowed("/admin", ORIGIN + "/", known, "").ok, true);
    assert.equal(v2.navigateAllowed("/owner", ORIGIN + "/", known, "").ok, false);
    assert.equal(v2.navigateAllowed("/owner", ORIGIN + "/", known, "관리 화면(/owner)에서").ok, true, "기준이 이름을 댄 경로");
    assert.equal(v2.navigateAllowed("https://other.site/a", ORIGIN + "/", known, "").why, "other_origin");
    assert.deepEqual(v2.usageFromResponses({ input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 50 }), { inputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0, outputTokens: 50 });
    assert.deepEqual(v2.chargeEstimate(1.234, undefined), { chargeEstimateUsd: 3.7, markup: 3, billing: "off" });
    assert.equal(v2.chargeEstimate(1, "5").chargeEstimateUsd, 5);
    assert.equal(v2.chargeEstimate(1, "999").markup, 3);
  });
});

describe("S4 배선 — 스태프 전용 agent_v2 · Responses 프록시 · 원장 · 청구 예상", { skip: SQLITE_SKIP }, () => {
  const ICT = "ict_v2";
  const KEK = Buffer.alloc(32, 7).toString("base64");
  const BASE = "https://central.test";
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  function setup() {
    const { db, d1 } = openSqliteD1();
    const dispatched = [];
    const vendor = [];
    const INSPECTOR = { idFromName: (n) => n, get: () => ({ async fetch(_u, init) { dispatched.push(JSON.parse(init.body)); return new Response("{}", { status: 202 }); } }) };
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      vendor.push({ url: String(url), body });
      return new Response(JSON.stringify({ model: "gpt-5.6-sol", output: [{ type: "function_call", call_id: "c1", name: "observe", arguments: '{"screenshot":false}' }], usage: { input_tokens: 10_000, input_tokens_details: { cached_tokens: 8_000 }, output_tokens: 500 } }), { status: 200 });
    };
    const env = { DB: d1, INSPECTOR, INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, OPENAI_API_KEY: "sk-test", INSPECTION_ENABLED: "on", PUBLIC_BASE_URL: BASE, CF_AI_GATEWAY_OPENAI_URL: "https://gw.example/openai" };
    const app = createApp({ fetch: fetchImpl });
    const post = (path, body, headers = {}) => app.fetch(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
    const get = (path, headers = {}) => app.fetch(new Request(BASE + path, { headers }), env, ctx);
    const now = new Date().toISOString();
    const addProject = (id, uk, plan) => {
      if (plan) db.prepare(`INSERT INTO plan_grants (user_key, plan, note, created_at) VALUES (?, ?, 't', ?)`).run(uk, plan, now);
      db.prepare(
        `INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, entry_path, dev_spec_json, created_at, updated_at)
         VALUES (?, ?, '가게', '', '{}', '{}', '[]', 'idea', ?, ?, ?)`,
      ).run(id, uk, JSON.stringify(salonSpec()), now, now);
      db.prepare(`INSERT INTO project_sources (id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at) VALUES (?, ?, ?, 'website', 'https://shop.example/', '앱', NULL, NULL, ?)`).run(`s_${id}`, id, uk, now);
    };
    return { db, env, post, get, dispatched, vendor, addProject };
  }

  it("비스태프의 engine:agent_v2는 403, 스태프는 v2 페이로드(엔진·v2 경로·도구 상한·예산)", async () => {
    const S = setup();
    S.addProject("p1", "uk_free");
    assert.equal((await S.post("/workspace/projects/p1/visual-checks/run", { userKey: "uk_free", engine: "agent_v2" })).status, 403);
    S.addProject("p2", "uk_staff", "staff");
    const r = await (await S.post("/workspace/projects/p2/visual-checks/run", { userKey: "uk_staff", engine: "agent_v2" })).json();
    assert.equal(r.engine, "agent_v2");
    const p = S.dispatched.at(-1);
    assert.equal(p.engine, "agent_v2");
    assert.match(p.agent.llmUrl, /\/internal\/inspect-llm\/v2\/responses$/);
    assert.equal(p.agent.caps.maxToolCalls, 220);
    const spend = S.db.prepare(`SELECT budget_usd FROM inspection_agent_spend WHERE run_id = ?`).get(p.runId);
    assert.equal(spend.budget_usd, 12);

    // 프록시: 서버 고정 모델·store:false·게이트웨이 경로·원장(캐시 제외 입력)
    const tok = p.agent.llmToken;
    const tools = [{ type: "function", name: "observe", description: "d", parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true }];
    const res = await S.post("/internal/inspect-llm/v2/responses", { instructions: "i", input: [{ role: "user", content: "hi" }], tools }, { authorization: `Bearer ${tok}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.output[0].name, "observe");
    const call = S.vendor.at(-1);
    assert.equal(call.url, "https://gw.example/openai/responses");
    assert.equal(call.body.model, "gpt-5.6-sol");
    assert.equal(call.body.store, false);
    const led = S.db.prepare(`SELECT model_actual, input_tokens, cache_read_tokens, output_tokens, cost_usd FROM llm_usage WHERE job_id = ?`).get(p.runId);
    assert.deepEqual([led.model_actual, led.input_tokens, led.cache_read_tokens, led.output_tokens], ["gpt-5.6-sol", 2000, 8000, 500]);
    assert.ok(Math.abs(led.cost_usd - (2000 * 4 + 8000 * 0.4 + 500 * 20) / 1e6) < 1e-9);
    // 다른 종류 도구(서버 키로 웹 검색 등) · 모델 지정은 거절
    assert.equal((await S.post("/internal/inspect-llm/v2/responses", { instructions: "i", input: [{ role: "user", content: "hi" }], tools: [{ type: "web_search" }] }, { authorization: `Bearer ${tok}` })).status, 400);
    assert.equal((await S.post("/internal/inspect-llm/v2/responses", { instructions: "i", input: [{ role: "user", content: "hi" }], tools, model: "gpt-5.5-pro" }, { authorization: `Bearer ${tok}` })).status, 400);

    // 완료 콜백: 원가 + 청구 예상(결제 꺼짐)
    const report = { engine: "agent", engineVersion: "v2", agent: { acs: [] }, acTable: [], findings: [], notes: [], verdict: "x", oneLine: "x" };
    const done = await S.post("/internal/visual-check-done", { runId: p.runId, ok: true, decision: "Not Verified", works: null, report }, { authorization: `Bearer ${ICT}` });
    assert.equal(done.status, 200);
    const stored = JSON.parse(S.db.prepare(`SELECT report_json FROM workspace_visual_checks WHERE id = ?`).get(p.runId).report_json);
    assert.equal(stored.agent.billing, "off");
    assert.equal(stored.agent.markup, 3);
    assert.ok(stored.agent.chargeEstimateUsd >= 0);
    assert.equal(stored.agent.costUsd, Math.round(led.cost_usd * 10_000) / 10_000);
    const costs = await (await S.get("/admin/agent-costs", { authorization: `Bearer ${ICT}` })).json();
    assert.equal(costs.billing, "off");
    assert.equal(costs.runs[0].runId, p.runId);
  });

  it("Claude 주 모델(v2 전용 스위치 on): Messages + tool use로 부르고, 실패하면 gpt-5.6-sol로 대체 · 원장은 실제로 답한 벤더", async () => {
    const S = setup();
    S.env.ANTHROPIC_API_KEY = "sk-ant-test";
    S.env.INSPECT_AGENT_V2_ANTHROPIC = "on";
    S.env.CF_AI_GATEWAY_ANTHROPIC_URL = "https://gw.example/anthropic";
    S.addProject("p3", "uk_staff3", "staff");
    await S.post("/workspace/projects/p3/visual-checks/run", { userKey: "uk_staff3", engine: "agent_v2" });
    const tok = S.dispatched.at(-1).agent.llmToken;
    const runId = S.dispatched.at(-1).runId;
    const tools = [{ type: "function", name: "observe", description: "d", parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true }];
    const res = await S.post("/internal/inspect-llm/v2/responses", { instructions: "i", input: [{ role: "user", content: "hi" }], tools }, { authorization: `Bearer ${tok}` });
    assert.equal(res.status, 200);
    const first = S.vendor.find((v) => v.url.includes("/v1/messages"));
    assert.ok(first, "Claude 경로를 먼저 부른다");
    assert.equal(first.body.model, "claude-fable-5-1");
    assert.equal(first.body.tools[0].name, "observe");
    assert.ok(first.body.tools[0].input_schema, "Anthropic 도구 형식");
    // 가짜 업스트림은 Responses 모양만 알아서 Claude 응답(content 없음) → 빈 출력이 아니라, 어댑터가 출력 없음을 그대로 넘긴다.
    const led = S.db.prepare("SELECT vendor, model_actual FROM llm_usage WHERE job_id = ?").all(runId);
    assert.equal(led[0].vendor, "anthropic");
  });
});

describe("V-5 Claude 어댑터(순수)", () => {
  it("Responses 대화 ↔ Messages: 함수 호출=tool_use, 결과=tool_result, 이미지=base64, 생각 블록 왕복, 역할 교대 합치기", () => {
    const req = v2.toAnthropicRequest(
      {
        instructions: "sys",
        tools: v2.V2_TOOLS.slice(0, 1),
        input: [
          { role: "user", content: "start" },
          { type: "reasoning", vendor: "anthropic", blocks: [{ type: "thinking", thinking: "t", signature: "s" }] },
          { type: "function_call", call_id: "call.1", name: "observe", arguments: '{"screenshot":false}' },
          { type: "function_call_output", call_id: "call.1", output: "ev-1 screen" },
          { role: "user", content: [{ type: "input_text", text: "shot" }, { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" }] },
          { type: "reasoning", encrypted_content: "openai-only" },
        ],
      },
      "claude-fable-5-1",
    );
    assert.deepEqual(req.messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(req.messages[1].content[0].type, "thinking");
    assert.deepEqual(req.messages[1].content[1], { type: "tool_use", id: "call_1", name: "observe", input: { screenshot: false } });
    assert.equal(req.messages[2].content[0].tool_use_id, "call_1");
    assert.equal(req.messages[2].content[2].source.data, "AAAA");
    assert.ok(req.messages[2].content.at(-1).cache_control);
    assert.equal(req.tools[0].name, "observe");
    const back = v2.fromAnthropicResponse({ model: "claude-fable-5-1", content: [{ type: "thinking", thinking: "x", signature: "y" }, { type: "tool_use", id: "tu1", name: "click", input: { a: 1 } }], usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 20 } });
    assert.equal(back.output[0].type, "reasoning");
    assert.deepEqual(back.output[1], { type: "function_call", call_id: "tu1", name: "click", arguments: '{"a":1}' });
    assert.deepEqual(back.tokens, { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 50, outputTokens: 20 });
    // OpenAI로 대체될 때 Claude 생각 블록은 빠진다
    const body = v2.buildV2ResponsesBody({ instructions: "i", input: [back.output[0], back.output[1]], tools: [] }, { model: "gpt-5.6-sol", effort: "medium" });
    assert.equal(body.input.length, 1);
  });
});

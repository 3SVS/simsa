/**
 * agent-inspector-e2e.test.mjs — 세 문(門) 공통 사슬을 실제 라우트·실제 SQLite(D1 엔진)·실제 실행기 코드로 끝까지.
 *
 *   URL → (확인된) AC → 로그인(동의) → 화면·버튼 점검 → AC 실행 → AC별 판정 → 고침 지시(실제 실패만) → 같은 AC로 재검수
 *
 * 가짜는 경계에만: 브라우저(가짜 드라이버) · LLM 벤더(가짜 Anthropic fetch — 호출은 진짜 프록시 라우트를 지난다) ·
 * 컨테이너 DO(디스패치 페이로드를 받아 두고 라이브 화면 요청에 답한다). 네트워크 0.
 *
 * 문 (2) 주소: 역추론 지시서(확인된 must) → 시험 계정 → Needs Fix → 빌더 팩/고침 지시 → 재검수 같은 AC
 * 문 (3) 저장소·기획서: 기획서 지시서(document) → "생각과 달라요" → 수리 잡이 받을 수 있는 실패 AC 증거 → 재검수
 * 문 (1) 아이디어: 인터뷰 지시서 → 빌드 배포 뒤 자동 확인이 agent 엔진(스태프) → 실패 AC가 다음 빌드 지시서로
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openSqliteD1, SQLITE_SKIP } from "./_sqlite-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { runAgentInspection } = await import("../inspector-container/agent-run.mjs");
const { createProxyLlm } = await import("../inspector-container/agent-llm.mjs");
const { isRunRepairable } = await import("../dist/routes/workspace-repair-jobs.js");
const { startBuildAutoCheck } = await import("../dist/workspace/build-deploy.js");
const { buildFixBriefFromCheck } = await import("../dist/routes/workspace-build-jobs.js");
const { cleanupStuckVisualChecks } = await import("../dist/stuck-cleanup.js");
const { makeFakeDriver, makeScriptedLlm } = await import("./_agent-fakes.mjs");
const { salonSpec } = await import("./_salon-spec.mjs");

const STAFF = "uk_staff_bench";
const FREE = "uk_free_user";
const ICT = "ict_test_token";
const KEK = Buffer.alloc(32, 7).toString("base64");
const BASE = "https://central.test";
const SITE = "https://salon.example";
const USER = "owner@salon.kr";
const PASS = "s3cret-pw!9";
const ctx = { waitUntil() {}, passThroughOnException() {} };

function salonSite() {
  return {
    "/": (s) => ({ status: 200, text: s.store.booking ? "동네 미용실 10:30 예약됨 예약하기" : "동네 미용실 10:30 예약 가능 예약하기", links: ["/", "/admin"], buttons: ["예약하기", "예약 삭제"] }),
    "/done": (s) => ({ status: 200, text: `예약이 완료되었어요 ${s.store.booking?.name ?? ""} 10:30` }),
    "/admin": (s) => (s.loggedIn ? { status: 200, text: `${USER} 님. 오늘 예약 없음` } : { status: 200, text: "관리자 비밀번호", password: true }),
  };
}
const onAct = (a, s) => {
  if (a.type === "click" && a.target.name === "예약하기" && s.fills.length) {
    s.store.booking = { name: s.fills[0] };
    s.path = "/done";
  }
  return null;
};
const book = [
  { type: "fill", target: { label: "이름" }, value: "$NAME" },
  { type: "click", target: { role: "button", name: "예약하기" } },
];
const scripts = {
  "AC-001": [...book, { type: "judge", verdict: "pass", reason: "예약 완료 화면이 보였어요", evidenceQuote: "예약이 완료되었어요 $NAME 10:30" }],
  "AC-002": [...book, { type: "new_session" }, { type: "judge", verdict: "fail", reason: "다른 손님 화면에서 10:30이 여전히 예약 가능해요", evidenceQuote: "10:30 예약 가능" }],
  "AC-003": [...book, { type: "login" }, { type: "goto", path: "/admin" }, { type: "judge", verdict: "fail", reason: "관리 화면에 오늘 예약이 없어요", evidenceQuote: "오늘 예약 없음" }],
};

function setup() {
  const opened = openSqliteD1();
  const { db, d1 } = opened;
  const dispatched = [];
  const liveCalls = [];
  const INSPECTOR = {
    idFromName: (n) => n,
    get: () => ({
      async fetch(url, init) {
        if (String(url).includes("/live/")) {
          liveCalls.push(String(url));
          return new Response(JSON.stringify({ ok: true, state: "awaiting_login" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        dispatched.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
      },
    }),
  };
  // 런마다 대본을 처음부터(가짜 모델의 상태가 런 사이에 새지 않게). 벤더로 간 프롬프트는 전부 모은다.
  const prompts = [];
  let current = makeScriptedLlm(scripts);
  // 가짜 Anthropic: 프록시가 보낸 단일 user 메시지를 대본 LLM에 넘긴다.
  const vendorFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    prompts.push(body.messages[0].content);
    const text = await current.llm({ system: "", user: body.messages[0].content });
    return new Response(
      JSON.stringify({ content: [{ type: "text", text }], model: body.model, usage: { input_tokens: 1200, output_tokens: 80 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const env = {
    DB: d1,
    INSPECTOR,
    INTERNAL_CALLBACK_TOKEN: ICT,
    CONCLAVE_TOKEN_KEK: KEK,
    ANTHROPIC_API_KEY: "test-anthropic-key",
    INSPECTION_ENABLED: "on",
    PUBLIC_BASE_URL: BASE,
  };
  const app = createApp({ fetch: vendorFetch });
  const call = (path, init = {}) => app.fetch(new Request(BASE + path, init), env, ctx);
  const post = (path, body, headers = {}) => call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO plan_grants (user_key, plan, note, created_at) VALUES (?, 'staff', 'test', ?)`).run(STAFF, now);
  const addProject = (id, entryPath, spec, userKey = STAFF) => {
    db.prepare(
      `INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, entry_path, dev_spec_json, created_at, updated_at)
       VALUES (?, ?, '동네 미용실', '', '{}', '{}', '[]', ?, ?, ?, ?)`,
    ).run(id, userKey, entryPath, spec ? JSON.stringify(spec) : null, now, now);
    db.prepare(
      `INSERT INTO project_sources (id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at) VALUES (?, ?, ?, 'website', ?, '앱', NULL, NULL, ?)`,
    ).run(`src_${id}`, id, userKey, SITE + "/", now);
  };
  /** server.mjs가 하는 일을 그대로: 페이로드 → 실행기(가짜 브라우저 · 진짜 프록시 경유 LLM) → 완료 콜백. */
  async function runContainer(payload) {
    current = makeScriptedLlm(scripts);
    const driver = makeFakeDriver(salonSite(), { origin: SITE, onAct });
    const result = await runAgentInspection({
      targetUrl: payload.targetUrl,
      intent: payload.intent,
      locale: payload.locale,
      budgetMs: 120_000,
      acs: payload.agent.acs,
      acSource: payload.agent.acSource,
      loginMode: payload.agent.loginMode,
      credentials: payload.credentials,
      llm: createProxyLlm({ url: payload.agent.llmUrl, token: payload.agent.llmToken, fetchImpl: (u, init) => app.fetch(new Request(u, init), env, ctx) }),
      driver,
    });
    const r = await post("/internal/visual-check-done", { runId: payload.runId, ok: true, decision: result.decision, works: result.works, report: result.report, agentPrompt: result.agentPrompt }, { authorization: `Bearer ${ICT}` });
    assert.equal(r.status, 200);
    return { result, driver };
  }
  return { db, env, app, call, post, dispatched, liveCalls, prompts, addProject, runContainer };
}

const skip = SQLITE_SKIP;

describe("agent 엔진 E2E — 세 문", { skip }, () => {
  let T;
  before(() => {
    T = setup();
  });

  it("문 (2) 주소: 확인된 AC → 시험 계정 → 점검 → AC → Needs Fix → 고침 지시 → 같은 AC로 재검수", async () => {
    const spec = salonSpec({ source: "inferred", confirmed: ["AC-001", "AC-002", "AC-003"] });
    T.addProject("proj_url", "code", spec);

    // 게이트: 스태프 아님 → 403 · 동의 없음 → 400 · 다른 출처 로그인 주소 → 400
    T.addProject("proj_free", "code", spec, FREE);
    assert.equal((await T.post("/workspace/projects/proj_free/visual-checks/run", { userKey: FREE, engine: "agent" })).status, 403);
    const noConsent = await T.post("/workspace/projects/proj_url/visual-checks/run", { userKey: STAFF, engine: "agent", testCredentials: { username: USER, password: PASS } });
    assert.equal(noConsent.status, 400);
    assert.equal((await noConsent.json()).error, "consent_required");
    const badUrl = await T.post("/workspace/projects/proj_url/visual-checks/run", { userKey: STAFF, engine: "agent", testCredentials: { username: USER, password: PASS, loginUrl: "https://phish.example/login", consent: true } });
    assert.equal((await badUrl.json()).error, "invalid_login_url");

    const res = await T.post("/workspace/projects/proj_url/visual-checks/run", {
      userKey: STAFF, engine: "agent", locale: "ko", testCredentials: { username: USER, password: PASS, consent: true },
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.engine, "agent");
    assert.equal(body.acSource, "confirmed_inferred");
    assert.equal(body.loginMode, "credentials");
    assert.ok(!JSON.stringify(body).includes(PASS));
    const runId = body.check.id;

    // 보관: 암호문만(평문 없음), 디스패치 페이로드에만 복호화된 값
    const secretRow = T.db.prepare(`SELECT ciphertext FROM inspection_run_secrets WHERE run_id = ?`).get(runId);
    assert.ok(secretRow, "런 동안은 암호문이 있다");
    assert.ok(!secretRow.ciphertext.includes(PASS) && !secretRow.ciphertext.includes(USER));
    const payload = T.dispatched.at(-1);
    assert.equal(payload.engine, "agent");
    assert.deepEqual(payload.credentials, { username: USER, password: PASS });
    assert.deepEqual(payload.agent.acs.map((a) => [a.id, a.confirmed]), [["AC-001", true], ["AC-002", true], ["AC-003", true]]);
    assert.match(payload.agent.llmToken, /^irt1\./);

    // 프록시: 전역 콜백 토큰으로는 안 된다(런 범위 토큰만)
    const wrongTok = await T.post("/internal/inspect-llm/v1/messages", { system: "s", user: "u" }, { authorization: `Bearer ${ICT}` });
    assert.equal(wrongTok.status, 403);

    const { result } = await T.runContainer(payload);
    assert.equal(result.decision, "Needs Fix");

    const run = T.db.prepare(`SELECT status, decision, works, report_json, agent_prompt FROM workspace_visual_checks WHERE id = ?`).get(runId);
    assert.equal(run.status, "done");
    assert.equal(run.decision, "Needs Fix");
    const report = JSON.parse(run.report_json);
    assert.deepEqual(report.acTable.map((r) => [r.id, r.status]), [["CORE-1", "not_verified"], ["AC-001", "pass"], ["AC-002", "fail"], ["AC-003", "fail"]]);
    assert.ok(report.builderPrompt && report.builderPrompt.length > 0, "빌더 팩(채팅형 빌더용 고침 지시)이 서버에서 붙는다");
    assert.match(run.agent_prompt, /AC-002[\s\S]*AC-003/);
    assert.doesNotMatch(run.agent_prompt, /\[AC-001/);

    // 런이 끝나면 시험 계정은 지워진다. DB 어디에도 평문 없음.
    assert.equal(T.db.prepare(`SELECT COUNT(*) AS n FROM inspection_run_secrets WHERE run_id = ?`).get(runId).n, 0);
    const dump = JSON.stringify([run, T.db.prepare(`SELECT * FROM llm_usage`).all()]);
    assert.ok(!dump.includes(PASS) && !dump.includes(USER));
    assert.ok(!T.prompts.join("\n").includes(PASS), "LLM 벤더로 간 프롬프트에도 없다");

    // 원장·예산: 호출마다 inspection/inspect_agent 한 행, 예산 행 소비
    const usage = T.db.prepare(`SELECT job_kind, call_site, job_id FROM llm_usage WHERE job_id = ?`).all(runId);
    assert.ok(usage.length >= 3);
    assert.ok(usage.every((u) => u.job_kind === "inspection" && u.call_site === "inspect_agent"));
    const spend = T.db.prepare(`SELECT spent_usd, calls FROM inspection_agent_spend WHERE run_id = ?`).get(runId);
    assert.ok(spend.spent_usd > 0 && spend.calls === usage.length);

    // 끝난 런의 토큰으로는 더 못 쓴다
    const late = await T.post("/internal/inspect-llm/v1/messages", { system: "s", user: "u" }, { authorization: `Bearer ${payload.agent.llmToken}` });
    assert.equal(late.status, 409);

    // 수리(저장소 문)도 이 런을 받을 수 있다 — 수리 잡의 입력이 실패 AC의 순서·기대·실제다.
    assert.equal(isRunRepairable({ status: run.status, works: run.works === 1 ? true : run.works === 0 ? false : null, agentPrompt: run.agent_prompt }), true);

    // 재검수: 같은 AC 그대로, 로그인은 물려받지 않는다(계정은 지워졌다)
    const re = await T.post("/workspace/projects/proj_url/visual-checks/run", { userKey: STAFF, sourceCheckId: runId });
    assert.equal(re.status, 202);
    const reBody = await re.json();
    assert.equal(reBody.engine, "agent");
    assert.equal(reBody.acSource, "source_run");
    const rePayload = T.dispatched.at(-1);
    assert.deepEqual(rePayload.agent.acs.map((a) => a.id), ["CORE-1", ...payload.agent.acs.map((a) => a.id)], "원 런이 쓴 기준(기본 기준 포함) 그대로");
    assert.deepEqual(rePayload.agent.acs.slice(1), payload.agent.acs);
    assert.equal(rePayload.credentials, undefined);
    // B6: 재검수 결과를 원 런과 AC별로 비교해 싣는다(같은 대본 → 바뀐 것 없음, 그대로 안 되는 것 = AC-002)
    await T.runContainer(rePayload);
    const reRow = T.db.prepare(`SELECT report_json FROM workspace_visual_checks WHERE id = ?`).get(rePayload.runId);
    const cmp = JSON.parse(reRow.report_json).agentComparison;
    assert.equal(cmp.sourceCheckId, runId);
    assert.deepEqual(cmp.stillBroken, ["AC-002"], "AC-003은 재검수에 계정이 없어 확인 못 함 — 그대로 안 됨에 세지 않는다");
    assert.deepEqual(cmp.newlyBroken, []);
  });

  it("문 (3) 기획서: document 기준 → '생각과 달라요' + 같은 실패 증거", async () => {
    T.addProject("proj_doc", "spec", salonSpec());
    const res = await T.post("/workspace/projects/proj_doc/visual-checks/run", { userKey: STAFF, engine: "agent" });
    const body = await res.json();
    assert.equal(body.acSource, "document");
    const payload = T.dispatched.at(-1);
    assert.equal(payload.credentials, undefined);
    const { result } = await T.runContainer(payload);
    assert.equal(result.report.agent.acSourceLabel, "올려 주신 기획서(문서)의 기준");
    assert.ok(result.report.notes.some((n) => n.includes("생각하신 것과 달라요")));
    // 계정이 없으니 관리 화면 기준은 고장이 아니라 확인 못 함
    assert.equal(result.report.acTable.find((r) => r.id === "AC-003").reasonCode, "login_required");
  });

  it("직접 로그인 넘겨주기: 동의 필수 · 런 토큰 · 소유자만 라이브 화면", async () => {
    T.addProject("proj_live", "code", salonSpec({ source: "inferred", confirmed: ["AC-001", "AC-002", "AC-003"] }));
    const no = await T.post("/workspace/projects/proj_live/visual-checks/run", { userKey: STAFF, engine: "agent", loginMode: "handover" });
    assert.equal((await no.json()).error, "consent_required");
    const res = await T.post("/workspace/projects/proj_live/visual-checks/run", { userKey: STAFF, engine: "agent", loginMode: "handover", handoverConsent: true });
    const body = await res.json();
    assert.match(body.liveToken, /^ilt1\./);
    const runId = body.check.id;
    const base = `/workspace/projects/proj_live/visual-checks/${runId}/live`;
    assert.equal((await T.call(`${base}/state?userKey=${STAFF}&token=bad`)).status, 401);
    assert.equal((await T.call(`${base}/state?userKey=${FREE}&token=${body.liveToken}`)).status, 403);
    // LLM 토큰은 라이브 토큰이 아니다(용도 분리)
    const llmTok = T.dispatched.at(-1).agent.llmToken;
    assert.equal((await T.call(`${base}/state?userKey=${STAFF}&token=${llmTok}`)).status, 401);
    const ok = await T.call(`${base}/state?userKey=${STAFF}&token=${body.liveToken}`);
    assert.equal(ok.status, 200);
    const input = await T.post(`${base}/input`, { userKey: STAFF, token: body.liveToken, kind: "type", text: "직접 친 비밀번호" });
    assert.equal(input.status, 200);
    assert.ok(T.liveCalls.some((u) => u.endsWith("/live/input")));
    await T.post("/internal/visual-check-done", { runId, ok: false, error: "test" }, { authorization: `Bearer ${ICT}` });
  });

  it("문 (1) 아이디어: 배포 뒤 자동 확인이 agent 엔진 → 실패 AC가 다음 빌드 지시서로", async () => {
    T.addProject("proj_idea", "idea", salonSpec());
    const job = { id: "bj_test", projectId: "proj_idea", userKey: STAFF, locale: "ko" };
    const out = await startBuildAutoCheck(T.env, { job, deployedUrl: SITE + "/", publicBaseUrl: BASE });
    assert.equal(out.started, true);
    assert.deepEqual(out.acceptanceIds, ["AC-001", "AC-002", "AC-003"]);
    const payload = T.dispatched.at(-1);
    assert.equal(payload.engine, "agent");
    assert.equal(payload.agent.acSource, "interview");
    await T.runContainer(payload);
    const brief = await buildFixBriefFromCheck(T.env, out.checkRunId, "proj_idea", STAFF);
    assert.match(brief.brief, /반드시 고칠 것/);
    assert.match(brief.brief, /AC-002/);
    assert.equal((await buildFixBriefFromCheck(T.env, out.checkRunId, "proj_idea", FREE)).status, 404, "남의 런으로는 못 만든다");
    assert.equal((await buildFixBriefFromCheck(T.env, undefined, "proj_idea", STAFF)).brief, null);
  });

  it("남은 비밀은 TTL 정리가 지운다(최후 방어)", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    T.db.prepare(`INSERT INTO inspection_run_secrets (run_id, kind, ciphertext, created_at) VALUES ('vc_orphan', 'credentials', 'x', ?)`).run(old);
    await cleanupStuckVisualChecks(T.env);
    assert.equal(T.db.prepare(`SELECT COUNT(*) AS n FROM inspection_run_secrets WHERE run_id = 'vc_orphan'`).get().n, 0);
  });
});

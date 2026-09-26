/**
 * train-c-c2b-verdict-builder-prompt.test.mjs — Train C · C2b 주소만 유저의 인도 경로
 * (재정렬 D-17 amend: 코드 연결은 선택 · D-19 amend: 북극성 = user_verdict=as_intended · D-8 amend: 사람 수용 라벨).
 *
 * 고정하는 계약(계약 2·3·4):
 *   ③ POST …/:runId/verdict — Zod enum(잘못된 값 400) · 소유권(남의 프로젝트 403, 남의 런 404) · 저장(재제출 덮어쓰기)
 *      · usage 이벤트 workspace_visual_check_verdict · GET 상세/목록에 userVerdict·userVerdictAt·sourceCheckId
 *   ④ builderPrompt(리포트 JSON) — 채팅형 빌더에 붙이는 한 덩어리, EN/KO 각각 금칙어 0
 *      (branch|terminal|PR|commit|git|저장소|브랜치|터미널|커밋). 서버 콜백에서 생성해 report_json에 넣는다
 *      (컨테이너 이미지 재빌드 없이 배포). 기존 agentPrompt는 그대로.
 *   ⑤ POST …/:runId/events { type:"fix_prompt_copied", target } → usage 이벤트 workspace_fix_prompt_copied
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeD1, projectRow, websiteSource, checkRow, makeDoStub, send } from "./_train-c-fake-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { buildBuilderFixPrompt, buildAgentFixPrompt, buildNonDevReport } = await import("../dist/nondev-report.js");

const USER = "uk_owner";
const OTHER = "uk_intruder";
const PROJECT = "proj_c2b";
const OTHER_PROJECT = "proj_c2b_other";
const TOKEN = "tok_internal_secret";
const RUN = "wvc_done1";
const VERDICT_PATH = `/workspace/projects/${PROJECT}/visual-checks/${RUN}/verdict`;
const EVENTS_PATH = `/workspace/projects/${PROJECT}/visual-checks/${RUN}/events`;

/** Developer vocabulary that must never reach a builder-chat prompt (KO + EN). */
const FORBIDDEN_EN = /\b(branch|terminal|PR|commit|git|repo|repository)\b/i;
const FORBIDDEN_KO = /(저장소|브랜치|터미널|커밋|깃)/;

function makeEnv({ checks = [checkRow({ id: RUN, project_id: PROJECT, user_key: USER, source_check_id: "wvc_orig" })], inspector } = {}) {
  const projects = new Map([
    [PROJECT, projectRow(PROJECT, USER)],
    [OTHER_PROJECT, projectRow(OTHER_PROJECT, OTHER)],
  ]);
  const env = {
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: TOKEN,
    DB: makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER)], checks }),
  };
  if (inspector) env.INSPECTOR = inspector;
  return env;
}

// ─── ③ user_verdict ────────────────────────────────────────────────────────────

test("verdict: Zod enum — unknown value / missing verdict / non-string userKey → 400 invalid_request; nothing stored", async () => {
  const env = makeEnv();
  const app = createApp();
  for (const body of [
    { userKey: USER, verdict: "looks_fine" },
    { userKey: USER },
    { userKey: 12, verdict: "as_intended" },
    { verdict: "as_intended" },
  ]) {
    const r = await send(app, env, VERDICT_PATH, { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, "invalid_request");
  }
  assert.equal(env.DB._checks[0].user_verdict, null);
  assert.equal(env.DB._events.length, 0);
});

test("verdict: ownership — other user's key 403; run of another project 404; unknown project 404", async () => {
  const env = makeEnv();
  const app = createApp();
  const forbidden = await send(app, env, VERDICT_PATH, { body: { userKey: OTHER, verdict: "as_intended" } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, "forbidden");

  const wrongProject = await send(app, env, `/workspace/projects/${OTHER_PROJECT}/visual-checks/${RUN}/verdict`, { body: { userKey: OTHER, verdict: "as_intended" } });
  assert.equal(wrongProject.status, 404);
  assert.equal(wrongProject.json.error, "run_not_found");

  const noProject = await send(app, env, `/workspace/projects/proj_nope/visual-checks/${RUN}/verdict`, { body: { userKey: USER, verdict: "as_intended" } });
  assert.equal(noProject.status, 404);
  assert.equal(env.DB._checks[0].user_verdict, null, "no verdict may be stored on a failed ownership check");
});

test("verdict: all four values store + overwrite on resubmit; usage event recorded; GET detail + list reflect it", async () => {
  const env = makeEnv();
  const app = createApp();
  const seen = [];
  for (const verdict of ["unsure", "still_broken", "works_but_different", "as_intended"]) {
    const r = await send(app, env, VERDICT_PATH, { body: { userKey: USER, verdict } });
    assert.equal(r.status, 200, verdict);
    assert.deepEqual(Object.keys(r.json).sort(), ["at", "ok", "verdict"]);
    assert.equal(r.json.verdict, verdict);
    assert.ok(!Number.isNaN(Date.parse(r.json.at)), "at must be an ISO timestamp");
    seen.push(r.json.at);
  }
  const row = env.DB._checks[0];
  assert.equal(row.user_verdict, "as_intended", "resubmission overwrites");
  assert.equal(row.user_verdict_at, seen.at(-1));

  const events = env.DB._events.filter((e) => e.event_type === "workspace_visual_check_verdict");
  assert.equal(events.length, 4);
  assert.deepEqual(JSON.parse(events.at(-1).metadata_json), { runId: RUN, verdict: "as_intended" });
  assert.equal(events[0].project_id, PROJECT);

  const detail = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/${RUN}?userKey=${USER}`, { method: "GET" });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.check.userVerdict, "as_intended");
  assert.equal(detail.json.check.userVerdictAt, seen.at(-1));
  assert.equal(detail.json.check.sourceCheckId, "wvc_orig");

  const list = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks?userKey=${USER}`, { method: "GET" });
  assert.equal(list.status, 200);
  const item = list.json.checks.find((c) => c.id === RUN);
  assert.equal(item.userVerdict, "as_intended");
  assert.equal(item.userVerdictAt, seen.at(-1));
  assert.equal(item.sourceCheckId, "wvc_orig");
});

test("GET detail/list on a legacy row (no 0069 values) → userVerdict/userVerdictAt/sourceCheckId are null, not undefined", async () => {
  const legacy = checkRow({ id: RUN, project_id: PROJECT, user_key: USER });
  delete legacy.user_verdict; delete legacy.user_verdict_at; delete legacy.source_check_id;
  const env = makeEnv({ checks: [legacy] });
  const app = createApp();
  const detail = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/${RUN}?userKey=${USER}`, { method: "GET" });
  assert.equal(detail.json.check.userVerdict, null);
  assert.equal(detail.json.check.userVerdictAt, null);
  assert.equal(detail.json.check.sourceCheckId, null);
  const list = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks?userKey=${USER}`, { method: "GET" });
  assert.equal(list.json.checks[0].userVerdict, null);
  assert.equal(list.json.checks[0].sourceCheckId, null);
});

// ─── ④ builderPrompt ────────────────────────────────────────────────────────────

const BROKEN = {
  targetUrl: "https://golf-now.example.app/",
  intentAnchor: "골퍼가 코스 상태를 확인할 수 있어야 한다",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: "/courses/undefined",
  routeChanged: true,
  consoleErrors: ["TypeError: Cannot read properties of undefined (reading 'map')"],
  networkFailures: ["GET https://api.golf-now.example.app/courses → HTTP 502"],
  noiseFailures: ["https://www.google-analytics.com/collect 403"],
  decision: "Needs Fix",
  steps: [{ label: "코스 검색", ok: false, note: "결과 목록이 비어 있음" }],
};

test("buildBuilderFixPrompt (KO): one paste-ready block, carries what/why/how + evidence, 0 developer-vocabulary words", () => {
  const report = buildNonDevReport(BROKEN, "ko");
  const prompt = buildBuilderFixPrompt(report, "ko");
  assert.equal(typeof prompt, "string");
  assert.doesNotMatch(prompt, FORBIDDEN_KO, "KO builder prompt must not use developer vocabulary");
  assert.doesNotMatch(prompt, FORBIDDEN_EN, "KO builder prompt must not use EN developer vocabulary either");
  assert.match(prompt, /https:\/\/golf-now\.example\.app\//);
  assert.match(prompt, /골퍼가 코스 상태를 확인할 수 있어야 한다/);
  assert.match(prompt, /서버가 오류를 돌려줬어요/);
  assert.match(prompt, /HTTP 502/, "technical evidence rides along for the builder's model");
  assert.doesNotMatch(prompt, /외부 스크립트 일부가 불러와지지 않았어요/, "noise (info) findings are not fix orders");
  assert.ok(!/\n{3,}/.test(prompt), "single block — no blank-line gaps a user would have to stitch");
  // The CLI-agent prompt is untouched (still names the agent role).
  assert.match(buildAgentFixPrompt(BROKEN, "ko"), /개발 에이전트/);
});

/** Same evidence, EN-authored user data (step labels are user text and flow through verbatim in any locale). */
const BROKEN_EN = {
  ...BROKEN,
  intentAnchor: "a golfer can check course status",
  steps: [{ label: "course search", ok: false, note: "result list stayed empty" }],
};

test("buildBuilderFixPrompt (EN): English block, 0 developer-vocabulary words, no Hangul", () => {
  const report = buildNonDevReport(BROKEN_EN, "en");
  const prompt = buildBuilderFixPrompt(report, "en");
  assert.equal(typeof prompt, "string");
  assert.doesNotMatch(prompt, FORBIDDEN_EN);
  assert.doesNotMatch(prompt, /[가-힣]/, "EN prompt must not leak Korean");
  assert.match(prompt, /The server returned an error\./);
  assert.match(prompt, /a golfer can check course status/);
  assert.match(prompt, /HTTP 502/);
});

test("buildBuilderFixPrompt: nothing to fix (no fixable findings) → null, so the dashboard falls back to the old UI", () => {
  const clean = buildNonDevReport({ ...BROKEN, routeAfterClick: "/courses", consoleErrors: [], networkFailures: [], steps: [], decision: "Conditionally Ready" }, "ko");
  assert.equal(buildBuilderFixPrompt(clean, "ko"), null);
});

test("internal done: server generates report.builderPrompt from the container's report in the RUN's locale; agentPrompt untouched; legacy shape stays legacy", async () => {
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER)]]);
  const env = { ENVIRONMENT: "test", INTERNAL_CALLBACK_TOKEN: TOKEN, DB: makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER)] }), INSPECTOR: makeDoStub({ names: [], calls: [] }) };
  const app = createApp();
  const auth = { authorization: `Bearer ${TOKEN}` };

  const created = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/run`, { body: { userKey: USER, locale: "en" } });
  const runId = created.json.check.id;
  const report = buildNonDevReport(BROKEN_EN, "en");
  const agentPrompt = buildAgentFixPrompt(BROKEN_EN, "en");
  const done = await send(app, env, "/internal/visual-check-done", { body: { runId, ok: true, decision: "Needs Fix", works: false, report, agentPrompt }, headers: auth });
  assert.equal(done.status, 200);

  const row = env.DB._checks[0];
  const stored = JSON.parse(row.report_json);
  assert.equal(typeof stored.builderPrompt, "string");
  assert.doesNotMatch(stored.builderPrompt, FORBIDDEN_EN);
  assert.doesNotMatch(stored.builderPrompt, /[가-힣]/, "run locale en → EN builder prompt");
  assert.equal(row.agent_prompt, agentPrompt, "CLI agent prompt stored as-is");
  const { builderPrompt: _b, ...rest } = stored;
  assert.deepEqual(rest, report, "everything else in the report is stored byte-for-byte");

  // A report with no findings array (old container / failure shape) is stored untouched.
  row.status = "done";
  const created2 = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/run`, { body: { userKey: USER } });
  const odd = { verdict: "?", note: "legacy" };
  await send(app, env, "/internal/visual-check-done", { body: { runId: created2.json.check.id, ok: true, decision: "Not Verified", works: null, report: odd }, headers: auth });
  assert.deepEqual(JSON.parse(env.DB._checks[1].report_json), odd);
});

// ─── ⑤ copy telemetry ──────────────────────────────────────────────────────────

test("events: fix_prompt_copied → usage event workspace_fix_prompt_copied { runId, target }; Zod rejects other types/targets; ownership enforced", async () => {
  const env = makeEnv();
  const app = createApp();
  for (const target of ["web_builder", "cli"]) {
    const r = await send(app, env, EVENTS_PATH, { body: { userKey: USER, type: "fix_prompt_copied", target } });
    assert.equal(r.status, 200, target);
    assert.equal(r.json.ok, true);
  }
  const events = env.DB._events.filter((e) => e.event_type === "workspace_fix_prompt_copied");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => JSON.parse(e.metadata_json)), [
    { runId: RUN, target: "web_builder" },
    { runId: RUN, target: "cli" },
  ]);

  for (const body of [
    { userKey: USER, type: "report_viewed", target: "cli" },
    { userKey: USER, type: "fix_prompt_copied", target: "email" },
    { userKey: USER, type: "fix_prompt_copied" },
  ]) {
    const r = await send(app, env, EVENTS_PATH, { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, "invalid_request");
  }
  const forbidden = await send(app, env, EVENTS_PATH, { body: { userKey: OTHER, type: "fix_prompt_copied", target: "cli" } });
  assert.equal(forbidden.status, 403);
  assert.equal(env.DB._events.filter((e) => e.event_type === "workspace_fix_prompt_copied").length, 2, "rejected calls record nothing");
});

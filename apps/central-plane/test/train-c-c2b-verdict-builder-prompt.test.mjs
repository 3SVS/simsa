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

/** Acceptance results: one truly broken item and one the report itself defines as "not a defect". */
const AC_MIXED_KO = [
  { acceptanceId: "AC-001", featureTitle: "코스 검색", then: "코스 목록이 보인다", status: "broken", note: "GET /courses → HTTP 502" },
  { acceptanceId: "AC-002", featureTitle: "즐겨찾기", then: "별표가 저장된다", status: "not_confirmed", note: "no star button found" },
];
const AC_MIXED_EN = [
  { acceptanceId: "AC-001", featureTitle: "course search", then: "the course list appears", status: "broken", note: "GET /courses → HTTP 502" },
  { acceptanceId: "AC-002", featureTitle: "favorites", then: "the star is saved", status: "not_confirmed", note: "no star button found" },
];

// PR #553 review P2: the report defines ac_not_confirmed as "확인 못 함 — 고장 아님" and console_error as
// informational (never drives the verdict). A builder told to "fix" a not-confirmed item will invent a
// change — the exact thing the prompt's own rule forbids. And the reader-facing console_error `how`
// points at "this report's 'for developers' section", which does not exist inside a builder chat.
test("buildBuilderFixPrompt: not-a-defect items are never fix orders — ac_not_confirmed moves to a 'confirm only' note; console_error keeps a chat-usable 'how' (KO + EN, 0 developer words, EN has no Hangul)", () => {
  const ko = buildBuilderFixPrompt(buildNonDevReport({ ...BROKEN, acceptanceResults: AC_MIXED_KO }, "ko"), "ko");
  assert.equal(typeof ko, "string");
  const numberedKo = ko.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.ok(numberedKo.some((l) => /코스 검색/.test(l)), "the broken acceptance item IS a fix order");
  assert.ok(!numberedKo.some((l) => /즐겨찾기/.test(l)), `not-confirmed must not be numbered as a problem to fix: ${JSON.stringify(numberedKo)}`);
  assert.match(ko, /확인만 해 주세요/, "…but it is carried as something to confirm");
  assert.match(ko, /즐겨찾기/);
  assert.doesNotMatch(ko, /'개발자용' 칸/, "console_error 'how' is rewritten for a chat with no report sections");
  assert.ok(numberedKo.some((l) => /코드 오류가 났어요/.test(l)), "a real code error with evidence stays a fix order");
  assert.doesNotMatch(ko, FORBIDDEN_KO);
  assert.doesNotMatch(ko, FORBIDDEN_EN);
  assert.ok(!/\n{3,}/.test(ko), "still one block");

  const en = buildBuilderFixPrompt(buildNonDevReport({ ...BROKEN_EN, acceptanceResults: AC_MIXED_EN }, "en"), "en");
  assert.equal(typeof en, "string");
  const numberedEn = en.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.ok(numberedEn.some((l) => /course search/.test(l)));
  assert.ok(!numberedEn.some((l) => /favorites/.test(l)), `not-confirmed must not be numbered: ${JSON.stringify(numberedEn)}`);
  assert.match(en, /favorites/);
  assert.doesNotMatch(en, /'for developers' section/);
  assert.doesNotMatch(en, FORBIDDEN_EN);
  assert.doesNotMatch(en, /[가-힣]/);
});

test("buildBuilderFixPrompt: only not-a-defect items (ac_not_confirmed + info noise) → null (nothing to fix → old UI)", () => {
  const quiet = buildNonDevReport({
    ...BROKEN, routeAfterClick: "/courses", consoleErrors: [], networkFailures: [], steps: [], decision: "Conditionally Ready",
    acceptanceResults: [AC_MIXED_KO[1]],
  }, "ko");
  assert.ok(quiet.findings.some((f) => f.code === "ac_not_confirmed"), "fixture sanity: the report does carry the not-confirmed finding");
  assert.equal(buildBuilderFixPrompt(quiet, "ko"), null);
});

test("buildBuilderFixPrompt: legacy report findings WITHOUT codes keep the pre-existing severity-only rule", () => {
  const legacy = {
    findings: [
      { severity: "medium", what: "'즐겨찾기'은(는) 이번 검수에서 끝까지 확인하지 못했어요.", why: "", how: "", evidence: null },
      { severity: "info", what: "외부 스크립트 일부가 불러와지지 않았어요.", why: "", how: "", evidence: null },
    ],
  };
  const p = buildBuilderFixPrompt(legacy, "ko");
  assert.equal(typeof p, "string", "no code → cannot know it is not-a-defect → stays a fix item (unchanged)");
  assert.match(p, /^1\. '즐겨찾기'/m);
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

// PR #553 review P2: the container sizes its report to the 512KiB cap; the SERVER then appends
// builderPrompt. Before this fix that could push a valid report over the cap → 400 report_too_large →
// the run stayed `running` forever (the old code stored the same report fine). Enrichment must never be
// the reason a report is refused: drop the enrichment, keep the container's report.
test("internal done: a container report already sized to the 512KiB cap is NOT rejected because of the server-added builderPrompt — stored without builderPrompt, finding codes kept, run done; a report over the cap on its own still 400s", async () => {
  const CAP = 512 * 1024;
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER)]]);
  const env = { ENVIRONMENT: "test", INTERNAL_CALLBACK_TOKEN: TOKEN, DB: makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER)] }), INSPECTOR: makeDoStub({ names: [], calls: [] }) };
  const app = createApp();
  const auth = { authorization: `Bearer ${TOKEN}` };

  // Train K (0071, PR #574 #574-5): finding codes are ops meta — recorded only when the person's recording is
  // on. A request with no country is off by default, so this run carries the edge country a real request has
  // (KR = on by default); the no-country rule itself is pinned in train-k-consent-server.test.mjs.
  const created = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/run`, { body: { userKey: USER, locale: "ko" }, cf: { country: "KR" } });
  const runId = created.json.check.id;
  const base = buildNonDevReport(BROKEN, "ko");
  const room = CAP - JSON.stringify({ ...base, padding: "" }).length;
  const report = { ...base, padding: "x".repeat(room - 16) }; // what a cap-aware container sends: 16 bytes under
  assert.ok(JSON.stringify(report).length <= CAP && JSON.stringify(report).length > CAP - 64, "fixture sanity: just under the cap");
  assert.ok(typeof buildBuilderFixPrompt(base, "ko") === "string", "fixture sanity: this report DOES yield a builderPrompt");

  const done = await send(app, env, "/internal/visual-check-done", { body: { runId, ok: true, decision: "Needs Fix", works: false, report }, headers: auth });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const row = env.DB._checks[0];
  assert.equal(row.status, "done", "the run must not be left running");
  const stored = JSON.parse(row.report_json);
  assert.equal("builderPrompt" in stored, false, "the server-side enrichment is what gets dropped, never the container's report");
  assert.equal(stored.padding.length, report.padding.length);
  assert.deepEqual(JSON.parse(row.finding_codes_json), base.findings.map((f) => f.code), "finding codes are still recorded");

  // Unchanged contract: a report that is over the cap by itself is still refused.
  row.status = "done";
  const created2 = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/run`, { body: { userKey: USER } });
  const tooBig = await send(app, env, "/internal/visual-check-done", {
    body: { runId: created2.json.check.id, ok: true, decision: "Needs Fix", works: false, report: { ...base, padding: "x".repeat(room + 64) } },
    headers: auth,
  });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.json.error, "report_too_large");
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

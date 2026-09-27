/**
 * train-c-c2a-repair-entry.test.mjs — Train C · C2a 코드 연결 경로 (재정렬 D-15 keep: 공개 저장소 OAuth 없음 →
 * App 설치 토큰 폴백 · D-8 amend: resolved 라벨 · W2~W3 (b): verify-sweep에 acceptancePlan 전달).
 *
 * 고정하는 계약(계약 5):
 *   ⑥ 수리 진입: OAuth 연결 없음(not_connected) + GitHub App 설치됨 → App 토큰으로 진행(202) ·
 *      App도 없으면 종전 github_token_required · 저장소가 아예 없으면 종전 github_repo_required
 *   ⑤ verify-sweep 재검수 dispatch에 프로젝트 지시서의 acceptancePlan 전달 + 새 런 source_check_id = 원 런 ·
 *      수리 잡 행에 verify_check_id 기록
 *   ⑤' 재검수 완료 콜백 → 수리 잡 resolved(works true→1 · false→0 · null→유지)
 *   region: 수리 잡 insert에 cf.country
 *
 * GitHub API·컨테이너는 주입 fetch/DO 스텁. 실제 RSA 키로 App JWT 서명(saas.test 패턴).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { makeFakeD1, projectRow, websiteSource, checkRow, makeDoStub, send } from "./_train-c-fake-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { runVerifySweep, REPAIR_MERGED_EVENT } = await import("../dist/workspace/verify-sweep.js");

const USER = "uk_owner";
const PROJECT = "proj_c2a";
const RUN = "wvc_fixme";
const TOKEN = "tok_internal_secret";
const APP_TOKEN = "ghs_app_installation_token_fixture";
const INSTALLATION_ID = 4242;
const REPAIR_PATH = `/workspace/projects/${PROJECT}/visual-checks/${RUN}/repair`;

const { privateKey: GH_APP_PRIVATE_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function repoRow(over = {}) {
  return {
    id: "wpr_1", project_id: PROJECT, user_key: USER, github_connection_id: null,
    repo_id: "1", repo_full_name: "acme/golf-now", repo_owner: "acme", repo_name: "golf-now",
    default_branch: "main", private: 0, html_url: "https://github.com/acme/golf-now",
    created_at: "2026-09-27T00:00:00.000Z", updated_at: "2026-09-27T00:00:00.000Z",
    ...over,
  };
}

/** GitHub API mock: App installed (or not) on acme/golf-now. Records calls. */
function makeGitHubFetch({ appInstalled = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.authorization ?? "" });
    const u = String(url);
    if (/\/repos\/[^/]+\/[^/]+\/installation$/.test(u)) {
      return appInstalled
        ? new Response(JSON.stringify({ id: INSTALLATION_ID }), { status: 200 })
        : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    if (/\/app\/installations\/\d+\/access_tokens$/.test(u)) {
      return new Response(JSON.stringify({ token: APP_TOKEN, expires_at: "2099-01-01T00:00:00Z" }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** A `project_sources` github_repo row — what a user gets by TYPING a repo address (no OAuth involved). */
function githubRepoSource(reference, over = {}) {
  return {
    id: "psrc_gh1", project_id: PROJECT, user_key: USER, type: "github_repo", reference,
    label: null, content_type: null, size_bytes: null, created_at: "2026-09-27T00:00:00.000Z",
    ...over,
  };
}

function makeEnv({
  repos = [repoRow()], connections = [], sandbox, appCreds = true,
  checks = [checkRow({ id: RUN, project_id: PROJECT, user_key: USER })],
  sources = [websiteSource(PROJECT, USER)],
} = {}) {
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER)]]);
  const env = {
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: TOKEN,
    DB: makeFakeD1({ projects, sources, checks, repos, connections }),
  };
  if (sandbox) env.SANDBOX = sandbox;
  if (appCreds) { env.GH_APP_ID = "12345"; env.GH_APP_PRIVATE_KEY = GH_APP_PRIVATE_PEM; }
  return env;
}

// ─── ⑥ repair entry ─────────────────────────────────────────────────────────────

test("repair: no OAuth connection + GitHub App installed on the linked repo → dispatches with the App token (D-15)", async () => {
  const recorder = { names: [], calls: [] };
  const gh = makeGitHubFetch({ appInstalled: true });
  const env = makeEnv({ connections: [], sandbox: makeDoStub(recorder) });
  const r = await send(createApp({ fetch: gh }), env, REPAIR_PATH, { body: { userKey: USER, locale: "en" }, cf: { country: "PH" } });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.dispatched, true);
  assert.equal(recorder.calls[0].body.githubToken, APP_TOKEN, "container receives the App installation token");
  assert.ok(gh.calls.some((c) => /\/repos\/acme\/golf-now\/installation$/.test(c.url)), "App installation looked up for the linked repo");
  assert.ok(!JSON.stringify(r.json).includes(APP_TOKEN), "token never echoes in the response");
  assert.equal(env.DB._jobs[0].region, "PH", "repair job captures cf.country");
});

test("repair: no OAuth connection + App NOT installed → 400 github_token_required (unchanged); localized message", async () => {
  const gh = makeGitHubFetch({ appInstalled: false });
  const env = makeEnv({ connections: [], sandbox: makeDoStub({ names: [], calls: [] }) });
  const app = createApp({ fetch: gh });
  const ko = await send(app, env, REPAIR_PATH, { body: { userKey: USER } });
  assert.equal(ko.status, 400);
  assert.equal(ko.json.error, "github_token_required");
  assert.match(ko.json.message, /GitHub/);
  const en = await send(app, env, REPAIR_PATH, { body: { userKey: USER, locale: "en" } });
  assert.equal(en.status, 400);
  assert.doesNotMatch(en.json.message, /[가-힣]/, "EN reader gets an English message");
  assert.equal(env.DB._jobs.length, 0);
});

test("repair: no linked repo at all → 400 github_repo_required (unchanged; the dashboard shows the C2b path instead)", async () => {
  const env = makeEnv({ repos: [], connections: [], sandbox: makeDoStub({ names: [], calls: [] }) });
  const app = createApp({ fetch: makeGitHubFetch() });
  const ko = await send(app, env, REPAIR_PATH, { body: { userKey: USER } });
  assert.equal(ko.status, 400);
  assert.equal(ko.json.error, "github_repo_required");
  const en = await send(app, env, REPAIR_PATH, { body: { userKey: USER, locale: "en" } });
  assert.equal(en.json.error, "github_repo_required");
  assert.doesNotMatch(en.json.message, /[가-힣]/);
});

// P0 regression (PR #553 review): the App fallback must be reachable ONLY for a repo the user
// linked through their own GitHub account (workspace_project_repos — link route requires an OAuth
// connection). A `project_sources` github_repo row is a self-typed string with no ownership check
// (github-repo-ref.ts: "관대하게 받되" — a normalizer, not a gate). Before this fix, typing
// "victim-org/private-saas" with no OAuth at all minted an App installation token for that repo
// (read/write) and dispatched clone + push + PR — cross-tenant.
test("repair [P0]: no OAuth + no linked repo + self-typed github_repo source naming SOMEONE ELSE's repo + App installed there → 400 github_token_required; no App token minted, no job row, no container call", async () => {
  const recorder = { names: [], calls: [] };
  const gh = makeGitHubFetch({ appInstalled: true });
  const env = makeEnv({
    repos: [], connections: [],
    sources: [websiteSource(PROJECT, USER), githubRepoSource("victim-org/private-saas")],
    sandbox: makeDoStub(recorder),
  });
  const r = await send(createApp({ fetch: gh }), env, REPAIR_PATH, { body: { userKey: USER } });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, "github_token_required", "the pre-C2a answer for a sources-only repo without OAuth");
  assert.equal(env.DB._jobs.length, 0, "no repair job row may exist");
  assert.equal(recorder.calls.length, 0, "the container must never be called");
  const appCalls = gh.calls.filter((c) => /\/installation$/.test(c.url) || /\/access_tokens$/.test(c.url));
  assert.equal(appCalls.length, 0, `no App installation lookup / token mint for an unproven repo — saw ${JSON.stringify(appCalls)}`);
  assert.ok(!JSON.stringify(r.json).includes(APP_TOKEN));
});

test("repair [P0 control]: the same self-typed github_repo source WITH an OAuth connection still takes the pre-existing OAuth path (no App call)", async () => {
  const recorder = { names: [], calls: [] };
  const gh = makeGitHubFetch({ appInstalled: true });
  const { encryptToken } = await import("../dist/crypto.js");
  const KEK = randomBytes(32).toString("base64");
  const accessTokenEnc = await encryptToken("gho_fixture_oauth_token", KEK);
  const env = makeEnv({
    repos: [],
    connections: [{
      id: "ghc_1", user_key: USER, github_user_id: "1", github_login: "owner", github_name: null, avatar_url: null,
      access_token_enc: accessTokenEnc, scopes: "read:user public_repo",
      created_at: "2026-09-27T00:00:00.000Z", updated_at: "2026-09-27T00:00:00.000Z",
    }],
    sources: [websiteSource(PROJECT, USER), githubRepoSource("https://github.com/acme/golf-now.git")],
    sandbox: makeDoStub(recorder),
  });
  env.CONCLAVE_TOKEN_KEK = KEK;
  const r = await send(createApp({ fetch: gh }), env, REPAIR_PATH, { body: { userKey: USER } });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(recorder.calls[0].body.githubToken, "gho_fixture_oauth_token", "OAuth token, exactly as before C2a");
  assert.equal(recorder.calls[0].body.repo, "acme/golf-now");
  assert.equal(gh.calls.length, 0, "known-public fast path: zero GitHub calls");
});

// ─── ⑤ verify-sweep: acceptancePlan + source_check_id + verify_check_id ─────────

function devSpec() {
  return {
    meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-24T03:00:00.000Z" },
    brief: { productName: "골프 나우", oneLine: "코스 상태 확인", targetUsers: [], problem: "p", included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
    features: [{ id: "FR-001", title: "코스 상태", description: "d", priority: "must" }],
    acceptance: [{ id: "AC-001", featureId: "FR-001", given: "g", when: "w", then: "코스 목록이 보인다", verifiedBy: "browser" }],
    screens: [{ id: "SCR-001", route: "/", purpose: "p", components: ["검색"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
    dataModel: [],
    apis: [],
    nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "전부", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] }],
    testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "검색 누름"] }],
    assumptions: [],
    openQuestions: [],
  };
}

const NOW = Date.parse("2026-09-27T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function sweepEnv({ withDevSpec = true, inspector, sources = [] } = {}) {
  const origin = checkRow({
    id: RUN, project_id: PROJECT, user_key: USER, locale: "en",
    region: "KR", envelope_json: JSON.stringify({ builtWith: { tools: ["bolt"] }, entryPath: "code", topicTags: null, locale: "en", contentLang: "ko" }),
    created_at: iso(3600_000), updated_at: iso(3600_000),
  });
  const job = {
    id: "wrj_done", project_id: PROJECT, user_key: USER, visual_check_id: RUN, repo_full_name: "acme/golf-now",
    status: "done", branch_name: `fix/simsa-${RUN}`, pr_url: "https://github.com/acme/golf-now/pull/9", pr_number: 9,
    env_cause: 0, mode: "auto_fix", changed_files: 1, error: null, region: "KR", verify_check_id: null, resolved: null,
    created_at: iso(1800_000), updated_at: iso(1800_000),
  };
  const events = [{
    id: "evt1", user_key: USER, project_id: PROJECT, event_type: REPAIR_MERGED_EVENT,
    metadata_json: JSON.stringify({ runId: RUN, prNumber: 9 }), created_at: iso(10 * 60_000),
  }];
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER, { dev_spec_json: withDevSpec ? JSON.stringify(devSpec()) : null })]]);
  return {
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: TOKEN,
    PUBLIC_BASE_URL: "https://base",
    DB: makeFakeD1({ projects, sources, checks: [origin], jobs: [job], events }),
    ...(inspector ? { INSPECTOR: inspector } : {}),
  };
}

test("verify-sweep: re-inspection dispatch carries the project's acceptancePlan; new run has source_check_id = origin; repair job gets verify_check_id; envelope/region/locale inherited", async () => {
  const recorder = { names: [], calls: [] };
  const env = sweepEnv({ inspector: makeDoStub(recorder) });
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 1, JSON.stringify(s));
  const payload = recorder.calls[0].body;
  assert.ok(Array.isArray(payload.acceptancePlan), "acceptancePlan must ride the re-inspection dispatch");
  assert.deepEqual(payload.acceptancePlan.map((p) => p.acceptanceId), ["AC-001"]);
  assert.equal(payload.locale, "en");

  const reRun = env.DB._checks.find((c) => c.id !== RUN);
  assert.ok(reRun, "re-inspection row inserted");
  assert.equal(reRun.source_check_id, RUN);
  assert.equal(reRun.region, "KR", "cron has no request → region copied from the origin run");
  assert.equal(JSON.parse(reRun.envelope_json).builtWith.tools[0], "bolt");
  assert.equal(env.DB._jobs[0].verify_check_id, reRun.id, "repair job now points at the re-inspection run");
});

test("verify-sweep: project without a dev spec → no acceptancePlan key (pre-existing behavior kept)", async () => {
  const recorder = { names: [], calls: [] };
  const env = sweepEnv({ withDevSpec: false, inspector: makeDoStub(recorder) });
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 1);
  assert.equal("acceptancePlan" in recorder.calls[0].body, false);
  assert.equal(env.DB._checks.at(-1).source_check_id, RUN);
});

test("internal done on a re-inspection: repair job resolved = 1 (works) / 0 (broken) / stays null (not verified)", async () => {
  const cases = [
    { works: true, decision: "Ready", expected: 1 },
    { works: false, decision: "Needs Fix", expected: 0 },
    { works: null, decision: "Conditionally Ready", expected: null },
  ];
  for (const { works, decision, expected } of cases) {
    const recorder = { names: [], calls: [] };
    const env = sweepEnv({ inspector: makeDoStub(recorder) });
    await runVerifySweep(env, { nowMs: NOW });
    const reRun = env.DB._checks.find((c) => c.id !== RUN);
    const app = createApp();
    const r = await send(app, env, "/internal/visual-check-done", {
      body: { runId: reRun.id, ok: true, decision, works, report: { findings: [] } },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(r.status, 200);
    assert.equal(env.DB._jobs[0].resolved, expected, `works=${works}`);
  }
});

// Paired contrast in ONE env (PR #553 review P1: the old negative-only test was true on any code
// that had no `resolved` at all). First the re-inspection callback must issue exactly one
// `SET resolved` write; then an ORIGINAL run's callback in the same env must add none — and must
// not flip the verdict the re-inspection wrote (works=false here would turn 1 into 0 on over-reach).
test("internal done: `resolved` is written exactly once by the re-inspection callback, and a later ORIGINAL run (no source_check_id) in the same env adds no write and leaves the verdict alone", async () => {
  const recorder = { names: [], calls: [] };
  const env = sweepEnv({ inspector: makeDoStub(recorder), sources: [websiteSource(PROJECT, USER)] });
  const app = createApp();
  const auth = { authorization: `Bearer ${TOKEN}` };
  const resolvedWrites = () => env.DB.writes.filter((w) => /SET resolved = \?/.test(w.sql)).length;

  await runVerifySweep(env, { nowMs: NOW });
  const reRun = env.DB._checks.find((c) => c.id !== RUN);
  assert.ok(reRun, "re-inspection row inserted");
  const r1 = await send(app, env, "/internal/visual-check-done", {
    body: { runId: reRun.id, ok: true, decision: "Ready", works: true, report: { findings: [] } },
    headers: auth,
  });
  assert.equal(r1.status, 200);
  assert.equal(resolvedWrites(), 1, "re-inspection callback writes resolved exactly once");
  assert.equal(env.DB._jobs[0].resolved, 1);

  const created = await send(app, env, `/workspace/projects/${PROJECT}/visual-checks/run`, { body: { userKey: USER } });
  assert.equal(created.status, 202, JSON.stringify(created.json));
  assert.equal(env.DB._checks.at(-1).source_check_id, null, "an original run has no source");
  const r2 = await send(app, env, "/internal/visual-check-done", {
    body: { runId: created.json.check.id, ok: true, decision: "Needs Fix", works: false, report: { findings: [] } },
    headers: auth,
  });
  assert.equal(r2.status, 200);
  assert.equal(resolvedWrites(), 1, "original-run callback adds no resolved write");
  assert.equal(env.DB._jobs[0].resolved, 1, "the repair job's verdict is untouched by an unrelated original run");
});

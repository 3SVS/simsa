/**
 * SI 티어 Train B — B5(a): 빌드 잡 상태 머신 + 라우트. 가짜 D1·BUILDER 스텁·주입 fetch(호스팅 API). 네트워크 0.
 * 핵심 고정: 지시서 없으면 409 · 프로비저닝 실패면 잡 없음 · 페이로드에 비밀이 실리되 D1 행엔 없음 ·
 * 상태 역행 거부 · done인데 빌드 exit≠0이면 거부(D-4) · 콜백 토큰 게이트.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");
const { advanceBuildJob, markBuildJobDone, markBuildJobFailed, insertQueuedBuildJob, getBuildJobById } = await import("../dist/workspace/build-job-db.js");

const USER = "uk_owner";
const PROJECT = "wsp_build1";
const TOKEN = "tok_internal";

const DEV_SPEC = {
  meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-26T00:00:00.000Z" },
  brief: { productName: "동네 빵집 픽업 예약", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
  features: [{ id: "FR-001", title: "예약", description: "빵을 고르고 예약한다", priority: "must" }],
  acceptance: [{ id: "AC-001", featureId: "FR-001", given: "목록", when: "예약 누름", then: "확인 화면이 보인다", verifiedBy: "browser" }],
  screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: ["버튼"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
  dataModel: [{ name: "reservations", fields: [{ name: "id", type: "text", required: true }], relations: [], ownership: "unknown" }],
  apis: [], nonFunctional: [],
  workBreakdown: [{ id: "WBS-002", title: "예약 화면", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-001"] }, { id: "WBS-001", title: "예약 저장", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] }],
  testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기"] }], assumptions: [], openQuestions: [],
};

function makeDb({ projects = new Map(), jobs = [], events = [] } = {}) {
  return {
    _jobs: jobs, _events: events,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO build_jobs")) {
              const [id, project_id, user_key, slug, wbs_total, budget_usd, d1_id, repo_full_name, locale, created_at, updated_at] = args;
              jobs.push({ id, project_id, user_key, slug, status: "queued", failed_stage: null, error: null, wbs_done: 0, wbs_total, budget_usd, spent_usd: 0, d1_id, repo_full_name, commit_sha: null, deployed_url: null, build_exit_code: null, locale, created_at, updated_at });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("INSERT INTO build_job_events")) { const [id, job_id, at, stage, message, meta_json] = args; events.push({ id, job_id, at, stage, message, meta_json }); return { meta: { changes: 1 } }; }
            if (sql.includes("UPDATE build_jobs") && sql.includes("SET status = ?")) {
              const [status, wbs_done, wbs_total, spent_usd, commit_sha, repo_full_name, build_exit_code, updated_at, id] = args;
              const row = jobs.find((r) => r.id === id && !["done", "failed"].includes(r.status));
              if (row) Object.assign(row, { status, wbs_done, wbs_total, spent_usd, commit_sha: commit_sha ?? row.commit_sha, repo_full_name: repo_full_name ?? row.repo_full_name, build_exit_code: build_exit_code ?? row.build_exit_code, updated_at });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("SET status = 'done'")) {
              const [deployed_url, commit_sha, spent_usd, wbs_done, updated_at, id] = args;
              const row = jobs.find((r) => r.id === id && !["done", "failed"].includes(r.status));
              if (row) Object.assign(row, { status: "done", deployed_url, commit_sha: commit_sha ?? row.commit_sha, spent_usd, build_exit_code: 0, wbs_done, updated_at });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("SET status = 'failed'")) {
              const [failed_stage, error, spent_usd, build_exit_code, updated_at, id] = args;
              const row = jobs.find((r) => r.id === id && !["done", "failed"].includes(r.status));
              if (row) Object.assign(row, { status: "failed", failed_stage, error, spent_usd: Math.max(row.spent_usd, spent_usd), build_exit_code: build_exit_code ?? row.build_exit_code, updated_at });
              return { meta: { changes: row ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            if (sql.includes("FROM workspace_projects WHERE id = ?")) return projects.get(args[0]) ?? null;
            if (sql.includes("FROM build_jobs WHERE project_id = ?") && sql.includes("status IN")) return jobs.find((r) => r.project_id === args[0] && !["done", "failed"].includes(r.status)) ?? null;
            if (sql.includes("FROM build_jobs WHERE id = ?")) return jobs.find((r) => r.id === args[0]) ?? null;
            return null;
          },
          async all() {
            if (sql.includes("FROM build_jobs WHERE project_id = ?")) return { results: jobs.filter((r) => r.project_id === args[0]) };
            if (sql.includes("FROM build_job_events")) return { results: events.filter((e) => e.job_id === args[0]) };
            return { results: [] };
          },
        };
      }
      return { bind(...args) { return handler(args); }, run() { return handler([]).run(); }, first() { return handler([]).first(); }, all() { return handler([]).all(); } };
    },
  };
}

function projectRow(overrides = {}) {
  return { id: PROJECT, user_key: USER, title: "동네 빵집 픽업 예약", idea: "", understood_json: "{}", product_spec_json: "{}", items_json: "[]", built_with_json: null, entry_path: "idea", topic_tags_json: "[]", acquisition_json: null, dev_spec_json: JSON.stringify(DEV_SPEC), created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:00:00Z", ...overrides };
}

/** BUILDER DO 스텁: 받은 페이로드를 기록. */
function makeBuilder({ status = 202 } = {}) {
  const payloads = [];
  return {
    payloads,
    idFromName: (n) => ({ n }),
    get: () => ({ fetch: async (_url, init) => { payloads.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: status < 300 }), { status }); } }),
  };
}

/** Cloudflare·GitHub API 가짜 fetch. */
function makeFetch({ nsExists = true, d1Ok = true, ghInstalled = false } = {}) {
  const calls = [];
  return {
    calls,
    f: async (url, init = {}) => {
      calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
      const u = new URL(url);
      if (u.pathname.endsWith("/workers/dispatch/namespaces")) return new Response(JSON.stringify(nsExists ? { success: false, errors: [{ code: 100120, message: "Invalid dispatch namespace name. Ensure it does not already exist" }] } : { success: true, result: {} }), { status: nsExists ? 400 : 200 });
      if (u.pathname.endsWith("/d1/database")) return new Response(JSON.stringify(d1Ok ? { success: true, result: { uuid: "d1-uuid-1" } } : { success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: d1Ok ? 200 : 403 });
      if (u.pathname.includes("/orgs/") && u.pathname.endsWith("/installation")) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      return new Response(JSON.stringify({ success: false, errors: [{ code: 0, message: `unrouted ${u.pathname}` }] }), { status: 500 });
    },
  };
}

function envFor({ db, builder = makeBuilder(), hosting = true, llm = true, token = TOKEN, fetchImpl } = {}) {
  return {
    DB: db, BUILDER: builder, INTERNAL_CALLBACK_TOKEN: token, PUBLIC_BASE_URL: "https://cp.example",
    ...(hosting ? { HOSTING_CF_API_TOKEN: "cf-ops-SECRET", HOSTING_CF_ACCOUNT_ID: "acc1", HOSTING_ROOT_DOMAIN: "simsa.page" } : {}),
    ...(llm ? { ANTHROPIC_API_KEY: "sk-ant-SECRET", OPENAI_API_KEY: "sk-oa-SECRET", CF_AI_GATEWAY_ANTHROPIC_URL: "https://gw.example/anthropic" } : {}),
    GH_APP_ID: "1", GH_APP_PRIVATE_KEY: "", // App 미설정 → 저장소 없이 진행
    __fetch: fetchImpl,
  };
}

// hosting-provision/hosting-repo는 fetch를 인자로 받는다 — 라우트는 global fetch를 쓰므로 테스트에서 global을 바꾼다.
async function withFetch(f, fn) { const orig = globalThis.fetch; globalThis.fetch = f; try { return await fn(); } finally { globalThis.fetch = orig; } }

async function post(app, env, path, body, headers = {}) {
  const res = await app.fetch(new Request(`https://cp.example${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() };
}

test("POST /build: 지시서 → 프로비저닝(namespace 멱등·D1) → queued 행 + 디스패치 202. 페이로드에 비밀·WBS 순서·지시서 md, D1 행엔 비밀 0", async () => {
  const db = makeDb({ projects: new Map([[PROJECT, projectRow()]]) });
  const builder = makeBuilder();
  const fx = makeFetch();
  const app = createApp();
  const r = await withFetch(fx.f, () => post(app, envFor({ db, builder }), `/workspace/projects/${PROJECT}/build`, { userKey: USER, locale: "ko" }));
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.dispatched, true);
  assert.equal(r.body.job.status, "queued");
  assert.equal(r.body.job.wbsTotal, 2);
  assert.match(r.body.job.slug, /^app-/); // 한글 제목 → app-<id>
  assert.equal(r.body.job.hostUrl, `https://${r.body.job.slug}.simsa.page`);
  assert.equal(r.body.job.repoFullName, null);
  const p = builder.payloads[0];
  assert.equal(p.kind, "build");
  assert.equal(p.hosting.cfApiToken, "cf-ops-SECRET");
  assert.equal(p.hosting.d1Id, "d1-uuid-1");
  assert.equal(p.llm.anthropicApiKey, "sk-ant-SECRET");
  assert.equal(p.llm.anthropicBaseUrl, "https://gw.example/anthropic");
  assert.deepEqual(p.spec.wbs.map((w) => w.id), ["WBS-001", "WBS-002"]); // order 정렬
  assert.match(p.spec.markdown, /WBS-001/);
  assert.equal(p.repo, null);
  assert.equal(p.callbackUrl, "https://cp.example/internal/build-done");
  // D1 행에는 비밀이 없다
  assert.ok(!JSON.stringify(db._jobs).includes("SECRET"));
  assert.ok(db._events.some((e) => e.message.startsWith("repo_skipped:")));
  assert.ok(fx.calls.includes("POST /client/v4/accounts/acc1/d1/database"));
});

test("POST /build: 지시서 없으면 409 dev_spec_required · 남의 프로젝트 404 · 활성 잡 있으면 409", async () => {
  const db = makeDb({ projects: new Map([[PROJECT, projectRow({ dev_spec_json: null })]]) });
  const app = createApp();
  assert.equal((await post(app, envFor({ db }), `/workspace/projects/${PROJECT}/build`, { userKey: USER })).body.error, "dev_spec_required");
  assert.equal((await post(app, envFor({ db }), `/workspace/projects/${PROJECT}/build`, { userKey: "uk_other" })).status, 404);
  const db2 = makeDb({ projects: new Map([[PROJECT, projectRow()]]), jobs: [{ id: "bj_active", project_id: PROJECT, user_key: USER, status: "implementing", slug: "x", wbs_done: 1, wbs_total: 2, budget_usd: 10, spent_usd: 1, created_at: "2026", updated_at: "2026" }] });
  const r = await post(app, envFor({ db: db2 }), `/workspace/projects/${PROJECT}/build`, { userKey: USER });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "build_already_active");
  assert.equal(r.body.activeJobId, "bj_active");
});

test("POST /build: 호스팅 미설정 503 · D1 생성 실패면 잡을 만들지 않는다(502) · 디스패치 실패는 즉시 failed(queued)", async () => {
  const app = createApp();
  const db = makeDb({ projects: new Map([[PROJECT, projectRow()]]) });
  assert.equal((await post(app, envFor({ db, hosting: false }), `/workspace/projects/${PROJECT}/build`, { userKey: USER })).body.error, "hosting_not_configured");
  const bad = makeFetch({ d1Ok: false });
  const r1 = await withFetch(bad.f, () => post(app, envFor({ db }), `/workspace/projects/${PROJECT}/build`, { userKey: USER }));
  assert.equal(r1.status, 502);
  assert.equal(r1.body.error, "hosting_d1_failed");
  assert.equal(db._jobs.length, 0);
  const fx = makeFetch();
  const r2 = await withFetch(fx.f, () => post(app, envFor({ db, builder: makeBuilder({ status: 500 }) }), `/workspace/projects/${PROJECT}/build`, { userKey: USER }));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.dispatched, false);
  assert.equal(db._jobs[0].status, "failed");
  assert.equal(db._jobs[0].failed_stage, "queued");
});

test("progress 콜백: 토큰 게이트 · 전진만(역행 거부) · wbsDone 단조 · 이벤트 기록", async () => {
  const db = makeDb();
  const env = envFor({ db });
  const job = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-x", wbsTotal: 3 });
  const app = createApp();
  assert.equal((await post(app, env, "/internal/build-progress", { jobId: job.id, status: "implementing" })).status, 401);
  const h = { authorization: `Bearer ${TOKEN}` };
  let r = await post(app, env, "/internal/build-progress", { jobId: job.id, status: "implementing", wbsDone: 1, spentUsd: 0.4, message: "WBS-001 done" }, h);
  assert.equal(r.body.transitioned, true);
  r = await post(app, env, "/internal/build-progress", { jobId: job.id, status: "scaffolding" }, h); // 역행
  assert.equal(r.body.transitioned, false);
  r = await post(app, env, "/internal/build-progress", { jobId: job.id, status: "building", wbsDone: 0, buildExitCode: 0 }, h);
  const j = await getBuildJobById(env, job.id);
  assert.equal(j.status, "building");
  assert.equal(j.wbsDone, 1); // 0으로 내려가지 않음
  assert.equal(j.buildExitCode, 0);
  assert.equal(db._events.filter((e) => e.job_id === job.id).length, 1);
  assert.equal((await post(app, env, "/internal/build-progress", { jobId: job.id, status: "done" }, h)).status, 400);
});

test("done 콜백: D-4 — 빌드 exit≠0이면 done을 거부하고 failed(building)로 · exit 0이면 done+deployedUrl", async () => {
  const db = makeDb();
  const env = envFor({ db });
  const app = createApp();
  const h = { authorization: `Bearer ${TOKEN}` };
  const j1 = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "a", wbsTotal: 1 });
  let r = await post(app, env, "/internal/build-done", { jobId: j1.id, ok: true, deployedUrl: "https://a.simsa.page", buildExitCode: 1, spentUsd: 2 }, h);
  assert.deepEqual(r.body, { ok: true, accepted: false, reason: "build_not_green" });
  const s1 = await getBuildJobById(env, j1.id);
  assert.equal(s1.status, "failed");
  assert.equal(s1.failedStage, "building");
  const j2 = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "b", wbsTotal: 1 });
  r = await post(app, env, "/internal/build-done", { jobId: j2.id, ok: true, deployedUrl: "https://b.simsa.page", buildExitCode: 0, spentUsd: 3.5, wbsDone: 1, commitSha: "abc" }, h);
  assert.deepEqual(r.body, { ok: true, accepted: true });
  const s2 = await getBuildJobById(env, j2.id);
  assert.equal(s2.status, "done");
  assert.equal(s2.deployedUrl, "https://b.simsa.page");
  assert.equal(s2.spentUsd, 3.5);
  // 최종 상태 뒤 전이 불가
  assert.equal(await advanceBuildJob(env, j2.id, { status: "building" }), false);
  assert.equal(await markBuildJobFailed(env, j2.id, { failedStage: "x", error: "late" }), false);
  const j3 = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "c", wbsTotal: 1 });
  r = await post(app, env, "/internal/build-done", { jobId: j3.id, ok: false, failedStage: "budget", error: "budget exceeded $10", spentUsd: 10.2 }, h);
  assert.equal(r.body.accepted, true);
  assert.equal((await getBuildJobById(env, j3.id)).failedStage, "budget");
});

test("GET build-jobs: 소유권 · 목록 · 상세+이벤트", async () => {
  const db = makeDb({ projects: new Map([[PROJECT, projectRow()]]) });
  const env = envFor({ db });
  const job = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-x", wbsTotal: 2 });
  const app = createApp();
  const list = await (await app.fetch(new Request(`https://cp.example/workspace/projects/${PROJECT}/build-jobs?userKey=${USER}`), env)).json();
  assert.equal(list.jobs.length, 1);
  assert.equal(list.hostRoot, "simsa.page");
  const detail = await (await app.fetch(new Request(`https://cp.example/workspace/projects/${PROJECT}/build-jobs/${job.id}?userKey=${USER}`), env)).json();
  assert.equal(detail.job.id, job.id);
  assert.deepEqual(detail.events, []);
  assert.equal((await app.fetch(new Request(`https://cp.example/workspace/projects/${PROJECT}/build-jobs/${job.id}?userKey=uk_other`), env)).status, 404);
});

test("markBuildJobDone은 exit≠0을 저장 전에 거부한다(라우트를 우회해도)", async () => {
  const env = envFor({ db: makeDb() });
  const job = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "d", wbsTotal: 1 });
  assert.deepEqual(await markBuildJobDone(env, job.id, { deployedUrl: "u", commitSha: null, spentUsd: 0, buildExitCode: 2, wbsDone: 1 }), { ok: false, reason: "build_not_green" });
  assert.equal((await getBuildJobById(env, job.id)).status, "queued");
});

test("hosting-reserved는 hosting-dispatch의 RESERVED_SLUGS와 같은 목록", async () => {
  const { RESERVED_SLUGS_FOR_HOSTING } = await import("../dist/workspace/hosting-reserved.js");
  const { RESERVED_SLUGS } = await import("../../hosting-dispatch/dist/route.js");
  assert.deepEqual([...RESERVED_SLUGS_FOR_HOSTING].sort(), [...RESERVED_SLUGS].sort());
});

test("스턱 스윕: 60분 무진행 활성 잡은 failed(그 단계), 살아 있는 잡은 그대로", async () => {
  const { cleanupStuckBuildJobs } = await import("../dist/stuck-cleanup.js");
  const old = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  const jobs = [
    { id: "bj_old", project_id: PROJECT, user_key: USER, slug: "a", status: "implementing", wbs_done: 1, wbs_total: 3, budget_usd: 10, spent_usd: 1, created_at: old, updated_at: old },
    { id: "bj_live", project_id: PROJECT, user_key: USER, slug: "b", status: "building", wbs_done: 3, wbs_total: 3, budget_usd: 10, spent_usd: 4, created_at: old, updated_at: new Date().toISOString() },
  ];
  const db = makeDb({ jobs });
  const origAll = db.prepare;
  db.prepare = (sql) => {
    const h = origAll.call(db, sql);
    if (sql.includes("FROM build_jobs") && sql.includes("updated_at < ?")) {
      return { bind: (cutoff, limit) => ({ all: async () => ({ results: jobs.filter((j) => !["done", "failed"].includes(j.status) && j.updated_at < cutoff).slice(0, limit).map((j) => ({ id: j.id, status: j.status })) }) }) };
    }
    return h;
  };
  const r = await cleanupStuckBuildJobs(envFor({ db }));
  assert.deepEqual(r, { swept: 1, errors: 0 });
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].failed_stage, "implementing");
  assert.equal(jobs[1].status, "building");
});

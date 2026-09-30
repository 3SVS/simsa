/**
 * SI 티어 Train B — B-5b-0 + B-5b-1: 빌드 실행체 골격.
 *
 *   B-5b-0  빌더 이미지가 packages/core·packages/agent-worker를 **이미지 안에서** 빌드해 builder-run.mjs가
 *           runBuildLoop·build-policy를 import할 수 있다 → 자가점검에 agentWorker·template 항목(CI 스모크가 증거).
 *   B-5b-1  kind "build" 분기 → 상태 머신 중 scaffolding까지 실제 구현(템플릿 준비 + 진행 콜백으로 stage 행 기록),
 *           implementing 이후는 `builder_stage_not_implemented:implementing`으로 **정직하게** 실패(조용한 성공 없음).
 *
 * 네트워크·Docker 없음: 콜백은 주입한 poster(또는 Worker 라우트 app.fetch에 직접), git은 주입 exec, 파일은 OS 임시 폴더.
 * Rule 6: 제품명은 한글·특수문자, slug·키는 ASCII.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "../..");
const REPO_TEMPLATE = path.join(REPO, "templates/simsa-hosted-app");
const REPO_AGENT_WORKER_DIST = path.join(REPO, "packages/agent-worker/dist/index.js");

const run = await import("../builder-container/builder-run.mjs");
const { BUILD_JOB_STATUSES, insertQueuedBuildJob, getBuildJobById } = await import("../dist/workspace/build-job-db.js");
const { createApp } = await import("../dist/router.js");
const { parseCallbackUsage } = await import("../dist/workspace/llm-usage.js");
const { summarizeSelfCheck } = await import("../dist/routes/builder-probe.js");

const dockerfile = readFileSync(path.join(ROOT, "builder-container/Dockerfile"), "utf8");
const serverMjs = readFileSync(path.join(ROOT, "builder-container/server.mjs"), "utf8");
const imagesYml = readFileSync(path.join(REPO, ".github/workflows/container-images.yml"), "utf8");

const TOKEN = "tok_internal_FAKE";
const USER = "uk_owner";
const PROJECT = "wsp_b5b1";
const D1_UUID = "5f0c8a4e-1b2d-4c3e-9f10-2a3b4c5d6e7f";
const PRODUCT = "동네 빵집 소금빵 예약 (주)빵굽는집";

/** Worker가 디스패치하는 페이로드 모양(workspace-build-jobs.ts BuildDispatchPayload). 비밀은 명백한 가짜. */
function buildPayload(overrides = {}) {
  return {
    jobId: "bj_0a1b2c3d4e", projectId: PROJECT, userKey: USER, kind: "build", slug: "app-3f9a1c2b", locale: "ko",
    baseUrl: "https://cp.example", callbackUrl: "https://cp.example/internal/build-done", progressUrl: "https://cp.example/internal/build-progress",
    callbackToken: TOKEN, budgetUsd: 10,
    spec: {
      markdown: `# ${PRODUCT}\n\n## 작업\n- WBS-001 예약 저장\n- WBS-002 예약 화면`,
      wbs: [
        { id: "WBS-001", title: "예약 저장", order: 1, acceptanceIds: ["AC-001"], dependsOn: [] },
        { id: "WBS-002", title: "예약 화면 — 한글 버튼 '예약하기'", order: 2, acceptanceIds: ["AC-001"], dependsOn: ["WBS-001"] },
      ],
      productName: PRODUCT,
    },
    hosting: { cfApiToken: "cf-ops-FAKE-SECRET", cfAccountId: "acc1", namespace: "simsa-hosted", hostRoot: "simsa.page", d1Id: D1_UUID },
    repo: { token: "ghs_FAKE-SECRET-repo", org: "simsa-hosted", name: "app-3f9a1c2b" },
    llm: { anthropicApiKey: "sk-ant-FAKE-SECRET", anthropicBaseUrl: null, openaiApiKey: "sk-oa-FAKE-SECRET", model: "claude-sonnet-4-6", preferFallback: true },
    ...overrides,
  };
}

const createdTmp = [];
async function tmpDir(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `b5b-${tag}-`));
  createdTmp.push(d);
  return d;
}
after(async () => {
  await Promise.all(createdTmp.map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function exists(p) {
  return fs.access(p).then(() => true, () => false);
}

/** git 호출을 기록하는 가짜 exec — rev-parse만 sha를 돌려준다. */
function gitExec({ failOn = null } = {}) {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args: [...args], cwd: opts.cwd ?? null });
    if (failOn && args.includes(failOn)) return { ok: false, code: 128, stdout: "", stderr: "fatal", error: `git ${failOn} failed` };
    if (args.includes("rev-parse")) return { ok: true, code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "", error: null };
    return { ok: true, code: 0, stdout: "", stderr: "", error: null };
  };
  return { exec, calls };
}

/** 콜백 poster 가짜 — 응답을 순서대로 돌려주고, 기록한다. */
function recordingPoster(responses = []) {
  const calls = [];
  const post = async (url, token, body) => {
    calls.push({ url, token, body: JSON.parse(JSON.stringify(body)) });
    const r = responses.length ? responses.shift() : { ok: true, status: 200, json: { ok: true, transitioned: true } };
    return r;
  };
  return { post, calls };
}

// ── 가짜 D1 (workspace-build-jobs.test.mjs와 같은 모양, 필요한 문장만) ────────────────────────────
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
            if (sql.includes("FROM build_job_events")) return { results: events.filter((e) => e.job_id === args[0]) };
            return { results: [] };
          },
        };
      }
      return { bind(...args) { return handler(args); }, run() { return handler([]).run(); }, first() { return handler([]).first(); }, all() { return handler([]).all(); } };
    },
  };
}

function workerEnv(db, extra = {}) {
  return { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN, PUBLIC_BASE_URL: "https://cp.example", ...extra };
}

/** 컨테이너 poster를 **실제 Worker 라우트**에 잇는다 — 두 표면의 콜백 계약을 한 번에 검사. */
function posterIntoWorker(app, env) {
  const calls = [];
  const post = async (url, token, body) => {
    calls.push({ url, body: JSON.parse(JSON.stringify(body)) });
    const res = await app.fetch(new Request(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env);
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  };
  return { post, calls };
}

// ══ B-5b-0 ═══════════════════════════════════════════════════════════════════════════════════════

describe("B-5b-0 · 이미지 안의 agent-worker", () => {
  it("selfCheck에 agentWorker 항목 — 필수 export가 빠지면 ok=false + 무엇이 빠졌는지", async () => {
    const loadAgentWorker = async () => ({ decideCommand() {}, BUILD_LIMITS: {} });
    // 툴체인·작업 디렉터리·템플릿은 전부 정상 — 실패 사유는 agent-worker 하나뿐이게.
    const exec = async (cmd) => (["vercel", "netlify"].includes(cmd)
      ? { ok: false, code: 127, stdout: "", stderr: "", error: "ENOENT" }
      : { ok: true, code: 0, stdout: "1.0.0", stderr: "", error: null });
    const healthy = await run.selfCheck({ exec, workRoot: await tmpDir("sc0"), loadAgentWorker: async () => import(pathToFileURL(REPO_AGENT_WORKER_DIST).href), templateDir: REPO_TEMPLATE });
    assert.equal(healthy.ok, true, JSON.stringify({ aw: healthy.agentWorker, t: healthy.template, w: healthy.workRoot }));
    const r = await run.selfCheck({ exec, workRoot: await tmpDir("sc1"), loadAgentWorker, templateDir: REPO_TEMPLATE });
    assert.equal(r.agentWorker.ok, false);
    assert.ok(r.agentWorker.missing.includes("runBuildLoop"), JSON.stringify(r.agentWorker));
    assert.equal(r.template.ok, true);
    assert.equal(r.workRoot.ok, true);
    assert.equal(r.ok, false, "agent-worker가 없으면 빌더 이미지는 건강하지 않다");
  });

  it("agent-worker import 자체가 실패하면 ok=false + 오류 문구(비밀 없음)", async () => {
    const r = await run.checkAgentWorker({ loadAgentWorker: async () => { throw new Error("Cannot find module '/builder/ws/packages/agent-worker/dist/index.js'"); } });
    assert.equal(r.ok, false);
    assert.match(r.error, /Cannot find module/);
  });

  it("REQUIRED_AGENT_WORKER_EXPORTS는 **실제** agent-worker dist와 맞는다(이름을 바꾸면 여기서 깨진다)", async () => {
    const r = await run.checkAgentWorker({ entry: REPO_AGENT_WORKER_DIST });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.missing, []);
    for (const name of ["runBuildLoop", "withOpenAiFallback", "decideCommand", "filterEnv"]) assert.ok(run.REQUIRED_AGENT_WORKER_EXPORTS.includes(name), name);
  });

  it("selfCheck에 template 항목 — 실제 템플릿은 ok, D1 자리 표시자가 없으면 ok=false", async () => {
    const good = await run.checkTemplate(REPO_TEMPLATE);
    assert.equal(good.ok, true, JSON.stringify(good));
    assert.equal(good.version, JSON.parse(readFileSync(path.join(REPO_TEMPLATE, "package.json"), "utf8")).version);
    const broken = await tmpDir("tpl-broken");
    await fs.writeFile(path.join(broken, "package.json"), JSON.stringify({ name: "x", version: "0.0.1" }));
    await fs.writeFile(path.join(broken, "wrangler.toml"), 'name = "x"\n');
    const bad = await run.checkTemplate(broken);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /placeholder/);
  });

  it("Dockerfile: core·agent-worker를 이미지 안에서 lockfile 고정으로 빌드 — 경로는 AGENT_WORKER_ENTRY와 같다", () => {
    assert.match(dockerfile, /pnpm install --frozen-lockfile --filter "@simsa\/agent-worker\.\.\."/, "filtered frozen install of agent-worker + its deps");
    assert.match(dockerfile, /pnpm --filter "@simsa\/agent-worker\.\.\." run build/, "build core → agent-worker in topological order");
    const wsDir = path.posix.dirname(path.posix.dirname(path.posix.dirname(path.posix.dirname(run.AGENT_WORKER_ENTRY))));
    assert.match(dockerfile, new RegExp(`WORKDIR ${wsDir.replace(/\//g, "\\/")}\\n`), `workspace root in image must be ${wsDir}`);
    assert.ok(dockerfile.includes(run.AGENT_WORKER_ENTRY), "the build-time import guard must load the same entry the runner uses");
    // node_modules·dist가 빌드 컨텍스트에 있어도(배포 워크플로는 install 뒤 이미지를 빌드한다) 이미지로 새지 않게 — 패키지 폴더 통째 COPY 금지.
    assert.doesNotMatch(dockerfile, /COPY\s+packages\/core\s+/, "copy src/scripts/manifests only, never the whole package dir");
    assert.doesNotMatch(dockerfile, /COPY\s+packages\/agent-worker\s+/, "copy src/manifests only, never the whole package dir");
    assert.match(dockerfile, /COPY\s+packages\/agent-worker\/src\s/, "agent-worker sources");
    assert.match(dockerfile, /COPY\s+packages\/core\/src\s/, "core sources");
    // 노트북 publish·release 경로를 쓰지 않는다(CLAUDE.md Releases).
    // `\b` — "pnpm install --filter @simsa/…"(워크스페이스 로컬 설치)는 허용, 레지스트리 npm install은 금지.
    assert.doesNotMatch(dockerfile, /\bnpm publish|\bnpm install[^\n]*@simsa\//, "never install @simsa/* from the registry");
  });

  it("Dockerfile: 템플릿을 TEMPLATE_DIR로 복사한다", () => {
    assert.match(dockerfile, new RegExp(`COPY\\s+templates\\/simsa-hosted-app\\s+${run.TEMPLATE_DIR.replace(/\//g, "\\/")}\\n`));
  });

  it("container-images CI: 이미지에 들어가는 소스가 바뀌면 PR에서 빌드·스모크하고, agentWorker·template을 명시적으로 확인한다", () => {
    for (const p of ["packages/core/**", "packages/agent-worker/**", "templates/simsa-hosted-app/**", "pnpm-lock.yaml"]) {
      assert.ok(imagesYml.includes(`'${p}'`), `container-images.yml paths must include ${p}`);
    }
    assert.match(imagesYml, /\.agentWorker\.ok == true/, "smoke must assert agentWorker.ok");
    assert.match(imagesYml, /\.template\.ok == true/, "smoke must assert template.ok");
  });

  it("Worker 프로브(summarizeSelfCheck)가 agentWorker·template을 버리지 않는다 — ops-probe가 라이브 증거 경로", () => {
    const s = summarizeSelfCheck({
      ok: false, runnerRev: run.RUNNER_REV, tools: [], forbiddenPresent: [], workRoot: { ok: true },
      agentWorker: { ok: false, missing: ["runBuildLoop", 7], ms: 12, error: "x" }, template: { ok: true, version: "0.1.0", ms: 1 },
    }, 10);
    assert.deepEqual(s.agentWorker, { ok: false, missing: ["runBuildLoop"] });
    assert.deepEqual(s.template, { ok: true, version: "0.1.0" });
    const old = summarizeSelfCheck({ ok: true, runnerRev: "b1-builder-1", tools: [] }, 1);
    assert.equal(old.agentWorker, null, "옛 이미지(항목 없음)는 null — '있다'고 꾸미지 않는다");
    assert.equal(old.template, null);
  });
});

// ══ B-5b-1 ═══════════════════════════════════════════════════════════════════════════════════════

describe("B-5b-1 · 상태 머신 계약", () => {
  it("컨테이너 BUILD_STAGES = D1 BUILD_JOB_STATUSES (순서까지 — pushed 다음 deploying)", () => {
    assert.deepEqual([...run.BUILD_STAGES], [...BUILD_JOB_STATUSES]);
  });

  it("이 이미지가 실제로 수행하는 단계는 scaffolding뿐 — 나머지는 정직하게 미구현", () => {
    assert.deepEqual([...run.IMPLEMENTED_BUILD_STAGES], ["scaffolding"]);
  });

  it("progressBody: 진행 상태만(최종·미지 상태는 Worker가 400이므로 만들지 않는다)", () => {
    const job = run.validateBuildPayload(buildPayload()).job;
    const b = run.progressBody(job, "scaffolding", { message: "scaffold_started", meta: { a: 1 } });
    assert.deepEqual(Object.keys(b).sort(), ["jobId", "message", "meta", "spentUsd", "status", "wbsDone", "wbsTotal"].sort());
    assert.equal(b.status, "scaffolding");
    assert.equal(b.wbsTotal, 2);
    assert.equal(b.wbsDone, 0);
    assert.throws(() => run.progressBody(job, "done", {}), /progress_status_invalid:done/);
    assert.throws(() => run.progressBody(job, "failed", {}), /progress_status_invalid:failed/);
    assert.throws(() => run.progressBody(job, "deploy", {}), /progress_status_invalid:deploy/);
  });
});

describe("B-5b-1 · validateBuildPayload (외부 경계 — 명시 가드)", () => {
  it("Worker가 실제로 디스패치한 페이로드를 받아들이고, 정규화된 잡에는 비밀이 없다", async () => {
    // 실제 라우트 POST /workspace/projects/:id/build로 페이로드를 만든다(가짜 D1·BUILDER·CF API).
    const DEV_SPEC = {
      meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-30T00:00:00.000Z" },
      brief: { productName: PRODUCT, oneLine: "소금빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
      features: [{ id: "FR-001", title: "예약", description: "빵을 고르고 예약한다", priority: "must" }],
      acceptance: [{ id: "AC-001", featureId: "FR-001", given: "목록", when: "예약 누름", then: "확인 화면이 보인다", verifiedBy: "browser" }],
      screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: ["버튼"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
      dataModel: [{ name: "reservations", fields: [{ name: "id", type: "text", required: true }], relations: [], ownership: "unknown" }],
      apis: [], nonFunctional: [],
      workBreakdown: [{ id: "WBS-002", title: "예약 화면", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-001"] }, { id: "WBS-001", title: "예약 저장", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] }],
      testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기"] }], assumptions: [], openQuestions: [],
    };
    const projects = new Map([[PROJECT, { id: PROJECT, user_key: USER, title: PRODUCT, idea: "", understood_json: "{}", product_spec_json: "{}", items_json: "[]", built_with_json: null, entry_path: "idea", topic_tags_json: "[]", acquisition_json: null, dev_spec_json: JSON.stringify(DEV_SPEC), created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" }]]);
    const db = makeDb({ projects });
    const payloads = [];
    const builder = { idFromName: (n) => ({ n }), get: () => ({ fetch: async (_u, init) => { payloads.push(JSON.parse(init.body)); return new Response("{}", { status: 202 }); } }) };
    const env = workerEnv(db, {
      BUILDER: builder, HOSTING_CF_API_TOKEN: "cf-ops-FAKE-SECRET", HOSTING_CF_ACCOUNT_ID: "acc1", HOSTING_ROOT_DOMAIN: "simsa.page",
      ANTHROPIC_API_KEY: "sk-ant-FAKE-SECRET", OPENAI_API_KEY: "sk-oa-FAKE-SECRET", HOSTING_GH_APP_ID: "1", HOSTING_GH_APP_PRIVATE_KEY: "",
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/workers/dispatch/namespaces")) return new Response(JSON.stringify({ success: false, errors: [{ code: 100120, message: "already exist" }] }), { status: 400 });
      if (u.pathname.endsWith("/d1/database")) return new Response(JSON.stringify({ success: true, result: { uuid: D1_UUID } }), { status: 200 });
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    };
    let res;
    try {
      res = await createApp().fetch(new Request(`https://cp.example/workspace/projects/${PROJECT}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userKey: USER, locale: "ko" }) }), env);
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(res.status, 202, await res.clone().text());
    assert.equal(payloads.length, 1);
    const v = run.validateBuildPayload(payloads[0]);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.job.productName, PRODUCT, "한글 제품명은 표시용으로 그대로");
    assert.match(v.job.slug, /^[a-z0-9-]+$/, "slug는 ASCII");
    assert.deepEqual(v.job.wbs.map((w) => w.id), ["WBS-001", "WBS-002"]);
    assert.equal(v.job.d1Id, D1_UUID);
    const s = JSON.stringify(v.job);
    assert.ok(!s.includes("SECRET"), "정규화된 잡에는 운영 토큰·LLM 키·저장소 토큰이 없다");
    assert.ok(!s.includes(TOKEN), "콜백 토큰도 없다");
  });

  it("경로 탈출 jobId · 한글/대문자 slug · TOML 주입 d1Id · 빈 WBS · 다른 출처 progressUrl · 모르는 locale → 거부(필드 이름만)", () => {
    const cases = [
      [{ jobId: "../../etc" }, "jobId"],
      [{ slug: "동네-빵집" }, "slug"],
      [{ slug: "App-X" }, "slug"],
      [{ hosting: { ...buildPayload().hosting, d1Id: 'x"\n[vars]\nA = "1' } }, "hosting.d1Id"],
      [{ spec: { ...buildPayload().spec, wbs: [] } }, "spec.wbs"],
      [{ spec: { ...buildPayload().spec, wbs: [{ id: "WBS-001", title: "t", order: "1", acceptanceIds: [], dependsOn: [] }] } }, "spec.wbs"],
      [{ progressUrl: "https://evil.example/internal/build-progress" }, "progressUrl"],
      [{ progressUrl: "ftp://cp.example/x" }, "progressUrl"],
      [{ locale: "jp" }, "locale"],
      [{ budgetUsd: -1 }, "budgetUsd"],
    ];
    for (const [patch, field] of cases) {
      const v = run.validateBuildPayload(buildPayload(patch));
      assert.equal(v.ok, false, `${JSON.stringify(patch)} must be rejected`);
      assert.ok(v.errors.includes(field), `${JSON.stringify(patch)} → ${JSON.stringify(v.errors)} must name ${field}`);
      assert.ok(!JSON.stringify(v.errors).includes("SECRET"), "errors never echo secrets");
    }
    assert.equal(run.validateBuildPayload(null).ok, false);
  });
});

describe("B-5b-1 · 스캐폴드", () => {
  it("patchWranglerToml: D1 id·database_name·name을 채운다 / 자리 표시자가 없으면 정직하게 던진다", () => {
    const src = readFileSync(path.join(REPO_TEMPLATE, "wrangler.toml"), "utf8");
    const out = run.patchWranglerToml(src, { slug: "app-3f9a1c2b", d1Id: D1_UUID });
    assert.match(out, new RegExp(`database_id = "${D1_UUID}"`));
    assert.match(out, /database_name = "simsa-hosted-app-3f9a1c2b"/);
    assert.match(out, /^name = "app-3f9a1c2b"$/m);
    assert.ok(!out.includes(run.TEMPLATE_D1_PLACEHOLDER));
    assert.throws(() => run.patchWranglerToml('name = "x"\n', { slug: "app-3f9a1c2b", d1Id: D1_UUID }), /template_placeholder_missing:database_id/);
  });

  it("scaffoldTemplate: 템플릿을 작업 폴더에 복사 — node_modules·dist·.wrangler·.env는 따라오지 않는다", async () => {
    const tpl = await tmpDir("tpl");
    await fs.cp(REPO_TEMPLATE, tpl, { recursive: true });
    for (const junk of ["node_modules/hono/index.js", "dist/client/index.html", ".wrangler/state/x", ".env"]) {
      await fs.mkdir(path.dirname(path.join(tpl, junk)), { recursive: true });
      await fs.writeFile(path.join(tpl, junk), "junk");
    }
    await fs.writeFile(path.join(tpl, ".env.example"), "A=\n");
    const appDir = path.join(await tmpDir("app"), "app");
    const r = await run.scaffoldTemplate({ templateDir: tpl, appDir, slug: "app-3f9a1c2b", d1Id: D1_UUID });
    assert.ok(r.files >= 10, `files=${r.files}`);
    assert.equal(r.templateVersion, "0.1.0");
    assert.ok(await exists(path.join(appDir, "src/worker.ts")));
    assert.ok(await exists(path.join(appDir, "migrations/0001_init.sql")));
    assert.ok(await exists(path.join(appDir, ".env.example")), ".env.example is kept");
    for (const junk of ["node_modules", "dist", ".wrangler", ".env"]) assert.equal(await exists(path.join(appDir, junk)), false, `${junk} must not be copied`);
    const toml = await fs.readFile(path.join(appDir, "wrangler.toml"), "utf8");
    assert.match(toml, new RegExp(`database_id = "${D1_UUID}"`));
  });
});

describe("B-5b-1 · runBuildJob kind=build", () => {
  it("scaffolding까지 실제로 하고, 진행 콜백 2개 → implementing에서 정직하게 실패. 작업 폴더는 지운다", async () => {
    const workRoot = await tmpDir("wr");
    const git = gitExec();
    const poster = recordingPoster();
    const stages = [];
    const r = await run.runBuildJob(buildPayload(), { workRoot, templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: poster.post, onStage: (s) => stages.push(s) });

    assert.deepEqual(poster.calls.map((c) => [c.url, c.body.status, c.body.message]), [
      ["https://cp.example/internal/build-progress", "scaffolding", "scaffold_started"],
      ["https://cp.example/internal/build-progress", "scaffolding", "scaffold_ready"],
    ]);
    assert.ok(poster.calls.every((c) => c.token === TOKEN), "Bearer = payload callbackToken");
    const ready = poster.calls[1].body;
    assert.equal(ready.meta.templateVersion, "0.1.0");
    assert.ok(ready.meta.files >= 10);
    assert.equal(ready.meta.baseCommit, "0123456789ab");
    assert.equal(ready.meta.runnerRev, run.RUNNER_REV);
    assert.equal(ready.wbsTotal, 2);
    assert.ok(!("usage" in ready), "LLM 호출이 없으면 usage[]를 싣지 않는다(빈 델타)");

    assert.deepEqual(r, { jobId: "bj_0a1b2c3d4e", ok: false, stage: "failed", failedStage: "implementing", error: "builder_stage_not_implemented:implementing", spentUsd: 0, wbsDone: 0 });
    assert.deepEqual(stages, ["scaffolding"]);

    // git: 스캐폴드 커밋(로컬) — push는 범위 밖
    const verbs = git.calls.map((c) => c.args.find((a) => ["init", "add", "commit", "rev-parse", "push"].includes(a)));
    assert.deepEqual(verbs, ["init", "add", "commit", "rev-parse"]);
    assert.ok(git.calls.every((c) => c.cwd === path.join(workRoot, "bj_0a1b2c3d4e", "app")));
    assert.ok(git.calls.find((c) => c.args.includes("commit")).args.includes("commit.gpgsign=false"));

    // 비밀은 콜백·exec 어디에도
    const leaked = JSON.stringify({ calls: poster.calls.map((c) => c.body), git: git.calls, r });
    assert.ok(!leaked.includes("SECRET"), "no payload secret reaches callbacks or git");

    assert.equal(await exists(path.join(workRoot, "bj_0a1b2c3d4e")), false, "job work dir is removed after the run");
  });

  it("템플릿이 없으면 failed(scaffolding) — scaffold_started만 기록, implementing으로 가지 않는다", async () => {
    const poster = recordingPoster();
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr2"), templateDir: path.join(os.tmpdir(), "no-such-template-b5b"), exec: gitExec().exec, postCallback: poster.post });
    assert.equal(r.ok, false);
    assert.equal(r.failedStage, "scaffolding");
    assert.match(r.error, /^scaffold_failed:/);
    assert.deepEqual(poster.calls.map((c) => c.body.message), ["scaffold_started"]);
  });

  it("git 커밋이 실패하면 failed(scaffolding) + 어느 단계인지", async () => {
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr3"), templateDir: REPO_TEMPLATE, exec: gitExec({ failOn: "commit" }).exec, postCallback: recordingPoster().post });
    assert.equal(r.failedStage, "scaffolding");
    assert.match(r.error, /^scaffold_failed:git_commit_failed/);
  });

  it("Worker가 잡을 활성으로 보지 않으면(transitioned:false) 즉시 멈춘다 — 스캐폴드·git 없음(좀비 빌드 비용 방어)", async () => {
    const git = gitExec();
    const poster = recordingPoster([{ ok: true, status: 200, json: { ok: true, transitioned: false } }]);
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr4"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: poster.post });
    assert.equal(r.failedStage, "scaffolding");
    assert.equal(r.error, "job_not_active");
    assert.equal(git.calls.length, 0);
    assert.equal(poster.calls.length, 1);
  });

  it("진행 콜백이 4xx(계약 파손·토큰 불일치)면 멈추고, 5xx·네트워크면 계속 간다", async () => {
    const p401 = recordingPoster([{ ok: false, status: 401, json: { ok: false, error: "unauthorized" } }]);
    const r1 = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr5"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: p401.post });
    assert.equal(r1.error, "progress_rejected:401");
    assert.equal(r1.failedStage, "scaffolding");

    const p503 = recordingPoster([{ ok: false, status: 503, json: null }, { ok: false, status: 0, json: null, error: "fetch failed" }]);
    const r2 = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr6"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: p503.post });
    assert.equal(r2.failedStage, "implementing", "기록이 한 번 실패했다고 잡을 버리지 않는다");
    assert.equal(p503.calls.length, 2);
  });

  it("잘못된 페이로드는 failed(queued) + 필드 이름", async () => {
    const r = await run.runBuildJob(buildPayload({ slug: "동네" }), { workRoot: await tmpDir("wr7"), postCallback: recordingPoster().post });
    assert.equal(r.failedStage, "queued");
    assert.equal(r.error, "invalid_build_payload:slug");
  });

  it("그 밖의 kind는 종전대로 builder_stage_not_implemented (예시 성공 없음)", async () => {
    await assert.rejects(run.runBuildJob({ ...buildPayload(), kind: "deploy" }, {}), /builder_stage_not_implemented:deploy/);
  });
});

describe("B-5b-1 · 컨테이너 → Worker 콜백 계약 (#548 + #562)", () => {
  it("runBuildJob의 진행·최종 본문을 실제 라우트에 넣으면: scaffolding 전이 + 이벤트 2개 → failed(implementing)", async () => {
    const db = makeDb();
    const env = workerEnv(db);
    const job = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 2 });
    const app = createApp();
    const poster = posterIntoWorker(app, env);
    const payload = buildPayload({ jobId: job.id });
    const result = await run.runBuildJob(payload, { workRoot: await tmpDir("wr8"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: poster.post });
    assert.equal((await getBuildJobById(env, job.id)).status, "scaffolding");
    assert.deepEqual(db._events.filter((e) => e.job_id === job.id).map((e) => [e.stage, e.message]), [["scaffolding", "scaffold_started"], ["scaffolding", "scaffold_ready"]]);

    // server.mjs가 하는 일: 최종 본문을 callbackUrl(build-done)로
    const done = await poster.post(payload.callbackUrl, TOKEN, result);
    assert.equal(done.status, 200);
    assert.equal(done.json.accepted, true);
    const final = await getBuildJobById(env, job.id);
    assert.equal(final.status, "failed");
    assert.equal(final.failedStage, "implementing");
    assert.equal(final.error, "builder_stage_not_implemented:implementing");
    assert.equal(final.deployedUrl, null, "조용한 성공 없음");
  });

  it("server.mjs의 예외 경로 본문(failureCallbackBody)은 Worker가 읽는 failedStage 키를 쓴다 — 종전 failedAt은 'unknown'으로 기록됐다", async () => {
    const err = Object.assign(new Error("boom"), { stage: "scaffolding" });
    const body = run.failureCallbackBody("bj_x", err);
    assert.deepEqual(body, { jobId: "bj_x", ok: false, stage: "failed", failedStage: "scaffolding", error: "boom" });
    assert.equal(run.failureCallbackBody("bj_y", new Error("no stage")).failedStage, "unknown");

    const db = makeDb();
    const env = workerEnv(db);
    const job = await insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-y", wbsTotal: 1 });
    const poster = posterIntoWorker(createApp(), env);
    await poster.post("https://cp.example/internal/build-done", TOKEN, run.failureCallbackBody(job.id, err));
    assert.equal((await getBuildJobById(env, job.id)).failedStage, "scaffolding");

    assert.doesNotMatch(serverMjs, /failedAt/, "server.mjs must not send the key the Worker ignores");
    assert.match(serverMjs, /failureCallbackBody\(/, "server.mjs uses the shared failure body");
  });

  it("server.mjs: kind=build 페이로드는 202 전에 validateBuildPayload로 거른다(디스패치가 즉시 failed(queued)를 기록하도록)", () => {
    const i202 = serverMjs.indexOf("json(res, 202,");
    const iVal = serverMjs.indexOf("validateBuildPayload(");
    assert.ok(iVal > 0 && iVal < i202, "validateBuildPayload must run before the 202 ack");
    assert.match(serverMjs, /onStage/, "server tracks the current stage for the SIGTERM drain body");
  });
});

describe("B-5b-1 · usage 델타 우편함 (#562 규약 — B-5b-2가 runBuildLoop onUsage에 연결)", () => {
  const rec = (n) => ({ vendor: "openai", modelRequested: "claude-sonnet-4-6", modelActual: "gpt-5.4", inputTokens: 100 * n, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 * n, latencyMs: 900 + n, costUsd: 0.01 * n, unpriced: false });

  it("callId = <nonce>:<태스크 id>:<턴> — 태스크마다 턴을 0부터, 재전송에 불변", () => {
    const box = run.createUsageOutbox({ nonce: "n1" });
    box.record(rec(1), { taskId: "WBS-001" });
    box.record(rec(2), { taskId: "WBS-001" });
    box.record(rec(3), { taskId: "WBS-002" });
    const first = box.pending();
    assert.deepEqual(first.map((u) => u.callId), ["n1:WBS-001:0", "n1:WBS-001:1", "n1:WBS-002:0"]);
    // 콜백 실패 → ack 안 함 → 다음 콜백에 **같은 callId**로 다시
    assert.deepEqual(box.pending().map((u) => u.callId), first.map((u) => u.callId));
    box.ack(first.slice(0, 2).map((u) => u.callId));
    assert.deepEqual(box.pending().map((u) => u.callId), ["n1:WBS-002:0"], "델타: 보낸 것은 다시 싣지 않는다");
    assert.equal(Math.round(box.spentUsd() * 100) / 100, 0.06, "spentUsd는 누적(보냄 여부와 무관)");
  });

  it("항목은 Worker 스키마를 그대로 통과한다(dropped 0 · rowKey=call:<callId>)", () => {
    const box = run.createUsageOutbox({ nonce: "n2" });
    box.record(rec(1), { taskId: "WBS-001" });
    box.record({ ...rec(2), vendor: "", modelActual: "", modelRequested: "" }, { taskId: "WBS-001" }); // 모델을 전혀 모르면 버린다
    const parsed = parseCallbackUsage(box.pending());
    assert.equal(parsed.dropped, 0);
    assert.deepEqual(parsed.items.map((i) => i.rowKey), ["call:n2:WBS-001:0"]);
  });

  it("한 콜백에 200개까지 — 나머지는 다음 콜백으로", () => {
    const box = run.createUsageOutbox({ nonce: "n3" });
    for (let i = 0; i < 205; i++) box.record(rec(1), { taskId: "WBS-001" });
    const p = box.pending();
    assert.equal(p.length, 200);
    box.ack(p.map((u) => u.callId));
    assert.equal(box.pending().length, 5);
  });

  it("progressBody는 비어 있지 않은 usage만 싣는다", () => {
    const job = run.validateBuildPayload(buildPayload()).job;
    const box = run.createUsageOutbox({ nonce: "n4" });
    assert.ok(!("usage" in run.progressBody(job, "implementing", { message: "m", usage: box.pending() })));
    box.record(rec(1), { taskId: "WBS-001" });
    assert.equal(run.progressBody(job, "implementing", { message: "m", usage: box.pending() }).usage.length, 1);
  });
});

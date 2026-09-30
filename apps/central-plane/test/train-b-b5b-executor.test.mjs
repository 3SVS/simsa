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
import { execFileSync } from "node:child_process";
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
    for (const p of ["packages/core/**", "packages/agent-worker/**", "templates/simsa-hosted-app/**", "pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", "tsconfig.base.json", ".dockerignore"]) {
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
    assert.deepEqual(s.template, { ok: true, version: "0.1.0", error: null });
    // 결함 1: 빨간 template이 **어느 자리 표시자** 때문인지 ops-probe 결과에서 바로 보인다.
    const red = summarizeSelfCheck({ ok: false, template: { ok: false, version: null, error: "template_placeholder_missing:name" } }, 1);
    assert.deepEqual(red.template, { ok: false, version: null, error: "template_placeholder_missing:name" });
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
    // 예외·마감·드레인 본문은 전부 startJob(→ failureCallbackBody + 지출)에서 나온다 — 아래 '결함 6' 블록이 행동으로 확인.
    assert.match(serverMjs, /startJob\(/, "server.mjs builds every failure body through startJob (shared failureCallbackBody)");
  });

  it("server.mjs: kind=build 페이로드는 202 전에 validateBuildPayload로 거른다(디스패치가 즉시 failed(queued)를 기록하도록)", () => {
    const i202 = serverMjs.indexOf("json(res, 202,");
    const iVal = serverMjs.indexOf("validateBuildPayload(");
    assert.ok(iVal > 0 && iVal < i202, "validateBuildPayload must run before the 202 ack");
    // 현재 단계 추적(드레인·마감 본문의 failedStage)은 startJob이 onStage로 한다 — '결함 6' 블록이 행동으로 확인.
    assert.match(serverMjs, /startJob\(/, "server runs each job through startJob (stage tracking · deadline · abort)");
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

// ══ PR #569 검증 결함 수정 ═══════════════════════════════════════════════════════════════════════
// 각 블록의 첫 테스트는 수정 전 head(084a7a2)에서 실패한다. "[행동 보존]" 표시는 옛 코드에서도 통과하는 가드.

const usageRec = (costUsd, n = 1) => ({ vendor: "openai", modelRequested: "claude-sonnet-4-6", modelActual: "gpt-5.4", inputTokens: 100 * n, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 * n, latencyMs: 900 + n, costUsd, unpriced: false });

/** usage를 미리 채운 우편함 — B-5b-2의 runBuildLoop onUsage 대역. */
function filledOutbox(nonce, count, costUsd = 0.01) {
  const box = run.createUsageOutbox({ nonce });
  for (let i = 0; i < count; i++) box.record(usageRec(costUsd), { taskId: "WBS-001" });
  return box;
}

const callIdsOf = (body) => (Array.isArray(body?.usage) ? body.usage.map((u) => u.callId) : []);

describe("결함 1 · 자가점검 template.ok = 스캐폴드가 실제로 채울 수 있는 템플릿", () => {
  async function templateWithToml(tag, mutate) {
    const dir = await tmpDir(tag);
    await fs.cp(REPO_TEMPLATE, dir, { recursive: true });
    const tomlPath = path.join(dir, "wrangler.toml");
    await fs.writeFile(tomlPath, mutate(await fs.readFile(tomlPath, "utf8")));
    return dir;
  }
  const scaffoldInto = async (templateDir) =>
    run.scaffoldTemplate({ templateDir, appDir: path.join(await tmpDir("app-ph"), "app"), slug: "app-3f9a1c2b", d1Id: D1_UUID });

  it("재현: name·database_name을 바꾸고 id 자리 표시자만 남긴 템플릿 → ok=false (옛 코드는 ok=true인데 스캐폴드는 던졌다)", async () => {
    const dir = await templateWithToml("tpl-ph1", (t) =>
      t.replace(/^name = "simsa-hosted-app"$/m, 'name = "simsa-app"').replace('database_name = "simsa-hosted-app"', 'database_name = "simsa-app-db"'));
    const r = await run.checkTemplate(dir);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.error, "template_placeholder_missing:database_name");
    await assert.rejects(scaffoldInto(dir), /template_placeholder_missing:database_name/, "자가점검과 스캐폴드가 같은 판정");
  });

  it("name만 바뀌어도 ok=false + 어느 자리 표시자인지", async () => {
    const dir = await templateWithToml("tpl-ph2", (t) => t.replace(/^name = "simsa-hosted-app"$/m, 'name = "simsa-app"'));
    const r = await run.checkTemplate(dir);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.error, "template_placeholder_missing:name");
    await assert.rejects(scaffoldInto(dir), /template_placeholder_missing:name/);
  });

  it("[행동 보존] 실제 템플릿은 ok · database_id 자리 표시자가 없으면 ok=false(database_id)", async () => {
    assert.equal((await run.checkTemplate(REPO_TEMPLATE)).ok, true);
    const dir = await templateWithToml("tpl-ph3", (t) => t.replace(run.TEMPLATE_D1_PLACEHOLDER, D1_UUID));
    const r = await run.checkTemplate(dir);
    assert.equal(r.ok, false);
    assert.equal(r.error, "template_placeholder_missing:database_id");
  });
});

describe("결함 2 · postCallback 재시도·중단 분기(fetch seam) + '기록됨'의 정의", () => {
  const PROGRESS_URL = "https://cp.example/internal/build-progress";
  /** 응답 대본대로 답하는 fetch. Error 항목은 네트워크 오류로 던진다. */
  function scriptedFetch(script) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init.method, auth: init.headers.authorization, body: JSON.parse(init.body) });
      const step = script.shift();
      if (!step) throw new Error("unexpected extra call");
      if (step instanceof Error) throw step;
      return new Response(step.body ?? "", { status: step.status, headers: { "content-type": step.type ?? "application/json" } });
    };
    return { fetchImpl, calls };
  }

  it("[행동 보존] 5xx → 한 번 더 → 성공(같은 본문·Bearer·POST)", async () => {
    const f = scriptedFetch([{ status: 503, body: "busy" }, { status: 200, body: '{"ok":true,"transitioned":true}' }]);
    const r = await run.postCallback(PROGRESS_URL, TOKEN, { jobId: "bj_1" }, { fetchImpl: f.fetchImpl, backoffMs: 0 });
    assert.deepEqual(r, { ok: true, status: 200, json: { ok: true, transitioned: true }, error: null });
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((c) => c.url === PROGRESS_URL && c.method === "POST" && c.auth === `Bearer ${TOKEN}` && c.body.jobId === "bj_1"));
  });

  it("[행동 보존] 4xx(계약 파손·토큰 불일치) → 재시도 없이 1회", async () => {
    const f = scriptedFetch([{ status: 401, body: '{"ok":false,"error":"unauthorized"}' }]);
    const r = await run.postCallback(PROGRESS_URL, TOKEN, {}, { fetchImpl: f.fetchImpl, backoffMs: 0 });
    assert.equal(f.calls.length, 1);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.error, /^http_401:/);
  });

  it("[행동 보존] 네트워크 오류 2회 → ok:false · 2회 호출 · 오류 문구", async () => {
    const f = scriptedFetch([new TypeError("fetch failed"), new TypeError("fetch failed")]);
    const r = await run.postCallback(PROGRESS_URL, TOKEN, {}, { fetchImpl: f.fetchImpl, backoffMs: 0 });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(r, { ok: false, status: 0, json: null, error: "fetch failed" });
  });

  it("[행동 보존] retries:0(SIGTERM 드레인) → 5xx여도 1회", async () => {
    const f = scriptedFetch([{ status: 502, body: "bad gateway" }]);
    const r = await run.postCallback(PROGRESS_URL, TOKEN, {}, { fetchImpl: f.fetchImpl, retries: 0, backoffMs: 0 });
    assert.equal(f.calls.length, 1);
    assert.equal(r.status, 502);
  });

  it("[행동 보존] 2xx인데 JSON이 아니면 ok:true · json:null — '기록됨' 판단은 호출자 몫", async () => {
    const f = scriptedFetch([{ status: 200, body: "<html>captive portal</html>", type: "text/html" }]);
    const r = await run.postCallback(PROGRESS_URL, TOKEN, {}, { fetchImpl: f.fetchImpl, backoffMs: 0 });
    assert.deepEqual(r, { ok: true, status: 200, json: null, error: null });
  });

  it("runBuild: 2xx여도 Worker 응답({ok:true})이 아니면 usage를 ack하지 않는다 — 다음 콜백에 같은 callId로 다시(옛 코드는 ack해서 원장에서 빠졌다)", async () => {
    const box = filledOutbox("nH", 2);
    const poster = recordingPoster([{ ok: true, status: 200, json: null }]);
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wrH"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: poster.post, usageOutbox: box, log: () => {} });
    assert.deepEqual(poster.calls.map((c) => c.body.message), ["scaffold_started", "scaffold_ready"], "a non-Worker 2xx is not a reason to stop (like 5xx: continue)");
    assert.deepEqual(callIdsOf(poster.calls[0].body), ["nH:WBS-001:0", "nH:WBS-001:1"]);
    assert.deepEqual(callIdsOf(poster.calls[1].body), ["nH:WBS-001:0", "nH:WBS-001:1"], "unrecorded usage is re-sent with the same callIds");
    assert.equal(r.failedStage, "implementing");
    assert.ok(!("usage" in r), "the second callback was recorded, so nothing is left for build-done");
  });
});

describe("결함 3·7 · container-images PR 경로 필터가 Dockerfile의 COPY 원본을 전부 덮는다", () => {
  function pullRequestPaths(yml) {
    const m = /pull_request:\s*\n\s+paths:\s*\n((?:\s+- '[^']+'[^\n]*\n)+)/.exec(yml);
    assert.ok(m, "on.pull_request.paths block");
    return [...m[1].matchAll(/- '([^']+)'/g)].map((x) => x[1]);
  }
  /** GitHub Actions 경로 필터 glob: `**`는 `/` 포함 아무거나, `*`는 `/` 제외. */
  function actionsGlobRe(p) {
    let re = "";
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === "*" && p[i + 1] === "*") { re += ".*"; i++; }
      else if (ch === "*") re += "[^/]*";
      else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
  }
  /** Dockerfile COPY의 원본 경로(플래그·목적지 제외). 줄 잇기(\) 처리. */
  function copySources(text) {
    return text.replace(/\\\r?\n/g, " ").split(/\r?\n/).filter((l) => /^COPY\s/.test(l)).flatMap((l) => {
      const toks = l.trim().split(/\s+/).slice(1).filter((t) => !t.startsWith("--"));
      return toks.slice(0, -1);
    });
  }

  it("builder·inspector Dockerfile의 COPY 원본 → 전부 paths에 걸린다(옛 필터는 package.json·pnpm-workspace.yaml·tsconfig.base.json을 놓쳤다)", () => {
    const res = pullRequestPaths(imagesYml).map(actionsGlobRe);
    const covered = (src) => res.some((re) => re.test(src) || re.test(`${src}/x`));
    const inspector = readFileSync(path.join(ROOT, "inspector-container/Dockerfile"), "utf8");
    const missing = [];
    for (const [name, text] of [["builder", dockerfile], ["inspector", inspector]]) {
      const srcs = copySources(text);
      assert.ok(srcs.length >= 5, `${name}: parsed ${srcs.length} COPY sources`);
      for (const s of srcs) if (!covered(s)) missing.push(`${name}:${s}`);
    }
    assert.deepEqual(missing, [], "a PR touching only these files would skip the image build/selfcheck gate");
  });

  it(".dockerignore도 경로 필터에 있다 — 빌드 컨텍스트(이미지에 들어가는 것)를 바꾸므로", () => {
    assert.ok(pullRequestPaths(imagesYml).includes(".dockerignore"));
  });
});

describe("결함 4 · 템플릿 폴더의 로컬 비밀 파일은 이미지에도 스캐폴드에도 들어가지 않는다", () => {
  const T = "templates/simsa-hosted-app";
  /** 더러운 로컬 트리에만 있을 법한 것(템플릿 .gitignore가 무시하거나 아예 모르는 것). */
  const SECRET_OR_ARTIFACT = [
    ".npmrc", ".envrc", ".yarnrc", ".yarnrc.yml", ".dev.vars", ".env", ".env.local", ".env.production",
    "src/.dev.vars", "src/.npmrc", ".wrangler/state/v3/d1/db.sqlite", "node_modules/hono/index.js", "dist/client/index.html",
    "server.pem", "deploy.key", "cert.p12",
  ];
  /** 비밀은 아니지만 사용자 앱에 따라가면 안 되는 로컬 잡동사니(스캐폴드만 거른다). */
  const LOCAL_JUNK = [".DS_Store", ".vscode/settings.json", ".turbo/cache.json"];

  const gitLsFiles = (...args) =>
    execFileSync("git", ["ls-files", "-z", ...args], { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean);

  it("scaffoldTemplate: 추적되지 않은 dotfile·키 파일은 복사하지 않는다(옛 코드는 .npmrc·.envrc·.yarnrc·키 파일을 복사해 스캐폴드 커밋에 넣었다)", async () => {
    const tpl = await tmpDir("tpl-decoy");
    await fs.cp(REPO_TEMPLATE, tpl, { recursive: true });
    for (const d of [...SECRET_OR_ARTIFACT, ...LOCAL_JUNK]) {
      await fs.mkdir(path.dirname(path.join(tpl, d)), { recursive: true });
      await fs.writeFile(path.join(tpl, d), "//registry.npmjs.org/:_authToken=npm_FAKE_NOT_A_SECRET\n");
    }
    await fs.writeFile(path.join(tpl, ".env.example"), "API_BASE=\n");
    const appDir = path.join(await tmpDir("app-decoy"), "app");
    await run.scaffoldTemplate({ templateDir: tpl, appDir, slug: "app-3f9a1c2b", d1Id: D1_UUID });
    const leaked = [];
    for (const d of [...SECRET_OR_ARTIFACT, ...LOCAL_JUNK]) if (await exists(path.join(appDir, d))) leaked.push(d);
    assert.deepEqual(leaked, [], "nothing untracked reaches the user's app (so never the scaffold commit / simsa-hosted repo)");
    assert.ok(await exists(path.join(appDir, ".env.example")), ".env.example is kept");
    assert.ok(await exists(path.join(appDir, ".gitignore")), ".gitignore is kept");
  });

  it("[행동 보존] git이 추적하는 템플릿 파일은 하나도 빠지지 않는다 — 허용 목록이 템플릿을 깎지 않게", async () => {
    const tracked = gitLsFiles(T);
    assert.ok(tracked.length >= 10, `tracked=${tracked.length}`);
    const cut = tracked.filter((f) => path.posix.relative(T, f).split("/").some((seg) => run.isScaffoldExcluded(seg)));
    assert.deepEqual(cut, [], "a tracked template file would be dropped by the scaffold filter — allow it explicitly");
    const appDir = path.join(await tmpDir("app-tracked"), "app");
    await run.scaffoldTemplate({ templateDir: REPO_TEMPLATE, appDir, slug: "app-3f9a1c2b", d1Id: D1_UUID });
    for (const f of tracked) assert.ok(await exists(path.join(appDir, path.posix.relative(T, f))), `${f} must be scaffolded`);
  });

  /** .dockerignore 판정(moby patternmatcher 근사): 규칙을 순서대로 보고, 경로나 그 상위 폴더가 맞으면 제외(!는 되살림) — 마지막 규칙이 이긴다. */
  function dockerignoreExcludes(text) {
    const rules = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
      const neg = l.startsWith("!");
      const pat = (neg ? l.slice(1) : l).replace(/^\/+/, "").replace(/\/+$/, "");
      let re = "";
      for (let i = 0; i < pat.length; i++) {
        const ch = pat[i];
        if (ch === "*" && pat[i + 1] === "*") {
          if (pat[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
        } else if (ch === "*") re += "[^/]*";
        else if (ch === "?") re += "[^/]";
        else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
      return { neg, re: new RegExp(`^${re}$`) };
    });
    return (file) => {
      const parts = file.split("/");
      let excluded = false;
      for (const r of rules) {
        for (let k = 1; k <= parts.length; k++) {
          if (r.re.test(parts.slice(0, k).join("/"))) { excluded = !r.neg; break; }
        }
      }
      return excluded;
    };
  }

  it(".dockerignore(빌드 컨텍스트 루트): 템플릿의 비밀·설치물·로컬 상태는 컨텍스트에서 빠지고, 추적 파일은 하나도 빠지지 않는다", () => {
    // wrangler는 Dockerfile을 stdin(`-f -`)으로 넘긴다 → Dockerfile 옆 `Dockerfile.dockerignore`는 배포 빌드에서 안 쓰인다. 루트여야 한다.
    const excluded = dockerignoreExcludes(readFileSync(path.join(REPO, ".dockerignore"), "utf8"));
    const leaked = SECRET_OR_ARTIFACT.filter((d) => !excluded(`${T}/${d}`));
    assert.deepEqual(leaked, [], "these must never enter the builder image layer");
    assert.equal(excluded(`${T}/.env.example`), false, ".env.example stays");
    const dropped = gitLsFiles().filter((f) => excluded(f));
    assert.deepEqual(dropped, [], "a clean checkout (CI deploy) must build the same images — .dockerignore may only drop untracked local files");
  });

  it("container-images CI: 미끼 파일을 심고 빌드한 이미지 안에 없는지 확인한다(이미지 레이어 증거)", () => {
    const iPlant = imagesYml.indexOf("CI_DECOY_NOT_A_SECRET");
    const iBuild = imagesYml.indexOf("docker/build-push-action");
    assert.ok(iPlant > 0 && iPlant < iBuild, "decoys are planted before the image build");
    assert.match(imagesYml, /grep -rl CI_DECOY_NOT_A_SECRET \/builder/, "smoke greps the built image for decoys");
  });
});

describe("결함 5 · 최종 본문 전에 200개를 넘는 usage는 진행 콜백으로 나눠 보낸다", () => {
  it("250건 · 진행 콜백 5xx 두 번 뒤 Worker 복구 → 250건 전부 기록 경로로(옛 코드는 build-done 200건에서 잘려 50건이 원장에서 빠졌다)", async () => {
    const box = filledOutbox("n250", 250, 0.01);
    const poster = recordingPoster([{ ok: false, status: 503, json: null }, { ok: false, status: 503, json: null }]);
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr250"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: poster.post, usageOutbox: box, log: () => {} });
    assert.equal(r.failedStage, "implementing");
    assert.equal(r.spentUsd, 2.5);
    assert.ok(callIdsOf(r).length <= run.USAGE_CALLBACK_MAX, "build-done carries at most 200 (the Worker truncates beyond)");
    const flushes = poster.calls.slice(2);
    const recorded = new Set([...flushes.flatMap((c) => callIdsOf(c.body)), ...callIdsOf(r)]);
    assert.equal(recorded.size, 250, "every usage row reaches a callback the Worker records");
    assert.ok(flushes.length >= 1);
    for (const c of flushes) {
      assert.equal(c.body.status, "scaffolding", "flush reports the stage actually reached — never 'implementing'");
      assert.equal(c.body.message, "", "flush writes no event row");
      assert.ok(!("wbsTotal" in c.body), "flush never overwrites wbs_total");
      assert.ok(c.body.usage.length <= run.USAGE_CALLBACK_MAX);
    }
  });

  it("비우기 콜백이 기록되지 않으면 한 번에서 멈춘다(무한 재시도 없음) — 못 보낸 수는 로그에", async () => {
    const box = filledOutbox("n450", 450, 0.001);
    const calls = [];
    const post = async (_url, _token, body) => { calls.push(JSON.parse(JSON.stringify(body))); return { ok: false, status: 503, json: null, error: "http_503" }; };
    const logs = [];
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wr450"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: post, usageOutbox: box, log: (l) => logs.push(l) });
    assert.equal(calls.length, 3, "scaffold_started · scaffold_ready · one flush attempt");
    assert.equal(callIdsOf(r).length, 200);
    assert.ok(logs.some((l) => /usage_overflow_unsent:250\b/.test(l)), JSON.stringify(logs));
  });
});

describe("결함 6 · 45분 마감·SIGTERM — 지금까지의 지출을 싣고, 러너를 멈춘다", () => {
  /** 문(gate)을 열 때까지 멈춰 있는 git exec — 마감·중단이 스캐폴드 도중에 온다. 받은 signal도 기록. */
  function gatedGit() {
    let open;
    const gate = new Promise((r) => { open = r; });
    const calls = [];
    const exec = async (_cmd, args, opts = {}) => {
      calls.push({ args: [...args], signal: opts.signal ?? null });
      await gate;
      if (args.includes("rev-parse")) return { ok: true, code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "", error: null };
      return { ok: true, code: 0, stdout: "", stderr: "", error: null };
    };
    return { exec, calls, open: () => open() };
  }

  it("startJob: 마감이 먼저 오면 본문에 spentUsd·usage — 그 뒤 진행 콜백 0건(옛 server.mjs의 withTimeout은 경쟁만 해서 러너가 계속 돌며 progress를 또 보냈다)", async () => {
    const box = filledOutbox("nT", 3, 0.2);
    const git = gatedGit();
    const poster = recordingPoster([{ ok: false, status: 503, json: null }]); // scaffold_started가 기록되지 않아 usage 3건이 남는다
    const job = run.startJob(buildPayload(), {
      timeoutMs: 200,
      timeoutMessage: "build job timed out after 45 min",
      deps: { workRoot: await tmpDir("wrT"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: poster.post, usageOutbox: box, log: () => {} },
    });
    const body = await job.done;
    assert.equal(body.ok, false);
    assert.equal(body.stage, "failed");
    assert.equal(body.failedStage, "scaffolding");
    assert.equal(body.error, "build job timed out after 45 min");
    assert.equal(body.spentUsd, 0.6);
    assert.deepEqual(callIdsOf(body), ["nT:WBS-001:0", "nT:WBS-001:1", "nT:WBS-001:2"]);
    const atDeadline = poster.calls.length;
    git.open();
    assert.strictEqual(await job.finished, body, "the runner's late body never becomes a second final body");
    assert.equal(poster.calls.length, atDeadline, "no progress callback after the deadline body");
    assert.ok(git.calls.every((c) => c.signal === job.signal && c.signal.aborted), "exec received the job signal (defaultExec kills the child on abort)");
  });

  it("runBuild: signal이 끊기면 다음 진행 콜백을 보내지 않고, 모든 exec에 signal을 넘긴다(옛 코드는 signal을 몰라 scaffold_ready를 보냈다)", async () => {
    const ac = new AbortController();
    const calls = [];
    const exec = async (_cmd, args, opts = {}) => {
      calls.push({ args: [...args], signal: opts.signal });
      if (args.includes("commit")) ac.abort(new Error("deadline"));
      if (args.includes("rev-parse")) return { ok: true, code: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "", error: null };
      return { ok: true, code: 0, stdout: "", stderr: "", error: null };
    };
    const poster = recordingPoster();
    const r = await run.runBuildJob(buildPayload(), { workRoot: await tmpDir("wrS"), templateDir: REPO_TEMPLATE, exec, postCallback: poster.post, signal: ac.signal, log: () => {} });
    assert.deepEqual(poster.calls.map((c) => c.body.message), ["scaffold_started"]);
    assert.equal(r.ok, false);
    assert.equal(r.failedStage, "scaffolding");
    assert.match(r.error, /job_aborted/);
    assert.ok(calls.length >= 1 && calls.every((c) => c.signal === ac.signal), "every git call carries the job signal");
  });

  it("마감 본문 전에도 200개 초과분은 진행 콜백으로 비운다(결함 5와 같은 규칙) — 본문에는 나머지", async () => {
    const box = filledOutbox("nTT", 230, 0.001);
    const git = gatedGit();
    const poster = recordingPoster([{ ok: false, status: 503, json: null }]);
    const job = run.startJob(buildPayload(), {
      timeoutMs: 200,
      timeoutMessage: "deadline",
      deps: { workRoot: await tmpDir("wrTT"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: poster.post, usageOutbox: box, log: () => {} },
    });
    const body = await job.done;
    const flushes = poster.calls.slice(1);
    assert.equal(flushes.length, 1, JSON.stringify(poster.calls.map((c) => [c.body.status, c.body.message, callIdsOf(c.body).length])));
    assert.equal(flushes[0].body.status, "scaffolding");
    assert.equal(flushes[0].body.message, "");
    assert.equal(callIdsOf(flushes[0].body).length, 200);
    assert.equal(callIdsOf(body).length, 30);
    git.open();
    await job.finished;
    assert.equal(poster.calls.length, 2, "nothing after the deadline body");
  });

  it("SIGTERM 드레인(abort): 지금까지의 spentUsd·usage를 실은 본문 하나 — done도 같은 본문(최종 콜백이 두 번 가지 않게)", async () => {
    const box = filledOutbox("nK", 2, 0.25);
    const git = gatedGit();
    const poster = recordingPoster([{ ok: false, status: 503, json: null }]);
    const job = run.startJob(buildPayload(), { timeoutMs: 0, deps: { workRoot: await tmpDir("wrK"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: poster.post, usageOutbox: box, log: () => {} } });
    for (let i = 0; i < 400 && poster.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const body = job.abort(new Error("builder container was killed by SIGTERM mid-job (deploy rollout or sleepAfter)"));
    assert.equal(body.failedStage, "scaffolding");
    assert.match(body.error, /SIGTERM/);
    assert.equal(body.spentUsd, 0.5);
    assert.deepEqual(callIdsOf(body), ["nK:WBS-001:0", "nK:WBS-001:1"]);
    assert.strictEqual(await job.done, body);
    assert.strictEqual(job.abort(new Error("again")), body, "abort is idempotent");
    git.open();
    await job.finished;
    assert.equal(poster.calls.length, 1, "no progress after the drain body");
  });

  it("러너가 던지면(모르는 kind) 본문에 단계·지출 — 종전처럼 builder_stage_not_implemented", async () => {
    const job = run.startJob({ ...buildPayload(), kind: "deploy" }, { timeoutMs: 0, deps: { log: () => {} } });
    assert.deepEqual(await job.done, { jobId: "bj_0a1b2c3d4e", ok: false, stage: "failed", failedStage: "queued", error: "builder_stage_not_implemented:deploy", spentUsd: 0 });
  });

  it("server.mjs: 잡은 startJob으로 — 마감은 러너를 멈추는 startJob 안에서, 드레인은 job.abort 본문을 한 번만", () => {
    assert.match(serverMjs, /startJob\(/);
    assert.doesNotMatch(serverMjs, /function withTimeout/, "no race-only timeout that leaves the runner running");
    assert.match(serverMjs, /\.abort\(/, "SIGTERM drain uses job.abort (spend + usage + stops the runner)");
    assert.match(serverMjs, /\.reported\b/, "the final callback is sent once (drain vs runJob)");
  });
});

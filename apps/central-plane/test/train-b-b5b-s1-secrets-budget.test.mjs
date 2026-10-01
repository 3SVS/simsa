/**
 * SI 티어 Train B — B-5b S1: 컨테이너 비밀 최소화 + B-6 예산 정지(서버 권위) + 일일 빌드 상한.
 *
 *   ① 페이로드에 비밀 0 — 실제 라우트 디스패치 본문 + BuildDispatchPayload 타입(정적)
 *   ② jobToken — 잡 범위 HMAC 토큰, 교차 잡 403, 전역 토큰은 한 릴리스만(호환)
 *   ③ 빌드 전용 LLM 프록시 — 401·403·404·409·402(업스트림 0)·모델 허용 목록·크기 상한·스트리밍 금지·
 *      정상 전달 시 원장 1행 + spent_usd 원자 증가 · usage 없는 2xx는 보수 청구
 *   ④ 이중 계상 0 — 콜백 본문의 usage[]·spentUsd는 원장·spent_usd에 닿지 않는다
 *   ⑤ 컨테이너 — 비밀 필드가 오면 거절 · 콜백 Bearer = jobToken · LLM 설정은 프록시 주소 + jobToken ·
 *      402 → 그 WBS에서 멈추고 커밋 → failed(implementing, budget_exhausted) · 자식 env에 비밀 0
 *   ⑥ 일일 상한 3층(user 3 · network 5 · service 30) · 환급 · 킬스위치가 먼저
 *   ⑦ 실제 SQLite — 프록시 증가와 진행 전이가 겹쳐도 spent_usd를 잃지 않는다
 *   ⑧ PR #569 S1 검증 결함 — 콜백은 Worker 소유 칸(repo·commit·exit·done·주소)을 못 쓴다 · 예산은 예약(동시 호출
 *      초과 ≤ 1회) · 과금 필드 허용 목록 · 킬스위치가 진행 중 빌드도 멈춘다 · 끝난 잡 콜백은 이벤트 0 · 잡당 이벤트 상한
 *      (전역 토큰 거절은 ②, 환급 두 경로는 ⑥)
 *
 * 네트워크 0: Cloudflare·GitHub·LLM은 전부 가짜 fetch. Anthropic SDK는 진짜(agent-worker 의존성)를 쓰되 fetch를
 * Worker 앱(app.fetch)에 잇는다 — 컨테이너 클라이언트 ↔ 프록시 경로·헤더 계약을 한 번에 검사한다.
 * Rule 6: 제품명·WBS 제목·userKey에 한글·공백·특수문자. 키·토큰은 명백한 가짜(FAKE) — 실토큰 모양 없음.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dailyCapsRun } from "./_daily-caps-fake.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "../..");
const REPO_TEMPLATE = path.join(REPO, "templates/simsa-hosted-app");
const AGENT_WORKER_DIST = path.join(REPO, "packages/agent-worker/dist/index.js");

const run = await import("../builder-container/builder-run.mjs");
const { createApp } = await import("../dist/router.js");
const buildDb = await import("../dist/workspace/build-job-db.js");
// 새 모듈 — 옛 코드에는 없다(그 경우 해당 테스트가 각자 실패하도록 null).
const tokenMod = await import("../dist/workspace/build-job-token.js").catch(() => null);
const capsMod = await import("../dist/workspace/build-daily-caps.js").catch(() => null);
const proxyMod = await import("../dist/routes/build-llm-proxy.js").catch(() => null);
const agentWorker = await import(pathToFileURL(AGENT_WORKER_DIST).href);
const { Anthropic } = createRequire(path.join(REPO, "packages/agent-worker/package.json"))("@anthropic-ai/sdk");

const ICT = "internal-callback-FAKE-0001";
const KEK = "kek-FAKE-not-a-real-key-0001";
const ANTHROPIC_KEY = "anthropic-server-key-FAKE";
const OPENAI_KEY = "openai-server-key-FAKE";
const CF_OPS = "cf-ops-token-FAKE";
const GW_A = "https://gw.example/v1/acct/simsa/anthropic";
const GW_O = "https://gw.example/v1/acct/simsa/openai";
const USER = "uk_빵집 사장님";
const PROJECT = "wsp_s1_빵집";
const PRODUCT = "동네 빵집 소금빵 예약 (주)빵굽는집";
const D1_UUID = "5f0c8a4e-1b2d-4c3e-9f10-2a3b4c5d6e7f";
const ORIGIN = "https://cp.example";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const LEDGER_COLS = [
  "id", "created_at", "job_kind", "job_id", "project_id", "user_key_hash", "vendor", "model_requested", "model_actual", "call_site",
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "cost_usd", "unpriced", "latency_ms", "container_seconds",
];

const DEV_SPEC = {
  meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-10-01T00:00:00.000Z" },
  brief: { productName: PRODUCT, oneLine: "소금빵 예약", targetUsers: ["동네 손님"], problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
  features: [{ id: "FR-001", title: "예약", description: "빵을 고르고 예약한다", priority: "must" }],
  acceptance: [{ id: "AC-001", featureId: "FR-001", given: "빵 목록", when: "예약하기 누름", then: "예약 확인 화면이 보인다", verifiedBy: "browser" }],
  screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: ["예약하기 버튼"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
  dataModel: [{ name: "reservations", fields: [{ name: "id", type: "text", required: true }], relations: [], ownership: "unknown" }],
  apis: [], nonFunctional: [],
  workBreakdown: [
    { id: "WBS-002", title: "예약 화면 — 한글 버튼 '예약하기'", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-001"] },
    { id: "WBS-001", title: "예약 저장 (D1 테이블)", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] },
  ],
  testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기"] }], assumptions: [], openQuestions: [],
};

function projectRow(id = PROJECT, userKey = USER) {
  return { id, user_key: userKey, title: PRODUCT, idea: "", understood_json: "{}", product_spec_json: "{}", items_json: "[]", built_with_json: null, entry_path: "idea", topic_tags_json: "[]", acquisition_json: null, dev_spec_json: JSON.stringify(DEV_SPEC), created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
}

/** 가짜 D1 — build_jobs(SQL 문구대로: `MAX(spent_usd, ?)`면 MAX, 아니면 덮어쓰기) · 이벤트 · 원장 · 일일 상한. */
function makeDb({ projects = new Map([[PROJECT, projectRow()]]), jobs = [] } = {}) {
  const db = {
    jobs, events: [], ledger: [], rate: new Map(), sqls: [],
    prepare(sql) {
      const handler = (args) => ({
        async run() {
          db.sqls.push(sql);
          const capped = dailyCapsRun(db.rate, sql, args);
          if (capped) return capped;
          if (sql.includes("INSERT INTO build_jobs")) {
            const [id, project_id, user_key, slug, wbs_total, budget_usd, d1_id, repo_full_name, locale, created_at, updated_at] = args;
            jobs.push({ id, project_id, user_key, slug, status: "queued", failed_stage: null, error: null, wbs_done: 0, wbs_total, budget_usd, spent_usd: 0, d1_id, repo_full_name, commit_sha: null, deployed_url: null, build_exit_code: null, locale, created_at, updated_at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO build_job_events")) {
            const [id, job_id, at, stage, message, meta_json] = args;
            // 잡당 이벤트 상한(검증 결함 7): `… WHERE (SELECT COUNT(*) …) < ?` 문장이면 상한을 흉내낸다.
            if (sql.includes("SELECT COUNT(*)") && db.events.filter((e) => e.job_id === job_id).length >= Number(args[args.length - 1])) return { meta: { changes: 0 } };
            db.events.push({ id, job_id, at, stage, message, meta_json });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO llm_usage")) {
            const row = Object.fromEntries(LEDGER_COLS.map((c, i) => [c, args[i]]));
            if (db.ledger.some((r) => r.id === row.id)) return { meta: { changes: 0 } };
            db.ledger.push(row);
            return { meta: { changes: 1 } };
          }
          const maxSpent = sql.includes("MAX(spent_usd, ?)");
          const active = (r) => !["done", "failed"].includes(r.status);
          // 예약(검증 결함 4): 활성이고 spent < budget일 때만 최악 비용을 원자적으로 더한다. JS 한 틱 = 원자.
          if (sql.includes("SET spent_usd = spent_usd + ?") && sql.includes("spent_usd < budget_usd")) {
            const [delta, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id && active(r) && r.spent_usd < r.budget_usd);
            if (row) Object.assign(row, { spent_usd: row.spent_usd + delta, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          // 정산: 예약분을 빼고 실제 비용을 더한다(0 아래로 안 내려간다). 상태 무관.
          if (sql.includes("MAX(0, spent_usd - ? + ?)")) {
            const [reserved, actual, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id);
            if (row) Object.assign(row, { spent_usd: Math.max(0, row.spent_usd - reserved + actual), updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET spent_usd = spent_usd + ?")) {
            const [delta, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id);
            if (row) Object.assign(row, { spent_usd: row.spent_usd + delta, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE build_jobs") && sql.includes("SET status = ?")) {
            // 새 문장(검증 결함 1): status·wbs_done·updated_at만. 옛 문장(9 바인딩)은 repo·commit·exit·wbs_total·spent까지 썼다 —
            // 옛 코드에서 새 테스트가 "왜" 실패하는지 보이도록 두 모양을 다 흉내낸다.
            const legacy = args.length === 9;
            const [status, wbs_done] = args;
            const updated_at = args[args.length - 2];
            const id = args[args.length - 1];
            const row = jobs.find((r) => r.id === id && active(r));
            if (row) {
              Object.assign(row, { status, wbs_done, updated_at });
              if (legacy) {
                const [, , wbs_total, spent_usd, commit_sha, repo_full_name, build_exit_code] = args;
                Object.assign(row, { wbs_total, spent_usd: maxSpent ? Math.max(row.spent_usd, spent_usd) : spent_usd, commit_sha: commit_sha ?? row.commit_sha, repo_full_name: repo_full_name ?? row.repo_full_name, build_exit_code: build_exit_code ?? row.build_exit_code });
              }
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'done'")) {
            const [deployed_url, commit_sha, spent_usd, wbs_done, updated_at, id] = args;
            // PR #569 S3 검증 결함 6: WHERE `AND build_exit_code = 0`(산출물 수령 행만)을 그대로 흉내 낸다.
            const needsClaim = sql.includes("AND build_exit_code = 0");
            const row = jobs.find((r) => r.id === id && active(r) && (!needsClaim || r.build_exit_code === 0));
            if (row) Object.assign(row, { status: "done", deployed_url, commit_sha: commit_sha ?? row.commit_sha, spent_usd: maxSpent ? Math.max(row.spent_usd, spent_usd) : spent_usd, build_exit_code: 0, wbs_done, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'failed'")) {
            const [failed_stage, error, spent_usd, build_exit_code, updated_at, id] = args;
            const row = jobs.find((r) => r.id === id && active(r));
            if (row) Object.assign(row, { status: "failed", failed_stage, error, spent_usd: Math.max(row.spent_usd, spent_usd), build_exit_code: build_exit_code ?? row.build_exit_code, updated_at });
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          db.sqls.push(sql);
          if (sql.includes("FROM workspace_projects WHERE id = ?")) return projects.get(args[0]) ?? null;
          if (sql.includes("FROM build_jobs WHERE project_id = ?") && sql.includes("status IN")) return jobs.find((r) => r.project_id === args[0] && !["done", "failed"].includes(r.status)) ?? null;
          if (sql.includes("FROM build_jobs WHERE id = ?")) return jobs.find((r) => r.id === args[0]) ?? null;
          return null;
        },
        async all() {
          db.sqls.push(sql);
          if (sql.includes("FROM build_job_events")) return { results: db.events.filter((e) => e.job_id === args[0]) };
          return { results: [] };
        },
      });
      return { bind: (...a) => handler(a), run: () => handler([]).run(), first: () => handler([]).first(), all: () => handler([]).all() };
    },
  };
  return db;
}

function jobRow(o = {}) {
  return { id: "bj_aaaaaaaaaa", project_id: PROJECT, user_key: USER, slug: "app-3f9a1c2b", status: "implementing", failed_stage: null, error: null, wbs_done: 0, wbs_total: 2, budget_usd: 10, spent_usd: 0, d1_id: D1_UUID, repo_full_name: null, commit_sha: null, deployed_url: null, build_exit_code: null, locale: "ko", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...o };
}

function makeBuilder({ status = 202 } = {}) {
  const payloads = [];
  return {
    payloads,
    idFromName: (n) => ({ n }),
    get: () => ({ fetch: async (_url, init) => { payloads.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: status < 300 }), { status }); } }),
  };
}

function envFor(db, extra = {}) {
  return {
    DB: db, BUILDER: makeBuilder(), INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, PUBLIC_BASE_URL: ORIGIN,
    HOSTING_CF_API_TOKEN: CF_OPS, HOSTING_CF_ACCOUNT_ID: "acc1", HOSTING_ROOT_DOMAIN: "simsa.page",
    ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: OPENAI_KEY, CF_AI_GATEWAY_ANTHROPIC_URL: GW_A, CF_AI_GATEWAY_OPENAI_URL: GW_O,
    HOSTING_GH_APP_ID: "1", HOSTING_GH_APP_PRIVATE_KEY: "",
    ...extra,
  };
}

/** Cloudflare API 가짜(global fetch — 프로비저닝은 global을 쓴다). */
async function withHostingFetch(fn, { d1Ok = true, nsOk = true } = {}) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method ?? "GET"} ${u.pathname}`);
    if (u.pathname.endsWith("/workers/dispatch/namespaces")) {
      // nsOk=false: "이미 있음"(100120)이 아닌 진짜 실패 — 우리 쪽 문제다(사용자 시도가 아니다 → 환급).
      return nsOk
        ? new Response(JSON.stringify({ success: false, errors: [{ code: 100120, message: "already exist" }] }), { status: 400 })
        : new Response(JSON.stringify({ success: false, errors: [{ code: 10013, message: "internal error" }] }), { status: 500 });
    }
    if (u.pathname.endsWith("/d1/database")) {
      return d1Ok
        ? new Response(JSON.stringify({ success: true, result: { uuid: D1_UUID } }), { status: 200 })
        : new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 403 });
    }
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = orig;
  }
}

async function postBuild(env, { projectId = PROJECT, userKey = USER, ip = "203.0.113.7", d1Ok = true, nsOk = true } = {}) {
  const { result, calls } = await withHostingFetch(async () => {
    const res = await createApp().fetch(new Request(`${ORIGIN}/workspace/projects/${encodeURIComponent(projectId)}/build`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
      body: JSON.stringify({ userKey, locale: "ko" }),
    }), env);
    return { status: res.status, body: await res.json(), retryAfter: res.headers.get("retry-after") };
  }, { d1Ok, nsOk });
  return { ...result, cfCalls: calls };
}

async function postJson(app, env, pathname, body, headers = {}) {
  const res = await app.fetch(new Request(`${ORIGIN}${pathname}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

const mint = (env, jobId) => tokenMod.mintBuildJobToken(env, jobId);
const bearer = (t) => ({ authorization: `Bearer ${t}` });

// ── LLM 업스트림 가짜 ─────────────────────────────────────────────────────────────────────────────
function anthropicMessage({ id = "msg_fake_0001", model = "claude-sonnet-4-6", usage = { input_tokens: 1_000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content } = {}) {
  return {
    id, type: "message", role: "assistant", model, stop_reason: "tool_use", stop_sequence: null,
    content: content ?? [{ type: "tool_use", id: "toolu_fake_1", name: "finish", input: { status: "done", summary: "예약 저장 완료", commitMessage: "feat: 예약 저장" } }],
    usage,
  };
}
function openAiCompletion({ id = "chatcmpl-fake-0001", model = "gpt-5.4-2026-03-05", usage = { prompt_tokens: 1_000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 800 } } } = {}) {
  return {
    id, object: "chat.completion", model,
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call_fake_1", type: "function", function: { name: "finish", arguments: JSON.stringify({ status: "done", summary: "예약 화면 완료", commitMessage: "feat: 예약 화면" }) } }] } }],
    usage,
  };
}

/**
 * 업스트림(게이트웨이) 가짜. 각 벤더의 응답을 함수로 바꿀 수 있다. 응답 id는 호출마다 다르다(실제 벤더처럼 —
 * 프록시는 응답 id로 원장 행을 재전송에 안전하게 만든다).
 */
function makeUpstream({
  anthropic = (_call, n) => new Response(JSON.stringify(anthropicMessage({ id: `msg_fake_${String(n).padStart(4, "0")}` })), { status: 200, headers: { "content-type": "application/json" } }),
  openai = (_call, n) => new Response(JSON.stringify(openAiCompletion({ id: `chatcmpl-fake-${String(n).padStart(4, "0")}` })), { status: 200, headers: { "content-type": "application/json" } }),
} = {}) {
  const calls = [];
  const perVendor = { a: 0, o: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const call = { url: u, method: init.method, headers: Object.fromEntries(new Headers(init.headers ?? {})), body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (u.startsWith(GW_A)) return anthropic(call, ++perVendor.a);
    if (u.startsWith(GW_O)) return openai(call, ++perVendor.o);
    return new Response("unrouted", { status: 599 });
  };
  return { calls, fetchImpl };
}

/** 컨테이너 쪽 fetch를 Worker 앱으로 잇는다(SDK·폴백 클라이언트·콜백 poster 공용). */
function fetchIntoWorker(app, env) {
  return async (url, init = {}) => app.fetch(new Request(String(url), init), env);
}

const anthropicReq = (o = {}) => ({ model: "claude-sonnet-4-6", max_tokens: 1_024, messages: [{ role: "user", content: `${PRODUCT} — 예약 저장을 만들어 주세요` }], ...o });
const openAiReq = (o = {}) => ({ model: "gpt-5.4", max_completion_tokens: 16_000, messages: [{ role: "user", content: `${PRODUCT} — 예약 화면` }], ...o });

async function proxyWorld({ jobs = [jobRow()], upstream = makeUpstream(), extra = {} } = {}) {
  const db = makeDb({ jobs });
  const env = envFor(db, extra);
  const app = createApp({ fetch: upstream.fetchImpl });
  return { db, env, app, upstream };
}

const createdTmp = [];
async function tmpDir(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `b5bs1-${tag}-`));
  createdTmp.push(d);
  return d;
}
after(async () => {
  await Promise.all(createdTmp.map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** git 호출을 기록하는 가짜 exec — rev-parse만 sha를 돌려준다. */
function gitExec() {
  const calls = [];
  let n = 0;
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args: [...args], cwd: opts.cwd ?? null, env: opts.env });
    if (args.includes("rev-parse")) return { ok: true, code: 0, stdout: `${String(++n).padStart(2, "0")}23456789abcdef0123456789abcdef01234567\n`, stderr: "", error: null };
    return { ok: true, code: 0, stdout: "", stderr: "", error: null };
  };
  return { exec, calls };
}

/** 새 모양의 컨테이너 페이로드(Worker가 보내는 것과 같은 모양). */
function payloadFor(jobId, jobToken, o = {}) {
  return {
    jobId, kind: "build", slug: "app-3f9a1c2b", locale: "ko",
    baseUrl: ORIGIN, callbackUrl: `${ORIGIN}/internal/build-done`, progressUrl: `${ORIGIN}/internal/build-progress`, jobToken,
    budgetUsd: 10,
    spec: {
      markdown: `# ${PRODUCT}\n\n## 작업\n- WBS-001 예약 저장 (D1 테이블)\n- WBS-002 예약 화면`,
      wbs: [
        { id: "WBS-001", title: "예약 저장 (D1 테이블)", order: 1, acceptanceIds: ["AC-001"], dependsOn: [] },
        { id: "WBS-002", title: "예약 화면 — 한글 버튼 '예약하기'", order: 2, acceptanceIds: ["AC-001"], dependsOn: ["WBS-001"] },
      ],
      productName: PRODUCT,
    },
    hosting: { d1Id: D1_UUID },
    llm: { model: "claude-sonnet-4-6", openaiModel: "gpt-5.4", preferFallback: false },
    ...o,
  };
}

// ══ ① 페이로드에 비밀 0 ════════════════════════════════════════════════════════════════════════════

describe("① 컨테이너 페이로드에 비밀이 없다", () => {
  it("실제 라우트가 디스패치한 본문: 운영 CF 토큰·전역 콜백 토큰·KEK·LLM 키·userKey 값이 없고, 이 잡의 jobToken만 있다", async () => {
    const db = makeDb();
    const env = envFor(db);
    const r = await postBuild(env);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(env.BUILDER.payloads.length, 1);
    const p = env.BUILDER.payloads[0];
    const s = JSON.stringify(p);
    for (const secret of [CF_OPS, ICT, KEK, ANTHROPIC_KEY, OPENAI_KEY, USER]) assert.ok(!s.includes(secret), `payload must not carry ${secret.slice(0, 12)}…`);
    for (const key of ["callbackToken", "userKey", "repo", "projectId"]) assert.ok(!(key in p), `payload has no ${key}`);
    assert.deepEqual(Object.keys(p.hosting), ["d1Id"], "hosting carries the D1 id only");
    assert.deepEqual(Object.keys(p.llm).sort(), ["model", "openaiModel", "preferFallback"], "no LLM key fields");
    const jobId = db.jobs[0].id;
    assert.match(p.jobToken, new RegExp(`^bjt1\\.${jobId}\\.[0-9a-f]{64}$`), "the job's own scoped token");
    assert.equal(p.jobId, jobId);
    assert.equal(p.spec.productName, PRODUCT, "한글 제품명은 그대로");
    assert.equal(run.validateBuildPayload(p).ok, true, JSON.stringify(run.validateBuildPayload(p).errors));
  });

  it("정적: BuildDispatchPayload 타입에 비밀 필드 이름이 없다(필드를 더하면 여기서 걸린다)", () => {
    const src = readFileSync(path.join(ROOT, "src/routes/workspace-build-jobs.ts"), "utf8");
    const m = /export type BuildDispatchPayload = \{([\s\S]*?)\n\};/.exec(src);
    assert.ok(m, "BuildDispatchPayload type block");
    assert.doesNotMatch(m[1], /cfApiToken|callbackToken|ApiKey|userKey|repo\s*:|token\s*:\s*string;\s*org/, "no secret-bearing field");
    assert.match(m[1], /jobToken: string/, "the only credential is the job-scoped token");
  });
});

// ══ ② jobToken ════════════════════════════════════════════════════════════════════════════════════

describe("② 잡 범위 토큰", () => {
  it("mint/verify: 모양 bjt1.<jobId>.<64hex> · 잡마다 다르다 · jobId 바꿔치기·다른 루트는 무효 · KEK 없으면 전역 토큰에서 파생", async () => {
    assert.ok(tokenMod, "workspace/build-job-token module");
    const env = { CONCLAVE_TOKEN_KEK: KEK, INTERNAL_CALLBACK_TOKEN: ICT };
    const a = await tokenMod.mintBuildJobToken(env, "bj_aaaaaaaaaa");
    const b = await tokenMod.mintBuildJobToken(env, "bj_bbbbbbbbbb");
    assert.match(a, /^bjt1\.bj_aaaaaaaaaa\.[0-9a-f]{64}$/);
    assert.notEqual(a.split(".")[2], b.split(".")[2]);
    assert.deepEqual(await tokenMod.verifyBuildJobToken(env, a), { ok: true, jobId: "bj_aaaaaaaaaa" });
    const swapped = a.replace("bj_aaaaaaaaaa", "bj_bbbbbbbbbb");
    assert.deepEqual(await tokenMod.verifyBuildJobToken(env, swapped), { ok: false }, "a token cannot be re-pointed at another job");
    assert.deepEqual(await tokenMod.verifyBuildJobToken({ CONCLAVE_TOKEN_KEK: "other-kek-FAKE", INTERNAL_CALLBACK_TOKEN: ICT }, a), { ok: false });
    assert.ok(!a.includes(KEK) && !a.includes(ICT), "the root secret is not in the token");
    const noKek = await tokenMod.mintBuildJobToken({ INTERNAL_CALLBACK_TOKEN: ICT }, "bj_aaaaaaaaaa");
    assert.notEqual(noKek, a, "KEK preferred over the global callback token when both exist");
    assert.equal((await tokenMod.verifyBuildJobToken({ INTERNAL_CALLBACK_TOKEN: ICT }, noKek)).ok, true);
    assert.equal(await tokenMod.mintBuildJobToken({}, "bj_aaaaaaaaaa"), null, "no root secret → no token");
    assert.equal(await tokenMod.mintBuildJobToken(env, "bj.dot"), null, "jobId with the separator is refused");
  });

  it("build-progress: 자기 잡 토큰 200 · 다른 잡의 토큰 403(상태·이벤트 불변) · 위조 401 · 없음 401", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "scaffolding" }), jobRow({ id: "bj_bbbbbbbbbb", status: "scaffolding" })] });
    const env = envFor(db);
    const app = createApp();
    const tokA = await mint(env, "bj_aaaaaaaaaa");
    const own = await postJson(app, env, "/internal/build-progress", { jobId: "bj_aaaaaaaaaa", status: "implementing", message: "wbs_started" }, bearer(tokA));
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.transitioned, true);
    const cross = await postJson(app, env, "/internal/build-progress", { jobId: "bj_bbbbbbbbbb", status: "implementing", message: "위조 진행" }, bearer(tokA));
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error, "job_token_mismatch");
    assert.equal(db.jobs[1].status, "scaffolding", "the other job did not move");
    assert.ok(!db.events.some((e) => e.job_id === "bj_bbbbbbbbbb"), "no event row on the other job");
    const forged = `bjt1.bj_bbbbbbbbbb.${"0".repeat(64)}`;
    assert.equal((await postJson(app, env, "/internal/build-progress", { jobId: "bj_bbbbbbbbbb", status: "implementing" }, bearer(forged))).status, 401);
    assert.equal((await postJson(app, env, "/internal/build-progress", { jobId: "bj_bbbbbbbbbb", status: "implementing" })).status, 401);
  });

  it("build-done: 다른 잡의 토큰은 403 — 남의 빌드를 done/failed로 만들 수 없다", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa" }), jobRow({ id: "bj_bbbbbbbbbb" })] });
    const env = envFor(db);
    const app = createApp();
    const tokA = await mint(env, "bj_aaaaaaaaaa");
    const cross = await postJson(app, env, "/internal/build-done", { jobId: "bj_bbbbbbbbbb", ok: false, failedStage: "implementing", error: "sabotage" }, bearer(tokA));
    assert.equal(cross.status, 403);
    assert.equal(db.jobs[1].status, "implementing");
    const own = await postJson(app, env, "/internal/build-done", { jobId: "bj_aaaaaaaaaa", ok: false, failedStage: "implementing", error: "budget_exhausted" }, bearer(tokA));
    assert.equal(own.status, 200);
    assert.equal(own.body.accepted, true);
    assert.equal(db.jobs[0].status, "failed");
    assert.equal(db.jobs[0].error, "budget_exhausted");
  });

  it("★[검증 결함 8] 전역 INTERNAL_CALLBACK_TOKEN은 빌드 콜백에 통하지 않는다 — 403 job_token_required, 상태·이벤트·주소 불변", async () => {
    // 호환 분기는 코드로 닫았다(TODO가 아니라): 프로덕션 빌더 이미지(b1-builder-1)는 kind=build를 받자마자 실패하고,
    // 새 페이로드(callbackToken 없음)는 202 전에 400이라 옛 이미지가 새 잡을 돌릴 수 없다 — 지켜 줄 진행 중 잡이 없다.
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "scaffolding" })] });
    const env = envFor(db);
    const app = createApp();
    const r = await postJson(app, env, "/internal/build-progress", { jobId: "bj_aaaaaaaaaa", status: "implementing", message: "전역 토큰 진행" }, bearer(ICT));
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.error, "job_token_required");
    for (const body of [
      { jobId: "bj_aaaaaaaaaa", ok: false, failedStage: "implementing", error: "x" },
      { jobId: "bj_aaaaaaaaaa", ok: true, buildExitCode: 0, deployedUrl: "https://evil.example" },
    ]) {
      const d = await postJson(app, env, "/internal/build-done", body, bearer(ICT));
      assert.equal(d.status, 403, JSON.stringify(d.body));
      assert.equal(d.body.error, "job_token_required");
    }
    assert.equal(db.jobs[0].status, "scaffolding");
    assert.equal(db.jobs[0].deployed_url, null);
    assert.equal(db.events.length, 0);
    const src = readFileSync(path.join(ROOT, "src/workspace/build-job-token.ts"), "utf8");
    assert.doesNotMatch(src, /TODO\(B-5b S1 \+ 1 release\)|via: "global"/, "no global-token compat branch left to remove later");
  });
});

// ══ ③ 빌드 전용 LLM 프록시 ══════════════════════════════════════════════════════════════════════

describe("③ LLM 프록시 — 거절은 업스트림을 부르지 않는다", () => {
  const A = "/internal/build-llm/anthropic/v1/messages";
  const O = "/internal/build-llm/openai/v1/chat/completions";

  it("인증 없음 401 · jobId를 바꿔친 토큰 401(그 잡 예산 불변) · 전역 콜백 토큰 403 job_token_required", async () => {
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa" }), jobRow({ id: "bj_bbbbbbbbbb", spent_usd: 1 })] });
    const none = await postJson(w.app, w.env, A, anthropicReq());
    assert.equal(none.status, 401, JSON.stringify(none.body));
    assert.equal(none.body?.error?.type, "unauthorized");
    assert.ok(tokenMod, "build-job-token module");
    const tokA = await mint(w.env, "bj_aaaaaaaaaa");
    const swapped = tokA.replace("bj_aaaaaaaaaa", "bj_bbbbbbbbbb");
    assert.equal((await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": swapped })).status, 401);
    const glob = await postJson(w.app, w.env, O, openAiReq(), bearer(ICT));
    assert.equal(glob.status, 403);
    assert.equal(glob.body.error.type, "job_token_required");
    assert.equal(w.upstream.calls.length, 0);
    assert.equal(w.db.jobs[1].spent_usd, 1, "job B's budget untouched");
    assert.equal(w.db.ledger.length, 0);
  });

  it("모르는 잡 404 · 끝난 잡 409 job_not_active · x-should-retry:false(SDK가 409를 재시도하지 않게)", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "failed" })] });
    const ghost = await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": await mint(w.env, "bj_ghost00000") });
    assert.equal(ghost.status, 404);
    const done = await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": await mint(w.env, "bj_aaaaaaaaaa") });
    assert.equal(done.status, 409);
    assert.equal(done.body.error.type, "job_not_active");
    assert.equal(done.headers.get("x-should-retry"), "false");
    assert.equal(w.upstream.calls.length, 0);
  });

  it("★예산 소진(spent ≥ budget) → 402 budget_exhausted, 업스트림 0 — Anthropic·OpenAI 오류 모양 각각", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", budget_usd: 10, spent_usd: 10 })] });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const a = await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": tok });
    assert.equal(a.status, 402);
    assert.deepEqual(Object.keys(a.body), ["type", "error"]);
    assert.equal(a.body.error.type, "budget_exhausted");
    assert.equal(a.headers.get("x-should-retry"), "false");
    const o = await postJson(w.app, w.env, O, openAiReq(), bearer(tok));
    assert.equal(o.status, 402);
    assert.equal(o.body.error.code, "budget_exhausted");
    assert.equal(w.upstream.calls.length, 0, "no LLM call once the budget is spent");
    assert.equal(w.db.ledger.length, 0);
    assert.equal(w.db.jobs[0].spent_usd, 10);
  });

  it("모델 허용 목록(서버 고정) · BUILD_MODEL이 목록을 바꾼다 — 다른 모델은 400 model_not_allowed", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld();
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const opus = await postJson(w.app, w.env, A, anthropicReq({ model: "claude-opus-4-7" }), { "x-api-key": tok });
    assert.equal(opus.status, 400);
    assert.equal(opus.body.error.type, "model_not_allowed");
    assert.equal((await postJson(w.app, w.env, O, openAiReq({ model: "o3-pro" }), bearer(tok))).status, 400);
    assert.equal(w.upstream.calls.length, 0);
    const w2 = await proxyWorld({ extra: { BUILD_MODEL: "claude-haiku-4-5" } });
    assert.equal((await postJson(w2.app, w2.env, A, anthropicReq({ model: "claude-sonnet-4-6" }), { "x-api-key": await mint(w2.env, "bj_aaaaaaaaaa") })).status, 400);
    assert.equal((await postJson(w2.app, w2.env, A, anthropicReq({ model: "claude-haiku-4-5" }), { "x-api-key": await mint(w2.env, "bj_aaaaaaaaaa") })).status, 200);
  });

  it("크기 상한 413 · 스트리밍 400 · 출력 상한 없음/초과 400 · n>1 400 · GET 405 — 전부 업스트림 0", async () => {
    assert.ok(tokenMod && proxyMod, "token + proxy modules");
    const w = await proxyWorld();
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const big = "가".repeat(Math.ceil(proxyMod.BUILD_LLM_MAX_REQUEST_BYTES / 3) + 10);
    assert.equal((await postJson(w.app, w.env, A, anthropicReq({ messages: [{ role: "user", content: big }] }), { "x-api-key": tok })).status, 413);
    assert.equal((await postJson(w.app, w.env, A, anthropicReq({ stream: true }), { "x-api-key": tok })).body.error.type, "stream_not_supported");
    assert.equal((await postJson(w.app, w.env, O, openAiReq({ max_completion_tokens: undefined }), bearer(tok))).status, 400);
    assert.equal((await postJson(w.app, w.env, A, anthropicReq({ max_tokens: 200_000 }), { "x-api-key": tok })).status, 400);
    assert.equal((await postJson(w.app, w.env, O, openAiReq({ n: 4 }), bearer(tok))).status, 400);
    const get = await w.app.fetch(new Request(`${ORIGIN}${A}`, { headers: { "x-api-key": tok } }), w.env);
    assert.equal(get.status, 405);
    assert.equal(w.upstream.calls.length, 0);
  });

  it("Anthropic 킬스위치(ANTHROPIC_ENABLED=off) → anthropic 경로 503 vendor_disabled(업스트림 0), OpenAI 경로는 그대로", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({ extra: { ANTHROPIC_ENABLED: "off" } });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const a = await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": tok });
    assert.equal(a.status, 503);
    assert.equal(a.body.error.type, "vendor_disabled");
    assert.equal(w.upstream.calls.length, 0);
    assert.equal((await postJson(w.app, w.env, O, openAiReq(), bearer(tok))).status, 200);
    assert.equal(w.upstream.calls.length, 1);
  });
});

describe("③ LLM 프록시 — 정상 전달 = 서버 키로 업스트림 · 원장 1행 · spent_usd 원자 증가", () => {
  const A = "/internal/build-llm/anthropic/v1/messages";
  const O = "/internal/build-llm/openai/v1/chat/completions";

  it("★Anthropic: 게이트웨이/v1/messages에 **서버 키**(jobToken 아님) · 응답 그대로 · 원장 1행(job_kind build) · spent += 비용", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", spent_usd: 0.5 })] });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const r = await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": tok, "anthropic-version": "2023-06-01" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.id, "msg_fake_0001");
    assert.equal(r.body.content[0].name, "finish");
    assert.equal(w.upstream.calls.length, 1);
    const call = w.upstream.calls[0];
    assert.equal(call.url, `${GW_A}/v1/messages`);
    assert.equal(call.headers["x-api-key"], ANTHROPIC_KEY, "server key goes upstream");
    assert.ok(!JSON.stringify(call).includes(tok), "the job token never reaches the vendor");
    assert.equal(call.body.model, "claude-sonnet-4-6");
    assert.equal(call.body.messages[0].content, `${PRODUCT} — 예약 저장을 만들어 주세요`, "한글 본문 그대로");
    const cost = (1_000 * 3 + 200 * 15) / 1_000_000;
    assert.equal(w.db.ledger.length, 1);
    const row = w.db.ledger[0];
    assert.equal(row.job_kind, "build");
    assert.equal(row.job_id, "bj_aaaaaaaaaa");
    assert.equal(row.project_id, PROJECT, "project from the job row");
    assert.equal(row.user_key_hash, sha(USER), "user from the job row (hashed)");
    assert.equal(row.vendor, "anthropic");
    assert.equal(row.model_actual, "claude-sonnet-4-6");
    assert.equal(row.call_site, "build-proxy");
    assert.equal(row.unpriced, 0);
    near(row.cost_usd, cost);
    near(w.db.jobs[0].spent_usd, 0.5 + cost);
    near(Number(r.headers.get("x-simsa-build-spent-usd")), 0.5 + cost, 1e-6);
  });

  it("★OpenAI: 게이트웨이/chat/completions에 Bearer 서버 키 · 캐시 할인 반영 · 원장 1행 (service_tier는 이제 400 — ⑧-5)", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld();
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const r = await postJson(w.app, w.env, O, openAiReq(), bearer(tok));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const call = w.upstream.calls[0];
    assert.equal(call.url, `${GW_O}/chat/completions`);
    assert.equal(call.headers.authorization, `Bearer ${OPENAI_KEY}`);
    assert.ok(!("service_tier" in call.body), "priced tier only");
    const cost = (200 * 2.5 + 800 * 0.25 + 100 * 15) / 1_000_000;
    assert.equal(w.db.ledger.length, 1);
    assert.equal(w.db.ledger[0].vendor, "openai");
    assert.equal(w.db.ledger[0].model_actual, "gpt-5.4-2026-03-05");
    assert.equal(w.db.ledger[0].cache_read_tokens, 800);
    near(w.db.ledger[0].cost_usd, cost);
    near(w.db.jobs[0].spent_usd, cost);
  });

  it("업스트림 5xx는 그대로 전달하고 청구 0 · usage 없는 2xx는 보수 청구(최고 단가·출력 상한) + unpriced", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({
      upstream: makeUpstream({
        anthropic: () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "content-type": "application/json" } }),
        openai: () => new Response(JSON.stringify({ id: "chatcmpl-nousage", model: "gpt-5.4", choices: [] }), { status: 200 }),
      }),
    });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const a = await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": tok });
    assert.equal(a.status, 529);
    assert.equal(a.body.error.type, "overloaded_error");
    assert.equal(w.db.ledger.length, 0);
    assert.equal(w.db.jobs[0].spent_usd, 0);
    const o = await postJson(w.app, w.env, O, openAiReq({ max_completion_tokens: 1_000 }), bearer(tok));
    assert.equal(o.status, 200);
    assert.equal(w.db.ledger.length, 1);
    assert.equal(w.db.ledger[0].unpriced, 1);
    assert.equal(w.db.ledger[0].output_tokens, 1_000, "the output cap is charged");
    assert.ok(w.db.jobs[0].spent_usd >= 1_000 * 25 / 1_000_000, `conservative spend ${w.db.jobs[0].spent_usd}`);
  });

  it("★예산 끝까지: 호출이 쌓여 spent ≥ budget이 되면 다음 호출부터 402 — 조용한 초과 없음", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", budget_usd: 0.01 })] });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await postJson(w.app, w.env, A, anthropicReq(), { "x-api-key": tok })).status);
    assert.deepEqual(statuses, [200, 200, 402, 402], "0.006 × 2 = 0.012 ≥ 0.01 → stop");
    assert.equal(w.upstream.calls.length, 2);
    assert.equal(w.db.ledger.length, 2);
    near(w.db.jobs[0].spent_usd, 0.012);
  });
});

// ══ ④ 이중 계상 0 ═══════════════════════════════════════════════════════════════════════════════

describe("④ 원장·spent_usd는 프록시 한 곳에서만", () => {
  it("★프록시가 1번 계량한 호출을 컨테이너가 progress·done usage[]로 다시 보내도 원장 1행, spent는 프록시 값 그대로(본문 spentUsd 무시)", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "scaffolding" })] });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    assert.equal((await postJson(w.app, w.env, "/internal/build-llm/anthropic/v1/messages", anthropicReq(), { "x-api-key": tok })).status, 200);
    const cost = (1_000 * 3 + 200 * 15) / 1_000_000;
    const same = { vendor: "anthropic", modelRequested: "claude-sonnet-4-6", modelActual: "claude-sonnet-4-6", inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 200, latencyMs: 900, callSite: "build-worker", callId: "n1:WBS-001:0" };
    const p = await postJson(w.app, w.env, "/internal/build-progress", { jobId: "bj_aaaaaaaaaa", status: "implementing", wbsDone: 1, spentUsd: 5, usage: [same, { ...same, callId: "n1:WBS-001:1" }] }, bearer(tok));
    assert.equal(p.status, 200);
    assert.equal(w.db.ledger.length, 1, "callback usage[] is not a ledger path for builds");
    near(w.db.jobs[0].spent_usd, cost, 1e-9);
    const d = await postJson(w.app, w.env, "/internal/build-done", { jobId: "bj_aaaaaaaaaa", ok: false, failedStage: "implementing", error: "budget_exhausted", spentUsd: 9.5, usage: [same] }, bearer(tok));
    assert.equal(d.body.accepted, true);
    assert.equal(w.db.ledger.length, 1);
    near(w.db.jobs[0].spent_usd, cost, 1e-9);
  });

  it("done(Worker 경로, S3)도 지출을 **내리지** 못한다 — markBuildJobDone은 MAX(spent_usd) (컨테이너의 done 주장은 ⑧-2에서 거절)", async () => {
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "deploying", spent_usd: 3.25, build_exit_code: 0 })] });
    const env = envFor(db);
    const r = await buildDb.markBuildJobDone(env, "bj_aaaaaaaaaa", { deployedUrl: "https://app-3f9a1c2b.simsa.page", commitSha: null, spentUsd: 0, buildExitCode: 0, wbsDone: 2 });
    assert.deepEqual(r, { ok: true });
    assert.equal(db.jobs[0].status, "done");
    assert.equal(db.jobs[0].spent_usd, 3.25);
  });
});

// ══ ⑤ 컨테이너 ════════════════════════════════════════════════════════════════════════════════════

describe("⑤ 컨테이너 — 비밀 없는 페이로드 · jobToken · 프록시 · 예산 정지 · 자식 env", () => {
  const TOKEN_A = `bjt1.bj_0a1b2c3d4e.${"ab".repeat(32)}`;

  it("★옛 Worker 페이로드(비밀 포함)는 거절 — 각 비밀 경로를 이름으로(값은 되풀이하지 않는다)", () => {
    const old = {
      ...payloadFor("bj_0a1b2c3d4e", TOKEN_A),
      callbackToken: "cb-FAKE-SECRET", userKey: "uk_FAKE-SECRET",
      hosting: { cfApiToken: "cf-FAKE-SECRET", cfAccountId: "acc1", namespace: "simsa-hosted", hostRoot: "simsa.page", d1Id: D1_UUID },
      repo: { token: "repo-FAKE-SECRET", org: "simsa-hosted", name: "app-3f9a1c2b" },
      llm: { anthropicApiKey: "a-FAKE-SECRET", anthropicBaseUrl: null, openaiApiKey: "o-FAKE-SECRET", model: "claude-sonnet-4-6", preferFallback: true },
    };
    const v = run.validateBuildPayload(old);
    assert.equal(v.ok, false);
    for (const p of ["callbackToken", "userKey", "hosting.cfApiToken", "repo.token", "llm.anthropicApiKey", "llm.openaiApiKey"]) assert.ok(v.errors.includes(`forbidden:${p}`), `${p} → ${JSON.stringify(v.errors)}`);
    assert.ok(!JSON.stringify(v.errors).includes("SECRET"));
    const nulls = run.validateBuildPayload({ ...payloadFor("bj_0a1b2c3d4e", TOKEN_A), repo: null });
    assert.equal(nulls.ok, true, "a null placeholder is not a secret");
  });

  it("새 페이로드: jobToken은 그 잡의 것이어야 하고 · baseUrl은 콜백과 같은 출처 · 정규화 잡에는 토큰이 없다", () => {
    const ok = run.validateBuildPayload(payloadFor("bj_0a1b2c3d4e", TOKEN_A));
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.ok(!JSON.stringify(ok.job).includes(TOKEN_A), "normalized job has no token");
    assert.equal(ok.job.productName, PRODUCT);
    assert.ok(run.validateBuildPayload(payloadFor("bj_0a1b2c3d4e", `bjt1.bj_other00000.${"ab".repeat(32)}`)).errors.includes("jobToken"));
    assert.ok(run.validateBuildPayload(payloadFor("bj_0a1b2c3d4e", "cb-global-FAKE")).errors.includes("jobToken"));
    assert.ok(run.validateBuildPayload(payloadFor("bj_0a1b2c3d4e", TOKEN_A, { baseUrl: "https://evil.example" })).errors.includes("baseUrl"));
    assert.ok(run.validateBuildPayload(payloadFor("bj_0a1b2c3d4e", TOKEN_A, { llm: { model: 'x" y', preferFallback: false } })).errors.includes("llm.model"));
    assert.deepEqual([...run.REQUIRED_FIELDS].sort(), ["baseUrl", "callbackUrl", "jobId", "jobToken", "kind"]);
  });

  it("buildLlmConfig: 프록시 주소(Worker 라우트와 같은 접미) + apiKey=jobToken — 벤더 키 자리에 벤더 키가 없다", () => {
    assert.ok(proxyMod, "proxy module");
    const job = run.validateBuildPayload(payloadFor("bj_0a1b2c3d4e", TOKEN_A)).job;
    const llm = run.buildLlmConfig(job, TOKEN_A);
    assert.deepEqual(llm, {
      anthropicBaseUrl: `${ORIGIN}${proxyMod.BUILD_LLM_ANTHROPIC_BASE_SUFFIX}`,
      openaiBaseUrl: `${ORIGIN}${proxyMod.BUILD_LLM_OPENAI_BASE_SUFFIX}`,
      apiKey: TOKEN_A,
      model: "claude-sonnet-4-6",
      openaiModel: "gpt-5.4",
      preferFallback: false,
    });
    // SDK·폴백이 붙이는 접미까지 합치면 정확히 프록시 라우트다.
    assert.equal(`${llm.anthropicBaseUrl}/v1/messages`, `${ORIGIN}${proxyMod.BUILD_LLM_ANTHROPIC_PATH}`);
    assert.equal(`${llm.openaiBaseUrl}/chat/completions`, `${ORIGIN}${proxyMod.BUILD_LLM_OPENAI_PATH}`);
  });

  it("★실제 Anthropic SDK · withOpenAiFallback이 buildLlmConfig로 프록시를 거쳐 응답을 받는다(경로·헤더 계약)", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld();
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const job = run.validateBuildPayload(payloadFor("bj_aaaaaaaaaa", tok)).job;
    const llm = run.buildLlmConfig(job, tok);
    const sdk = new Anthropic({ apiKey: llm.apiKey, baseURL: llm.anthropicBaseUrl, fetch: fetchIntoWorker(w.app, w.env), maxRetries: 0 });
    const msg = await sdk.messages.create({ model: llm.model, max_tokens: 512, messages: [{ role: "user", content: "예약 저장" }] });
    assert.equal(msg.id, "msg_fake_0001");
    const fb = agentWorker.withOpenAiFallback(null, { openaiApiKey: llm.apiKey, openaiBaseUrl: llm.openaiBaseUrl, model: llm.openaiModel, preferFallback: true, fetchImpl: fetchIntoWorker(w.app, w.env) });
    const res = await fb.messages.create({ model: llm.model, max_tokens: 512, messages: [{ role: "user", content: "예약 화면" }] });
    assert.equal(res.vendor, "openai");
    assert.equal(w.upstream.calls.length, 2);
    assert.equal(w.db.ledger.length, 2);
    assert.deepEqual(w.upstream.calls.map((c) => c.url), [`${GW_A}/v1/messages`, `${GW_O}/chat/completions`]);
  });

  it("★402 → 그 WBS에서 멈춘다: 첫 WBS는 프록시로 끝내고 커밋 · 둘째 WBS에서 예산 소진 → 지금까지 커밋 · failed(implementing, budget_exhausted) — Worker 행까지", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const upstream = makeUpstream();
    const db = makeDb();
    const env = envFor(db);
    const app = createApp({ fetch: upstream.fetchImpl });
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 2, budgetUsd: 0.005 });
    const tok = await mint(env, job.id);
    const toWorker = fetchIntoWorker(app, env);
    const posted = [];
    const post = async (url, token, body) => {
      posted.push({ url, token, body: JSON.parse(JSON.stringify(body)) });
      const res = await toWorker(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
    };
    const nullExecutor = { readFile: async () => null, listFiles: async () => [], createFile: async () => {}, runCommand: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }) };
    const implementWbs = async ({ item, job: j, llm }) => {
      const client = new Anthropic({ apiKey: llm.apiKey, baseURL: llm.anthropicBaseUrl, fetch: toWorker, maxRetries: 0 });
      return agentWorker.runBuildLoop({ specMarkdown: j.specMarkdown, wbsId: item.id, wbsTitle: item.title, acceptanceIds: item.acceptanceIds, locale: j.locale, fileList: [] }, { client, executor: nullExecutor, model: llm.model });
    };
    const git = gitExec();
    const body = await run.runBuildJob(payloadFor(job.id, tok, { budgetUsd: 0.005 }), { workRoot: await tmpDir("wr402"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: post, implementWbs, sandbox: null, log: () => {} });

    assert.deepEqual(body, { jobId: job.id, ok: false, stage: "failed", failedStage: "implementing", error: "budget_exhausted", wbsDone: 1 });
    assert.equal(upstream.calls.length, 1, "only the first WBS reached the vendor");
    assert.equal(db.ledger.length, 1);
    const commits = git.calls.filter((c) => c.args.includes("commit")).map((c) => c.args[c.args.indexOf("-m") + 1]);
    assert.deepEqual(commits, ["chore: scaffold simsa-hosted-app template", "feat: 예약 저장", "wip(WBS-002): stopped — build budget exhausted"], "work so far is committed");
    assert.ok(posted.every((c) => c.token === tok), "every callback uses the job token");
    assert.ok(posted.every((c) => !("usage" in c.body) && !("spentUsd" in c.body)), "no usage/spend in callbacks");
    assert.deepEqual(posted.map((c) => [c.body.status, c.body.message]), [
      ["scaffolding", "scaffold_started"], ["scaffolding", "scaffold_ready"],
      ["implementing", "wbs_started"], ["implementing", "wbs_done"], ["implementing", "wbs_started"],
    ]);
    // server.mjs가 하는 일: 최종 본문을 build-done으로
    const done = await post(`${ORIGIN}/internal/build-done`, tok, body);
    assert.equal(done.json.accepted, true);
    const row = db.jobs.find((j) => j.id === job.id);
    assert.equal(row.status, "failed");
    assert.equal(row.failed_stage, "implementing");
    assert.equal(row.error, "budget_exhausted");
    near(row.spent_usd, 0.006);
    assert.equal(row.wbs_done, 1);
  });

  it("isBudgetExhausted: SDK 오류(status 402) · 폴백 오류 문구 · runBuildLoop 결과를 알고, 402 없는 같은 단어는 아니다", () => {
    const sdkErr = Object.assign(new Error('402 {"type":"error","error":{"type":"budget_exhausted","message":"x"}}'), { status: 402, error: { type: "error", error: { type: "budget_exhausted" } } });
    assert.equal(run.isBudgetExhausted(sdkErr), true);
    assert.equal(run.isBudgetExhausted(new Error('OpenAI 402: {"error":{"type":"budget_exhausted"}}')), true);
    assert.equal(run.isBudgetExhausted({ status: "llm_error", summary: 'llm_error: 402 {"type":"error","error":{"type":"budget_exhausted"}}' }), true);
    assert.equal(run.isBudgetExhausted({ status: "done", summary: "budget_exhausted 문구를 화면에 보여 주는 기능 완료" }), false);
    assert.equal(run.isBudgetExhausted({ status: "llm_error", summary: "llm_error: 529 overloaded" }), false);
    assert.equal(run.isBudgetExhausted(null), false);
  });

  it("implementWbs 기본값(B-5b-2 — 이미지 안 agent-worker)을 못 불러오면 implementing에서 정직하게 실패 — 조용한 성공 없음", async () => {
    // [의도된 변경 · B-5b-2] 종전 기본값은 `builder_stage_not_implemented:implementing`. 이제 기본값이 있고, 이미지 밖(여기)은
    // AGENT_WORKER_ENTRY import가 실패하므로 WBS 진행 콜백 없이 agent_worker_unavailable.
    const posted = [];
    const post = async (url, token, body) => { posted.push({ token, body }); return { ok: true, status: 200, json: { ok: true, transitioned: true } }; };
    const r = await run.runBuildJob(payloadFor("bj_0a1b2c3d4e", TOKEN_A), { workRoot: await tmpDir("wrdef"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: post, sandbox: null, loadAgentWorker: async () => { throw new Error("Cannot find module"); } });
    assert.equal(r.failedStage, "implementing");
    assert.match(r.error, /^agent_worker_unavailable:Cannot find module/);
    assert.equal(r.wbsDone, 0);
    assert.deepEqual(posted.map((c) => c.body.message), ["scaffold_started", "scaffold_ready"], "no WBS started without the agent");
    assert.ok(posted.every((c) => c.token === TOKEN_A));
  });

  it("★자식 프로세스 env: 허용 키만 — jobToken·비밀 이름 0 (agent-worker ALLOWED_ENV_KEYS와 같은 목록)", async () => {
    assert.equal(typeof run.childEnv, "function", "childEnv export");
    const base = {
      PATH: "/usr/bin", HOME: "/home/builder", LANG: "ko_KR.UTF-8", NODE_ENV: "production",
      JOB_TOKEN: TOKEN_A, SIMSA_JOB_TOKEN: TOKEN_A, INTERNAL_CALLBACK_TOKEN: "cb-FAKE", ANTHROPIC_API_KEY: "a-FAKE", OPENAI_API_KEY: "o-FAKE",
      HOSTING_CF_API_TOKEN: "cf-FAKE", CLOUDFLARE_API_TOKEN: "cf2-FAKE", GITHUB_TOKEN: "gh-FAKE", NPM_TOKEN: "npm-FAKE", CONCLAVE_TOKEN_KEK: "kek-FAKE",
    };
    const e = run.childEnv(base);
    assert.deepEqual(Object.keys(e).sort(), ["HOME", "LANG", "NODE_ENV", "PATH"]);
    assert.ok(!Object.values(e).some((v) => v.includes("FAKE") || v === TOKEN_A));
    assert.deepEqual([...run.CHILD_ENV_KEYS].sort(), [...agentWorker.ALLOWED_ENV_KEYS].sort(), "same allowlist as the build loop's filterEnv");
    // runBuild가 모든 exec에 그 env를 넘긴다(git 포함) — process.env 통째로가 아니라.
    // [의도된 변경 · B-5b-2·3] env = childEnv + NO_COLOR(로그 가독성), 모델 명령·빌드·테스트는 + npm_config_offline(레지스트리 금지).
    // 두 키는 우리가 넣는 고정값이다(비밀 아님 — builder-work.mjs WORK_ENV_EXTRA_KEYS).
    const git = gitExec();
    const implEnvs = [];
    const impl = async ({ env }) => { implEnvs.push(env); return { status: "done", commitMessage: "feat: 예약" }; };
    await run.runBuildJob(payloadFor("bj_0a1b2c3d4e", TOKEN_A), { workRoot: await tmpDir("wrenv"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: async () => ({ ok: true, status: 200, json: { ok: true, transitioned: true } }), implementWbs: impl, baseEnv: base, sandbox: null, log: () => {} });
    assert.ok(git.calls.length >= 5);
    // [의도된 변경 · B-5b S3] 게이트 뒤 산출물: 번들(wrangler dry-run)은 오프라인 + WRANGLER_SEND_METRICS=false, 수집기는 오프라인.
    for (const c of git.calls) {
      const offline = { ...e, NO_COLOR: "1", npm_config_offline: "true" };
      const want =
        c.cmd === "wrangler" ? { ...offline, WRANGLER_SEND_METRICS: "false" }
        : c.args[0] === run.ARTIFACT_COLLECTOR_ENTRY || c.args[0] === "run" || c.args[0] === "test" ? offline
        : { ...e, NO_COLOR: "1" };
      assert.deepEqual(c.env, want, `${c.cmd ?? "git"} ${c.args.join(" ")} gets the filtered env`);
      assert.ok(!JSON.stringify(c).includes(TOKEN_A), "the job token is never an exec argument or env value");
    }
    assert.ok(implEnvs.length >= 2 && implEnvs.every((x) => JSON.stringify(x) === JSON.stringify({ ...e, NO_COLOR: "1", npm_config_offline: "true" })), "WBS gets the offline env");
    const src = readFileSync(path.join(ROOT, "builder-container/builder-run.mjs"), "utf8");
    assert.doesNotMatch(src, /env:\s*process\.env\b/, "no exec gets the whole process.env");
  });

  it("implementWbs seam: WBS마다 wbs_started → 구현 → 커밋 → wbs_done, 다 끝나면 빌드 게이트 → 산출물 → Worker가 done이라 답할 때만 성공 보고", async () => {
    // [의도된 변경 · B-5b-3] 종전: WBS 뒤 failed(building, builder_stage_not_implemented:building). 이제 게이트(install·build·test)가
    // 돈다(여기선 가짜 exec라 초록불). [의도된 변경 · B-5b S3] 종전: 그다음 failed(pushed, builder_stage_not_implemented:pushed).
    // 이제 산출물을 Worker로 올리고(push·배포·done은 Worker), Worker가 done이라 답하면 성공 보고 — 산출물·업로드는 seam으로.
    const posted = [];
    const post = async (url, token, body) => { posted.push(body); return { ok: true, status: 200, json: { ok: true, transitioned: true } }; };
    const seen = [];
    const impl = async ({ item, llm, env }) => { seen.push({ id: item.id, title: item.title, apiKey: llm.apiKey, envHasToken: JSON.stringify(env).includes(TOKEN_A) }); return { status: "done", commitMessage: `feat: ${item.title}` }; };
    const git = gitExec();
    const uploads = [];
    const produceArtifact = async () => ({ ok: true, artifact: { worker: { mainModule: "worker.js", modules: [{ name: "worker.js", base64: "" }] }, assets: [], migrations: [], source: [], stats: null } });
    const uploadArtifact = async (url, token, body) => { uploads.push({ url, token, body }); return { ok: true, status: 200, json: { ok: true, accepted: true, status: "done" } }; };
    const r = await run.runBuildJob(payloadFor("bj_0a1b2c3d4e", TOKEN_A), { workRoot: await tmpDir("wrseam"), templateDir: REPO_TEMPLATE, exec: git.exec, postCallback: post, implementWbs: impl, sandbox: null, log: () => {}, produceArtifact, uploadArtifact });
    assert.deepEqual([r.jobId, r.ok, r.stage, r.wbsDone, "deployedUrl" in r], ["bj_0a1b2c3d4e", true, "done", 2, false]);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].token, TOKEN_A, "the artifact upload authenticates with the job token");
    assert.ok(!JSON.stringify(uploads[0].body).includes(TOKEN_A), "…and never carries it in the body");
    assert.deepEqual(seen.map((s) => s.id), ["WBS-001", "WBS-002"]);
    assert.equal(seen[1].title, "예약 화면 — 한글 버튼 '예약하기'");
    assert.ok(seen.every((s) => s.apiKey === TOKEN_A && !s.envHasToken), "token only in the LLM config, never in env");
    assert.deepEqual(posted.slice(2, 6).map((b) => [b.message, b.meta.wbsId, b.wbsDone]), [["wbs_started", "WBS-001", 0], ["wbs_done", "WBS-001", 1], ["wbs_started", "WBS-002", 1], ["wbs_done", "WBS-002", 2]]);
    assert.deepEqual(posted.slice(6).map((b) => [b.status, b.message]), [["building", "gate_started"], ["testing", "test_started"], ["testing", "gate_passed"], ["testing", "artifact_started"], ["testing", "artifact_ready"]]);
    const commits = git.calls.filter((c) => c.args.includes("commit")).map((c) => c.args[c.args.indexOf("-m") + 1]);
    assert.deepEqual(commits.slice(1), ["feat: 예약 저장 (D1 테이블)", "feat: 예약 화면 — 한글 버튼 '예약하기'"]);
    const failing = await run.runBuildJob(payloadFor("bj_0a1b2c3d4e", TOKEN_A), { workRoot: await tmpDir("wrseam2"), templateDir: REPO_TEMPLATE, exec: gitExec().exec, postCallback: post, implementWbs: async () => ({ status: "limit_turns" }), sandbox: null, log: () => {} });
    assert.equal(failing.error, "wbs_failed:WBS-001:limit_turns");
  });

  it("RUNNER_REV가 올라갔다(이미지 교체 판별) · server.mjs는 jobToken으로 콜백하고 토큰을 로그에 쓰지 않는다", () => {
    assert.notEqual(run.RUNNER_REV, "b5b1-builder-4");
    const server = readFileSync(path.join(ROOT, "builder-container/server.mjs"), "utf8");
    assert.doesNotMatch(server, /callbackToken/, "the global callback token is gone from the container");
    assert.match(server, /postCallback\(callbackUrl, jobToken, result\)/);
    assert.match(server, /postCallback\(p\.callbackUrl, p\.jobToken, bodyOut/);
    assert.doesNotMatch(server, /console\.(log|error)\([^)]*jobToken/, "never log the job token");
  });
});

// ══ ⑥ 일일 상한 ═══════════════════════════════════════════════════════════════════════════════════

describe("⑥ 빌드 일일 상한 — user 3 · network 5 · service 30 (#561 관례)", () => {
  const projects = (n, owner = (i) => USER) => new Map(Array.from({ length: n }, (_, i) => [`wsp_cap_${i}`, projectRow(`wsp_cap_${i}`, owner(i))]));

  it("★같은 사용자 4번째 빌드 → 429 daily_limit_reached(kind build, scope user, limit 3, resetAt) + Retry-After, 프로비저닝 0", async () => {
    const db = makeDb({ projects: projects(4) });
    const env = envFor(db);
    for (let i = 0; i < 3; i++) assert.equal((await postBuild(env, { projectId: `wsp_cap_${i}` })).status, 202, `build ${i + 1}`);
    const r = await postBuild(env, { projectId: "wsp_cap_3" });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.error, "daily_limit_reached");
    assert.equal(r.body.kind, "build");
    assert.equal(r.body.scope, "user");
    assert.equal(r.body.limit, 3);
    assert.match(r.body.resetAt, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    assert.ok(Number(r.retryAfter) > 0);
    assert.deepEqual(r.cfCalls, [], "no D1 / namespace call once capped");
    assert.equal(db.jobs.length, 3);
    assert.equal(env.BUILDER.payloads.length, 3);
  });

  it("같은 네트워크 6번째(다른 userKey마다) → 429 scope network · cf-connecting-ip 없으면 그 층은 없다", async () => {
    const db = makeDb({ projects: projects(7, (i) => `uk_손님 ${i}`) });
    const env = envFor(db);
    for (let i = 0; i < 5; i++) assert.equal((await postBuild(env, { projectId: `wsp_cap_${i}`, userKey: `uk_손님 ${i}` })).status, 202);
    const r = await postBuild(env, { projectId: "wsp_cap_5", userKey: "uk_손님 5" });
    assert.equal(r.status, 429);
    assert.equal(r.body.scope, "network");
    assert.equal(r.body.limit, 5);
    assert.equal((await postBuild(env, { projectId: "wsp_cap_6", userKey: "uk_손님 6", ip: null })).status, 202, "no network key → user + service buckets only");
  });

  it("서비스 전체 상한 → 503 build_disabled reason daily_capacity(사용자 탓이 아니다) · BETA_BUILD_DAILY_LIMIT_GLOBAL로 조정", async () => {
    const db = makeDb({ projects: projects(3, (i) => `uk_손님 ${i}`) });
    const env = envFor(db, { BETA_BUILD_DAILY_LIMIT_GLOBAL: "2" });
    for (let i = 0; i < 2; i++) assert.equal((await postBuild(env, { projectId: `wsp_cap_${i}`, userKey: `uk_손님 ${i}`, ip: `198.51.100.${i}` })).status, 202);
    const r = await postBuild(env, { projectId: "wsp_cap_2", userKey: "uk_손님 2", ip: "198.51.100.9" });
    assert.equal(r.status, 503);
    assert.deepEqual(Object.keys(r.body).sort(), ["error", "ok", "reason", "resetAt"]);
    assert.equal(r.body.error, "build_disabled");
    assert.equal(r.body.reason, "daily_capacity");
  });

  it("★환급: 디스패치 실패·D1 실패는 사용자의 시도가 아니다 — 슬롯이 돌아온다(상한 1에서도 다음 빌드가 된다)", async () => {
    const db = makeDb({ projects: projects(3) });
    const env = envFor(db, { BETA_BUILD_DAILY_LIMIT: "1" });
    env.BUILDER = makeBuilder({ status: 500 });
    const failDispatch = await postBuild(env, { projectId: "wsp_cap_0" });
    assert.equal(failDispatch.status, 200);
    assert.equal(failDispatch.body.dispatched, false);
    assert.equal(db.jobs[0].status, "failed");
    const failD1 = await postBuild(env, { projectId: "wsp_cap_1", d1Ok: false });
    assert.equal(failD1.status, 502);
    env.BUILDER = makeBuilder();
    const ok = await postBuild(env, { projectId: "wsp_cap_2" });
    assert.equal(ok.status, 202, JSON.stringify(ok.body));
    const again = await postBuild(env, { projectId: "wsp_cap_1" });
    assert.equal(again.status, 429, "the one real build used the slot");
  });

  it("★[검증 결함 9] 환급: 네임스페이스 실패(502)·행 저장 실패(500 save_failed)도 슬롯을 돌려준다 — 상한 1에서 다음 빌드 202", async () => {
    // (a) 네임스페이스 API가 '이미 있음'이 아닌 오류 → 502, 잡 없음, 슬롯 환급
    const db1 = makeDb({ projects: projects(2) });
    const env1 = envFor(db1, { BETA_BUILD_DAILY_LIMIT: "1" });
    const ns = await postBuild(env1, { projectId: "wsp_cap_0", nsOk: false });
    assert.equal(ns.status, 502, JSON.stringify(ns.body));
    assert.equal(ns.body.error, "hosting_namespace_failed");
    assert.equal(db1.jobs.length, 0);
    const afterNs = await postBuild(env1, { projectId: "wsp_cap_1" });
    assert.equal(afterNs.status, 202, `slot refunded after namespace failure: ${JSON.stringify(afterNs.body)}`);

    // (b) INSERT INTO build_jobs가 던진다 → 500 save_failed, 슬롯 환급
    const db2 = makeDb({ projects: projects(2) });
    const realPrepare = db2.prepare.bind(db2);
    let armed = true;
    db2.prepare = (sql) => {
      if (armed && sql.includes("INSERT INTO build_jobs")) {
        armed = false;
        const boom = { run: async () => { throw new Error("D1_ERROR: simulated insert failure"); } };
        return { bind: () => boom, ...boom };
      }
      return realPrepare(sql);
    };
    const env2 = envFor(db2, { BETA_BUILD_DAILY_LIMIT: "1" });
    const origError = console.error;
    console.error = () => {};
    let save;
    try {
      save = await postBuild(env2, { projectId: "wsp_cap_0" });
    } finally {
      console.error = origError;
    }
    assert.equal(save.status, 500, JSON.stringify(save.body));
    assert.equal(save.body.error, "save_failed");
    assert.equal(db2.jobs.length, 0);
    const afterSave = await postBuild(env2, { projectId: "wsp_cap_1" });
    assert.equal(afterSave.status, 202, `slot refunded after save failure: ${JSON.stringify(afterSave.body)}`);
  });

  it("킬스위치가 상한보다 먼저 — BUILD_ENABLED=off면 슬롯도 SQL도 없다 · env 재정의 해석", async () => {
    const db = makeDb();
    const env = envFor(db, { BUILD_ENABLED: "off" });
    const r = await postBuild(env);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "build_disabled");
    assert.ok(!db.sqls.some((s) => /workspace_rate_limit|build_jobs|workspace_projects/.test(s)));
    assert.ok(capsMod, "build-daily-caps module");
    assert.deepEqual(capsMod.BUILD_DAILY_LIMITS, { perUser: 3, perNetwork: 5, service: 30 });
    assert.equal(capsMod.buildDailyLimit({ BETA_BUILD_DAILY_LIMIT: "7" }), 7);
    assert.equal(capsMod.buildDailyLimit({ BETA_BUILD_DAILY_LIMIT: "0" }), 3);
    assert.equal(capsMod.buildDailyLimitPerIp({ BETA_BUILD_DAILY_LIMIT_PER_IP: "abc" }), 5);
    assert.equal(capsMod.buildDailyLimitGlobal({}), 30);
    assert.deepEqual(capsMod.buildDailyCapsFor({}, "uk_x", null).map((c) => c.scope), ["user", "service"]);
  });
});

// ══ ⑦ 실제 SQLite ══════════════════════════════════════════════════════════════════════════════════

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const noSqlite = DatabaseSync ? false : "node:sqlite 없음(Node < 22.13) — 미측정";

/** node:sqlite 위의 얇은 D1 어댑터. afterFirst: SELECT 한 번 뒤에 끼어드는 다른 쓰기(동시성 재현). */
function d1Over(sqlite, hooks = {}) {
  const stmt = (sql, args) => ({
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { const row = sqlite.prepare(sql).get(...args) ?? null; if (hooks.afterFirst) { const h = hooks.afterFirst; hooks.afterFirst = null; h(sql); } return row; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => ({ bind: (...a) => stmt(sql, a), run: () => stmt(sql, []).run(), first: () => stmt(sql, []).first(), all: () => stmt(sql, []).all() }) };
}
/** 실제 마이그레이션으로 만든 메모리 DB. ledger=true면 0070(llm_usage)까지 — 프록시를 통째로 돌릴 때. */
function fresh({ ledger = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(path.join(ROOT, "migrations/0068_build_jobs.sql"), "utf8"));
  if (ledger) sqlite.exec(readFileSync(path.join(ROOT, "migrations/0070_llm_usage.sql"), "utf8"));
  return sqlite;
}
const spentOf = (sqlite, id) => sqlite.prepare("SELECT spent_usd FROM build_jobs WHERE id = ?").get(id).spent_usd;

describe("⑦ 실제 SQLite — spent_usd를 잃지 않는다", { skip: noSqlite }, () => {
  it("★진행 전이가 읽은 뒤 프록시가 비용을 더해도(끼어들기) 전이가 그 몫을 지우지 않는다 — 전이는 spent_usd를 쓰지 않는다", async () => {
    const sqlite = fresh();
    const hooks = {};
    const env = { DB: d1Over(sqlite, hooks) };
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 2 });
    hooks.afterFirst = () => sqlite.prepare("UPDATE build_jobs SET spent_usd = spent_usd + ? WHERE id = ?").run(1.5, job.id);
    assert.equal(await buildDb.advanceBuildJob(env, job.id, { status: "scaffolding" }), true);
    assert.equal(spentOf(sqlite, job.id), 1.5, "the proxy's increment survives the concurrent progress write");
    // done은 산출물을 받은 행만(S3 검증 결함 6 — WHERE build_exit_code = 0): 게이트 → 수령 → done. 이 done이 실제로 일어나야 아래 단언이 뜻을 가진다.
    assert.equal(await buildDb.advanceBuildJob(env, job.id, { status: "testing" }), true);
    assert.equal(await buildDb.claimBuildArtifact(env, job.id), true);
    assert.deepEqual(await buildDb.markBuildJobDone(env, job.id, { deployedUrl: "https://app-3f9a1c2b.simsa.page", commitSha: null, spentUsd: 0, buildExitCode: 0, wbsDone: 2 }), { ok: true });
    assert.equal(spentOf(sqlite, job.id), 1.5, "done never lowers the metered spend");
  });

  it("예약·정산 누적: 여러 호출의 실제 비용이 합으로 남는다 · 음수·NaN 비용은 0으로 · 모르는 잡은 예약 없음 (결함 4 뒤 addBuildJobSpend 대체)", async () => {
    assert.equal(typeof buildDb.reserveBuildJobSpend, "function", "reserveBuildJobSpend export");
    const sqlite = fresh();
    const env = { DB: d1Over(sqlite) };
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 1 });
    for (const actual of [0.25, 0.5, -3, Number.NaN]) {
      assert.equal(await buildDb.reserveBuildJobSpend(env, job.id, 2), true);
      await buildDb.settleBuildJobSpend(env, job.id, 2, actual);
    }
    assert.equal(spentOf(sqlite, job.id), 0.75);
    assert.equal(await buildDb.reserveBuildJobSpend(env, "bj_ghost00000", 1), false);
  });
});

// ══ ⑧ PR #569 S1 검증 결함 ═════════════════════════════════════════════════════════════════════════
// 결함마다 재현 → 고침. 옛 코드(acfe2b6)에서 실패, 새 코드에서 통과(표는 PR #569 코멘트). 결함 3(executor 테스트
// 하드 import)은 train-b-b5b-executor.test.mjs, 결함 8은 ②, 결함 9는 ⑥, 결함 10(주석)은 테스트 없음.

const PA = "/internal/build-llm/anthropic/v1/messages";
const PO = "/internal/build-llm/openai/v1/chat/completions";
const json200 = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("⑧-1 · ⑧-2 콜백은 Worker 소유 칸을 못 쓴다 — push 대상·커밋·빌드 결과·배포 주소·done", () => {
  it("★[결함 1] 진행 콜백이 repoFullName·commitSha·buildExitCode·wbsTotal을 실어도 행은 그대로 — 자기 jobToken이어도(단계 전이만)", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "scaffolding", repo_full_name: "simsa-hosted/app-3f9a1c2b", wbs_total: 2 })] });
    const env = envFor(db);
    const tok = await mint(env, "bj_aaaaaaaaaa");
    const r = await postJson(createApp(), env, "/internal/build-progress", {
      jobId: "bj_aaaaaaaaaa", status: "implementing", message: "wbs_started",
      repoFullName: "simsa-hosted/someone-elses-app", commitSha: "deadbeef", buildExitCode: 0, wbsTotal: 99, wbsDone: 50,
    }, bearer(tok));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.transitioned, true, "the stage itself still moves");
    const row = db.jobs[0];
    assert.equal(row.status, "implementing");
    assert.equal(row.repo_full_name, "simsa-hosted/app-3f9a1c2b", "push target = the Worker's insert-time value, never callback input");
    assert.equal(row.commit_sha, null, "commit is the Worker's (S3 push), not the container's claim");
    assert.equal(row.build_exit_code, null, "build result is not a container claim");
    assert.equal(row.wbs_total, 2, "WBS count is fixed at insert from the spec");
    assert.equal(row.wbs_done, 2, "wbsDone is clamped to the job's WBS count");
  });

  it("★[결함 2] 컨테이너의 done(ok:true)은 받지 않는다 — 409 done_not_worker_owned · 잡은 failed(그 단계) · deployed_url·commit 없음 · done 이벤트 없음", async () => {
    assert.ok(tokenMod, "build-job-token module");
    for (const deployedUrl of ["javascript:alert(document.cookie)", "https://app-3f9a1c2b.simsa.page"]) {
      const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "implementing" })] });
      const env = envFor(db);
      const tok = await mint(env, "bj_aaaaaaaaaa");
      const r = await postJson(createApp(), env, "/internal/build-done", { jobId: "bj_aaaaaaaaaa", ok: true, buildExitCode: 0, deployedUrl, commitSha: "deadbeef", wbsDone: 2 }, bearer(tok));
      assert.equal(r.status, 409, `${deployedUrl}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "done_not_worker_owned");
      const row = db.jobs[0];
      assert.equal(row.status, "failed", "a done claim the container cannot back is an honest failure, not a spinner");
      assert.equal(row.failed_stage, "implementing");
      assert.equal(row.error, "done_not_worker_owned");
      assert.equal(row.deployed_url, null);
      assert.equal(row.commit_sha, null);
      assert.ok(!db.events.some((e) => e.stage === "done"), "no done event");
    }
  });

  it("[결함 2] markBuildJobDone(S3에서 Worker가 부른다)은 https가 아닌 주소·자격 증명이 든 주소를 저장하지 않는다", async () => {
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "deploying" })] });
    const env = envFor(db);
    for (const bad of ["javascript:alert(1)", "http://app-3f9a1c2b.simsa.page", "https://user:pw@app-3f9a1c2b.simsa.page", "소금빵 예약 페이지"]) {
      assert.deepEqual(
        await buildDb.markBuildJobDone(env, "bj_aaaaaaaaaa", { deployedUrl: bad, commitSha: null, spentUsd: 0, buildExitCode: 0, wbsDone: 2 }),
        { ok: false, reason: "invalid_deployed_url" },
        bad,
      );
    }
    assert.equal(db.jobs[0].status, "deploying");
    assert.equal(db.jobs[0].deployed_url, null);
  });
});

describe("⑧-4 예산은 예약이다 — 동시 호출이 몇 개든 초과 폭 ≤ 호출 1회", () => {
  const big = { input_tokens: 150_000, output_tokens: 32_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const oneCall = (150_000 * 3 + 32_000 * 15) / 1_000_000;

  /** 게이트에서 기다리는 느린 업스트림 + 40개 동시 호출. 게이트 앞 도착 + 끝난 호출 = 40이 되면 연다. */
  async function burst(w, tok, n = 40) {
    let settled = 0;
    const ps = Array.from({ length: n }, () =>
      postJson(w.app, w.env, PA, anthropicReq({ max_tokens: 32_768 }), { "x-api-key": tok }).finally(() => {
        settled += 1;
      }),
    );
    for (let i = 0; i < 300 && w.upstream.calls.length + settled < n; i++) await new Promise((r) => setTimeout(r, 10));
    w.release();
    return (await Promise.all(ps)).map((r) => r.status);
  }
  function gatedWorld() {
    let release;
    const gate = new Promise((r) => (release = r));
    const upstream = makeUpstream({ anthropic: async (_c, n) => { await gate; return json200(anthropicMessage({ id: `msg_slow_${n}`, usage: big })); } });
    return { upstream, release: () => release() };
  }

  it("★[결함 4] spent 9.999/10에서 40개 동시(max_tokens 32768·느린 업스트림) → 업스트림 1 · 402 39 · spent = 9.999 + 호출 1회", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const g = gatedWorld();
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", budget_usd: 10, spent_usd: 9.999 })], upstream: g.upstream });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const statuses = await burst({ ...w, release: g.release }, tok);
    assert.equal(w.upstream.calls.length, 1, `upstream calls: ${w.upstream.calls.length}`);
    assert.equal(statuses.filter((s) => s === 200).length, 1);
    assert.equal(statuses.filter((s) => s === 402).length, 39);
    near(w.db.jobs[0].spent_usd, 9.999 + oneCall, 1e-6);
    assert.ok(w.db.jobs[0].spent_usd <= 10 + oneCall + 1e-9, "overshoot ≤ one call");
    assert.equal(w.db.ledger.length, 1);
  });

  it("[결함 4 · 행동 보존] 예약은 업스트림 실패(529·연결 실패)면 풀린다 — spent 원래대로, 다음 호출이 들어간다", async () => {
    assert.ok(tokenMod, "build-job-token module");
    let n = 0;
    const upstream = makeUpstream({
      anthropic: () => {
        n += 1;
        if (n === 1) return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 });
        if (n === 2) throw new TypeError("fetch failed");
        return json200(anthropicMessage({ id: "msg_after_release" }));
      },
    });
    const w = await proxyWorld({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", budget_usd: 10, spent_usd: 1 })], upstream });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    assert.equal((await postJson(w.app, w.env, PA, anthropicReq({ max_tokens: 32_768 }), { "x-api-key": tok })).status, 529);
    near(w.db.jobs[0].spent_usd, 1, 1e-9);
    assert.equal((await postJson(w.app, w.env, PA, anthropicReq({ max_tokens: 32_768 }), { "x-api-key": tok })).status, 502);
    near(w.db.jobs[0].spent_usd, 1, 1e-9);
    assert.equal((await postJson(w.app, w.env, PA, anthropicReq(), { "x-api-key": tok })).status, 200);
    near(w.db.jobs[0].spent_usd, 1 + (1_000 * 3 + 200 * 15) / 1_000_000, 1e-9);
  });

  it("★[결함 4] 실제 SQLite(0068+0070)로 프록시를 통째로: 동시 10개 → 업스트림 1 · 원장 1행 · spent = 9.999 + 호출 1회", { skip: noSqlite }, async () => {
    assert.ok(tokenMod, "build-job-token module");
    const sqlite = fresh({ ledger: true });
    const g = gatedWorld();
    const env = envFor(d1Over(sqlite));
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 2 });
    sqlite.prepare("UPDATE build_jobs SET status = 'implementing', spent_usd = 9.999 WHERE id = ?").run(job.id);
    const w = { app: createApp({ fetch: g.upstream.fetchImpl }), env, upstream: g.upstream, release: g.release };
    const statuses = await burst(w, await mint(env, job.id), 10);
    assert.equal(g.upstream.calls.length, 1);
    assert.deepEqual([statuses.filter((s) => s === 200).length, statuses.filter((s) => s === 402).length], [1, 9]);
    near(spentOf(sqlite, job.id), 9.999 + oneCall, 1e-6);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM llm_usage WHERE job_id = ?").get(job.id).n, 1);
  });

  it("[결함 4] reserveBuildJobSpend·settleBuildJobSpend(실제 SQLite): 활성·spent<budget일 때만 예약 · 정산은 0 아래로 안 간다", { skip: noSqlite }, async () => {
    assert.equal(typeof buildDb.reserveBuildJobSpend, "function", "reserveBuildJobSpend export");
    assert.equal(typeof buildDb.settleBuildJobSpend, "function", "settleBuildJobSpend export");
    const sqlite = fresh();
    const env = { DB: d1Over(sqlite) };
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 1, budgetUsd: 10 });
    assert.equal(await buildDb.reserveBuildJobSpend(env, job.id, 3), true);
    assert.equal(spentOf(sqlite, job.id), 3);
    await buildDb.settleBuildJobSpend(env, job.id, 3, 0.5);
    assert.equal(spentOf(sqlite, job.id), 0.5);
    assert.equal(await buildDb.reserveBuildJobSpend(env, job.id, 50), true, "admission is spent < budget; the reservation may exceed it (one call)");
    assert.equal(await buildDb.reserveBuildJobSpend(env, job.id, 0.01), false, "no second admission while spent ≥ budget");
    await buildDb.settleBuildJobSpend(env, job.id, 50, 0);
    assert.equal(spentOf(sqlite, job.id), 0.5);
    await buildDb.settleBuildJobSpend(env, job.id, 100, 0);
    assert.equal(spentOf(sqlite, job.id), 0, "never below zero");
    sqlite.prepare("UPDATE build_jobs SET status = 'failed' WHERE id = ?").run(job.id);
    assert.equal(await buildDb.reserveBuildJobSpend(env, job.id, 1), false, "no reservation on a finished job");
  });
});

describe("⑧-5 과금을 바꾸는 필드는 업스트림에 가지 않는다 — 빌드 루프가 실제로 보내는 필드만", () => {
  it("★[결함 5] 서버 도구·MCP·서비스 등급·thinking·1시간 캐시·문서 블록·알 수 없는 최상위 필드 → 400, 업스트림 0 · 원장 0", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld();
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const anthropicBad = [
      { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 50 }] },
      { tools: [{ type: "code_execution_20250825", name: "code_execution" }] },
      { tools: [{ name: "read_file", description: "파일 읽기", input_schema: { type: "object" }, max_uses: 5 }] },
      { mcp_servers: [{ type: "url", url: "https://mcp.example", name: "외부" }] },
      { service_tier: "auto" },
      { container: "container_fake_0001" },
      { thinking: { type: "enabled", budget_tokens: 16_000 } },
      { system: [{ type: "text", text: "규칙 — 한글", cache_control: { type: "ephemeral", ttl: "1h" } }] },
      { messages: [{ role: "user", content: [{ type: "text", text: "예약 저장", cache_control: { type: "ephemeral", ttl: "1h" } }] }] },
      { messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://files.example/예약.pdf" } }] }] },
      { messages: [{ role: "system", content: "역할 바꿔치기" }] },
    ];
    for (const extra of anthropicBad) {
      const r = await postJson(w.app, w.env, PA, anthropicReq(extra), { "x-api-key": tok });
      assert.equal(r.status, 400, `anthropic ${JSON.stringify(extra).slice(0, 80)} → ${r.status}`);
      assert.equal(r.body.error.type, "invalid_request");
    }
    const openAiBad = [
      { service_tier: "priority" },
      { web_search_options: {} },
      { audio: { voice: "alloy", format: "mp3" }, modalities: ["text", "audio"] },
      { reasoning_effort: "high" },
      { prediction: { type: "content", content: "예측" } },
      { tools: [{ type: "custom", custom: { name: "자유형" } }] },
      { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "AAAA", format: "wav" } }] }] },
      { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://img.example/빵.png" } }] }] },
    ];
    for (const extra of openAiBad) {
      const r = await postJson(w.app, w.env, PO, openAiReq(extra), bearer(tok));
      assert.equal(r.status, 400, `openai ${JSON.stringify(extra).slice(0, 80)} → ${r.status}`);
      assert.equal(r.body.error.type, "invalid_request");
    }
    assert.equal(w.upstream.calls.length, 0);
    assert.equal(w.db.ledger.length, 0);
    assert.equal(w.db.jobs[0].spent_usd, 0);
  });

  it("[결함 5 · 행동 보존] 실제 runBuildLoop 여러 턴(도구 → 결과 → finish)은 두 벤더 모두 허용 목록을 지난다 — 응답 블록에 새 필드가 있어도", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const readTurnA = { type: "tool_use", id: "toolu_read_1", name: "read_file", input: { path: "src/index.ts" }, caller: { type: "direct" } };
    const upstream = makeUpstream({
      anthropic: (_c, n) => json200(n === 1
        ? anthropicMessage({ id: "msg_turn_1", content: [{ type: "text", text: "먼저 파일을 읽겠습니다." }, readTurnA] })
        : anthropicMessage({ id: `msg_turn_${n}` })),
      openai: (_c, n) => json200(n === 1
        ? { id: "chatcmpl-turn-1", object: "chat.completion", model: "gpt-5.4-2026-03-05", usage: { prompt_tokens: 900, completion_tokens: 40 },
            choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "파일을 읽겠습니다", tool_calls: [{ id: "call_read_1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/index.ts" }) } }] } }] }
        : openAiCompletion({ id: `chatcmpl-turn-${n}` })),
    });
    const w = await proxyWorld({ upstream });
    const tok = await mint(w.env, "bj_aaaaaaaaaa");
    const job = run.validateBuildPayload(payloadFor("bj_aaaaaaaaaa", tok)).job;
    const llm = run.buildLlmConfig(job, tok);
    const executor = { readFile: async () => "export default { fetch: () => new Response('소금빵') };", listFiles: async () => ["src/index.ts"], createFile: async () => {}, runCommand: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }) };
    const task = { specMarkdown: job.specMarkdown, wbsId: "WBS-001", wbsTitle: "예약 저장 (D1 테이블)", acceptanceIds: ["AC-001"], locale: "ko", fileList: ["src/index.ts"] };
    const sdk = new Anthropic({ apiKey: llm.apiKey, baseURL: llm.anthropicBaseUrl, fetch: fetchIntoWorker(w.app, w.env), maxRetries: 0 });
    const ra = await agentWorker.runBuildLoop(task, { client: sdk, executor, model: llm.model });
    assert.equal(ra.status, "done", ra.summary);
    const fb = agentWorker.withOpenAiFallback(null, { openaiApiKey: llm.apiKey, openaiBaseUrl: llm.openaiBaseUrl, model: llm.openaiModel, preferFallback: true, fetchImpl: fetchIntoWorker(w.app, w.env) });
    const ro = await agentWorker.runBuildLoop(task, { client: fb, executor, model: llm.model });
    assert.equal(ro.status, "done", ro.summary);
    assert.equal(w.upstream.calls.length, 4, "two turns per vendor reached the upstream");
    const a2 = w.upstream.calls.find((c) => c.url.startsWith(GW_A) && c.body.messages.length > 1).body;
    assert.ok(a2.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result" && b.tool_use_id === "toolu_read_1")), "tool_result went through");
    assert.ok(a2.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && b.caller?.type === "direct")), "echoed tool_use keeps unknown response fields");
    const o2 = w.upstream.calls.find((c) => c.url.startsWith(GW_O) && c.body.messages.some((m) => m.role === "tool")).body;
    assert.equal(o2.messages.find((m) => m.role === "tool").tool_call_id, "call_read_1");
    assert.equal(w.db.ledger.length, 4);
  });
});

describe("⑧-6 킬스위치는 진행 중인 빌드도 멈춘다", () => {
  it("★[결함 6] BUILD_ENABLED=off: 프록시 503 build_disabled(업스트림 0·재시도 금지) · 잡 failed(그 단계) · 진행 콜백 transitioned:false · 실패 보고는 받는다", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const w = await proxyWorld({
      jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "implementing" }), jobRow({ id: "bj_bbbbbbbbbb", status: "scaffolding" }), jobRow({ id: "bj_cccccccccc", status: "building" })],
      extra: { BUILD_ENABLED: "off" },
    });
    const tokA = await mint(w.env, "bj_aaaaaaaaaa");
    const a = await postJson(w.app, w.env, PA, anthropicReq(), { "x-api-key": tokA });
    assert.equal(a.status, 503, JSON.stringify(a.body));
    assert.equal(a.body.error.type, "build_disabled");
    assert.equal(a.headers.get("x-should-retry"), "false");
    assert.notEqual((await postJson(w.app, w.env, PO, openAiReq(), bearer(tokA))).status, 200);
    assert.equal(w.upstream.calls.length, 0, "no LLM spend once the switch is off");
    assert.deepEqual([w.db.jobs[0].status, w.db.jobs[0].failed_stage, w.db.jobs[0].error], ["failed", "implementing", "build_disabled"]);

    const tokB = await mint(w.env, "bj_bbbbbbbbbb");
    const p = await postJson(w.app, w.env, "/internal/build-progress", { jobId: "bj_bbbbbbbbbb", status: "implementing", message: "wbs_started" }, bearer(tokB));
    assert.equal(p.status, 200);
    assert.equal(p.body.transitioned, false, "the container stops on transitioned:false");
    assert.deepEqual([w.db.jobs[1].status, w.db.jobs[1].failed_stage, w.db.jobs[1].error], ["failed", "scaffolding", "build_disabled"]);

    const tokC = await mint(w.env, "bj_cccccccccc");
    const d = await postJson(w.app, w.env, "/internal/build-done", { jobId: "bj_cccccccccc", ok: false, failedStage: "building", error: "빌드 실패 — 한글 오류" }, bearer(tokC));
    assert.equal(d.body.accepted, true, "a failure report is never dropped");
    assert.equal(w.db.jobs[2].error, "빌드 실패 — 한글 오류");
  });
});

describe("⑧-7 끝난 잡의 토큰은 아무것도 남기지 못한다 · 이벤트는 잡당 상한", () => {
  it("★[결함 7] failed 잡에 progress 5번(500자·3,000자 meta) + done 1번 → transitioned:false·accepted:false, 이벤트 0 · 첫 실패 사유 유지", async () => {
    assert.ok(tokenMod, "build-job-token module");
    const db = makeDb({ jobs: [jobRow({ id: "bj_aaaaaaaaaa", status: "failed", failed_stage: "implementing", error: "budget_exhausted" })] });
    const env = envFor(db);
    const app = createApp();
    const tok = await mint(env, "bj_aaaaaaaaaa");
    for (let i = 0; i < 5; i++) {
      const r = await postJson(app, env, "/internal/build-progress", { jobId: "bj_aaaaaaaaaa", status: "implementing", message: "가".repeat(500), meta: { pad: "나".repeat(3_000) } }, bearer(tok));
      assert.equal(r.body.transitioned, false);
    }
    const d = await postJson(app, env, "/internal/build-done", { jobId: "bj_aaaaaaaaaa", ok: false, failedStage: "building", error: "늦게 온 실패" }, bearer(tok));
    assert.equal(d.body.accepted, false);
    assert.equal(db.events.length, 0, "a finished job's token adds no timeline rows");
    assert.equal(db.jobs[0].error, "budget_exhausted");
  });

  it("[결함 7] 진행 중 잡도 이벤트는 잡당 BUILD_JOB_EVENT_CAP까지 — 실제 SQLite(0068)", { skip: noSqlite }, async () => {
    assert.equal(typeof buildDb.BUILD_JOB_EVENT_CAP, "number", "BUILD_JOB_EVENT_CAP export");
    const cap = buildDb.BUILD_JOB_EVENT_CAP;
    assert.ok(cap >= 120 * 2 + 20, "room for the largest spec (120 WBS × started/done + stage events)");
    const sqlite = fresh();
    const env = { DB: d1Over(sqlite) };
    const job = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-3f9a1c2b", wbsTotal: 1 });
    const other = await buildDb.insertQueuedBuildJob(env, { projectId: PROJECT, userKey: USER, slug: "app-other", wbsTotal: 1 });
    const results = [];
    for (let i = 0; i < cap + 5; i++) results.push(await buildDb.appendBuildJobEvent(env, job.id, "implementing", `진행 ${i}`));
    const count = (id) => sqlite.prepare("SELECT COUNT(*) AS n FROM build_job_events WHERE job_id = ?").get(id).n;
    assert.equal(count(job.id), cap);
    assert.deepEqual(results.slice(-5), [false, false, false, false, false]);
    assert.equal(await buildDb.appendBuildJobEvent(env, other.id, "queued", "다른 잡은 따로 센다"), true);
    assert.equal(count(other.id), 1);
  });
});

/**
 * Train L — L-3 D1 사용량 원장(llm_usage) + 컨테이너 콜백 usage[] + Worker 호출 지점 배선.
 *
 * 고정하는 계약:
 *   ① 0070은 CREATE TABLE IF NOT EXISTS llm_usage + CREATE INDEX IF NOT EXISTS만(파괴적 문장 0)
 *   ② central-plane 가격표 = agent-worker 가격표(의도적 복제 — 표류하면 원가가 두 개가 된다)
 *   ③ recordLlmUsage: userKey는 sha256 해시로만 저장, 비용은 실응답 모델 단가, 미지 모델 unpriced=1,
 *      **fail-open**(기록 실패가 요청을 깨지 않고 console.error 한 줄 JSON)
 *   ④ 콜백 usage[]: Zod 검증 — 잘못된 값은 400이 아니라 **무시하고 본 처리 진행**, 201개는 200개로 자름
 *   ⑤ build-progress·build-done·repair-done이 usage[]를 원장에 기록 — project/user는 **잡 행에서**(콜백 본문 아님)
 *   ⑥ Worker 호출 지점(generate·check+verify-panel·council·dev_spec)이 원장에 기록 — 파싱 실패여도(비용은 났다),
 *      남의 프로젝트 id를 대면 project_id는 기록하지 않는다(교차 테넌트)
 *   ⑦ 수리 컨테이너가 워커 usage를 모아 repair-done 콜백에 싣는다(코드 불변식)
 * 네트워크 0: fetch 교체·가짜 D1.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0070_llm_usage.sql");

const { createApp } = await import("../dist/router.js");
const { __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");

const TOKEN = "tok_internal_test";
const USER = "uk_빵집사장님";
const OTHER_USER = "uk_옆집";
const PROJECT = "wsp_bakery1";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const LEDGER_COLS = [
  "id", "created_at", "job_kind", "job_id", "project_id", "user_key_hash", "vendor", "model_requested", "model_actual", "call_site",
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "cost_usd", "unpriced", "latency_ms", "container_seconds",
];

/** 관대한 가짜 D1: llm_usage INSERT는 행으로 모으고, 잡·프로젝트 조회만 흉내낸다. 나머지는 성공. */
function makeDb({ buildJobs = [], repairJobs = [], projects = new Map(), failLedger = false, paidUsers = [] } = {}) {
  const ledger = [];
  const writes = [];
  function handler(sql, args) {
    return {
      async run() {
        if (sql.includes("INSERT INTO llm_usage")) {
          if (failLedger) throw new Error("D1_ERROR: no such table: llm_usage");
          assert.equal(args.length, LEDGER_COLS.length, "INSERT 바인딩 수 = 컬럼 수");
          ledger.push(Object.fromEntries(LEDGER_COLS.map((c, i) => [c, args[i]])));
          return { meta: { changes: 1 } };
        }
        writes.push(sql);
        return { meta: { changes: 1 } };
      },
      async first() {
        if (sql.includes("FROM build_jobs WHERE id = ?")) return buildJobs.find((j) => j.id === args[0]) ?? null;
        if (sql.includes("FROM workspace_repair_jobs WHERE id = ?")) return repairJobs.find((j) => j.id === args[0]) ?? null;
        if (sql.includes("FROM workspace_projects WHERE id = ?")) return projects.get(args[0]) ?? null;
        if (sql.includes("FROM plan_grants")) return paidUsers.includes(args[0]) ? { plan: "paid" } : null;
        return null;
      },
      async all() { return { results: [] }; },
    };
  }
  return {
    ledger, writes,
    prepare(sql) {
      return { bind: (...a) => handler(sql, a), run: () => handler(sql, []).run(), first: () => handler(sql, []).first(), all: () => handler(sql, []).all() };
    },
  };
}

const buildJobRow = (o = {}) => ({
  id: "bj_1", project_id: PROJECT, user_key: USER, slug: "app-bakery", status: "implementing", failed_stage: null, error: null,
  wbs_done: 0, wbs_total: 2, budget_usd: 10, spent_usd: 0, d1_id: null, repo_full_name: null, commit_sha: null, deployed_url: null,
  build_exit_code: null, locale: "ko", created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z", ...o,
});
const repairJobRow = (o = {}) => ({
  id: "wrj_1", project_id: PROJECT, user_key: USER, visual_check_id: "vc_1", repo_full_name: "someone/빵집-app", status: "running",
  branch_name: "fix/simsa-vc_1", pr_url: null, pr_number: null, env_cause: 0, mode: null, changed_files: null, error: null,
  region: "KR", verify_check_id: null, resolved: null, created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z", ...o,
});
const projectRow = (o = {}) => ({
  id: PROJECT, user_key: USER, title: "동네 빵집 픽업 예약", idea: "빵을 미리 예약하고 픽업", understood_json: "{}",
  product_spec_json: JSON.stringify({ productName: "동네 빵집 픽업 예약", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: [], userFlow: [], decisions: [], openQuestions: [] }),
  items_json: JSON.stringify([{ title: "빵 목록", criteria: ["목록이 보인다", "품절 표시"] }]),
  built_with_json: null, entry_path: "idea", topic_tags_json: "[]", acquisition_json: null, dev_spec_json: null, region_at_create: "KR",
  created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z", ...o,
});

const usageItem = (o = {}) => ({
  vendor: "openai", modelRequested: "claude-sonnet-4-6", modelActual: "gpt-5.4-2026-03-05",
  inputTokens: 1_000, cacheReadTokens: 800, cacheWriteTokens: 0, outputTokens: 500, latencyMs: 2_900, ...o,
});

/** 프로덕션처럼 ExecutionContext를 주고, 응답 뒤 waitUntil 작업(원장 기록·Langfuse)을 끝까지 기다린다. */
async function post(app, env, path, body, headers = {}) {
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {}, props: {} };
  const res = await app.fetch(new Request(`https://cp.example${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
  const json = await res.json();
  await Promise.all(pending);
  return { status: res.status, body: json };
}
const AUTH = { authorization: `Bearer ${TOKEN}` };
async function quiet(fn) {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}
async function withFetch(f, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `expected ${b}, got ${a}`);

// ─── ① 0070 형태 ────────────────────────────────────────────────────────────────

describe("① 0070_llm_usage.sql 형태", () => {
  const code = () => readFileSync(MIGRATION, "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  it("CREATE TABLE IF NOT EXISTS llm_usage + CREATE INDEX IF NOT EXISTS만 — 파괴적 문장 0", () => {
    assert.ok(existsSync(MIGRATION), "0070_llm_usage.sql이 있어야 한다");
    const statements = code().split(";").map((s) => s.trim()).filter(Boolean);
    assert.equal(statements.filter((s) => /^CREATE TABLE IF NOT EXISTS llm_usage\b/.test(s)).length, 1);
    for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, `허용되지 않는 문장: ${s.slice(0, 80)}`);
    assert.doesNotMatch(code(), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER)\b/i);
  });

  it("컬럼 집합·job_kind CHECK·인덱스(job_kind, created_at)·(job_id)", () => {
    const c = code();
    for (const col of LEDGER_COLS) assert.match(c, new RegExp(`\\b${col}\\b`), `컬럼 ${col}`);
    assert.doesNotMatch(c, /\buser_key\s+TEXT/, "원본 user_key 컬럼은 없다(해시만)");
    assert.match(c, /job_kind TEXT NOT NULL CHECK \(job_kind IN \('generate','dev_spec','check','council','repair','build','inspection','other'\)\)/);
    assert.match(c, /CREATE INDEX IF NOT EXISTS \w+ ON llm_usage\s*\(job_kind, created_at\)/);
    assert.match(c, /CREATE INDEX IF NOT EXISTS \w+ ON llm_usage\s*\(job_id\)/);
    const numbered = readdirSync(join(here, "..", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    assert.equal(numbered.filter((f) => f.startsWith("0070_")).length, 1, "0070은 하나");
  });
});

// ─── ② 가격표 동일성 ─────────────────────────────────────────────────────────────

describe("② central-plane 가격표 = agent-worker 가격표", () => {
  it("LLM_PRICING·CONSERVATIVE_PRICING이 packages/agent-worker/dist/pricing.js와 같다", async () => {
    const cp = await import("../dist/workspace/llm-pricing.js");
    const aw = await import("../../../packages/agent-worker/dist/pricing.js");
    assert.deepEqual(JSON.parse(JSON.stringify(cp.LLM_PRICING)), JSON.parse(JSON.stringify(aw.PRICING)));
    assert.deepEqual({ ...cp.CONSERVATIVE_PRICING }, { ...aw.CONSERVATIVE_PRICING });
    for (const m of ["gpt-5.4-2026-03-05", "claude-haiku-4-5-20251001", "mystery-9"]) {
      const u = { inputTokens: 1234, cacheReadTokens: 800, cacheWriteTokens: 50, outputTokens: 321 };
      const a = cp.priceTokens(m, u);
      const b = aw.priceUsage(m, { inputTokens: u.inputTokens, cacheReadTokens: u.cacheReadTokens, cacheCreationTokens: u.cacheWriteTokens, outputTokens: u.outputTokens });
      near(a.costUsd, b.costUsd);
      assert.equal(a.unpriced, b.unpriced);
    }
  });
});

// ─── ③ recordLlmUsage ───────────────────────────────────────────────────────────

describe("③ recordLlmUsage — 해시·실응답 단가·fail-open", () => {
  it("userKey는 sha256으로만, 비용은 실응답 gpt-5.4 단가(캐시 포함), unpriced=0", async () => {
    const { recordLlmUsage } = await import("../dist/workspace/llm-usage.js");
    const db = makeDb();
    const ok = await recordLlmUsage({ DB: db }, {
      jobKind: "check", jobId: "chk_1", projectId: PROJECT, userKey: USER,
      vendor: "openai", modelRequested: "claude-haiku-4-5-20251001", modelActual: "gpt-5.4-2026-03-05",
      inputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0, outputTokens: 50, latencyMs: 1500, callSite: "check",
    });
    assert.equal(ok, true);
    const [row] = db.ledger;
    assert.equal(row.user_key_hash, sha(USER));
    assert.ok(!Object.values(row).some((v) => typeof v === "string" && v.includes("빵집사장님")), "원본 userKey가 어디에도 없다");
    assert.equal(row.job_kind, "check");
    assert.equal(row.model_requested, "claude-haiku-4-5-20251001");
    assert.equal(row.model_actual, "gpt-5.4-2026-03-05");
    assert.equal(row.call_site, "check");
    near(row.cost_usd, (200 * 2.5 + 800 * 0.25 + 50 * 15) / 1_000_000);
    assert.equal(row.unpriced, 0);
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row.id, /^lu_/);
  });

  it("미지 모델 → 보수 단가 + unpriced=1 (조용한 $0 금지)", async () => {
    const { recordLlmUsage } = await import("../dist/workspace/llm-usage.js");
    const db = makeDb();
    await recordLlmUsage({ DB: db }, { jobKind: "council", vendor: "google", modelRequested: "gemini-2.5-flash", modelActual: "gemini-2.5-flash", inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, latencyMs: 1 });
    assert.equal(db.ledger[0].unpriced, 1);
    near(db.ledger[0].cost_usd, 5);
    assert.equal(db.ledger[0].user_key_hash, null);
  });

  it("★fail-open: 기록 실패는 false를 돌려주고 던지지 않으며 console.error 한 줄 JSON", async () => {
    const { recordLlmUsage, recordLlmUsageBatch } = await import("../dist/workspace/llm-usage.js");
    const errs = [];
    const orig = console.error;
    console.error = (...a) => errs.push(a);
    try {
      const ok = await recordLlmUsage({ DB: makeDb({ failLedger: true }) }, { jobKind: "generate", vendor: "openai", modelRequested: "a", modelActual: "gpt-5.4", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, latencyMs: 1 });
      assert.equal(ok, false);
      const r = await recordLlmUsageBatch({ DB: makeDb({ failLedger: true }) }, [{ jobKind: "build", vendor: "openai", modelRequested: "a", modelActual: "gpt-5.4", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, latencyMs: 1 }]);
      assert.deepEqual(r, { written: 0, failed: 1 });
      const dbThrows = { prepare() { throw new Error("DB binding missing"); } };
      assert.equal(await recordLlmUsage({ DB: dbThrows }, { jobKind: "other", vendor: "x", modelRequested: "x", modelActual: "x", inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, latencyMs: 0 }), false);
    } finally {
      console.error = orig;
    }
    assert.ok(errs.length >= 3);
    for (const e of errs) {
      assert.equal(e.length, 1, "한 인자(한 줄) — tail에서 잘리지 않게");
      const j = JSON.parse(e[0]);
      assert.equal(j.event, "llm_usage_record_failed");
    }
  });
});

// ─── ④ 콜백 usage[] 파서 ─────────────────────────────────────────────────────────

describe("④ parseCallbackUsage — 무시하고 진행, 200개 상한", () => {
  it("없음/배열 아님/잘못된 항목은 버리고, 201개는 200개로 자른다", async () => {
    const { parseCallbackUsage, CALLBACK_USAGE_MAX } = await import("../dist/workspace/llm-usage.js");
    assert.equal(CALLBACK_USAGE_MAX, 200);
    assert.deepEqual(parseCallbackUsage(undefined), { items: [], dropped: 0, truncated: 0 });
    assert.deepEqual(parseCallbackUsage("nope"), { items: [], dropped: 1, truncated: 0 });
    const mixed = parseCallbackUsage([usageItem(), { vendor: "openai" }, usageItem({ inputTokens: -5 }), usageItem({ modelActual: "" }), null, usageItem({ vendor: "anthropic", modelActual: "claude-sonnet-4-6" })]);
    assert.equal(mixed.items.length, 2);
    assert.equal(mixed.dropped, 4);
    assert.equal(mixed.items[1].vendor, "anthropic");
    const many = parseCallbackUsage(Array.from({ length: 201 }, () => usageItem()));
    assert.equal(many.items.length, 200);
    assert.equal(many.truncated, 1);
  });
});

// ─── ⑤ 컨테이너 콜백 ────────────────────────────────────────────────────────────

describe("⑤ 콜백 usage[] → 원장 (project/user는 잡 행에서)", () => {
  it("★build-progress: usage[] 2건 → job_kind build 2행, project·user는 D1 잡 행 기준(본문 위조 무시)", async () => {
    const db = makeDb({ buildJobs: [buildJobRow()] });
    const r = await post(createApp(), { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/build-progress", {
      jobId: "bj_1", status: "implementing", wbsDone: 1, projectId: "wsp_forged", userKey: OTHER_USER,
      usage: [usageItem(), usageItem({ vendor: "anthropic", modelActual: "claude-sonnet-4-6", cacheReadTokens: 0 })],
    }, AUTH);
    assert.equal(r.status, 200);
    assert.equal(r.body.transitioned, true);
    assert.equal(db.ledger.length, 2);
    for (const row of db.ledger) {
      assert.equal(row.job_kind, "build");
      assert.equal(row.job_id, "bj_1");
      assert.equal(row.project_id, PROJECT);
      assert.equal(row.user_key_hash, sha(USER));
    }
    near(db.ledger[0].cost_usd, (1_000 * 2.5 + 800 * 0.25 + 500 * 15) / 1_000_000);
  });

  it("★잘못된 usage는 400이 아니다 — 무시하고 본 처리(상태 전이) 진행", async () => {
    const db = makeDb({ buildJobs: [buildJobRow()] });
    const r = await post(createApp(), { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/build-progress", { jobId: "bj_1", status: "building", usage: "not-an-array" }, AUTH);
    assert.equal(r.status, 200);
    assert.equal(r.body.transitioned, true);
    assert.equal(db.ledger.length, 0);
  });

  it("build-done: 201건 → 200행, 모르는 잡이면 원장 0행", async () => {
    const db = makeDb({ buildJobs: [buildJobRow()] });
    const app = createApp();
    const env = { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN };
    const r = await post(app, env, "/internal/build-done", { jobId: "bj_1", ok: false, failedStage: "budget", error: "예산 초과", spentUsd: 10.2, usage: Array.from({ length: 201 }, () => usageItem()) }, AUTH);
    assert.equal(r.status, 200);
    assert.equal(db.ledger.length, 200);
    const db2 = makeDb();
    await post(app, { DB: db2, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/build-done", { jobId: "bj_ghost", ok: false, error: "x", usage: [usageItem()] }, AUTH);
    assert.equal(db2.ledger.length, 0);
  });

  it("토큰 없으면 401 — 원장에 쓰지 않는다", async () => {
    const db = makeDb({ buildJobs: [buildJobRow()] });
    const r = await post(createApp(), { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/build-progress", { jobId: "bj_1", status: "building", usage: [usageItem()] });
    assert.equal(r.status, 401);
    assert.equal(db.ledger.length, 0);
  });

  it("★repair-done: usage[] → job_kind repair 행 + 컨테이너 초 행(durationMs), 404 잡은 0행", async () => {
    const db = makeDb({ repairJobs: [repairJobRow()] });
    const app = createApp();
    const env = { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN };
    const r = await post(app, env, "/internal/repair-done", {
      jobId: "wrj_1", ok: true, prUrl: "https://github.com/someone/app/pull/3", prNumber: 3, branch: "fix/simsa-vc_1", mode: "auto_fix", changedFiles: 1, durationMs: 42_000,
      usage: [usageItem({ modelRequested: "claude-sonnet-4-6" }), usageItem({ inputTokens: 10 })],
    }, AUTH);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "done");
    const llm = db.ledger.filter((x) => x.model_actual !== "container");
    const container = db.ledger.filter((x) => x.model_actual === "container");
    assert.equal(llm.length, 2);
    assert.ok(llm.every((x) => x.job_kind === "repair" && x.job_id === "wrj_1" && x.project_id === PROJECT && x.user_key_hash === sha(USER)));
    assert.equal(container.length, 1);
    assert.equal(container[0].container_seconds, 42);
    assert.equal(container[0].vendor, "cloudflare");
    assert.equal(container[0].unpriced, 1, "컨테이너 시간은 아직 단가 없음 — 0달러를 확정 원가로 보이지 않게");
    assert.equal(container[0].cost_usd, 0);

    const db2 = makeDb();
    const r2 = await post(app, { DB: db2, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/repair-done", { jobId: "wrj_ghost", ok: true, usage: [usageItem()] }, AUTH);
    assert.equal(r2.status, 404);
    assert.equal(db2.ledger.length, 0);
  });

  it("repair-done 실패 경로도 usage를 기록하고, 원장 장애여도 본 처리는 200", async () => {
    const db = makeDb({ repairJobs: [repairJobRow()] });
    const r = await post(createApp(), { DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/repair-done", { jobId: "wrj_1", ok: false, error: "worker_call_failed", usage: [usageItem()] }, AUTH);
    assert.equal(r.body.status, "failed");
    assert.equal(db.ledger.length, 1);
    const broken = makeDb({ repairJobs: [repairJobRow()], failLedger: true });
    const r2 = await quiet(() => post(createApp(), { DB: broken, INTERNAL_CALLBACK_TOKEN: TOKEN }, "/internal/repair-done", { jobId: "wrj_1", ok: true, mode: "brief_only", usage: [usageItem()] }, AUTH));
    assert.equal(r2.status, 200);
    assert.equal(r2.body.status, "done");
  });
});

// ─── ⑥ Worker 호출 지점 ─────────────────────────────────────────────────────────

const isOpenAi = (url) => String(url).includes("/chat/completions");
const openAiReply = (content) =>
  new Response(JSON.stringify({ model: "gpt-5.4-2026-03-05", choices: [{ message: { content } }], usage: { prompt_tokens: 1_000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } } }), { status: 200 });
const LLM_ENV = {
  INTERNAL_CALLBACK_TOKEN: TOKEN, ANTHROPIC_API_KEY: "test-anthropic-key", OPENAI_API_KEY: "test-openai-key", ANTHROPIC_ENABLED: "off",
  CF_AI_GATEWAY_ANTHROPIC_URL: "https://gw.example/anthropic", CF_AI_GATEWAY_OPENAI_URL: "https://gw.example/openai",
};
/** 검수 프롬프트엔 failed 1건, 2차 확인엔 supported:true. */
async function checkFetch(url, init) {
  if (!isOpenAi(url)) return new Response("{}", { status: 403 });
  const body = JSON.parse(init.body);
  const prompt = body.messages.map((m) => m.content).join("\n");
  if (prompt.includes("INDEPENDENT second reviewer")) return openAiReply(JSON.stringify({ supported: true, note_ko: "동의" }));
  return openAiReply(JSON.stringify({ results: [{ itemId: "req_001", status: "failed", userLabel: "안 맞음", reason: "결제는 제외 범위", evidence: ["결제"], nextAction: "빼기" }] }));
}
const CHECK_BODY = {
  productSpec: { productName: "동네 빵집", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
  items: [{ id: "req_001", title: "결제", criteria: ["카드 결제", "영수증"] }],
  userKey: USER,
  locale: "ko",
};

describe("⑥ Worker 호출 지점 → 원장", () => {
  it("★check-draft: 검수 1 + 검증 패널 1 = job_kind check 2행, 같은 job_id, 실응답 모델", async () => {
    __resetAnthropicBreaker();
    const db = makeDb();
    const r = await quiet(() => withFetch(checkFetch, () => post(createApp(), { ...LLM_ENV, DB: db }, "/workspace/check-draft", CHECK_BODY)));
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assert.equal(db.ledger.length, 2);
    assert.ok(db.ledger.every((x) => x.job_kind === "check"));
    assert.equal(new Set(db.ledger.map((x) => x.job_id)).size, 1);
    assert.deepEqual(db.ledger.map((x) => x.call_site).sort(), ["check", "verify-panel"]);
    assert.ok(db.ledger.every((x) => x.model_actual === "gpt-5.4-2026-03-05" && x.user_key_hash === sha(USER) && x.project_id === null));
    assert.equal(db.ledger.find((x) => x.call_site === "check").model_requested, "claude-haiku-4-5-20251001");
  });

  it("★교차 테넌트: 남의 프로젝트 id를 대면 원장에 project_id를 남기지 않는다", async () => {
    __resetAnthropicBreaker();
    const db = makeDb({ projects: new Map([[PROJECT, projectRow({ user_key: OTHER_USER })]]) });
    const r = await quiet(() => withFetch(checkFetch, () => post(createApp(), { ...LLM_ENV, DB: db }, "/workspace/check-draft", { ...CHECK_BODY, projectId: PROJECT })));
    assert.equal(r.status, 200);
    assert.ok(db.ledger.length > 0);
    assert.ok(db.ledger.every((x) => x.project_id === null));
    const db2 = makeDb({ projects: new Map([[PROJECT, projectRow()]]) });
    await quiet(() => withFetch(checkFetch, () => post(createApp(), { ...LLM_ENV, DB: db2 }, "/workspace/check-draft", { ...CHECK_BODY, projectId: PROJECT })));
    assert.ok(db2.ledger.every((x) => x.project_id === PROJECT), "본인 프로젝트면 기록");
  });

  it("idea-to-spec-draft: LLM 응답이 JSON이 아니어서 503이어도 원장 1행(비용은 났다)", async () => {
    __resetAnthropicBreaker();
    const db = makeDb();
    const r = await quiet(() => withFetch(async (url) => (isOpenAi(url) ? openAiReply("JSON 아님") : new Response("{}", { status: 403 })), () =>
      post(createApp(), { ...LLM_ENV, DB: db }, "/workspace/idea-to-spec-draft", { idea: "동네 빵집 픽업 예약", userKey: USER, locale: "ko" })));
    assert.equal(r.status, 503);
    assert.equal(db.ledger.length, 1);
    assert.equal(db.ledger[0].job_kind, "generate");
    assert.equal(db.ledger[0].model_requested, "claude-haiku-4-5-20251001");
    assert.equal(db.ledger[0].model_actual, "gpt-5.4-2026-03-05");
  });

  it("dev-spec generate: 패스 재시도 2회가 job_kind dev_spec 2행(422여도), project_id = 소유 프로젝트", async () => {
    __resetAnthropicBreaker();
    const db = makeDb({ projects: new Map([[PROJECT, projectRow()]]) });
    const r = await quiet(() => withFetch(async (url) => (isOpenAi(url) ? openAiReply("JSON 아님") : new Response("{}", { status: 403 })), () =>
      post(createApp(), { ...LLM_ENV, DB: db }, `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" })));
    assert.equal(r.status, 422);
    assert.equal(db.ledger.length, 2);
    assert.ok(db.ledger.every((x) => x.job_kind === "dev_spec" && x.project_id === PROJECT && x.call_site === "dev-spec" && x.model_requested === "claude-opus-5"));
  });

  it("council 모드(유료): 참여 벤더 3개 호출이 job_kind council로 기록, 미지 gemini 단가는 unpriced", async () => {
    __resetAnthropicBreaker();
    const db = makeDb({ paidUsers: [USER] });
    const env = { ...LLM_ENV, DB: db, GEMINI_API_KEY: "test-gemini-key" };
    const verdicts = JSON.stringify({ results: [{ itemId: "req_001", status: "passed", reason: "ok", evidence: [], nextAction: "" }] });
    const fetchStub = async (url) => {
      if (isOpenAi(url)) return openAiReply(verdicts);
      if (String(url).includes("generateContent")) return new Response(JSON.stringify({ modelVersion: "gemini-2.5-flash", candidates: [{ content: { parts: [{ text: verdicts }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
      return new Response(JSON.stringify({ model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: verdicts }], usage: { input_tokens: 3, output_tokens: 4 } }), { status: 200 });
    };
    const r = await quiet(() => withFetch(fetchStub, () => post(createApp(), env, "/workspace/check-draft", { ...CHECK_BODY, reviewMode: "council" })));
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assert.equal(db.ledger.length, 3);
    assert.ok(db.ledger.every((x) => x.job_kind === "council" && x.call_site === "council-round1"));
    assert.deepEqual(db.ledger.map((x) => x.vendor).sort(), ["anthropic", "google", "openai"]);
    assert.equal(db.ledger.find((x) => x.vendor === "google").unpriced, 1, "gemini는 가격표에 없다 → 보수 단가 + unpriced");
    // 무료 플랜은 402 — 호출이 없으니 원장도 0행.
    const db2 = makeDb();
    const r2 = await quiet(() => withFetch(fetchStub, () => post(createApp(), { ...env, DB: db2 }, "/workspace/check-draft", { ...CHECK_BODY, reviewMode: "council" })));
    assert.equal(r2.status, 402);
    assert.equal(db2.ledger.length, 0);
  });
});

// ─── ⑦ 수리 컨테이너 ────────────────────────────────────────────────────────────

describe("⑦ 수리 컨테이너 — 워커 usage를 모아 repair-done에 싣는다", () => {
  it("coerce-result.createUsageCollector: 콜백 계약 8필드로 변환, 200개 상한, 싱크가 던지지 않음", async () => {
    const { createUsageCollector } = await import("../container/coerce-result.mjs");
    const col = createUsageCollector();
    for (let i = 0; i < 205; i++) {
      col.onUsage({ vendor: "openai", modelRequested: "claude-sonnet-4-6", modelActual: "gpt-5.4", inputTokens: i, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, latencyMs: 10, costUsd: 0.1, unpriced: false });
    }
    col.onUsage(null);
    const snap = col.snapshot();
    assert.equal(snap.length, 200);
    assert.deepEqual(Object.keys(snap[0]).sort(), ["cacheReadTokens", "cacheWriteTokens", "inputTokens", "latencyMs", "modelActual", "modelRequested", "outputTokens", "vendor"]);
    snap.pop();
    assert.equal(col.snapshot().length, 200, "snapshot은 사본");
  });

  it("server.mjs: ClaudeWorker에 onUsage를 넘기고 repair-done 콜백(성공·실패 모두)에 usage를 싣는다", () => {
    const src = readFileSync(join(here, "..", "container", "server.mjs"), "utf8");
    const runRepair = src.slice(src.indexOf("async function runRepairJob"), src.indexOf("// --- Stage 270: auto-fix executor"));
    assert.match(src, /new ClaudeWorker\(\{[\s\S]*?onUsage[\s\S]*?\}\)/, "ClaudeWorker({ onUsage })");
    assert.match(runRepair, /createUsageCollector\(\)/);
    const callbacks = [...runRepair.matchAll(/postCallback\(callbackUrl, callbackToken, \{([\s\S]*?)\}\);/g)].map((m) => m[1]);
    assert.equal(callbacks.length, 2, "성공·실패 콜백 두 개");
    for (const body of callbacks) assert.match(body, /usage: usage\.snapshot\(\)/);
  });
});

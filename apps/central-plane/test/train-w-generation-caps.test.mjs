/**
 * train-w-generation-caps.test.mjs — 비용 권고 ③ (2026-09-30, D-7 amend [PILOT]):
 * 생성·지시서 경로의 **서비스 전체** 일일 상한.
 *
 * 전에는 생성 계열(IP 시간당 20)·지시서(사용자 일 20)에 서비스 전체 천장이 없었다 — userKey는 익명이고
 * IP는 돌릴 수 있어서, 키·네트워크를 바꿔 가며 부르는 루프에 하루 원가 상한이 없었다.
 *
 * 계약:
 *   - 버킷 두 개(#561 consumeDailyCaps — 원자적 조건부 UPSERT·환급, #566 v1: 키):
 *       generation-daily-global  기본 500/일 — 아이디어 초안 · 스펙 검수(기본·협의체) · 추천 답변 ·
 *                                막힘 풀기 · 수정 제안 · 문서 초안 · 의도 추론
 *       dev-spec-daily-global    기본 200/일 — 개발 지시서 생성
 *     env BETA_GENERATION_DAILY_LIMIT_GLOBAL / BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL ([PILOT]).
 *   - 가득 차면 LLM을 부르지 않고 503 { ok:false, error:"generation_capacity", reason:"daily_capacity",
 *     resetAt } + Retry-After. (의도 추론은 그 라우트의 관례대로 200 { ok:true, inferred:null,
 *     reason:"generation_capacity", resetAt }.) 429가 아닌 이유: 이 사람이 다 쓴 게 아니다.
 *   - 슬롯은 검증·소유권·IP 시간당 한도를 통과한 뒤, LLM 직전에 잡는다.
 *   - 환급: 요청이 실패(5xx)로 끝났고 과금된 LLM 호출이 확인되지 않으면 돌려준다(벤더 장애 한 시간이
 *     오늘 용량을 태워 복구 뒤 "요청이 많아 멈췄어요"라고 거짓말하지 않게). 과금된 실패(응답은 왔는데
 *     파싱 실패 — #504 같은 사고)는 차감을 유지한다(비용 천장이 그 루프를 멈춰야 한다). 원장 수집기가
 *     없는 경로(추천·막힘·수정)는 과금을 알 수 없어 실패면 돌려준다.
 *
 * 네트워크 0: fetch 교체 · 가짜 D1(workspace_rate_limit은 _daily-caps-fake.mjs로 실제처럼).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");
const { __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");
const { serviceRateLimitKey } = await import("../dist/workspace/rate-limit-key.js");
const limits = await import("../dist/workspace/beta-limits.js");
const { dailyCapsRun } = await import("./_daily-caps-fake.mjs");

/** New module — each test fails on its own on old code. */
async function capacityModule() {
  const mod = await import("../dist/workspace/generation-capacity.js").catch(() => null);
  assert.ok(mod, "dist/workspace/generation-capacity.js must exist");
  return mod;
}

const USER = "uk_빵집사장님";
const PAID_USER = "uk_유료_꽃집";
const PROJECT = "wsp_bakery_cap";
const SOURCE_DOC = "psrc_doc_cap";
const SOURCE_SITE = "psrc_site_cap";
const DOC_KEY = `docs/${USER}/${PROJECT}/${SOURCE_DOC}/기획서 v2 (최종).md`;
const today = () => new Date().toISOString().slice(0, 10);

const projectRow = () => ({
  id: PROJECT, user_key: USER, title: "동네 빵집 픽업 예약", idea: "빵을 미리 예약하고 픽업",
  understood_json: "{}",
  product_spec_json: JSON.stringify({ productName: "동네 빵집 픽업 예약", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: [], userFlow: [], decisions: [], openQuestions: [] }),
  items_json: JSON.stringify([{ id: "req_001", title: "빵 목록", criteria: ["목록이 보인다"] }]),
  built_with_json: null, entry_path: "idea", topic_tags_json: "[]", acquisition_json: null, dev_spec_json: null,
  region_at_create: "KR", created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z",
});
const sourceRows = () => [
  { id: SOURCE_DOC, project_id: PROJECT, user_key: USER, type: "document", reference: DOC_KEY, label: "기획서 v2 (최종).md", content_type: "text/markdown", size_bytes: 900, created_at: "2026-09-28T00:00:00Z" },
  { id: SOURCE_SITE, project_id: PROJECT, user_key: USER, type: "website", reference: "https://bakery.example.app/", label: null, content_type: null, size_bytes: null, created_at: "2026-09-28T00:00:01Z" },
];
const DOC_TEXT = [
  "# 동네 빵집 픽업 예약 기획서",
  "손님이 오늘 구울 빵을 미리 보고 예약한 뒤, 정해진 시간에 매장에서 찾아간다.",
  "사장님은 품절과 픽업 시간을 직접 바꿀 수 있어야 한다. 결제는 매장에서 한다.",
].join("\n");

function makeDb() {
  const rate = new Map();
  const ledger = [];
  const handler = (sql, args) => ({
    async run() {
      const capped = dailyCapsRun(rate, sql, args);
      if (capped) return capped;
      if (sql.includes("INSERT INTO workspace_rate_limit")) {
        // hourly per-IP / per-user counters: insert-or-increment
        const k = `${args[0]}::${args[1]}`;
        rate.set(k, (rate.get(k) ?? 0) + 1);
        return { meta: { changes: 1 } };
      }
      if (sql.includes("INSERT INTO llm_usage")) {
        ledger.push(args);
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 1 } };
    },
    async first() {
      if (sql.includes("FROM workspace_rate_limit")) {
        const n = rate.get(`${args[0]}::${args[1]}`);
        return n === undefined ? null : { count: n };
      }
      if (sql.includes("FROM workspace_projects WHERE id = ?")) return args[0] === PROJECT ? projectRow() : null;
      if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) return sourceRows().find((s) => s.id === args[0]) ?? null;
      if (sql.includes("FROM plan_grants")) return args[0] === PAID_USER ? { plan: "paid" } : null;
      return null;
    },
    async all() {
      if (sql.includes("FROM project_sources")) return { results: sourceRows().filter((s) => s.project_id === args[0]) };
      return { results: [] };
    },
  });
  return {
    rate,
    ledger,
    prepare(sql) {
      return { bind: (...a) => handler(sql, a), run: () => handler(sql, []).run(), first: () => handler(sql, []).first(), all: () => handler(sql, []).all() };
    },
  };
}

function makeR2() {
  return {
    async get(key) {
      if (key !== DOC_KEY) return null;
      const bytes = new TextEncoder().encode(DOC_TEXT);
      return { body: bytes, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    async put() {},
    async delete() {},
  };
}

const LLM_ENV = {
  ANTHROPIC_API_KEY: "test-anthropic-key", OPENAI_API_KEY: "test-openai-key", ANTHROPIC_ENABLED: "off",
  CF_AI_GATEWAY_ANTHROPIC_URL: "https://gw.example/anthropic", CF_AI_GATEWAY_OPENAI_URL: "https://gw.example/openai",
  CONCLAVE_TOKEN_KEK: "dGVzdC1rZWstbm90LWEtcmVhbC1zZWNyZXQtMzItYnl0ZXM=",
};
const envWith = (db, vars = {}) => ({ ...LLM_ENV, DB: db, EVIDENCE: makeR2(), ...vars });

const isLlm = (url) => /chat\/completions|anthropic|generateContent/.test(String(url));
const openAiReply = (content) =>
  new Response(JSON.stringify({ model: "gpt-5.4-2026-03-05", choices: [{ message: { content } }], usage: { prompt_tokens: 1_000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } } }), { status: 200 });

/** fetch stub: records LLM calls; the website source gets a real-looking page. */
function stubFetch(llm) {
  const llmCalls = [];
  const f = async (url, init) => {
    if (String(url).startsWith("https://bakery.example.app")) {
      return new Response("<html><head><title>동네 빵집 픽업 예약</title></head><body>오늘 구운 빵을 미리 예약하고 매장에서 찾아가세요.</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (isLlm(url)) {
      llmCalls.push(String(url));
      return llm(url, init);
    }
    return new Response("not found", { status: 404 });
  };
  return { f, llmCalls };
}

async function call(env, method, path, body, fetchImpl, headers = {}) {
  const orig = globalThis.fetch;
  const o = { log: console.log, warn: console.warn, error: console.error };
  globalThis.fetch = fetchImpl;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {}, props: {} };
  try {
    __resetAnthropicBreaker();
    const res = await createApp().fetch(
      new Request(`https://cp.example${path}`, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
      ctx,
    );
    const json = await res.json().catch(() => null);
    await Promise.all(pending);
    return { status: res.status, json, headers: res.headers };
  } finally {
    globalThis.fetch = orig;
    Object.assign(console, o);
  }
}

async function serviceCount(db, bucket) {
  const hash = await serviceRateLimitKey(bucket, "all");
  return db.rate.get(`${hash}::${today()}`) ?? 0;
}

const CHECK_BODY = {
  productSpec: { productName: "동네 빵집", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
  items: [{ id: "req_001", title: "결제", criteria: ["카드 결제"] }],
  userKey: USER,
  locale: "ko",
};

/** Every generation-family route, with a body that passes its own validation. */
const GENERATION_ROUTES = [
  { name: "아이디어 초안", path: "/workspace/idea-to-spec-draft", body: { idea: "동네 빵집 픽업 예약 — 오늘 구운 빵을 미리 예약", userKey: USER, locale: "ko" } },
  { name: "스펙 검수(기본)", path: "/workspace/check-draft", body: CHECK_BODY },
  { name: "스펙 검수(협의체·유료)", path: "/workspace/check-draft", body: { ...CHECK_BODY, userKey: PAID_USER, reviewMode: "council" } },
  { name: "추천 답변", path: "/workspace/recommend-answer", body: { question: "통계를 며칠 보관할지", productName: "빵집 예약", userKey: USER, locale: "ko" } },
  { name: "막힘 풀기", path: "/workspace/unstick", body: { problemText: "배포하니 화면이 하얗게 나와요 (Error: 빵 목록을 불러오지 못함)", userKey: USER, locale: "ko" } },
  { name: "수정 제안", path: "/workspace/fix-suggestion", body: { item: { id: "req_001", title: "빵 목록", status: "failed", criteria: ["목록이 보인다"] }, checkResult: { reason: "목록이 비어 있음", evidence: ["빈 화면"], nextAction: "데이터 연결" }, productSpec: CHECK_BODY.productSpec, userKey: USER, locale: "ko" } },
  { name: "문서 초안", path: `/workspace/projects/${PROJECT}/sources/${SOURCE_DOC}/spec-draft`, body: { userKey: USER, locale: "ko" } },
];

// ─── 기본값 ────────────────────────────────────────────────────────────────────

describe("③ 기본값 [PILOT]", () => {
  it("생성 계열 500/일 · 지시서 200/일 · env로 조정 · 잘못된 값은 기본값", () => {
    assert.equal(typeof limits.generationDailyLimitGlobal, "function");
    assert.equal(typeof limits.devSpecDailyLimitGlobal, "function");
    assert.equal(limits.generationDailyLimitGlobal({}), 500);
    assert.equal(limits.devSpecDailyLimitGlobal({}), 200);
    assert.equal(limits.generationDailyLimitGlobal({ BETA_GENERATION_DAILY_LIMIT_GLOBAL: "40" }), 40);
    assert.equal(limits.devSpecDailyLimitGlobal({ BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL: "12" }), 12);
    assert.equal(limits.generationDailyLimitGlobal({ BETA_GENERATION_DAILY_LIMIT_GLOBAL: "0" }), 500);
    assert.equal(limits.devSpecDailyLimitGlobal({ BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL: "junk" }), 200);
  });
});

// ─── 가득 차면 LLM 0회 + 503 ─────────────────────────────────────────────────────

describe("③ 서비스 전체 버킷이 가득 차면 — LLM을 부르지 않고 정직한 503", () => {
  for (const r of GENERATION_ROUTES) {
    it(`${r.name}: 503 generation_capacity · reason daily_capacity · resetAt · Retry-After · LLM 0회`, async () => {
      const { takeGenerationSlot } = await capacityModule();
      const db = makeDb();
      const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
      const filler = await takeGenerationSlot(env, "generation");
      assert.equal(filler.limited, false, "the one slot of the day is taken by someone else");
      const s = stubFetch(async () => openAiReply("{}"));
      const res = await call(env, "POST", r.path, r.body, s.f);
      assert.equal(res.status, 503, JSON.stringify(res.json).slice(0, 200));
      assert.equal(res.json.ok, false);
      assert.equal(res.json.error, "generation_capacity");
      assert.equal(res.json.reason, "daily_capacity");
      assert.ok(!Number.isNaN(Date.parse(res.json.resetAt)), "resetAt = when capacity returns");
      const retryAfter = Number(res.headers.get("retry-after"));
      assert.ok(retryAfter >= 60 && retryAfter <= 86_400, `retry-after ${retryAfter}`);
      assert.deepEqual(s.llmCalls, [], "no LLM call when there is no capacity");
      assert.equal(await serviceCount(db, "generation-daily-global"), 1, "a refused request takes nothing");
    });
  }

  it("의도 추론: 이 라우트의 관례대로 200 { inferred:null, reason:generation_capacity, resetAt } · LLM 0회", async () => {
    const { takeGenerationSlot } = await capacityModule();
    const db = makeDb();
    const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
    await takeGenerationSlot(env, "generation");
    const s = stubFetch(async () => openAiReply("{}"));
    const res = await call(env, "POST", `/workspace/projects/${PROJECT}/infer-intent`, { userKey: USER, locale: "ko" }, s.f);
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.inferred, null);
    assert.equal(res.json.reason, "generation_capacity");
    assert.ok(!Number.isNaN(Date.parse(res.json.resetAt)));
    assert.deepEqual(s.llmCalls, []);
  });

  it("지시서: dev-spec 버킷이 가득 차면 503 generation_capacity · LLM 0회 · 사용자 일일 몫은 줄지 않는다", async () => {
    const { takeGenerationSlot } = await capacityModule();
    const db = makeDb();
    const env = envWith(db, { BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL: "1", BETA_PROJECT_CREATE_DAILY_LIMIT: "1" });
    await takeGenerationSlot(env, "dev_spec");
    const s = stubFetch(async () => openAiReply("{}"));
    const res = await call(env, "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s.f);
    assert.equal(res.status, 503);
    assert.equal(res.json.error, "generation_capacity");
    assert.equal(res.json.reason, "daily_capacity");
    assert.deepEqual(s.llmCalls, []);
    // Capacity returns (the [PILOT] number is raised): the user's own daily 1 is still there.
    const s2 = stubFetch(async () => openAiReply("JSON 아님"));
    const again = await call(envWith(db, { BETA_DEV_SPEC_DAILY_LIMIT_GLOBAL: "5", BETA_PROJECT_CREATE_DAILY_LIMIT: "1" }), "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s2.f);
    assert.notEqual(again.status, 429, "the refused request did not use up the user's daily dev-spec");
    assert.ok(s2.llmCalls.length > 0);
  });

  it("생성 계열과 지시서는 서로의 버킷을 쓰지 않는다", async () => {
    const { takeGenerationSlot } = await capacityModule();
    const db = makeDb();
    const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
    await takeGenerationSlot(env, "generation");
    const s = stubFetch(async () => openAiReply("JSON 아님"));
    const res = await call(env, "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s.f);
    assert.notEqual(res.status, 503);
    assert.ok(s.llmCalls.length > 0);
  });
});

// ─── 차감 위치·환급 ────────────────────────────────────────────────────────────

describe("③ 차감 위치와 환급", () => {
  it("검증 실패(400)는 슬롯을 잡지 않는다", async () => {
    const db = makeDb();
    const env = envWith(db);
    const s = stubFetch(async () => openAiReply("{}"));
    const res = await call(env, "POST", "/workspace/recommend-answer", { question: "   " }, s.f);
    assert.equal(res.status, 400);
    assert.equal(await serviceCount(db, "generation-daily-global"), 0);
  });

  it("성공은 차감 유지 (추천 답변 200 → 1)", async () => {
    const db = makeDb();
    const env = envWith(db);
    const s = stubFetch(async () => openAiReply('{ "recommendation": "30일", "reason": "무난한 기본", "options": ["7일", "30일"] }'));
    const res = await call(env, "POST", "/workspace/recommend-answer", GENERATION_ROUTES[3].body, s.f);
    assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 200));
    assert.equal(await serviceCount(db, "generation-daily-global"), 1);
  });

  it("과금 안 된 실패(벤더 장애 — LLM 응답 없음)는 환급 → 오늘 용량이 줄지 않는다", async () => {
    const db = makeDb();
    const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
    const down = stubFetch(async () => new Response("upstream down", { status: 503 }));
    const r1 = await call(env, "POST", "/workspace/idea-to-spec-draft", GENERATION_ROUTES[0].body, down.f);
    assert.equal(r1.status, 503);
    assert.equal(r1.json.error, "llm_unavailable");
    assert.equal(await serviceCount(db, "generation-daily-global"), 0, "an outage does not burn today's capacity");
    // After recovery the one slot is still there (not "too many requests").
    const up = stubFetch(async () => openAiReply("JSON 아님"));
    const r2 = await call(env, "POST", "/workspace/idea-to-spec-draft", GENERATION_ROUTES[0].body, up.f);
    assert.notEqual(r2.json?.error, "generation_capacity");
    assert.ok(up.llmCalls.length > 0);
  });

  it("과금된 실패(응답은 왔는데 파싱 실패 — #504류)는 차감 유지 → 그런 루프도 천장에서 멈춘다", async () => {
    const db = makeDb();
    const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
    const broken = stubFetch(async () => openAiReply("JSON 아님"));
    const r1 = await call(env, "POST", "/workspace/idea-to-spec-draft", GENERATION_ROUTES[0].body, broken.f);
    assert.equal(r1.status, 503);
    assert.equal(r1.json.error, "llm_unavailable");
    assert.equal(db.ledger.length, 1, "the call was billed (ledger row)");
    assert.equal(await serviceCount(db, "generation-daily-global"), 1, "billed → kept");
    const r2 = await call(env, "POST", "/workspace/idea-to-spec-draft", GENERATION_ROUTES[0].body, broken.f);
    assert.equal(r2.status, 503);
    assert.equal(r2.json.error, "generation_capacity");
    assert.equal(broken.llmCalls.length, 1, "the second attempt never reached the LLM");
  });

  it("원장 수집기가 없는 경로(추천)의 실패는 과금을 알 수 없어 환급", async () => {
    const db = makeDb();
    const env = envWith(db);
    const s = stubFetch(async () => openAiReply("추천을 드릴 수 없습니다"));
    const res = await call(env, "POST", "/workspace/recommend-answer", GENERATION_ROUTES[3].body, s.f);
    assert.equal(res.status, 503);
    assert.equal(await serviceCount(db, "generation-daily-global"), 0);
  });

  it("지시서: 사용자 일일 한도(429)에 막히면 서비스 슬롯을 돌려준다 · 422(과금된 실패)는 유지", async () => {
    const db = makeDb();
    const env = envWith(db, { BETA_PROJECT_CREATE_DAILY_LIMIT: "1" });
    const s = stubFetch(async () => openAiReply("JSON 아님"));
    const r1 = await call(env, "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s.f);
    assert.equal(r1.status, 422, JSON.stringify(r1.json).slice(0, 200));
    assert.equal(await serviceCount(db, "dev-spec-daily-global"), 1, "422 = the passes ran and were billed → kept");
    const calls = s.llmCalls.length;
    const r2 = await call(env, "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s.f);
    assert.equal(r2.status, 429);
    assert.equal(r2.json.error, "rate_limited");
    assert.equal(await serviceCount(db, "dev-spec-daily-global"), 1, "the user-capped request handed its service slot back");
    assert.equal(s.llmCalls.length, calls);
  });
});

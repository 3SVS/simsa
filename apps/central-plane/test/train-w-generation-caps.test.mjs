/**
 * train-w-generation-caps.test.mjs — 비용 권고 ③ (2026-09-30, D-7 amend [PILOT]):
 * 생성·지시서 경로의 **서비스 전체** 일일 상한.
 *
 * 전에는 생성 계열(IP 시간당 20)·지시서(사용자 일 20)에 서비스 전체 천장이 없었다 — userKey는 익명이고
 * IP는 돌릴 수 있어서, 키·네트워크를 바꿔 가며 부르는 루프에 하루 원가 상한이 없었다.
 *
 * 계약:
 *   - 종류마다 버킷 두 개, 이 순서로(#561 consumeDailyCaps — 원자적 조건부 UPSERT·환급, #566 v1: 키):
 *       네트워크 몫 → 서비스 전체
 *       generation-daily-ip 100 → generation-daily-global 500 — 아이디어 초안 · 스펙 검수(기본·협의체) ·
 *                                추천 답변 · 막힘 풀기 · 수정 제안 · 문서 초안 · 의도 추론 · PR 검토
 *       dev-spec-daily-ip    40 → dev-spec-daily-global   200 — 개발 지시서 생성
 *     env BETA_{GENERATION,DEV_SPEC}_DAILY_LIMIT_{PER_IP,GLOBAL} ([PILOT]).
 *   - 가득 차면 LLM을 부르지 않는다. 서비스 버킷 → 503 { ok:false, error:"generation_capacity",
 *     reason:"daily_capacity", scope:"service", resetAt } (이 사람이 다 쓴 게 아니다), 네트워크 몫 →
 *     429 { …, reason:"network_daily_limit", scope:"network" } (#561 패턴) + Retry-After. 의도 추론은
 *     그 라우트의 관례대로 200 { ok:true, inferred:null, reason:"generation_capacity", scope, resetAt }.
 *   - 슬롯은 검증·소유권·IP 시간당 한도를 통과한 뒤, LLM 직전에 잡는다.
 *   - 환급: 요청이 실패로 끝났고 과금된 LLM 호출(벤더가 답한 호출)이 없으면 돌려준다(벤더 장애 한 시간이
 *     오늘 용량을 태워 복구 뒤 "요청이 많아 멈췄어요"라고 거짓말하지 않게). 과금된 실패(응답은 왔는데
 *     파싱 실패 — #504 같은 사고)는 차감을 유지한다(비용 천장이 그 루프를 멈춰야 한다). PR #576 검증 뒤
 *     추천·막힘·수정·PR 검토도 사용량 싱크로 과금 여부를 센다(전에는 모름 → 환급이라 천장 밖이었다).
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

  // 의도된 변경 (#576 검증 P1-2): 전에는 "원장 수집기가 없는 경로(추천·막힘·수정)의 실패는 과금을 알 수
  // 없어 환급"이 스펙이었다 — 그래서 모델이 답했지만 JSON이 아닌 실패(과금됨)도 환급돼, 산문을 유도하는
  // 질문 + IP 교체로 천장 없이 과금 호출이 가능했다. 이제 세 생성기도 onUsage로 과금 여부를 알린다.
  for (const idx of [3, 4, 5]) {
    const r = GENERATION_ROUTES[idx];
    it(`${r.name}: 과금된 실패(모델이 산문으로 답함)는 차감 유지 → 다음 요청은 천장에서 LLM 0회`, async () => {
      const db = makeDb();
      const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
      const prose = stubFetch(async () => openAiReply("죄송하지만 이 질문에는 JSON으로 답할 수 없어요. 대신 설명을 드릴게요."));
      const r1 = await call(env, "POST", r.path, r.body, prose.f, { "cf-connecting-ip": "198.51.100.21" });
      assert.equal(r1.status, 503, JSON.stringify(r1.json).slice(0, 200));
      assert.equal(r1.json.error, "llm_unavailable");
      assert.equal(prose.llmCalls.length, 1, "the model answered once (billed)");
      assert.equal(await serviceCount(db, "generation-daily-global"), 1, "billed failure → the slot stays spent");
      // A new IP does not buy another billed call once the ceiling is reached.
      const r2 = await call(env, "POST", r.path, r.body, prose.f, { "cf-connecting-ip": "198.51.100.22" });
      assert.equal(r2.status, 503);
      assert.equal(r2.json.error, "generation_capacity");
      assert.equal(prose.llmCalls.length, 1, "no second billed call");
    });
  }

  it("행동 보존: 추천의 과금 안 된 실패(벤더 응답 없음)는 여전히 환급", async () => {
    const db = makeDb();
    const env = envWith(db);
    const down = stubFetch(async () => new Response("upstream down", { status: 503 }));
    const res = await call(env, "POST", "/workspace/recommend-answer", GENERATION_ROUTES[3].body, down.f);
    assert.equal(res.status, 503);
    assert.equal(res.json.error, "llm_unavailable");
    assert.equal(await serviceCount(db, "generation-daily-global"), 0);
  });

  it("지시서: 사용자 일일 한도(429)에 막히면 서비스 슬롯을 돌려준다 · 422(과금된 실패)는 유지", async () => {
    const db = makeDb();
    // D-24 T-4: the user's daily dev-spec quota is the tier's (free 2) — no env knob any more.
    const env = envWith(db);
    const s = stubFetch(async () => openAiReply("JSON 아님"));
    for (let i = 0; i < 2; i++) {
      const r = await call(env, "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s.f);
      assert.equal(r.status, 422, JSON.stringify(r.json).slice(0, 200));
    }
    assert.equal(await serviceCount(db, "dev-spec-daily-global"), 2, "422 = the passes ran and were billed → kept");
    const calls = s.llmCalls.length;
    const r2 = await call(env, "POST", `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }, s.f);
    assert.equal(r2.status, 429);
    assert.equal(r2.json.error, "rate_limited");
    assert.equal(r2.json.kind, "dev_spec");
    assert.equal(r2.json.tier, "free");
    assert.equal(r2.json.limit, 2);
    assert.match(r2.json.resetAt, /T00:00:00\.000Z$/);
    assert.equal(await serviceCount(db, "dev-spec-daily-global"), 2, "the user-capped request handed its service slot back");
    assert.equal(s.llmCalls.length, calls);
  });
});

// ─── 네트워크 몫 (#576 검증 P1-1 · P1-3) ────────────────────────────────────────
//
// 서비스 버킷 하나만 두면 클라이언트 하나가 그 버킷을 다 쓰고 모든 사용자의 생성 화면을 UTC 자정까지
// 잠글 수 있었다(제한기가 없는 의도 추론 한 경로만으로도, 또는 IP 시간당 한도가 읽기→증가라 동시 요청으로).
// #561 패턴 그대로: 같은 원자적 consume에 네트워크 버킷(cf-connecting-ip, v1: HMAC 키)을 서비스 버킷
// **앞에** 둔다. 네트워크 몫이 차면 429 { error:"generation_capacity", scope:"network" } — 서비스 슬롯은
// 차감하지 않는다(consumeDailyCaps가 앞 슬롯을 돌려준다).

async function networkCount(db, env, bucket, ip) {
  const { ipRateLimitKey } = await import("../dist/workspace/rate-limit-key.js");
  const hash = await ipRateLimitKey(env, bucket, ip);
  return db.rate.get(`${hash}::${today()}`) ?? 0;
}

describe("③ 네트워크 몫 — 한 클라이언트가 서비스 전체를 잠그지 못한다", () => {
  it("기본값 [PILOT]: 생성 네트워크 100/일 · 지시서 네트워크 40/일 · 어느 쪽도 서비스 상한의 절반 미만", () => {
    assert.equal(typeof limits.generationDailyLimitPerIp, "function", "beta-limits must export generationDailyLimitPerIp()");
    assert.equal(typeof limits.devSpecDailyLimitPerIp, "function", "beta-limits must export devSpecDailyLimitPerIp()");
    assert.equal(limits.generationDailyLimitPerIp({}), 100);
    assert.equal(limits.devSpecDailyLimitPerIp({}), 40);
    assert.equal(limits.generationDailyLimitPerIp({ BETA_GENERATION_DAILY_LIMIT_PER_IP: "7" }), 7);
    assert.equal(limits.devSpecDailyLimitPerIp({ BETA_DEV_SPEC_DAILY_LIMIT_PER_IP: "junk" }), 40);
    assert.ok(limits.generationDailyLimitPerIp({}) * 2 < limits.generationDailyLimitGlobal({}), "one network < half of the service bucket");
    assert.ok(limits.devSpecDailyLimitPerIp({}) * 2 < limits.devSpecDailyLimitGlobal({}), "one network < half of the service bucket");
  });

  it("★의도 추론만으로 같은 IP에서 35회 → 네트워크 몫(5)에서 멈추고, 다른 네트워크의 아이디어 초안은 그대로 된다", async () => {
    const db = makeDb();
    const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "30", BETA_GENERATION_DAILY_LIMIT_PER_IP: "5" });
    // Billed parse failures keep their slot — the attacker needs no good answer.
    const attacker = stubFetch(async () => openAiReply("JSON 아님"));
    const tally = {};
    let lastFull = null;
    for (let i = 0; i < 35; i++) {
      const r = await call(env, "POST", `/workspace/projects/${PROJECT}/infer-intent`, { userKey: USER, locale: "ko" }, attacker.f, { "cf-connecting-ip": "198.51.100.7" });
      const k = `${r.status}:${r.json?.reason ?? r.json?.error}`;
      tally[k] = (tally[k] ?? 0) + 1;
      if (r.json?.reason === "generation_capacity") lastFull = r.json;
    }
    assert.equal(tally["200:llm_unavailable"], 5, JSON.stringify(tally));
    assert.equal(tally["200:generation_capacity"], 30, JSON.stringify(tally));
    assert.equal(attacker.llmCalls.length, 5, "the network's share bounds the billed calls");
    assert.equal(lastFull.scope, "network", "the card can tell whose share ran out");
    assert.ok(!Number.isNaN(Date.parse(lastFull.resetAt)));
    assert.equal(await serviceCount(db, "generation-daily-global"), 5, "a request refused by the network share takes no service slot");
    assert.equal(await networkCount(db, env, "generation-daily-ip", "198.51.100.7"), 5);

    // Someone else, elsewhere, is not locked out.
    const other = stubFetch(async () => openAiReply("JSON 아님"));
    const r2 = await call(env, "POST", "/workspace/idea-to-spec-draft", { ...GENERATION_ROUTES[0].body, userKey: "uk_다른사용자" }, other.f, { "cf-connecting-ip": "203.0.113.99" });
    assert.notEqual(r2.json?.error, "generation_capacity", JSON.stringify(r2.json).slice(0, 200));
    assert.ok(other.llmCalls.length > 0, "the other network's request reached the model");
  });

  it("★한 IP에서 동시 8회(시간당 2 · 네트워크 3 · 서비스 5) → LLM 3회 · 서비스 3 · 나머지 429 scope=network · 다른 네트워크는 된다", async () => {
    const db = makeDb();
    const env = envWith(db, {
      WORKSPACE_GENERATION_LIMIT_PER_HOUR: "2",
      BETA_GENERATION_DAILY_LIMIT_GLOBAL: "5",
      BETA_GENERATION_DAILY_LIMIT_PER_IP: "3",
    });
    const s = stubFetch(async () => openAiReply("JSON 아님"));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call(env, "POST", "/workspace/idea-to-spec-draft", GENERATION_ROUTES[0].body, s.f, { "cf-connecting-ip": "198.51.100.8" })),
    );
    const tally = {};
    for (const r of results) {
      const k = `${r.status}:${r.json?.error}`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
    assert.equal(s.llmCalls.length, 3, JSON.stringify(tally));
    assert.equal(await serviceCount(db, "generation-daily-global"), 3);
    const refused = results.filter((r) => r.json?.error === "generation_capacity");
    assert.equal(refused.length, 5, JSON.stringify(tally));
    for (const r of refused) {
      assert.equal(r.status, 429, "a network's own share is a 429 (#561 pattern), not the service 503");
      assert.equal(r.json.scope, "network");
      assert.ok(Number(r.headers.get("retry-after")) >= 60);
    }
    const other = stubFetch(async () => openAiReply("JSON 아님"));
    const r2 = await call(env, "POST", "/workspace/idea-to-spec-draft", GENERATION_ROUTES[0].body, other.f, { "cf-connecting-ip": "203.0.113.77" });
    assert.notEqual(r2.json?.error, "generation_capacity");
    assert.ok(other.llmCalls.length > 0);
  });

  it("서비스 버킷이 찬 응답은 503 scope=service (네트워크 몫과 구별된다)", async () => {
    const { takeGenerationSlot } = await capacityModule();
    const db = makeDb();
    const env = envWith(db, { BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
    await takeGenerationSlot(env, "generation", null);
    const s = stubFetch(async () => openAiReply("{}"));
    const res = await call(env, "POST", "/workspace/unstick", GENERATION_ROUTES[4].body, s.f, { "cf-connecting-ip": "198.51.100.9" });
    assert.equal(res.status, 503);
    assert.equal(res.json.scope, "service");
    assert.equal(await networkCount(db, env, "generation-daily-ip", "198.51.100.9"), 0, "the network slot was handed back");
  });

  it("지시서: 같은 네트워크 몫(2)을 넘으면 429 generation_capacity scope=network · LLM 안 부름 · 서비스 슬롯 그대로", async () => {
    const db = makeDb();
    const env = envWith(db, { BETA_DEV_SPEC_DAILY_LIMIT_PER_IP: "2", BETA_PROJECT_CREATE_DAILY_LIMIT: "50" });
    const s = stubFetch(async () => openAiReply("JSON 아님"));
    const ip = { "cf-connecting-ip": "198.51.100.10" };
    const path = `/workspace/projects/${PROJECT}/dev-spec/generate`;
    assert.equal((await call(env, "POST", path, { userKey: USER, locale: "ko" }, s.f, ip)).status, 422);
    assert.equal((await call(env, "POST", path, { userKey: USER, locale: "ko" }, s.f, ip)).status, 422);
    const calls = s.llmCalls.length;
    const r3 = await call(env, "POST", path, { userKey: USER, locale: "ko" }, s.f, ip);
    assert.equal(r3.status, 429, JSON.stringify(r3.json).slice(0, 200));
    assert.equal(r3.json.error, "generation_capacity");
    assert.equal(r3.json.scope, "network");
    assert.equal(s.llmCalls.length, calls);
    assert.equal(await serviceCount(db, "dev-spec-daily-global"), 2);
  });
});

// ─── PR 검토도 같은 생성 버킷 (#576 검증 P2-9) ──────────────────────────────────
//
// 사용자가 부를 수 있는 LLM 경로 중 서비스 천장 밖에 남은 유일한 곳이었다(사용자 시간당 30 · 일 100뿐,
// 크레딧 차단 꺼짐). 같은 "generation" 버킷(네트워크 → 서비스)을 LLM 직전 — 검토 실행 행을 만들기 전 —
// 에 잡는다. LLM 전에 끝난 실패(PR을 못 가져옴 등)는 환급, 과금된 실패는 유지.

const { randomBytes } = await import("node:crypto");
const { encryptToken } = await import("../dist/crypto.js");
const PR_USER = "uk_깃허브_빵집";
const PR_PROJECT = "wsp_pr_cap";
const PR_NUMBER = 42;

async function makePrReviewEnv(vars = {}) {
  const kek = randomBytes(32).toString("base64");
  const enc = await encryptToken("fake-oauth-token-for-tests", kek);
  const rate = new Map();
  const reviewRuns = [];
  const now = "2026-09-30T00:00:00.000Z";
  const db = {
    rate,
    reviewRuns,
    prepare(sql) {
      const h = (args) => ({
        async run() {
          const capped = dailyCapsRun(rate, sql, args);
          if (capped) return capped;
          if (sql.includes("INSERT INTO workspace_rate_limit")) {
            const k = `${args[0]}::${args[1]}`;
            rate.set(k, (rate.get(k) ?? 0) + 1);
          }
          if (sql.includes("INSERT INTO workspace_pr_review_runs")) reviewRuns.push({ id: args[0], status: args[7] });
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("FROM workspace_rate_limit")) {
            const n = rate.get(`${args[0]}::${args[1]}`);
            return n === undefined ? null : { count: n };
          }
          if (sql.includes("FROM workspace_projects")) {
            return args[0] === PR_PROJECT
              ? { id: PR_PROJECT, user_key: PR_USER, title: "동네 빵집", idea: "", understood_json: null, product_spec_json: "{}", items_json: "[]", created_at: now, updated_at: now }
              : null;
          }
          if (sql.includes("FROM workspace_project_repos")) {
            return { id: "wpr_cap", project_id: PR_PROJECT, user_key: PR_USER, github_connection_id: "wgc_cap", repo_id: "1", repo_full_name: "bakery-owner/pickup", repo_owner: "bakery-owner", repo_name: "pickup", default_branch: "main", private: 0, html_url: "https://github.com/bakery-owner/pickup", created_at: now, updated_at: now };
          }
          if (sql.includes("FROM workspace_github_connections")) {
            return { id: "wgc_cap", user_key: PR_USER, github_user_id: "7", github_login: "bakery-owner", github_name: null, avatar_url: null, access_token_enc: enc, scopes: "public_repo", created_at: now, updated_at: now };
          }
          return null;
        },
        async all() { return { results: [] }; },
      });
      return { bind: (...a) => h(a), run: () => h([]).run(), first: () => h([]).first(), all: () => h([]).all() };
    },
  };
  return { db, env: { ...LLM_ENV, CONCLAVE_TOKEN_KEK: kek, DB: db, ...vars } };
}

const PR_BODY = {
  userKey: PR_USER,
  locale: "ko",
  selectedItemIds: ["req_001"],
  items: [{ id: "req_001", title: "빵 목록", criteria: ["오늘 구운 빵 목록이 보인다"] }],
  productSpec: { productName: "동네 빵집 픽업 예약", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
};
const REVIEW_REPLY = JSON.stringify({ results: [{ itemId: "req_001", status: "passed", userLabel: "통과", reason: "목록 화면이 추가됨", evidence: ["app/page.tsx"], nextAction: "" }] });

function prFetch({ github = "ok", llm = async () => openAiReply(REVIEW_REPLY) } = {}) {
  const llmCalls = [];
  const f = async (url, init) => {
    const u = String(url);
    if (isLlm(u)) {
      llmCalls.push(u);
      return llm(u, init);
    }
    if (u.includes("api.github.com")) {
      if (github !== "ok") return new Response("server error", { status: 502 });
      if (u.includes(`/pulls/${PR_NUMBER}/files`)) {
        return new Response(JSON.stringify([{ filename: "app/page.tsx", status: "modified", additions: 3, deletions: 0, changes: 3, patch: "@@ -1 +1,3 @@\n+<h1>오늘의 빵</h1>" }]), { status: 200 });
      }
      if (u.includes(`/pulls/${PR_NUMBER}`)) {
        return new Response(JSON.stringify({ number: PR_NUMBER, title: "feat: 빵 목록", head: { ref: "feat/list", sha: "abc123" }, base: { ref: "main" }, additions: 3, deletions: 0, changed_files: 1, state: "open", html_url: "https://github.com/bakery-owner/pickup/pull/42" }), { status: 200 });
      }
    }
    return new Response("{}", { status: 200 });
  };
  return { f, llmCalls };
}

const PR_PATH = `/workspace/projects/${PR_PROJECT}/github/pulls/${PR_NUMBER}/review`;

describe("③ PR 검토도 생성 버킷(네트워크 → 서비스)에서 슬롯을 잡는다", () => {
  it("★버킷이 가득 차면 503 generation_capacity · LLM 0회 · 검토 실행 행을 만들지 않는다", async () => {
    const { takeGenerationSlot } = await capacityModule();
    const { db, env } = await makePrReviewEnv({ BETA_GENERATION_DAILY_LIMIT_GLOBAL: "1" });
    await takeGenerationSlot(env, "generation", null);
    const s = prFetch();
    const res = await call(env, "POST", PR_PATH, PR_BODY, s.f);
    assert.equal(res.status, 503, JSON.stringify(res.json).slice(0, 200));
    assert.equal(res.json.error, "generation_capacity");
    assert.deepEqual(s.llmCalls, []);
    assert.equal(db.reviewRuns.length, 0, "no 'running' row left behind");
  });

  it("성공한 검토는 슬롯 1개를 쓴다", async () => {
    const { db, env } = await makePrReviewEnv();
    const s = prFetch();
    const res = await call(env, "POST", PR_PATH, PR_BODY, s.f);
    assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300));
    assert.equal(s.llmCalls.length, 1);
    assert.equal(await serviceCount(db, "generation-daily-global"), 1);
  });

  it("LLM 전에 끝난 실패(GitHub에서 PR을 못 가져옴)는 환급", async () => {
    const { db, env } = await makePrReviewEnv();
    const s = prFetch({ github: "down" });
    const res = await call(env, "POST", PR_PATH, PR_BODY, s.f);
    assert.equal(res.status, 502, JSON.stringify(res.json).slice(0, 200));
    assert.deepEqual(s.llmCalls, []);
    assert.equal(await serviceCount(db, "generation-daily-global"), 0);
  });

  it("과금된 실패(모델이 JSON이 아닌 답)는 차감 유지 · 과금 안 된 실패(벤더 장애)는 환급", async () => {
    const billed = await makePrReviewEnv();
    const prose = prFetch({ llm: async () => openAiReply("검토 결과를 표로 정리해 드릴게요.") });
    const r1 = await call(billed.env, "POST", PR_PATH, PR_BODY, prose.f);
    assert.equal(r1.status, 500);
    assert.equal(r1.json.error, "review_failed");
    assert.equal(prose.llmCalls.length, 1);
    assert.equal(await serviceCount(billed.db, "generation-daily-global"), 1);

    const unbilled = await makePrReviewEnv();
    const down = prFetch({ llm: async () => new Response("upstream down", { status: 503 }) });
    const r2 = await call(unbilled.env, "POST", PR_PATH, PR_BODY, down.f);
    assert.equal(r2.status, 500);
    assert.equal(await serviceCount(unbilled.db, "generation-daily-global"), 0);
  });
});

/**
 * Train L — L-5 GET /admin/usage-stats (BM §1 원가표 갱신 입력).
 *
 * 고정하는 계약:
 *   ① Bearer INTERNAL_CALLBACK_TOKEN — 없거나 틀리면 401, 서버에 토큰이 설정 안 됐으면 503(admin_disabled)
 *   ② since/until은 ISO — 파싱 불가·역전이면 400. 기본은 최근 7일
 *   ③ job_kind × vendor × model_actual 별 건수·토큰 합·cost_usd 합·중앙값(비용·지연)·unpriced 건수·컨테이너 초
 *   ④ 기간 밖 행은 세지 않는다(created_at >= since AND < until)
 * 네트워크 0: 가짜 D1.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const TOKEN = "tok_admin_test";

const row = (o) => ({
  job_kind: "check", vendor: "openai", model_actual: "gpt-5.4-2026-03-05", input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
  output_tokens: 0, cost_usd: 0, unpriced: 0, latency_ms: 0, container_seconds: null, created_at: "2026-09-28T10:00:00.000Z", ...o,
});

const ROWS = [
  row({ input_tokens: 1000, output_tokens: 100, cost_usd: 0.004, latency_ms: 3000 }),
  row({ input_tokens: 2000, cache_read_tokens: 500, output_tokens: 200, cost_usd: 0.008, latency_ms: 5000 }),
  row({ input_tokens: 3000, output_tokens: 300, cost_usd: 0.012, latency_ms: 4000 }),
  row({ job_kind: "check", vendor: "openai", model_actual: "gpt-5.4-2026-03-05", input_tokens: 100, cost_usd: 0.001, latency_ms: 1000, created_at: "2026-09-20T00:00:00.000Z" }), // 기간 밖
  row({ job_kind: "council", vendor: "google", model_actual: "gemini-2.5-flash", input_tokens: 10, output_tokens: 5, cost_usd: 0.3, unpriced: 1, latency_ms: 800 }),
  row({ job_kind: "council", vendor: "google", model_actual: "gemini-2.5-flash", input_tokens: 20, output_tokens: 5, cost_usd: 0.5, unpriced: 1, latency_ms: 1200 }),
  row({ job_kind: "repair", vendor: "cloudflare", model_actual: "container", cost_usd: 0, unpriced: 1, latency_ms: 42000, container_seconds: 42 }),
];

/**
 * 가짜 D1 — SQLite처럼 동작하는 만큼만: 기간 필터, `ORDER BY created_at DESC`가 있으면 그 순서(없으면 삽입 순서 =
 * rowid 순서), 세 번째 바인딩(LIMIT)으로 자른다(#562 결함 10: 예전엔 LIMIT를 무시해 truncated 경로가 죽어 있었다).
 */
function makeDb(rows = ROWS) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      return {
        bind(...args) {
          seen.push({ sql, args });
          return {
            async all() {
              if (!sql.includes("FROM llm_usage")) return { results: [] };
              const [since, until, limit] = args;
              let out = rows.filter((r) => r.created_at >= since && r.created_at < until);
              if (/ORDER BY created_at DESC/i.test(sql)) out = [...out].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
              if (typeof limit === "number") out = out.slice(0, limit);
              return { results: out };
            },
            // Stage 18 이벤트 분석 쿼리용(경로 공유 테스트) — 빈 집계.
            async first() { return null; },
          };
        },
      };
    },
  };
}

async function get(env, qs = "", headers = {}) {
  const res = await createApp().fetch(new Request(`https://cp.example/admin/usage-stats${qs}`, { headers }), env);
  return { status: res.status, body: await res.json() };
}
const AUTH = { authorization: `Bearer ${TOKEN}` };
const RANGE = "?since=2026-09-27T00:00:00Z&until=2026-09-29T00:00:00Z";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

describe("① 인증", () => {
  it("토큰 없음·틀림 → 401, 서버 토큰 미설정 → 503", async () => {
    const env = { DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN };
    assert.equal((await get(env, RANGE)).status, 401);
    assert.equal((await get(env, RANGE, { authorization: "Bearer wrong" })).status, 401);
    assert.equal((await get(env, RANGE, { authorization: TOKEN })).status, 401, "Bearer 접두어 필수");
    const r = await get({ DB: makeDb() }, RANGE, AUTH);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "admin_disabled");
  });
});

describe("① 경로 공유 — Stage 18 이벤트 분석(x-admin-key)은 그대로", () => {
  it("x-admin-key 요청은 Stage 18 응답(range·summary)을 받고, Bearer 요청만 원장 집계를 받는다", async () => {
    const env = { DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN, ADMIN_USAGE_STATS_KEY: "stage18-key" };
    const legacy = await get(env, "?range=24h", { "x-admin-key": "stage18-key" });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.range, "24h");
    assert.ok("summary" in legacy.body);
    assert.ok(!("groups" in legacy.body));
    const wrongLegacy = await get(env, "", { "x-admin-key": "nope" });
    assert.equal(wrongLegacy.status, 401);
    const ledger = await get(env, RANGE, AUTH);
    assert.equal(ledger.status, 200);
    assert.ok(Array.isArray(ledger.body.groups));
  });
});

describe("② 기간", () => {
  it("ISO 파싱 불가·역전 → 400, 기본은 최근 7일", async () => {
    const env = { DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN };
    assert.equal((await get(env, "?since=어제", AUTH)).status, 400);
    assert.equal((await get(env, "?since=2026-09-29T00:00:00Z&until=2026-09-28T00:00:00Z", AUTH)).status, 400);
    const db = makeDb();
    const r = await get({ DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, "", AUTH);
    assert.equal(r.status, 200);
    const span = Date.parse(r.body.until) - Date.parse(r.body.since);
    assert.equal(span, 7 * 24 * 60 * 60 * 1000);
    assert.equal(db.seen[0].args[0], r.body.since);
  });
});

describe("③ ④ 집계", () => {
  it("★job_kind × vendor × model_actual 그룹: 건수·토큰 합·비용 합·중앙값·unpriced·컨테이너 초 — 기간 밖 제외", async () => {
    const r = await get({ DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, AUTH);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.rows, 6, "기간 밖 1행 제외");
    assert.equal(r.body.truncated, false);
    const g = (k, v, m) => r.body.groups.find((x) => x.jobKind === k && x.vendor === v && x.modelActual === m);

    const check = g("check", "openai", "gpt-5.4-2026-03-05");
    assert.equal(check.calls, 3);
    assert.equal(check.inputTokens, 6000);
    assert.equal(check.cacheReadTokens, 500);
    assert.equal(check.outputTokens, 600);
    near(check.costUsd, 0.024);
    near(check.medianCostUsd, 0.008);
    assert.equal(check.medianLatencyMs, 4000);
    assert.equal(check.unpricedCalls, 0);

    const council = g("council", "google", "gemini-2.5-flash");
    assert.equal(council.calls, 2);
    near(council.medianCostUsd, 0.4, "짝수 개 → 가운데 둘의 평균");
    assert.equal(council.unpricedCalls, 2);

    const container = g("repair", "cloudflare", "container");
    assert.equal(container.containerSeconds, 42);

    assert.equal(r.body.totals.calls, 6);
    near(r.body.totals.costUsd, 0.824);
    assert.equal(r.body.totals.unpricedCalls, 3);
    assert.equal(r.body.totals.containerSeconds, 42);
    // 비용 큰 그룹이 먼저
    assert.equal(r.body.groups[0].jobKind, "council");
  });

  it("빈 기간이면 groups=[]·totals 0", async () => {
    const r = await get({ DB: makeDb([]), INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, AUTH);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.groups, []);
    assert.equal(r.body.totals.calls, 0);
    assert.equal(r.body.totals.costUsd, 0);
  });

  it("원장 조회 실패는 500으로 숨기지 않고 정직하게 503 ledger_unavailable", async () => {
    const broken = { prepare() { return { bind() { return { async all() { throw new Error("D1_ERROR: no such table: llm_usage"); } }; } }; } };
    const r = await get({ DB: broken, INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, AUTH);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "ledger_unavailable");
  });
});

// ─── ⑤ 상한에 걸렸을 때 (#562 결함 6·10) ─────────────────────────────────────────

describe("⑤ 50,000행 상한 — 잘려도 임의 부분집합이 아니라 최신 구간의 정확한 집계", () => {
  it("★truncated:true면 가장 최근 행부터 읽고, 경계 타임스탬프를 버린 [coveredSince, until)을 정확히 집계한다", async () => {
    const LIMIT = 50_000;
    const base = Date.parse("2026-09-28T00:00:00.000Z");
    const iso = (ms) => new Date(ms).toISOString();
    const rows = [];
    // 오래된 build 10행(먼저 삽입 = rowid 앞) → 새 check 50,000행. 상한을 넘으면 남아야 할 것은 최신 쪽이다.
    for (let i = 0; i < 10; i++) rows.push(row({ job_kind: "build", vendor: "openai", model_actual: "gpt-5.4", cost_usd: 1, created_at: iso(base + i) }));
    for (let i = 0; i < LIMIT; i++) rows.push(row({ job_kind: "check", cost_usd: 0.001, latency_ms: 1000, created_at: iso(base + 1_000 + i) }));
    const r = await get({ DB: makeDb(rows), INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, AUTH);
    assert.equal(r.status, 200);
    assert.equal(r.body.truncated, true);
    assert.ok(!r.body.groups.some((g) => g.jobKind === "build"), "잘릴 때 오래된 행이 대신 남으면 안 된다");
    // 가장 오래된 check 행(경계)은 같은 ms의 다른 행이 잘렸을 수 있으므로 버린다 → 49,999행, 두 번째로 오래된 행부터.
    assert.equal(r.body.coveredSince, iso(base + 1_001));
    assert.equal(r.body.totals.calls, LIMIT - 1);
    assert.equal(r.body.rows, LIMIT - 1);
  });

  it("잘리지 않으면 coveredSince = since (요청 구간 전체)", async () => {
    const r = await get({ DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, AUTH);
    assert.equal(r.body.truncated, false);
    assert.equal(r.body.coveredSince, r.body.since);
  });
});

// ─── ⑥ 원장이 보지 않는 경로 (#562 결함 4) ─────────────────────────────────────────

describe("⑥ notMetered — totals가 모든 LLM 원가가 아님을 응답이 스스로 말한다", () => {
  it("★응답에 원장 밖 경로(크론 7개·agent-spawner·demo 등)를 싣는다", async () => {
    const r = await get({ DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, AUTH);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.notMetered) && r.body.notMetered.length > 0, "notMetered 배열");
    const sites = r.body.notMetered.map((x) => x.callSite);
    for (const s of ["external-references", "feedback-classify", "seed-promoter", "source-discovery", "oss-pr-miner", "changelog-monitor", "deploy-trend-watcher", "agent-spawner", "demo"]) {
      assert.ok(sites.includes(s), `notMetered에 ${s}`);
    }
    for (const x of r.body.notMetered) {
      assert.equal(typeof x.source, "string");
      assert.equal(typeof x.trigger, "string");
    }
  });

  it("★코드 불변식: LLM을 부르면서 원장 배선(onUsage·콜백 원장)이 없는 src 파일은 모두 notMetered에 있다", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { LEDGER_NOT_METERED } = await import("../dist/workspace/llm-usage.js");
    assert.ok(Array.isArray(LEDGER_NOT_METERED), "LEDGER_NOT_METERED export");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
    const CALLS_LLM = /fetch\(\s*["'`]https:\/\/api\.anthropic\.com|[^.\w]anthropicMessages\(|\/chat\/completions|generativelanguage\.googleapis|["']x-anthropic-key["']/;
    // recordLlmUsage( — 원장에 직접 쓰는 경로(B-5b S1 빌드 LLM 프록시 routes/build-llm-proxy.ts).
    const WIRED = /\bonUsage\b|recordCallbackUsage|recordCollectedUsage|recordLlmUsage\(/;
    const listed = new Set(LEDGER_NOT_METERED.map((x) => x.source));
    const unwired = walk(join(root, "src"))
      .map((p) => ({ rel: relative(root, p).replace(/\\/g, "/"), src: readFileSync(p, "utf8") }))
      .filter(({ rel, src }) => rel !== "src/workspace/anthropic-fetch.ts" && CALLS_LLM.test(src) && !WIRED.test(src))
      .map(({ rel }) => rel);
    assert.ok(unwired.length >= 10, `스캔이 살아 있는지(${unwired.length})`);
    const missing = unwired.filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], "원장 밖 경로가 notMetered에 빠졌다 — 배선하거나 목록에 적는다");
  });
});

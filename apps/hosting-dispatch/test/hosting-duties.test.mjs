/**
 * SI 티어 Train B — B-7 호스팅 사업자 의무(D-6): 정지 목록(KV)·신고 사이트·요청 상한·헬스/SHA·배포 워크플로.
 *
 * 모든 바인딩은 가짜(KV Map·Rate Limiter·DISPATCHER) — 네트워크 없음.
 * 표시 규칙(PR #575 검증 P2 — 회귀 증거와 형태 검사를 섞어 세지 않는다):
 *   ★         = B-7 행동 테스트. B-7 이전 라우터(main 3a1ca07 dist)에서 실패해야 한다.
 *   ◆         = 검증 결함 재현. 수정 전 PR head(8097ac2 dist)에서 실패해야 한다(PR 코멘트 표에 실제 결과).
 *   [형태 가드] = 설정·워크플로·카피 파일의 모양 검사. 파일이 트리에 있으면 옛 src로도 통과할 수 있어 회귀 증거가 아니다.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROOT = "simsa.page";
const API = "https://conclave-ai.seunghunbae.workers.dev";

const idx = await import("../dist/index.js");
const route = await import("../dist/route.js");
const pagesMod = await import("../dist/pages.js").catch(() => null);
const { handle } = idx;
/** 실제 진입점(Cloudflare가 부르는 default.fetch). 시각을 고정해야 하는 테스트만 handle(…, now)를 직접 부른다. */
const run = (r, e, c = fakeCtx()) => idx.default.fetch(r, e, c);

function fakeKv(init = {}) {
  const m = new Map(Object.entries(init));
  const kv = {
    m,
    puts: [],
    gets: [],
    failGet: false,
    async get(key, opts) {
      kv.gets.push({ key, opts });
      if (kv.failGet) throw new Error("KV GET failed: 503");
      return m.has(key) ? m.get(key) : null;
    },
    async put(key, value, opts) {
      kv.puts.push({ key, value, opts });
      m.set(key, value);
    },
    async delete(key) {
      m.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + 100);
      const next = start + page.length;
      return { keys: page.map((name) => ({ name })), list_complete: next >= names.length, cursor: String(next) };
    },
  };
  return kv;
}

function fakeLimiter(allow = true) {
  const rl = { calls: [], allow, async limit(o) { rl.calls.push(o); return { success: rl.allow }; } };
  return rl;
}

/** 실제처럼 세는 가짜 상한(한 분 창, 키별 카운터) — 정상 부하 모델용. */
function countingLimiter(limit) {
  const counts = new Map();
  const rl = {
    calls: 0,
    async limit({ key }) {
      rl.calls++;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
  return rl;
}

function fakeCtx() {
  const c = { promises: [], waitUntil(p) { c.promises.push(p); } };
  return c;
}

/** 유저 앱 모크 — 호출되면 기록하고 200 "user app". */
function dispatcher(calls = []) {
  return {
    calls,
    get(name) {
      calls.push(name);
      return { fetch: async (rq) => new Response(`user app ${new URL(rq.url).pathname}`, { status: 200 }) };
    },
  };
}

const neverDispatch = { get() { throw new Error("must not reach the user app"); } };

const env = (o = {}) => ({ HOSTING_ROOT_DOMAIN: ROOT, DISPATCHER: dispatcher(), ...o });
const req = (host, p = "/", init = {}) => new Request(`https://${host}${p}`, init);
/** 브라우저가 주소창으로 페이지를 열 때의 헤더(문서 요청). */
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
/** 페이지 안의 이미지 요청. */
const IMG = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image", accept: "image/avif,image/webp,*/*" };
const OPEN = { HOSTING_REPORTS_ENABLED: "on" };

function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = orig;
    })
    .then((r) => ({ r, lines }));
}

beforeEach(() => {
  if (typeof idx.resetIsolateStateForTests === "function") idx.resetIsolateStateForTests();
});

// ─── ① 정지 목록 ───────────────────────────────────────────────────────────────

describe("정지 목록(KV HOSTING_SUSPENDED)", () => {
  it("★정지된 slug → 410 + 안내 페이지 · 유저 앱으로 가지 않음 (옛 코드: 200 유저 앱)", async () => {
    const kv = fakeKv({ "suspended:bad-app": JSON.stringify({ v: 1, reason: "phishing", source: "admin" }) });
    const calls = [];
    const r = await run(req("bad-app.simsa.page", "/login", { headers: { "accept-language": "ko-KR,ko;q=0.9" } }), env({ HOSTING_SUSPENDED: kv, DISPATCHER: dispatcher(calls) }), fakeCtx());
    assert.equal(r.status, 410);
    assert.deepEqual(calls, [], "유저 앱 호출 없음");
    assert.equal(r.headers.get("x-simsa-hosted"), "bad-app");
    assert.equal(r.headers.get("cache-control"), "no-store");
    const body = await r.text();
    assert.match(body, /이 앱은 지금 열 수 없어요/);
    assert.match(body, /이용 규칙 위반이 확인되어 Simsa 운영자가/);
    assert.match(body, /https:\/\/report\.simsa\.page\/rules/);
    // 소유자·사유 세부·메모는 싣지 않는다
    assert.doesNotMatch(body, /phishing|피싱/);
    assert.deepEqual(kv.gets[0], { key: "suspended:bad-app", opts: { cacheTtl: 30 } }, "cacheTtl = KV 하한 30초");
  });

  it("★◆영어 요청 → 영어 안내 · 값에 source:auto가 있어도 '요청이 많아 잠시 정지' 문구는 없다(트래픽 자동 정지 폐지) (8097ac2: 요청 초과 문구)", async () => {
    const kv = fakeKv({ "suspended:busy-app": JSON.stringify({ v: 1, reason: "abuse_other", source: "auto" }) });
    const r = await run(req("busy-app.simsa.page", "/", { headers: { "accept-language": "en-US,en;q=0.8" } }), env({ HOSTING_SUSPENDED: kv, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 410);
    const body = await r.text();
    assert.match(body, /<html lang="en">/);
    assert.match(body, /A Simsa operator suspended this address/);
    assert.doesNotMatch(body, /more requests than allowed|paused/);
  });

  it("★깨진 KV 값도 정지로 본다(형식 문제로 풀어 주지 않는다)", async () => {
    const kv = fakeKv({ "suspended:bad-app": "{not json" });
    const r = await run(req("bad-app.simsa.page"), env({ HOSTING_SUSPENDED: kv, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 410);
  });

  it("해제(키 삭제) 후 → 다시 유저 앱으로", async () => {
    const kv = fakeKv({ "suspended:bad-app": JSON.stringify({ source: "admin" }) });
    const e = env({ HOSTING_SUSPENDED: kv });
    assert.equal((await run(req("bad-app.simsa.page"), e, fakeCtx())).status, 410);
    await kv.delete("suspended:bad-app");
    const r = await run(req("bad-app.simsa.page", "/menu"), e, fakeCtx());
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "user app /menu");
  });

  it("★KV 바인딩 없음 → 서빙 계속(fail-open) + isolate당 JSON 로그 한 줄", async () => {
    const e = env();
    const { r, lines } = await captureLogs(async () => {
      const a = await run(req("app-abc.simsa.page"), e, fakeCtx());
      const b = await run(req("app-abc.simsa.page"), e, fakeCtx());
      return [a, b];
    });
    assert.deepEqual(r.map((x) => x.status), [200, 200]);
    const unchecked = lines.filter((l) => l.includes("hosting_suspension_unchecked"));
    assert.equal(unchecked.length, 1, lines.join("\n"));
    const parsed = JSON.parse(unchecked[0]);
    assert.equal(parsed.reason, "no_binding");
    assert.equal(parsed.effect, "serving");
  });

  it("★KV 조회 오류 → 최근 정지로 본 slug는 계속 410, 처음 보는 slug는 서빙 + 로그", async () => {
    const kv = fakeKv({ "suspended:bad-app": JSON.stringify({ source: "admin" }) });
    const e = env({ HOSTING_SUSPENDED: kv });
    const t0 = new Date("2026-09-30T10:00:00Z");
    assert.equal((await handle(req("bad-app.simsa.page"), e, fakeCtx(), t0)).status, 410);
    kv.failGet = true;
    const { r, lines } = await captureLogs(async () => [
      await handle(req("bad-app.simsa.page"), e, fakeCtx(), new Date(t0.getTime() + 60_000)),
      await handle(req("good-app.simsa.page"), e, fakeCtx(), new Date(t0.getTime() + 60_000)),
      await handle(req("bad-app.simsa.page"), e, fakeCtx(), new Date(t0.getTime() + 11 * 60_000)),
    ]);
    assert.deepEqual(r.map((x) => x.status), [410, 200, 200], "기억은 10분까지");
    const failed = lines.filter((l) => l.includes("hosting_suspension_check_failed")).map((l) => JSON.parse(l));
    assert.deepEqual(failed.map((f) => f.effect), ["blocked_last_known", "serving", "serving"]);
  });
});

// ─── ② 요청 상한 ───────────────────────────────────────────────────────────────

describe("요청 상한(두 겹: 문서 요청 · 모든 요청)", () => {
  it("★실제 진입점: 모든-요청 상한 초과 → 429 (main: 200 유저 앱)", async () => {
    const calls = [];
    const r = await run(req("app-abc.simsa.page"), env({ HOSTING_REQUEST_RATE_LIMITER: fakeLimiter(false), DISPATCHER: dispatcher(calls) }));
    assert.equal(r.status, 429);
    assert.deepEqual(calls, [], "유저 앱 호출 없음");
  });

  it("★문서 요청이 페이지 상한을 넘으면 429 + Retry-After 60 + 분 단위 strike 기록(유저 앱으로 안 감)", async () => {
    const kv = fakeKv();
    const page = fakeLimiter(false);
    const all = fakeLimiter(true);
    const ctx = fakeCtx();
    const now = new Date("2026-09-30T14:12:33Z");
    const e = env({ HOSTING_SUSPENDED: kv, HOSTING_PAGE_RATE_LIMITER: page, HOSTING_REQUEST_RATE_LIMITER: all, DISPATCHER: neverDispatch });
    const r = await handle(req("app-abc.simsa.page", "/", { headers: { ...NAV, "accept-language": "ko" } }), e, ctx, now);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
    assert.equal(r.headers.get("x-simsa-hosted"), "app-abc");
    assert.match(await r.text(), /잠시 후 다시 시도해 주세요/);
    assert.deepEqual(page.calls, [{ key: "app-abc" }], "slug당 — 키는 slug(IP 아님)");
    assert.deepEqual(all.calls, [{ key: "app-abc" }], "문서 요청도 모든-요청 겹에 센다");
    await Promise.all(ctx.promises);
    assert.deepEqual(kv.puts, [{ key: "strike:app-abc:202609301412", value: "1", opts: { expirationTtl: 7200 } }]);
    // 같은 분 두 번째 429는 KV를 다시 쓰지 않는다(같은 키 쓰기 한도)
    await handle(req("app-abc.simsa.page", "/", { headers: NAV }), e, ctx, now);
    await Promise.all(ctx.promises);
    assert.equal(kv.puts.length, 1);
  });

  it("★◆이미지·fetch 같은 하위 요청은 페이지 상한을 세지 않는다 (8097ac2: 모든 요청을 한 상한 600에 셌다)", async () => {
    const page = fakeLimiter(false);
    const all = fakeLimiter(true);
    const e = env({ HOSTING_PAGE_RATE_LIMITER: page, HOSTING_REQUEST_RATE_LIMITER: all, HOSTING_SUSPENDED: fakeKv() });
    const img = await run(req("app-abc.simsa.page", "/logo.png", { headers: IMG }), e);
    assert.equal(img.status, 200);
    const api = await run(req("app-abc.simsa.page", "/api/menu", { headers: { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", accept: "application/json" } }), e);
    assert.equal(api.status, 200);
    assert.equal(page.calls.length, 0, "페이지 상한은 문서 요청만");
    assert.equal(all.calls.length, 2, "모든 요청 상한은 전부 센다(우회 백스톱)");
    const doc = await run(req("app-abc.simsa.page", "/", { headers: NAV }), e);
    assert.equal(doc.status, 429);
  });

  it("◆정상 앱 부하: 페이지당 요청 40개 × 1분에 30명 방문(1,200요청) → 429 없음 (8097ac2: 601번째 요청부터 429)", async () => {
    // wrangler.toml 수치 그대로 세는 가짜. HOSTING_RATE_LIMITER는 **옛 설정**(모든 요청 600/60s) — 새 코드는 읽지 않는다.
    const e = env({
      HOSTING_SUSPENDED: fakeKv(),
      HOSTING_PAGE_RATE_LIMITER: countingLimiter(route.HOSTING_RATE_LIMITS?.page?.limit ?? 600),
      HOSTING_REQUEST_RATE_LIMITER: countingLimiter(route.HOSTING_RATE_LIMITS?.request?.limit ?? 6000),
      HOSTING_RATE_LIMITER: countingLimiter(600),
    });
    const statuses = [];
    for (let visitor = 0; visitor < 30; visitor++) {
      statuses.push((await run(req("bakery-pickup-1.simsa.page", "/", { headers: NAV }), e)).status);
      for (let i = 0; i < 39; i++) statuses.push((await run(req("bakery-pickup-1.simsa.page", `/assets/${i}.js`, { headers: { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" } }), e)).status);
    }
    assert.equal(statuses.length, 1200);
    assert.equal(statuses.filter((s) => s === 429).length, 0);
  });

  it("상한 이내 → 유저 앱 200", async () => {
    const page = fakeLimiter(true);
    const all = fakeLimiter(true);
    const r = await run(req("app-abc.simsa.page", "/", { headers: NAV }), env({ HOSTING_PAGE_RATE_LIMITER: page, HOSTING_REQUEST_RATE_LIMITER: all, HOSTING_SUSPENDED: fakeKv() }), fakeCtx());
    assert.equal(r.status, 200);
    assert.equal(page.calls.length, 1);
    assert.equal(all.calls.length, 1);
  });

  it("★정지된 앱은 상한을 소모하지 않는다(410이 먼저)", async () => {
    const page = fakeLimiter(true);
    const all = fakeLimiter(true);
    const kv = fakeKv({ "suspended:bad-app": "{}" });
    const r = await run(req("bad-app.simsa.page", "/", { headers: NAV }), env({ HOSTING_PAGE_RATE_LIMITER: page, HOSTING_REQUEST_RATE_LIMITER: all, HOSTING_SUSPENDED: kv, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 410);
    assert.equal(page.calls.length + all.calls.length, 0);
  });

  it("★상한 바인딩 없음·오류 → 서빙 + 로그(상한이 우리 사정으로 앱을 막지 않는다)", async () => {
    const broken = { async limit() { throw new Error("rate limiter unavailable"); } };
    const { r, lines } = await captureLogs(async () => [
      await run(req("app-abc.simsa.page", "/", { headers: NAV }), env({ HOSTING_SUSPENDED: fakeKv() }), fakeCtx()),
      await run(req("app-abc.simsa.page", "/", { headers: NAV }), env({ HOSTING_SUSPENDED: fakeKv(), HOSTING_PAGE_RATE_LIMITER: broken, HOSTING_REQUEST_RATE_LIMITER: broken }), fakeCtx()),
    ]);
    assert.deepEqual(r.map((x) => x.status), [200, 200]);
    const unchecked = lines.filter((l) => l.includes("hosting_rate_limit_unchecked")).map((l) => JSON.parse(l).tier).sort();
    assert.deepEqual(unchecked, ["page", "request"], lines.join("\n"));
    assert.ok(lines.some((l) => l.includes("hosting_rate_limit_check_failed")), lines.join("\n"));
  });

  it("isDocumentRequest 순수 판정 — Fetch Metadata 우선, 없으면 Accept", () => {
    const f = (h) => route.isDocumentRequest(new Headers(h));
    assert.equal(f(NAV), true);
    assert.equal(f({ "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }), true);
    assert.equal(f(IMG), false);
    assert.equal(f({ "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", accept: "text/html" }), false, "Fetch Metadata가 문서 아님이라고 하면 Accept보다 우선");
    assert.equal(f({ accept: "text/html,*/*" }), true, "Fetch Metadata 없는 옛 클라이언트");
    assert.equal(f({ accept: "application/json" }), false);
    assert.equal(f({}), false);
  });
});

// ─── ②-b 트래픽만으로는 정지하지 않는다(라우터 + central-plane 크론 왕복) ───────────

/** central-plane 크론이 쓰는 D1 모양만(정지 로그·신고 표에 쓰는 문장을 기록). 옛 코드의 자동 정지 경로도 돌 수 있게 넉넉히. */
function fakeD1() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const h = (args) => ({
        async run() { calls.push({ sql, args }); return { meta: { changes: 1 } }; },
        async first() { calls.push({ sql, args }); return null; },
        async all() { calls.push({ sql, args }); return { results: [] }; },
      });
      return { bind: (...a) => h(a), ...h([]) };
    },
  };
}

describe("제3자 요청 몰림만으로 남의 앱이 410이 되지 않는다(라우터 strike → central-plane 크론)", () => {
  it("◆15분 동안 상한을 넘겨도 크론 뒤 그 앱은 410이 아니다 · 플래그 행과 운영자 알림만 (8097ac2: 크론이 자동 정지 → 410, 자동 해제 없음)", async () => {
    const cp = await import("../../central-plane/dist/workspace/hosting-duties.js");
    const kv = fakeKv();
    const flooded = fakeLimiter(false);
    const t0 = Date.parse("2026-09-30T14:00:10Z");
    // 제3자가 15분 동안 이 앱에 요청을 몰아넣는다 — 라우터는 매분 429 + strike.
    for (let m = 0; m < 15; m++) {
      const ctx = fakeCtx();
      const r = await handle(
        req("bakery-pickup-1.simsa.page", "/", { headers: NAV }),
        env({ HOSTING_SUSPENDED: kv, HOSTING_PAGE_RATE_LIMITER: flooded, HOSTING_REQUEST_RATE_LIMITER: flooded, HOSTING_RATE_LIMITER: flooded }),
        ctx,
        new Date(t0 + m * 60_000),
      );
      assert.equal(r.status, 429);
      await Promise.all(ctx.promises);
    }
    assert.equal([...kv.m.keys()].filter((k) => k.startsWith("strike:bakery-pickup-1:")).length, 15);

    // central-plane 10분 크론(같은 KV).
    const sent = [];
    const tg = async (url, init) => {
      sent.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const DB = fakeD1();
    const out = await cp.sweepHostingRateStrikes({ DB, HOSTING_SUSPENDED: kv, TELEGRAM_BOT_TOKEN: "test-bot-token", FOUNDER_TG_CHAT_ID: "12345" }, new Date(t0 + 15 * 60_000), { fetch: tg });
    assert.equal(kv.m.has("suspended:bakery-pickup-1"), false, "정지 목록에 올라가지 않는다");
    assert.deepEqual(out.flagged, ["bakery-pickup-1"]);
    const logged = DB.calls.filter((c) => c.sql.includes("INSERT INTO hosting_suspension_log"));
    assert.equal(logged.length, 1);
    assert.match(logged[0].sql, /'flag'.*'auto_flag'/);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /bakery-pickup-1/);
    assert.match(sent[0], /정지하지 않았어요/);

    // 몰림이 끝나면 방문자는 곧바로 앱을 본다(410이 아니다).
    const after = await handle(req("bakery-pickup-1.simsa.page", "/", { headers: NAV }), env({ HOSTING_SUSPENDED: kv, HOSTING_PAGE_RATE_LIMITER: fakeLimiter(true), HOSTING_REQUEST_RATE_LIMITER: fakeLimiter(true), HOSTING_RATE_LIMITER: fakeLimiter(true) }), fakeCtx(), new Date(t0 + 16 * 60_000));
    assert.equal(after.status, 200);
  });
});

// ─── ③ 예약 경로 · 신고 사이트 ─────────────────────────────────────────────────

describe("예약 경로는 유저 앱으로 새지 않는다", () => {
  it("★앱 주소의 /.well-known/simsa-report → 302 report.<root>/?app=<slug> (옛 코드: 유저 앱이 받음)", async () => {
    const r = await run(req("app-abc.simsa.page", "/.well-known/simsa-report"), env({ DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "https://report.simsa.page/?app=app-abc");
  });

  it("★정지된 앱에서도 신고 입구는 열려 있다", async () => {
    const kv = fakeKv({ "suspended:bad-app": "{}" });
    const r = await run(req("bad-app.simsa.page", "/.well-known/simsa-report"), env({ HOSTING_SUSPENDED: kv, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 302);
  });

  it("★/.well-known/simsa-* 나머지 → 404(유저 앱으로 안 감), 다른 .well-known은 유저 앱 몫", async () => {
    for (const p of ["/.well-known/simsa-anything", "/.well-known/simsa-report/x", "/.well-known/simsa-"]) {
      const r = await run(req("app-abc.simsa.page", p), env({ DISPATCHER: neverDispatch }), fakeCtx());
      assert.equal(r.status, 404, p);
    }
    const calls = [];
    const r = await run(req("app-abc.simsa.page", "/.well-known/security.txt"), env({ DISPATCHER: dispatcher(calls) }), fakeCtx());
    assert.equal(r.status, 200);
    assert.deepEqual(calls, ["app-abc"]);
  });

  it("reservedPathKind 순수 판정", () => {
    assert.equal(route.reservedPathKind?.("/.well-known/simsa-health"), "health");
    assert.equal(route.reservedPathKind?.("/.well-known/simsa-report"), "report");
    assert.equal(route.reservedPathKind?.("/.well-known/simsa-x"), "unknown");
    assert.equal(route.reservedPathKind?.("/.well-known/acme-challenge/abc"), null);
    assert.equal(route.reservedPathKind?.("/simsa-report"), null);
  });
});

describe("신고 사이트 report.<root>", () => {
  it("★◆GET / → 200 신고 폼(KO) · form-action = API origin + 신고 사이트 origin(303 복귀 허용) · Referrer-Policy strict-origin (8097ac2: form-action에 복귀처 없음·no-referrer)", async () => {
    const r = await run(req("report.simsa.page", "/?app=app-abc", { headers: { "accept-language": "ko" } }), env({ ...OPEN, SIMSA_API_BASE: API, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 200);
    const csp = r.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    const formAction = /(?:^|;\s*)form-action ([^;]+)/.exec(csp)?.[1]?.trim().split(/\s+/) ?? [];
    assert.deepEqual(formAction.sort(), [API, "https://report.simsa.page"].sort(), csp);
    assert.doesNotMatch(csp, /script-src/, "스크립트 없음");
    assert.equal(r.headers.get("referrer-policy"), "strict-origin", "no-referrer면 교차 origin 폼 전송의 Origin이 'null'");
    const body = await r.text();
    assert.match(body, /<form method="post" action="https:\/\/conclave-ai\.seunghunbae\.workers\.dev\/hosting\/report">/);
    assert.match(body, /value="https:\/\/app-abc\.simsa\.page"/);
    for (const v of ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"]) assert.match(body, new RegExp(`value="${v}"`), v);
    assert.match(body, /name="description"[^>]*maxlength="1000"/);
    assert.match(body, /name="contact"[^>]*maxlength="200"/);
    assert.match(body, /앱 신고하기/);
    assert.match(body, /IP 주소 원문은 저장하지 않아요/);
    assert.match(body, /180일 뒤 지워요/);
    assert.doesNotMatch(body, /<script/i);
  });

  it("◆접수 스위치: HOSTING_REPORTS_ENABLED가 정확히 'on'이 아니면 503 '준비 중' · 폼 없음 (8097ac2: 스위치 없이 200 폼)", async () => {
    for (const flag of [undefined, "off", "true", "ON", "1", " on"]) {
      const r = await run(req("report.simsa.page", "/?app=app-abc&lang=ko"), env({ HOSTING_REPORTS_ENABLED: flag, SIMSA_API_BASE: API }), fakeCtx());
      assert.equal(r.status, 503, String(flag));
      const body = await r.text();
      assert.doesNotMatch(body, /<form/, String(flag));
      assert.match(body, /신고 접수는 아직 준비 중이에요/, String(flag));
      assert.match(r.headers.get("content-security-policy") ?? "", /form-action 'none'/);
    }
  });

  it("★?app=에 이상한 값 → 싣지 않는다(XSS·예약어), EN 페이지", async () => {
    for (const bad of ['"><script>alert(1)</script>', "www", "a--b"]) {
      const r = await run(req("report.simsa.page", `/?app=${encodeURIComponent(bad)}&lang=en`), env({ ...OPEN, SIMSA_API_BASE: API }), fakeCtx());
      const body = await r.text();
      assert.equal(r.status, 200);
      assert.doesNotMatch(body, /<script>alert/);
      assert.match(body, /name="app" required maxlength="300" value=""/, bad);
      assert.match(body, /Report an app/);
    }
  });

  it("★접수 결과 표시(?sent=1 · ?error=limit · app_limit · closed)", async () => {
    const e = env({ ...OPEN, SIMSA_API_BASE: API });
    const sent = await (await run(req("report.simsa.page", "/?app=app-abc&sent=1&lang=ko"), e, fakeCtx())).text();
    assert.match(sent, /신고가 접수됐어요/);
    const limit = await (await run(req("report.simsa.page", "/?error=limit&lang=en"), e, fakeCtx())).text();
    assert.match(limit, /today&#39;s report limit/);
    const appLimit = await (await run(req("report.simsa.page", "/?app=app-abc&error=app_limit&lang=ko"), e, fakeCtx())).text();
    assert.match(appLimit, /이미 많이 들어와 운영자가 확인하고 있어요/);
    const closed = await (await run(req("report.simsa.page", "/?error=closed&lang=ko"), e, fakeCtx())).text();
    assert.match(closed, /준비 중/);
  });

  it("★SIMSA_API_BASE 없음(또는 https 아님) → 503 · 폼 없음(받는 척하지 않는다)", async () => {
    for (const base of [undefined, "http://insecure.example", "not a url"]) {
      const r = await run(req("report.simsa.page", "/?lang=ko"), env({ ...OPEN, SIMSA_API_BASE: base }), fakeCtx());
      assert.equal(r.status, 503, String(base));
      const body = await r.text();
      assert.doesNotMatch(body, /<form/);
      assert.match(body, /지금은 신고를 받을 수 없어요/);
    }
  });

  it("★◆/rules → 200 이용 규칙(KO/EN) · 신고 링크 · 이의는 이용약관 문의처 · '요청 몰림만으로 정지하지 않음' (8097ac2: '자동으로 잠시 정지될 수 있어요')", async () => {
    const ko = await run(req("report.simsa.page", "/rules", { headers: { "accept-language": "ko" } }), env(), fakeCtx());
    assert.equal(ko.status, 200);
    const t = await ko.text();
    assert.match(t, /Simsa 호스팅 이용 규칙/);
    for (const w of ["피싱", "스팸", "성인 콘텐츠", "악성 프로그램", "불법 콘텐츠", "이의 제기"]) assert.match(t, new RegExp(w), w);
    assert.match(t, /https:\/\/app\.trysimsa\.com\/legal\/terms/);
    assert.match(t, /요청이 몰렸다는 것만으로 정지하지는 않아요/);
    assert.doesNotMatch(t, /자동으로 잠시 정지/);
    const en = await (await run(req("report.simsa.page", "/rules?lang=en"), env(), fakeCtx())).text();
    assert.match(en, /Simsa hosting rules/);
    assert.match(en, /Heavy traffic alone never suspends an app/);
  });

  it("신고 사이트: POST → 405 · 모르는 경로 → 404 · 유저 앱 호출 없음", async () => {
    assert.equal((await run(req("report.simsa.page", "/", { method: "POST" }), env({ ...OPEN, SIMSA_API_BASE: API, DISPATCHER: neverDispatch }), fakeCtx())).status, 405);
    assert.equal((await run(req("report.simsa.page", "/admin"), env({ DISPATCHER: neverDispatch }), fakeCtx())).status, 404);
  });

  it("hostingReportUrl · hostingRulesUrl 헬퍼", () => {
    assert.equal(route.hostingReportUrl?.("app-abc", ROOT), "https://report.simsa.page/?app=app-abc");
    assert.equal(route.hostingReportUrl?.("www", ROOT), "https://report.simsa.page/");
    assert.equal(route.hostingRulesUrl?.(ROOT), "https://report.simsa.page/rules");
  });
});

// ─── ④ 헬스 · 배포 SHA ─────────────────────────────────────────────────────────

describe("헬스 경로 · x-simsa-dispatch-sha", () => {
  it("★◆/.well-known/simsa-health → 200 JSON(SHA·바인딩 상태) — 어느 호스트든 · 상한 수치는 싣지 않는다 (8097ac2: rateLimit {limit:600} 공개)", async () => {
    const e = env({ ...OPEN, DEPLOYED_SHA: "3a1ca07deadbeef", HOSTING_SUSPENDED: fakeKv(), HOSTING_PAGE_RATE_LIMITER: fakeLimiter(), SIMSA_API_BASE: API, DISPATCHER: neverDispatch });
    for (const host of ["status.simsa.page", "app-abc.simsa.page", "report.simsa.page"]) {
      const r = await run(req(host, "/.well-known/simsa-health"), e, fakeCtx());
      assert.equal(r.status, 200, host);
      assert.equal(r.headers.get("x-simsa-dispatch-sha"), "3a1ca07deadbeef");
      const raw = await r.text();
      const j = JSON.parse(raw);
      assert.deepEqual(j, { ok: true, service: "simsa-hosting-dispatch", sha: "3a1ca07deadbeef", hostingRoot: "simsa.page", suspensionList: "bound", rateLimiter: "partial", reportIntake: "configured" });
      assert.equal("rateLimit" in j, false, "상한 수치 필드 없음");
      assert.doesNotMatch(raw, /\b(600|6000)\b|periodSeconds/, "상한 수치 없음");
    }
    const off = await (await run(req("status.simsa.page", "/.well-known/simsa-health"), env({ SIMSA_API_BASE: API }), fakeCtx())).json();
    assert.equal(off.reportIntake, "off");
    assert.equal(off.rateLimiter, "unbound");
  });

  it("★SHA 헤더는 모든 응답에(유저 앱·404·410·503) · 없으면 unknown", async () => {
    const e = env({ DEPLOYED_SHA: "abc1234" });
    assert.equal((await run(req("app-abc.simsa.page"), e, fakeCtx())).headers.get("x-simsa-dispatch-sha"), "abc1234");
    assert.equal((await run(req("www.simsa.page"), e, fakeCtx())).headers.get("x-simsa-dispatch-sha"), "abc1234");
    const kv = fakeKv({ "suspended:bad-app": "{}" });
    assert.equal((await run(req("bad-app.simsa.page"), env({ DEPLOYED_SHA: "abc1234", HOSTING_SUSPENDED: kv }), fakeCtx())).headers.get("x-simsa-dispatch-sha"), "abc1234");
    const unconfigured = await run(req("app-abc.simsa.page"), { DISPATCHER: neverDispatch }, fakeCtx());
    assert.equal(unconfigured.status, 503);
    assert.equal(unconfigured.headers.get("x-simsa-dispatch-sha"), "unknown");
  });
});

// ─── ⑤ 설정·워크플로·카피 — [형태 가드](회귀 증거 아님) ───────────────────────────

/** 주석(#)이 아닌 줄만. */
const liveLines = (toml) => toml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("[형태 가드] wrangler.toml 락스텝", () => {
  const toml = readFileSync(path.join(HERE, "..", "wrangler.toml"), "utf8");
  const live = liveLines(toml);
  it("[형태 가드] [[ratelimits]] 두 겹의 limit·period = HOSTING_RATE_LIMITS 상수(한 곳이 바뀌면 둘 다) · namespace_id 서로 다름", () => {
    const blocks = [...live.matchAll(/\[\[ratelimits\]\]([\s\S]*?)(?=\n\[|$)/g)].map((m) => m[1]);
    const byName = new Map(blocks.map((b) => [/name\s*=\s*"([^"]+)"/.exec(b)?.[1], b]));
    const ids = [];
    for (const tier of ["page", "request"]) {
      const want = route.HOSTING_RATE_LIMITS?.[tier];
      assert.ok(want, `HOSTING_RATE_LIMITS.${tier}`);
      const b = byName.get(want.binding);
      assert.ok(b, `[[ratelimits]] ${want.binding}`);
      ids.push(/namespace_id\s*=\s*"(\d+)"/.exec(b)?.[1]);
      assert.equal(Number(/limit\s*=\s*(\d+)/.exec(b)?.[1]), want.limit, tier);
      const period = Number(/period\s*=\s*(\d+)/.exec(b)?.[1]);
      assert.equal(period, want.periodSeconds, tier);
      assert.ok([10, 60].includes(period), "바인딩 제약: 10 또는 60초");
    }
    assert.equal(new Set(ids).size, 2, `namespace_id 겹침: ${ids}`);
    assert.doesNotMatch(live, /name\s*=\s*"HOSTING_RATE_LIMITER"/, "옛 한 겹 바인딩은 없다");
  });
  it("[형태 가드] KV HOSTING_SUSPENDED: 주석 자리(KV 생성 전)이거나, 주석이 풀렸으면 32자리 hex id — 가짜 id 금지 · central-plane과 같은 id", () => {
    const cpToml = readFileSync(path.join(REPO, "apps", "central-plane", "wrangler.toml"), "utf8");
    for (const [name, t] of [["hosting-dispatch", toml], ["central-plane", cpToml]]) {
      const liveBinding = /\[\[kv_namespaces\]\]\s*\nbinding\s*=\s*"HOSTING_SUSPENDED"\s*\nid\s*=\s*"([^"]*)"/.exec(liveLines(t));
      if (liveBinding) {
        assert.match(liveBinding[1], /^[0-9a-f]{32}$/, `${name}: 실제 KV id`);
      } else {
        assert.match(t, /^# \[\[kv_namespaces\]\]\s*\n# binding = "HOSTING_SUSPENDED"\s*\n# id = "<simsa-hosting-suspended KV ID>"/m, `${name}: 주석 자리`);
      }
    }
    const ids = [toml, cpToml].map((t) => /\[\[kv_namespaces\]\]\s*\nbinding\s*=\s*"HOSTING_SUSPENDED"\s*\nid\s*=\s*"([^"]*)"/.exec(liveLines(t))?.[1] ?? null);
    assert.ok(ids[0] === ids[1], `두 Worker가 같은 네임스페이스여야 한다: ${ids}`);
  });
  it("[형태 가드] SIMSA_API_BASE는 https · 신고 스위치 기본 off · SHA는 파일에 박지 않는다", () => {
    const base = /^SIMSA_API_BASE\s*=\s*"([^"]+)"/m.exec(live)?.[1];
    assert.equal(base, API);
    assert.equal(/^HOSTING_REPORTS_ENABLED\s*=\s*"([^"]*)"/m.exec(live)?.[1], "off", "방침 고지 전엔 꺼 둔다");
    assert.doesNotMatch(live, /^DEPLOYED_SHA\s*=/m, "SHA는 배포 때 --var로만(파일에 박지 않는다)");
  });
});

describe("[형태 가드] deploy-hosting-dispatch.yml 정적 검사", () => {
  const WF = path.join(REPO, ".github", "workflows", "deploy-hosting-dispatch.yml");
  const wf = existsSync(WF) ? readFileSync(WF, "utf8") : "";
  it("[형태 가드] 파일이 있고 workflow_dispatch 전용(push·pull_request·schedule 트리거 없음)", () => {
    assert.ok(wf, "workflow file exists");
    const on = /^on:\n([\s\S]*?)^\S/m.exec(wf)?.[1] ?? "";
    assert.match(on, /^\s{2}workflow_dispatch:/m);
    for (const t of ["push:", "pull_request:", "pull_request_target:", "schedule:", "workflow_run:", "repository_dispatch:"]) {
      assert.ok(!new RegExp(`^\\s{2}${t}`, "m").test(on), `no ${t} trigger`);
    }
  });
  it("[형태 가드] main 전용 · confirm 입력 'deploy' · 동시 실행 1", () => {
    assert.match(wf, /confirm:\s*\n\s+description:[^\n]*\n\s+required:\s*true/);
    assert.match(wf, /if:\s*github\.ref != 'refs\/heads\/main'/);
    assert.match(wf, /if:\s*inputs\.confirm != 'deploy'/);
    assert.match(wf, /concurrency:\s*\n\s+group:\s*deploy-hosting-dispatch\s*\n\s+cancel-in-progress:\s*false/);
  });
  it("[형태 가드] 빌드·테스트가 배포보다 먼저 · SHA를 --var로 · 기존 시크릿만 · 배포 뒤 헬스 SHA 확인", () => {
    // 주석이 아니라 실제 단계만 본다(jobs: 아래, # 줄 제외).
    const jobs = (wf.split(/^jobs:\s*$/m)[1] ?? "").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const iGate = jobs.search(/refs\/heads\/main/);
    const iBuild = jobs.search(/turbo run build[^\n]*hosting-dispatch/);
    const iTest = jobs.search(/node --test test\/\*\.test\.mjs/);
    const iDeploy = jobs.search(/npx wrangler deploy --var DEPLOYED_SHA:"\$\{GITHUB_SHA\}"/);
    const iVerify = jobs.search(/x-simsa-dispatch-sha/);
    assert.ok(iGate >= 0 && iBuild > iGate && iTest > iBuild && iDeploy > iTest && iVerify > iDeploy, `order gate(${iGate}) < build(${iBuild}) < test(${iTest}) < deploy(${iDeploy}) < verify(${iVerify})`);
    assert.match(jobs, /working-directory:\s*apps\/hosting-dispatch/);
    assert.match(jobs, /\/\.well-known\/simsa-health/);
    const secrets = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(secrets)].sort(), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"], "새 시크릿 없음");
    assert.match(wf, /permissions:\s*\n\s+contents:\s*read/);
  });
});

describe("[형태 가드] 카피 KO/EN 파리티 · 초보자 금칙어 0", () => {
  it("[형태 가드] COPY ko·en 키 동일, 비어 있는 값 없음", () => {
    assert.ok(pagesMod, "pages module");
    const { COPY } = pagesMod;
    const keys = (o) => Object.keys(o).sort();
    assert.deepEqual(keys(COPY.ko), keys(COPY.en));
    assert.deepEqual(keys(COPY.ko.reasons), keys(COPY.en.reasons));
    assert.equal(COPY.ko.rulesBanned.length, COPY.en.rulesBanned.length);
    for (const lang of ["ko", "en"]) {
      for (const [k, v] of Object.entries(COPY[lang])) {
        if (typeof v === "string") assert.ok(v.trim().length > 0, `${lang}.${k}`);
      }
    }
  });
  it("[형태 가드] 정지·상한·신고(열림·준비 중)·규칙 페이지 본문에 개발 용어 0(beginner-terms)", async () => {
    assert.ok(pagesMod, "pages module");
    const { devTermHits } = await import(path.join(REPO, "tools/simsa-completion-loop-spike/lib/beginner-terms.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
    const visible = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const lang of ["ko", "en"]) {
      const pages = [
        pagesMod.suspendedPage(lang, ROOT),
        pagesMod.rateLimitedPage(lang),
        pagesMod.reportSitePage({ lang, slug: "app-abc", rootDomain: ROOT, apiBase: API, status: "sent" }),
        pagesMod.reportSitePage({ lang, slug: "app-abc", rootDomain: ROOT, apiBase: API, status: null, open: false }),
        pagesMod.rulesPage(lang, ROOT),
      ];
      for (const html of pages) assert.deepEqual(devTermHits(visible(html)), [], `${lang}: ${visible(html).slice(0, 80)}`);
    }
  });
  it("신고 사유 값 = 폼 라디오 값(central-plane SUSPENSION_REASONS와의 대조는 아래 락스텝)", () => {
    assert.ok(pagesMod, "pages module");
    assert.deepEqual([...pagesMod.REPORT_REASON_VALUES], ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"]);
  });
});

describe("[형태 가드] central-plane과 락스텝", () => {
  it("[형태 가드] KV 키 접두어·strike 키·신고 주소·사유 값·폼 결과 코드·신고 사이트 origin이 central-plane과 같다", async () => {
    const cp = await import("../../central-plane/dist/workspace/hosting-duties.js").catch(() => null);
    const cpRoutes = await import("../../central-plane/dist/routes/hosting-duties.js").catch(() => null);
    assert.ok(cp, "central-plane dist/workspace/hosting-duties.js");
    assert.ok(cpRoutes, "central-plane dist/routes/hosting-duties.js");
    assert.equal(cp.SUSPENDED_KEY_PREFIX, route.SUSPENDED_KEY_PREFIX);
    assert.equal(cp.STRIKE_KEY_PREFIX, route.STRIKE_KEY_PREFIX);
    assert.equal(cp.suspendedKey("app-abc"), route.suspendedKey("app-abc"));
    const now = new Date("2026-09-30T14:12:33Z");
    assert.deepEqual(cp.parseStrikeKey(route.strikeKey("app-abc", now)), { slug: "app-abc", minute: "202609301412" });
    assert.equal(cp.hostingReportUrl("app-abc", ROOT), route.hostingReportUrl("app-abc", ROOT));
    assert.equal(cp.hostingRulesUrl(ROOT), route.hostingRulesUrl(ROOT));
    assert.deepEqual([...cp.SUSPENSION_REASONS], [...pagesMod.REPORT_REASON_VALUES]);
    assert.deepEqual([...cpRoutes.FORM_STATUS_VALUES], [...pagesMod.REPORT_STATUS_VALUES]);
    assert.equal(cp.reportSiteOrigin(ROOT), pagesMod.reportSiteOrigin(ROOT));
  });
});

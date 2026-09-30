/**
 * SI 티어 Train B — B-7 호스팅 사업자 의무(D-6): 정지 목록(KV)·신고 사이트·요청 상한·헬스/SHA·배포 워크플로.
 *
 * 모든 바인딩은 가짜(KV Map·Rate Limiter·DISPATCHER) — 네트워크 없음.
 * ★표시 테스트는 옛 코드(B2 라우터)에서 실패해야 한다(PR 본문 표).
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
  };
  return kv;
}

function fakeLimiter(allow = true) {
  const rl = { calls: [], allow, async limit(o) { rl.calls.push(o); return { success: rl.allow }; } };
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
    assert.match(body, /이용 규칙 위반 신고/);
    assert.match(body, /https:\/\/report\.simsa\.page\/rules/);
    // 소유자·사유 세부·메모는 싣지 않는다
    assert.doesNotMatch(body, /phishing|피싱/);
    assert.deepEqual(kv.gets[0], { key: "suspended:bad-app", opts: { cacheTtl: 30 } }, "cacheTtl = KV 하한 30초");
  });

  it("★영어 요청 → 영어 안내 · 자동 정지(source=auto)는 요청 초과 문구", async () => {
    const kv = fakeKv({ "suspended:busy-app": JSON.stringify({ v: 1, reason: "abuse_other", source: "auto" }) });
    const r = await run(req("busy-app.simsa.page", "/", { headers: { "accept-language": "en-US,en;q=0.8" } }), env({ HOSTING_SUSPENDED: kv, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 410);
    const body = await r.text();
    assert.match(body, /<html lang="en">/);
    assert.match(body, /kept getting more requests than allowed/);
    assert.doesNotMatch(body, /rules violation/);
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

describe("요청 상한(HOSTING_RATE_LIMITER)", () => {
  it("★실제 진입점: 상한 초과 → 429 (옛 코드: 200 유저 앱)", async () => {
    const calls = [];
    const r = await run(req("app-abc.simsa.page"), env({ HOSTING_RATE_LIMITER: fakeLimiter(false), DISPATCHER: dispatcher(calls) }));
    assert.equal(r.status, 429);
    assert.deepEqual(calls, [], "유저 앱 호출 없음");
  });

  it("★상한 초과 → 429 + Retry-After 60 + 분 단위 strike 기록(유저 앱으로 안 감)", async () => {
    const kv = fakeKv();
    const rl = fakeLimiter(false);
    const ctx = fakeCtx();
    const now = new Date("2026-09-30T14:12:33Z");
    const r = await handle(req("app-abc.simsa.page", "/", { headers: { "accept-language": "ko" } }), env({ HOSTING_SUSPENDED: kv, HOSTING_RATE_LIMITER: rl, DISPATCHER: neverDispatch }), ctx, now);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
    assert.equal(r.headers.get("x-simsa-hosted"), "app-abc");
    assert.match(await r.text(), /잠시 후 다시 시도해 주세요/);
    assert.deepEqual(rl.calls, [{ key: "app-abc" }], "slug당 — 키는 slug(IP 아님)");
    await Promise.all(ctx.promises);
    assert.deepEqual(kv.puts, [{ key: "strike:app-abc:202609301412", value: "1", opts: { expirationTtl: 7200 } }]);
    // 같은 분 두 번째 429는 KV를 다시 쓰지 않는다(같은 키 쓰기 한도)
    await handle(req("app-abc.simsa.page"), env({ HOSTING_SUSPENDED: kv, HOSTING_RATE_LIMITER: rl, DISPATCHER: neverDispatch }), ctx, now);
    await Promise.all(ctx.promises);
    assert.equal(kv.puts.length, 1);
  });

  it("상한 이내 → 유저 앱 200", async () => {
    const rl = fakeLimiter(true);
    const r = await run(req("app-abc.simsa.page"), env({ HOSTING_RATE_LIMITER: rl, HOSTING_SUSPENDED: fakeKv() }), fakeCtx());
    assert.equal(r.status, 200);
    assert.equal(rl.calls.length, 1);
  });

  it("★정지된 앱은 상한을 소모하지 않는다(410이 먼저)", async () => {
    const rl = fakeLimiter(true);
    const kv = fakeKv({ "suspended:bad-app": "{}" });
    const r = await run(req("bad-app.simsa.page"), env({ HOSTING_RATE_LIMITER: rl, HOSTING_SUSPENDED: kv, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 410);
    assert.equal(rl.calls.length, 0);
  });

  it("★상한 바인딩 없음·오류 → 서빙 + 로그(상한이 우리 사정으로 앱을 막지 않는다)", async () => {
    const broken = { async limit() { throw new Error("rate limiter unavailable"); } };
    const { r, lines } = await captureLogs(async () => [
      await run(req("app-abc.simsa.page"), env({ HOSTING_SUSPENDED: fakeKv() }), fakeCtx()),
      await run(req("app-abc.simsa.page"), env({ HOSTING_SUSPENDED: fakeKv(), HOSTING_RATE_LIMITER: broken }), fakeCtx()),
    ]);
    assert.deepEqual(r.map((x) => x.status), [200, 200]);
    assert.ok(lines.some((l) => l.includes("hosting_rate_limit_unchecked")), lines.join("\n"));
    assert.ok(lines.some((l) => l.includes("hosting_rate_limit_check_failed")), lines.join("\n"));
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
  it("★GET / → 200 신고 폼(KO) · 전송처 = SIMSA_API_BASE/hosting/report · 앱 주소 미리 채움 · 액자 금지 (옛 코드: 404 예약어)", async () => {
    const r = await run(req("report.simsa.page", "/?app=app-abc", { headers: { "accept-language": "ko" } }), env({ SIMSA_API_BASE: API, DISPATCHER: neverDispatch }), fakeCtx());
    assert.equal(r.status, 200);
    const csp = r.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, new RegExp(`form-action ${API.replace(/\./g, "\\.")}`));
    assert.doesNotMatch(csp, /script-src/, "스크립트 없음");
    const body = await r.text();
    assert.match(body, /<form method="post" action="https:\/\/conclave-ai\.seunghunbae\.workers\.dev\/hosting\/report">/);
    assert.match(body, /value="https:\/\/app-abc\.simsa\.page"/);
    for (const v of ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"]) assert.match(body, new RegExp(`value="${v}"`), v);
    assert.match(body, /name="description"[^>]*maxlength="1000"/);
    assert.match(body, /name="contact"[^>]*maxlength="200"/);
    assert.match(body, /앱 신고하기/);
    assert.match(body, /IP 주소 원문은 저장하지 않아요/);
    assert.doesNotMatch(body, /<script/i);
  });

  it("★?app=에 이상한 값 → 싣지 않는다(XSS·예약어), EN 페이지", async () => {
    for (const bad of ['"><script>alert(1)</script>', "www", "a--b"]) {
      const r = await run(req("report.simsa.page", `/?app=${encodeURIComponent(bad)}&lang=en`), env({ SIMSA_API_BASE: API }), fakeCtx());
      const body = await r.text();
      assert.equal(r.status, 200);
      assert.doesNotMatch(body, /<script>alert/);
      assert.match(body, /name="app" required maxlength="300" value=""/, bad);
      assert.match(body, /Report an app/);
    }
  });

  it("★접수 결과 표시(?sent=1 · ?error=limit)", async () => {
    const sent = await (await run(req("report.simsa.page", "/?app=app-abc&sent=1&lang=ko"), env({ SIMSA_API_BASE: API }), fakeCtx())).text();
    assert.match(sent, /신고가 접수됐어요/);
    const limit = await (await run(req("report.simsa.page", "/?error=limit&lang=en"), env({ SIMSA_API_BASE: API }), fakeCtx())).text();
    assert.match(limit, /today&#39;s report limit/);
  });

  it("★SIMSA_API_BASE 없음(또는 https 아님) → 503 · 폼 없음(받는 척하지 않는다)", async () => {
    for (const base of [undefined, "http://insecure.example", "not a url"]) {
      const r = await run(req("report.simsa.page", "/?lang=ko"), env({ SIMSA_API_BASE: base }), fakeCtx());
      assert.equal(r.status, 503, String(base));
      const body = await r.text();
      assert.doesNotMatch(body, /<form/);
      assert.match(body, /지금은 신고를 받을 수 없어요/);
    }
  });

  it("★/rules → 200 이용 규칙(KO/EN) · 신고 링크 · 이의는 이용약관 문의처", async () => {
    const ko = await run(req("report.simsa.page", "/rules", { headers: { "accept-language": "ko" } }), env(), fakeCtx());
    assert.equal(ko.status, 200);
    const t = await ko.text();
    assert.match(t, /Simsa 호스팅 이용 규칙/);
    for (const w of ["피싱", "스팸", "성인 콘텐츠", "악성 프로그램", "불법 콘텐츠", "이의 제기"]) assert.match(t, new RegExp(w), w);
    assert.match(t, /https:\/\/app\.trysimsa\.com\/legal\/terms/);
    const en = await (await run(req("report.simsa.page", "/rules?lang=en"), env(), fakeCtx())).text();
    assert.match(en, /Simsa hosting rules/);
  });

  it("신고 사이트: POST → 405 · 모르는 경로 → 404 · 유저 앱 호출 없음", async () => {
    assert.equal((await run(req("report.simsa.page", "/", { method: "POST" }), env({ SIMSA_API_BASE: API, DISPATCHER: neverDispatch }), fakeCtx())).status, 405);
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
  it("★/.well-known/simsa-health → 200 JSON(SHA·바인딩 상태) — 어느 호스트든 (옛 코드: 유저 앱/404)", async () => {
    const e = env({ DEPLOYED_SHA: "3a1ca07deadbeef", HOSTING_SUSPENDED: fakeKv(), SIMSA_API_BASE: API, DISPATCHER: neverDispatch });
    for (const host of ["status.simsa.page", "app-abc.simsa.page", "report.simsa.page"]) {
      const r = await run(req(host, "/.well-known/simsa-health"), e, fakeCtx());
      assert.equal(r.status, 200, host);
      assert.equal(r.headers.get("x-simsa-dispatch-sha"), "3a1ca07deadbeef");
      const j = await r.json();
      assert.deepEqual(
        { ok: j.ok, service: j.service, sha: j.sha, hostingRoot: j.hostingRoot, suspensionList: j.suspensionList, rateLimiter: j.rateLimiter, reportIntake: j.reportIntake, limit: j.rateLimit?.limit, period: j.rateLimit?.periodSeconds },
        { ok: true, service: "simsa-hosting-dispatch", sha: "3a1ca07deadbeef", hostingRoot: "simsa.page", suspensionList: "bound", rateLimiter: "unbound", reportIntake: "configured", limit: 600, period: 60 },
      );
    }
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

// ─── ⑤ 설정·워크플로·카피 정적 검사 ─────────────────────────────────────────────

describe("wrangler.toml 락스텝", () => {
  const toml = readFileSync(path.join(HERE, "..", "wrangler.toml"), "utf8");
  it("★[[ratelimits]] HOSTING_RATE_LIMITER의 limit·period = HOSTING_RATE_LIMIT 상수(한 곳이 바뀌면 둘 다)", () => {
    const block = /\[\[ratelimits\]\]([\s\S]*?)(?=\n\[|\n#|$)/.exec(toml);
    assert.ok(block, "[[ratelimits]] 블록");
    assert.match(block[1], /name\s*=\s*"HOSTING_RATE_LIMITER"/);
    assert.match(block[1], /namespace_id\s*=\s*"\d+"/);
    const limit = Number(/limit\s*=\s*(\d+)/.exec(block[1])?.[1]);
    const period = Number(/period\s*=\s*(\d+)/.exec(block[1])?.[1]);
    assert.equal(limit, route.HOSTING_RATE_LIMIT?.limit);
    assert.equal(period, route.HOSTING_RATE_LIMIT?.periodSeconds);
    assert.ok([10, 60].includes(period), "바인딩 제약: 10 또는 60초");
  });
  it("★KV 바인딩 이름 HOSTING_SUSPENDED 자리 · SIMSA_API_BASE는 https", () => {
    assert.match(toml, /binding\s*=\s*"HOSTING_SUSPENDED"/);
    const base = /SIMSA_API_BASE\s*=\s*"([^"]+)"/.exec(toml)?.[1];
    assert.equal(base, API);
    assert.doesNotMatch(toml, /^DEPLOYED_SHA\s*=/m, "SHA는 배포 때 --var로만(파일에 박지 않는다)");
  });
});

describe("deploy-hosting-dispatch.yml 정적 검사", () => {
  const WF = path.join(REPO, ".github", "workflows", "deploy-hosting-dispatch.yml");
  const wf = existsSync(WF) ? readFileSync(WF, "utf8") : "";
  it("★파일이 있고 workflow_dispatch 전용(push·pull_request·schedule 트리거 없음)", () => {
    assert.ok(wf, "workflow file exists");
    const on = /^on:\n([\s\S]*?)^\S/m.exec(wf)?.[1] ?? "";
    assert.match(on, /^\s{2}workflow_dispatch:/m);
    for (const t of ["push:", "pull_request:", "pull_request_target:", "schedule:", "workflow_run:", "repository_dispatch:"]) {
      assert.ok(!new RegExp(`^\\s{2}${t}`, "m").test(on), `no ${t} trigger`);
    }
  });
  it("★main 전용 · confirm 입력 'deploy' · 동시 실행 1", () => {
    assert.match(wf, /confirm:\s*\n\s+description:[^\n]*\n\s+required:\s*true/);
    assert.match(wf, /if:\s*github\.ref != 'refs\/heads\/main'/);
    assert.match(wf, /if:\s*inputs\.confirm != 'deploy'/);
    assert.match(wf, /concurrency:\s*\n\s+group:\s*deploy-hosting-dispatch\s*\n\s+cancel-in-progress:\s*false/);
  });
  it("★빌드·테스트가 배포보다 먼저 · SHA를 --var로 · 기존 시크릿만 · 배포 뒤 헬스 SHA 확인", () => {
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

describe("카피 KO/EN 파리티 · 초보자 금칙어 0", () => {
  it("★COPY ko·en 키 동일, 비어 있는 값 없음", () => {
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
  it("★정지·상한·신고·규칙 페이지 본문에 개발 용어 0(beginner-terms)", async () => {
    assert.ok(pagesMod, "pages module");
    const { devTermHits } = await import(path.join(REPO, "tools/simsa-completion-loop-spike/lib/beginner-terms.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
    const visible = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const lang of ["ko", "en"]) {
      const pages = [
        pagesMod.suspendedPage(lang, "admin", ROOT),
        pagesMod.suspendedPage(lang, "auto", ROOT),
        pagesMod.rateLimitedPage(lang),
        pagesMod.reportSitePage({ lang, slug: "app-abc", rootDomain: ROOT, apiBase: API, status: "sent" }),
        pagesMod.rulesPage(lang, ROOT),
      ];
      for (const html of pages) assert.deepEqual(devTermHits(visible(html)), [], `${lang}: ${visible(html).slice(0, 80)}`);
    }
  });
  it("신고 사유 값 = 폼 라디오 값(central-plane SUSPENSION_REASONS와의 대조는 central-plane 테스트)", () => {
    assert.ok(pagesMod, "pages module");
    assert.deepEqual([...pagesMod.REPORT_REASON_VALUES], ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"]);
  });
});

describe("central-plane과 락스텝", () => {
  it("★KV 키 접두어·strike 키·신고 주소·사유 값이 central-plane hosting-duties와 같다", async () => {
    const cp = await import("../../central-plane/dist/workspace/hosting-duties.js").catch(() => null);
    assert.ok(cp, "central-plane dist/workspace/hosting-duties.js");
    assert.equal(cp.SUSPENDED_KEY_PREFIX, route.SUSPENDED_KEY_PREFIX);
    assert.equal(cp.STRIKE_KEY_PREFIX, route.STRIKE_KEY_PREFIX);
    assert.equal(cp.suspendedKey("app-abc"), route.suspendedKey("app-abc"));
    const now = new Date("2026-09-30T14:12:33Z");
    assert.deepEqual(cp.parseStrikeKey(route.strikeKey("app-abc", now)), { slug: "app-abc", minute: "202609301412" });
    assert.equal(cp.hostingReportUrl("app-abc", ROOT), route.hostingReportUrl("app-abc", ROOT));
    assert.equal(cp.hostingRulesUrl(ROOT), route.hostingRulesUrl(ROOT));
    assert.deepEqual([...cp.SUSPENSION_REASONS], [...pagesMod.REPORT_REASON_VALUES]);
  });
});

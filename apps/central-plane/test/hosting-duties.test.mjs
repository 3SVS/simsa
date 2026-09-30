/**
 * SI 티어 Train B — B-7 호스팅 사업자 의무(D-6) — central-plane 쪽.
 *
 *   ① 관리자 정지/해제 POST /admin/hosting/:slug/{suspend,unsuspend} — 인증·Zod·KV·정지 로그(0073)
 *   ② 신고 POST /hosting/report — Zod(길이)·주소 정규화·HMAC 신고자 키(IP 원문 없음)·남용 상한·운영자 알림
 *   ③ 자동 정지 sweepHostingRateStrikes — 같은 정지 함수·같은 로그
 *   ④ 0073 형태(additive)
 *
 * 가짜 바인딩만(KV Map · D1 기록 모크 또는 node:sqlite 실제 엔진 · Telegram fetch 모크) — 네트워크 없음.
 * node:sqlite 테스트는 Node < 22.13에서 건너뛴다(건너뜀 = 미측정).
 * ★표시는 옛 코드에서 실패해야 한다(PR 본문 표).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { dailyCapsRun } from "./_daily-caps-fake.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { createApp } = await import("../dist/router.js");
const duties = await import("../dist/workspace/hosting-duties.js").catch(() => null);

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const noSqlite = DatabaseSync ? false : "node:sqlite 없음(Node < 22.13) — 미측정";

const ADMIN = "test-admin-bearer-for-hosting-duties";
const KEK = "dGVzdC1rZWstbm90LWEtcmVhbC1zZWNyZXQtMzJieXQ="; // 가짜 값(테스트 전용)
const IP = "203.0.113.7";

// ─── 가짜 바인딩 ───────────────────────────────────────────────────────────────

function fakeKv(init = {}) {
  const m = new Map(Object.entries(init));
  const kv = {
    m,
    puts: [],
    deletes: [],
    failPut: false,
    async get(key) {
      return m.has(key) ? m.get(key) : null;
    },
    async put(key, value, opts) {
      if (kv.failPut) throw new Error("KV PUT failed: 500");
      kv.puts.push({ key, value, opts });
      m.set(key, value);
    },
    async delete(key) {
      kv.deletes.push(key);
      m.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + 2); // 작은 페이지 — 커서 순회를 강제로 탄다
      const next = start + page.length;
      return { keys: page.map((name) => ({ name })), list_complete: next >= names.length, cursor: String(next) };
    },
  };
  return kv;
}

/** 모든 문장을 기록하는 D1 모크(스키마 무관 테스트용). workspace_rate_limit 일일 상한은 실제처럼. */
function recordingD1({ failSql = [] } = {}) {
  const calls = [];
  const rate = new Map();
  return {
    calls,
    rate,
    prepare(sql) {
      const h = (args) => ({
        async run() {
          calls.push({ sql, args });
          const capped = dailyCapsRun(rate, sql, args);
          if (capped) return capped;
          if (failSql.some((f) => sql.includes(f))) throw new Error(`D1_ERROR: fake failure on ${failSql}`);
          return { meta: { changes: 1 } };
        },
        async first() {
          calls.push({ sql, args });
          if (failSql.some((f) => sql.includes(f))) throw new Error("D1_ERROR: fake failure");
          return null;
        },
        async all() {
          calls.push({ sql, args });
          return { results: [] };
        },
      });
      return { bind: (...a) => h(a), ...h([]) };
    },
  };
}

/** D1 모양 어댑터 — node:sqlite 위(0026 요청 한도 + 0073). */
function sqliteD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(here, "..", "migrations", "0026_workspace_rate_limit.sql"), "utf8"));
  db.exec(readFileSync(join(here, "..", "migrations", "0073_hosting_duties.sql"), "utf8"));
  const d1 = {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const h = (args) => ({
        async run() {
          const r = stmt.run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
        async first() {
          return stmt.get(...args) ?? null;
        },
        async all() {
          return { results: stmt.all(...args) };
        },
      });
      return { bind: (...a) => h(a), run: () => h([]).run(), first: () => h([]).first(), all: () => h([]).all() };
    },
  };
  return d1;
}

function telegramFetch() {
  const sent = [];
  const f = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, hasTimeout: init?.signal instanceof AbortSignal });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  f.sent = sent;
  return f;
}

function makeEnv(o = {}) {
  return {
    DB: recordingD1(),
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: ADMIN,
    HOSTING_ROOT_DOMAIN: "simsa.page",
    HOSTING_SUSPENDED: fakeKv(),
    CONCLAVE_TOKEN_KEK: KEK,
    ...o,
  };
}

async function call(env, method, path, { body, headers = {}, fetchImpl, form } = {}) {
  const app = createApp(fetchImpl ? { fetch: fetchImpl } : {});
  const init = { method, headers: { ...headers } };
  if (form) {
    init.body = new URLSearchParams(form).toString();
    init.headers["content-type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const res = await app.fetch(new Request(`https://conclave-ai.example${path}`, init), env);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const bearer = { authorization: `Bearer ${ADMIN}` };
const wrote = (db, table) => db.calls.filter((c) => c.sql.includes(table) && /INSERT|UPDATE/.test(c.sql));

// ─── ① 관리자 정지/해제 ────────────────────────────────────────────────────────

describe("관리자 정지/해제 — 인증", () => {
  it("★토큰 없음/틀림 → 401, 서버 토큰 미설정 → 503 — 어느 경우도 KV·D1 무변경 (옛 코드: 404)", async () => {
    for (const [headers, token, want] of [
      [{}, ADMIN, 401],
      [{ authorization: "Bearer wrong-token" }, ADMIN, 401],
      [{ authorization: ADMIN }, ADMIN, 401], // Bearer 접두어 없음
      [bearer, undefined, 503],
    ]) {
      const env = makeEnv({ INTERNAL_CALLBACK_TOKEN: token });
      const r = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "phishing" }, headers });
      assert.equal(r.status, want, JSON.stringify(headers));
      assert.equal(env.HOSTING_SUSPENDED.puts.length, 0);
      assert.equal(env.DB.calls.length, 0);
    }
    const env = makeEnv();
    assert.equal((await call(env, "POST", "/admin/hosting/bad-app/unsuspend", { body: {} })).status, 401);
    assert.equal((await call(env, "GET", "/admin/hosting/bad-app")).status, 401);
  });
});

describe("관리자 정지 — Zod · slug", () => {
  it("★사유 enum 밖·메모 1000자 초과·모르는 키·본문 없음 → 400 (KV 무변경)", async () => {
    for (const body of [{ reason: "fraud" }, { reason: "phishing", memo: "가".repeat(1001) }, { reason: "phishing", extra: 1 }, {}, "not json"]) {
      const env = makeEnv();
      const r = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body, headers: bearer });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(r.json?.error, "invalid_body");
      assert.equal(env.HOSTING_SUSPENDED.puts.length, 0);
    }
  });
  it("★잘못된 slug·예약어 → 400 invalid_slug", async () => {
    for (const slug of ["a--b", "www", "report", "ab", "UPPER"]) {
      const env = makeEnv();
      const r = await call(env, "POST", `/admin/hosting/${slug}/suspend`, { body: { reason: "spam" }, headers: bearer });
      assert.equal(r.status, 400, slug);
      assert.equal(r.json?.error, "invalid_slug");
    }
  });
});

describe("관리자 정지 — KV · 정지 로그", () => {
  it("★정지 → KV suspended:<slug> = {reason, source:admin} + 로그 INSERT(applied 0) → UPDATE applied 1 (옛 코드: 404)", async () => {
    const env = makeEnv();
    const r = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "phishing", memo: "가짜 은행 로그인 화면 — (주)트루픽셀 신고 3건" }, headers: bearer });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.applied, true);
    assert.equal(r.json.slug, "bad-app");
    assert.equal(r.json.propagationSeconds, 60);
    const v = JSON.parse(env.HOSTING_SUSPENDED.m.get("suspended:bad-app"));
    assert.deepEqual({ v: v.v, reason: v.reason, source: v.source, logId: v.logId }, { v: 1, reason: "phishing", source: "admin", logId: r.json.logId });
    const ins = wrote(env.DB, "hosting_suspension_log");
    assert.match(ins[0].sql, /INSERT INTO hosting_suspension_log/);
    assert.deepEqual(ins[0].args.slice(1, 7), ["bad-app", "suspend", "phishing", "admin", "admin", "가짜 은행 로그인 화면 — (주)트루픽셀 신고 3건"]);
    assert.match(ins[1].sql, /UPDATE hosting_suspension_log SET applied = 1/);
    // D1 먼저, KV 나중(기록 없는 정지는 없다)
    const iLog = env.DB.calls.findIndex((c) => c.sql.includes("INSERT INTO hosting_suspension_log"));
    assert.ok(iLog >= 0);
  });

  it("★KV 바인딩 없음 → 503 suspension_store_not_configured (정지된 척하지 않는다, 로그 없음)", async () => {
    const env = makeEnv({ HOSTING_SUSPENDED: undefined });
    const r = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "spam" }, headers: bearer });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "suspension_store_not_configured");
    assert.equal(wrote(env.DB, "hosting_suspension_log").length, 0);
  });

  it("★로그를 못 쓰면 KV도 건드리지 않는다 → 503 log_unavailable", async () => {
    const env = makeEnv({ DB: recordingD1({ failSql: ["INSERT INTO hosting_suspension_log"] }) });
    const r = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "malware" }, headers: bearer });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "log_unavailable");
    assert.equal(env.HOSTING_SUSPENDED.puts.length, 0);
  });

  it("★KV 쓰기 실패 → 503 suspension_store_failed · 로그 행은 applied 0으로 남는다(UPDATE 없음)", async () => {
    const kv = fakeKv();
    kv.failPut = true;
    const env = makeEnv({ HOSTING_SUSPENDED: kv });
    const r = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "illegal" }, headers: bearer });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "suspension_store_failed");
    assert.ok(r.json.logId, "시도의 기록 id");
    assert.equal(env.DB.calls.filter((c) => c.sql.includes("SET applied = 1")).length, 0);
  });

  it("★해제 → KV 키 삭제 + 로그 action=unsuspend (옛 코드: 404)", async () => {
    const kv = fakeKv({ "suspended:bad-app": JSON.stringify({ v: 1, reason: "spam", source: "admin" }) });
    const env = makeEnv({ HOSTING_SUSPENDED: kv });
    const r = await call(env, "POST", "/admin/hosting/bad-app/unsuspend", { body: { memo: "소유자 이의 확인 — 오탐" }, headers: bearer });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.action, "unsuspend");
    assert.equal(kv.m.has("suspended:bad-app"), false);
    assert.deepEqual(kv.deletes, ["suspended:bad-app"]);
    const ins = wrote(env.DB, "INSERT INTO hosting_suspension_log");
    assert.deepEqual(ins[0].args.slice(1, 5), ["bad-app", "unsuspend", null, "admin"]);
  });

  it("해제는 본문 없이도 된다", async () => {
    const env = makeEnv({ HOSTING_SUSPENDED: fakeKv({ "suspended:bad-app": "{}" }) });
    const r = await call(env, "POST", "/admin/hosting/bad-app/unsuspend", { headers: bearer });
    assert.equal(r.status, 200, r.text);
  });

  it("★실제 SQLite(0073): 정지 → 해제 두 행 모두 applied=1 · 신고는 정지 때 actioned · GET 상태", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const env = makeEnv({ DB });
    // 신고 1건 먼저
    const rep = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "phishing", description: "결제 화면이 은행을 흉내 냄" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(rep.status, 200, rep.text);
    assert.equal((await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "phishing" }, headers: bearer })).status, 200);
    assert.equal((await call(env, "POST", "/admin/hosting/bad-app/unsuspend", { body: {}, headers: bearer })).status, 200);
    const rows = DB.raw.prepare("SELECT slug, action, reason, source, actor, applied, applied_at FROM hosting_suspension_log ORDER BY created_at, action DESC").all();
    assert.deepEqual(rows.map((r) => [r.slug, r.action, r.reason, r.source, r.actor, r.applied]), [
      ["bad-app", "suspend", "phishing", "admin", "admin", 1],
      ["bad-app", "unsuspend", null, "admin", "admin", 1],
    ]);
    assert.ok(rows.every((r) => typeof r.applied_at === "string"));
    assert.equal(DB.raw.prepare("SELECT status FROM hosting_reports").get().status, "actioned");
    const st = await call(env, "GET", "/admin/hosting/bad-app", { headers: bearer });
    assert.equal(st.status, 200);
    assert.equal(st.json.suspended, false);
    assert.equal(st.json.log.length, 2);
    assert.equal(st.json.reports.length, 1);
    // CHECK 제약이 살아 있다
    assert.throws(() => DB.raw.prepare("INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, created_at) VALUES ('x','y','suspend','fraud','admin','admin','t')").run(), /CHECK constraint failed/);
  });
});

// ─── ② 신고 ────────────────────────────────────────────────────────────────────

describe("신고 POST /hosting/report", () => {
  it("★JSON 신고 → 200 + 행 저장(IP 원문 없음, v1: HMAC 키) (옛 코드: 404)", async () => {
    const env = makeEnv();
    const r = await call(env, "POST", "/hosting/report", {
      body: { app: "https://Bakery-Pickup-1.simsa.page/menu?x=1", reason: "phishing", description: "(주)트루픽셀 예약 앱이라더니 카드 번호를 물어봐요", contact: "제보자 연락처 test@example.com", lang: "ko" },
      headers: { "cf-connecting-ip": IP },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.match(r.json.reportId, /^hrp_/);
    const ins = wrote(env.DB, "INSERT INTO hosting_reports")[0];
    assert.ok(ins, "insert");
    const [id, slug, reason, description, contact, reporterKey, lang] = ins.args;
    assert.equal(id, r.json.reportId);
    assert.equal(slug, "bakery-pickup-1");
    assert.equal(reason, "phishing");
    assert.equal(description, "(주)트루픽셀 예약 앱이라더니 카드 번호를 물어봐요");
    assert.equal(contact, "제보자 연락처 test@example.com");
    assert.equal(lang, "ko");
    assert.match(reporterKey, /^v1:[0-9a-f]{64}$/);
    const argsText = JSON.stringify(env.DB.calls.map((c) => c.args));
    assert.ok(!argsText.includes(IP), "IP 원문이 어떤 D1 인자에도 없다");
    const plain = createHash("sha256").update(IP).digest("hex");
    assert.ok(!argsText.includes(plain), "평문 sha256(IP)도 아니다");
  });

  it("★설명 1000자 초과·연락처 200자 초과·사유 밖·주소 아님·예약어·남의 도메인 → 400", async () => {
    const bad = [
      { app: "bad-app", reason: "spam", description: "가".repeat(1001) },
      { app: "bad-app", reason: "spam", contact: "a".repeat(201) },
      { app: "bad-app", reason: "scam" },
      { app: "", reason: "spam" },
      { app: "https://www.simsa.page", reason: "spam" },
      { app: "https://bad-app.evil.example", reason: "spam" },
      { app: "a.b.simsa.page", reason: "spam" },
    ];
    for (const body of bad) {
      const env = makeEnv();
      const r = await call(env, "POST", "/hosting/report", { body, headers: { "cf-connecting-ip": IP } });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 0);
    }
    const env = makeEnv();
    const ok1000 = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "spam", description: "가".repeat(1000) }, headers: { "cf-connecting-ip": IP } });
    assert.equal(ok1000.status, 200, "경계 1000자는 통과");
  });

  it("★폼 전송(자바스크립트 없음) → 303 report.<root>/?app=…&sent=1 · 잘못된 입력은 error=invalid", async () => {
    const env = makeEnv();
    const ok = await call(env, "POST", "/hosting/report", { form: { app: "https://bad-app.simsa.page", reason: "adult", description: "", contact: "", lang: "en" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get("location"), "https://report.simsa.page/?app=bad-app&sent=1&lang=en");
    const bad = await call(env, "POST", "/hosting/report", { form: { app: "https://evil.example/", reason: "adult", lang: "ko" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get("location"), "https://report.simsa.page/?error=invalid&lang=ko", "되돌아갈 주소는 우리 도메인으로만(열린 리디렉트 없음)");
  });

  it("★본문 크기 상한: 한글 1000자 설명 폼(퍼센트 인코딩 ≈ 9KB)은 통과, 16KB 넘는 본문은 읽기 전에 413", async () => {
    const env = makeEnv();
    const form = new URLSearchParams({ app: "https://bad-app.simsa.page", reason: "spam", description: "한".repeat(1000), contact: "(주)트루픽셀 담당자 010-0000-0000", lang: "ko" }).toString();
    const ok = await call(env, "POST", "/hosting/report", { form: Object.fromEntries(new URLSearchParams(form)), headers: { "cf-connecting-ip": IP, "content-length": String(Buffer.byteLength(form)) } });
    assert.equal(ok.status, 303, ok.text);
    assert.match(ok.headers.get("location"), /sent=1/);
    const huge = JSON.stringify({ app: "bad-app", reason: "spam", description: "가".repeat(6000) });
    const r = await call(env, "POST", "/hosting/report", { body: huge, headers: { "cf-connecting-ip": IP, "content-length": String(Buffer.byteLength(huge)) } });
    assert.equal(r.status, 413);
    assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 1);
  });

  it("★남용 상한: 같은 네트워크 하루 10건 → 11번째 429(JSON)/error=limit(폼) · 다른 네트워크는 통과", async () => {
    const env = makeEnv();
    for (let i = 0; i < 10; i++) {
      const r = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "spam" }, headers: { "cf-connecting-ip": IP } });
      assert.equal(r.status, 200, `#${i + 1}`);
    }
    const over = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "spam" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(over.status, 429);
    assert.equal(over.json.error, "report_limit");
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    const overForm = await call(env, "POST", "/hosting/report", { form: { app: "bad-app", reason: "spam", lang: "ko" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(overForm.headers.get("location"), "https://report.simsa.page/?app=bad-app&error=limit&lang=ko");
    const other = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "spam" }, headers: { "cf-connecting-ip": "198.51.100.9" } });
    assert.equal(other.status, 200);
    assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 11);
  });

  it("★운영자 알림: Telegram 설정 시 slug·사유·설명 요지를 보낸다(연락처는 안 보낸다) · 미설정이면 로그만", async () => {
    const tg = telegramFetch();
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: "test-bot-token", FOUNDER_TG_CHAT_ID: "12345" });
    const r = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "malware", description: "설치 파일을 받으라고 함", contact: "secret-contact@example.com" }, headers: { "cf-connecting-ip": IP }, fetchImpl: tg });
    assert.equal(r.status, 200);
    assert.equal(tg.sent.length, 1);
    assert.match(tg.sent[0].url, /\/sendMessage$/);
    assert.equal(tg.sent[0].hasTimeout, true, "Telegram이 멈춰도 신고 응답을 붙잡지 않는다(시간 제한 신호)");
    const text = tg.sent[0].body.text;
    assert.match(text, /bad-app/);
    assert.match(text, /malware/);
    assert.match(text, /설치 파일을 받으라고 함/);
    assert.doesNotMatch(text, /secret-contact@example\.com/);
    assert.ok(!text.includes(IP));
    const tg2 = telegramFetch();
    const r2 = await call(makeEnv(), "POST", "/hosting/report", { body: { app: "bad-app", reason: "malware" }, headers: { "cf-connecting-ip": IP }, fetchImpl: tg2 });
    assert.equal(r2.status, 200);
    assert.equal(tg2.sent.length, 0);
  });

  it("★D1 저장 실패 → 503(받은 척 안 함) + 상한 슬롯 환급", async () => {
    const env = makeEnv({ DB: recordingD1({ failSql: ["INSERT INTO hosting_reports"] }) });
    const r = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "spam" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "report_unavailable");
    const total = [...env.DB.rate.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 0, "실패한 신고는 상한을 먹지 않는다");
  });

  it("CORS 프리플라이트(대시보드에서 JSON으로 보낼 때)", async () => {
    const r = await call(makeEnv(), "OPTIONS", "/hosting/report", { headers: { origin: "https://app.trysimsa.com", "access-control-request-method": "POST" } });
    assert.ok(r.status === 204 || r.status === 200, String(r.status));
    assert.equal(r.headers.get("access-control-allow-origin"), "https://app.trysimsa.com");
  });

  it("★실제 SQLite(0073): 신고 행 컬럼·기본값(status open)", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const env = makeEnv({ DB });
    const r = await call(env, "POST", "/hosting/report", { body: { app: "bad-app", reason: "illegal", description: "불법 거래 게시판" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(r.status, 200, r.text);
    const row = DB.raw.prepare("SELECT slug, reason, description, contact, reporter_key, status, lang FROM hosting_reports").get();
    assert.deepEqual({ ...row, reporter_key: row.reporter_key.slice(0, 3) }, { slug: "bad-app", reason: "illegal", description: "불법 거래 게시판", contact: null, reporter_key: "v1:", status: "open", lang: null });
  });
});

// ─── ③ 자동 정지 ────────────────────────────────────────────────────────────────

describe("자동 정지 sweepHostingRateStrikes (같은 함수·같은 로그)", () => {
  const NOW = new Date("2026-09-30T15:00:30Z");
  const strikes = (slug, minutesAgo) =>
    Object.fromEntries(minutesAgo.map((m) => {
      const d = new Date(NOW.getTime() - m * 60_000);
      return [`strike:${slug}:${d.toISOString().slice(0, 16).replace(/[-T:]/g, "")}`, "1"];
    }));

  it("★최근 60분 중 10분 이상 상한 초과 → 자동 정지(source auto) + 로그 + 운영자 알림 · 9분은 그대로", async () => {
    assert.ok(duties, "hosting-duties module");
    const kv = fakeKv({ ...strikes("busy-app", [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]), ...strikes("calm-app", [1, 2, 3, 4, 5, 6, 7, 8, 9]), ...strikes("old-app", [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]) });
    const DB = recordingD1();
    const tg = telegramFetch();
    const env = makeEnv({ DB, HOSTING_SUSPENDED: kv, TELEGRAM_BOT_TOKEN: "test-bot-token", FOUNDER_TG_CHAT_ID: "12345" });
    const out = await duties.sweepHostingRateStrikes(env, NOW, { fetch: tg });
    assert.deepEqual(out.suspended, ["busy-app"]);
    const v = JSON.parse(kv.m.get("suspended:busy-app"));
    assert.equal(v.source, "auto");
    assert.equal(v.reason, "abuse_other");
    assert.equal(kv.m.has("suspended:calm-app"), false);
    assert.equal(kv.m.has("suspended:old-app"), false, "60분 창 밖은 세지 않는다");
    const ins = wrote(DB, "INSERT INTO hosting_suspension_log")[0];
    assert.deepEqual(ins.args.slice(1, 6), ["busy-app", "suspend", "abuse_other", "auto", "auto:rate-limit"]);
    assert.match(ins.args[6], /10/);
    assert.equal(tg.sent.length, 1);
    assert.match(tg.sent[0].body.text, /busy-app/);
  });

  it("★이미 정지된 slug는 건너뛴다 · KV 없음이면 건너뜀 보고", async () => {
    const kv = fakeKv({ ...strikes("busy-app", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "suspended:busy-app": JSON.stringify({ source: "admin" }) });
    const DB = recordingD1();
    const out = await duties.sweepHostingRateStrikes(makeEnv({ DB, HOSTING_SUSPENDED: kv }), NOW, { fetch: telegramFetch() });
    assert.deepEqual(out.suspended, []);
    assert.equal(JSON.parse(kv.m.get("suspended:busy-app")).source, "admin", "관리자 정지를 자동 정지로 덮어쓰지 않는다");
    const none = await duties.sweepHostingRateStrikes(makeEnv({ HOSTING_SUSPENDED: undefined }), NOW);
    assert.equal(none.skipped, "no_binding");
  });

  it("★실제 SQLite: 관리자가 24시간 안에 해제한 앱은 자동으로 다시 정지하지 않는다(해제 ↔ 자동 정지 핑퐁 방지)", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const kv = fakeKv(strikes("viral-app", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    const env = makeEnv({ DB, HOSTING_SUSPENDED: kv });
    DB.raw.prepare("INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, memo, applied, created_at, applied_at) VALUES ('hsl_a','viral-app','unsuspend',NULL,'admin','admin',NULL,1,?,?)").run(
      new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
      new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
    );
    const out = await duties.sweepHostingRateStrikes(env, NOW, { fetch: telegramFetch() });
    assert.deepEqual(out.suspended, []);
    assert.deepEqual(out.graced, ["viral-app"]);
    assert.equal(kv.m.has("suspended:viral-app"), false);
    // 25시간 전 해제라면 다시 정지
    DB.raw.prepare("UPDATE hosting_suspension_log SET created_at = ?, applied_at = ?").run(new Date(NOW.getTime() - 25 * 3600_000).toISOString(), new Date(NOW.getTime() - 25 * 3600_000).toISOString());
    const out2 = await duties.sweepHostingRateStrikes(env, NOW, { fetch: telegramFetch() });
    assert.deepEqual(out2.suspended, ["viral-app"]);
    const row = DB.raw.prepare("SELECT source, actor, applied FROM hosting_suspension_log WHERE action = 'suspend'").get();
    assert.deepEqual({ ...row }, { source: "auto", actor: "auto:rate-limit", applied: 1 });
  });
});

// ─── ④ 헬퍼 · 0073 ─────────────────────────────────────────────────────────────

describe("헬퍼 · 0073 형태", () => {
  it("★hostingReportUrl · hostingRulesUrl · normalizeReportedApp (Rule 6: 한글 입력은 slug가 아니다)", () => {
    assert.ok(duties, "hosting-duties module");
    assert.equal(duties.hostingReportUrl("bad-app", "simsa.page"), "https://report.simsa.page/?app=bad-app");
    assert.equal(duties.hostingRulesUrl("simsa.page"), "https://report.simsa.page/rules");
    const n = (s) => duties.normalizeReportedApp(s, "simsa.page");
    assert.equal(n("bad-app"), "bad-app");
    assert.equal(n(" https://Bad-App.simsa.page/login?next=/ "), "bad-app");
    assert.equal(n("bad-app.simsa.page"), "bad-app");
    assert.equal(n("(주)트루픽셀 예약 앱"), null);
    assert.equal(n("https://트루픽셀.simsa.page"), null);
    assert.equal(n("https://report.simsa.page/?app=x"), null);
    assert.equal(n("javascript:alert(1)"), null);
  });

  // 형태 가드(회귀 증거 아님 — 파일이 이 PR에서 새로 생겨 구조상 통과한다).
  it("0073은 additive(CREATE TABLE/INDEX IF NOT EXISTS만) · 번호 유일", () => {
    const sql = readFileSync(join(here, "..", "migrations", "0073_hosting_duties.sql"), "utf8");
    const statements = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
    assert.equal(statements.length, 5);
    for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, s.slice(0, 60));
    assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(DROP|ALTER|DELETE|UPDATE|INSERT)\b/i);
    const numbered = readdirSync(join(here, "..", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f));
    assert.equal(numbered.filter((f) => f.startsWith("0073_")).length, 1);
  });

  it("★운영자 1클릭 워크플로 hosting-duty.yml: 수동 전용 · 입력은 env에 두지 않음(공개 로그) · slug 마스킹 · 조회는 신고 내용·연락처·메모 미출력 · 사유 선택지 = enum", () => {
    let wf = "";
    try {
      wf = readFileSync(join(here, "..", "..", "..", ".github", "workflows", "hosting-duty.yml"), "utf8");
    } catch {
      wf = "";
    }
    assert.ok(wf, "workflow file exists");
    const on = /^on:\n([\s\S]*?)^\S/m.exec(wf)?.[1] ?? "";
    assert.match(on, /^\s{2}workflow_dispatch:/m);
    assert.doesNotMatch(on, /^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
    assert.doesNotMatch(wf, /\$\{\{\s*(inputs|github\.event\.inputs)\.(slug|memo|reason)\s*\}\}/, "자유 입력을 식으로 끼워 넣지 않는다(주입·로그 노출)");
    assert.match(wf, /jq -r '\.inputs\.slug \/\/ ""' "\$GITHUB_EVENT_PATH"/);
    assert.match(wf, /::add-mask::\$\{SLUG\}/);
    const secrets = [...new Set([...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
    assert.deepEqual(secrets, ["INTERNAL_CALLBACK_TOKEN"]);
    const statusFilter = /status\)\s*\n[\s\S]*?filter='([^']+)'/.exec(wf)?.[1] ?? "";
    assert.ok(statusFilter, "status filter");
    for (const f of ["description", "contact", "memo"]) assert.ok(!statusFilter.includes(f), `status filter must not print ${f}`);
    const opts = /reason:[\s\S]*?options:\s*\[([^\]]+)\]/.exec(wf)?.[1].split(",").map((s) => s.trim());
    assert.deepEqual(opts, [...duties.SUSPENSION_REASONS]);
    assert.match(wf, /\/admin\/hosting\/\$\{SLUG\}\/suspend/);
    assert.match(wf, /\/admin\/hosting\/\$\{SLUG\}\/unsuspend/);
  });

  it("사유 enum = 0073 CHECK 목록", () => {
    const sql = readFileSync(join(here, "..", "migrations", "0073_hosting_duties.sql"), "utf8");
    const lists = [...sql.matchAll(/reason IN \(([^)]+)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
    assert.equal(lists.length, 2);
    for (const l of lists) assert.deepEqual(l, [...duties.SUSPENSION_REASONS]);
  });
});

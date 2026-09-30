/**
 * SI 티어 Train B — B-7 호스팅 사업자 의무(D-6) — central-plane 쪽.
 *
 *   ① 관리자 정지/해제 POST /admin/hosting/:slug/{suspend,unsuspend} — 인증·Zod·KV·정지 로그(0073)
 *   ② 신고 POST /hosting/report — 접수 스위치·Content-Type·Origin·바이트 상한·Zod·실제 앱 확인·네트워크(/64) HMAC
 *      신고자 키·남용 상한(네트워크·앱 — 서비스 전체는 거절 안 함)·운영자 알림 묶음(시간당 한 통)
 *   ③ 요청 몰림 스윕 sweepHostingRateStrikes — **플래그·알림만, 정지 안 함**
 *   ④ 보유 기간 청소 · 0073 형태
 *
 * 가짜 바인딩만(KV Map · D1 기록 모크 또는 node:sqlite 실제 엔진 · Telegram fetch 모크) — 네트워크 없음.
 * node:sqlite 테스트는 Node < 22.13에서 건너뛴다(건너뜀 = 미측정).
 * 표시 규칙(PR #575 검증 P2 — 회귀 증거와 형태 검사를 섞어 세지 않는다):
 *   ★         = B-7 행동 테스트. B-7 이전 코드(main 3a1ca07 dist)에서 실패해야 한다.
 *   ◆         = 검증 결함 재현. 수정 전 PR head(8097ac2 dist)에서 실패해야 한다(PR 코멘트 표에 실제 결과).
 *   [형태 가드] = 파일 모양 검사. 파일이 트리에 있으면 옛 src로도 통과할 수 있어 회귀 증거가 아니다.
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
const REPORT_ORIGIN = "https://report.simsa.page";

// ─── 가짜 바인딩 ───────────────────────────────────────────────────────────────

function fakeKv(init = {}, order = null) {
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
      order?.push(`kv.put ${key}`);
      if (kv.failPut) throw new Error("KV PUT failed: 500");
      kv.puts.push({ key, value, opts });
      m.set(key, value);
    },
    async delete(key) {
      order?.push(`kv.delete ${key}`);
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

/**
 * 모든 문장을 기록하는 D1 모크. workspace_rate_limit 일일 상한은 실제처럼(_daily-caps-fake), hosting_reports는
 * 알림 묶음이 읽는 문장만 작은 배열로 흉내 낸다. build_jobs 조회는 `hosted`(없으면 모든 slug가 있는 앱).
 */
function recordingD1({ failSql = [], hosted = null, order = null } = {}) {
  const calls = [];
  const rate = new Map();
  const reports = [];
  const fail = (sql) => failSql.some((f) => sql.includes(f));
  return {
    calls,
    rate,
    reports,
    prepare(sql) {
      const h = (args) => ({
        async run() {
          calls.push({ sql, args });
          order?.push(`d1 ${sql.slice(0, 40)}`);
          const capped = dailyCapsRun(rate, sql, args);
          if (capped) return capped;
          if (fail(sql)) throw new Error(`D1_ERROR: fake failure on ${failSql}`);
          if (sql.startsWith("INSERT INTO hosting_reports")) {
            const [id, slug, reason, description, contact, reporterKey, lang, appVerified, createdAt] = args;
            reports.push({ id, slug, reason, description, contact, reporter_key: reporterKey, lang, app_verified: appVerified, created_at: createdAt, notified_at: null });
          }
          if (sql.startsWith("UPDATE hosting_reports SET notified_at")) {
            const [at, cutoff] = args;
            for (const r of reports) if (r.notified_at === null && r.created_at <= cutoff) r.notified_at = at;
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          calls.push({ sql, args });
          if (fail(sql)) throw new Error("D1_ERROR: fake failure");
          if (sql.includes("FROM build_jobs WHERE slug")) return !hosted || hosted.has(args[0]) ? { found: 1 } : null;
          if (sql.includes("FROM hosting_reports WHERE notified_at IS NULL")) return { n: reports.filter((r) => r.notified_at === null && r.created_at <= args[0]).length };
          if (sql.includes("FROM hosting_reports WHERE created_at >=")) return { n: reports.filter((r) => r.created_at >= args[0]).length };
          return null;
        },
        async all() {
          calls.push({ sql, args });
          if (sql.includes("FROM hosting_reports WHERE notified_at IS NULL")) return { results: reports.filter((r) => r.notified_at === null && r.created_at <= args[0]).slice(0, args[1]) };
          return { results: [] };
        },
      });
      return { bind: (...a) => h(a), ...h([]) };
    },
  };
}

/** D1 모양 어댑터 — node:sqlite 위(0026 요청 한도 + 0068 build_jobs + 0073). */
function sqliteD1({ hosted = ["bad-app", "viral-app", "bakery-pickup-1"] } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0026_workspace_rate_limit.sql", "0068_build_jobs.sql", "0073_hosting_duties.sql"]) db.exec(readFileSync(join(here, "..", "migrations", f), "utf8"));
  const ins = db.prepare("INSERT INTO build_jobs (id, project_id, user_key, slug, status, budget_usd, created_at, updated_at) VALUES (?, 'p', 'uk_test', ?, 'done', 1, 't', 't')");
  hosted.forEach((s, i) => ins.run(`bj_${i}`, s));
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
    HOSTING_REPORTS_ENABLED: "on",
    CONCLAVE_TOKEN_KEK: KEK,
    ...o,
  };
}

/**
 * form이면 브라우저처럼 Origin(신고 사이트)을 싣는다 — `origin: null`이면 빼고, 문자열이면 그 값.
 * contentType을 주면 본문을 그대로(문자열) 그 Content-Type으로 보낸다.
 */
async function call(env, method, path, { body, headers = {}, fetchImpl, form, origin, contentType } = {}) {
  const app = createApp(fetchImpl ? { fetch: fetchImpl } : {});
  const init = { method, headers: { ...headers } };
  if (form) {
    init.body = new URLSearchParams(form).toString();
    init.headers["content-type"] = "application/x-www-form-urlencoded";
    if (origin !== null) init.headers.origin = origin ?? REPORT_ORIGIN;
  } else if (contentType) {
    init.body = body;
    init.headers["content-type"] = contentType;
    if (origin) init.headers.origin = origin;
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
const report = (env, bodyObj, ip = IP, extra = {}) => call(env, "POST", "/hosting/report", { body: bodyObj, headers: { "cf-connecting-ip": ip }, ...extra });

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
  it("★정지 → KV suspended:<slug> = {reason, source:admin} + 로그 INSERT(applied 0) → KV → UPDATE applied 1 — 실제 호출 순서 (옛 코드: 404)", async () => {
    const order = [];
    const env = makeEnv({ DB: recordingD1({ order }), HOSTING_SUSPENDED: fakeKv({}, order) });
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
    // D1 먼저, KV 나중, 그다음 applied=1 — 실제 호출 순서로 비교한다(기록 없는 정지는 없다).
    const iLog = order.findIndex((o) => o.startsWith("d1 INSERT INTO hosting_suspension_log"));
    const iKv = order.indexOf("kv.put suspended:bad-app");
    const iApplied = order.findIndex((o) => o.startsWith("d1 UPDATE hosting_suspension_log SET appl"));
    assert.ok(iLog >= 0 && iKv > iLog && iApplied > iKv, order.join(" | "));
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

  it("★◆실제 SQLite(0073): 관리자 정지는 열린 신고를 actioned로 닫고 정지 로그 id를 남긴다 · 해제하면 그 신고를 다시 open으로 · dismissed는 그대로 (8097ac2: 해제 뒤에도 actioned)", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const env = makeEnv({ DB });
    const rep = await report(env, { app: "bad-app", reason: "phishing", description: "결제 화면이 은행을 흉내 냄" });
    assert.equal(rep.status, 200, rep.text);
    DB.raw.prepare("INSERT INTO hosting_reports (id, slug, reason, reporter_key, status, created_at) VALUES ('hrp_dismissed','bad-app','spam','v1:x','dismissed','2026-09-30T00:00:00.000Z')").run();
    const sus = await call(env, "POST", "/admin/hosting/bad-app/suspend", { body: { reason: "phishing" }, headers: bearer });
    assert.equal(sus.status, 200);
    const afterSuspend = DB.raw.prepare("SELECT id, status, actioned_log_id FROM hosting_reports ORDER BY id").all();
    const open = afterSuspend.find((r) => r.id === rep.json.reportId);
    assert.deepEqual({ status: open.status, actioned_log_id: open.actioned_log_id }, { status: "actioned", actioned_log_id: sus.json.logId });
    assert.equal(afterSuspend.find((r) => r.id === "hrp_dismissed").status, "dismissed");
    assert.equal((await call(env, "POST", "/admin/hosting/bad-app/unsuspend", { body: {}, headers: bearer })).status, 200);
    const afterUnsuspend = new Map(DB.raw.prepare("SELECT id, status, actioned_log_id FROM hosting_reports").all().map((r) => [r.id, [r.status, r.actioned_log_id]]));
    assert.deepEqual(afterUnsuspend.get(rep.json.reportId), ["open", null], "해제하면 정지가 닫았던 신고가 다시 열린다");
    assert.deepEqual(afterUnsuspend.get("hrp_dismissed"), ["dismissed", null], "운영자가 닫은 신고는 그대로");
    const rows = DB.raw.prepare("SELECT slug, action, reason, source, actor, applied, applied_at FROM hosting_suspension_log ORDER BY created_at, action DESC").all();
    assert.deepEqual(rows.map((r) => [r.slug, r.action, r.reason, r.source, r.actor, r.applied]), [
      ["bad-app", "suspend", "phishing", "admin", "admin", 1],
      ["bad-app", "unsuspend", null, "admin", "admin", 1],
    ]);
    assert.ok(rows.every((r) => typeof r.applied_at === "string"));
    const st = await call(env, "GET", "/admin/hosting/bad-app", { headers: bearer });
    assert.equal(st.status, 200);
    assert.equal(st.json.suspended, false);
    assert.equal(st.json.log.length, 2);
    assert.equal(st.json.reports.length, 2);
    // CHECK 제약이 살아 있다
    assert.throws(() => DB.raw.prepare("INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, created_at) VALUES ('x','y','suspend','fraud','admin','admin','t')").run(), /CHECK constraint failed/);
    assert.throws(() => DB.raw.prepare("INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, created_at) VALUES ('x2','y','suspend',NULL,'auto_flag','auto','t')").run(), /CHECK constraint failed/, "정지는 auto_flag 출처로 쓸 수 없다");
    assert.throws(() => DB.raw.prepare("INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, created_at) VALUES ('x3','y','suspend',NULL,'auto','auto','t')").run(), /CHECK constraint failed/, "자동 정지 출처는 없다");
  });
});

// ─── ② 신고 ────────────────────────────────────────────────────────────────────

describe("신고 POST /hosting/report — 저장", () => {
  it("★JSON 신고 → 200 + 행 저장(IP 원문 없음, v1: HMAC 키 · app_verified 1) (옛 코드: 404)", async () => {
    const env = makeEnv();
    const r = await report(env, { app: "https://Bakery-Pickup-1.simsa.page/menu?x=1", reason: "phishing", description: "(주)트루픽셀 예약 앱이라더니 카드 번호를 물어봐요", contact: "제보자 연락처 test@example.com", lang: "ko" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.match(r.json.reportId, /^hrp_/);
    const ins = wrote(env.DB, "INSERT INTO hosting_reports")[0];
    assert.ok(ins, "insert");
    const [id, slug, reason, description, contact, reporterKey, lang, appVerified] = ins.args;
    assert.equal(id, r.json.reportId);
    assert.equal(slug, "bakery-pickup-1");
    assert.equal(reason, "phishing");
    assert.equal(description, "(주)트루픽셀 예약 앱이라더니 카드 번호를 물어봐요");
    assert.equal(contact, "제보자 연락처 test@example.com");
    assert.equal(lang, "ko");
    assert.equal(appVerified, 1);
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
      const r = await report(env, body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 0);
    }
    const env = makeEnv();
    const ok1000 = await report(env, { app: "bad-app", reason: "spam", description: "가".repeat(1000) });
    assert.equal(ok1000.status, 200, "경계 1000자는 통과");
  });

  it("◆신고 대상은 Simsa가 실제로 올린 앱(build_jobs)만 — 없는 이름은 400 app_not_hosted / 폼 error=invalid(주소 안 실음) · 조회 실패는 받되 app_verified=0 (8097ac2: 아무 이름이나 저장)", async () => {
    const env = makeEnv({ DB: recordingD1({ hosted: new Set(["bakery-pickup-1"]) }) });
    const none = await report(env, { app: "no-such-app", reason: "spam" });
    assert.equal(none.status, 400);
    assert.equal(none.json.error, "app_not_hosted");
    const noneForm = await call(env, "POST", "/hosting/report", { form: { app: "https://no-such-app.simsa.page", reason: "spam", lang: "ko" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(noneForm.status, 303);
    assert.equal(noneForm.headers.get("location"), "https://report.simsa.page/?error=invalid&lang=ko");
    assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 0);
    assert.equal(env.DB.rate.size, 0, "없는 앱 시도는 신고자 상한을 먹지 않는다");
    const ok = await report(env, { app: "bakery-pickup-1", reason: "spam" });
    assert.equal(ok.status, 200);

    const broken = makeEnv({ DB: recordingD1({ failSql: ["FROM build_jobs"] }) });
    const unverified = await report(broken, { app: "bakery-pickup-1", reason: "adult" });
    assert.equal(unverified.status, 200, "우리 사정(조회 실패)으로 진짜 신고를 버리지 않는다");
    assert.equal(wrote(broken.DB, "INSERT INTO hosting_reports")[0].args[7], 0, "app_verified = 0으로 표시");
  });

  it("★실제 SQLite(0073): 신고 행 컬럼·기본값(status open · app_verified 1 · notified_at NULL)", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const env = makeEnv({ DB });
    const r = await report(env, { app: "bad-app", reason: "illegal", description: "불법 거래 게시판" });
    assert.equal(r.status, 200, r.text);
    const row = DB.raw.prepare("SELECT slug, reason, description, contact, reporter_key, status, lang, app_verified, actioned_log_id, notified_at FROM hosting_reports").get();
    assert.deepEqual({ ...row, reporter_key: row.reporter_key.slice(0, 3) }, { slug: "bad-app", reason: "illegal", description: "불법 거래 게시판", contact: null, reporter_key: "v1:", status: "open", lang: null, app_verified: 1, actioned_log_id: null, notified_at: null });
    const noJob = await report(env, { app: "ghost-app", reason: "spam" });
    assert.equal(noJob.status, 400, "build_jobs에 없는 slug");
  });

  it("★D1 저장 실패 → 503(받은 척 안 함) + 상한 슬롯 환급", async () => {
    const env = makeEnv({ DB: recordingD1({ failSql: ["INSERT INTO hosting_reports"] }) });
    const r = await report(env, { app: "bad-app", reason: "spam" });
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
});

describe("신고 — 접수 스위치 · 본문 모양 · Origin · 바이트 상한", () => {
  it("◆HOSTING_REPORTS_ENABLED가 정확히 'on'이 아니면 JSON 503 reports_not_open · 폼 303 error=closed · 저장·상한 소모 없음 (8097ac2: 스위치 없이 저장)", async () => {
    for (const flag of [undefined, "off", "true", "ON", "1"]) {
      const env = makeEnv({ HOSTING_REPORTS_ENABLED: flag });
      const j = await report(env, { app: "bad-app", reason: "spam", description: "연락처가 있는 신고" });
      assert.equal(j.status, 503, String(flag));
      assert.equal(j.json.error, "reports_not_open");
      const f = await call(env, "POST", "/hosting/report", { form: { app: "https://bad-app.simsa.page", reason: "spam" }, headers: { "cf-connecting-ip": IP } });
      assert.equal(f.status, 303);
      assert.equal(f.headers.get("location"), "https://report.simsa.page/?error=closed");
      assert.equal(env.DB.calls.length, 0, `${flag}: D1 무접촉`);
    }
  });

  it("◆폼은 Origin이 https://report.<root>일 때만 — 없거나 다른 사이트면 403 · 저장·상한 소모 없음 (8097ac2: 다른 사이트의 자동 제출도 저장)", async () => {
    for (const origin of [null, "null", "https://evil.example", "https://bad-app.simsa.page", "http://report.simsa.page"]) {
      const env = makeEnv();
      const r = await call(env, "POST", "/hosting/report", { form: { app: "https://bad-app.simsa.page", reason: "spam", lang: "ko" }, headers: { "cf-connecting-ip": IP }, origin });
      assert.equal(r.status, 403, String(origin));
      assert.equal(r.json.error, "origin_not_allowed");
      assert.equal(env.DB.calls.length, 0, `${origin}: D1 무접촉`);
    }
    const env = makeEnv();
    const ok = await call(env, "POST", "/hosting/report", { form: { app: "https://bad-app.simsa.page", reason: "adult", description: "", contact: "", lang: "en" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get("location"), "https://report.simsa.page/?app=bad-app&sent=1&lang=en");
    const bad = await call(env, "POST", "/hosting/report", { form: { app: "https://evil.example/", reason: "adult", lang: "ko" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get("location"), "https://report.simsa.page/?error=invalid&lang=ko", "되돌아갈 주소는 우리 도메인으로만(열린 리디렉트 없음)");
  });

  it("◆JSON 모양 본문이라도 Content-Type이 application/json이 아니면 415 — 다른 사이트의 enctype=text/plain 폼 우회 차단 (8097ac2: 200 저장)", async () => {
    for (const ct of ["text/plain", "text/plain;charset=UTF-8", "multipart/form-data; boundary=x", ""]) {
      const env = makeEnv();
      const r = await call(env, "POST", "/hosting/report", {
        contentType: ct || "application/octet-stream",
        body: '{"app":"bad-app","reason":"spam","description":"=x"}',
        headers: { "cf-connecting-ip": IP },
        origin: "https://evil.example",
      });
      assert.equal(r.status, 415, ct);
      assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 0);
    }
  });

  it("★본문 크기 상한: 한글 1000자 설명 폼(퍼센트 인코딩 ≈ 9KB)은 통과, 16KB 넘는 본문은 413", async () => {
    const env = makeEnv();
    const ok = await call(env, "POST", "/hosting/report", { form: { app: "https://bad-app.simsa.page", reason: "spam", description: "한".repeat(1000), contact: "(주)트루픽셀 담당자 010-0000-0000", lang: "ko" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(ok.status, 303, ok.text);
    assert.match(ok.headers.get("location"), /sent=1/);
    const huge = JSON.stringify({ app: "bad-app", reason: "spam", description: "가".repeat(6000) });
    const r = await call(env, "POST", "/hosting/report", { body: huge, headers: { "cf-connecting-ip": IP, "content-length": String(Buffer.byteLength(huge)) } });
    assert.equal(r.status, 413);
    assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 1);
  });

  it("◆Content-Length 없는 스트림(청크·HTTP/2) 2MB 본문 → 413 · 16KB 조금 넘게 읽고 멈춘다 (8097ac2: 2MB를 끝까지 읽고 400)", async () => {
    const CHUNK = 4096;
    const TOTAL = 2 * 1024 * 1024;
    let pulled = 0;
    const payload = new TextEncoder().encode(`{"app":"bad-app","reason":"spam","description":"${"a".repeat(CHUNK)}`);
    const stream = new ReadableStream({
      pull(controller) {
        if (pulled >= TOTAL) {
          controller.close();
          return;
        }
        pulled += CHUNK;
        controller.enqueue(payload.slice(0, CHUNK));
      },
    });
    const env = makeEnv();
    const app = createApp({});
    const res = await app.fetch(
      new Request("https://conclave-ai.example/hosting/report", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json", "cf-connecting-ip": IP } }),
      env,
    );
    assert.equal(res.status, 413, await res.clone().text());
    assert.ok(pulled <= 16_384 + 4 * CHUNK, `읽은 양 ${pulled}바이트 — 상한 근처에서 멈춰야 한다`);
    assert.equal(env.DB.calls.length, 0);
  });

  it("◆Content-Length가 거짓(작게)이어도 실제 바이트로 413", async () => {
    const { readBodyCapped } = await import("../dist/routes/hosting-duties.js");
    const big = "가".repeat(10_000); // 30KB
    const r = await readBodyCapped(new Request("https://x.example/", { method: "POST", body: big, headers: { "content-length": "10" } }), 16_384);
    assert.deepEqual(r, { ok: false, reason: "too_large" });
    const small = await readBodyCapped(new Request("https://x.example/", { method: "POST", body: "앱 신고" }), 16_384);
    assert.deepEqual(small, { ok: true, text: "앱 신고" });
  });
});

describe("신고 — 남용 상한(네트워크 /64 · 앱) · 서비스 전체는 거절하지 않는다", () => {
  it("★같은 네트워크 하루 10건 → 11번째 429(JSON)/error=limit(폼) · 다른 네트워크는 통과", async () => {
    const env = makeEnv();
    for (let i = 0; i < 10; i++) {
      const r = await report(env, { app: "bad-app", reason: "spam" });
      assert.equal(r.status, 200, `#${i + 1}`);
    }
    const over = await report(env, { app: "bad-app", reason: "spam" });
    assert.equal(over.status, 429);
    assert.equal(over.json.error, "report_limit");
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    const overForm = await call(env, "POST", "/hosting/report", { form: { app: "bad-app", reason: "spam", lang: "ko" }, headers: { "cf-connecting-ip": IP } });
    assert.equal(overForm.headers.get("location"), "https://report.simsa.page/?app=bad-app&error=limit&lang=ko");
    const other = await report(env, { app: "bad-app", reason: "spam" }, "198.51.100.9");
    assert.equal(other.status, 200);
    assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 11);
  });

  it("◆IPv6: 같은 /64 안에서 주소만 바꿔도 같은 네트워크(11번째 429) · IPv4-mapped는 IPv4와 같다 (8097ac2: 주소마다 새 상한)", async () => {
    const env = makeEnv();
    for (let i = 1; i <= 10; i++) {
      const r = await report(env, { app: "bad-app", reason: "spam" }, `2001:db8:1234:5678:${i.toString(16)}::${(i * 7).toString(16)}`);
      assert.equal(r.status, 200, `#${i}`);
    }
    const sameSlash64 = await report(env, { app: "bad-app", reason: "spam" }, "2001:0db8:1234:5678:ffff:ffff:ffff:ffff");
    assert.equal(sameSlash64.status, 429);
    const nextSlash64 = await report(env, { app: "bad-app", reason: "spam" }, "2001:db8:1234:5679::1");
    assert.equal(nextSlash64.status, 200);
    const n = duties.reporterNetwork;
    assert.equal(n("::ffff:203.0.113.7"), n("203.0.113.7"));
    assert.equal(n("2001:db8:1234:5678::1"), n("2001:DB8:1234:5678:abcd:ef01:2345:6789"));
    assert.notEqual(n("2001:db8:1234:5678::1"), n("2001:db8:1234:5679::1"));
    assert.equal(n("2001:db8::1%eth0"), n("2001:db8:0:0:ffff::"));
    assert.equal(n("203.0.113.7"), "v4:203.0.113.7");
    assert.equal(n("unknown"), "raw:unknown");
    assert.equal(n("999.1.1.1"), "raw:999.1.1.1");
  });

  it("◆서비스 전체 300건을 넘어도 저장은 계속된다(여러 네트워크·여러 앱 301건 전부 200) (8097ac2: 301번째 429 — 누구나 하루 동안 신고 창구 전체를 닫을 수 있었다)", async () => {
    const env = makeEnv();
    const apps = ["app-one", "app-two", "app-three", "app-four", "app-five", "app-six", "app-seven"];
    const statuses = [];
    for (let i = 0; i < 301; i++) {
      const r = await report(env, { app: apps[i % apps.length], reason: "spam" }, `198.51.${Math.floor(i / 250)}.${i % 250}`);
      statuses.push(r.status);
    }
    assert.equal(statuses.filter((s) => s !== 200).length, 0, JSON.stringify([...new Set(statuses)]));
    assert.equal(wrote(env.DB, "INSERT INTO hosting_reports").length, 301);
  });

  it("◆같은 앱 하루 50건 → 51번째는 error=app_limit('이미 많이 들어와 확인 중') · 다른 앱 신고는 그대로 열림 (저장량 상한 — 서비스 전체 거절을 대신한다)", async () => {
    const env = makeEnv();
    for (let i = 0; i < 50; i++) assert.equal((await report(env, { app: "bad-app", reason: "phishing" }, `203.0.113.${i}`)).status, 200, `#${i + 1}`);
    const over = await report(env, { app: "bad-app", reason: "phishing" }, "203.0.113.200");
    assert.equal(over.status, 429);
    assert.equal(over.json.error, "app_report_limit");
    const overForm = await call(env, "POST", "/hosting/report", { form: { app: "bad-app", reason: "spam", lang: "ko" }, headers: { "cf-connecting-ip": "203.0.113.201" } });
    assert.equal(overForm.headers.get("location"), "https://report.simsa.page/?app=bad-app&error=app_limit&lang=ko");
    assert.equal((await report(env, { app: "other-app", reason: "spam" }, "203.0.113.202")).status, 200);
    // 앱 상한에 걸린 시도는 그 네트워크의 슬롯을 돌려준다: 9건 + 막힌 1건 + 10번째 = 통과, 11번째 = 네트워크 상한.
    const ip = "198.51.100.77";
    for (let i = 0; i < 9; i++) assert.equal((await report(env, { app: "other-app", reason: "spam" }, ip)).status, 200);
    assert.equal((await report(env, { app: "bad-app", reason: "spam" }, ip)).json.error, "app_report_limit");
    assert.equal((await report(env, { app: "other-app", reason: "spam" }, ip)).status, 200, "10번째 — 막힌 시도는 세지 않았다");
    assert.equal((await report(env, { app: "other-app", reason: "spam" }, ip)).json.error, "report_limit");
  });
});

describe("신고 — 운영자 알림 묶음(시간당 한 통)", () => {
  it("◆그 시간의 첫 신고는 바로 알림(slug·사유·설명 요지, 연락처·IP 없음) · 같은 시간의 다음 신고들은 DM 없음 · 다음 시간 크론이 한 통으로 묶어 보냄 (8097ac2: 신고마다 DM)", async () => {
    const hourAtStart = new Date().toISOString().slice(0, 13);
    const tg = telegramFetch();
    const DB = recordingD1();
    const env = makeEnv({ DB, TELEGRAM_BOT_TOKEN: "test-bot-token", FOUNDER_TG_CHAT_ID: "12345" });
    const r = await report(env, { app: "bad-app", reason: "malware", description: "설치 파일을 받으라고 함", contact: "secret-contact@example.com" }, IP, { fetchImpl: tg });
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
    for (let i = 0; i < 20; i++) {
      assert.equal((await report(env, { app: i % 2 ? "bad-app" : "other-app", reason: "spam", description: `신고 ${i}` }, `198.51.100.${i}`, { fetchImpl: tg })).status, 200);
    }
    // 드물게 테스트가 정각을 넘기면 새 시간의 첫 신고가 한 통 더 보낼 수 있다(그것도 규칙대로) — 그때만 2통 허용.
    const crossedHour = new Date().toISOString().slice(0, 13) !== hourAtStart;
    assert.ok(crossedHour ? tg.sent.length <= 2 : tg.sent.length === 1, `같은 UTC 시간엔 DM 한 통 (보낸 수 ${tg.sent.length})`);
    const pendingBefore = DB.reports.filter((x) => x.notified_at === null).length;
    if (!crossedHour) assert.equal(pendingBefore, 20, "나머지는 '안 알림'으로 남는다");
    // 다음 시간의 10분 크론
    const sentBefore = tg.sent.length;
    const nextHour = new Date(Date.now() + 3_600_000);
    const d = await duties.sendReportDigest(env, nextHour, { fetch: tg });
    assert.equal(d.status, "sent");
    assert.equal(d.reports, pendingBefore);
    assert.equal(tg.sent.length, sentBefore + 1);
    const digest = tg.sent[sentBefore].body.text;
    assert.match(digest, new RegExp(`신고 ${pendingBefore}건`));
    if (!crossedHour) {
      assert.match(digest, /bad-app: 10건/);
      assert.match(digest, /other-app: 10건/);
    }
    assert.doesNotMatch(digest, /secret-contact|198\.51\.100/);
    assert.equal(DB.reports.filter((x) => x.notified_at === null).length, 0);
    const again = await duties.sendReportDigest(env, new Date(nextHour.getTime() + 60_000), { fetch: tg });
    assert.equal(again.status, "nothing_pending");
  });

  it("Telegram 미설정이면 알림 없음(로그만) · 신고는 저장", async () => {
    const tg = telegramFetch();
    const r = await report(makeEnv(), { app: "bad-app", reason: "malware" }, IP, { fetchImpl: tg });
    assert.equal(r.status, 200);
    assert.equal(tg.sent.length, 0);
  });
});

// ─── ③ 요청 몰림 → 플래그(정지 아님) ────────────────────────────────────────────

describe("요청 몰림 스윕 sweepHostingRateStrikes — 플래그·알림만, 정지하지 않는다", () => {
  const NOW = new Date("2026-09-30T15:00:30Z");
  const strikes = (slug, minutesAgo) =>
    Object.fromEntries(minutesAgo.map((m) => {
      const d = new Date(NOW.getTime() - m * 60_000);
      return [`strike:${slug}:${d.toISOString().slice(0, 16).replace(/[-T:]/g, "")}`, "1"];
    }));

  it("◆최근 60분 중 10분 이상 상한 초과 → 플래그 행(action flag · source auto_flag) + 운영자 알림 1통 · **KV 정지 없음** · 9분·창 밖은 그대로 (8097ac2: 자동 정지 source auto — 자동 해제 없음)", async () => {
    assert.ok(duties, "hosting-duties module");
    const kv = fakeKv({ ...strikes("busy-app", [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]), ...strikes("calm-app", [1, 2, 3, 4, 5, 6, 7, 8, 9]), ...strikes("old-app", [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]) });
    const DB = recordingD1();
    const tg = telegramFetch();
    const env = makeEnv({ DB, HOSTING_SUSPENDED: kv, TELEGRAM_BOT_TOKEN: "test-bot-token", FOUNDER_TG_CHAT_ID: "12345" });
    const out = await duties.sweepHostingRateStrikes(env, NOW, { fetch: tg });
    assert.deepEqual([...kv.m.keys()].filter((k) => k.startsWith("suspended:")), [], "정지 목록에 아무것도 올리지 않는다");
    assert.equal(kv.puts.length, 0);
    assert.deepEqual(out.flagged, ["busy-app"]);
    const ins = wrote(DB, "INSERT INTO hosting_suspension_log");
    assert.equal(ins.length, 1);
    assert.match(ins[0].sql, /'flag', NULL, 'auto_flag'/);
    assert.deepEqual(ins[0].args.slice(1, 3), ["busy-app", "auto:rate-limit"]);
    assert.match(ins[0].args[3], /10 of the last 60 minutes \(not suspended\)/);
    assert.equal(wrote(DB, "hosting_reports").length, 0, "플래그는 신고를 닫지 않는다");
    assert.equal(tg.sent.length, 1);
    assert.match(tg.sent[0].body.text, /busy-app/);
    assert.match(tg.sent[0].body.text, /정지하지 않았어요/);
    assert.equal(out.notified, true);
  });

  it("이미 정지된 slug는 건너뛴다(관리자 정지를 건드리지 않음) · KV 없음이면 건너뜀 보고", async () => {
    const kv = fakeKv({ ...strikes("busy-app", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "suspended:busy-app": JSON.stringify({ source: "admin", reason: "phishing" }) });
    const DB = recordingD1();
    const tg = telegramFetch();
    const out = await duties.sweepHostingRateStrikes(makeEnv({ DB, HOSTING_SUSPENDED: kv, TELEGRAM_BOT_TOKEN: "t", FOUNDER_TG_CHAT_ID: "1" }), NOW, { fetch: tg });
    assert.deepEqual(out.flagged, []);
    assert.deepEqual(out.alreadySuspended, ["busy-app"]);
    assert.deepEqual(JSON.parse(kv.m.get("suspended:busy-app")), { source: "admin", reason: "phishing" });
    assert.equal(tg.sent.length, 0);
    const none = await duties.sweepHostingRateStrikes(makeEnv({ HOSTING_SUSPENDED: undefined }), NOW);
    assert.equal(none.skipped, "no_binding");
  });

  it("◆실제 SQLite: 6시간 안에 이미 알린 앱은 다시 알리지 않는다 · 7시간 뒤면 다시 플래그 · 어느 경우도 정지 행 없음 (8097ac2: 자동 정지 행)", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const kv = fakeKv(strikes("viral-app", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    const tg = telegramFetch();
    const env = makeEnv({ DB, HOSTING_SUSPENDED: kv, TELEGRAM_BOT_TOKEN: "t", FOUNDER_TG_CHAT_ID: "1" });
    const first = await duties.sweepHostingRateStrikes(env, NOW, { fetch: tg });
    assert.equal(kv.m.has("suspended:viral-app"), false, "요청 몰림만으로 정지하지 않는다");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM hosting_suspension_log WHERE action = 'suspend'").get().n, 0);
    assert.deepEqual(first.flagged, ["viral-app"]);
    const second = await duties.sweepHostingRateStrikes(env, new Date(NOW.getTime() + 10 * 60_000), { fetch: tg });
    assert.deepEqual(second.flagged, []);
    assert.deepEqual(second.recentlyFlagged, ["viral-app"]);
    assert.equal(tg.sent.length, 1, "알림 폭주 없음");
    DB.raw.prepare("UPDATE hosting_suspension_log SET created_at = ?, applied_at = ?").run(new Date(NOW.getTime() - 7 * 3600_000).toISOString(), new Date(NOW.getTime() - 7 * 3600_000).toISOString());
    const third = await duties.sweepHostingRateStrikes(env, NOW, { fetch: tg });
    assert.deepEqual(third.flagged, ["viral-app"]);
    const rows = DB.raw.prepare("SELECT action, source, actor, applied, reason FROM hosting_suspension_log ORDER BY created_at").all();
    assert.deepEqual(rows.map((r) => [r.action, r.source, r.actor, r.applied, r.reason]), [
      ["flag", "auto_flag", "auto:rate-limit", 1, null],
      ["flag", "auto_flag", "auto:rate-limit", 1, null],
    ]);
    assert.equal(kv.m.has("suspended:viral-app"), false);
  });
});

// ─── ④ 보유 기간 · 헬퍼 · 0073 ─────────────────────────────────────────────────

describe("신고 보유 기간(180일) 청소", () => {
  it("◆실제 SQLite: created_at이 180일 지난 신고만 지운다(연락처 포함) · 그 안은 남긴다 (8097ac2: 청소 없음)", { skip: noSqlite }, async () => {
    const DB = sqliteD1();
    const now = new Date("2026-10-01T00:00:00.000Z");
    const ins = DB.raw.prepare("INSERT INTO hosting_reports (id, slug, reason, contact, reporter_key, created_at) VALUES (?, 'bad-app', 'spam', '제보자 010-0000-0000', 'v1:x', ?)");
    ins.run("hrp_old", new Date(now.getTime() - 181 * 86_400_000).toISOString());
    ins.run("hrp_edge", new Date(now.getTime() - 179 * 86_400_000).toISOString());
    ins.run("hrp_new", now.toISOString());
    assert.equal(duties.REPORT_RETENTION_DAYS, 180);
    const out = await duties.purgeExpiredHostingReports({ DB }, now);
    assert.equal(out.deleted, 1);
    assert.equal(out.more, false);
    assert.deepEqual(DB.raw.prepare("SELECT id FROM hosting_reports ORDER BY id").all().map((r) => r.id), ["hrp_edge", "hrp_new"]);
  });

  it("청소는 던지지 않는다(D1 오류 → error 필드)", async () => {
    const out = await duties.purgeExpiredHostingReports({ DB: recordingD1({ failSql: ["DELETE FROM hosting_reports"] }) }, new Date());
    assert.match(out.error ?? "", /D1_ERROR/);
  });

  it("[형태 가드] 6시간 크론에 청소가, 10분 크론에 플래그 스윕·알림 묶음이 걸려 있다", () => {
    const src = readFileSync(join(here, "..", "src", "index.ts"), "utf8");
    const six = src.slice(src.indexOf('event.cron === "0 */6 * * *"'), src.indexOf('event.cron === "0 4 * * *"'));
    assert.match(six, /purgeExpiredHostingReports\(env\)/);
    const tail = src.slice(src.indexOf("Default / \"*/10 * * * *\""));
    assert.match(tail, /sweepHostingRateStrikes\(env\)/);
    assert.match(tail, /sendReportDigest\(env\)/);
    assert.doesNotMatch(src, /suspendHostedApp/, "크론은 정지 함수를 부르지 않는다");
  });
});

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

  it("[형태 가드] 0073은 additive(CREATE TABLE/INDEX IF NOT EXISTS만) · 번호 유일 · build_jobs slug 인덱스", () => {
    const sql = readFileSync(join(here, "..", "migrations", "0073_hosting_duties.sql"), "utf8");
    const statements = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
    assert.equal(statements.length, 7);
    for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, s.slice(0, 60));
    assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(DROP|ALTER|DELETE|UPDATE|INSERT)\b/i);
    assert.ok(statements.some((s) => /ON build_jobs \(slug\)/.test(s)));
    const numbered = readdirSync(join(here, "..", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f));
    assert.equal(numbered.filter((f) => f.startsWith("0073_")).length, 1);
  });

  it("[형태 가드] 운영자 1클릭 워크플로 hosting-duty.yml: 수동 전용 · 입력은 env에 두지 않음(공개 로그) · slug 마스킹 · 조회는 신고 내용·연락처·메모 미출력 · 사유 선택지 = enum", () => {
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
    assert.deepEqual(opts, [...(duties?.SUSPENSION_REASONS ?? [])]);
    assert.match(wf, /\/admin\/hosting\/\$\{SLUG\}\/suspend/);
    assert.match(wf, /\/admin\/hosting\/\$\{SLUG\}\/unsuspend/);
  });

  it("[형태 가드] 사유 enum = 0073 CHECK 목록 · 로그 출처 = admin/auto_flag", () => {
    const sql = readFileSync(join(here, "..", "migrations", "0073_hosting_duties.sql"), "utf8");
    const lists = [...sql.matchAll(/reason IN \(([^)]+)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
    assert.equal(lists.length, 2);
    for (const l of lists) assert.deepEqual(l, [...duties.SUSPENSION_REASONS]);
    const sources = /source IN \(([^)]+)\)/.exec(sql)?.[1].split(",").map((s) => s.trim().replace(/'/g, ""));
    assert.deepEqual(sources, [...duties.LOG_SOURCES]);
  });

  it("[형태 가드] 신고 스위치: wrangler.toml [vars] HOSTING_REPORTS_ENABLED = \"off\"(방침 고지 전)", () => {
    const toml = readFileSync(join(here, "..", "wrangler.toml"), "utf8");
    const live = toml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.equal(/^HOSTING_REPORTS_ENABLED\s*=\s*"([^"]*)"/m.exec(live)?.[1], "off");
  });
});

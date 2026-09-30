/**
 * rate-limit-ipv6-network.test.mjs — IP로 거는 모든 요청 한도는 **네트워크** 단위로 센다 (2026-10-01).
 *
 * 문제 (3a1ca07 실측, 하니스 = 0026 스키마 node:sqlite):
 *   ipRateLimitKey가 cf-connecting-ip 원문 그대로 HMAC을 만들었다. /64(LAN 하나) 안에서는 주소를 마음대로
 *   바꿀 수 있으므로, 주소만 돌리면 매번 새 카운터였다. (/64보다 넓은 할당 — /56 가정·/48 터널 — 은
 *   rate-limit-ipv6-wide-network.test.mjs가 맡는다: 일일 상한은 /48도 함께 센다.)
 *     - 검수 60회(매번 새 userKey, 같은 /64 안에서 주소 회전) → 60건 모두 수락(네트워크 상한 30은 한 번도 안 걸림)
 *     - 수리 60회 → 50건 수락 후 서비스 버킷에서만 멈춤 = 출처 하나가 그날 서비스 전체 수리 몫을 다 씀(가용성 공격)
 *     - 시간당 상한 5개 경로(workspace·check·recommend·unstick·fix) · 문서 인테이크 · 데모도 같은 키 함수
 *
 * 고정하는 계약:
 *   ① networkPrefix: IPv4 = 그대로(바이트 단위) · IPv6 = 앞 64비트 "a:b:c:d::/64"(소문자·앞자리 0 없음) ·
 *      ::ffff:a.b.c.d(IPv4-mapped) = IPv4 · IP 아님(""·"unknown"·#575의 "v6:…/64" 태그) = 그대로 · 멱등.
 *   ② ipRateLimitKey가 그걸 거친다 — 같은 /64 = 같은 키, IPv4 키는 예전과 **같은 값**(카운터 연속).
 *   ③ 실제 SQLite: /64 안에서 주소를 돌려도 검수는 30건, 수리는 15건에서 네트워크 상한이 막는다.
 *   ④ 시간당 5경로 · 문서 인테이크 · 데모: 같은 /64의 두 주소가 같은 행을 센다(가짜 D1 바인드).
 *   ⑤ 새 키도 "v1:" — 48시간 청소의 레거시 패스가 살아 있는 행을 지우지 않고, 창 패스는 48시간 뒤 지운다.
 *
 * 표시 규칙: [가드] = 옛 코드에서도 통과하는 행동 보존 가드(회귀 증거 아님). 표시 없음 = 옛 코드에서 실패.
 *            [동작 명시] = 이 PR이 고른 경계 동작을 고정한다(회귀 증거 아님 — 옛 코드에서는 networkPrefix export가
 *            없어서만 실패한다. 8e61f82 이후 코드에서는 통과한다).
 * 주소는 문서용 대역만(RFC 5737 IPv4 · RFC 3849 IPv6). KEK는 매번 새 무작위(가짜) 값.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const { createApp } = await import("../dist/router.js");
const { consumeDailyCaps } = await import("../dist/workspace/rate-limit.js");
const { dailyCapsFor, clientNetworkKey } = await import("../dist/workspace/beta-limits.js");
const keyMod = await import("../dist/workspace/rate-limit-key.js");
const { ipRateLimitKey, RATE_LIMIT_KEY_PREFIX } = keyMod;

const KEK = randomBytes(32).toString("base64");
const LABEL = "simsa/rate-limit-ip/v1";

/** 테스트 쪽 독립 구현(node:crypto): stored = "v1:" + HMAC(HMAC(KEK, label), bucket::value). */
function keyed(bucket, value) {
  const subkey = createHmac("sha256", Buffer.from(KEK, "utf8")).update(LABEL, "utf8").digest();
  return "v1:" + createHmac("sha256", subkey).update(`${bucket}::${value}`, "utf8").digest("hex");
}

/** networkPrefix is new — look it up per test so each one fails on its own on old code. */
function networkPrefixFn() {
  assert.equal(typeof keyMod.networkPrefix, "function", "rate-limit-key.ts must export networkPrefix(ip)");
  return keyMod.networkPrefix;
}

const V4 = "198.51.100.7";
const V4_OTHER = "203.0.113.9";
const V6_A = "2001:db8:abcd:12::1";
const V6_B = "2001:db8:abcd:12::2";
const V6_SAME_64_FAR = "2001:db8:abcd:12:ffff:1:2:3";
const V6_OTHER_64 = "2001:db8:abcd:13::1";
const NET_64 = "2001:db8:abcd:12::/64";

// ─── ① networkPrefix ───────────────────────────────────────────────────────────

test("① networkPrefix: IPv6는 앞 64비트 — 표기가 달라도(대문자·앞자리 0·압축 안 함·zone) 같은 /64", () => {
  const networkPrefix = networkPrefixFn();
  for (const ip of [
    V6_A,
    V6_B,
    V6_SAME_64_FAR,
    "2001:DB8:ABCD:12::FFFF",
    "2001:0db8:abcd:0012:0000:0000:0000:0001",
    "2001:db8:abcd:12:0:0:0:1",
    "2001:db8:abcd:12::1%eth0",
    "2001:db8:abcd:12::c633:6407",
  ]) {
    assert.equal(networkPrefix(ip), NET_64, ip);
  }
  assert.equal(networkPrefix(V6_OTHER_64), "2001:db8:abcd:13::/64");
  assert.equal(networkPrefix("::1"), "0:0:0:0::/64");
  assert.equal(networkPrefix("2606:4700:3030::6815:3f02"), "2606:4700:3030:0::/64");
  assert.equal(networkPrefix("1:2:3:4:5:6:1.2.3.4"), "1:2:3:4::/64", "dotted tail inside a normal IPv6");
});

test("① networkPrefix: IPv4는 바이트 그대로 · ::ffff:a.b.c.d(점·16진 표기)는 IPv4", () => {
  const networkPrefix = networkPrefixFn();
  assert.equal(networkPrefix(V4), V4);
  assert.equal(networkPrefix("::ffff:198.51.100.7"), V4);
  assert.equal(networkPrefix("::FFFF:198.51.100.7"), V4);
  assert.equal(networkPrefix("::ffff:c633:6407"), V4, "hex form of the same mapped address");
  assert.equal(networkPrefix("0:0:0:0:0:ffff:c633:6407"), V4);
});

test("[동작 명시] ① networkPrefix: mapped 꼬리의 앞자리 0은 받아들여 한 IPv4로 모은다 · 평문 IPv4는 앞자리 0도 그대로(바이트 단위)", () => {
  // PR #580 검증 P2: node:net은 "::ffff:01.2.3.4"를 IPv6로 보지 않는다. 여기서는 느슨하게 읽어 1.2.3.4 행으로
  // 모은다 — 같은 주소의 표기를 한 행으로 모으는 방향이라 카운터를 늘리지 않는다. 평문 "001.002.003.004"는
  // IPv4 행 연속성 때문에 건드리지 않으므로 그 표기는 따로 센다. 둘 다 cf-connecting-ip가 내지 않는 표기다.
  const networkPrefix = networkPrefixFn();
  assert.equal(networkPrefix("::ffff:01.2.3.4"), "1.2.3.4");
  assert.equal(networkPrefix("::ffff:001.002.003.004"), "1.2.3.4");
  assert.equal(networkPrefix("001.002.003.004"), "001.002.003.004", "plain IPv4 is never rewritten");
  assert.equal(networkPrefix("::1.2.3.4"), "0:0:0:0::/64", "IPv4-compatible (deprecated) = the ::/64 network");
});

test("① networkPrefix: IP가 아니면 그대로 — 빈 값·unknown·#575 태그·포트 붙은 값·깨진 주소·긴 값 · 멱등", () => {
  const networkPrefix = networkPrefixFn();
  for (const s of [
    "",
    "unknown",
    "알 수 없음 (프록시)",
    "v4:198.51.100.7",
    "v6:2001:db8:abcd:12::/64",
    NET_64,
    "198.51.100.7:443",
    ":::",
    "1::2::3",
    "2001:db8::256.1.1.1",
    "2001:db8::g",
    "1:2:3:4:5:6:7:8:9",
    `2001:db8::${"1:".repeat(40)}1`,
  ]) {
    assert.equal(networkPrefix(s), s, JSON.stringify(s));
  }
  for (const s of [V4, V6_A, "::ffff:198.51.100.7", "fe80::1%eth0", "unknown", "v6:2001:db8:abcd:12::/64"]) {
    assert.equal(networkPrefix(networkPrefix(s)), networkPrefix(s), `idempotent: ${s}`);
  }
});

// ─── ② ipRateLimitKey가 네트워크를 센다 ────────────────────────────────────────

const ALL_IP_BUCKETS = [
  "workspace",
  "workspace-check",
  "workspace-recommend",
  "workspace-unstick",
  "workspace-fix",
  "demo",
  "inspection-daily-ip",
  "repair-daily-ip",
];

test("② ipRateLimitKey: 같은 /64의 두 주소 = 같은 키(8개 버킷 전부) · 다른 /64 = 다른 키", async () => {
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  for (const bucket of ALL_IP_BUCKETS) {
    const a = await ipRateLimitKey(env, bucket, V6_A);
    assert.equal(a, await ipRateLimitKey(env, bucket, V6_B), `${bucket}: ::1 and ::2 are one network`);
    assert.equal(a, await ipRateLimitKey(env, bucket, V6_SAME_64_FAR), `${bucket}: anywhere in the /64`);
    assert.equal(a, keyed(bucket, NET_64), `${bucket}: HMAC over the /64 text`);
    assert.notEqual(a, await ipRateLimitKey(env, bucket, V6_OTHER_64), `${bucket}: the next /64 is a different network`);
    assert.match(a, /^v1:[0-9a-f]{64}$/);
  }
});

test("[가드] ② IPv4 키는 예전 값 그대로 — 배포해도 IPv4 카운터는 이어진다(리셋 없음)", async () => {
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  for (const bucket of ALL_IP_BUCKETS) {
    assert.equal(await ipRateLimitKey(env, bucket, V4), keyed(bucket, V4), `${bucket}: v1 key of the raw IPv4 string`);
    assert.notEqual(await ipRateLimitKey(env, bucket, V4), await ipRateLimitKey(env, bucket, V4_OTHER));
  }
});

test("② IPv4-mapped IPv6로 온 요청은 같은 IPv4 행을 센다", async () => {
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  assert.equal(await ipRateLimitKey(env, "workspace", "::ffff:198.51.100.7"), keyed("workspace", V4));
});

test("[가드] ② 이미 네트워크로 바꾼 값(#575 \"v6:…/64\")은 건드리지 않는다 · KEK 없음 = 버킷 공용 키 그대로", async () => {
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  const tagged = "v6:2001:db8:abcd:12::/64";
  assert.equal(await ipRateLimitKey(env, "hosting-report-reporter", tagged), keyed("hosting-report-reporter", tagged));
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await ipRateLimitKey({}, "workspace", V6_A), await ipRateLimitKey({}, "workspace", V6_OTHER_64));
  } finally {
    console.warn = warn;
  }
});

// ─── ③ 실제 SQLite: 일일 네트워크 상한 ────────────────────────────────────────

/** A D1-shaped adapter over node:sqlite (prepare → bind → run/first/all). */
function d1FromSqlite(db) {
  return {
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
}

async function sqliteWithRateTables(t) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite unavailable on this Node version");
    return null;
  }
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "migrations/0026_workspace_rate_limit.sql"), "utf8"));
  db.exec(readFileSync(path.join(ROOT, "migrations/0011_demo_rate_limit.sql"), "utf8"));
  return db;
}

const NOW = new Date("2026-10-01T05:00:00.000Z");
const reqFrom = (ip) => new Request("http://localhost/x", { headers: { "cf-connecting-ip": ip } });

/**
 * main의 [PILOT] 수치(검수 네트워크 30·서비스 300 / 수리 15·50)를 명시한다 — #576이 기본값을 바꿔도
 * (수리 6·20) 이 파일이 재는 것은 "/64 단위로 센다"이지 기본값이 아니다.
 */
const LIMITS = {
  BETA_INSPECTION_DAILY_LIMIT_PER_IP: "30",
  BETA_INSPECTION_DAILY_LIMIT_GLOBAL: "300",
  BETA_REPAIR_DAILY_LIMIT_PER_IP: "15",
  BETA_REPAIR_DAILY_LIMIT_GLOBAL: "50",
};

/** 매번 새 userKey(사용자 버킷은 한 번도 안 걸림) — 네트워크 상한만이 출처를 묶는다. */
async function dispatch(t, kind, ips) {
  const db = await sqliteWithRateTables(t);
  if (!db) return null;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK };
  let accepted = 0;
  const stoppedBy = {};
  for (let i = 0; i < ips.length; i++) {
    const caps = dailyCapsFor(kind, LIMITS, `uk_회전_${i}`, clientNetworkKey(reqFrom(ips[i])));
    const r = await consumeDailyCaps(env, caps, NOW);
    if (r.limited) stoppedBy[r.scope] = (stoppedBy[r.scope] ?? 0) + 1;
    else accepted += 1;
  }
  return { accepted, stoppedBy };
}

const N = 60;
const rotatingIn64 = Array.from({ length: N }, (_, i) => `2001:db8:abcd:12::${(i + 1).toString(16)}`);

test("③ 검수: 같은 /64 안에서 주소를 60번 바꿔도 30건에서 네트워크 상한이 막는다 (옛 코드: 60건 모두 수락)", async (t) => {
  const r = await dispatch(t, "inspection", rotatingIn64);
  if (!r) return;
  assert.deepEqual(r, { accepted: 30, stoppedBy: { network: 30 } });
});

test("③ 수리: 같은 /64에서 주소를 돌려도 15건 — 서비스 전체 몫(50)을 혼자 다 쓰지 못한다 (옛 코드: 50건 수락·서비스 버킷 소진)", async (t) => {
  const r = await dispatch(t, "repair", rotatingIn64);
  if (!r) return;
  assert.deepEqual(r, { accepted: 15, stoppedBy: { network: 45 } });
  assert.ok(!("service" in r.stoppedBy), "the service bucket is left for everyone else");
});

test("③ IPv4-mapped와 점 표기가 섞여 와도 한 네트워크다", async (t) => {
  const ips = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? V4 : "::ffff:198.51.100.7"));
  const r = await dispatch(t, "inspection", ips);
  if (!r) return;
  assert.deepEqual(r, { accepted: 30, stoppedBy: { network: 10 } });
});

test("[가드] ③ 서로 다른 /64 두 곳은 각자 30건 · IPv4 대조군은 그대로 30건", async (t) => {
  // 두 /64는 같은 /48(2001:db8:abcd::/48) 안이다 — 합계 60 = 그 /48의 몫(검수 2×30, 서비스 절반 미만)과 딱 같다.
  const two64 = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? `2001:db8:abcd:12::${i + 1}` : `2001:db8:abcd:13::${i + 1}`));
  const r = await dispatch(t, "inspection", two64);
  if (!r) return;
  assert.deepEqual(r, { accepted: 60, stoppedBy: {} });
  const v4 = await dispatch(t, "inspection", Array.from({ length: N }, () => V4));
  assert.deepEqual(v4, { accepted: 30, stoppedBy: { network: 30 } });
});

// ─── ④ 시간당 5경로 · 문서 인테이크 · 데모 ─────────────────────────────────────

/** Records every workspace_rate_limit / demo_rate_limit statement; reads say "full" so routes stop at 429. */
function captureDb({ projects = new Map(), sources = [] } = {}) {
  const rate = [];
  return {
    rate,
    prepare(sql) {
      const h = (args) => ({
        async first() {
          if (/FROM (workspace|demo)_rate_limit/.test(sql)) {
            rate.push({ sql, args });
            return { count: 9999 };
          }
          if (sql.includes("FROM workspace_projects WHERE id = ?")) return projects.get(args[0]) ?? null;
          if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) {
            return sources.find((s) => s.id === args[0]) ?? null;
          }
          return null;
        },
        async run() {
          if (/(workspace|demo)_rate_limit/.test(sql)) rate.push({ sql, args });
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      });
      return { bind: (...a) => h(a), first: () => h([]).first(), run: () => h([]).run(), all: () => h([]).all() };
    },
  };
}

async function call(env, urlPath, body, ip) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network is forbidden in this test");
  };
  try {
    const res = await createApp().fetch(
      new Request(`http://localhost${urlPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const HOURLY = [
  ["/workspace/idea-to-spec-draft", "workspace", { idea: "동네 빵집 사전 예약 앱 — 사장님이 오늘 구운 빵 수량을 올리면 손님이 예약한다", locale: "ko" }],
  ["/workspace/check-draft", "workspace-check", { productSpec: {}, items: [] }],
  ["/workspace/recommend-answer", "workspace-recommend", { question: "결제는 카드만 받을까요?" }],
  ["/workspace/unstick", "workspace-unstick", { problemText: "배포 후 흰 화면만 나와요" }],
  ["/workspace/fix-suggestion", "workspace-fix", { item: { id: "i1" }, checkResult: {} }],
];

async function hourlyKey(urlPath, body, ip) {
  const db = captureDb();
  const res = await call({ ENVIRONMENT: "test", DB: db, CONCLAVE_TOKEN_KEK: KEK }, urlPath, body, ip);
  assert.equal(res.status, 429, `${urlPath} stops at the (full) hourly cap`);
  const read = db.rate.find((x) => x.sql.includes("SELECT count FROM workspace_rate_limit"));
  assert.ok(read, `${urlPath}: the hourly read happened`);
  return read.args[0];
}

for (const [urlPath, bucket, body] of HOURLY) {
  test(`④ ${urlPath}: 같은 /64의 두 주소가 같은 시간당 행(${bucket})을 센다`, async () => {
    const a = await hourlyKey(urlPath, body, V6_A);
    const b = await hourlyKey(urlPath, body, V6_B);
    assert.equal(a, b, "one /64 = one counter");
    assert.equal(a, keyed(bucket, NET_64));
    assert.notEqual(a, await hourlyKey(urlPath, body, V6_OTHER_64));
  });
}

test("④ 문서 인테이크: 같은 /64의 두 주소가 idea-to-spec과 같은 'workspace' 행을 센다", async () => {
  const USER = "uk_문서_소유자";
  const PROJECT = "wsp_doc_intake";
  const key = `docs/${USER}/${PROJECT}/psrc_doc1/기획서 초안.md`;
  const bytes = new TextEncoder().encode("# 동네 빵집 사전 예약 PRD\n\n사장님이 오늘 구운 빵과 수량을 올리면, 손님은 픽업 시간을 골라 예약한다.");
  const projects = new Map([[PROJECT, {
    id: PROJECT, user_key: USER, title: "빵집 예약", idea: "빵집 예약", understood_json: "{}",
    product_spec_json: "{}", items_json: "[]", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  }]]);
  const sources = [{
    id: "psrc_doc1", project_id: PROJECT, user_key: USER, type: "document", reference: key,
    label: "기획서 초안", content_type: "text/markdown", size_bytes: bytes.length, created_at: "2026-09-01T00:00:00.000Z",
  }];
  const keys = [];
  for (const ip of [V6_A, V6_B]) {
    const db = captureDb({ projects, sources });
    const env = {
      ENVIRONMENT: "test",
      DB: db,
      CONCLAVE_TOKEN_KEK: KEK,
      EVIDENCE: {
        async get(k) {
          if (k !== key) return null;
          return { body: bytes, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        },
      },
    };
    const res = await call(env, `/workspace/projects/${PROJECT}/sources/psrc_doc1/spec-draft`, { userKey: USER }, ip);
    assert.equal(res.status, 429);
    keys.push(db.rate.find((x) => x.sql.includes("SELECT count FROM workspace_rate_limit"))?.args[0]);
  }
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[0], keyed("workspace", NET_64));
});

test("④ 데모(/saas/demo/review): 같은 /64의 두 주소가 같은 하루 행을 센다", async () => {
  const keys = [];
  for (const ip of [V6_A, V6_B]) {
    const db = captureDb();
    const res = await call(
      { ENVIRONMENT: "test", DB: db, ANTHROPIC_API_KEY: "test-anthropic-key-not-real", CONCLAVE_TOKEN_KEK: KEK },
      "/saas/demo/review",
      { diff: "diff --git a/빵집.txt b/빵집.txt\n+예약 버튼 추가\n" },
      ip,
    );
    assert.equal(res.status, 429, "stops at the demo cap before any LLM call");
    keys.push(db.rate.find((x) => x.sql.includes("FROM demo_rate_limit"))?.args[0]);
  }
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[0], keyed("demo", NET_64));
});

// ─── ⑤ 48시간 청소와의 관계 ────────────────────────────────────────────────────

test("[가드] ⑤ 새 /64 키도 \"v1:\" — 레거시 패스는 살아 있는 행을 안 지우고, 창 패스는 48시간 지난 창만 지운다", async (t) => {
  const { purgeExpiredRateLimitRows } = await import("../dist/rate-limit-retention.js");
  const db = await sqliteWithRateTables(t);
  if (!db) return;
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  const net = await ipRateLimitKey(env, "inspection-daily-ip", V6_A);
  assert.ok(net.startsWith(RATE_LIMIT_KEY_PREFIX));
  const ins = db.prepare("INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at) VALUES (?, ?, 1, 't', 't')");
  ins.run(net, "2026-10-01"); //      today → keep
  ins.run(net, "2026-09-28"); //      started 77h ago → delete
  ins.run(await ipRateLimitKey(env, "workspace", V6_B), "2026-10-01T04"); // last hour → keep
  const r = await purgeExpiredRateLimitRows({ DB: d1FromSqlite(db) }, NOW);
  assert.equal(r.legacy.workspace.deleted, 0, "no live /64 row is mistaken for a legacy (unmarked) row");
  assert.equal(r.workspace.deleted, 1);
  const left = db.prepare("SELECT hour_utc AS w FROM workspace_rate_limit ORDER BY hour_utc").all().map((x) => x.w);
  assert.deepEqual(left, ["2026-10-01", "2026-10-01T04"]);
});

/**
 * rate-limit-ipv6-wide-network.test.mjs — IPv6는 /64와 /48 두 단계로 센다 (PR #580 검증 P1, 2026-10-01).
 *
 * 문제 (PR #580 헤드 8e61f82 실측, 하니스 = 0026 스키마 node:sqlite):
 *   networkPrefix가 IPv6를 앞 64비트로만 묶었다. 그런데 가정용 prefix delegation은 /56(RIPE-690)·/60이고,
 *   무료 터널 브로커는 routed /48을 준다. /64만 바꾸면 매번 새 카운터라:
 *     - /48 하나 안의 서브넷 0000..ffff → 'repair-daily-ip' 서로 다른 행 65,536개 · /56 하나 → 256개
 *     - 수리: /64 16개로 60회 → 50건 수락 후 서비스 버킷(50)에서만 멈춤 = 가입자 한 명이 그날 서비스 전체 수리 몫 소진
 *     - 검수: /56 가입자 90회 → 90건 모두 수락(네트워크 상한 30은 /64마다 새로 시작)
 *   "IPv6 한 출처가 카운터를 무한히 만든다"가 2^64에서 2^(64−prefix)로 줄었을 뿐 닫히지 않았다.
 *
 * 고정하는 계약 (rate-limit.ts consumeDailyCaps · rate-limit-key.ts):
 *   ① 네트워크 상한마다 IPv6면 슬롯을 하나 더 뗀다 — 같은 /48의 몫(버킷 `${bucket}/48`).
 *      몫 = max(L, min(2·L, 서비스 한도의 절반 미만)) [PILOT 배수 2]. /64 상한 L이 먼저, /48 몫이 다음, 서비스가 마지막.
 *   ② 한 /48(=/56 가입자 · 무료 터널 하나)로는 서비스 버킷을 비울 수 없다 — 몫이 서비스 절반 미만이다.
 *      #576 수치(수리 네트워크 6 · 서비스 20)에서도 같다(몫 9).
 *   ③ /48 몫이 차서 멈추면 앞에서 뗀 슬롯(사용자·/64)을 돌려주고 scope "network", limit = 그 몫으로 답한다.
 *      성공 뒤 refund()는 /48 행까지 돌려준다.
 *   ④ [가드] /64 하나 안에서만 돌면 /64 상한이 먼저(검수 30) — /48 단계는 한 가입자를 더 조이지 않는다.
 *      IPv4 · IPv4-mapped · IP 아닌 값에는 /48 단계가 없다(행 3개 그대로 · 카운터 연속).
 *
 * 표시 규칙: [가드] = 옛 코드(8e61f82)에서도 통과하는 행동 보존 가드(회귀 증거 아님).
 *            [신규 API] = 옛 코드에서 새 export가 없어서만 실패(동작 회귀의 증거로 세지 않음).
 *            표시 없음 = 옛 코드에서 동작 단언으로 실패.
 * 수치는 env로 고정한다(main 기본값 · #576 기본값 두 벌) — #576이 기본값을 바꿔도 이 테스트의 뜻은 그대로다.
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

const rateMod = await import("../dist/workspace/rate-limit.js");
const { consumeDailyCaps } = rateMod;
const { dailyCapsFor, clientNetworkKey } = await import("../dist/workspace/beta-limits.js");
const keyMod = await import("../dist/workspace/rate-limit-key.js");
const { ipRateLimitKey, networkPrefix } = keyMod;

const KEK = randomBytes(32).toString("base64");
const LABEL = "simsa/rate-limit-ip/v1";

/** 테스트 쪽 독립 구현(node:crypto): stored = "v1:" + HMAC(HMAC(KEK, label), bucket::value). */
function keyed(bucket, value) {
  const subkey = createHmac("sha256", Buffer.from(KEK, "utf8")).update(LABEL, "utf8").digest();
  return "v1:" + createHmac("sha256", subkey).update(`${bucket}::${value}`, "utf8").digest("hex");
}

/** main의 [PILOT] 기본값(beta-limits.ts) — 명시해서 기본값 변경(#576)과 무관하게. */
const MAIN_ENV = {
  BETA_INSPECTION_DAILY_LIMIT_PER_IP: "30",
  BETA_INSPECTION_DAILY_LIMIT_GLOBAL: "300",
  BETA_REPAIR_DAILY_LIMIT_PER_IP: "15",
  BETA_REPAIR_DAILY_LIMIT_GLOBAL: "50",
};
/** #576(비용 권고 ①)의 수리 수치: 네트워크 6 · 서비스 20. */
const PR576_REPAIR_ENV = { BETA_REPAIR_DAILY_LIMIT_PER_IP: "6", BETA_REPAIR_DAILY_LIMIT_GLOBAL: "20" };

const V4 = "198.51.100.7";
const hex4 = (n) => n.toString(16);
/** 2001:db8:abcd::/48 안의 서브넷 `sub`(0..0xffff)에 있는 주소 하나. */
const inWide48 = (sub, host = 1) => `2001:db8:abcd:${hex4(sub)}::${hex4(host)}`;

// ─── 하니스: 실제 SQLite(0026) ──────────────────────────────────────────────────

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

async function sqlite(t) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite unavailable on this Node version");
    return null;
  }
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(ROOT, "migrations/0026_workspace_rate_limit.sql"), "utf8"));
  return db;
}

const NOW = new Date("2026-10-01T05:00:00.000Z");
const DAY = "2026-10-01";
const reqFrom = (ip) => new Request("http://localhost/x", { headers: { "cf-connecting-ip": ip } });

/** 매번 새 userKey(사용자 버킷은 한 번도 안 걸림) — 네트워크 단계만이 출처를 묶는다. */
async function dispatch(env, kind, ips, userPrefix = "uk_회전") {
  let accepted = 0;
  const stoppedBy = {};
  const limits = {};
  for (let i = 0; i < ips.length; i++) {
    const caps = dailyCapsFor(kind, env, `${userPrefix}_${i}`, clientNetworkKey(reqFrom(ips[i])));
    const r = await consumeDailyCaps(env, caps, NOW);
    if (r.limited) {
      stoppedBy[r.scope] = (stoppedBy[r.scope] ?? 0) + 1;
      limits[r.scope] = r.limit;
    } else accepted += 1;
  }
  return { accepted, stoppedBy, limits };
}

function countOf(db, hash) {
  const row = db.prepare("SELECT count FROM workspace_rate_limit WHERE ip_hash = ? AND hour_utc = ?").get(hash, DAY);
  return row ? Number(row.count) : null;
}

const serviceKey = async (bucket) => {
  const { serviceRateLimitKey } = keyMod;
  return serviceRateLimitKey(bucket, "all");
};

// ─── ② 한 /48로는 서비스 버킷을 비울 수 없다 (검증 P1 회귀) ─────────────────────

test("② 수리: 한 /48 안의 /64 16개로 60회 → /48 몫 24에서 멈추고 서비스 버킷(50)은 남는다 (옛 코드: 50건 수락·서비스 소진)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  const ips = Array.from({ length: 60 }, (_, i) => inWide48(i % 16, i + 1));
  const r = await dispatch(env, "repair", ips);
  assert.deepEqual(r, { accepted: 24, stoppedBy: { network: 36 }, limits: { network: 24 } });
  assert.equal(countOf(db, await serviceKey("repair-daily-global")), 24, "service bucket: 24 of 50 used — 26 left for everyone else");
});

test("② 검수: /56 가입자(서브넷 256개)가 /64마다 90회 → /48 몫 60에서 멈춘다 (옛 코드: 90건 모두 수락)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  // 2001:db8:abcd:1200::/56 — 네 번째 그룹의 윗 8비트(0x12)가 가입자 몫, 아래 8비트가 서브넷.
  const ips = Array.from({ length: 90 }, (_, i) => `2001:db8:abcd:12${i.toString(16).padStart(2, "0")}::1`);
  const r = await dispatch(env, "inspection", ips);
  assert.deepEqual(r, { accepted: 60, stoppedBy: { network: 30 }, limits: { network: 60 } });
});

test("② 검수: 무료 터널 /48 — 서브넷 0000..ffff에 흩어 200회 → 60에서 멈춘다 (옛 코드: 200건 모두 수락)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  const ips = Array.from({ length: 200 }, (_, i) => inWide48((i * 0x149) & 0xffff, 7));
  assert.equal(new Set(ips.map((ip) => networkPrefix(ip))).size, 200, "200 distinct /64s");
  const r = await dispatch(env, "inspection", ips);
  assert.deepEqual(r, { accepted: 60, stoppedBy: { network: 140 }, limits: { network: 60 } });
});

test("② #576 수치(수리 네트워크 6·서비스 20): 한 /48의 몫은 9 — 서비스 절반 미만 (옛 코드: 20건 수락·서비스 소진)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...PR576_REPAIR_ENV };
  const ips = Array.from({ length: 60 }, (_, i) => inWide48(i % 16, i + 1));
  const r = await dispatch(env, "repair", ips);
  assert.deepEqual(r, { accepted: 9, stoppedBy: { network: 51 }, limits: { network: 9 } });
  assert.equal(countOf(db, await serviceKey("repair-daily-global")), 9);
});

test("② 서로 다른 /48 두 곳은 각자 몫(60+60) — 몫은 /48마다 따로다 (옛 코드: 140건 모두 수락)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  const ips = Array.from({ length: 140 }, (_, i) =>
    i % 2 === 0 ? inWide48(i, 1) : `2001:db8:beef:${hex4(i)}::1`,
  );
  const r = await dispatch(env, "inspection", ips);
  assert.deepEqual(r, { accepted: 120, stoppedBy: { network: 20 }, limits: { network: 60 } });
});

// ─── ③ 돌려주기 · 응답 ──────────────────────────────────────────────────────────

test("③ /48 몫이 차서 멈추면 앞에서 뗀 사용자·/64 슬롯을 돌려준다 · 응답 scope network · limit = 몫 (옛 코드: 수락)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  // /48 몫(24)을 16개 /64로 채운다.
  const fill = await dispatch(env, "repair", Array.from({ length: 24 }, (_, i) => inWide48(i % 16, i + 1)), "uk_채움");
  assert.equal(fill.accepted, 24);
  // 아직 아무도 안 쓴 /64에서 처음 보내는 요청 — /64·사용자 버킷은 비어 있다.
  const freshIp = inWide48(0x0bad, 1);
  const user = "uk_새_기기_홍길동";
  const r = await consumeDailyCaps(env, dailyCapsFor("repair", env, user, clientNetworkKey(reqFrom(freshIp))), NOW);
  assert.equal(r.limited, true, "the /48 share is full");
  assert.equal(r.scope, "network");
  assert.equal(r.limit, 24, "the cap that was full is the /48 share");
  assert.equal(countOf(db, await ipRateLimitKey(env, "repair-daily-ip", freshIp)), 0, "/64 slot handed back");
  const { userRateLimitKey } = keyMod;
  assert.equal(countOf(db, await userRateLimitKey(env, "repair-daily", user)), 0, "user slot handed back");
  assert.equal(countOf(db, await serviceKey("repair-daily-global")), 24, "service untouched by the refused request");
});

test("③ 성공한 IPv6 요청은 행 4개(사용자·/64·/48·서비스) — refund()가 /48 행까지 0으로 돌린다 (옛 코드: 행 3개)", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  const r = await consumeDailyCaps(env, dailyCapsFor("inspection", env, "uk_환급", clientNetworkKey(reqFrom(inWide48(0x12, 5)))), NOW);
  assert.equal(r.limited, false);
  const rows = () => db.prepare("SELECT count FROM workspace_rate_limit WHERE hour_utc = ?").all(DAY).map((x) => Number(x.count));
  assert.deepEqual(rows(), [1, 1, 1, 1], "user · /64 · /48 · service");
  await r.refund();
  assert.deepEqual(rows(), [0, 0, 0, 0], "every slot back, the /48 one included");
});

// ─── ④ [가드] 한 가입자를 더 조이지 않는다 · IPv4는 그대로 ─────────────────────

test("[가드] ④ /64 하나 안에서만 돌면 /64 상한(검수 30)이 먼저 — limit은 30으로 답한다", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  const ips = Array.from({ length: 60 }, (_, i) => inWide48(0x12, i + 1));
  const r = await dispatch(env, "inspection", ips);
  assert.deepEqual(r, { accepted: 30, stoppedBy: { network: 30 }, limits: { network: 30 } });
});

test("[가드] ④ IPv4 · IPv4-mapped에는 /48 단계가 없다 — 요청 하나에 행 3개, 60회 → 30", async (t) => {
  const db = await sqlite(t);
  if (!db) return;
  const env = { DB: d1FromSqlite(db), CONCLAVE_TOKEN_KEK: KEK, ...MAIN_ENV };
  const first = await consumeDailyCaps(env, dailyCapsFor("inspection", env, "uk_v4", clientNetworkKey(reqFrom(V4))), NOW);
  assert.equal(first.limited, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspace_rate_limit").get().n, 3, "user · network · service");
  const r = await dispatch(env, "inspection", Array.from({ length: 59 }, (_, i) => (i % 2 ? V4 : "::ffff:198.51.100.7")));
  assert.deepEqual(r, { accepted: 29, stoppedBy: { network: 30 }, limits: { network: 30 } });
  // 사용자 행은 60개(거절된 요청도 사용자 슬롯을 뗐다가 돌려받아 count 0인 행이 남는다) + 네트워크 1 + 서비스 1.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspace_rate_limit WHERE hour_utc = ?").get(DAY).n, 62, "no wide row for IPv4");
});

// ─── ① [신규 API] 키 · 몫 계산 ─────────────────────────────────────────────────

function newApi(name) {
  const where = typeof keyMod[name] === "function" ? keyMod : rateMod;
  assert.equal(typeof where[name], "function", `must export ${name}`);
  return where[name];
}

test("[신규 API] ① networkPrefix(ip, 48): 같은 /48 = 같은 텍스트 · IPv4·mapped·IP 아님은 /64 때와 같다", () => {
  for (const ip of [
    "2001:db8:abcd:12::1",
    "2001:DB8:ABCD:FFFF::1%eth0",
    "2001:0db8:abcd:0000:0000:0000:0000:0001",
    "2001:db8:abcd:1200:ffff:1:2:3",
    inWide48(0xffff, 0xffff),
  ]) {
    assert.equal(networkPrefix(ip, 48), "2001:db8:abcd::/48", ip);
  }
  assert.equal(networkPrefix("2001:db8:abce::1", 48), "2001:db8:abce::/48");
  assert.equal(networkPrefix("::1", 48), "0:0:0::/48");
  assert.equal(networkPrefix("2001:db8:abcd:12::1", 64), "2001:db8:abcd:12::/64", "64 stays the default text");
  assert.equal(networkPrefix("2001:db8:abcd:12::1"), "2001:db8:abcd:12::/64");
  for (const s of [V4, "", "unknown", "알 수 없음 (프록시)", "v6:2001:db8:abcd:12::/64", "2001:db8:abcd::/48", "198.51.100.7:443"]) {
    assert.equal(networkPrefix(s, 48), s, JSON.stringify(s));
  }
  assert.equal(networkPrefix("::ffff:198.51.100.7", 48), V4, "mapped = the IPv4 address at any width");
});

test("[신규 API] ① ipWideRateLimitKey: /48 하나 = 키 하나(서브넷 4,096개 표본) · /64 키와 다른 행 · IPv6 아니면 null", async () => {
  const ipWideRateLimitKey = newApi("ipWideRateLimitKey");
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  const want = keyed("repair-daily-ip/48", "2001:db8:abcd::/48");
  const seen = new Set();
  for (let sub = 0; sub < 0x10000; sub += 16) seen.add(await ipWideRateLimitKey(env, "repair-daily-ip", inWide48(sub, sub + 1)));
  assert.deepEqual([...seen], [want], "every subnet of the /48 → one wide key");
  assert.notEqual(want, await ipRateLimitKey(env, "repair-daily-ip", inWide48(0, 1)), "never the /64 row");
  assert.notEqual(want, await ipWideRateLimitKey(env, "repair-daily-ip", "2001:db8:abce::1"), "next /48 = another row");
  assert.notEqual(want, await ipWideRateLimitKey(env, "inspection-daily-ip", inWide48(0, 1)), "bucket separates too");
  for (const s of [V4, "::ffff:198.51.100.7", "", "unknown", "v6:2001:db8:abcd:12::/64", "2001:db8:abcd::/48"]) {
    assert.equal(await ipWideRateLimitKey(env, "repair-daily-ip", s), null, JSON.stringify(s));
  }
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await ipWideRateLimitKey({}, "repair-daily-ip", inWide48(0, 1)), null, "no KEK → no wide row at all (the shared /64 stand-in already binds everyone)");
  } finally {
    console.warn = warn;
  }
});

test("[신규 API] ① /48 몫 = max(L, min(2·L, 서비스 절반 미만)) — main·#576·#569 수치", () => {
  const ipv6WideNetworkLimit = newApi("ipv6WideNetworkLimit");
  assert.equal(ipv6WideNetworkLimit(30, 300), 60, "inspection (main)");
  assert.equal(ipv6WideNetworkLimit(15, 50), 24, "repair (main): 2·15=30 would be 60% of 50 → 24");
  assert.equal(ipv6WideNetworkLimit(6, 20), 9, "repair (#576)");
  assert.equal(ipv6WideNetworkLimit(100, 500), 200, "generation (#576)");
  assert.equal(ipv6WideNetworkLimit(40, 200), 80, "dev-spec (#576)");
  assert.equal(ipv6WideNetworkLimit(5, 30), 10, "build (#569)");
  assert.equal(ipv6WideNetworkLimit(30, 40), 30, "never below the /64 cap (an IPv6 caller never gets less than an IPv4 one)");
  assert.equal(ipv6WideNetworkLimit(7, null), 14, "no service cap in the consume → 2·L");
});

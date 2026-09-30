/**
 * rate-limit-ip-keyed-hash.test.mjs — 요청 한도 기록의 IP 키 · 48시간 청소 (Train W 방침 고지 후속).
 *
 * 문제 (2026-09-29, main 기준):
 *   1. IP가 사실상 저장됐다 — workspace.ts·workspace-document-intake.ts는 `sha256(workspace::${ip})`처럼
 *      비밀 키 없는 SHA-256을 workspace_rate_limit.ip_hash에 썼다. IPv4는 약 43억 개뿐이라 전부 대입해
 *      곧바로 되돌릴 수 있다(가명이 아니다). Train W 네트워크 일일 상한(inspection-daily-ip · repair-daily-ip)도
 *      rate-limit.ts에서 `sha256(${bucket}::${ip})`, 데모(demo.ts)는 코드에 박힌 공개 솔트("conclave-demo").
 *   2. 행이 지워지지 않았다 — workspace_rate_limit·demo_rate_limit를 청소하는 크론이 없었다.
 *
 * 고정하는 계약:
 *   ① IP에서 나온 한도 키 = HMAC-SHA256(subkey, `${bucket}::${ip}`) hex,
 *      subkey = HMAC-SHA256(CONCLAVE_TOKEN_KEK의 UTF-8 바이트, "simsa/rate-limit-ip/v1").
 *   ② KEK가 없으면 IP 대신 버킷 공용 키: sha256(`${bucket}::no-key`) — IP는 저장 입력에 쓰이지 않는다.
 *   ③ workspace.ts 다섯 경로 · document-intake · 네트워크 일일 상한 · 데모가 모두 ①을 쓴다(가짜 D1 바인드 값).
 *   ④ 청소: 시작한 지 48시간이 지난 창(시간 창 "YYYY-MM-DDTHH"·일 창 "YYYY-MM-DD")의 행을 지우고,
 *      지금 쓰이는 창은 절대 지우지 않는다(node:sqlite로 실제 SQL을 0011·0026 스키마에서 실행 — node:sqlite가
 *      없는 Node 20에서는 그 셋이 skip되고, 가짜 D1의 SQL 문자열·바인드 검사가 모든 Node에서 돈다). fail-open.
 *
 * PR #566 리뷰 후속 (2026-09-29):
 *   ⑤ 레거시 행: 창 규칙만으로는 배포 직전 48시간 안에 옛 코드가 쓴 비키 해시 행이 배포 뒤 최대 약 54시간
 *      남는다(방침 "비밀 키로만"이 그동안 거짓). → 새 코드가 쓰는 모든 키는 "v1:"로 시작하고, 청소가 그 표시가
 *      없는 행을 창과 상관없이 지운다 — 배포 뒤 첫 6시간 틱에 레거시 행이 모두 사라진다.
 *   ⑥ 사용자 키 버킷: userKey는 무작위 UUID가 아니라 `uk_${Date.now().toString(36)}…`이고 같은 D1의 20여 테이블에
 *      평문으로 있다 → sha256(bucket::userKey)는 DB를 읽는 쪽이 곧바로 사용자에 연결한다. 사용자 키도 비밀 키
 *      HMAC(라벨 "simsa/rate-limit-user/v1")으로. KEK가 없으면 격리 수명의 임시 무작위 키.
 *
 * 표시 규칙: [가드] = 옛 코드에서도 통과하는 행동 보존 가드(회귀 증거 아님). 표시 없음 = 옛 코드에서 실패.
 * 네트워크 없음: 라우트 테스트는 429에서 멈추고, 혹시 모를 호출은 fetch 스텁이 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const { createApp } = await import("../dist/router.js");
const { consumeDailyCaps } = await import("../dist/workspace/rate-limit.js");
const { dailyCapsFor, clientNetworkKey } = await import("../dist/workspace/beta-limits.js");

const KEK = randomBytes(32).toString("base64");
const KEK_ROTATED = randomBytes(32).toString("base64");
const LABEL = "simsa/rate-limit-ip/v1";
const USER_LABEL = "simsa/rate-limit-user/v1";
/** Format marker of every key the new code writes (rows without it are legacy → purged). */
const V1 = "v1:";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
function hmacUnder(kek, label, message) {
  const subkey = createHmac("sha256", Buffer.from(kek, "utf8")).update(label, "utf8").digest();
  return createHmac("sha256", subkey).update(message, "utf8").digest("hex");
}
/** 테스트 쪽 독립 구현(node:crypto) — 서버 구현(WebCrypto)과 같은 값이어야 한다. */
function keyed(kek, bucket, ip) {
  return V1 + hmacUnder(kek, LABEL, `${bucket}::${ip}`);
}
/** userKey 버킷: 같은 방식, 다른 라벨의 하위 키. */
function userKeyed(kek, bucket, userKey) {
  return V1 + hmacUnder(kek, USER_LABEL, `${bucket}::${userKey}`);
}

/** The helper module is new — load lazily so each test fails on its own on old code. */
async function loadKeyModule() {
  const mod = await import("../dist/workspace/rate-limit-key.js").catch(() => null);
  assert.ok(mod, "dist/workspace/rate-limit-key.js must exist (keyed IP rate-limit helper)");
  assert.equal(typeof mod.ipRateLimitKey, "function", "ipRateLimitKey export");
  return mod;
}

async function loadRetentionModule() {
  const mod = await import("../dist/rate-limit-retention.js").catch(() => null);
  assert.ok(mod, "dist/rate-limit-retention.js must exist (48h rate-limit purge)");
  assert.equal(typeof mod.purgeExpiredRateLimitRows, "function", "purgeExpiredRateLimitRows export");
  return mod;
}

// 문서용 IP 대역(RFC 5737 / RFC 3849)만 쓴다.
const IP_A = "198.51.100.7";
const IP_B = "203.0.113.9";
const IP_V6 = "2001:db8::1";

// ─── ① 키 모양 ─────────────────────────────────────────────────────────────────

test("① 같은 IP·같은 버킷·같은 KEK → 같은 저장값 = \"v1:\" + HMAC(subkey, bucket::ip) · 64자 hex", async () => {
  const { ipRateLimitKey } = await loadKeyModule();
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  const a1 = await ipRateLimitKey(env, "workspace", IP_A);
  const a2 = await ipRateLimitKey(env, "workspace", IP_A);
  assert.equal(a1, a2, "deterministic — the counter must find its own row again");
  assert.match(a1, /^v1:[0-9a-f]{64}$/);
  assert.equal(a1, keyed(KEK, "workspace", IP_A), "subkey = HMAC(KEK, label); stored = HMAC(subkey, bucket::ip)");
  // IPv6 is keyed by its /64 network (2026-10-01, rate-limit-ipv6-network.test.mjs) — "2001:db8::1" → "2001:db8:0:0::/64".
  assert.equal(await ipRateLimitKey(env, "workspace", IP_V6), keyed(KEK, "workspace", "2001:db8:0:0::/64"), "IPv6 too (per /64)");
});

test("① 저장값에 IP가 없고, 옛 방식 sha256(bucket::ip) · 데모 옛 솔트와 다르다", async () => {
  const { ipRateLimitKey } = await loadKeyModule();
  const env = { CONCLAVE_TOKEN_KEK: KEK };
  for (const [bucket, ip] of [["workspace", IP_A], ["workspace-check", IP_B], ["inspection-daily-ip", IP_A], ["demo", IP_V6]]) {
    const stored = await ipRateLimitKey(env, bucket, ip);
    assert.ok(!stored.includes(ip), `${bucket}: stored value contains the IP`);
    assert.notEqual(stored, sha256(`${bucket}::${ip}`), `${bucket}: still the unkeyed (brute-forceable) SHA-256`);
    assert.notEqual(stored, sha256(`conclave-demo::${ip}`), `${bucket}: still the public demo salt`);
  }
});

test("① KEK가 바뀌면 저장값이 바뀐다 · 버킷이 다르면 저장값이 다르다 (경로별 카운터 분리 유지)", async () => {
  const { ipRateLimitKey } = await loadKeyModule();
  const a = await ipRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "workspace", IP_A);
  const rotated = await ipRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK_ROTATED }, "workspace", IP_A);
  assert.notEqual(a, rotated, "the secret is an input — without it the value cannot be recomputed");
  assert.equal(rotated, keyed(KEK_ROTATED, "workspace", IP_A), "no stale subkey after rotation");
  const other = await ipRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "workspace-check", IP_A);
  assert.notEqual(a, other);
  assert.notEqual(
    await ipRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "workspace", IP_B),
    a,
    "different IPs keep different counters",
  );
});

test("① 비ASCII가 섞인 값도 UTF-8 그대로 같은 값 (x-forwarded-for는 호출자가 쓰는 헤더다)", async () => {
  const { ipRateLimitKey } = await loadKeyModule();
  const junk = "알 수 없음 (프록시)";
  assert.equal(await ipRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "workspace", junk), keyed(KEK, "workspace", junk));
});

// ─── ② KEK 없음 → 버킷 공용 키 ────────────────────────────────────────────────

test("② KEK 없음(미설정·빈 문자열·null) → IP 대신 버킷 공용 키 sha256(bucket::no-key) — IP는 저장 입력에 쓰이지 않는다", async () => {
  const { ipRateLimitKey } = await loadKeyModule();
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    for (const env of [{}, { CONCLAVE_TOKEN_KEK: "" }, { CONCLAVE_TOKEN_KEK: null }]) {
      const a = await ipRateLimitKey(env, "workspace", IP_A);
      const b = await ipRateLimitKey(env, "workspace", IP_B);
      assert.equal(a, b, "every caller shares one counter — nothing IP-derived is stored");
      assert.equal(a, V1 + sha256("workspace::no-key"));
      assert.notEqual(a, sha256(`workspace::${IP_A}`));
    }
    assert.notEqual(
      await ipRateLimitKey({}, "workspace-check", IP_A),
      await ipRateLimitKey({}, "workspace", IP_A),
      "buckets stay separate even without a key",
    );
  } finally {
    console.warn = warn;
  }
  assert.ok(warned.length <= 1, `the fallback warns at most once per isolate (got ${warned.length})`);
  for (const line of warned) {
    assert.doesNotThrow(() => JSON.parse(line), "one-line JSON");
    assert.ok(!line.includes(IP_A) && !line.includes(IP_B), "the warning never carries the IP");
  }
});

// ─── ③ 모든 IP 경로가 새 헬퍼를 쓴다 (가짜 D1 바인드) ───────────────────────────

/** Records every workspace_rate_limit / demo_rate_limit statement; reads say "full" so routes stop at 429. */
function captureDb({ count = 9999, projects = new Map(), sources = [] } = {}) {
  const rate = [];
  return {
    rate,
    prepare(sql) {
      const h = (args) => ({
        async first() {
          if (/FROM (workspace|demo)_rate_limit/.test(sql)) {
            rate.push({ sql, args });
            return { count };
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

async function call(env, method, urlPath, body, headers = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network is forbidden in this test");
  };
  try {
    const res = await createApp().fetch(
      new Request(`http://localhost${urlPath}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Hourly workspace routes — bucket names and 429 copy exactly as before (behaviour must not change). */
const HOURLY_ROUTES = [
  {
    path: "/workspace/idea-to-spec-draft",
    bucket: "workspace",
    body: { idea: "동네 빵집 사전 예약 앱 — 사장님이 오늘 구운 빵 수량을 올리면 손님이 예약한다", locale: "ko" },
    message: "잠시 후 다시 시도해주세요. 제품 설명서 만들기 요청이 짧은 시간에 많이 발생했어요.",
  },
  {
    path: "/workspace/check-draft",
    bucket: "workspace-check",
    body: { productSpec: {}, items: [] },
    message: "잠시 후 다시 시도해주세요. 확인 요청이 너무 많이 발생했어요.",
  },
  {
    path: "/workspace/recommend-answer",
    bucket: "workspace-recommend",
    body: { question: "결제는 카드만 받을까요?" },
    message: "잠시 후 다시 시도해주세요. 요청이 너무 많이 발생했어요.",
  },
  {
    path: "/workspace/unstick",
    bucket: "workspace-unstick",
    body: { problemText: "배포 후 흰 화면만 나와요" },
    message: "잠시 후 다시 시도해주세요. 요청이 너무 많이 발생했어요.",
  },
  {
    path: "/workspace/fix-suggestion",
    bucket: "workspace-fix",
    body: { item: { id: "i1" }, checkResult: {} },
    message: "잠시 후 다시 시도해주세요.",
  },
];

for (const r of HOURLY_ROUTES) {
  test(`③ ${r.path}: workspace_rate_limit에 바인드되는 값 = HMAC(${r.bucket}::ip) — 옛 sha256(${r.bucket}::ip) 아님`, async () => {
    const db = captureDb();
    const res = await call({ ENVIRONMENT: "test", DB: db, CONCLAVE_TOKEN_KEK: KEK }, "POST", r.path, r.body, {
      "cf-connecting-ip": IP_A,
    });
    assert.equal(res.status, 429);
    const read = db.rate.find((x) => x.sql.includes("SELECT count FROM workspace_rate_limit"));
    assert.ok(read, "the hourly read happened");
    assert.equal(read.args[0], keyed(KEK, r.bucket, IP_A));
    assert.notEqual(read.args[0], sha256(`${r.bucket}::${IP_A}`));
    assert.ok(!db.rate.some((x) => x.args.some((a) => String(a).includes(IP_A))), "no bind carries the raw IP");
  });

  test(`[가드] ③ ${r.path}: 429 본문·Retry-After는 그대로`, async () => {
    const db = captureDb();
    const res = await call({ ENVIRONMENT: "test", DB: db, CONCLAVE_TOKEN_KEK: KEK }, "POST", r.path, r.body, {
      "cf-connecting-ip": IP_A,
    });
    assert.equal(res.status, 429);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, "rate_limited");
    assert.equal(res.json.message, r.message);
    assert.ok(Number(res.json.retryAfterSeconds) >= 60);
    assert.ok(Number(res.headers.get("retry-after")) >= 60);
  });
}

test("③ cf-connecting-ip가 없으면 x-forwarded-for 첫 홉 — 그 값도 HMAC로만 (추출 순서는 그대로)", async () => {
  const db = captureDb();
  const res = await call(
    { ENVIRONMENT: "test", DB: db, CONCLAVE_TOKEN_KEK: KEK },
    "POST",
    "/workspace/unstick",
    { problemText: "로그인 버튼이 안 눌려요" },
    { "x-forwarded-for": `${IP_B}, 10.0.0.1` },
  );
  assert.equal(res.status, 429);
  const read = db.rate.find((x) => x.sql.includes("SELECT count FROM workspace_rate_limit"));
  assert.equal(read.args[0], keyed(KEK, "workspace-unstick", IP_B));
});

// document intake shares the idea-to-spec hourly counter ("workspace" bucket) — must still land on the SAME row.
const USER = "uk_문서_소유자";
const PROJECT = "wsp_doc_intake";
const PRD = [
  "# 동네 빵집 사전 예약 PRD",
  "",
  "사장님이 오늘 구운 빵과 수량을 올리면, 손님은 픽업 시간을 골라 예약한다.",
  "예약이 다 차면 그 빵은 품절로 보이고, 사장님은 예약 목록을 시간순으로 본다.",
].join("\n");

function intakeEnv(db) {
  const key = `docs/${USER}/${PROJECT}/psrc_doc1/기획서 초안.md`;
  const bytes = new TextEncoder().encode(PRD);
  return {
    ENVIRONMENT: "test",
    DB: db,
    CONCLAVE_TOKEN_KEK: KEK,
    EVIDENCE: {
      async get(k) {
        if (k !== key) return null;
        return { body: bytes, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      },
    },
    _key: key,
  };
}

test("③ 문서 인테이크: idea-to-spec과 같은 'workspace' 버킷의 같은 HMAC 행 (공유 카운터 유지)", async () => {
  const projects = new Map([[PROJECT, {
    id: PROJECT, user_key: USER, title: "빵집 예약", idea: "빵집 예약", understood_json: "{}",
    product_spec_json: "{}", items_json: "[]", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  }]]);
  const env0 = intakeEnv(null);
  const sources = [{
    id: "psrc_doc1", project_id: PROJECT, user_key: USER, type: "document", reference: env0._key,
    label: "기획서 초안", content_type: "text/markdown", size_bytes: 321, created_at: "2026-09-01T00:00:00.000Z",
  }];
  const db = captureDb({ projects, sources });
  const res = await call(intakeEnv(db), "POST", `/workspace/projects/${PROJECT}/sources/psrc_doc1/spec-draft`, { userKey: USER }, {
    "cf-connecting-ip": IP_A,
  });
  assert.equal(res.status, 429, JSON.stringify(res.json));
  const read = db.rate.find((x) => x.sql.includes("SELECT count FROM workspace_rate_limit"));
  assert.ok(read, "the hourly read happened");
  assert.equal(read.args[0], keyed(KEK, "workspace", IP_A));

  const idea = captureDb();
  await call({ ENVIRONMENT: "test", DB: idea, CONCLAVE_TOKEN_KEK: KEK }, "POST", "/workspace/idea-to-spec-draft", HOURLY_ROUTES[0].body, {
    "cf-connecting-ip": IP_A,
  });
  assert.equal(idea.rate[0].args[0], read.args[0], "idea intake and document intake still share one counter per network");
});

test("③ 데모(/saas/demo/review): demo_rate_limit 바인드 = HMAC — 공개 솔트 sha256('conclave-demo::ip') 아님, DEMO_RATE_SALT는 섞여 회전이 유지된다", async () => {
  const base = { ENVIRONMENT: "test", ANTHROPIC_API_KEY: "test-anthropic-key-not-real", CONCLAVE_TOKEN_KEK: KEK };
  const body = { diff: "diff --git a/빵집.txt b/빵집.txt\n+예약 버튼 추가\n" };
  const db = captureDb();
  const res = await call({ ...base, DB: db }, "POST", "/saas/demo/review", body, { "cf-connecting-ip": IP_A });
  assert.equal(res.status, 429, "stops at the demo cap before any LLM call");
  const read = db.rate.find((x) => x.sql.includes("FROM demo_rate_limit"));
  assert.ok(read);
  assert.equal(read.args[0], keyed(KEK, "demo", IP_A));
  assert.notEqual(read.args[0], sha256(`conclave-demo::${IP_A}`));

  const salted = captureDb();
  await call({ ...base, DB: salted, DEMO_RATE_SALT: "rotation-2026-09" }, "POST", "/saas/demo/review", body, { "cf-connecting-ip": IP_A });
  const saltedRead = salted.rate.find((x) => x.sql.includes("FROM demo_rate_limit"));
  assert.equal(saltedRead.args[0], keyed(KEK, "demo:rotation-2026-09", IP_A));
  assert.notEqual(saltedRead.args[0], read.args[0], "rotating DEMO_RATE_SALT still starts fresh demo counters");
  assert.notEqual(saltedRead.args[0], sha256(`rotation-2026-09::${IP_A}`));
});

test("[가드] ③ 데모 429 본문은 그대로", async () => {
  const db = captureDb();
  const res = await call(
    { ENVIRONMENT: "test", DB: db, ANTHROPIC_API_KEY: "test-anthropic-key-not-real", CONCLAVE_TOKEN_KEK: KEK },
    "POST",
    "/saas/demo/review",
    { diff: "diff --git a/x b/x\n+y\n" },
    { "cf-connecting-ip": IP_A },
  );
  assert.equal(res.status, 429);
  assert.equal(res.json.error, "rate_limited");
  assert.match(res.json.error_description, /Demo cap reached: 3 reviews per day/);
  assert.ok(res.json.retry_after_seconds >= 60);
});

// Network daily cap (Train W): rate-limit.ts consumeDailyCaps — the network bucket's key is an IP.

/** Records the single-statement consume + refund binds. `fullBuckets`: hashes that answer "full". */
function slotDb(fullHashes = new Set()) {
  const consumes = [];
  const refunds = [];
  return {
    consumes,
    refunds,
    prepare(sql) {
      return {
        bind: (...args) => ({
          async run() {
            if (sql.includes("INSERT INTO workspace_rate_limit") && sql.includes("WHERE workspace_rate_limit.count < ?")) {
              consumes.push(args[0]);
              return { meta: { changes: fullHashes.has(args[0]) ? 0 : 1 } };
            }
            if (sql.includes("UPDATE workspace_rate_limit")) {
              refunds.push(args[1]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        }),
      };
    },
  };
}

const NOW = new Date("2026-09-29T15:30:00.000Z");
const reqFrom = (ip) => new Request("http://localhost/x", { headers: { "cf-connecting-ip": ip } });

test("③ 네트워크 일일 상한: 검수·수리의 네트워크 버킷 = HMAC(inspection-daily-ip|repair-daily-ip::ip)", async () => {
  for (const [kind, ipBucket] of [["inspection", "inspection-daily-ip"], ["repair", "repair-daily-ip"]]) {
    const db = slotDb();
    const caps = dailyCapsFor(kind, {}, "uk_사용자_1", clientNetworkKey(reqFrom(IP_A)));
    const r = await consumeDailyCaps({ DB: db, CONCLAVE_TOKEN_KEK: KEK }, caps, NOW);
    assert.equal(r.limited, false);
    assert.equal(db.consumes.length, 3, "user · network · service");
    assert.equal(db.consumes[1], keyed(KEK, ipBucket, IP_A), `${kind}: network bucket is keyed`);
    assert.notEqual(db.consumes[1], sha256(`${ipBucket}::${IP_A}`));
  }
});

test("⑥ 일일 상한: 사용자 버킷 = HMAC(사용자 하위 키, bucket::userKey) — 평문 user_key로 계산되는 sha256가 아니다 · 서비스 버킷 = \"v1:\" + sha256(고정 키)", async () => {
  // userKey는 `uk_${Date.now().toString(36)}` + Math.random 5자이고 같은 D1의 user_key 칸들에 평문으로 있다 →
  // sha256("inspection-daily::" + user_key)를 저장하면 DB를 읽는 쪽이 요청 한도 행을 곧바로 사용자에 연결한다.
  const db = slotDb();
  const caps = dailyCapsFor("inspection", {}, "uk_사용자_1", clientNetworkKey(reqFrom(IP_A)));
  await consumeDailyCaps({ DB: db, CONCLAVE_TOKEN_KEK: KEK }, caps, NOW);
  assert.equal(db.consumes[0], userKeyed(KEK, "inspection-daily", "uk_사용자_1"));
  assert.notEqual(db.consumes[0], sha256("inspection-daily::uk_사용자_1"), "linkable to the plain user_key columns");
  assert.notEqual(db.consumes[0], keyed(KEK, "inspection-daily", "uk_사용자_1"), "user and IP subkeys are separate");
  assert.ok(!db.consumes[0].includes("uk_사용자_1"));
  assert.equal(db.consumes[2], V1 + sha256("inspection-daily-global::all"), "service key is not personal — marked sha256");
});

test("③ 네트워크 일일 상한: 뒤 버킷이 가득 차 환급할 때도 같은 HMAC 행으로 돌려준다", async () => {
  const service = V1 + sha256("inspection-daily-global::all");
  const db = slotDb(new Set([service]));
  const caps = dailyCapsFor("inspection", {}, "uk_사용자_2", clientNetworkKey(reqFrom(IP_B)));
  const r = await consumeDailyCaps({ DB: db, CONCLAVE_TOKEN_KEK: KEK }, caps, NOW);
  assert.equal(r.limited, true);
  assert.equal(r.scope, "service");
  assert.deepEqual(db.refunds, [userKeyed(KEK, "inspection-daily", "uk_사용자_2"), keyed(KEK, "inspection-daily-ip", IP_B)]);
});

test("③ 네트워크 일일 상한: KEK 없음 → 네트워크 버킷은 공용 키(IP 무관)", async () => {
  const a = slotDb();
  const b = slotDb();
  await consumeDailyCaps({ DB: a }, dailyCapsFor("repair", {}, "uk_1", clientNetworkKey(reqFrom(IP_A))), NOW);
  await consumeDailyCaps({ DB: b }, dailyCapsFor("repair", {}, "uk_2", clientNetworkKey(reqFrom(IP_B))), NOW);
  assert.equal(a.consumes[1], V1 + sha256("repair-daily-ip::no-key"));
  assert.equal(a.consumes[1], b.consumes[1]);
});

test("③ 전수: src에서 요청 IP를 비밀 키 없는 sha256Hex로 해시하는 곳이 없다", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(path.join(ROOT, "src"));
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (/sha256Hex\(`[^`]*\$\{rawIp\}/.test(src)) offenders.push(`${path.relative(ROOT, f)}: sha256Hex(…\${rawIp})`);
    if (/sha256Hex\(`\$\{cap\.bucket\}::\$\{cap\.key\}`\)/.test(src) && !/ipRateLimitKey/.test(src)) {
      offenders.push(`${path.relative(ROOT, f)}: daily caps hash every key with plain sha256`);
    }
    if (/"conclave-demo"/.test(src)) offenders.push(`${path.relative(ROOT, f)}: public demo salt`);
  }
  assert.deepEqual(offenders, []);
});

test("⑥ 전수: rate-limit.ts는 사용자 키를 비밀 키 없는 sha256으로 해시하지 않는다", () => {
  const src = readFileSync(path.join(ROOT, "src/workspace/rate-limit.ts"), "utf8");
  assert.ok(!/sha256Hex\(`\$\{bucket\}::\$\{userKey\}`\)/.test(src), "user buckets: plain sha256(bucket::userKey)");
  assert.ok(!/sha256Hex\(`\$\{cap\.bucket\}::\$\{cap\.key\}`\)/.test(src), "daily caps: plain sha256 for a personal scope");
});

// ─── ④ 48시간 청소 ─────────────────────────────────────────────────────────────

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

/** Rows the new code writes carry the "v1:" marker; pass a bare hash to model a legacy (pre-#566) row. */
const insWs = (db, hash, win) =>
  db.prepare("INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at) VALUES (?, ?, 1, 't', 't')").run(hash, win);
const insDemo = (db, hash, day) =>
  db.prepare("INSERT INTO demo_rate_limit (ip_hash, day_utc, count, first_at, last_at) VALUES (?, ?, 1, 't', 't')").run(hash, day);
const left = (db, table, col) => db.prepare(`SELECT ${col} AS w FROM ${table} ORDER BY ${col}`).all().map((r) => r.w);

test("④ 실제 SQLite(0011·0026): 시작한 지 48시간 지난 시간 창·일 창은 지우고, 최근 창·모르는 형식은 남긴다", async (t) => {
  const { purgeExpiredRateLimitRows, RATE_LIMIT_RETENTION_HOURS } = await loadRetentionModule();
  assert.equal(RATE_LIMIT_RETENTION_HOURS, 48);
  const db = await sqliteWithRateTables(t);
  if (!db) return;
  // now = 2026-09-29T15:30Z → cutoff = 2026-09-27T15:30Z
  for (const w of [
    "2026-06-11T15", // very old hour (0026 era)
    "2026-09-27T15", // hour started 48.5h ago → delete
    "2026-09-27T16", // hour started 47.5h ago → keep
    "2026-09-29T15", // the current hour → keep
    "2026-07-03", //    very old day
    "2026-09-27", //    day started 63.5h ago (ended 39.5h ago) → delete
    "2026-09-28", //    yesterday → keep
    "2026-09-29", //    today (active daily caps) → keep
    "2026-W39", //      a format this code never writes → leave alone
  ]) {
    insWs(db, `${V1}h_${w}`, w);
  }
  for (const d of ["2026-01-01", "2026-09-27", "2026-09-28", "2026-09-29"]) insDemo(db, `${V1}d_${d}`, d);

  const r = await purgeExpiredRateLimitRows({ DB: d1FromSqlite(db) }, NOW);
  assert.deepEqual(left(db, "workspace_rate_limit", "hour_utc"), ["2026-09-27T16", "2026-09-28", "2026-09-29", "2026-09-29T15", "2026-W39"]);
  assert.deepEqual(left(db, "demo_rate_limit", "day_utc"), ["2026-09-28", "2026-09-29"]);
  assert.equal(r.workspace.deleted, 4);
  assert.equal(r.demo.deleted, 2);
  assert.equal(r.cutoff, "2026-09-27T15:30:00.000Z");
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("④ 어느 시각에 돌아도 지금 쓰이는 창(이번 시간·오늘)과 48시간 안의 창은 지우지 않는다", async (t) => {
  const { purgeExpiredRateLimitRows } = await loadRetentionModule();
  const db = await sqliteWithRateTables(t);
  if (!db) return;
  const d1 = { DB: d1FromSqlite(db) };
  for (const iso of ["2026-09-29T00:00:00.000Z", "2026-09-29T00:59:59.999Z", "2026-09-29T23:59:59.999Z", "2026-03-01T00:00:00.000Z", "2026-12-31T23:30:00.000Z"]) {
    const now = new Date(iso);
    db.exec("DELETE FROM workspace_rate_limit; DELETE FROM demo_rate_limit;");
    const kept = [];
    for (let h = 0; h < 48; h++) {
      const at = new Date(now.getTime() - h * 3600_000);
      const hour = at.toISOString().slice(0, 13);
      if (!kept.includes(hour)) { insWs(db, `${V1}h`, hour); kept.push(hour); }
    }
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    insWs(db, `${V1}d`, today);
    insWs(db, `${V1}d`, yesterday);
    insDemo(db, `${V1}d`, today);
    insDemo(db, `${V1}d`, yesterday);
    await purgeExpiredRateLimitRows(d1, now);
    const ws = new Set(left(db, "workspace_rate_limit", "hour_utc"));
    // Every hour window that started less than 48h ago (the last 48 hour keys) and both day windows.
    for (const w of [...kept, today, yesterday]) assert.ok(ws.has(w), `${iso}: ${w} must survive`);
    assert.deepEqual(new Set(left(db, "demo_rate_limit", "day_utc")), new Set([today, yesterday]), iso);
  }
});

test("④ 오래 쌓인 행(12,345개)도 한 번에 다 지운다 — 나눠 지우는 반복이 끝까지 돈다", async (t) => {
  const { purgeExpiredRateLimitRows } = await loadRetentionModule();
  const db = await sqliteWithRateTables(t);
  if (!db) return;
  const ins = db.prepare("INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at) VALUES (?, ?, 1, 't', 't')");
  db.exec("BEGIN");
  for (let i = 0; i < 12_345; i++) ins.run(`${V1}old_${i}`, "2026-07-01T10");
  db.exec("COMMIT");
  insWs(db, `${V1}fresh`, "2026-09-29T15");
  const r = await purgeExpiredRateLimitRows({ DB: d1FromSqlite(db) }, NOW);
  assert.equal(r.workspace.deleted, 12_345);
  assert.ok(r.workspace.batches >= 2, `batched (${r.workspace.batches})`);
  assert.equal(r.workspace.more, false);
  assert.deepEqual(left(db, "workspace_rate_limit", "hour_utc"), ["2026-09-29T15"]);
});

// node:sqlite가 없는 Node(CI 매트릭스의 20)에서도 도는 판: 가짜 D1로 SQL 문자열과 바인드를 본다.
test("④ (가짜 D1 · 모든 Node) 청소 SQL은 두 형식을 각자의 기준으로 비교하고, 바인드는 now−48h의 시간 키·일 키", async () => {
  const { purgeExpiredRateLimitRows, WORKSPACE_RATE_LIMIT_PURGE_SQL, DEMO_RATE_LIMIT_PURGE_SQL } = await loadRetentionModule();
  const seen = [];
  const db = {
    prepare(sql) {
      return {
        bind: (...args) => ({
          async run() {
            seen.push({ sql, args });
            return { meta: { changes: 0 } };
          },
        }),
      };
    },
  };
  const r = await purgeExpiredRateLimitRows({ DB: db }, NOW); // now 2026-09-29T15:30Z → cutoff 2026-09-27T15:30Z
  assert.equal(r.cutoff, "2026-09-27T15:30:00.000Z");
  const ws = seen.find((s) => s.sql === WORKSPACE_RATE_LIMIT_PURGE_SQL);
  const demo = seen.find((s) => s.sql === DEMO_RATE_LIMIT_PURGE_SQL);
  assert.ok(ws && demo, "both tables are purged");
  assert.equal(ws.sql, WORKSPACE_RATE_LIMIT_PURGE_SQL);
  assert.equal(demo.sql, DEMO_RATE_LIMIT_PURGE_SQL);
  // 시간 창("YYYY-MM-DDTHH", 13자)과 일 창("YYYY-MM-DD", 10자)을 길이로 가르고 각자 ≤ 비교 — 모르는 형식은 안 건드린다.
  const where = (sql) => sql.replace(/\s+/g, " ");
  assert.match(where(ws.sql), /\(length\(hour_utc\) = 13 AND hour_utc <= \?\) OR \(length\(hour_utc\) = 10 AND hour_utc <= \?\)/);
  assert.match(where(demo.sql), /length\(day_utc\) = 10 AND day_utc <= \?/);
  assert.match(where(ws.sql), /LIMIT \?/, "batched");
  assert.deepEqual(ws.args.slice(0, 2), ["2026-09-27T15", "2026-09-27"]);
  assert.deepEqual(demo.args.slice(0, 1), ["2026-09-27"]);
  assert.ok(Number.isInteger(ws.args[2]) && ws.args[2] > 0, "batch size bind");
  assert.deepEqual(
    [r.workspace.more, r.demo.more, r.workspace.error, r.demo.error],
    [false, false, undefined, undefined],
    "an empty batch ends the loop",
  );
});

test("④ fail-open: 한 테이블 청소가 실패해도 던지지 않고 다른 테이블은 청소한다", async () => {
  const { purgeExpiredRateLimitRows } = await loadRetentionModule();
  const seen = [];
  const db = {
    prepare(sql) {
      seen.push(sql);
      if (sql.includes("workspace_rate_limit")) throw new Error("D1_ERROR: no such table: workspace_rate_limit");
      return { bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) };
    },
  };
  const r = await purgeExpiredRateLimitRows({ DB: db }, NOW);
  assert.match(r.workspace.error, /no such table/);
  assert.equal(r.demo.error, undefined);
  assert.ok(seen.some((s) => s.includes("demo_rate_limit")), "demo purge still ran");
});

test("④ 배선: 6시간 크론(0 */6 * * *)이 청소를 부르고, 실패는 잡아 한 줄 JSON으로 남긴다", () => {
  const indexTs = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
  const start = indexTs.indexOf('if (event.cron === "0 */6 * * *")');
  assert.ok(start >= 0, "6-hourly branch");
  const branch = indexTs.slice(start, indexTs.indexOf("return;", start));
  assert.match(branch, /purgeExpiredRateLimitRows\(env\)/);
  assert.match(branch, /cron: "rate-limit-purge"/);
  assert.match(branch, /JSON\.stringify\(/);
  assert.match(branch, /catch \(err\)/);
  const wrangler = readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  assert.match(wrangler, /crons = \[[^\]]*"0 \*\/6 \* \* \*"/, "the cron is actually scheduled");
});

// ─── ⑤ 레거시 행 — 배포 뒤 첫 청소가 옛 형식 행을 창과 상관없이 모두 지운다 (PR #566 리뷰 P1) ───────────

test("⑤ 실제 SQLite: 배포 직전 48시간 안에 옛 코드가 쓴 행(\"v1:\" 표시 없음)도 첫 청소에서 모두 지운다 — 같은 창의 새 형식 행은 남는다", async (t) => {
  const { purgeExpiredRateLimitRows } = await loadRetentionModule();
  const db = await sqliteWithRateTables(t);
  if (!db) return;
  // 리뷰가 재현한 시각: now = 2026-09-29T00:30Z → 창 규칙의 기준 = 2026-09-27T00:30Z.
  // 옛 코드가 배포 직전에 쓴 행은 창이 모두 그 뒤라, 창 규칙만으로는 하나도 지워지지 않는다(최대 약 54시간 생존).
  const now = new Date("2026-09-29T00:30:00.000Z");
  const legacyHourIp = sha256(`workspace::${IP_A}`); //           옛 시간 창 IP 해시 (IPv4 전수 대입으로 역산됨)
  const legacyNet = sha256(`inspection-daily-ip::${IP_A}`); //    옛 네트워크 일일 창
  const legacyUser = sha256("inspection-daily::uk_mg4h7t2kq8z3x"); // 옛 사용자 일일 창 (평문 user_key로 계산됨)
  const legacyService = sha256("inspection-daily-global::all"); // 옛 서비스 창 (새 코드는 "v1:" 키로 새로 센다)
  insWs(db, legacyHourIp, "2026-09-27T01");
  insWs(db, legacyHourIp, "2026-09-28T23");
  insWs(db, legacyNet, "2026-09-28");
  insWs(db, legacyUser, "2026-09-28");
  insWs(db, legacyService, "2026-09-28");
  const many = db.prepare("INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at) VALUES (?, ?, 1, 't', 't')");
  db.exec("BEGIN");
  for (let i = 0; i < 6_000; i++) many.run(sha256(`workspace-check::198.51.100.${i % 250}::${i}`), "2026-09-28T22");
  db.exec("COMMIT");
  insDemo(db, sha256(`conclave-demo::${IP_A}`), "2026-09-28");
  insDemo(db, sha256(`rotation-2026-09::${IP_B}`), "2026-09-29");

  // 새 코드가 같은 창에 쓴 행 — 지금 쓰이는 카운터라 남아야 한다.
  const freshIp = keyed(KEK, "workspace", IP_A);
  const freshUser = userKeyed(KEK, "inspection-daily", "uk_mg4h7t2kq8z3x");
  const freshDemo = keyed(KEK, "demo", IP_A);
  insWs(db, freshIp, "2026-09-29T00");
  insWs(db, freshUser, "2026-09-29");
  insDemo(db, freshDemo, "2026-09-29");

  const r = await purgeExpiredRateLimitRows({ DB: d1FromSqlite(db) }, now);
  const wsKeys = db.prepare("SELECT ip_hash AS h FROM workspace_rate_limit ORDER BY ip_hash").all().map((x) => x.h);
  const demoKeys = db.prepare("SELECT ip_hash AS h FROM demo_rate_limit ORDER BY ip_hash").all().map((x) => x.h);
  assert.deepEqual(wsKeys, [freshIp, freshUser].sort(), "every unmarked (legacy) row is gone, whatever its window");
  assert.deepEqual(demoKeys, [freshDemo]);
  assert.equal(r.legacy.workspace.deleted, 5 + 6_000);
  assert.ok(r.legacy.workspace.batches >= 2, "batched past the 5,000 limit");
  assert.equal(r.legacy.workspace.more, false);
  assert.equal(r.legacy.demo.deleted, 2);
  assert.equal(r.workspace.deleted, 0, "the fresh rows are inside their windows");
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("⑤ (가짜 D1 · 모든 Node) 레거시 청소 SQL: 키가 \"v1:\"로 시작하지 않는 행 — substr 비교(대소문자 구분), 두 테이블, 배치", async () => {
  const mod = await loadRetentionModule();
  assert.equal(typeof mod.WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL, "string", "legacy purge SQL export");
  assert.equal(typeof mod.DEMO_RATE_LIMIT_LEGACY_PURGE_SQL, "string");
  const seen = [];
  const db = {
    prepare(sql) {
      return { bind: (...args) => ({ async run() { seen.push({ sql, args }); return { meta: { changes: 0 } }; } }) };
    },
  };
  const r = await mod.purgeExpiredRateLimitRows({ DB: db }, NOW);
  const where = (sql) => sql.replace(/\s+/g, " ");
  const ws = seen.find((s) => s.sql === mod.WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL);
  const demo = seen.find((s) => s.sql === mod.DEMO_RATE_LIMIT_LEGACY_PURGE_SQL);
  assert.ok(ws && demo, "both tables get the legacy pass");
  assert.match(where(ws.sql), /DELETE FROM workspace_rate_limit WHERE rowid IN \( SELECT rowid FROM workspace_rate_limit WHERE substr\(ip_hash, 1, \?\) <> \? LIMIT \?\)/);
  assert.match(where(demo.sql), /DELETE FROM demo_rate_limit WHERE rowid IN \( SELECT rowid FROM demo_rate_limit WHERE substr\(ip_hash, 1, \?\) <> \? LIMIT \?\)/);
  assert.deepEqual(ws.args.slice(0, 2), [3, V1]);
  assert.deepEqual(demo.args.slice(0, 2), [3, V1]);
  assert.ok(Number.isInteger(ws.args[2]) && ws.args[2] > 0);
  assert.deepEqual(r.legacy, {
    workspace: { deleted: 0, batches: 1, more: false },
    demo: { deleted: 0, batches: 1, more: false },
  });
});

test("⑤ fail-open: 레거시 청소가 실패해도 던지지 않고, 창 청소는 따로 돈다", async () => {
  const { purgeExpiredRateLimitRows, WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL } = await loadRetentionModule();
  assert.equal(typeof WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL, "string");
  const ran = [];
  const db = {
    prepare(sql) {
      if (sql === WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL) throw new Error("D1_ERROR: too many SQL variables");
      return { bind: () => ({ run: async () => { ran.push(sql); return { meta: { changes: 0 } }; } }) };
    },
  };
  const r = await purgeExpiredRateLimitRows({ DB: db }, NOW);
  assert.match(r.legacy.workspace.error, /too many SQL variables/);
  assert.equal(r.workspace.error, undefined);
  assert.ok(ran.some((s) => s.includes("length(hour_utc) = 13")), "the window purge still ran");
});

test("⑤ 새 코드가 쓰는 키는 전부 \"v1:\"로 시작한다 — IP·사용자·서비스·KEK 없음 폴백 (청소가 새 행을 레거시로 오인하지 않게)", async () => {
  const { ipRateLimitKey } = await loadKeyModule();
  const withKek = { CONCLAVE_TOKEN_KEK: KEK };
  const values = [
    await ipRateLimitKey(withKek, "workspace", IP_A),
    await ipRateLimitKey({}, "workspace", IP_A),
  ];
  for (const env of [withKek, {}]) {
    const db = slotDb();
    await consumeDailyCaps({ DB: db, ...env }, dailyCapsFor("repair", {}, "uk_mg4h7t2kq8z3x", clientNetworkKey(reqFrom(IP_B))), NOW);
    assert.equal(db.consumes.length, 3);
    values.push(...db.consumes);
  }
  for (const v of values) assert.ok(v.startsWith(V1), `unmarked key would be purged as legacy every tick: ${v}`);
});

// ─── ⑥ 사용자 키 버킷도 비밀 키 HMAC (PR #566 리뷰 P2) ─────────────────────────────────────────────

const REAL_USER = "uk_mg4h7t2kq8z3x"; // dashboard getUserKey 모양: uk_ + Date.now() 36진 + Math.random 5자

test("⑥ 사용자 시간·일 한도(consumeUserHourlyLimit·consumeUserDailyLimit) = HMAC(사용자 하위 키, bucket::userKey) — 평문 user_key로 계산되는 sha256 아님", async () => {
  const { consumeUserHourlyLimit, consumeUserDailyLimit } = await import("../dist/workspace/rate-limit.js");
  for (const userKey of [REAL_USER, "uk_사용자_1"]) {
    const db = captureDb({ count: 0 });
    const env = { DB: db, CONCLAVE_TOKEN_KEK: KEK };
    assert.equal((await consumeUserHourlyLimit(env, "workspace-pr-review", userKey, 30)).limited, false);
    assert.equal((await consumeUserDailyLimit(env, "beta-review-daily", userKey, 100)).limited, false);
    const binds = new Set(db.rate.map((x) => x.args[0]));
    assert.deepEqual(binds, new Set([userKeyed(KEK, "workspace-pr-review", userKey), userKeyed(KEK, "beta-review-daily", userKey)]));
    for (const b of binds) {
      assert.ok(!String(b).includes(userKey));
      assert.notEqual(b, sha256(`workspace-pr-review::${userKey}`));
      assert.notEqual(b, sha256(`beta-review-daily::${userKey}`));
    }
  }
});

test("⑥ userRateLimitKey: 같은 KEK·버킷·사용자 → 같은 값, KEK가 바뀌면 다른 값, IP 하위 키와 분리", async () => {
  const mod = await loadKeyModule();
  assert.equal(typeof mod.userRateLimitKey, "function", "userRateLimitKey export");
  const a = await mod.userRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "inspection-daily", REAL_USER);
  assert.equal(a, userKeyed(KEK, "inspection-daily", REAL_USER));
  assert.equal(await mod.userRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "inspection-daily", REAL_USER), a);
  assert.notEqual(await mod.userRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK_ROTATED }, "inspection-daily", REAL_USER), a);
  assert.notEqual(await mod.ipRateLimitKey({ CONCLAVE_TOKEN_KEK: KEK }, "inspection-daily", REAL_USER), a);
});

test("⑥ KEK 없음 → 사용자 버킷은 격리 수명의 임시 무작위 키: 같은 사용자는 같은 행(사용자별 한도 유지), 다른 사용자는 다른 행, 평문 user_key로 다시 계산할 수 없다", async () => {
  const mod = await loadKeyModule();
  assert.equal(typeof mod.userRateLimitKey, "function", "userRateLimitKey export");
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    const a1 = await mod.userRateLimitKey({}, "beta-project-create-daily", REAL_USER);
    const a2 = await mod.userRateLimitKey({ CONCLAVE_TOKEN_KEK: "" }, "beta-project-create-daily", REAL_USER);
    const b = await mod.userRateLimitKey({}, "beta-project-create-daily", "uk_사용자_2");
    assert.equal(a1, a2, "same user, same row within the isolate");
    assert.notEqual(a1, b, "users keep separate counters");
    assert.match(a1, /^v1:[0-9a-f]{64}$/);
    assert.ok(!a1.includes(REAL_USER));
    assert.notEqual(a1, sha256(`beta-project-create-daily::${REAL_USER}`));
    assert.notEqual(a1, V1 + sha256(`beta-project-create-daily::${REAL_USER}`));
    assert.notEqual(a1, V1 + sha256("beta-project-create-daily::no-key"), "not the IP fallback — per-user caps survive");
  } finally {
    console.warn = warn;
  }
  for (const line of warned) {
    assert.doesNotThrow(() => JSON.parse(line), "one-line JSON");
    assert.ok(!line.includes(REAL_USER) && !line.includes("uk_사용자_2"), "the warning never carries the user key");
  }
});

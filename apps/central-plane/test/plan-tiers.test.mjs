/**
 * plan-tiers.test.mjs — D-24 플랜 티어 (docs/simsa-plan-tiers-design-2026-10-03.md, 2026-10-03 design lock approved).
 *
 * 고정하는 계약:
 *   D-24.1 플랜→한도는 entitlements 단일 표. 자격 조회 실패 = 무료. 레거시 paid = 프로.
 *   D-24.2 새 프로젝트: 무료·베이직 하루 1개 · 계정+익명 키+네트워크 병행 · 재저장 미집계 ·
 *          지워도 안 돌려줌 · 저장 실패는 돌려줌 · 프로 10 · 장비(staff) 상한 밖
 *   D-24.3 막히기 전에 남은 개수를 읽을 수 있다(소비 없음) · 거절 본문에 kind·resetAt
 *   0074   plan_grants CHECK가 basic·pro·staff를 받고 기존 paid 행을 보존한다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { createApp } = await import("../dist/router.js");
const { ENTITLEMENTS, entitlementsFor, tierFromGrantPlan, isGrantablePlan } = await import("../dist/workspace/entitlements.js");
const { resolveTier, resolvePlan } = await import("../dist/plan.js");
const { buildProjectCreateCaps } = await import("../dist/workspace/project-quota.js");
const { dailyCapsRun } = await import("./_daily-caps-fake.mjs");

// 실제처럼 KEK가 있어야 네트워크마다 다른 버킷이 된다(없으면 의도적으로 하나의 공용 카운터).
const KEK = randomBytes(32).toString("base64");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── fake D1 ──────────────────────────────────────────────────────────────────

/**
 * grants: userKey → plan · claims: userKey → auth user id (workspaces.legacy_user_key)
 * failProjectInsertOnce: 다음 프로젝트 INSERT 한 번을 던진다(저장 실패 → 환불 확인용).
 */
function makeEnv({ grants = {}, claims = {}, overrides = {} } = {}) {
  const state = { projects: new Map(), rate: new Map(), failProjectInsertOnce: false };
  const DB = {
    state,
    prepare(sql) {
      let bound = [];
      const stmt = {
        bind(...args) { bound = args; return stmt; },
        async first() {
          if (/FROM workspace_projects/.test(sql)) {
            const p = state.projects.get(bound[0]);
            return p ?? null;
          }
          if (/FROM workspace_rate_limit/.test(sql)) {
            const [hash, day] = bound;
            const count = state.rate.get(`${hash}::${day}`);
            return count === undefined ? null : { count };
          }
          if (/FROM plan_grants/.test(sql)) {
            const plan = grants[bound[0]];
            return plan ? { plan } : null;
          }
          if (/FROM ls_subscriptions/.test(sql)) return null;
          if (/FROM workspaces WHERE legacy_user_key/.test(sql)) {
            const creator = claims[bound[0]];
            return creator ? { creator } : null;
          }
          return null;
        },
        async run() {
          const capped = dailyCapsRun(state.rate, sql, bound);
          if (capped) return capped;
          if (/INSERT INTO workspace_projects/.test(sql)) {
            if (state.failProjectInsertOnce) {
              state.failProjectInsertOnce = false;
              throw new Error("D1 down");
            }
            const [id, user_key, title] = bound;
            const existing = state.projects.get(id);
            if (existing && existing.user_key !== user_key) return { meta: { changes: 0 } };
            state.projects.set(id, {
              id, user_key, title, idea: "", understood_json: null, product_spec_json: "{}", items_json: "[]",
              created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z",
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return { DB, ENVIRONMENT: "test", CONCLAVE_TOKEN_KEK: KEK, ...overrides };
}

function createReq(body, ip = "203.0.113.7") {
  return new Request("http://localhost/workspace/projects", {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
    body: JSON.stringify(body),
  });
}

const app = createApp();
// Rule 6 — 값이 키·경로로 흘러가는 이름은 한글·특수문자로.
const create = (env, userKey, ip, extra = {}) =>
  app.fetch(createReq({ userKey, title: "(주)트루픽셀 사내 예약앱", ...extra }, ip), env);

// ─── D-24.1 표 ────────────────────────────────────────────────────────────────

describe("D-24.1 단일 표", () => {
  it("무료·베이직 새 프로젝트 하루 1개, 프로 10 — Bae 지시값", () => {
    assert.equal(ENTITLEMENTS.free.projectCreatesPerDay, 1);
    assert.equal(ENTITLEMENTS.basic.projectCreatesPerDay, 1);
    assert.equal(ENTITLEMENTS.pro.projectCreatesPerDay, 10);
  });

  it("익명 네트워크 몫 1 < 로그인 네트워크 몫 3, 프로·장비는 네트워크 상한 없음", () => {
    assert.equal(ENTITLEMENTS.free.projectCreatesPerDayPerNetworkAnonymous, 1);
    assert.equal(ENTITLEMENTS.free.projectCreatesPerDayPerNetworkAccount, 3);
    assert.equal(ENTITLEMENTS.pro.projectCreatesPerDayPerNetworkAccount, null);
    assert.equal(ENTITLEMENTS.staff.projectCreatesPerDayPerNetworkAnonymous, null);
  });

  it("협의체는 프로·장비만 — 베이직은 아님", () => {
    assert.equal(entitlementsFor("free").councilReview, false);
    assert.equal(entitlementsFor("basic").councilReview, false);
    assert.equal(entitlementsFor("pro").councilReview, true);
  });

  it("그랜트 값 해석: 레거시 paid=프로, 모르는 값=무료(올려주지 않는다)", () => {
    assert.equal(tierFromGrantPlan("paid"), "pro");
    assert.equal(tierFromGrantPlan("basic"), "basic");
    assert.equal(tierFromGrantPlan("staff"), "staff");
    assert.equal(tierFromGrantPlan("enterprise"), "free");
    assert.equal(tierFromGrantPlan(null), "free");
    assert.equal(isGrantablePlan("free"), false);
    assert.equal(isGrantablePlan("pro"), true);
  });

  it("resolveTier/resolvePlan — 베이직은 paid 기능(협의체)이 없으므로 plan=free", async () => {
    const env = makeEnv({ grants: { uk_b: "basic", uk_p: "paid", uk_s: "staff" } });
    assert.equal(await resolveTier(env, "uk_b"), "basic");
    assert.equal(await resolveTier(env, "uk_p"), "pro");
    assert.equal(await resolveTier(env, "uk_s"), "staff");
    assert.equal(await resolveTier(env, "uk_none"), "free");
    assert.equal(await resolvePlan(env, "uk_b"), "free");
    assert.equal(await resolvePlan(env, "uk_p"), "paid");
  });

  it("자격 조회가 던지면 무료(fail-safe)", async () => {
    const env = { DB: { prepare() { throw new Error("no such table"); } } };
    assert.equal(await resolveTier(env, "uk_x"), "free");
  });
});

// ─── D-24.2 집계 키 ───────────────────────────────────────────────────────────

describe("D-24.2 병행 집계 (순수 함수)", () => {
  it("익명: 익명 키 1 + 익명 네트워크 1", () => {
    const caps = buildProjectCreateCaps({ tier: "free", accountId: null, userKey: "uk_a", networkKey: "198.51.100.1" });
    assert.deepEqual(caps.map((c) => [c.scope, c.bucket, c.limit]), [
      ["user", "project-create-daily-user", 1],
      ["network", "project-create-daily-net-anon", 1],
    ]);
  });

  it("로그인: 계정 1 + 익명 키 1(로그인 전에 만든 것 포함) + 로그인 네트워크 3", () => {
    const caps = buildProjectCreateCaps({ tier: "basic", accountId: "auth_1", userKey: "uk_a", networkKey: "198.51.100.1" });
    assert.deepEqual(caps.map((c) => [c.scope, c.bucket, c.key, c.limit]), [
      ["user", "project-create-daily-acct", "acct:auth_1", 1],
      ["user", "project-create-daily-user", "uk_a", 1],
      ["network", "project-create-daily-net-acct", "198.51.100.1", 3],
    ]);
  });

  it("프로: 네트워크 상한 없음 · 네트워크 키가 없으면 네트워크 버킷도 없음", () => {
    const pro = buildProjectCreateCaps({ tier: "pro", accountId: null, userKey: "uk_a", networkKey: "198.51.100.1" });
    assert.deepEqual(pro.map((c) => c.scope), ["user"]);
    const noIp = buildProjectCreateCaps({ tier: "free", accountId: null, userKey: "uk_a", networkKey: null });
    assert.deepEqual(noIp.map((c) => c.scope), ["user"]);
  });
});

// ─── D-24.2 라우트 ────────────────────────────────────────────────────────────

describe("D-24.2 POST /workspace/projects — 무료 하루 1개", () => {
  it("두 번째 새 프로젝트는 429 project_daily(kind·tier·limit·resetAt)", async () => {
    const env = makeEnv();
    assert.equal((await create(env, "uk_한글사용자", "203.0.113.7")).status, 200);
    const r = await create(env, "uk_한글사용자", "203.0.113.7");
    assert.equal(r.status, 429);
    const body = await r.json();
    assert.equal(body.error, "rate_limited");
    assert.equal(body.scope, "project_daily");
    assert.equal(body.kind, "project_create");
    assert.equal(body.tier, "free");
    assert.equal(body.limit, 1);
    assert.match(body.resetAt, /T00:00:00\.000Z$/);
    assert.ok(r.headers.get("retry-after"));
    assert.match(body.message, /하루 1개/);
  });

  it("익명 키를 새로 받아도 같은 네트워크면 막힌다(limitedBy network)", async () => {
    const env = makeEnv();
    assert.equal((await create(env, "uk_first", "203.0.113.7")).status, 200);
    const r = await create(env, "uk_fresh_key", "203.0.113.7");
    assert.equal(r.status, 429);
    assert.equal((await r.json()).limitedBy, "network");
    // 다른 네트워크의 다른 사람은 영향 없음
    assert.equal((await create(env, "uk_other", "198.51.100.9")).status, 200);
  });

  it("IPv6는 /64로 묶는다 — 같은 /64 안에서 주소만 바꿔도 같은 네트워크", async () => {
    const env = makeEnv();
    assert.equal((await create(env, "uk_v6a", "2001:db8:1:2::10")).status, 200);
    assert.equal((await create(env, "uk_v6b", "2001:db8:1:2::ffff")).status, 429);
  });

  it("재저장(자동 저장)은 세지 않는다", async () => {
    const env = makeEnv();
    const r1 = await create(env, "uk_resave", "203.0.113.7");
    const { id } = await r1.json();
    for (let i = 0; i < 3; i++) {
      assert.equal((await create(env, "uk_resave", "203.0.113.7", { id })).status, 200);
    }
  });

  it("지워도 돌려주지 않는다(행이 사라져도 오늘 몫은 그대로)", async () => {
    const env = makeEnv();
    const { id } = await (await create(env, "uk_del", "203.0.113.7")).json();
    env.DB.state.projects.delete(id);
    assert.equal((await create(env, "uk_del", "203.0.113.7")).status, 429);
  });

  it("저장이 실패하면 돌려준다 — 우리 실패는 사용자의 시도가 아니다", async () => {
    const env = makeEnv();
    env.DB.state.failProjectInsertOnce = true;
    assert.equal((await create(env, "uk_fail", "203.0.113.7")).status, 500);
    assert.equal((await create(env, "uk_fail", "203.0.113.7")).status, 200);
  });

  it("로그인 계정 기준: 같은 계정의 다른 브라우저(다른 키)·다른 네트워크도 막힌다", async () => {
    const env = makeEnv({ claims: { uk_laptop: "auth_bae", uk_phone: "auth_bae" } });
    assert.equal((await create(env, "uk_laptop", "203.0.113.7")).status, 200);
    const r = await create(env, "uk_phone", "198.51.100.20");
    assert.equal(r.status, 429);
    assert.equal((await r.json()).limitedBy, "user");
  });

  it("로그인 사용자는 공용 네트워크에서 서로 막지 않는다(로그인 네트워크 몫 3)", async () => {
    const env = makeEnv({ claims: { uk_c1: "auth_1", uk_c2: "auth_2", uk_c3: "auth_3", uk_c4: "auth_4" } });
    for (const k of ["uk_c1", "uk_c2", "uk_c3"]) {
      assert.equal((await create(env, k, "203.0.113.50")).status, 200, k);
    }
    assert.equal((await create(env, "uk_c4", "203.0.113.50")).status, 429, "네 번째 계정은 네트워크 몫 초과");
  });

  it("프로는 하루 10개, 네트워크 상한 없음", async () => {
    const env = makeEnv({ grants: { uk_pro: "pro" } });
    for (let i = 0; i < 10; i++) assert.equal((await create(env, "uk_pro", "203.0.113.7")).status, 200, `#${i + 1}`);
    const r = await create(env, "uk_pro", "203.0.113.7");
    assert.equal(r.status, 429);
    assert.equal((await r.json()).tier, "pro");
  });

  it("장비(staff) 키는 매 실행 새 프로젝트를 만들어도 막히지 않는다", async () => {
    const env = makeEnv({ grants: { uk_smoke: "staff" } });
    for (let i = 0; i < 15; i++) assert.equal((await create(env, "uk_smoke", "203.0.113.7")).status, 200);
  });

  it("EN 로케일이면 영어 안내", async () => {
    const env = makeEnv();
    await create(env, "uk_en", "203.0.113.7");
    const body = await (await create(env, "uk_en", "203.0.113.7", { locale: "en" })).json();
    assert.match(body.message, /1 new project per day/);
  });

  it("킬스위치 PROJECT_CREATE_TIER_GATE=off → 예전 상한(userKey당 20)", async () => {
    const env = makeEnv({ overrides: { PROJECT_CREATE_TIER_GATE: "off" } });
    assert.equal((await create(env, "uk_off", "203.0.113.7")).status, 200);
    assert.equal((await create(env, "uk_off", "203.0.113.7")).status, 200);
  });
});

// ─── D-24.3 남은 개수 ─────────────────────────────────────────────────────────

describe("D-24.3 GET /workspace/quota — 슬롯을 쓰지 않는 읽기", () => {
  const quota = (env, userKey, ip = "203.0.113.7") =>
    app.fetch(new Request(`http://localhost/workspace/quota?userKey=${encodeURIComponent(userKey)}`, { headers: { "cf-connecting-ip": ip } }), env);

  it("만들기 전 1/1 → 만든 뒤 0/1(limitedBy) · 조회는 몫을 쓰지 않는다", async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) {
      const q = await (await quota(env, "uk_q")).json();
      assert.deepEqual([q.tier, q.projectCreate.limit, q.projectCreate.remaining, q.projectCreate.limitedBy], ["free", 1, 1, null]);
    }
    assert.equal((await create(env, "uk_q", "203.0.113.7")).status, 200);
    const after = await (await quota(env, "uk_q")).json();
    assert.equal(after.projectCreate.remaining, 0);
    assert.equal(after.projectCreate.limitedBy, "user");
    assert.match(after.projectCreate.resetAt, /T00:00:00\.000Z$/);
  });

  it("같은 네트워크의 다른 익명 사용자가 먼저 썼으면 0(limitedBy network)", async () => {
    const env = makeEnv();
    await create(env, "uk_neighbor", "203.0.113.7");
    const q = await (await quota(env, "uk_me")).json();
    assert.equal(q.projectCreate.remaining, 0);
    assert.equal(q.projectCreate.limitedBy, "network");
  });

  it("userKey 없으면 400 · /workspace/plan은 tier를 함께 준다", async () => {
    const env = makeEnv({ grants: { uk_b: "basic" } });
    assert.equal((await app.fetch(new Request("http://localhost/workspace/quota"), env)).status, 400);
    const p = await (await app.fetch(new Request("http://localhost/workspace/plan?userKey=uk_b"), env)).json();
    assert.deepEqual([p.plan, p.tier], ["free", "basic"]);
  });
});

// ─── 0074 마이그레이션 (실제 SQLite) ─────────────────────────────────────────

describe("0074 plan_grants 티어 — 실제 SQLite", async () => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    it.skip("node:sqlite 없음 (Node < 22.5)", () => {});
    return;
  }
  const mig = (f) => readFileSync(path.join(ROOT, "migrations", f), "utf8");

  it("기존 paid 행 보존 + basic·pro·staff 허용 + 모르는 값 거부", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(mig("0060_plan_grants.sql"));
    db.prepare("INSERT INTO plan_grants (user_key, plan, note, created_at) VALUES (?, 'paid', ?, ?)").run("uk_old", "베타 수동 부여", "2026-07-17T00:00:00Z");
    db.exec(mig("0074_plan_grants_tiers.sql"));
    const old = db.prepare("SELECT plan, note FROM plan_grants WHERE user_key = ?").get("uk_old");
    assert.deepEqual({ ...old }, { plan: "paid", note: "베타 수동 부여" });
    for (const plan of ["basic", "pro", "staff"]) {
      db.prepare("INSERT INTO plan_grants (user_key, plan, created_at) VALUES (?, ?, ?)").run(`uk_${plan}`, plan, "2026-10-03T00:00:00Z");
    }
    assert.throws(() => db.prepare("INSERT INTO plan_grants (user_key, plan, created_at) VALUES (?, ?, ?)").run("uk_bad", "free", "x"), /CHECK/);
    // admin 라우트의 upsert(플랜 교체)가 그대로 돈다
    db.prepare(
      `INSERT INTO plan_grants (user_key, plan, note, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(user_key) DO UPDATE SET plan = excluded.plan, revoked_at = NULL, note = excluded.note`,
    ).run("uk_old", "basic", null, "2026-10-03T00:00:00Z");
    assert.equal(db.prepare("SELECT plan FROM plan_grants WHERE user_key = ?").get("uk_old").plan, "basic");
  });
});

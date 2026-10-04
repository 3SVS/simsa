/**
 * account-tier.test.mjs — 계정 단위 티어 (2026-10-04, D-24 후속).
 *
 * 문제: 티어를 브라우저 키(userKey)로만 보면, 같은 계정으로 로그인한 다른 기기·브라우저(다른 userKey)는 무료로 떨어진다.
 * 고정하는 계약:
 *   ① 이 키가 계정에 claim돼 있으면 그 계정이 claim한 **모든 키**의 부여·구독 중 가장 높은 티어
 *   ② claim 없는 익명 키는 종전 그대로(자기 키만)
 *   ③ 조회 실패는 무료 쪽으로만(올려 주지 않는다) · 회수된 부여는 무시
 *   ④ 모든 소비처가 같은 판정: /workspace/plan · /workspace/quota · 새 프로젝트 관문
 * ★①의 두 기기 시나리오는 계정을 보지 않던 옛 코드에서 실패한다(회귀 테스트).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const { resolveTier, tierOfAccount, higherTier } = await import("../dist/workspace/tier-resolve.js");
const { createApp } = await import("../dist/router.js");
const { dailyCapsRun } = await import("./_daily-caps-fake.mjs");

const KEK = randomBytes(32).toString("base64");

/**
 * grants: userKey → plan(회수 안 됨) · revoked: 회수된 userKey 목록 · claims: userKey → 계정 id
 * subs: active 구독이 있는 userKey 목록 · throwJoin: 계정 조인 질의가 던짐
 */
function makeEnv({ grants = {}, revoked = [], claims = {}, subs = [], throwJoin = false } = {}) {
  const rate = new Map();
  const projects = new Map();
  const live = (k) => grants[k] && !revoked.includes(k);
  const DB = {
    prepare(sql) {
      let bound = [];
      const stmt = {
        bind(...a) { bound = a; return stmt; },
        async first() {
          if (/JOIN workspaces/.test(sql) && /ls_subscriptions/.test(sql)) {
            if (throwJoin) throw new Error("join down");
            const acct = bound[0];
            const hit = Object.entries(claims).find(([k, a]) => a === acct && subs.includes(k));
            return hit ? { id: "sub_1" } : null;
          }
          if (/FROM plan_grants WHERE user_key = \?/.test(sql)) return live(bound[0]) ? { plan: grants[bound[0]] } : null;
          if (/FROM ls_subscriptions WHERE user_key = \?/.test(sql)) return subs.includes(bound[0]) ? { id: "sub_1" } : null;
          if (/FROM workspaces WHERE legacy_user_key/.test(sql)) return claims[bound[0]] ? { creator: claims[bound[0]] } : null;
          if (/FROM workspace_rate_limit/.test(sql)) {
            const c = rate.get(`${bound[0]}::${bound[1]}`);
            return c === undefined ? null : { count: c };
          }
          if (/FROM workspace_projects/.test(sql)) return projects.get(bound[0]) ?? null;
          return null;
        },
        async all() {
          if (/JOIN workspaces/.test(sql) && /plan_grants/.test(sql)) {
            if (throwJoin) throw new Error("join down");
            const acct = bound[0];
            return { results: Object.entries(claims).filter(([k, a]) => a === acct && live(k)).map(([k]) => ({ plan: grants[k] })) };
          }
          return { results: [] };
        },
        async run() {
          const capped = dailyCapsRun(rate, sql, bound);
          if (capped) return capped;
          if (/INSERT INTO workspace_projects/.test(sql)) {
            const [id, user_key, title] = bound;
            projects.set(id, { id, user_key, title, idea: "", product_spec_json: "{}", items_json: "[]", created_at: "t", updated_at: "t" });
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { DB, ENVIRONMENT: "test", CONCLAVE_TOKEN_KEK: KEK };
}

// Rule 6 — 값이 키로 흘러가는 이름은 한글로.
const LAPTOP = "uk_배승훈_노트북";
const PHONE = "uk_배승훈_휴대폰";

describe("계정 단위 티어 — resolveTier", () => {
  it("★두 기기: 노트북 키에 프로가 부여됐으면, 같은 계정의 휴대폰 키도 프로", async () => {
    const env = makeEnv({ grants: { [LAPTOP]: "pro" }, claims: { [LAPTOP]: "auth_bae", [PHONE]: "auth_bae" } });
    assert.equal(await resolveTier(env, PHONE), "pro");
    assert.equal(await resolveTier(env, LAPTOP), "pro");
  });

  it("계정이 claim한 키들 중 가장 높은 티어(베이직 + 장비 → 장비)", async () => {
    const env = makeEnv({ grants: { k1: "basic", k2: "staff" }, claims: { k1: "auth_x", k2: "auth_x", k3: "auth_x" } });
    assert.equal(await resolveTier(env, "k3"), "staff");
  });

  it("다른 계정의 부여는 섞이지 않는다", async () => {
    const env = makeEnv({ grants: { other: "pro" }, claims: { other: "auth_other", [PHONE]: "auth_bae" } });
    assert.equal(await resolveTier(env, PHONE), "free");
  });

  it("claim 없는 익명 키는 종전 그대로(자기 키만)", async () => {
    const env = makeEnv({ grants: { "uk_익명": "basic" } });
    assert.equal(await resolveTier(env, "uk_익명"), "basic");
    assert.equal(await resolveTier(env, "uk_다른익명"), "free");
  });

  it("회수된 부여는 계정 합산에도 쓰지 않는다", async () => {
    const env = makeEnv({ grants: { [LAPTOP]: "pro" }, revoked: [LAPTOP], claims: { [LAPTOP]: "auth_bae", [PHONE]: "auth_bae" } });
    assert.equal(await resolveTier(env, PHONE), "free");
  });

  it("계정의 다른 키에 활성 구독 → 프로", async () => {
    const env = makeEnv({ subs: [LAPTOP], claims: { [LAPTOP]: "auth_bae", [PHONE]: "auth_bae" } });
    assert.equal(await resolveTier(env, PHONE), "pro");
  });

  it("계정 조인 질의가 실패하면 자기 키 티어로(올려 주지 않는다)", async () => {
    const env = makeEnv({ grants: { [PHONE]: "basic", [LAPTOP]: "pro" }, claims: { [LAPTOP]: "auth_bae", [PHONE]: "auth_bae" }, throwJoin: true });
    assert.equal(await resolveTier(env, PHONE), "basic");
  });

  it("호출자가 세션으로 안 계정(accountId)을 주면 claim 조회 없이 그 계정으로", async () => {
    const env = makeEnv({ grants: { [LAPTOP]: "pro" }, claims: { [LAPTOP]: "auth_bae" } });
    // 새 브라우저 키 — 아직 claim 전이지만 세션으로 계정을 안다
    assert.equal(await resolveTier(env, "uk_새브라우저", { accountId: "auth_bae" }), "pro");
    assert.equal(await resolveTier(env, "uk_새브라우저", { accountId: null }), "free");
  });

  it("tierOfAccount · higherTier", async () => {
    const env = makeEnv({ grants: { a: "basic" }, claims: { a: "acct" } });
    assert.equal(await tierOfAccount(env, "acct"), "basic");
    assert.equal(await tierOfAccount(env, "nobody"), "free");
    assert.equal(higherTier("pro", "basic"), "pro");
    assert.equal(higherTier("free", "staff"), "staff");
  });
});

describe("계정 단위 티어 — 모든 소비처가 같은 판정", () => {
  const app = createApp();

  it("/workspace/plan · /workspace/quota — 휴대폰 키가 계정의 프로를 받는다", async () => {
    const env = makeEnv({ grants: { [LAPTOP]: "pro" }, claims: { [LAPTOP]: "auth_bae", [PHONE]: "auth_bae" } });
    const plan = await (await app.fetch(new Request(`http://localhost/workspace/plan?userKey=${encodeURIComponent(PHONE)}`), env)).json();
    assert.deepEqual([plan.plan, plan.tier], ["paid", "pro"]);
    const quota = await (await app.fetch(new Request(`http://localhost/workspace/quota?userKey=${encodeURIComponent(PHONE)}`, { headers: { "cf-connecting-ip": "203.0.113.9" } }), env)).json();
    assert.equal(quota.tier, "pro");
    assert.equal(quota.projectCreate.limit, 10);
  });

  it("새 프로젝트 관문 — 휴대폰 키로도 프로 몫(하루 10)으로 만든다", async () => {
    const env = makeEnv({ grants: { [LAPTOP]: "pro" }, claims: { [LAPTOP]: "auth_bae", [PHONE]: "auth_bae" } });
    const create = () =>
      app.fetch(
        new Request("http://localhost/workspace/projects", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
          body: JSON.stringify({ userKey: PHONE, title: "(주)트루픽셀 사내 예약앱" }),
        }),
        env,
      );
    for (let i = 0; i < 3; i++) assert.equal((await create()).status, 200, `#${i + 1}`);
  });
});

/**
 * workspace-marketplace-entitlement.test.mjs
 *
 * GitHub Marketplace subscription → workspace allowance entitlement bridge.
 *
 * Tests:
 *  01. mapPlanToIncludedRuns: known plans (free=0, solo=30, pro=100)
 *  02. mapPlanToIncludedRuns: case-insensitive + whitespace tolerant
 *  03. mapPlanToIncludedRuns: unknown PAID plan → safe default 30
 *  04. mapPlanToIncludedRuns: unknown free-priced plan → 0
 *  05. isSubscriptionEntitled: active → true, cancelled → false
 *  06. isSubscriptionEntitled: pending_cancellation before/after effective date
 *  07. getMarketplaceEntitlement: no GitHub connection → null
 *  08. getMarketplaceEntitlement: connection + active Solo sub → entitlement
 *  09. getMarketplaceEntitlement: connection + active Pro sub → 100 runs
 *  10. getMarketplaceEntitlement: connection + active Free plan → null
 *  11. getMarketplaceEntitlement: cancelled subscription → null
 *  12. getMarketplaceEntitlement: pending_cancellation, future effective date → entitlement
 *  13. getMarketplaceEntitlement: pending_cancellation, past effective date → null
 *  14. getMarketplaceEntitlement: unknown paid plan → safe default 30
 *  15. getMarketplaceEntitlement: non-numeric github_user_id → null
 *  16. getMarketplaceEntitlement: DB throws → null (fail-safe)
 *  17. getAllowanceDryRun: entitlement 30 raises includedRuns 5 → 35
 *  18. getAllowanceDryRun: no entitlement keeps base includedRuns 5
 *  19. getAllowanceDryRun: entitlement keeps coveredByAllowance=true past base 5
 *  20. GET /workspace/credits: includes entitlement + raised includedRuns
 *  21. GET /workspace/credits: no subscription → no entitlement field, includedRuns 5
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  mapPlanToIncludedRuns,
  isSubscriptionEntitled,
  getMarketplaceEntitlement,
  PLAN_INCLUDED_RUNS,
  UNKNOWN_PAID_PLAN_INCLUDED_RUNS,
} = await import("../dist/workspace/marketplace-entitlement.js");
const { getAllowanceDryRun } = await import("../dist/workspace/allowance-usage.js");
const { createApp } = await import("../dist/router.js");

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function connectionRow(githubUserId = "12345") {
  return {
    id: "wgc_1",
    user_key: "gh:user1",
    github_user_id: githubUserId,
    github_login: "user1",
    github_name: null,
    avatar_url: null,
    access_token_enc: "enc",
    scopes: "repo",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function subscriptionRow(overrides = {}) {
  return {
    plan_name: "Solo",
    plan_monthly_price_cents: 900,
    status: "active",
    effective_date: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Fake D1: routes queries by SQL substring.
 * opts: { connection, subscription, usedThisPeriod, throwOnSubscription }
 */
function makeDb(opts = {}) {
  const {
    connection = null,
    subscription = null,
    usedThisPeriod = 0,
    throwOnSubscription = false,
  } = opts;
  return {
    prepare(sql) {
      function handler(_args) {
        return {
          async first() {
            if (sql.includes("FROM workspace_github_connections") && sql.includes("WHERE user_key = ?")) {
              return connection;
            }
            if (sql.includes("FROM gh_marketplace_subscriptions")) {
              if (throwOnSubscription) throw new Error("D1 boom");
              return subscription;
            }
            if (sql.includes("SELECT COUNT(*)") && sql.includes("FROM workspace_usage_events")) {
              return { count: usedThisPeriod };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
      }
      return {
        bind(...args) { return handler(args); },
        first() { return handler([]).first(); },
        all() { return handler([]).all(); },
        run() { return handler([]).run(); },
      };
    },
  };
}

function makeEnv(opts = {}) {
  return { ENVIRONMENT: "test", DB: makeDb(opts) };
}

// ─── Tests: plan mapping (pure) ───────────────────────────────────────────────

describe("mapPlanToIncludedRuns", () => {
  it("01 — known plans: free=0, solo=30, pro=100", () => {
    assert.equal(mapPlanToIncludedRuns("free", 0), 0);
    assert.equal(mapPlanToIncludedRuns("solo", 900), 30);
    assert.equal(mapPlanToIncludedRuns("pro", 2900), 100);
    assert.equal(PLAN_INCLUDED_RUNS.solo, 30);
    assert.equal(PLAN_INCLUDED_RUNS.pro, 100);
  });

  it("02 — case-insensitive and whitespace tolerant", () => {
    assert.equal(mapPlanToIncludedRuns("Solo", 900), 30);
    assert.equal(mapPlanToIncludedRuns("PRO", 2900), 100);
    assert.equal(mapPlanToIncludedRuns("  Free ", 0), 0);
  });

  it("03 — unknown PAID plan falls back to safe default (never zeroes a paying user)", () => {
    assert.equal(mapPlanToIncludedRuns("Enterprise Max", 9900), UNKNOWN_PAID_PLAN_INCLUDED_RUNS);
    assert.equal(UNKNOWN_PAID_PLAN_INCLUDED_RUNS, 30);
  });

  it("04 — unknown free-priced plan maps to 0", () => {
    assert.equal(mapPlanToIncludedRuns("Community", 0), 0);
  });
});

// ─── Tests: subscription status (pure) ────────────────────────────────────────

describe("isSubscriptionEntitled", () => {
  it("05 — active → true, cancelled → false", () => {
    assert.equal(isSubscriptionEntitled("active", "2026-06-01T00:00:00.000Z"), true);
    assert.equal(isSubscriptionEntitled("cancelled", "2026-06-01T00:00:00.000Z"), false);
  });

  it("06 — pending_cancellation entitled until effective date", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    assert.equal(isSubscriptionEntitled("pending_cancellation", "2026-08-01T00:00:00.000Z", now), true);
    assert.equal(isSubscriptionEntitled("pending_cancellation", "2026-06-01T00:00:00.000Z", now), false);
  });
});

// ─── Tests: getMarketplaceEntitlement (fake DB) ───────────────────────────────

describe("getMarketplaceEntitlement", () => {
  it("07 — no GitHub connection → null", async () => {
    const env = makeEnv({ connection: null });
    assert.equal(await getMarketplaceEntitlement(env, "gh:user1"), null);
  });

  it("08 — connection + active Solo sub → entitlement contract", async () => {
    const env = makeEnv({ connection: connectionRow(), subscription: subscriptionRow() });
    const ent = await getMarketplaceEntitlement(env, "gh:user1");
    assert.deepEqual(ent, {
      planName: "Solo",
      includedRunsPerMonth: 30,
      source: "github_marketplace",
    });
  });

  it("09 — active Pro sub → 100 runs", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow({ plan_name: "Pro", plan_monthly_price_cents: 2900 }),
    });
    const ent = await getMarketplaceEntitlement(env, "gh:user1");
    assert.equal(ent.includedRunsPerMonth, 100);
    assert.equal(ent.planName, "Pro");
  });

  it("10 — active Free plan → null (no entitlement)", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow({ plan_name: "Free", plan_monthly_price_cents: 0 }),
    });
    assert.equal(await getMarketplaceEntitlement(env, "gh:user1"), null);
  });

  it("11 — cancelled subscription → null", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow({ status: "cancelled" }),
    });
    assert.equal(await getMarketplaceEntitlement(env, "gh:user1"), null);
  });

  it("12 — pending_cancellation with future effective date → still entitled", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow({
        status: "pending_cancellation",
        effective_date: "2099-01-01T00:00:00.000Z",
      }),
    });
    const ent = await getMarketplaceEntitlement(env, "gh:user1", new Date("2026-07-01T00:00:00.000Z"));
    assert.ok(ent);
    assert.equal(ent.includedRunsPerMonth, 30);
  });

  it("13 — pending_cancellation past effective date → null", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow({
        status: "pending_cancellation",
        effective_date: "2026-06-01T00:00:00.000Z",
      }),
    });
    assert.equal(
      await getMarketplaceEntitlement(env, "gh:user1", new Date("2026-07-01T00:00:00.000Z")),
      null,
    );
  });

  it("14 — unknown paid plan → safe default 30", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow({ plan_name: "Team Unlimited", plan_monthly_price_cents: 4900 }),
    });
    const ent = await getMarketplaceEntitlement(env, "gh:user1");
    assert.equal(ent.includedRunsPerMonth, 30);
    assert.equal(ent.planName, "Team Unlimited");
  });

  it("15 — non-numeric github_user_id → null", async () => {
    const env = makeEnv({
      connection: connectionRow("not-a-number"),
      subscription: subscriptionRow(),
    });
    assert.equal(await getMarketplaceEntitlement(env, "gh:user1"), null);
  });

  it("16 — DB throws → null (fail-safe, never throws)", async () => {
    const env = makeEnv({ connection: connectionRow(), throwOnSubscription: true });
    assert.equal(await getMarketplaceEntitlement(env, "gh:user1"), null);
  });
});

// ─── Tests: allowance integration ─────────────────────────────────────────────

describe("getAllowanceDryRun with entitlement", () => {
  it("17 — base 5 + plan 30 = 35 included runs", async () => {
    const env = makeEnv({ usedThisPeriod: 0 });
    const result = await getAllowanceDryRun({
      env,
      userKey: "gh:user1",
      eventType: "workspace_pr_review_run",
      entitlement: { includedRunsPerMonth: 30 },
    });
    assert.ok(result);
    assert.equal(result.includedRuns, 35);
    assert.equal(result.remainingIncludedRuns, 35);
  });

  it("18 — no entitlement keeps base includedRuns 5 (backwards compatible)", async () => {
    const env = makeEnv({ usedThisPeriod: 0 });
    const result = await getAllowanceDryRun({
      env,
      userKey: "gh:user1",
      eventType: "workspace_pr_review_run",
    });
    assert.ok(result);
    assert.equal(result.includedRuns, 5);
    assert.equal(result.remainingIncludedRuns, 5);
  });

  it("19 — entitlement keeps coveredByAllowance=true past the base 5", async () => {
    const env = makeEnv({ usedThisPeriod: 7 });
    const result = await getAllowanceDryRun({
      env,
      userKey: "gh:user1",
      eventType: "workspace_pr_review_run",
      entitlement: { includedRunsPerMonth: 30 },
    });
    assert.ok(result);
    assert.equal(result.coveredByAllowance, true);
    assert.equal(result.remainingIncludedRuns, 28);
    assert.equal(result.billableUnitsAfterAllowance, 0);
  });
});

// ─── Tests: credits endpoint exposes entitlement ──────────────────────────────

async function creditsReq(env) {
  const app = createApp();
  const request = new Request("http://localhost/workspace/credits?userKey=gh%3Auser1", {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return app.fetch(request, env, {});
}

describe("GET /workspace/credits entitlement field", () => {
  it("20 — active paid sub → entitlement present + includedRuns raised to 35", async () => {
    const env = makeEnv({
      connection: connectionRow(),
      subscription: subscriptionRow(),
      usedThisPeriod: 2,
    });
    const res = await creditsReq(env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.entitlement, {
      planName: "Solo",
      includedRunsPerMonth: 30,
      source: "github_marketplace",
    });
    assert.equal(body.allowance.review.includedRuns, 35);
    assert.equal(body.allowance.review.usedThisPeriod, 2);
    assert.equal(body.allowance.review.remainingIncludedRuns, 33);
  });

  it("21 — no subscription → no entitlement field, base includedRuns 5", async () => {
    const env = makeEnv({ connection: connectionRow(), subscription: null });
    const res = await creditsReq(env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(!("entitlement" in body), "entitlement must be absent without a subscription");
    assert.equal(body.allowance.review.includedRuns, 5);
  });
});

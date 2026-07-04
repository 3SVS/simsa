/**
 * beta_limits (PR B) — temporary daily abuse caps for the free beta.
 *
 * Covers:
 *   (a) env resolvers: defaults (100 reviews/day, 20 creations/day) + overrides
 *   (b) consumeUserDailyLimit: allows up to N per UTC day, blocks N+1,
 *       attempt-based, day-bucketed key (not the hourly bucket)
 *   (c) fail-open: a broken D1 never blocks a legitimate request
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  BETA_LIMITS,
  betaReviewDailyLimit,
  betaProjectCreateDailyLimit,
  BETA_REVIEW_DAILY_BUCKET,
  BETA_PROJECT_CREATE_DAILY_BUCKET,
} = await import("../dist/workspace/beta-limits.js");
const { consumeUserDailyLimit, secondsUntilNextDayUtc } = await import(
  "../dist/workspace/rate-limit.js"
);

// ─── In-memory workspace_rate_limit mock ─────────────────────────────────────

function makeMockDb() {
  const state = { rateLimits: new Map() }; // `${hash}::${bucketKey}` → count
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          if (/FROM workspace_rate_limit/.test(sql)) {
            const [hash, key] = bound;
            const count = state.rateLimits.get(`${hash}::${key}`);
            return count === undefined ? null : { count };
          }
          return null;
        },
        async run() {
          if (/INSERT INTO workspace_rate_limit/.test(sql)) {
            const [hash, key] = bound;
            const k = `${hash}::${key}`;
            state.rateLimits.set(k, (state.rateLimits.get(k) ?? 0) + 1);
          }
          return { success: true };
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

// ─── (a) env resolvers ───────────────────────────────────────────────────────

describe("beta-limits: env resolvers", () => {
  it("defaults match the confirmed beta caps (100 reviews / 20 creations per day)", () => {
    assert.equal(BETA_LIMITS.reviewsPerDay, 100);
    assert.equal(BETA_LIMITS.projectCreatesPerDay, 20);
    assert.equal(betaReviewDailyLimit({}), 100);
    assert.equal(betaProjectCreateDailyLimit({}), 20);
  });

  it("valid env overrides win", () => {
    assert.equal(betaReviewDailyLimit({ BETA_REVIEW_DAILY_LIMIT: "5" }), 5);
    assert.equal(betaProjectCreateDailyLimit({ BETA_PROJECT_CREATE_DAILY_LIMIT: "3" }), 3);
  });

  it("invalid overrides fall back to defaults", () => {
    assert.equal(betaReviewDailyLimit({ BETA_REVIEW_DAILY_LIMIT: "0" }), 100);
    assert.equal(betaReviewDailyLimit({ BETA_REVIEW_DAILY_LIMIT: "-4" }), 100);
    assert.equal(betaReviewDailyLimit({ BETA_REVIEW_DAILY_LIMIT: "abc" }), 100);
    assert.equal(betaProjectCreateDailyLimit({ BETA_PROJECT_CREATE_DAILY_LIMIT: "" }), 20);
  });

  it("bucket names are distinct from the hourly buckets", () => {
    assert.equal(BETA_REVIEW_DAILY_BUCKET, "beta-review-daily");
    assert.equal(BETA_PROJECT_CREATE_DAILY_BUCKET, "beta-project-create-daily");
    assert.notEqual(BETA_REVIEW_DAILY_BUCKET, "workspace-pr-review");
  });
});

// ─── (b) daily consumption ───────────────────────────────────────────────────

describe("consumeUserDailyLimit", () => {
  it("allows up to the limit, then blocks with a retry hint until UTC midnight", async () => {
    const env = { DB: makeMockDb() };
    const r1 = await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 2);
    const r2 = await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 2);
    assert.equal(r1.limited, false);
    assert.equal(r2.limited, false);
    const r3 = await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 2);
    assert.equal(r3.limited, true);
    assert.ok(r3.retryAfterSeconds >= 60 && r3.retryAfterSeconds <= 86400);
  });

  it("buckets by UTC day (10-char key), not by hour", async () => {
    const env = { DB: makeMockDb() };
    await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 10);
    const keys = [...env.DB.state.rateLimits.keys()];
    assert.equal(keys.length, 1);
    const bucketKey = keys[0].split("::")[1];
    assert.equal(bucketKey.length, 10); // "2026-07-05", no "T15" hour suffix
    assert.ok(!bucketKey.includes("T"));
  });

  it("isolates users and buckets (uk2 / another bucket unaffected)", async () => {
    const env = { DB: makeMockDb() };
    await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 1);
    const blocked = await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 1);
    assert.equal(blocked.limited, true);
    const otherUser = await consumeUserDailyLimit(env, "beta-review-daily", "uk2", 1);
    assert.equal(otherUser.limited, false);
    const otherBucket = await consumeUserDailyLimit(env, "beta-project-create-daily", "uk1", 1);
    assert.equal(otherBucket.limited, false);
  });

  it("fail-open: a throwing D1 never blocks the request", async () => {
    const env = {
      DB: {
        prepare() {
          return {
            bind() { return this; },
            async first() { throw new Error("d1 down"); },
            async run() { throw new Error("d1 down"); },
          };
        },
      },
    };
    const r = await consumeUserDailyLimit(env, "beta-review-daily", "uk1", 1);
    assert.equal(r.limited, false);
  });
});

describe("secondsUntilNextDayUtc", () => {
  it("is between 60s and 24h", () => {
    const s = secondsUntilNextDayUtc();
    assert.ok(s >= 60 && s <= 86400);
  });
});

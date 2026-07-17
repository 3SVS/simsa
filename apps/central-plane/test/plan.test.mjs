import { describe, it } from "node:test";
import assert from "node:assert/strict";

// RC-4 플랜 자격 (design: docs/simsa-review-consensus-design-2026-07-17.md):
// paid = 미회수 plan_grants 또는 active ls_subscriptions. DB 오류/테이블 부재는
// free로 fail-safe (자격 조회 실패가 paid로 승격되면 과금 우회가 된다).

const { resolvePlan } = await import("../dist/plan.js");

/** Fake D1: routes SQL to canned rows. `throwOn` simulates a missing table. */
function fakeEnv({ grantRow = null, subRow = null, throwOn = [] } = {}) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("plan_grants")) {
                  if (throwOn.includes("grants")) throw new Error("no such table");
                  return grantRow;
                }
                if (sql.includes("ls_subscriptions")) {
                  if (throwOn.includes("subs")) throw new Error("no such table");
                  return subRow;
                }
                return null;
              },
            };
          },
        };
      },
    },
  };
}

describe("resolvePlan — RC-4", () => {
  it("unrevoked grant → paid", async () => {
    assert.equal(await resolvePlan(fakeEnv({ grantRow: { plan: "paid" } }), "u1"), "paid");
  });

  it("active subscription (no grant) → paid", async () => {
    assert.equal(await resolvePlan(fakeEnv({ subRow: { id: "lssub_x" } }), "u1"), "paid");
  });

  it("neither → free; empty/absent userKey → free without queries", async () => {
    assert.equal(await resolvePlan(fakeEnv(), "u1"), "free");
    assert.equal(await resolvePlan(fakeEnv({ grantRow: { plan: "paid" } }), ""), "free");
    assert.equal(await resolvePlan(fakeEnv({ grantRow: { plan: "paid" } }), undefined), "free");
  });

  it("grants table missing → still finds subscription; both failing → free (fail-safe)", async () => {
    assert.equal(
      await resolvePlan(fakeEnv({ subRow: { id: "s" }, throwOn: ["grants"] }), "u1"),
      "paid",
    );
    assert.equal(
      await resolvePlan(fakeEnv({ throwOn: ["grants", "subs"] }), "u1"),
      "free",
    );
  });
});

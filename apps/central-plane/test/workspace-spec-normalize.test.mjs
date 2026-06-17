import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { normalizeProductSpec, normalizeCheckableItems } = await import(
  "../dist/workspace/check.js"
);
const { reviewPRAgainstItems } = await import("../dist/workspace/pr-review.js");

/**
 * Stage 55 — a PR review with a partial productSpec (missing array fields such as
 * `excluded` / `openQuestions`) used to crash the heuristic with an opaque
 * "Cannot read properties of undefined (reading 'some')". The route now normalizes
 * the untrusted spec at the boundary instead of trusting an `as` cast.
 */
describe("normalizeProductSpec", () => {
  it("fills every array field for an empty/partial spec", () => {
    const s = normalizeProductSpec({ productName: "X" });
    assert.equal(s.productName, "X");
    for (const k of ["targetUsers", "included", "excluded", "userFlow", "decisions", "openQuestions"]) {
      assert.ok(Array.isArray(s[k]), `${k} must be an array`);
      assert.equal(s[k].length, 0);
    }
    // safe to call the heuristic operations that previously threw
    assert.doesNotThrow(() => s.excluded.some(() => true) && s.openQuestions.some(() => true));
  });

  it("coerces non-object / null / undefined to a complete empty spec", () => {
    for (const raw of [null, undefined, 42, "nope", []]) {
      const s = normalizeProductSpec(raw);
      assert.ok(Array.isArray(s.excluded) && s.excluded.length === 0);
      assert.equal(typeof s.productName, "string");
    }
  });

  it("drops non-string entries inside array fields", () => {
    const s = normalizeProductSpec({ excluded: ["a", 1, null, "b"] });
    assert.deepEqual(s.excluded, ["a", "b"]);
  });
});

describe("normalizeCheckableItems", () => {
  it("defaults criteria to an array and drops id-less entries", () => {
    const items = normalizeCheckableItems([
      { id: "a", title: "A" }, // no criteria
      { title: "no id" }, // dropped
      { id: "b", title: "B", criteria: ["c1", 2, "c2"] },
    ]);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0].criteria, []);
    assert.equal(items[0].status, "not_started");
    assert.deepEqual(items[1].criteria, ["c1", "c2"]);
  });

  it("returns [] for non-array input", () => {
    assert.deepEqual(normalizeCheckableItems(null), []);
    assert.deepEqual(normalizeCheckableItems({}), []);
  });
});

describe("reviewPRAgainstItems with a normalized partial spec", () => {
  it("does not throw when the spec was empty before normalization", async () => {
    const spec = normalizeProductSpec({ productName: "P" }); // missing every array
    const items = normalizeCheckableItems([
      { id: "i1", title: "기능 A", criteria: ["조건1", "조건2"] },
    ]);
    const req = {
      productSpec: spec,
      items,
      prMeta: {
        number: 1,
        title: "t",
        state: "open",
        headBranch: "h",
        baseBranch: "main",
        headSha: "",
        additions: 10,
        deletions: 0,
        changedFiles: 1,
      },
      prFiles: [{ filename: "src/a.ts", additions: 10, deletions: 0, patch: "+ code" }],
    };
    // apiKey undefined → deterministic heuristic path (the one that used to throw).
    // A throwing fetch guarantees the test stays offline.
    const throwingFetch = () => {
      throw new Error("no network in test");
    };
    const result = await reviewPRAgainstItems(req, undefined, throwingFetch);
    assert.ok(Array.isArray(result.results));
    assert.equal(result.results.length, 1);
  });
});

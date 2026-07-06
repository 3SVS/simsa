import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checksPrimaryCta } from "../src/lib/checks-cta.mjs";

describe("checks-cta: exactly one state-driven primary", () => {
  it("no PR review yet → connect_pr (get the real review)", () => {
    assert.equal(
      checksPrimaryCta({ prReviewLoaded: true, hasPrReview: false, prNeedsAction: 0, draftNeedsAction: 5 }),
      "connect_pr",
    );
  });

  it("real PR review with issues → pr_fix (outranks the draft pre-check)", () => {
    assert.equal(
      checksPrimaryCta({ prReviewLoaded: true, hasPrReview: true, prNeedsAction: 2, draftNeedsAction: 3 }),
      "pr_fix",
    );
  });

  it("PR review all passed but draft has issues → draft_fix", () => {
    assert.equal(
      checksPrimaryCta({ prReviewLoaded: true, hasPrReview: true, prNeedsAction: 0, draftNeedsAction: 3 }),
      "draft_fix",
    );
  });

  it("nothing actionable → none (no filled primary)", () => {
    assert.equal(
      checksPrimaryCta({ prReviewLoaded: true, hasPrReview: true, prNeedsAction: 0, draftNeedsAction: 0 }),
      "none",
    );
  });

  it("PR still loading → not connect_pr; falls back to draft state", () => {
    assert.equal(
      checksPrimaryCta({ prReviewLoaded: false, hasPrReview: false, prNeedsAction: 0, draftNeedsAction: 4 }),
      "draft_fix",
    );
  });

  it("never returns two primaries — the result is a single tag", () => {
    // Exhaustive-ish: every combination yields exactly one of the four tags.
    const tags = new Set();
    for (const prReviewLoaded of [true, false])
      for (const hasPrReview of [true, false])
        for (const prNeedsAction of [0, 2])
          for (const draftNeedsAction of [0, 3])
            tags.add(checksPrimaryCta({ prReviewLoaded, hasPrReview, prNeedsAction, draftNeedsAction }));
    for (const tag of tags) assert.ok(["connect_pr", "pr_fix", "draft_fix", "none"].includes(tag));
  });
});

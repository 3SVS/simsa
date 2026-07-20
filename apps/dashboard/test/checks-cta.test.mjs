import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checksPrimaryCta } from "../src/lib/checks-cta.mjs";

// v2 (2026-07-21): +prSectionVisible (hidden PR section can't own the primary)
// +draftHasResults (empty pre-check → run_precheck is the primary).
const BASE = { prSectionVisible: true, prReviewLoaded: true, hasPrReview: false, prNeedsAction: 0, draftNeedsAction: 0, draftHasResults: true };

describe("checks-cta: exactly one state-driven primary", () => {
  it("no PR review yet → connect_pr (get the real review)", () => {
    assert.equal(checksPrimaryCta({ ...BASE, draftNeedsAction: 5 }), "connect_pr");
  });

  it("real PR review with issues → pr_fix (outranks the draft pre-check)", () => {
    assert.equal(
      checksPrimaryCta({ ...BASE, hasPrReview: true, prNeedsAction: 2, draftNeedsAction: 3 }),
      "pr_fix",
    );
  });

  it("PR review all passed but draft has issues → draft_fix", () => {
    assert.equal(
      checksPrimaryCta({ ...BASE, hasPrReview: true, prNeedsAction: 0, draftNeedsAction: 3 }),
      "draft_fix",
    );
  });

  it("nothing actionable → none (no filled primary)", () => {
    assert.equal(
      checksPrimaryCta({ ...BASE, hasPrReview: true }),
      "none",
    );
  });

  it("PR still loading → not connect_pr; falls back to draft state", () => {
    assert.equal(
      checksPrimaryCta({ ...BASE, prReviewLoaded: false, draftNeedsAction: 4 }),
      "draft_fix",
    );
  });

  // journey-audit v2 기준선 (실측 cta=2): the pre-check empty state used to
  // hard-code its own primary and bypass this machine.
  it("empty pre-check + connect available → connect_pr wins, run stays secondary", () => {
    assert.equal(checksPrimaryCta({ ...BASE, draftHasResults: false }), "connect_pr");
  });

  it("empty pre-check + PR section HIDDEN (idea branch) → run_precheck is the primary", () => {
    assert.equal(
      checksPrimaryCta({ ...BASE, prSectionVisible: false, draftHasResults: false }),
      "run_precheck",
    );
  });

  it("hidden PR section never yields connect_pr", () => {
    assert.equal(
      checksPrimaryCta({ ...BASE, prSectionVisible: false, draftNeedsAction: 2 }),
      "draft_fix",
    );
  });

  it("never returns two primaries — the result is a single tag", () => {
    const tags = new Set();
    for (const prSectionVisible of [true, false])
      for (const prReviewLoaded of [true, false])
        for (const hasPrReview of [true, false])
          for (const prNeedsAction of [0, 2])
            for (const draftNeedsAction of [0, 3])
              for (const draftHasResults of [true, false])
                tags.add(checksPrimaryCta({ prSectionVisible, prReviewLoaded, hasPrReview, prNeedsAction, draftNeedsAction, draftHasResults }));
    for (const tag of tags)
      assert.ok(["connect_pr", "pr_fix", "draft_fix", "run_precheck", "none"].includes(tag));
  });
});

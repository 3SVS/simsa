import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  severityForStatus,
  severityCode,
  severityChipClass,
  isActionableStatus,
  buildReviewVerdict,
  reviewProgress,
} from "../src/lib/review-severity.mjs";

describe("review-severity", () => {
  it("maps statuses to severity tiers", () => {
    assert.equal(severityForStatus("failed"), "p0");
    assert.equal(severityForStatus("needs_decision"), "p1");
    assert.equal(severityForStatus("inconclusive"), "p2");
    assert.equal(severityForStatus("passed"), "ok");
    assert.equal(severityForStatus("building"), "neutral");
    assert.equal(severityForStatus("anything_else"), "neutral");
  });

  it("severity codes only exist for actionable tiers", () => {
    assert.equal(severityCode("failed"), "P0");
    assert.equal(severityCode("needs_decision"), "P1");
    assert.equal(severityCode("inconclusive"), "P2");
    assert.equal(severityCode("passed"), "");
    assert.equal(severityCode("not_started"), "");
  });

  it("chips are tinted (bg-*-50/100) never solid fills", () => {
    for (const s of ["failed", "needs_decision", "inconclusive", "passed", "building"]) {
      const cls = severityChipClass(s);
      assert.match(cls, /bg-\w+-(50|100)/, `${s} chip should be tinted, got ${cls}`);
      assert.doesNotMatch(cls, /bg-\w+-(600|700)/, `${s} chip must not be a solid fill`);
    }
  });

  it("actionable + passed chips use strong text", () => {
    for (const s of ["failed", "needs_decision", "inconclusive", "passed"]) {
      assert.match(severityChipClass(s), /text-\w+-(600|700)/, `${s} chip needs strong text`);
    }
  });

  it("actionable statuses are the non-passed findings", () => {
    assert.equal(isActionableStatus("failed"), true);
    assert.equal(isActionableStatus("needs_decision"), true);
    assert.equal(isActionableStatus("inconclusive"), true);
    assert.equal(isActionableStatus("passed"), false);
    assert.equal(isActionableStatus("building"), false);
  });

  it("verdict = pass only when nothing needs action", () => {
    assert.deepEqual(buildReviewVerdict({ passed: 9, failed: 3 }), {
      total: 12,
      passed: 9,
      needsAction: 3,
      tone: "fail",
    });
    assert.deepEqual(buildReviewVerdict({ passed: 12 }), {
      total: 12,
      passed: 12,
      needsAction: 0,
      tone: "pass",
    });
  });

  it("verdict tolerates empty / missing summaries", () => {
    assert.deepEqual(buildReviewVerdict(null), { total: 0, passed: 0, needsAction: 0, tone: "fail" });
    assert.deepEqual(buildReviewVerdict({}), { total: 0, passed: 0, needsAction: 0, tone: "fail" });
  });

  it("counts needs_decision + inconclusive toward needsAction", () => {
    const v = buildReviewVerdict({ passed: 5, failed: 1, inconclusive: 2, needsDecision: 1 });
    assert.equal(v.needsAction, 4);
    assert.equal(v.total, 9);
    assert.equal(v.tone, "fail");
  });

  it("progress counter clamps done to total", () => {
    assert.deepEqual(reviewProgress(2, 5), { done: 2, total: 5 });
    assert.deepEqual(reviewProgress(9, 5), { done: 5, total: 5 });
    assert.deepEqual(reviewProgress(-1, 5), { done: 0, total: 5 });
  });
});

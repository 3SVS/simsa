/**
 * project-steps.test.mjs — fixes the progress map's two load-bearing invariants:
 *  1. LOCKING: steps with a CONFIRMED-unmet precondition are locked (with the
 *     right hint); unknown facts NEVER lock (fail-open — a wrong lock blocks a
 *     user, a missing lock just shows plain nav).
 *  2. AUTO-CHECK: done is derived from data — already-connected/already-run work
 *     is auto-checked, so revisiting never demands rework.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProjectSteps, nextScreenSlug } from "../src/lib/project-steps.mjs";

const byKey = (steps) => Object.fromEntries(steps.map((s) => [s.key, s]));

test("fresh project (no items confirmed): step1 current, step2+3 locked with hints", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false }));
  assert.equal(s.prepare.status, "current");
  assert.equal(s.review.status, "locked");
  assert.equal(s.review.lockReason, "need_items");
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_code"); // "코드를 먼저 연결하세요"
});

test("items done, no repo: step2 unlocks (current), step3 still locked on code", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false }));
  assert.equal(s.prepare.status, "done"); // auto-checked — no rework
  assert.equal(s.review.status, "current");
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_code");
});

test("items + repo, no run yet: step3 unlocked (todo), step2 still current", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: true, hasReviewRun: false }));
  assert.equal(s.review.status, "current"); // connected but not yet run
  assert.equal(s.results.status, "todo"); // reachable, not current yet
  assert.equal(s.results.lockReason, null);
});

test("AUTO-CHECK: items + repo + run → step1/2 done, step3 current (no rework demanded)", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: true, hasReviewRun: true }));
  assert.equal(s.prepare.status, "done");
  assert.equal(s.review.status, "done"); // repo already connected + review already run → checked
  assert.equal(s.results.status, "current");
});

test("FAIL-OPEN: unknown facts (null) never lock anything", () => {
  const s = byKey(computeProjectSteps({ hasItems: null, hasRepo: null, hasReviewRun: null }));
  assert.notEqual(s.review.status, "locked");
  assert.notEqual(s.results.status, "locked");
  // and nothing is falsely checked either
  assert.notEqual(s.review.status, "done");
});

test("null input tolerated (never throws)", () => {
  const s = computeProjectSteps(undefined);
  assert.equal(s.length, 3);
});

test("nextScreenSlug walks the canonical order and ends cleanly", () => {
  assert.equal(nextScreenSlug("idea"), "spec");
  assert.equal(nextScreenSlug("spec"), "items");
  assert.equal(nextScreenSlug("items"), "settings");
  assert.equal(nextScreenSlug("settings"), "github");
  assert.equal(nextScreenSlug("github"), "checks");
  assert.equal(nextScreenSlug("checks"), "fixes");
  assert.equal(nextScreenSlug("fixes"), null); // last — no forced next
  assert.equal(nextScreenSlug("benchmark"), null); // advanced screens stay out of the walk
});

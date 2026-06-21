// Stage 80: pure display helpers for the Evolution Impact Summary card.
// The summary itself is computed server-side; this module formats the response
// for the UI. Tests assert the label keys against the EN dictionary so any
// drift between central enum and dashboard chrome shows up here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_OVERALL_VERDICTS,
  summaryVerdictLabelKey,
  summaryReasonLabelKey,
  formatAverageDeltaPercent,
  formatAverageDeltaCount,
  summaryHasNoFollowups,
} from "../src/lib/evolution-impact-summary.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

const s = DICTIONARIES.en.evolution;

test("SUMMARY_OVERALL_VERDICTS lists the five spec values", () => {
  assert.deepEqual([...SUMMARY_OVERALL_VERDICTS].sort(), [
    "mixed",
    "mostly_improved",
    "mostly_inconclusive",
    "no_followups",
    "regressed",
  ]);
});

test("summaryVerdictLabelKey returns a real dictionary key for every verdict", () => {
  for (const v of SUMMARY_OVERALL_VERDICTS) {
    const key = summaryVerdictLabelKey(v);
    assert.ok(s[key], `expected dictionary entry for verdict ${v} (key=${key})`);
  }
  // Fallback for unknown input still maps to a real key.
  assert.equal(summaryVerdictLabelKey(null), "summaryMostlyInconclusive");
  assert.equal(summaryVerdictLabelKey("nope"), "summaryMostlyInconclusive");
});

test("summaryReasonLabelKey covers every reason emitted by the central aggregator", () => {
  const REASONS = [
    "no_saved_action_packs",
    "no_followups",
    "more_improved_than_regressed",
    "regressions_detected",
    "mostly_inconclusive",
    "mixed_results",
    "not_enough_comparable_data",
  ];
  for (const r of REASONS) {
    const key = summaryReasonLabelKey(r);
    assert.ok(s[key], `expected dictionary entry for reason ${r} (key=${key})`);
  }
  assert.equal(summaryReasonLabelKey("unknown"), "summaryReasonNotEnoughData");
});

test("formatAverageDeltaPercent: signed percentage with null fallback", () => {
  assert.equal(formatAverageDeltaPercent(0.123), "+12%");
  assert.equal(formatAverageDeltaPercent(-0.05), "-5%");
  assert.equal(formatAverageDeltaPercent(0), "0%");
  assert.equal(formatAverageDeltaPercent(null), "—");
  assert.equal(formatAverageDeltaPercent(undefined), "—");
});

test("formatAverageDeltaCount: one decimal + signed, null fallback", () => {
  assert.equal(formatAverageDeltaCount(2), "+2");
  assert.equal(formatAverageDeltaCount(1.4567), "+1.5");
  assert.equal(formatAverageDeltaCount(-1.5), "-1.5");
  assert.equal(formatAverageDeltaCount(0), "0");
  assert.equal(formatAverageDeltaCount(null), "—");
  assert.equal(formatAverageDeltaCount(undefined), "—");
});

test("summaryHasNoFollowups: true when missing / 0 packs / 0 followed", () => {
  assert.equal(summaryHasNoFollowups(null), true);
  assert.equal(summaryHasNoFollowups({ actionPackCount: 0, followedPackCount: 0 }), true);
  assert.equal(summaryHasNoFollowups({ actionPackCount: 3, followedPackCount: 0 }), true);
  assert.equal(summaryHasNoFollowups({ actionPackCount: 3, followedPackCount: 2 }), false);
});

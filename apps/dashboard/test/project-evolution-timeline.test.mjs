// Stage 82: pure display helpers for the project Evolution Timeline card.
// The timeline itself is computed server-side; this module formats the
// response for the UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMELINE_EVENT_TYPES,
  timelineEventLabelKey,
  timelineLimitationLabelKey,
  timelineHasNoEvents,
} from "../src/lib/project-evolution-timeline.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

const s = DICTIONARIES.en.evolution;

test("TIMELINE_EVENT_TYPES enumerates the nine spec event types", () => {
  assert.deepEqual([...TIMELINE_EVENT_TYPES].sort(), [
    "action_pack_saved",
    "benchmark_created",
    "decision_recorded",
    "experiment_created",
    "followup_recorded",
    "impact_improved",
    "impact_inconclusive",
    "impact_regressed",
    "impact_unchanged",
  ]);
});

test("timelineEventLabelKey returns a real dictionary key for every event type", () => {
  for (const type of TIMELINE_EVENT_TYPES) {
    const key = timelineEventLabelKey(type);
    assert.ok(s[key], `expected dictionary entry for ${type} (key=${key})`);
  }
  // Fallback for unknown input still maps to a real key.
  assert.equal(timelineEventLabelKey(null), "timelineExperimentCreated");
  assert.equal(timelineEventLabelKey(undefined), "timelineExperimentCreated");
  assert.equal(timelineEventLabelKey("garbage"), "timelineExperimentCreated");
});

test("timelineLimitationLabelKey maps timeline_truncated; passes through unknown codes", () => {
  assert.equal(timelineLimitationLabelKey("timeline_truncated"), "timelineTruncated");
  assert.equal(timelineLimitationLabelKey("other_code"), "other_code");
});

test("timelineHasNoEvents: true when missing / empty events", () => {
  assert.equal(timelineHasNoEvents(null), true);
  assert.equal(timelineHasNoEvents(undefined), true);
  assert.equal(timelineHasNoEvents({ events: [] }), true);
  assert.equal(timelineHasNoEvents({ events: [{ id: "x" }] }), false);
});

test("timeline-only dictionary strings live in the dictionary", () => {
  // Surface-only — assert presence so a future rename does not leave the UI
  // with stringified keys.
  assert.ok(s.timelineTitle);
  assert.ok(s.timelineDesc);
  assert.ok(s.timelineEmpty);
  assert.ok(s.timelineOpen);
  assert.ok(s.timelineTruncated);
});

// Stage 122 — beta usage/cost boundary copy tests. Honest + conservative: no
// agent/benchmark execution, no active billing, no paid-plan language.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BETA_USAGE_BOUNDARY_HEADING,
  BETA_USAGE_BOUNDARY_ITEMS,
  BETA_USAGE_NOT_ACTIVE_COPY,
  SAVED_WORKFLOW_USAGE_NOTE,
  ADMIN_USAGE_BOUNDARY_NOTE,
  ADMIN_COUNTS_SIGNAL_NOTE,
  BETA_USAGE_BOUNDARY_COPY,
  getBetaUsageBoundaryCopy,
} from "../src/lib/beta-usage-boundary.mjs";

// Active-billing language that must NOT appear as a current claim.
const ACTIVE_BILLING = ["charged", "invoice", "paid plan", "metered usage", "subscription", "payment required"];

const allCopy = [
  BETA_USAGE_BOUNDARY_HEADING,
  ...BETA_USAGE_BOUNDARY_ITEMS,
  BETA_USAGE_NOT_ACTIVE_COPY,
  SAVED_WORKFLOW_USAGE_NOTE,
  ADMIN_USAGE_BOUNDARY_NOTE,
  ADMIN_COUNTS_SIGNAL_NOTE,
]
  .join(" ")
  .toLowerCase();

test("usage boundary mentions deterministic preview", () => {
  assert.match(BETA_USAGE_BOUNDARY_ITEMS.join(" ").toLowerCase(), /deterministic preview/);
});

test("usage boundary says no agent execution", () => {
  assert.match(BETA_USAGE_BOUNDARY_ITEMS.join(" ").toLowerCase(), /does not execute agents/);
});

test("usage boundary says no benchmark execution", () => {
  assert.match(BETA_USAGE_BOUNDARY_ITEMS.join(" ").toLowerCase(), /run benchmarks/);
});

test("usage boundary says no billing active", () => {
  assert.match(BETA_USAGE_NOT_ACTIVE_COPY.toLowerCase(), /no billing or paid usage is active/);
});

test("copy avoids active-billing language", () => {
  for (const w of ACTIVE_BILLING) {
    assert.ok(!allCopy.includes(w), `copy must not imply active billing ("${w}")`);
  }
});

test("saved workflow note clarifies snapshots are not completed runs/benchmarks", () => {
  const s = SAVED_WORKFLOW_USAGE_NOTE.toLowerCase();
  assert.match(s, /not completed agent runs or benchmark results/);
});

test("admin note says summaries only, no billing/execution", () => {
  const s = ADMIN_USAGE_BOUNDARY_NOTE.toLowerCase();
  assert.match(s, /summaries only/);
  assert.match(s, /does not show usage charges, billing/);
});

test("admin counts note frames counts as activity signals, not billing metrics", () => {
  assert.match(ADMIN_COUNTS_SIGNAL_NOTE.toLowerCase(), /activity signals, not billing metrics/);
});

test("future limits are framed as future, not active", () => {
  assert.match(BETA_USAGE_BOUNDARY_ITEMS.join(" ").toLowerCase(), /future ai\/agent execution features will need explicit usage limits/);
});

// Non-developer copy pass — localized copy object.

test("en copy object mirrors the canonical constants", () => {
  const en = getBetaUsageBoundaryCopy("en");
  assert.equal(en.heading, BETA_USAGE_BOUNDARY_HEADING);
  assert.deepEqual(en.items, BETA_USAGE_BOUNDARY_ITEMS);
  assert.equal(en.notActive, BETA_USAGE_NOT_ACTIVE_COPY);
  assert.equal(en.savedWorkflowNote, SAVED_WORKFLOW_USAGE_NOTE);
});

test("ko copy has the same shape as en and keeps the no-execution/no-billing semantics", () => {
  const ko = BETA_USAGE_BOUNDARY_COPY.ko;
  const en = BETA_USAGE_BOUNDARY_COPY.en;
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  assert.equal(ko.items.length, en.items.length);
  assert.match(ko.items.join(" "), /하지 않습니다/);
  assert.match(ko.notActive, /결제나 유료 사용도 발생하지 않습니다/);
  for (const v of [ko.heading, ko.notActive, ko.savedWorkflowNote, ...ko.items]) {
    assert.ok(typeof v === "string" && v.length > 0);
  }
});

test("getBetaUsageBoundaryCopy falls back to en for unknown locales", () => {
  assert.equal(getBetaUsageBoundaryCopy("fr").heading, BETA_USAGE_BOUNDARY_HEADING);
  assert.equal(getBetaUsageBoundaryCopy(null).heading, BETA_USAGE_BOUNDARY_HEADING);
});

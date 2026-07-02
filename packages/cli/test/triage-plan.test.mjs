import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planTriage,
  isTestFilePath,
  countChangedLines,
} from "../dist/lib/triage-plan.js";

// ---------------------------------------------------------------------
// Decision #22 wiring — triage decision → council path selection.
// planTriage is the pure seam `conclave review` uses to decide whether
// to swap the full council for a single-agent lite Council.
// ---------------------------------------------------------------------

/** Build a unified-diff block adding `added` lines to `path`. */
function fileBlock(path, added) {
  return [
    `diff --git a/${path} b/${path}`,
    "index 0000000..1111111 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,1 +1,${added} @@`,
    ...Array.from({ length: added }, (_, i) => `+line ${i}`),
  ].join("\n");
}

function makeDiff(...blocks) {
  return blocks.join("\n") + "\n";
}

const DEFAULTS = {
  resolvedDomain: "code",
  enabled: true,
  liteLineThreshold: 40,
  liteFileThreshold: 3,
};

test("planTriage: small tested code diff → lite", () => {
  const diff = makeDiff(fileBlock("src/util.ts", 8), fileBlock("src/util.test.ts", 10));
  const plan = planTriage({ ...DEFAULTS, diff });
  assert.equal(plan.useLite, true);
  assert.equal(plan.outcome.path, "lite");
});

test("planTriage: trivial diff (<10 lines, no tests) → lite", () => {
  const diff = makeDiff(fileBlock("src/tiny.ts", 3));
  const plan = planTriage({ ...DEFAULTS, diff });
  assert.equal(plan.useLite, true);
});

test("planTriage: risky path (migrations/) → full even when tiny", () => {
  const diff = makeDiff(fileBlock("migrations/0042_add_col.sql", 2));
  const plan = planTriage({ ...DEFAULTS, diff });
  assert.equal(plan.useLite, false);
  assert.equal(plan.outcome.path, "full");
  assert.match(plan.outcome.reason, /risky path/);
});

test("planTriage: large diff (> line threshold) → full", () => {
  const diff = makeDiff(fileBlock("src/big.ts", 60), fileBlock("src/big.test.ts", 5));
  const plan = planTriage({ ...DEFAULTS, diff });
  assert.equal(plan.useLite, false);
  assert.match(plan.outcome.reason, /linesChanged/);
});

test("planTriage: many files (> file threshold) → full", () => {
  const diff = makeDiff(
    fileBlock("src/a.ts", 3),
    fileBlock("src/b.ts", 3),
    fileBlock("src/c.ts", 3),
    fileBlock("src/d.ts", 3),
  );
  const plan = planTriage({ ...DEFAULTS, diff });
  assert.equal(plan.useLite, false);
  assert.match(plan.outcome.reason, /fileCount/);
});

test("planTriage: non-trivial diff without tests → full", () => {
  const diff = makeDiff(fileBlock("src/logic.ts", 25));
  const plan = planTriage({ ...DEFAULTS, diff });
  assert.equal(plan.useLite, false);
  assert.match(plan.outcome.reason, /without any test/);
});

test("planTriage: enabled=false → never lite, no outcome (flag-off = no behavior change)", () => {
  const diff = makeDiff(fileBlock("src/tiny.ts", 2));
  const plan = planTriage({ ...DEFAULTS, diff, enabled: false });
  assert.equal(plan.useLite, false);
  assert.equal(plan.outcome, null);
  assert.equal(plan.skippedReason, "disabled");
});

test("planTriage: design + mixed domains never take the lite path", () => {
  const diff = makeDiff(fileBlock("src/Button.tsx", 4));
  for (const resolvedDomain of ["design", "mixed"]) {
    const plan = planTriage({ ...DEFAULTS, diff, resolvedDomain });
    assert.equal(plan.useLite, false);
    assert.equal(plan.skippedReason, "non-code-domain");
  }
});

test("planTriage: custom thresholds are honored", () => {
  // 8 lines / 1 file — lite under defaults, full when the line threshold is 5.
  const diff = makeDiff(fileBlock("src/tiny.ts", 8));
  const strict = planTriage({ ...DEFAULTS, diff, liteLineThreshold: 5 });
  assert.equal(strict.useLite, false);
});

test("isTestFilePath: conventional test shapes match, source files don't", () => {
  assert.equal(isTestFilePath("src/foo.test.ts"), true);
  assert.equal(isTestFilePath("test/council.test.mjs"), true);
  assert.equal(isTestFilePath("packages/x/__tests__/y.js"), true);
  assert.equal(isTestFilePath("src/foo.spec.tsx"), true);
  assert.equal(isTestFilePath("src/foo.ts"), false);
  assert.equal(isTestFilePath("src/testing-utils.ts"), false);
});

test("countChangedLines: counts +/- content lines, skips file headers", () => {
  const diff = makeDiff(fileBlock("src/a.ts", 5));
  assert.equal(countChangedLines(diff), 5);
});

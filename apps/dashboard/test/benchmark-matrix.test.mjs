// Stage 69: candidate × acceptance-item matrix helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkMatrix } from "../src/lib/agent-benchmark-matrix.mjs";

const cand = (id) => ({ id, label: id, mode: "single_agent", source: "manual" });

test("builds rows from itemOutcomesByCandidate, candidate + item order preserved", () => {
  const m = buildBenchmarkMatrix({
    candidates: [cand("a"), cand("b")],
    itemOutcomesByCandidate: {
      a: [
        { candidateId: "a", itemId: "i1", title: "Login", status: "passed" },
        { candidateId: "a", itemId: "i2", title: "Logout", status: "failed", evidence: "no endpoint" },
      ],
      b: [
        { candidateId: "b", itemId: "i1", title: "Login", status: "passed" },
        { candidateId: "b", itemId: "i2", title: "Logout", status: "needs_decision" },
      ],
    },
  });
  assert.equal(m.available, true);
  assert.equal(m.itemsCompared, 2);
  assert.deepEqual(m.rows.map((r) => r.itemId), ["i1", "i2"]);
  assert.deepEqual(m.rows[0].statusesByCandidate, { a: "passed", b: "passed" });
  assert.deepEqual(m.rows[1].statusesByCandidate, { a: "failed", b: "needs_decision" });
  assert.equal(m.rows[1].evidenceByCandidate.a, "no endpoint");
});

test("hasDisagreement true when statuses differ, false when identical", () => {
  const m = buildBenchmarkMatrix({
    candidates: [cand("a"), cand("b")],
    itemOutcomesByCandidate: {
      a: [{ candidateId: "a", itemId: "i1", title: "X", status: "passed" }, { candidateId: "a", itemId: "i2", title: "Y", status: "failed" }],
      b: [{ candidateId: "b", itemId: "i1", title: "X", status: "passed" }, { candidateId: "b", itemId: "i2", title: "Y", status: "passed" }],
    },
  });
  assert.equal(m.rows[0].hasDisagreement, false);
  assert.equal(m.rows[1].hasDisagreement, true);
  assert.equal(m.disagreementCount, 1);
});

test("missing outcome for a candidate becomes 'missing' and flags disagreement", () => {
  const m = buildBenchmarkMatrix({
    candidates: [cand("a"), cand("b")],
    itemOutcomesByCandidate: {
      a: [{ candidateId: "a", itemId: "i1", title: "X", status: "passed" }, { candidateId: "a", itemId: "i3", title: "Z", status: "failed" }],
      b: [{ candidateId: "b", itemId: "i1", title: "X", status: "passed" }],
    },
  });
  // i3 only in candidate a → appended after i1; b is missing
  assert.deepEqual(m.rows.map((r) => r.itemId), ["i1", "i3"]);
  assert.equal(m.rows[1].statusesByCandidate.b, "missing");
  assert.equal(m.rows[1].hasDisagreement, true);
});

test("best/worst computed by severity (passed best, failed worst, missing unknown)", () => {
  const m = buildBenchmarkMatrix({
    candidates: [cand("a"), cand("b")],
    itemOutcomesByCandidate: {
      a: [{ candidateId: "a", itemId: "i1", title: "X", status: "passed" }],
      b: [{ candidateId: "b", itemId: "i1", title: "X", status: "failed" }],
    },
  });
  assert.equal(m.rows[0].bestStatus, "passed");
  assert.equal(m.rows[0].worstStatus, "failed");
});

test("backward fallback: missing itemOutcomesByCandidate → available false", () => {
  const m = buildBenchmarkMatrix({ candidates: [cand("a"), cand("b")], itemOutcomesByCandidate: undefined });
  assert.equal(m.available, false);
  assert.deepEqual(m.rows, []);
  assert.equal(m.itemsCompared, 0);
  assert.equal(m.disagreementCount, 0);
});

test("empty outcomes → available true, zero rows", () => {
  const m = buildBenchmarkMatrix({ candidates: [cand("a"), cand("b")], itemOutcomesByCandidate: { a: [], b: [] } });
  assert.equal(m.available, true);
  assert.equal(m.itemsCompared, 0);
});

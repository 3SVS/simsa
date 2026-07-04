/**
 * STEP 4 — outcome poll. computeRecheckOutcome (pure) + updateTrainingRecordOutcome
 * (fetches the PRIOR R2 record and fills its outcome). The 수집≠저장 proof here is
 * that the ACTUAL stored object's outcome flips pending → resolved/unresolved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRecheckOutcome,
  updateTrainingRecordOutcome,
  buildTrainingRecord,
} from "../dist/workspace/training-store.js";

test("computeRecheckOutcome: all previously-open items now pass → resolved", () => {
  const prior = [{ itemId: "a", status: "failed" }, { itemId: "b", status: "passed" }];
  const current = [{ itemId: "a", status: "passed" }];
  assert.equal(computeRecheckOutcome(prior, current), "resolved");
});

test("computeRecheckOutcome: a previously-open item still not passing → unresolved", () => {
  const prior = [{ itemId: "a", status: "failed" }, { itemId: "b", status: "inconclusive" }];
  const current = [{ itemId: "a", status: "passed" }, { itemId: "b", status: "failed" }];
  assert.equal(computeRecheckOutcome(prior, current), "unresolved");
});

test("computeRecheckOutcome: nothing was open → resolved", () => {
  assert.equal(computeRecheckOutcome([{ itemId: "a", status: "passed" }], []), "resolved");
});

test("updateTrainingRecordOutcome: flips the STORED record's outcome (pending → resolved)", async () => {
  // Seed a prior record (outcome pending) as it would sit in R2.
  const prior = buildTrainingRecord(
    {
      userKey: "uk", projectId: "p", reviewRunId: "run_prev", repoFullName: "o/r", prNumber: 1,
      productSpec: {}, items: [], prFiles: [],
      review: { source: "llm", summary: { passed: 0, failed: 1, inconclusive: 0, needsDecision: 0 }, results: [] },
      finalStatus: "failed",
    },
    "hash", "2026-07-04T00:00:00.000Z",
  );
  assert.equal(prior.outcome, "pending");

  const store = new Map([["events/KR/2026/07/04/run_prev.json", JSON.stringify(prior)]]);
  const env = {
    EVIDENCE: {
      async get(key) {
        const v = store.get(key);
        return v ? { async text() { return v; } } : null;
      },
      async put(key, value) { store.set(key, value); },
    },
  };

  const res = await updateTrainingRecordOutcome(env, "events/KR/2026/07/04/run_prev.json", "resolved");
  assert.equal(res.updated, true);
  // The ACTUAL stored object now reads "resolved" — the reward half is filled.
  const after = JSON.parse(store.get("events/KR/2026/07/04/run_prev.json"));
  assert.equal(after.outcome, "resolved");
  // everything else untouched
  assert.equal(after.review_run_id, "run_prev");
});

test("updateTrainingRecordOutcome: missing object → no-op, never throws", async () => {
  const env = { EVIDENCE: { async get() { return null; }, async put() { throw new Error("should not put"); } } };
  assert.deepEqual(await updateTrainingRecordOutcome(env, "nope.json", "resolved"), { updated: false });
});

test("updateTrainingRecordOutcome: no bucket → no-op", async () => {
  assert.deepEqual(await updateTrainingRecordOutcome({}, "k.json", "resolved"), { updated: false });
});

/**
 * journey-store.test.mjs — consent-gated journey capture. Asserts the real path
 * (captureJourneyEvent → r2 payload), the NL metadata-only guard (no raw prose
 * for natural-language events, since the code scrubber can't catch PII), the
 * builtWith tag, no raw identity, and never-throws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildJourneyRecord,
  journeyRecordKey,
  captureJourneyEvent,
  NATURAL_LANGUAGE_EVENTS,
} from "../dist/workspace/journey-store.js";
import { TRAINING_CONSENT_VERSION } from "../dist/workspace/training-consent-db.js";

function dbWithConsent({ consented, version }) {
  return {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          return consented === null ? null : {
            user_key: "uk_secret", consented: consented ? 1 : 0,
            consent_version: version, created_at: "t", updated_at: "t",
          };
        },
      };
    },
  };
}

class FakeR2 {
  constructor() { this.puts = []; this.throwOnPut = false; }
  async put(key, value, opts) {
    if (this.throwOnPut) throw new Error("r2 down");
    this.puts.push({ key, value, opts });
  }
}

const base = (over = {}) => ({
  userKey: "uk_secret",
  projectId: "proj_1",
  eventType: "pr_reviewed",
  builtWith: { tools: ["cursor"] },
  eventId: "run_1",
  payload: { reviewRunId: "run_1", finalStatus: "passed" },
  now: "2026-07-04T09:00:00.000Z",
  subjectHash: "deadbeef",
  ...over,
});

test("buildJourneyRecord: shape + builtWith tag + consent version", () => {
  const rec = buildJourneyRecord(base(), "hash_x", "2026-07-04T00:00:00.000Z");
  assert.equal(rec.event_type, "pr_reviewed");
  assert.deepEqual(rec.built_with, { tools: ["cursor"] });
  assert.equal(rec.consent_version, TRAINING_CONSENT_VERSION);
  assert.equal(rec.subject_hash, "hash_x");
});

test("journeyRecordKey day-buckets + groups by project", () => {
  assert.equal(
    journeyRecordKey("2026-07-04T09:00:00.000Z", "proj_1", "run_1"),
    "journey/2026/07/04/proj_1/run_1.json",
  );
});

test("no consent → no-op", async () => {
  const r2 = new FakeR2();
  const res = await captureJourneyEvent({ DB: dbWithConsent({ consented: null }), EVIDENCE: r2 }, base());
  assert.deepEqual(res, { stored: false, reason: "no_consent" });
  assert.equal(r2.puts.length, 0);
});

test("consent + bucket → stored at journey key", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  const res = await captureJourneyEvent(env, base());
  assert.equal(res.stored, true);
  assert.equal(res.key, "journey/2026/07/04/proj_1/run_1.json");
});

test("NATURAL-LANGUAGE event drops raw prose (PII the code scrubber can't catch)", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  assert.ok(NATURAL_LANGUAGE_EVENTS.has("idea_submitted"));
  await captureJourneyEvent(env, base({
    eventType: "idea_submitted",
    payload: {
      idea: "고객 김철수(010-1234-5678)에게 매출 리포트 메일 보내기",  // raw PII prose
      ideaLength: 42,
    },
  }));
  const payload = r2.puts[0].value;
  assert.ok(!payload.includes("김철수"), "raw name must not be stored");
  assert.ok(!payload.includes("010-1234-5678"), "raw phone must not be stored");
  const parsed = JSON.parse(payload);
  assert.equal(parsed.payload.idea, undefined, "the raw idea field must be dropped");
  assert.equal(parsed.payload.ideaLength, 42, "metadata is kept");
});

test("code-based event keeps full payload", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  await captureJourneyEvent(env, base({ eventType: "pr_rechecked", payload: { reviewRunId: "r2", finalStatus: "failed" } }));
  const parsed = JSON.parse(r2.puts[0].value);
  assert.equal(parsed.payload.finalStatus, "failed");
  assert.equal(parsed.event_type, "pr_rechecked");
});

test("payload carries no raw userKey", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  await captureJourneyEvent(env, base({ userKey: "uk_super_secret" }));
  assert.ok(!r2.puts[0].value.includes("uk_super_secret"));
});

test("never throws on R2 failure", async () => {
  const r2 = new FakeR2();
  r2.throwOnPut = true;
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  assert.deepEqual(await captureJourneyEvent(env, base()), { stored: false, reason: "error" });
});

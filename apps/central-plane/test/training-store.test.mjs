/**
 * training-store.test.mjs
 *
 * The consent-gated capture path. Asserts:
 *  - no-op without active consent (bucket never touched)
 *  - no-op without an EVIDENCE bucket
 *  - stores on consent + bucket, at a day-bucketed key
 *  - the payload carries NO raw identity (userKey / email) — only a subject hash
 *  - never throws when R2 fails
 *  - buildTrainingRecord shape is stable and deterministic
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_SCHEMA_VERSION,
  buildTrainingRecord,
  trainingRecordKey,
  captureTrainingRecord,
} from "../dist/workspace/training-store.js";
import { TRAINING_CONSENT_VERSION } from "../dist/workspace/training-consent-db.js";

/** D1 fake returning a fixed consent row. */
function dbWithConsent({ consented, version }) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() {
          return consented === null
            ? null
            : {
                user_key: "uk_secret",
                consented: consented ? 1 : 0,
                consent_version: version,
                created_at: "t",
                updated_at: "t",
              };
        },
      };
    },
  };
}

class FakeR2 {
  constructor() {
    this.puts = [];
    this.throwOnPut = false;
  }
  async put(key, value, opts) {
    if (this.throwOnPut) throw new Error("r2 down");
    this.puts.push({ key, value, opts });
  }
}

const baseInput = () => ({
  userKey: "uk_secret",
  projectId: "proj_1",
  reviewRunId: "run_1",
  repoFullName: "3SVS/My-first-product",
  prNumber: 7,
  headSha: "abc123",
  productSpec: { title: "Login" },
  items: [{ id: "i1", title: "User can log in" }],
  prFiles: [{ filename: "src/login.ts", status: "modified", additions: 10, deletions: 2, patch: "@@ -1 +1 @@" }],
  review: {
    source: "llm",
    summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 },
    results: [{ itemId: "i1", status: "passed", reason: "diff adds the handler" }],
  },
  finalStatus: "passed",
  now: "2026-07-03T12:34:56.000Z",
  subjectHash: "deadbeef",
});

test("buildTrainingRecord: stable shape, deterministic, pending outcome", () => {
  const rec = buildTrainingRecord(baseInput(), "hash_x", "2026-07-03T00:00:00.000Z");
  assert.equal(rec.schema_version, TRAINING_SCHEMA_VERSION);
  assert.equal(rec.subject_hash, "hash_x");
  assert.equal(rec.consent_version, TRAINING_CONSENT_VERSION);
  assert.equal(rec.outcome, "pending");
  assert.equal(rec.pr_files[0].patch, "@@ -1 +1 @@");
  assert.equal(rec.results[0].status, "passed");
  assert.deepEqual(rec.summary, { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 });
});

test("trainingRecordKey is day-bucketed", () => {
  assert.equal(
    trainingRecordKey("2026-07-03T12:34:56.000Z", "run_1"),
    "training/2026/07/03/run_1.json",
  );
});

test("no consent row → no-op, bucket untouched", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: null }), EVIDENCE: r2 };
  const res = await captureTrainingRecord(env, baseInput());
  assert.deepEqual(res, { stored: false, reason: "no_consent" });
  assert.equal(r2.puts.length, 0);
});

test("stale consent version → no-op", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: "1970-01-01" }), EVIDENCE: r2 };
  const res = await captureTrainingRecord(env, baseInput());
  assert.equal(res.stored, false);
  assert.equal(res.reason, "no_consent");
  assert.equal(r2.puts.length, 0);
});

test("consent but no EVIDENCE bucket → no-op", async () => {
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }) };
  const res = await captureTrainingRecord(env, baseInput());
  assert.deepEqual(res, { stored: false, reason: "no_bucket" });
});

test("consent + bucket → stores at day-bucketed key", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  const res = await captureTrainingRecord(env, baseInput());
  assert.equal(res.stored, true);
  assert.equal(res.key, "training/2026/07/03/run_1.json");
  assert.equal(r2.puts.length, 1);
  assert.equal(r2.puts[0].opts.httpMetadata.contentType, "application/json");
});

test("payload carries NO raw identity (userKey / email absent)", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  const input = { ...baseInput(), userKey: "uk_super_secret_handle" };
  await captureTrainingRecord(env, input);
  const payload = r2.puts[0].value;
  assert.ok(!payload.includes("uk_super_secret_handle"), "raw userKey must not appear in payload");
  // No email address (diff "@@" hunk markers are fine — match a real address shape).
  assert.ok(!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(payload), "no email address in payload");
  const parsed = JSON.parse(payload);
  assert.equal(parsed.subject_hash, "deadbeef"); // injected hash, not the handle
});

// Fixtures assembled at runtime so the literals never match GitHub push
// protection (these are synthetic, not real keys — the concatenation keeps the
// scanner from flagging the source file while still exercising our rules).
const FIXTURE_AWS = "AKIA" + "IOSFODNN7EXAMPLE";
const FIXTURE_OPENAI = "sk-" + "proj-abcdefghij0123456789ABCDEFGHIJ";
const FIXTURE_STRIPE = "sk_" + "live_abcdef0123456789ABCDEFGHij";
const FIXTURE_GHPAT = "ghp_" + "012345678901234567890123456789abcdef";

test("secret-scrubs the diff body before storing (no live key survives)", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  const input = baseInput();
  input.prFiles = [
    {
      filename: "src/config.ts",
      status: "modified",
      patch:
        "@@ -1 +1 @@\n" +
        `+const AWS = "${FIXTURE_AWS}";\n` +
        `+const openai = "${FIXTURE_OPENAI}";\n` +
        "+const untouched = 42;\n",
    },
  ];
  await captureTrainingRecord(env, input);
  const payload = r2.puts[0].value;
  assert.ok(!payload.includes(FIXTURE_AWS), "AWS key must be scrubbed");
  assert.ok(!payload.includes(FIXTURE_OPENAI), "OpenAI key must be scrubbed");
  assert.ok(payload.includes("untouched = 42"), "non-secret code must survive intact");
});

test("secret-scrubs a key pasted into the product spec / acceptance items", async () => {
  const r2 = new FakeR2();
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  const input = baseInput();
  input.productSpec = { title: "App", notes: `my stripe key is ${FIXTURE_STRIPE}` };
  input.items = [{ id: "i1", title: `token ${FIXTURE_GHPAT} works` }];
  await captureTrainingRecord(env, input);
  const payload = r2.puts[0].value;
  assert.ok(!payload.includes(FIXTURE_STRIPE), "stripe key in spec must be scrubbed");
  assert.ok(!payload.includes(FIXTURE_GHPAT), "PAT in acceptance item must be scrubbed");
  // Structure survives — still parseable JSON with the item title context.
  const parsed = JSON.parse(payload);
  assert.equal(parsed.acceptance_items.length, 1);
});

test("never throws when R2 put fails → { stored:false, error }", async () => {
  const r2 = new FakeR2();
  r2.throwOnPut = true;
  const env = { DB: dbWithConsent({ consented: true, version: TRAINING_CONSENT_VERSION }), EVIDENCE: r2 };
  const res = await captureTrainingRecord(env, baseInput());
  assert.deepEqual(res, { stored: false, reason: "error" });
});

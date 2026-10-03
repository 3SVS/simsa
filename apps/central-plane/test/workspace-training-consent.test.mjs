/**
 * workspace-training-consent.test.mjs
 *
 * Consent DB (version-gated opt-in) + the GET/POST route. D1 is a stateful
 * recording fake keyed by user_key so upsert/get round-trips are exercised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_CONSENT_VERSION,
  getTrainingConsent,
  setTrainingConsent,
  hasActiveTrainingConsent,
} from "../dist/workspace/training-consent-db.js";
import { createWorkspaceTrainingConsentRoutes } from "../dist/routes/workspace-training-consent.js";

/**
 * Minimal D1 fake: one table (workspace_training_consent) keyed by user_key.
 * Train K (0071): the write is one upsert (consent_version + decided_at on both yes and no); a "no"
 * runs it in a batch with the training-copy deletion requests (training_records_index — no rows here,
 * so those report 0 changes). Real-SQL coverage lives in train-k-consent-server.test.mjs (node:sqlite).
 */
class FakeDb {
  constructor() {
    this.rows = new Map(); // user_key -> row
    this.throwOnFirst = false;
    this.batches = [];
  }
  prepare(sql) {
    const db = this;
    return {
      sql,
      binds: [],
      bind(...args) {
        this.binds = args;
        return this;
      },
      async first() {
        if (db.throwOnFirst) throw new Error("db down");
        // WHERE user_key = ? LIMIT 1
        const key = this.binds[0];
        return db.rows.get(key) ?? null;
      },
      async run() {
        if (/INSERT INTO workspace_training_consent/i.test(this.sql)) {
          const [user_key, consented, consent_version, decided_at, created_at, updated_at] = this.binds;
          const prev = db.rows.get(user_key);
          db.rows.set(user_key, {
            user_key, consented, consent_version, decided_at,
            created_at: prev?.created_at ?? created_at, updated_at,
          });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      async all() {
        return { results: [] }; // no indexed training copies in this fake
      },
    };
  }
  async batch(stmts) {
    this.batches.push(stmts.map((s) => s.sql));
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
}

test("default: no row → not consented, not active", async () => {
  const env = { DB: new FakeDb() };
  assert.equal(await getTrainingConsent(env, "uk_a"), null);
  assert.equal(await hasActiveTrainingConsent(env, "uk_a"), false);
});

test("opt-in stamps the current version and becomes active", async () => {
  const env = { DB: new FakeDb() };
  const c = await setTrainingConsent(env, "uk_a", true);
  assert.equal(c.consented, true);
  assert.equal(c.consentVersion, TRAINING_CONSENT_VERSION);
  assert.equal(await hasActiveTrainingConsent(env, "uk_a"), true);
});

// Train K · K-2 (0071) — was "opt-out clears the version": that NULL made a "no" indistinguishable
// from "never asked", so people who declined were invited again. A "no" is now a stored decision.
test("opt-out stores the decision (current version + decided_at), deactivates, and requests deletion in the same batch", async () => {
  const env = { DB: new FakeDb() };
  await setTrainingConsent(env, "uk_a", true);
  const c = await setTrainingConsent(env, "uk_a", false, { now: "2026-09-30T00:00:00.000Z" });
  assert.equal(c.consented, false);
  assert.equal(c.consentVersion, TRAINING_CONSENT_VERSION);
  assert.equal(c.decidedAt, "2026-09-30T00:00:00.000Z");
  assert.equal(c.wasConsented, true, "this 'no' is a withdrawal");
  assert.equal(await hasActiveTrainingConsent(env, "uk_a"), false);
  const row = env.DB.rows.get("uk_a");
  assert.equal(row.consent_version, TRAINING_CONSENT_VERSION);
  assert.equal(row.decided_at, "2026-09-30T00:00:00.000Z");
  assert.equal(env.DB.batches.length, 1, "consent row + deletion requests commit together");
  assert.match(env.DB.batches[0].join("\n"), /UPDATE training_records_index\s+SET delete_requested_at/);
});

test("GET after a 'no' → state declined (the dashboard does not invite again)", async () => {
  const env = { DB: new FakeDb() };
  const app = createWorkspaceTrainingConsentRoutes();
  await postConsent(app, env, { userKey: "uk_a", consented: false });
  const body = await (await getConsent(app, env, "uk_a")).json();
  assert.equal(body.state, "declined");
  assert.equal(body.consentVersion, TRAINING_CONSENT_VERSION);
  assert.equal(body.active, false);
});

test("stale consent version is NOT active (version-gating)", async () => {
  const env = { DB: new FakeDb() };
  // Simulate a row consented against an older clause.
  env.DB.rows.set("uk_a", {
    user_key: "uk_a",
    consented: 1,
    consent_version: "1970-01-01",
    created_at: "t",
    updated_at: "t",
  });
  assert.equal(await hasActiveTrainingConsent(env, "uk_a"), false);
});

test("hasActiveTrainingConsent fails closed on DB error", async () => {
  const db = new FakeDb();
  db.throwOnFirst = true;
  assert.equal(await hasActiveTrainingConsent({ DB: db }, "uk_a"), false);
});

// ─── Route ──────────────────────────────────────────────────────────────────

function getConsent(app, env, userKey) {
  return app.fetch(
    new Request(`http://localhost/workspace/training-consent?userKey=${userKey}`),
    env,
  );
}
function postConsent(app, env, body) {
  return app.fetch(
    new Request("http://localhost/workspace/training-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

test("GET without userKey → 400", async () => {
  const app = createWorkspaceTrainingConsentRoutes();
  const res = await getConsent(app, { DB: new FakeDb() }, "");
  assert.equal(res.status, 400);
});

test("GET default → consented false, active false, currentVersion present", async () => {
  const app = createWorkspaceTrainingConsentRoutes();
  const res = await getConsent(app, { DB: new FakeDb() }, "uk_a");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.consented, false);
  assert.equal(body.active, false);
  assert.equal(body.currentVersion, TRAINING_CONSENT_VERSION);
  assert.equal(body.storageConfigured, false);
});

test("POST consented=true then GET → active true; storageConfigured reflects EVIDENCE", async () => {
  const env = { DB: new FakeDb(), EVIDENCE: {} };
  const app = createWorkspaceTrainingConsentRoutes();
  const post = await postConsent(app, env, { userKey: "uk_a", consented: true });
  assert.equal((await post.json()).active, true);
  const get = await getConsent(app, env, "uk_a");
  const body = await get.json();
  assert.equal(body.active, true);
  assert.equal(body.storageConfigured, true);
});

test("POST without boolean consented → 400", async () => {
  const app = createWorkspaceTrainingConsentRoutes();
  const res = await postConsent(app, { DB: new FakeDb() }, { userKey: "uk_a", consented: "yes" });
  assert.equal(res.status, 400);
});

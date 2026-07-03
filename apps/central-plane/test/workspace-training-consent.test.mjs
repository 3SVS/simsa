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

/** Minimal D1 fake: one table (workspace_training_consent) keyed by user_key. */
class FakeDb {
  constructor() {
    this.rows = new Map(); // user_key -> row
    this.throwOnFirst = false;
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
        if (/^INSERT/i.test(this.sql.trim())) {
          const [user_key, consented, consent_version, created_at, updated_at] = this.binds;
          db.rows.set(user_key, { user_key, consented, consent_version, created_at, updated_at });
        } else if (/^UPDATE/i.test(this.sql.trim())) {
          const [consented, consent_version, updated_at, user_key] = this.binds;
          const existing = db.rows.get(user_key) ?? { user_key, created_at: updated_at };
          db.rows.set(user_key, { ...existing, consented, consent_version, updated_at });
        }
        return { success: true };
      },
    };
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

test("opt-out clears the version and deactivates", async () => {
  const env = { DB: new FakeDb() };
  await setTrainingConsent(env, "uk_a", true);
  const c = await setTrainingConsent(env, "uk_a", false);
  assert.equal(c.consented, false);
  assert.equal(c.consentVersion, null);
  assert.equal(await hasActiveTrainingConsent(env, "uk_a"), false);
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

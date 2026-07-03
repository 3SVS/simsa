/**
 * STEP 2 collection layer — built_with + entry_path persist on the project and
 * round-trip out. Proves the D1 collection half; the record→R2 half is proven in
 * training-store.test ("envelope values actually flow into the stored record").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertProject, getProject } from "../dist/workspace/db.js";
import { normalizeBuiltWith } from "../dist/workspace/built-with.js";
import { captureTrainingRecord } from "../dist/workspace/training-store.js";
import { TRAINING_CONSENT_VERSION } from "../dist/workspace/training-consent-db.js";

/** Minimal D1 fake: one workspace_projects row store keyed by id. */
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        _sql: sql,
        _b: [],
        bind(...a) { this._b = a; return this; },
        async run() {
          if (/INSERT INTO workspace_projects/.test(this._sql)) {
            const [id, user_key, title, idea, understood_json, product_spec_json, items_json, built_with_json, entry_path] = this._b;
            rows.set(id, { id, user_key, title, idea, understood_json, product_spec_json, items_json, built_with_json, entry_path,
              created_at: "t", updated_at: "t" });
          }
          return { success: true };
        },
        async first() {
          if (/FROM workspace_projects/.test(this._sql)) return rows.get(this._b[0]) ?? null;
          return null;
        },
      };
    },
  };
}

test("built_with + entry_path persist on upsert and round-trip via getProject", async () => {
  const env = { DB: fakeDb() };
  const bw = normalizeBuiltWith({ tools: ["v0", "cursor"], primary: "v0" });
  const id = await upsertProject(env, {
    id: "proj_x", userKey: "uk1", title: "T", idea: "i",
    understood: {}, productSpec: {}, items: [],
    builtWith: bw, entryPath: "idea",
  });
  const proj = await getProject(env, id);
  assert.deepEqual(proj.builtWith, { tools: ["v0", "cursor"], primary: "v0" });
  assert.equal(proj.entryPath, "idea");
});

test("absent built_with/entry_path → null (stable), not crash", async () => {
  const env = { DB: fakeDb() };
  const id = await upsertProject(env, {
    id: "proj_y", userKey: "uk1", title: "T", idea: "i", understood: {}, productSpec: {}, items: [],
  });
  const proj = await getProject(env, id);
  assert.equal(proj.builtWith, null);
  assert.equal(proj.entryPath, null);
});

// STEP 2 수집≠저장 (storage layer): a project's built_with + entry_path, once
// sourced into the envelope, actually land in the R2 JSON — not just the UI/DB.
test("project built_with + entry_path reach the stored R2 record", async () => {
  const consentDb = {
    prepare() {
      return { bind() { return this; }, async first() {
        return { user_key: "uk1", consented: 1, consent_version: TRAINING_CONSENT_VERSION, created_at: "t", updated_at: "t" };
      } };
    },
  };
  const puts = [];
  const env = { DB: consentDb, EVIDENCE: { async put(key, value) { puts.push({ key, value }); } } };
  const projectBuiltWith = normalizeBuiltWith({ tools: ["lovable"], primary: "lovable" });
  await captureTrainingRecord(env, {
    userKey: "uk1", projectId: "p1", reviewRunId: "run_1", repoFullName: "o/r", prNumber: 1,
    productSpec: {}, items: [], prFiles: [],
    review: { source: "llm", summary: { passed: 0, failed: 0, inconclusive: 0, needsDecision: 0 }, results: [] },
    finalStatus: "passed",
    envelope: { region: "US", builtWith: projectBuiltWith, entryPath: "code" },
    now: "2026-07-04T00:00:00.000Z", subjectHash: "hash",
  });
  const rec = JSON.parse(puts[0].value);
  assert.deepEqual(rec.built_with, { tools: ["lovable"], primary: "lovable" });
  assert.equal(rec.entry_path, "code");
  assert.equal(puts[0].key, "events/US/2026/07/04/run_1.json");
});

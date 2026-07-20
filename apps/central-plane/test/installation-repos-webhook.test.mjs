/**
 * installation_repositories webhook — data-layer tests for
 * applyInstallationRepoChange (db/saas.ts). Pins the merge semantics:
 *   - added ids merge into the stored selected_repo_ids
 *   - removed ids drop out
 *   - repository_selection = "all" normalizes the list to NULL
 *   - missing row → false (caller rebuilds via upsertInstallation)
 *   - corrupt stored JSON → rebuilt from the delta alone
 *
 * Why this exists: the webhook ignored this event entirely, so
 * selected_repo_ids stayed frozen at install time (2026-07-20 실측 —
 * a row still showed the single repo picked back in May).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInstallationRepoChange } from "../dist/db/saas.js";

function makeMockDb({ rows = [] } = {}) {
  const state = { rows: rows.map((r) => ({ ...r })) };
  return {
    state,
    prepare(sql) {
      let bound = [];
      const handlers = {
        async first() {
          if (/SELECT selected_repo_ids FROM gh_app_installations/.test(sql)) {
            const row = state.rows.find(
              (r) => r.installation_id === bound[0] && !r.removed_at,
            );
            return row ? { selected_repo_ids: row.selected_repo_ids } : null;
          }
          return null;
        },
        async run() {
          if (/UPDATE gh_app_installations SET repo_selection/.test(sql)) {
            const [sel, selectedJson, id] = bound;
            const row = state.rows.find((r) => r.installation_id === id);
            if (row) {
              row.repo_selection = sel;
              row.selected_repo_ids = selectedJson;
            }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return {
        bind(...args) {
          bound = args;
          return handlers;
        },
      };
    },
  };
}

const env = (db) => ({ DB: db });

const ROW = {
  installation_id: 129987651,
  account_login: "someone",
  repo_selection: "selected",
  selected_repo_ids: "[1188037554]",
  removed_at: null,
};

test("added repo ids merge into the stored list", async () => {
  const db = makeMockDb({ rows: [ROW] });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 129987651,
    repoSelection: "selected",
    addedRepoIds: [1305786142],
    removedRepoIds: [],
  });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(db.state.rows[0].selected_repo_ids), [1188037554, 1305786142]);
  assert.equal(db.state.rows[0].repo_selection, "selected");
});

test("removed repo ids drop out of the stored list", async () => {
  const db = makeMockDb({
    rows: [{ ...ROW, selected_repo_ids: "[1188037554,1305786142]" }],
  });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 129987651,
    repoSelection: "selected",
    addedRepoIds: [],
    removedRepoIds: [1188037554],
  });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(db.state.rows[0].selected_repo_ids), [1305786142]);
});

test("re-added id does not duplicate", async () => {
  const db = makeMockDb({ rows: [ROW] });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 129987651,
    repoSelection: "selected",
    addedRepoIds: [1188037554],
    removedRepoIds: [],
  });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(db.state.rows[0].selected_repo_ids), [1188037554]);
});

test('selection flipped to "all" normalizes the list to NULL', async () => {
  const db = makeMockDb({ rows: [ROW] });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 129987651,
    repoSelection: "all",
    addedRepoIds: [99, 100],
    removedRepoIds: [],
  });
  assert.equal(ok, true);
  assert.equal(db.state.rows[0].selected_repo_ids, null);
  assert.equal(db.state.rows[0].repo_selection, "all");
});

test("missing installation row → false, nothing written", async () => {
  const db = makeMockDb({ rows: [] });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 42,
    repoSelection: "selected",
    addedRepoIds: [1],
    removedRepoIds: [],
  });
  assert.equal(ok, false);
  assert.equal(db.state.rows.length, 0);
});

test("removed_at row is treated as missing", async () => {
  const db = makeMockDb({ rows: [{ ...ROW, removed_at: "2026-07-01T00:00:00Z" }] });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 129987651,
    repoSelection: "selected",
    addedRepoIds: [1],
    removedRepoIds: [],
  });
  assert.equal(ok, false);
});

test("corrupt stored JSON → list rebuilt from the delta alone", async () => {
  const db = makeMockDb({ rows: [{ ...ROW, selected_repo_ids: "not-json{" }] });
  const ok = await applyInstallationRepoChange(env(db), {
    installationId: 129987651,
    repoSelection: "selected",
    addedRepoIds: [7, 8],
    removedRepoIds: [],
  });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(db.state.rows[0].selected_repo_ids), [7, 8]);
});

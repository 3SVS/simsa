import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteProject } from "../dist/workspace/db.js";

// A project delete must cascade every PROJECT-scoped row + its R2 evidence, and
// must NEVER touch USER-scoped data shared across the user's other projects
// (GitHub auth, credit wallet/ledger, oauth states, notification settings).
// This test pins that boundary at the SQL level so a future table addition
// can't silently widen or narrow the blast radius.

function makeEnv() {
  const deletedR2 = [];
  const batched = [];
  const sequence = [];
  const db = {
    prepare(sql) {
      return {
        _sql: sql,
        _args: [],
        bind(...args) {
          this._args = args;
          return this;
        },
        async all() {
          if (/FROM project_sources/.test(sql)) {
            // reference != 'pending' is enforced in SQL; the mock returns the
            // already-filtered row set.
            return { results: [{ reference: "doc-key-1" }] };
          }
          if (/FROM workspace_visual_checks/.test(sql)) {
            return { results: [{ evidence_keys_json: JSON.stringify(["vis-1", "vis-2"]) }] };
          }
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
        async first() {
          return null;
        },
      };
    },
    async batch(stmts) {
      for (const s of stmts) batched.push(s._sql);
      sequence.push("batch");
      return stmts.map(() => ({ success: true }));
    },
  };
  const EVIDENCE = {
    async delete(key) {
      sequence.push("r2");
      deletedR2.push(key);
    },
  };
  return { env: { DB: db, EVIDENCE }, deletedR2, batched, sequence };
}

const PROJECT_SCOPED = [
  "workspace_items",
  "workspace_check_runs",
  "workspace_fix_suggestions",
  "builder_pack_outcomes",
  "workspace_project_repos",
  "workspace_project_pull_requests",
  "workspace_pr_review_runs",
  "workspace_pr_comments",
  "workspace_usage_events",
  "workspace_notifications",
  "workspace_agent_benchmarks",
  "workspace_agent_experiments",
  "workspace_evolution_action_packs",
  "workspace_agent_workflow_records",
  "project_sources",
  "workspace_visual_checks",
  "workspace_repair_jobs",
  "workspace_feedback",
];

const USER_SCOPED_NEVER = [
  "workspace_github_connections",
  "workspace_oauth_states",
  "workspace_credit_balances",
  "workspace_credit_ledger",
  "workspace_notification_settings",
];

describe("deleteProject — cascade boundary", () => {
  it("deletes every project-scoped table + the project row", async () => {
    const { env, batched } = makeEnv();
    await deleteProject(env, "proj_x");
    const joined = batched.join("\n");
    for (const table of PROJECT_SCOPED) {
      assert.match(joined, new RegExp(`DELETE FROM ${table}\\b`), `should delete ${table}`);
    }
    assert.match(joined, /DELETE FROM workspace_projects WHERE id = \?/, "should delete the project row");
  });

  it("deletes experiment candidates via the experiment_id subquery", async () => {
    const { env, batched } = makeEnv();
    await deleteProject(env, "proj_x");
    const joined = batched.join("\n");
    assert.match(
      joined,
      /DELETE FROM workspace_agent_experiment_candidates[\s\S]*SELECT id FROM workspace_agent_experiments WHERE project_id = \?/,
      "candidates must be deleted through their parent experiments",
    );
  });

  it("NEVER touches user-scoped tables (would break other projects)", async () => {
    const { env, batched } = makeEnv();
    await deleteProject(env, "proj_x");
    const joined = batched.join("\n");
    for (const table of USER_SCOPED_NEVER) {
      assert.doesNotMatch(joined, new RegExp(`DELETE FROM ${table}\\b`), `must NOT delete ${table}`);
    }
  });

  it("removes R2 evidence — uploaded documents and visual-check shots", async () => {
    const { env, deletedR2 } = makeEnv();
    await deleteProject(env, "proj_x");
    assert.deepEqual([...deletedR2].sort(), ["doc-key-1", "vis-1", "vis-2"].sort());
  });

  it("commits the D1 transaction BEFORE deleting R2 (no dangling references on partial failure)", async () => {
    const { env, sequence } = makeEnv();
    await deleteProject(env, "proj_x");
    const firstBatch = sequence.indexOf("batch");
    const firstR2 = sequence.indexOf("r2");
    assert.ok(firstBatch >= 0, "D1 batch must run");
    assert.ok(firstR2 >= 0, "R2 delete must run");
    assert.ok(firstBatch < firstR2, "D1 rows must be gone before their R2 objects are deleted");
  });

  it("tolerates a missing EVIDENCE binding (R2 cleanup is best-effort)", async () => {
    const { env } = makeEnv();
    delete env.EVIDENCE;
    await assert.doesNotReject(deleteProject(env, "proj_x"));
  });
});

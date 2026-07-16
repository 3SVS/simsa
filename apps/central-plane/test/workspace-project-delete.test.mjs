import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteProject } from "../dist/workspace/db.js";

// A project delete must cascade every PROJECT-scoped row + its R2 evidence, and
// must NEVER touch USER-scoped data shared across the user's other projects
// (GitHub auth, credit wallet/ledger, oauth states, notification settings).
// This test pins that boundary at the SQL level so a future table addition
// can't silently widen or narrow the blast radius.

const USER = "uk_owner";
const PROJECT = "proj_x";

// The R2 bucket as it ACTUALLY looks after uploads: evidence lives under the
// full `checks/{userKey}/{projectId}/{runId}/{name}` key, while D1 records only
// the relative `name`. An earlier version of this test mocked evidence_keys_json
// as ["vis-1","vis-2"] — values shaped like full keys, which no upload path ever
// writes — and then asserted those were the keys deleted. That mock encoded the
// bug as the spec: real deletes were calling R2.delete("screenshots/step-01.png"),
// which silently no-ops, so every screenshot survived every project delete.
const BUCKET = {
  [`docs/${USER}/${PROJECT}/src_1/spec.pdf`]: 1,
  [`checks/${USER}/${PROJECT}/vc_1/screenshots/step-00-initial.png`]: 1,
  [`checks/${USER}/${PROJECT}/vc_1/screenshots/step-01.png`]: 1,
  [`checks/${USER}/${PROJECT}/vc_1/video/flow.webm`]: 1,
  [`checks/${USER}/${PROJECT}/vc_2/screenshots/step-00-initial.png`]: 1,
  // An object whose D1 append failed after put — no manifest knows about it.
  [`checks/${USER}/${PROJECT}/vc_3/screenshots/orphan.png`]: 1,
  // Must survive: another project of the same user, and another user entirely.
  [`checks/${USER}/proj_other/vc_9/screenshots/step-01.png`]: 1,
  [`checks/uk_stranger/${PROJECT}/vc_9/screenshots/step-01.png`]: 1,
};

function makeEnv({ bucket = { ...BUCKET }, listLimit = 1000 } = {}) {
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
            // already-filtered row set. Documents store the FULL R2 key.
            return { results: [{ reference: `docs/${USER}/${PROJECT}/src_1/spec.pdf` }] };
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
    // Paginates like the real thing: R2 caps a page at 1000 and hands back a
    // cursor. listLimit is squeezed in one test to prove the cursor is followed.
    async list({ prefix, cursor }) {
      sequence.push("r2list");
      const all = Object.keys(bucket)
        .filter((k) => k.startsWith(prefix))
        .sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + listLimit);
      const end = start + page.length;
      const truncated = end < all.length;
      return {
        objects: page.map((key) => ({ key })),
        truncated,
        ...(truncated ? { cursor: String(end) } : {}),
      };
    },
    async delete(key) {
      sequence.push("r2");
      deletedR2.push(key);
      delete bucket[key];
    },
  };
  return { env: { DB: db, EVIDENCE }, deletedR2, batched, sequence, bucket };
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
    await deleteProject(env, PROJECT, USER);
    const joined = batched.join("\n");
    for (const table of PROJECT_SCOPED) {
      assert.match(joined, new RegExp(`DELETE FROM ${table}\\b`), `should delete ${table}`);
    }
    assert.match(joined, /DELETE FROM workspace_projects WHERE id = \?/, "should delete the project row");
  });

  it("deletes experiment candidates via the experiment_id subquery", async () => {
    const { env, batched } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    const joined = batched.join("\n");
    assert.match(
      joined,
      /DELETE FROM workspace_agent_experiment_candidates[\s\S]*SELECT id FROM workspace_agent_experiments WHERE project_id = \?/,
      "candidates must be deleted through their parent experiments",
    );
  });

  it("NEVER touches user-scoped tables (would break other projects)", async () => {
    const { env, batched } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    const joined = batched.join("\n");
    for (const table of USER_SCOPED_NEVER) {
      assert.doesNotMatch(joined, new RegExp(`DELETE FROM ${table}\\b`), `must NOT delete ${table}`);
    }
  });

  it("removes R2 evidence — uploaded documents and visual-check shots", async () => {
    const { env, deletedR2 } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    assert.deepEqual(
      [...deletedR2].sort(),
      [
        `checks/${USER}/${PROJECT}/vc_1/screenshots/step-00-initial.png`,
        `checks/${USER}/${PROJECT}/vc_1/screenshots/step-01.png`,
        `checks/${USER}/${PROJECT}/vc_1/video/flow.webm`,
        `checks/${USER}/${PROJECT}/vc_2/screenshots/step-00-initial.png`,
        `checks/${USER}/${PROJECT}/vc_3/screenshots/orphan.png`,
        `docs/${USER}/${PROJECT}/src_1/spec.pdf`,
      ].sort(),
    );
  });

  // The regression this file previously certified as correct.
  it("deletes visual-check evidence by its REAL key, not the relative name D1 stores", async () => {
    const { env, deletedR2, bucket } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    for (const k of deletedR2) {
      assert.ok(
        k.startsWith("checks/") || k.startsWith("docs/"),
        `deleted key must be a full R2 key, got "${k}" (a relative name deletes nothing)`,
      );
    }
    const leftovers = Object.keys(bucket).filter((k) => k.includes(`/${PROJECT}/`) && k.startsWith(`checks/${USER}/`));
    assert.deepEqual(leftovers, [], "no evidence for this project may survive the delete");
  });

  it("sweeps an object whose D1 append failed after the upload landed", async () => {
    const { env, deletedR2 } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    assert.ok(
      deletedR2.includes(`checks/${USER}/${PROJECT}/vc_3/screenshots/orphan.png`),
      "prefix sweep must reach objects no manifest records",
    );
  });

  it("never reaches another project of the same user, or another user's bucket space", async () => {
    const { env, bucket } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    assert.ok(bucket[`checks/${USER}/proj_other/vc_9/screenshots/step-01.png`], "other project must survive");
    assert.ok(bucket[`checks/uk_stranger/${PROJECT}/vc_9/screenshots/step-01.png`], "other user must survive");
  });

  // The whole safety of a prefix sweep rests on the trailing "/". Without it,
  // deleting proj_x would also wipe proj_x2 and proj_x_backup — an irreversible
  // cross-project data loss, and the objects are gone before anyone notices.
  // Nothing else in the suite would fail if the slash were dropped.
  it("a project id that is a PREFIX of another id must not drag the other one's evidence with it", async () => {
    const bucket = {
      [`checks/${USER}/proj_x/vc_1/screenshots/a.png`]: 1,
      [`checks/${USER}/proj_x2/vc_1/screenshots/a.png`]: 1,
      [`checks/${USER}/proj_x_backup/vc_1/screenshots/a.png`]: 1,
      [`docs/${USER}/proj_x2/src_1/spec.pdf`]: 1,
    };
    const { env } = makeEnv({ bucket });
    await deleteProject(env, "proj_x", USER);
    assert.deepEqual(
      Object.keys(bucket).sort(),
      [
        `checks/${USER}/proj_x2/vc_1/screenshots/a.png`,
        `checks/${USER}/proj_x_backup/vc_1/screenshots/a.png`,
        `docs/${USER}/proj_x2/src_1/spec.pdf`,
      ].sort(),
      "only proj_x's own object may be deleted — ids that merely share its prefix must survive",
    );
  });

  // Same hazard on the userKey segment.
  it("a userKey that is a prefix of another userKey must not reach the other user's evidence", async () => {
    const bucket = {
      [`checks/uk_a/${PROJECT}/vc_1/screenshots/a.png`]: 1,
      [`checks/uk_ab/${PROJECT}/vc_1/screenshots/a.png`]: 1,
    };
    const { env } = makeEnv({ bucket });
    await deleteProject(env, PROJECT, "uk_a");
    assert.deepEqual(
      Object.keys(bucket),
      [`checks/uk_ab/${PROJECT}/vc_1/screenshots/a.png`],
      "uk_ab's evidence must survive uk_a's delete",
    );
  });

  it("follows the R2 list cursor — evidence past the first page is not left behind", async () => {
    // R2 caps a real page at 1000 objects; squeeze it to 2 to force pagination.
    const { env, deletedR2 } = makeEnv({ listLimit: 2 });
    await deleteProject(env, PROJECT, USER);
    assert.equal(
      deletedR2.filter((k) => k.startsWith(`checks/${USER}/${PROJECT}/`)).length,
      5,
      "all 5 check objects must be deleted across paginated list calls",
    );
  });

  it("without a userKey the prefix sweep is skipped rather than guessing a prefix", async () => {
    const { env, deletedR2 } = makeEnv();
    await deleteProject(env, PROJECT, "");
    assert.deepEqual(
      deletedR2,
      [`docs/${USER}/${PROJECT}/src_1/spec.pdf`],
      "only the D1-recorded full key is removable without a userKey",
    );
  });

  it("commits the D1 transaction BEFORE deleting R2 (no dangling references on partial failure)", async () => {
    const { env, sequence } = makeEnv();
    await deleteProject(env, PROJECT, USER);
    const firstBatch = sequence.indexOf("batch");
    const firstR2 = sequence.indexOf("r2");
    assert.ok(firstBatch >= 0, "D1 batch must run");
    assert.ok(firstR2 >= 0, "R2 delete must run");
    assert.ok(firstBatch < firstR2, "D1 rows must be gone before their R2 objects are deleted");
  });

  it("tolerates a missing EVIDENCE binding (R2 cleanup is best-effort)", async () => {
    const { env } = makeEnv();
    delete env.EVIDENCE;
    await assert.doesNotReject(deleteProject(env, PROJECT, USER));
  });
});

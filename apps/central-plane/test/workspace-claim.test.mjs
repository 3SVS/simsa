/**
 * workspace-claim.test.mjs — POST /workspace/membership/claim (the explicit
 * claim flow on the 0048 membership foundation). Session resolution is
 * injected (mock at the seam); D1 is a recording fake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceClaimRoutes } from "../dist/routes/workspace-claim.js";

class FakeDb {
  constructor({ existingWorkspace = null, changesByIndex = {} } = {}) {
    this.calls = [];
    this.existingWorkspace = existingWorkspace;
    this.changesByIndex = changesByIndex;
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
        db.calls.push({ sql: this.sql, binds: this.binds });
        return db.existingWorkspace;
      },
    };
  }
  async batch(stmts) {
    return stmts.map((s, i) => {
      this.calls.push({ sql: s.sql, binds: s.binds });
      return { success: true, meta: { changes: this.changesByIndex[i] ?? 0 } };
    });
  }
}

const sessionAs = (id) => async () => (id ? { id } : null);

function claim(app, env, { userKey, headerKey } = {}) {
  return app.fetch(
    new Request("http://localhost/workspace/membership/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(headerKey ? { "x-simsa-user-key": headerKey } : {}),
      },
      body: JSON.stringify(userKey ? { userKey } : {}),
    }),
    env,
  );
}

test("unauthenticated → 401, nothing touches the DB", async () => {
  const db = new FakeDb();
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs(null) });
  const res = await claim(app, { DB: db }, { userKey: "uk_a" });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthenticated");
  assert.equal(db.calls.length, 0);
});

test("missing userKey → 400", async () => {
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs("u1") });
  const res = await claim(app, { DB: new FakeDb() }, {});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "missing_user_key");
});

test("no DB binding → 503", async () => {
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs("u1") });
  const res = await claim(app, {}, { userKey: "uk_a" });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "db_unavailable");
});

test("fresh claim creates workspace + owner membership and assigns legacy projects", async () => {
  const db = new FakeDb({ existingWorkspace: null, changesByIndex: { 2: 3 } });
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs("u1") });
  const res = await claim(app, { DB: db }, { userKey: "uk_fresh" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyClaimed, false);
  assert.equal(body.claimedProjects, 3);
  assert.match(body.workspaceId, /^ws_[0-9a-f]{32}$/);

  // SELECT lookup + 3 batched statements, with the right binds.
  const [lookup, insWs, insMember, updProjects] = db.calls;
  assert.match(lookup.sql, /FROM workspaces WHERE legacy_user_key = \?/);
  assert.deepEqual(lookup.binds, ["uk_fresh"]);
  assert.match(insWs.sql, /INSERT INTO workspaces/);
  assert.equal(insWs.binds[0], body.workspaceId);
  assert.equal(insWs.binds[1], "u1");
  assert.equal(insWs.binds[2], "uk_fresh");
  assert.match(insMember.sql, /INSERT OR IGNORE INTO workspace_members/);
  assert.deepEqual(insMember.binds.slice(0, 2), [body.workspaceId, "u1"]);
  assert.match(updProjects.sql, /UPDATE workspace_projects SET workspace_id = \? WHERE user_key = \? AND workspace_id IS NULL/);
  assert.deepEqual(updProjects.binds, [body.workspaceId, "uk_fresh"]);
});

test("re-claim by the same user is idempotent and picks up new legacy projects", async () => {
  const db = new FakeDb({
    existingWorkspace: { id: "ws_mine", creator: "u1" },
    changesByIndex: { 1: 2 },
  });
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs("u1") });
  const res = await claim(app, { DB: db }, { userKey: "uk_mine" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyClaimed, true);
  assert.equal(body.workspaceId, "ws_mine");
  assert.equal(body.claimedProjects, 2);
});

test("userKey claimed by another account → 409 with no details and no writes", async () => {
  const db = new FakeDb({ existingWorkspace: { id: "ws_theirs", creator: "someone-else" } });
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs("u1") });
  const res = await claim(app, { DB: db }, { userKey: "uk_taken" });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "claimed_by_other");
  assert.ok(!JSON.stringify(body).includes("someone-else"), "must not leak the other account");
  assert.equal(db.calls.length, 1, "only the lookup ran — no batch writes");
});

test("header x-simsa-user-key wins over the body key", async () => {
  const db = new FakeDb({ existingWorkspace: null });
  const app = createWorkspaceClaimRoutes({ resolveSession: sessionAs("u1") });
  const res = await claim(app, { DB: db }, { userKey: "uk_body", headerKey: "uk_header" });
  assert.equal(res.status, 200);
  assert.deepEqual(db.calls[0].binds, ["uk_header"]);
});

/**
 * Sprint E4 (scaffold) — prompt-variants admin route tests.
 *
 * Verifies CRUD: register (incl. UNIQUE conflict 409), list with
 * filter, status flip, auth.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/router.js";

function makeMockDb({ variants = [] } = {}) {
  const state = { variants: new Map(variants.map((v) => [v.id, { ...v }])) };
  return {
    state,
    prepare(sql) {
      let bound = [];
      const handlers = {
        async run() {
          if (/INSERT INTO prompt_variants/.test(sql)) {
            const [id, agent_id, variant_id, is_baseline, _status, description, system_prompt, created_at] = bound;
            for (const v of state.variants.values()) {
              if (v.agent_id === agent_id && v.variant_id === variant_id) {
                throw new Error("UNIQUE constraint failed");
              }
            }
            state.variants.set(id, {
              id, agent_id, variant_id, is_baseline, status: "inactive",
              description, system_prompt, created_at,
              promoted_at: null, archived_at: null, removed_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE prompt_variants SET status = \?, promoted_at = \?/.test(sql)) {
            const [status, promoted_at, id] = bound;
            const row = state.variants.get(id);
            if (!row || row.removed_at !== null) return { success: true, meta: { changes: 0 } };
            row.status = status;
            row.promoted_at = promoted_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE prompt_variants SET status = \?, archived_at = \?/.test(sql)) {
            const [status, archived_at, id] = bound;
            const row = state.variants.get(id);
            if (!row || row.removed_at !== null) return { success: true, meta: { changes: 0 } };
            row.status = status;
            row.archived_at = archived_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE prompt_variants SET status = \? WHERE id = \?/.test(sql)) {
            const [status, id] = bound;
            const row = state.variants.get(id);
            if (!row || row.removed_at !== null) return { success: true, meta: { changes: 0 } };
            row.status = status;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async all() {
          if (/FROM prompt_variants/.test(sql)) {
            // Filter by agent_id and/or status if bound.
            // SQL builds dynamic conditions; we'll match by checking the SQL text.
            let rows = [...state.variants.values()].filter((v) => v.removed_at === null);
            // If bound has a value, the first AND condition is agent_id, and possibly status next.
            let argIdx = 0;
            if (sql.includes("agent_id = ?")) {
              const wantAgent = bound[argIdx++];
              rows = rows.filter((v) => v.agent_id === wantAgent);
            }
            if (sql.includes("status = ?")) {
              const wantStatus = bound[argIdx++];
              rows = rows.filter((v) => v.status === wantStatus);
            }
            return { results: rows };
          }
          return { results: [] };
        },
      };
      return {
        bind: (...args) => {
          bound = args;
          return handlers;
        },
        first: handlers.first,
        all: handlers.all,
        run: handlers.run,
      };
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeMockDb(),
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: "e4-token",
    ...overrides,
  };
}

test("POST /admin/prompt-variants: 401 with bad token", async () => {
  const app = createApp();
  const env = makeEnv();
  const res = await app.fetch(
    new Request("http://localhost/admin/prompt-variants", {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    env,
  );
  assert.equal(res.status, 401);
});

test("POST /admin/prompt-variants: 400 on missing fields", async () => {
  const app = createApp();
  const env = makeEnv();
  const res = await app.fetch(
    new Request("http://localhost/admin/prompt-variants", {
      method: "POST",
      headers: { authorization: "Bearer e4-token", "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "claude" }),
    }),
    env,
  );
  assert.equal(res.status, 400);
});

test("POST /admin/prompt-variants: 201 on register", async () => {
  const app = createApp();
  const env = makeEnv();
  const res = await app.fetch(
    new Request("http://localhost/admin/prompt-variants", {
      method: "POST",
      headers: { authorization: "Bearer e4-token", "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "claude",
        variant_id: "directive-v2",
        description: "Switch to single-paragraph directive",
        system_prompt: "You are a code reviewer. Be terse.",
      }),
    }),
    env,
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.id.startsWith("pv_"));
  assert.equal(env.DB.state.variants.size, 1);
});

test("POST /admin/prompt-variants: 409 on duplicate (agent_id, variant_id)", async () => {
  const app = createApp();
  const env = makeEnv();
  const make = () =>
    app.fetch(
      new Request("http://localhost/admin/prompt-variants", {
        method: "POST",
        headers: { authorization: "Bearer e4-token", "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "claude",
          variant_id: "v1",
          system_prompt: "p",
        }),
      }),
      env,
    );
  const r1 = await make();
  assert.equal(r1.status, 201);
  const r2 = await make();
  assert.equal(r2.status, 409);
});

test("GET /admin/prompt-variants: filters by agent_id + status", async () => {
  const app = createApp();
  const env = makeEnv({
    DB: makeMockDb({
      variants: [
        { id: "pv1", agent_id: "claude", variant_id: "v1", is_baseline: 1, status: "promoted", description: null, system_prompt: "x", created_at: "2026-05-09T00:00:00Z", promoted_at: "2026-05-09T00:00:00Z", archived_at: null, removed_at: null },
        { id: "pv2", agent_id: "claude", variant_id: "v2", is_baseline: 0, status: "inactive", description: null, system_prompt: "y", created_at: "2026-05-10T00:00:00Z", promoted_at: null, archived_at: null, removed_at: null },
        { id: "pv3", agent_id: "openai", variant_id: "v1", is_baseline: 1, status: "promoted", description: null, system_prompt: "z", created_at: "2026-05-09T00:00:00Z", promoted_at: "2026-05-09T00:00:00Z", archived_at: null, removed_at: null },
      ],
    }),
  });
  const res = await app.fetch(
    new Request("http://localhost/admin/prompt-variants?agent_id=claude&status=promoted", {
      headers: { authorization: "Bearer e4-token" },
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.variants[0].id, "pv1");
});

test("POST /admin/prompt-variants/:id/status: flips status", async () => {
  const app = createApp();
  const env = makeEnv({
    DB: makeMockDb({
      variants: [
        { id: "pv1", agent_id: "claude", variant_id: "v1", is_baseline: 0, status: "inactive", system_prompt: "x", created_at: "2026-05-10T00:00:00Z", promoted_at: null, archived_at: null, removed_at: null },
      ],
    }),
  });
  const res = await app.fetch(
    new Request("http://localhost/admin/prompt-variants/pv1/status", {
      method: "POST",
      headers: { authorization: "Bearer e4-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "shadow" }),
    }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(env.DB.state.variants.get("pv1").status, "shadow");
});

test("POST /admin/prompt-variants/:id/status: 400 on invalid status", async () => {
  const app = createApp();
  const env = makeEnv();
  const res = await app.fetch(
    new Request("http://localhost/admin/prompt-variants/pv_x/status", {
      method: "POST",
      headers: { authorization: "Bearer e4-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "bogus" }),
    }),
    env,
  );
  assert.equal(res.status, 400);
});

/**
 * Sprint E5 (shadow scaffold) — agent-spawner + spawned-agents route tests.
 *
 * Verifies the threshold gate, idempotent UNIQUE on agent_id, status
 * flow, and route auth.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/router.js";
import { runAgentSpawner } from "../dist/agent-spawner.js";

function makeMockDb({ feedback = [], spawned = [] } = {}) {
  const state = {
    feedback: [...feedback],
    spawned: new Map(spawned.map((s) => [s.id, { ...s }])),
  };
  return {
    state,
    prepare(sql) {
      let bound = [];
      const handlers = {
        async first() {
          if (/SELECT 1 as n FROM spawned_agents WHERE agent_id/.test(sql)) {
            for (const v of state.spawned.values()) {
              if (v.agent_id === bound[0] && v.removed_at === null) return { n: 1 };
            }
            return null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO spawned_agents/.test(sql)) {
            const [
              id, agent_id, display_name, domain_hint, emergence_signal,
              trigger_feedback_ids, system_prompt, base_agent_id, _status, spawned_at,
            ] = bound;
            state.spawned.set(id, {
              id, agent_id, display_name, domain_hint, emergence_signal,
              trigger_feedback_ids, system_prompt, base_agent_id,
              status: "shadow", spawned_at,
              promoted_at: null, archived_at: null, removed_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE spawned_agents SET status = \?, promoted_at/.test(sql)) {
            const [status, promoted_at, id] = bound;
            const row = state.spawned.get(id);
            if (!row || row.removed_at !== null) return { success: true, meta: { changes: 0 } };
            row.status = status;
            row.promoted_at = promoted_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE spawned_agents SET status = \?, archived_at/.test(sql)) {
            const [status, archived_at, id] = bound;
            const row = state.spawned.get(id);
            if (!row || row.removed_at !== null) return { success: true, meta: { changes: 0 } };
            row.status = status;
            row.archived_at = archived_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE spawned_agents SET status = \? WHERE id/.test(sql)) {
            const [status, id] = bound;
            const row = state.spawned.get(id);
            if (!row || row.removed_at !== null) return { success: true, meta: { changes: 0 } };
            row.status = status;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async all() {
          if (/FROM user_feedback/.test(sql)) {
            const cutoff = bound[0];
            const rows = state.feedback.filter(
              (r) =>
                r.removed_at === null &&
                r.status === "classified" &&
                r.category === "other" &&
                r.created_at >= cutoff,
            );
            return { results: rows };
          }
          if (/FROM spawned_agents/.test(sql)) {
            let rows = [...state.spawned.values()].filter((s) => s.removed_at === null);
            if (sql.includes("AND status = ?")) {
              rows = rows.filter((s) => s.status === bound[0]);
            }
            rows.sort((a, b) => (a.spawned_at < b.spawned_at ? 1 : -1));
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
    ANTHROPIC_API_KEY: "test-key",
    INTERNAL_CALLBACK_TOKEN: "e5-token",
    ...overrides,
  };
}

function withFetchStub(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function haikuOk(spec) {
  return jsonResponse({
    content: [{ type: "text", text: JSON.stringify(spec) }],
  });
}

function makeFeedback(overrides) {
  return {
    id: "fb_x",
    domain: "code",
    status: "classified",
    category: "other",
    what_user_wanted: "want",
    what_we_produced: "produced",
    reasoning: null,
    created_at: new Date().toISOString(),
    removed_at: null,
    ...overrides,
  };
}

// --- spawner tests --------------------------------------------------------

test("spawner: <3 'other' rows → no spawn, reason=below_threshold", async () => {
  const env = makeEnv({
    DB: makeMockDb({ feedback: [makeFeedback({ id: "fb1" })] }),
  });
  const result = await withFetchStub(
    () => {
      throw new Error("haiku must NOT be called below threshold");
    },
    () => runAgentSpawner(env),
  );
  assert.equal(result.spawn_attempted, false);
  assert.equal(result.reason, "below_threshold");
});

test("spawner: ≥3 'other' rows + Haiku spawn=true → row inserted with status='shadow'", async () => {
  const env = makeEnv({
    DB: makeMockDb({
      feedback: [
        makeFeedback({ id: "fb1", what_user_wanted: "review my K8s deployment.yaml" }),
        makeFeedback({ id: "fb2", what_user_wanted: "k8s manifest validation" }),
        makeFeedback({ id: "fb3", what_user_wanted: "kubernetes resource limits check" }),
      ],
    }),
  });
  const result = await withFetchStub(
    () => haikuOk({
      spawn: true,
      agent_id: "k8s-manifest",
      display_name: "K8s Manifest",
      domain_hint: "Kubernetes manifest reviews",
      base_agent_id: "claude",
      emergence_signal: "3 feedback rows about K8s manifest reviews",
      system_prompt: "You are a senior K8s reviewer...",
    }),
    () => runAgentSpawner(env),
  );
  assert.equal(result.spawn_succeeded, true);
  assert.equal(result.spawned_agent_id, "k8s-manifest");
  assert.equal(env.DB.state.spawned.size, 1);
  const row = [...env.DB.state.spawned.values()][0];
  assert.equal(row.status, "shadow");
  assert.equal(row.agent_id, "k8s-manifest");
});

test("spawner: Haiku says spawn=false → no row inserted", async () => {
  const env = makeEnv({
    DB: makeMockDb({
      feedback: [
        makeFeedback({ id: "fb1" }),
        makeFeedback({ id: "fb2" }),
        makeFeedback({ id: "fb3" }),
      ],
    }),
  });
  const result = await withFetchStub(
    () => haikuOk({ spawn: false }),
    () => runAgentSpawner(env),
  );
  assert.equal(result.spawn_succeeded, false);
  assert.equal(result.reason, "spawn_declined_by_haiku");
  assert.equal(env.DB.state.spawned.size, 0);
});

test("spawner: agent_id already exists → skip insertion, reason=agent_id_already_exists", async () => {
  const env = makeEnv({
    DB: makeMockDb({
      feedback: [
        makeFeedback({ id: "fb1" }),
        makeFeedback({ id: "fb2" }),
        makeFeedback({ id: "fb3" }),
      ],
      spawned: [
        {
          id: "sa_existing",
          agent_id: "k8s-manifest",
          display_name: "K8s Manifest",
          domain_hint: "K8s",
          emergence_signal: null,
          base_agent_id: null,
          status: "shadow",
          spawned_at: "2026-04-01T00:00:00Z",
          promoted_at: null,
          archived_at: null,
          removed_at: null,
          system_prompt: "x",
          trigger_feedback_ids: "[]",
        },
      ],
    }),
  });
  const result = await withFetchStub(
    () => haikuOk({
      spawn: true,
      agent_id: "k8s-manifest",
      display_name: "K8s",
      domain_hint: "k8s",
      system_prompt: "x",
    }),
    () => runAgentSpawner(env),
  );
  assert.equal(result.reason, "agent_id_already_exists");
  assert.equal(env.DB.state.spawned.size, 1, "no new row created");
});

// --- route tests ----------------------------------------------------------

test("GET /admin/spawned-agents: 401 with bad token", async () => {
  const app = createApp();
  const env = makeEnv();
  const res = await app.fetch(
    new Request("http://localhost/admin/spawned-agents", {
      headers: { authorization: "Bearer wrong" },
    }),
    env,
  );
  assert.equal(res.status, 401);
});

test("GET /admin/spawned-agents?status=shadow: returns shadow rows", async () => {
  const app = createApp();
  const env = makeEnv({
    DB: makeMockDb({
      spawned: [
        {
          id: "sa_1",
          agent_id: "k8s",
          display_name: "K8s",
          domain_hint: "K8s manifests",
          status: "shadow",
          spawned_at: "2026-05-09T00:00:00Z",
          emergence_signal: null,
          base_agent_id: null,
          promoted_at: null,
          archived_at: null,
          removed_at: null,
          trigger_feedback_ids: "[]",
          system_prompt: "x",
        },
        {
          id: "sa_2",
          agent_id: "rust",
          display_name: "Rust",
          domain_hint: "Rust borrow checker reviews",
          status: "promoted",
          spawned_at: "2026-04-09T00:00:00Z",
          emergence_signal: null,
          base_agent_id: null,
          promoted_at: "2026-05-01T00:00:00Z",
          archived_at: null,
          removed_at: null,
          trigger_feedback_ids: "[]",
          system_prompt: "x",
        },
      ],
    }),
  });
  const res = await app.fetch(
    new Request("http://localhost/admin/spawned-agents?status=shadow", {
      headers: { authorization: "Bearer e5-token" },
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.agents[0].agent_id, "k8s");
});

test("POST /admin/spawned-agents/:id/status: flips status", async () => {
  const app = createApp();
  const env = makeEnv({
    DB: makeMockDb({
      spawned: [
        {
          id: "sa_1",
          agent_id: "k8s",
          display_name: "K8s",
          domain_hint: "K8s",
          status: "shadow",
          spawned_at: "2026-05-09T00:00:00Z",
          emergence_signal: null,
          base_agent_id: null,
          promoted_at: null,
          archived_at: null,
          removed_at: null,
          trigger_feedback_ids: "[]",
          system_prompt: "x",
        },
      ],
    }),
  });
  const res = await app.fetch(
    new Request("http://localhost/admin/spawned-agents/sa_1/status", {
      method: "POST",
      headers: { authorization: "Bearer e5-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "promoted" }),
    }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(env.DB.state.spawned.get("sa_1").status, "promoted");
});

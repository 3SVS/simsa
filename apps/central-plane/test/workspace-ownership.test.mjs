/**
 * Security hardening — workspace ownership enforcement, upsert-IDOR guard,
 * per-userKey rate limits, and onError message hygiene.
 *
 * Covers:
 *   (a) cross-user read → 404 not_found (no existence oracle)
 *   (b) cross-user overwrite via POST /workspace/projects → 409 id_conflict
 *   (c) same-owner upsert keeps working
 *   (d) missing userKey → 400
 *   (e) per-userKey hourly rate limit trips at the threshold (429)
 *   (f) onError does not leak err.message to clients
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");
const { getOwnedProject } = await import("../dist/workspace/db.js");

// ─── D1 mock ──────────────────────────────────────────────────────────────────

function makeMockDb() {
  const state = {
    projects: new Map(),
    repos: new Map(),
    rateLimits: new Map(), // `${hash}::${hour}` → count
  };
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          if (/FROM workspace_projects/.test(sql)) {
            const [id] = bound;
            return state.projects.get(id) ?? null;
          }
          if (/FROM workspace_project_repos/.test(sql)) {
            const [pid] = bound;
            return state.repos.get(pid) ?? null;
          }
          if (/FROM workspace_rate_limit/.test(sql)) {
            const [hash, hour] = bound;
            const count = state.rateLimits.get(`${hash}::${hour}`);
            return count === undefined ? null : { count };
          }
          return null;
        },
        async run() {
          if (/INSERT INTO workspace_projects/.test(sql)) {
            const [id, user_key, title, idea, understood_json, product_spec_json, items_json, created_at, updated_at] = bound;
            const existing = state.projects.get(id);
            if (existing) {
              // Mirror the hardened ON CONFLICT … WHERE user_key match.
              if (existing.user_key === user_key) {
                state.projects.set(id, { ...existing, title, idea, understood_json, product_spec_json, items_json, updated_at });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            state.projects.set(id, { id, user_key, title, idea, understood_json, product_spec_json, items_json, created_at, updated_at });
            return { meta: { changes: 1 } };
          }
          if (/INSERT INTO workspace_rate_limit/.test(sql)) {
            const [hash, hour] = bound;
            const key = `${hash}::${hour}`;
            state.rateLimits.set(key, (state.rateLimits.get(key) ?? 0) + 1);
          }
          return { meta: { changes: 1 } };
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeMockDb(),
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: undefined,
    CONCLAVE_TOKEN_KEK: null,
    ...overrides,
  };
}

function addProject(env, id, userKey, title = "Owned Project") {
  env.DB.state.projects.set(id, {
    id, user_key: userKey, title, idea: "아이디어",
    understood_json: null, product_spec_json: "{}", items_json: "[]",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });
}

function jsonReq(url, method, body) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── getOwnedProject helper ──────────────────────────────────────────────────

describe("getOwnedProject", () => {
  it("returns the project for the owner", async () => {
    const env = makeEnv();
    addProject(env, "wsp_1", "uk_owner");
    const p = await getOwnedProject(env, "wsp_1", "uk_owner");
    assert.equal(p?.id, "wsp_1");
  });

  it("returns null for a different userKey and for missing ids", async () => {
    const env = makeEnv();
    addProject(env, "wsp_1", "uk_owner");
    assert.equal(await getOwnedProject(env, "wsp_1", "uk_attacker"), null);
    assert.equal(await getOwnedProject(env, "wsp_missing", "uk_owner"), null);
    assert.equal(await getOwnedProject(env, "wsp_1", ""), null);
  });
});

// ─── (a) cross-user read → 404, (d) missing userKey ─────────────────────────

describe("GET /workspace/projects/:id ownership", () => {
  it("owner reads own project", async () => {
    const env = makeEnv();
    addProject(env, "wsp_a", "uk_owner");
    const app = createApp();
    const resp = await app.fetch(new Request("http://localhost/workspace/projects/wsp_a?userKey=uk_owner"), env);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.project.id, "wsp_a");
  });

  it("cross-user read → 404 not_found (same body as missing project)", async () => {
    const env = makeEnv();
    addProject(env, "wsp_a", "uk_owner");
    const app = createApp();

    const crossResp = await app.fetch(new Request("http://localhost/workspace/projects/wsp_a?userKey=uk_attacker"), env);
    assert.equal(crossResp.status, 404);
    const crossBody = await crossResp.json();
    assert.deepEqual(crossBody, { ok: false, error: "not_found" });

    // No existence oracle: a missing id returns the identical response.
    const missingResp = await app.fetch(new Request("http://localhost/workspace/projects/wsp_nope?userKey=uk_attacker"), env);
    assert.equal(missingResp.status, 404);
    assert.deepEqual(await missingResp.json(), crossBody);
  });

  it("missing userKey → 400", async () => {
    const env = makeEnv();
    addProject(env, "wsp_a", "uk_owner");
    const app = createApp();
    const resp = await app.fetch(new Request("http://localhost/workspace/projects/wsp_a"), env);
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, "userKey_required");
  });
});

describe("project-scoped GitHub routes ownership", () => {
  it("GET /workspace/projects/:id/repo cross-user → 404; missing userKey → 400", async () => {
    const env = makeEnv();
    addProject(env, "wsp_b", "uk_owner");
    const app = createApp();

    const noKey = await app.fetch(new Request("http://localhost/workspace/projects/wsp_b/repo"), env);
    assert.equal(noKey.status, 400);

    const cross = await app.fetch(new Request("http://localhost/workspace/projects/wsp_b/repo?userKey=uk_attacker"), env);
    assert.equal(cross.status, 404);
    assert.deepEqual(await cross.json(), { ok: false, error: "not_found" });

    const owner = await app.fetch(new Request("http://localhost/workspace/projects/wsp_b/repo?userKey=uk_owner"), env);
    assert.equal(owner.status, 200);
  });

  it("GET review-history cross-user → 404", async () => {
    const env = makeEnv();
    addProject(env, "wsp_c", "uk_owner");
    const app = createApp();
    const resp = await app.fetch(new Request("http://localhost/workspace/projects/wsp_c/github/review-history?userKey=uk_attacker"), env);
    assert.equal(resp.status, 404);
    assert.deepEqual(await resp.json(), { ok: false, error: "not_found" });
  });

  it("POST review cross-user → 404 before any work", async () => {
    const env = makeEnv();
    addProject(env, "wsp_d", "uk_owner");
    const app = createApp();
    const resp = await app.fetch(
      jsonReq("/workspace/projects/wsp_d/github/pulls/1/review", "POST", { userKey: "uk_attacker" }),
      env,
    );
    assert.equal(resp.status, 404);
    assert.deepEqual(await resp.json(), { ok: false, error: "not_found" });
  });
});

// ─── (b) cross-user overwrite → 409, (c) same-owner upsert OK ───────────────

describe("POST /workspace/projects upsert guard", () => {
  it("cross-user overwrite of an existing id → 409 id_conflict, row untouched", async () => {
    const env = makeEnv();
    addProject(env, "wsp_victim", "uk_owner", "Victim Title");
    const app = createApp();
    const resp = await app.fetch(
      jsonReq("/workspace/projects", "POST", { id: "wsp_victim", userKey: "uk_attacker", title: "PWNED" }),
      env,
    );
    assert.equal(resp.status, 409);
    const body = await resp.json();
    assert.deepEqual(body, { ok: false, error: "id_conflict" });
    assert.equal(env.DB.state.projects.get("wsp_victim").title, "Victim Title");
    assert.equal(env.DB.state.projects.get("wsp_victim").user_key, "uk_owner");
  });

  it("same-owner upsert keeps working (dashboard re-save)", async () => {
    const env = makeEnv();
    addProject(env, "wsp_mine", "uk_owner", "Old Title");
    const app = createApp();
    const resp = await app.fetch(
      jsonReq("/workspace/projects", "POST", { id: "wsp_mine", userKey: "uk_owner", title: "New Title" }),
      env,
    );
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.id, "wsp_mine");
    assert.equal(env.DB.state.projects.get("wsp_mine").title, "New Title");
  });

  it("new ids keep working", async () => {
    const env = makeEnv();
    const app = createApp();
    const resp = await app.fetch(
      jsonReq("/workspace/projects", "POST", { id: "wsp_new", userKey: "uk_owner", title: "Fresh" }),
      env,
    );
    assert.equal(resp.status, 200);
    assert.equal(env.DB.state.projects.get("wsp_new").user_key, "uk_owner");
  });
});

// ─── builder-pack outcomes ownership ─────────────────────────────────────────

describe("builder-pack-outcomes ownership", () => {
  it("POST without userKey → 400; cross-user → 404", async () => {
    const env = makeEnv();
    addProject(env, "wsp_o", "uk_owner");
    const app = createApp();

    const noKey = await app.fetch(
      jsonReq("/workspace/builder-pack-outcomes", "POST", { projectId: "wsp_o", target: "claude_code", outcome: "worked" }),
      env,
    );
    assert.equal(noKey.status, 400);

    const cross = await app.fetch(
      jsonReq("/workspace/builder-pack-outcomes", "POST", { projectId: "wsp_o", userKey: "uk_attacker", target: "claude_code", outcome: "worked" }),
      env,
    );
    assert.equal(cross.status, 404);
    assert.deepEqual(await cross.json(), { ok: false, error: "not_found" });
  });

  it("GET list cross-user → 404, owner → 200", async () => {
    const env = makeEnv();
    addProject(env, "wsp_o2", "uk_owner");
    const app = createApp();

    const cross = await app.fetch(new Request("http://localhost/workspace/projects/wsp_o2/builder-pack-outcomes?userKey=uk_attacker"), env);
    assert.equal(cross.status, 404);

    const owner = await app.fetch(new Request("http://localhost/workspace/projects/wsp_o2/builder-pack-outcomes?userKey=uk_owner"), env);
    assert.equal(owner.status, 200);
  });
});

// ─── (e) per-userKey hourly rate limit ───────────────────────────────────────

describe("per-userKey hourly rate limit", () => {
  it("review endpoint trips at WORKSPACE_PR_REVIEW_HOURLY_LIMIT", async () => {
    const env = makeEnv({ WORKSPACE_PR_REVIEW_HOURLY_LIMIT: "2" });
    addProject(env, "wsp_rl", "uk_rl");
    const app = createApp();
    const call = () => app.fetch(
      jsonReq("/workspace/projects/wsp_rl/github/pulls/1/review", "POST", { userKey: "uk_rl" }),
      env,
    );

    // First two attempts pass the limiter (they fail later with 400 no_repo_linked,
    // which still consumes a slot — the limiter is attempt-based).
    const r1 = await call();
    assert.equal(r1.status, 400);
    const r2 = await call();
    assert.equal(r2.status, 400);

    const r3 = await call();
    assert.equal(r3.status, 429);
    const body = await r3.json();
    assert.equal(body.error, "rate_limited");
    assert.ok(Number(body.retryAfterSeconds) >= 60);
    assert.ok(r3.headers.get("retry-after"));
  });

  it("review limit is per-userKey — another user is not affected", async () => {
    const env = makeEnv({ WORKSPACE_PR_REVIEW_HOURLY_LIMIT: "1" });
    addProject(env, "wsp_rl2", "uk_one");
    addProject(env, "wsp_rl3", "uk_two");
    const app = createApp();

    const a1 = await app.fetch(jsonReq("/workspace/projects/wsp_rl2/github/pulls/1/review", "POST", { userKey: "uk_one" }), env);
    assert.equal(a1.status, 400);
    const a2 = await app.fetch(jsonReq("/workspace/projects/wsp_rl2/github/pulls/1/review", "POST", { userKey: "uk_one" }), env);
    assert.equal(a2.status, 429);

    const b1 = await app.fetch(jsonReq("/workspace/projects/wsp_rl3/github/pulls/1/review", "POST", { userKey: "uk_two" }), env);
    assert.equal(b1.status, 400, "other user must not be rate-limited");
  });

  it("comment endpoint trips at WORKSPACE_PR_COMMENT_HOURLY_LIMIT", async () => {
    const env = makeEnv({ WORKSPACE_PR_COMMENT_HOURLY_LIMIT: "1" });
    addProject(env, "wsp_cm", "uk_cm");
    const app = createApp();
    const call = () => app.fetch(
      jsonReq("/workspace/projects/wsp_cm/github/pulls/1/comment", "POST", { userKey: "uk_cm" }),
      env,
    );
    const r1 = await call();
    assert.equal(r1.status, 400); // no_repo_linked — passed the limiter
    const r2 = await call();
    assert.equal(r2.status, 429);
    assert.equal((await r2.json()).error, "rate_limited");
  });
});

// ─── beta_limits: daily caps (PR B) ──────────────────────────────────────────

describe("beta daily project-creation cap", () => {
  it("blocks the N+1th NEW project in a UTC day with 429 beta_daily", async () => {
    const env = makeEnv({ BETA_PROJECT_CREATE_DAILY_LIMIT: "2" });
    const app = createApp();
    const create = (title) =>
      app.fetch(jsonReq("/workspace/projects", "POST", { userKey: "uk_cap", title }), env);
    const r1 = await create("One");
    assert.equal(r1.status, 200);
    const r2 = await create("Two");
    assert.equal(r2.status, 200);
    const r3 = await create("Three");
    assert.equal(r3.status, 429);
    const body = await r3.json();
    assert.equal(body.error, "rate_limited");
    assert.equal(body.scope, "beta_daily");
    assert.ok(Number(body.retryAfterSeconds) >= 60);
    assert.ok(r3.headers.get("retry-after"));
  });

  it("re-saving an existing owned project does NOT consume the creation budget", async () => {
    const env = makeEnv({ BETA_PROJECT_CREATE_DAILY_LIMIT: "1" });
    const app = createApp();
    const r1 = await app.fetch(
      jsonReq("/workspace/projects", "POST", { userKey: "uk_cap2", title: "First" }),
      env,
    );
    assert.equal(r1.status, 200);
    const { id } = await r1.json();
    // Budget exhausted — the dashboard's autosave re-saves must keep working.
    for (let i = 0; i < 3; i++) {
      const rs = await app.fetch(
        jsonReq("/workspace/projects", "POST", { id, userKey: "uk_cap2", title: `Edit ${i}` }),
        env,
      );
      assert.equal(rs.status, 200, "same-owner re-save must never be capped");
    }
    // …while a NEW project (fresh explicit id) is blocked.
    const blocked = await app.fetch(
      jsonReq("/workspace/projects", "POST", { id: "wsp_fresh_id", userKey: "uk_cap2", title: "New" }),
      env,
    );
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).scope, "beta_daily");
  });

  it("cap is per-userKey — another user still creates", async () => {
    const env = makeEnv({ BETA_PROJECT_CREATE_DAILY_LIMIT: "1" });
    const app = createApp();
    const a1 = await app.fetch(jsonReq("/workspace/projects", "POST", { userKey: "uk_a", title: "A" }), env);
    assert.equal(a1.status, 200);
    const a2 = await app.fetch(jsonReq("/workspace/projects", "POST", { userKey: "uk_a", title: "A2" }), env);
    assert.equal(a2.status, 429);
    const b1 = await app.fetch(jsonReq("/workspace/projects", "POST", { userKey: "uk_b", title: "B" }), env);
    assert.equal(b1.status, 200);
  });
});

describe("beta daily review cap", () => {
  it("review endpoint trips at BETA_REVIEW_DAILY_LIMIT (on top of the hourly cap)", async () => {
    const env = makeEnv({ BETA_REVIEW_DAILY_LIMIT: "1" });
    addProject(env, "wsp_brl", "uk_brl");
    const app = createApp();
    const call = () =>
      app.fetch(jsonReq("/workspace/projects/wsp_brl/github/pulls/1/review", "POST", { userKey: "uk_brl" }), env);
    const r1 = await call();
    assert.equal(r1.status, 400); // no_repo_linked — passed both limiters (attempt consumed)
    const r2 = await call();
    assert.equal(r2.status, 429);
    const body = await r2.json();
    assert.equal(body.error, "rate_limited");
    assert.equal(body.scope, "beta_daily");
    assert.ok(r2.headers.get("retry-after"));
  });

  it("daily review cap is per-userKey", async () => {
    const env = makeEnv({ BETA_REVIEW_DAILY_LIMIT: "1" });
    addProject(env, "wsp_brl2", "uk_one_d");
    addProject(env, "wsp_brl3", "uk_two_d");
    const app = createApp();
    const a1 = await app.fetch(jsonReq("/workspace/projects/wsp_brl2/github/pulls/1/review", "POST", { userKey: "uk_one_d" }), env);
    assert.equal(a1.status, 400);
    const a2 = await app.fetch(jsonReq("/workspace/projects/wsp_brl2/github/pulls/1/review", "POST", { userKey: "uk_one_d" }), env);
    assert.equal(a2.status, 429);
    const b1 = await app.fetch(jsonReq("/workspace/projects/wsp_brl3/github/pulls/1/review", "POST", { userKey: "uk_two_d" }), env);
    assert.equal(b1.status, 400, "other user must not be capped");
  });
});

// ─── (f) onError does not leak err.message ───────────────────────────────────

describe("app.onError hygiene", () => {
  it("returns generic internal_error and never echoes err.message", async () => {
    const app = createApp();
    app.get("/__boom__", () => {
      throw new Error("SECRET-DSN postgres://user:hunter2@db/prod");
    });
    const resp = await app.fetch(new Request("http://localhost/__boom__"), makeEnv());
    assert.equal(resp.status, 500);
    const text = await resp.text();
    assert.ok(!text.includes("SECRET-DSN"), "response must not contain err.message");
    assert.ok(!text.includes("hunter2"), "response must not contain secrets from the error");
    assert.deepEqual(JSON.parse(text), { error: "internal_error" });
  });
});

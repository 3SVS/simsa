/**
 * federated-baselines.test.mjs — the /baselines adapter that closes the
 * decision #21 loop against the CLI's HttpFederatedSyncTransport contract:
 *   POST /baselines { baselines } → { accepted }
 *   GET  /baselines?since         → { baselines } (counts conveyed by repeats)
 * Mock D1 mirrors test/memory.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../dist/router.js";

function makeMockDb({ installs = new Map(), aggregates = new Map() } = {}) {
  const state = { installs: new Map(installs), aggregates: new Map(aggregates) };
  return {
    state,
    prepare(sql) {
      let bound = [];
      const wrap = {
        bind: (...args) => {
          bound = args;
          return wrap;
        },
        async first() {
          if (/SELECT \* FROM installs WHERE token_hash = \? AND status = 'active'/.test(sql)) {
            for (const v of state.installs.values()) {
              if (v.tokenHash === bound[0] && v.status === "active") {
                return {
                  id: v.id, repo_slug: v.repoSlug, token_hash: v.tokenHash,
                  created_at: v.createdAt, last_seen_at: v.lastSeenAt, status: v.status,
                };
              }
            }
            return null;
          }
          return null;
        },
        async all() {
          if (/SELECT \* FROM episodic_aggregates/.test(sql)) {
            let rows = [...state.aggregates.values()];
            rows.sort((a, b) => b.count - a.count);
            const limit = bound[bound.length - 1];
            rows = rows.slice(0, limit);
            return {
              results: rows.map((r) => ({
                content_hash: r.contentHash, kind: r.kind, domain: r.domain,
                category: r.category, severity: r.severity, tags: r.tags,
                count: r.count, first_seen_at: r.firstSeenAt, last_seen_at: r.lastSeenAt,
              })),
            };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO episodic_aggregates/.test(sql)) {
            const [contentHash, kind, domain, category, severity, tags, firstSeenAt, lastSeenAt] = bound;
            const existing = state.aggregates.get(contentHash);
            if (existing) {
              existing.count += 1;
              existing.lastSeenAt = lastSeenAt;
            } else {
              state.aggregates.set(contentHash, {
                contentHash, kind, domain, category, severity, tags,
                count: 1, firstSeenAt, lastSeenAt,
              });
            }
          }
          return { success: true };
        },
      };
      return wrap;
    },
  };
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function makeAuthedEnv() {
  const token = "c_test_token_fed";
  const installs = new Map([[
    "acme/service",
    {
      id: "c_install_1", repoSlug: "acme/service", tokenHash: sha256(token),
      createdAt: "2026-04-20T00:00:00Z", lastSeenAt: "2026-04-20T00:00:00Z", status: "active",
    },
  ]]);
  const db = makeMockDb({ installs });
  return { env: { DB: db, ENVIRONMENT: "test", GITHUB_CLIENT_ID: "Iv1.x" }, token, db };
}

async function call(app, env, path, init = {}) {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  const res = await app.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  return { res, body: await res.json().catch(() => null) };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const baseline = (over = {}) => ({
  version: 1,
  kind: "failure",
  contentHash: HASH_A,
  domain: "code",
  category: "security",
  severity: "blocker",
  tags: ["auth"],
  dayBucket: "2026-07-01",
  ...over,
});

test("POST /baselines requires install auth", async () => {
  const app = createApp();
  const { env } = makeAuthedEnv();
  const { res } = await call(app, env, "/baselines", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baselines: [baseline()] }),
  });
  assert.equal(res.status, 401);
});

test("POST /baselines upserts valid entries, skips garbage, returns accepted", async () => {
  const app = createApp();
  const { env, token, db } = makeAuthedEnv();
  const { res, body } = await call(app, env, "/baselines", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      baselines: [
        baseline(),
        baseline(), // duplicate hash → count 2
        baseline({ contentHash: HASH_B, kind: "answer-key", category: undefined, severity: undefined }),
        { version: 2, kind: "failure" }, // wrong version → skipped
        { nonsense: true }, // garbage → skipped
      ],
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(body.accepted, 3);
  assert.equal(db.state.aggregates.get(HASH_A).count, 2);
  // wire kind "failure" stored as "failure-catalog"; "answer-key" as-is
  assert.equal(db.state.aggregates.get(HASH_A).kind, "failure-catalog");
  assert.equal(db.state.aggregates.get(HASH_B).kind, "answer-key");
});

test("GET /baselines returns the transport wire shape with counts as repeats", async () => {
  const app = createApp();
  const { env, token } = makeAuthedEnv();
  const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
  // Seed: HASH_A ×3 (failure), HASH_B ×1 (answer-key)
  for (let i = 0; i < 3; i++) {
    await call(app, env, "/baselines", {
      method: "POST", headers: auth, body: JSON.stringify({ baselines: [baseline()] }),
    });
  }
  await call(app, env, "/baselines", {
    method: "POST", headers: auth,
    body: JSON.stringify({ baselines: [baseline({ contentHash: HASH_B, kind: "answer-key", category: undefined, severity: undefined })] }),
  });

  const { res, body } = await call(app, env, "/baselines", { method: "GET", headers: auth });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.baselines));
  const aEntries = body.baselines.filter((b) => b.contentHash === HASH_A);
  const bEntries = body.baselines.filter((b) => b.contentHash === HASH_B);
  assert.equal(aEntries.length, 3); // count conveyed by repetition
  assert.equal(bEntries.length, 1);
  // Wire shape matches the CLI's FederatedBaselineSchema: version 1, kind "failure" (not "failure-catalog")
  assert.equal(aEntries[0].version, 1);
  assert.equal(aEntries[0].kind, "failure");
  assert.equal(bEntries[0].kind, "answer-key");
  assert.match(aEntries[0].dayBucket, /^\d{4}-\d{2}-\d{2}$/);
  // no repo/user/text fields leak
  const keys = Object.keys(aEntries[0]).sort();
  assert.deepEqual(keys, ["category", "contentHash", "dayBucket", "domain", "kind", "severity", "tags", "version"]);
});

test("POST /baselines rejects malformed body and oversized batches", async () => {
  const app = createApp();
  const { env, token } = makeAuthedEnv();
  const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const bad = await call(app, env, "/baselines", { method: "POST", headers: auth, body: "{}" });
  assert.equal(bad.res.status, 400);
  const big = await call(app, env, "/baselines", {
    method: "POST", headers: auth,
    body: JSON.stringify({ baselines: Array.from({ length: 501 }, () => baseline()) }),
  });
  assert.equal(big.res.status, 413);
});

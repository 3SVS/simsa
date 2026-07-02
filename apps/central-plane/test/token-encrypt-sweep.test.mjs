/**
 * token-encrypt-sweep.test.mjs — daily drain of legacy plaintext GitHub
 * tokens into the encrypted column (migration 0004 phase 2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepPlaintextGithubTokens } from "../dist/db/token-encrypt-sweep.js";

// 32-byte KEK, base64 — matches crypto.ts expectations.
const KEK = Buffer.alloc(32, 7).toString("base64");

function makeDb(rows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const stmt = {
        sql,
        binds: [],
        bind(...args) { stmt.binds = args; return stmt; },
        async all() {
          calls.push({ sql, binds: stmt.binds });
          if (/SELECT id, github_access_token FROM installs/.test(sql)) {
            return { results: rows.slice(0, stmt.binds[0]) };
          }
          return { results: [] };
        },
        async run() {
          calls.push({ sql, binds: stmt.binds });
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

test("no KEK → safe no-op (never destroys the only token copy)", async () => {
  const db = makeDb([{ id: "i1", github_access_token: "gho_x" }]);
  const res = await sweepPlaintextGithubTokens({ DB: db });
  assert.deepEqual(res, { scanned: 0, upgraded: 0, failed: 0, skipped: "no_kek" });
  assert.equal(db.calls.length, 0);
});

test("upgrades each plaintext row via the idempotent lazy-encrypt UPDATE", async () => {
  const db = makeDb([
    { id: "i1", github_access_token: "gho_a" },
    { id: "i2", github_access_token: "gho_b" },
  ]);
  const res = await sweepPlaintextGithubTokens({ DB: db, CONCLAVE_TOKEN_KEK: KEK });
  assert.equal(res.scanned, 2);
  assert.equal(res.upgraded, 2);
  assert.equal(res.failed, 0);
  const updates = db.calls.filter((c) => /UPDATE installs SET github_access_token_enc/.test(c.sql));
  assert.equal(updates.length, 2);
  // Guard clause preserved: only fills _enc when still NULL, then NULLs plaintext.
  assert.match(updates[0].sql, /github_access_token = NULL WHERE id = \? AND github_access_token_enc IS NULL/);
});

test("per-row failure is counted, not thrown", async () => {
  const db = makeDb([{ id: "i1", github_access_token: "gho_a" }]);
  const orig = db.prepare.bind(db);
  let first = true;
  db.prepare = (sql) => {
    const stmt = orig(sql);
    if (/UPDATE installs SET github_access_token_enc/.test(sql)) {
      stmt.run = async () => { throw new Error("d1 hiccup"); };
    }
    return stmt;
  };
  const res = await sweepPlaintextGithubTokens({ DB: db, CONCLAVE_TOKEN_KEK: KEK });
  assert.equal(res.upgraded, 0);
  assert.equal(res.failed, 1);
});

test("empty backlog → clean zero result", async () => {
  const res = await sweepPlaintextGithubTokens({ DB: makeDb([]), CONCLAVE_TOKEN_KEK: KEK });
  assert.deepEqual(res, { scanned: 0, upgraded: 0, failed: 0, skipped: null });
});

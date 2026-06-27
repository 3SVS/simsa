/**
 * workspace-membership-route.test.mjs
 *
 * Stage 254 — GET /workspace/membership/me through the real router (createApp). Verifies the
 * read-only contract on the signed-out path and that the route source performs NO writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../dist/router.js";

function makeEnv(overrides = {}) {
  return { DB: {}, ENVIRONMENT: "test", ...overrides };
}

test("GET /workspace/membership/me (signed out) → read-only contract, no auth, empty workspaces", async () => {
  const app = createApp();
  // No AUTH_ENABLED → no session runtime; no userKey header/query → legacy count omitted.
  const res = await app.fetch(new Request("http://localhost/workspace/membership/me"), makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.authenticated, false);
  assert.equal(body.authUserId, null);
  assert.equal(body.email, null);
  assert.equal(body.userKey, null);
  assert.equal(body.hasPersonalWorkspace, false);
  assert.deepEqual(body.workspaces, []);
  assert.equal(body.legacyProjectCount, 0);
  assert.equal(body.bridgeMode, "read_only");
  assert.equal(body.canCreatePersonalWorkspace, false);
  assert.equal(body.canClaimProjects, false);
});

test("userKey is echoed from header but DB read failure is fail-safe (count 0), still no auth", async () => {
  const app = createApp();
  // DB:{} has no .prepare → the legacy-count query throws and is caught → count 0 (no crash, no write).
  const res = await app.fetch(
    new Request("http://localhost/workspace/membership/me", { headers: { "x-simsa-user-key": "uk_test123" } }),
    makeEnv(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userKey, "uk_test123");
  assert.equal(body.authenticated, false); // userKey is NOT an authenticated identity
  assert.equal(body.legacyProjectCount, 0);
});

test("response never leaks tokens/secrets/session material", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/workspace/membership/me?userKey=uk_q"),
    makeEnv({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "super-secret-probe-value" }),
  );
  const text = await res.text();
  assert.ok(!text.includes("super-secret-probe-value"), "must never echo the secret");
  assert.ok(!/"(token|sessionToken|password)"/i.test(text), "must not include token/session fields");
});

test("the membership route source contains NO write statements (read-only guarantee)", () => {
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "routes", "workspace-membership.ts"),
    "utf8",
  );
  // Strip block + line comments so the read-only PROSE (e.g. "no INSERT/UPDATE") is not matched;
  // only real code is scanned.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(code, /\bINSERT\b/i, "no INSERT");
  assert.doesNotMatch(code, /\bUPDATE\b/i, "no UPDATE");
  assert.doesNotMatch(code, /\bDELETE\b/i, "no DELETE");
  assert.doesNotMatch(code, /\.run\(/, "no .run() (writes); reads use .all()/.first()");
  assert.doesNotMatch(code, /\bDROP\b|\bALTER\b/i, "no schema mutation");
});

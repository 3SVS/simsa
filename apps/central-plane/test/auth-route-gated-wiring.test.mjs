/**
 * auth-route-gated-wiring.test.mjs
 *
 * Stage 221 invariant guard (replaces the Stage 218 auth-route-unwired guard).
 *
 * The route is now WIRED to a D1-backed Better Auth runtime — but activation must be
 * IMPOSSIBLE unless every gate (AUTH_ENABLED + secret + env.DB) is satisfied. This test
 * locks that invariant both behaviourally (through the real router) and structurally
 * (the runtime is never constructed at import time or before the gate check), so the
 * production default (flag unset → 503 auth_disabled, no runtime built) cannot regress.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../dist/router.js";
import { createBetterAuthRuntime, resolveAuthRuntimeGate } from "../dist/better-auth-spike.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// --- Behavioural: no activation without gates -----------------------------------------

test("default (no AUTH_ENABLED) → 503 auth_disabled, no runtime constructed", async () => {
  const app = createApp();
  const res = await app.fetch(new Request("http://localhost/api/auth/ok"), { ENVIRONMENT: "test", DB: {} });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "auth_disabled");
});

test("createBetterAuthRuntime returns null for every env missing any gate", () => {
  const missing = [
    undefined,
    {},
    { AUTH_ENABLED: "true" }, // no secret, no DB
    { AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x" }, // no DB
    { BETTER_AUTH_SECRET: "x", DB: {} }, // flag off
    { AUTH_ENABLED: "true", DB: {} }, // no secret
  ];
  for (const env of missing) {
    assert.equal(createBetterAuthRuntime(env), null, `expected null for ${JSON.stringify(env)}`);
    assert.notEqual(resolveAuthRuntimeGate(env), "ready");
  }
});

test("a runtime is built ONLY when all three gates are present", () => {
  assert.equal(resolveAuthRuntimeGate({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x", DB: {} }), "ready");
  const auth = createBetterAuthRuntime({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x", DB: {} });
  assert.ok(auth && typeof auth.handler === "function");
});

// --- Structural: construction is gated + lazy, never at import time -------------------

test("better-auth-spike.ts constructs the runtime lazily and only past the ready gate", () => {
  const text = readFileSync(join(SRC, "better-auth-spike.ts"), "utf8");
  // The betterAuth({...}) call must live inside createBetterAuthRuntime, after an early
  // return when the gate is not "ready" — never at module top level.
  const fnIdx = text.indexOf("export function createBetterAuthRuntime");
  const callIdx = text.indexOf("betterAuth({");
  assert.ok(fnIdx > 0, "expected createBetterAuthRuntime to exist");
  assert.ok(callIdx > fnIdx, "betterAuth({...}) must be constructed inside createBetterAuthRuntime, not at import time");
  const fnBody = text.slice(fnIdx, callIdx);
  assert.ok(
    /resolveAuthRuntimeGate\(env\)\s*!==\s*"ready"/.test(fnBody),
    "createBetterAuthRuntime must early-return unless the gate is ready before constructing",
  );
});

test("auth-spike route checks the gate before constructing any runtime", () => {
  const text = readFileSync(join(SRC, "routes", "auth-spike.ts"), "utf8");
  const gateIdx = text.indexOf("resolveAuthRuntimeGate(c.env)");
  const buildIdx = text.indexOf("createBetterAuthRuntime(c.env)");
  assert.ok(gateIdx > 0, "route must resolve the gate");
  assert.ok(buildIdx > gateIdx, "route must construct the runtime only AFTER the gate check");
  // The disabled gate must short-circuit to auth_disabled.
  assert.ok(/auth_disabled/.test(text), "route must return auth_disabled on the disabled gate");
  assert.ok(/auth_db_unavailable/.test(text), "route must return auth_db_unavailable when DB is missing");
});

/**
 * better-auth-spike.test.mjs
 *
 * Stage 204 / 221 — Better Auth LOCAL-ONLY runtime. Verifies the flag helper stays OFF
 * by default, never exposes the secret, and that the gated D1-backed runtime is built
 * ONLY when every gate (AUTH_ENABLED + secret + D1 binding) is satisfied — null in every
 * other (default / production / test) path. Imports the built output (dist), matching
 * the repo test convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAuthSpikeConfig } from "../dist/auth-spike-config.js";
import {
  betterAuthAvailable,
  resolveAuthRuntimeGate,
  createBetterAuthRuntime,
} from "../dist/better-auth-spike.js";

test("getAuthSpikeConfig defaults OFF and never throws on missing/odd env", () => {
  for (const bad of [undefined, {}, { AUTH_ENABLED: "false" }, { AUTH_ENABLED: "1" }, { AUTH_ENABLED: "" }]) {
    const c = getAuthSpikeConfig(bad);
    assert.equal(c.enabled, false);
    assert.equal(c.runtimeReady, false);
    assert.equal(c.productionSafe, true);
  }
});

test("enabled only when AUTH_ENABLED === 'true' (exact string)", () => {
  assert.equal(getAuthSpikeConfig({ AUTH_ENABLED: "true" }).enabled, true);
  assert.equal(getAuthSpikeConfig({ AUTH_ENABLED: "TRUE" }).enabled, false);
  assert.equal(getAuthSpikeConfig({ AUTH_ENABLED: "yes" }).enabled, false);
});

test("runtimeReady requires BOTH the flag and a present secret", () => {
  assert.equal(getAuthSpikeConfig({ AUTH_ENABLED: "true" }).runtimeReady, false); // no secret
  assert.equal(getAuthSpikeConfig({ BETTER_AUTH_SECRET: "x" }).runtimeReady, false); // flag off
  assert.equal(getAuthSpikeConfig({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x" }).runtimeReady, true);
});

test("provider defaults to better-auth and trims a custom value", () => {
  assert.equal(getAuthSpikeConfig({}).provider, "better-auth");
  assert.equal(getAuthSpikeConfig({ AUTH_PROVIDER: "  custom  " }).provider, "custom");
});

test("config never exposes the secret value or a secret field", () => {
  const c = getAuthSpikeConfig({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "super-secret-value" });
  const blob = JSON.stringify(c);
  assert.ok(!blob.includes("super-secret-value"), "config must not echo the secret value");
  assert.equal("BETTER_AUTH_SECRET" in c, false);
});

test("better-auth package resolves + imports under the central-plane build", () => {
  assert.equal(betterAuthAvailable(), true);
});

test("resolveAuthRuntimeGate maps each env to its safe gate", () => {
  // disabled = the default / production path (flag off)
  assert.equal(resolveAuthRuntimeGate(undefined), "disabled");
  assert.equal(resolveAuthRuntimeGate({}), "disabled");
  assert.equal(resolveAuthRuntimeGate({ AUTH_ENABLED: "false" }), "disabled");
  assert.equal(resolveAuthRuntimeGate({ BETTER_AUTH_SECRET: "x", DB: {} }), "disabled"); // flag off
  // enabled but missing pieces
  assert.equal(resolveAuthRuntimeGate({ AUTH_ENABLED: "true" }), "not_configured"); // no secret
  assert.equal(resolveAuthRuntimeGate({ AUTH_ENABLED: "true", DB: {} }), "not_configured"); // no secret
  assert.equal(resolveAuthRuntimeGate({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x" }), "db_unavailable"); // no DB
  // all gates satisfied
  assert.equal(resolveAuthRuntimeGate({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x", DB: {} }), "ready");
});

test("createBetterAuthRuntime stays null in every non-ready (default/production/test) path", () => {
  assert.equal(createBetterAuthRuntime(undefined), null);
  assert.equal(createBetterAuthRuntime({}), null);
  assert.equal(createBetterAuthRuntime({ AUTH_ENABLED: "true" }), null); // no secret
  assert.equal(createBetterAuthRuntime({ BETTER_AUTH_SECRET: "x" }), null); // flag off
  assert.equal(createBetterAuthRuntime({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x" }), null); // no DB
});

test("createBetterAuthRuntime builds a DB-backed handler ONLY when all gates are present", () => {
  // A bare object stands in for the D1 binding; the dialect only stores it at
  // construction (no DB access), so no live D1 is needed to prove the instance is built.
  const auth = createBetterAuthRuntime({ AUTH_ENABLED: "true", BETTER_AUTH_SECRET: "x", DB: {} });
  assert.ok(auth, "expected a Better Auth instance when flag + secret + DB are present");
  assert.equal(typeof auth.handler, "function");
});

test("Stage 227: topology env does NOT activate auth (still null without AUTH_ENABLED)", () => {
  // Setting topology env must never construct a runtime on its own — AUTH_ENABLED still gates.
  assert.equal(
    createBetterAuthRuntime({
      BETTER_AUTH_BASE_URL: "https://app.trysimsa.com",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://app.trysimsa.com",
      BETTER_AUTH_SECRET: "x",
      DB: {},
    }),
    null,
    "topology env without AUTH_ENABLED must NOT build a runtime",
  );
});

test("Stage 227: runtime builds with topology config when all gates present", () => {
  const auth = createBetterAuthRuntime({
    AUTH_ENABLED: "true",
    BETTER_AUTH_SECRET: "x",
    DB: {},
    BETTER_AUTH_BASE_URL: "https://app.trysimsa.com",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://app.trysimsa.com, https://x.dev",
  });
  assert.ok(auth, "expected a Better Auth instance with topology config + all gates");
  assert.equal(typeof auth.handler, "function");
});

// ─── Auth-upgrade STEP: GitHub social-login provider gating ─────────────────

test("resolveGithubLoginProvider: dormant unless BOTH id+secret are set", async () => {
  const { resolveGithubLoginProvider } = await import("../dist/better-auth-spike.js");
  assert.equal(resolveGithubLoginProvider({}), null);
  assert.equal(resolveGithubLoginProvider(undefined), null);
  assert.equal(resolveGithubLoginProvider({ AUTH_GH_CLIENT_ID: "id_only" }), null);
  assert.equal(resolveGithubLoginProvider({ AUTH_GH_CLIENT_SECRET: "secret_only" }), null);
  assert.equal(resolveGithubLoginProvider({ AUTH_GH_CLIENT_ID: "  ", AUTH_GH_CLIENT_SECRET: "s" }), null);
  assert.deepEqual(
    resolveGithubLoginProvider({ AUTH_GH_CLIENT_ID: "cid", AUTH_GH_CLIENT_SECRET: "csec" }),
    { clientId: "cid", clientSecret: "csec" },
  );
});

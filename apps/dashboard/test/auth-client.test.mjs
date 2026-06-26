/**
 * auth-client.test.mjs
 *
 * Stage 241 — dashboard fetch-based auth client. Verifies session fetch / sign-out are
 * fail-safe (never throw, return null/false on errors) and that the pure status resolver maps
 * fetch results to UI states. `fetch` is injected (no network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAuthSession, signOutAuth, resolveAuthStatus } from "../src/lib/auth-client.mjs";

function fakeFetch(impl) {
  return async (...args) => impl(...args);
}

test("getAuthSession returns null when signed out (Better Auth get-session → null)", async () => {
  const f = fakeFetch(async (url, init) => {
    assert.equal(url, "/api/auth/get-session");
    assert.equal(init.credentials, "include");
    return { ok: true, json: async () => null };
  });
  assert.equal(await getAuthSession(f), null);
});

test("getAuthSession returns the session object when signed in", async () => {
  const session = { user: { email: "a@example.test", id: "u1" }, session: { id: "s1" } };
  const f = fakeFetch(async () => ({ ok: true, json: async () => session }));
  assert.deepEqual(await getAuthSession(f), session);
});

test("getAuthSession is fail-safe: non-ok / throw / bad json → null", async () => {
  assert.equal(await getAuthSession(fakeFetch(async () => ({ ok: false, json: async () => ({}) }))), null);
  assert.equal(await getAuthSession(fakeFetch(async () => { throw new Error("net"); })), null);
  assert.equal(await getAuthSession(fakeFetch(async () => ({ ok: true, json: async () => { throw new Error("bad"); } }))), null);
  assert.equal(await getAuthSession(fakeFetch(async () => ({ ok: true, json: async () => ({ noUser: true }) }))), null);
});

test("signOutAuth posts to /api/auth/sign-out and returns ok boolean", async () => {
  let called = null;
  const f = fakeFetch(async (url, init) => {
    called = { url, method: init.method };
    return { ok: true };
  });
  assert.equal(await signOutAuth(f), true);
  assert.deepEqual(called, { url: "/api/auth/sign-out", method: "POST" });
  assert.equal(await signOutAuth(fakeFetch(async () => ({ ok: false }))), false);
  assert.equal(await signOutAuth(fakeFetch(async () => { throw new Error("net"); })), false);
});

test("resolveAuthStatus maps results to UI states", () => {
  assert.deepEqual(resolveAuthStatus({ loading: true }), { status: "loading", email: null });
  assert.deepEqual(resolveAuthStatus({ error: true }), { status: "error", email: null });
  assert.deepEqual(resolveAuthStatus({ session: null }), { status: "signed_out", email: null });
  assert.deepEqual(resolveAuthStatus({ session: { user: {} } }), { status: "signed_out", email: null });
  assert.deepEqual(resolveAuthStatus({ session: { user: { email: "x@example.test" } } }), {
    status: "signed_in",
    email: "x@example.test",
  });
  assert.deepEqual(resolveAuthStatus(undefined), { status: "signed_out", email: null });
});

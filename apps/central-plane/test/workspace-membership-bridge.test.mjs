/**
 * workspace-membership-bridge.test.mjs
 *
 * Stage 254 — pure read-only bridge response builder + userKey parsing. Imports dist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMembershipResponse, parseUserKey } from "../dist/workspace-membership-bridge.js";

test("signed-out: read-only contract, empty workspaces, no identity leaked", () => {
  const r = buildMembershipResponse({ authUserId: null, email: "ignored@x.test", userKey: "uk_abc", workspaces: [{ id: "w", name: "n", role: "owner" }], legacyProjectCount: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.authenticated, false);
  assert.equal(r.authUserId, null);
  assert.equal(r.email, null); // email not surfaced when unauthenticated
  assert.equal(r.userKey, "uk_abc");
  assert.equal(r.hasPersonalWorkspace, false);
  assert.deepEqual(r.workspaces, []); // workspaces never surfaced when unauthenticated
  assert.equal(r.legacyProjectCount, 3);
  assert.equal(r.bridgeMode, "read_only");
  assert.equal(r.canCreatePersonalWorkspace, false);
  assert.equal(r.canClaimProjects, false);
});

test("authenticated, no workspace rows: authenticated true, hasPersonalWorkspace false", () => {
  const r = buildMembershipResponse({ authUserId: "u1", email: "a@example.test", userKey: "uk_x", workspaces: [], legacyProjectCount: 0 });
  assert.equal(r.authenticated, true);
  assert.equal(r.authUserId, "u1");
  assert.equal(r.email, "a@example.test");
  assert.equal(r.hasPersonalWorkspace, false);
  assert.deepEqual(r.workspaces, []);
  // Claim flow exists now (workspace-claim.ts): authenticated → capabilities computed.
  assert.equal(r.canCreatePersonalWorkspace, true);
  assert.equal(r.canClaimProjects, true); // userKey present
});

test("authenticated with workspaces: hasPersonalWorkspace true, only safe fields", () => {
  const r = buildMembershipResponse({ authUserId: "u1", email: "a@example.test", userKey: null, workspaces: [{ id: "ws_1", name: "Personal", role: "owner" }], legacyProjectCount: 2 });
  assert.equal(r.hasPersonalWorkspace, true);
  assert.deepEqual(r.workspaces, [{ id: "ws_1", name: "Personal", role: "owner" }]);
  assert.equal(r.userKey, null);
  // no token/secret fields anywhere in the response
  assert.ok(!JSON.stringify(r).match(/token|secret|password|session/i));
});

test("legacyProjectCount is coerced to a non-negative integer", () => {
  assert.equal(buildMembershipResponse({ authUserId: "u", email: null, userKey: "uk", workspaces: [], legacyProjectCount: -5 }).legacyProjectCount, 0);
  assert.equal(buildMembershipResponse({ authUserId: "u", email: null, userKey: "uk", workspaces: [], legacyProjectCount: 2.9 }).legacyProjectCount, 2);
  assert.equal(buildMembershipResponse({ authUserId: "u", email: null, userKey: "uk", workspaces: [], legacyProjectCount: NaN }).legacyProjectCount, 0);
});

test("parseUserKey: header preferred, query fallback, plausibility guard", () => {
  assert.equal(parseUserKey("uk_abc", "uk_query"), "uk_abc"); // header wins
  assert.equal(parseUserKey(undefined, "uk_query"), "uk_query"); // query fallback
  assert.equal(parseUserKey("  uk_trim  ", null), "uk_trim");
  assert.equal(parseUserKey(null, null), null);
  assert.equal(parseUserKey("", ""), null);
  assert.equal(parseUserKey("has space", null), null); // whitespace → rejected (not auth, just a scope key)
  assert.equal(parseUserKey("x".repeat(201), null), null); // too long
});

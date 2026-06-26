/**
 * auth-signup-policy.test.mjs
 *
 * Stage 241 — auth sign-up exposure guard. Verifies the policy is fail-closed (default
 * "disabled"), parses the three modes, scopes only to sign-up paths (never sign-in / session /
 * sign-out), and that only "open" permits sign-up. Imports the built output (dist).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSignupMode, isSignupPath, isSignupBlocked } from "../dist/auth-signup-policy.js";

test("resolveSignupMode is fail-closed: unset/unknown → disabled", () => {
  for (const env of [undefined, {}, { AUTH_SIGNUP_MODE: "" }, { AUTH_SIGNUP_MODE: "   " }, { AUTH_SIGNUP_MODE: "nonsense" }, { AUTH_SIGNUP_MODE: "true" }]) {
    assert.equal(resolveSignupMode(env), "disabled");
  }
});

test("resolveSignupMode parses the three modes (case/space-insensitive)", () => {
  assert.equal(resolveSignupMode({ AUTH_SIGNUP_MODE: "open" }), "open");
  assert.equal(resolveSignupMode({ AUTH_SIGNUP_MODE: "  OPEN  " }), "open");
  assert.equal(resolveSignupMode({ AUTH_SIGNUP_MODE: "invite_only" }), "invite_only");
  assert.equal(resolveSignupMode({ AUTH_SIGNUP_MODE: "Invite_Only" }), "invite_only");
  assert.equal(resolveSignupMode({ AUTH_SIGNUP_MODE: "disabled" }), "disabled");
});

test("isSignupPath matches ONLY sign-up endpoints", () => {
  assert.equal(isSignupPath("/api/auth/sign-up"), true);
  assert.equal(isSignupPath("/api/auth/sign-up/email"), true);
  assert.equal(isSignupPath("/api/auth/sign-up/email/"), true);
  assert.equal(isSignupPath("/api/auth/sign-up/email?x=1"), true);
  // NOT sign-up:
  assert.equal(isSignupPath("/api/auth/sign-in/email"), false);
  assert.equal(isSignupPath("/api/auth/get-session"), false);
  assert.equal(isSignupPath("/api/auth/sign-out"), false);
  assert.equal(isSignupPath("/api/auth/ok"), false);
  assert.equal(isSignupPath("/api/auth/sign-upgrade"), false); // not a sign-up subpath
  assert.equal(isSignupPath(undefined), false);
});

test("isSignupBlocked: only 'open' permits sign-up", () => {
  assert.equal(isSignupBlocked("open"), false);
  assert.equal(isSignupBlocked("invite_only"), true);
  assert.equal(isSignupBlocked("disabled"), true);
});

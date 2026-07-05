/**
 * auth-email-verification.test.mjs — D2 soft-auth pure logic: the claim gate
 * decision + the verification email copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailVerificationRequired,
  buildVerificationEmail,
} from "../dist/auth-email-verification.js";

test("emailVerificationRequired: OFF unless Resend is configured (fail-open)", () => {
  assert.equal(emailVerificationRequired({}), false);
  assert.equal(emailVerificationRequired(undefined), false);
  assert.equal(emailVerificationRequired({ RESEND_API_KEY: "" }), false);
  assert.equal(emailVerificationRequired({ RESEND_API_KEY: "   " }), false);
});

test("emailVerificationRequired: ON when Resend is configured", () => {
  assert.equal(emailVerificationRequired({ RESEND_API_KEY: "re_live_abc" }), true);
});

test("emailVerificationRequired: kill switch forces OFF even with Resend", () => {
  assert.equal(
    emailVerificationRequired({ RESEND_API_KEY: "re_live_abc", AUTH_EMAIL_VERIFICATION: "off" }),
    false,
  );
  assert.equal(
    emailVerificationRequired({ RESEND_API_KEY: "re_live_abc", AUTH_EMAIL_VERIFICATION: "OFF" }),
    false,
  );
  // any other value leaves it on
  assert.equal(
    emailVerificationRequired({ RESEND_API_KEY: "re_live_abc", AUTH_EMAIL_VERIFICATION: "on" }),
    true,
  );
});

test("buildVerificationEmail: includes the URL and no other sensitive data", () => {
  const url = "https://app.trysimsa.com/api/auth/verify-email?token=abc123";
  const { subject, text } = buildVerificationEmail(url);
  assert.match(subject, /Simsa/);
  assert.ok(text.includes(url), "must include the verification URL");
  // soft framing: usable before verifying, sync after
  assert.match(text, /다른 기기/);
  assert.match(text, /verify/i);
});

test("buildVerificationEmail: custom app name", () => {
  const { subject, text } = buildVerificationEmail("https://x/y", { appName: "TestApp" });
  assert.match(subject, /TestApp/);
  assert.match(text, /TestApp/);
});

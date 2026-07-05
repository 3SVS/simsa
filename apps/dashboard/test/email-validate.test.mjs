import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlausibleEmail } from "../src/lib/email-validate.mjs";

test("accepts real-looking addresses", () => {
  for (const e of [
    "seunghunbae@gmail.com",
    "jane.doe@company.co.kr",
    "user+tag@sub.domain.io",
    "j@gmail.com", // 1-char local at a real domain is allowed
  ]) {
    assert.equal(isPlausibleEmail(e), true, e);
  }
});

test("rejects the reported fake and other toy/malformed addresses", () => {
  for (const e of [
    "a@a.com", // second-level label "a" — the reported case
    "x@x.x",
    "test@test.com",
    "foo@example.com",
    "notanemail",
    "no@tld",
    "a@b", // no dot
    "@nodomain.com",
    "spaces in@email.com",
    "",
    "   ",
  ]) {
    assert.equal(isPlausibleEmail(e), false, e);
  }
});

test("is trim/case-insensitive", () => {
  assert.equal(isPlausibleEmail("  Alice@Gmail.COM  "), true);
});

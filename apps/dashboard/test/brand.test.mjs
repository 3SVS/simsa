// Stage 84: dashboard BRAND constants. A future rename should update BRAND
// in one place; tests here pin the public-facing values + ensure the i18n
// sibling (t.brand.wordmark) currently agrees with BRAND.productName.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAND } from "../src/lib/brand.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

test("BRAND exports stable product strings", () => {
  assert.equal(BRAND.productName, "Conclave");
  assert.equal(BRAND.productShortName, "Conclave");
  assert.equal(BRAND.tagline, "Acceptance workspace for AI-built software");
  // metadataTitle and description are concatenated server-side via Next; assert
  // they stay non-empty so a future rename doesn't accidentally drop them.
  assert.ok(BRAND.metadataTitle && BRAND.metadataTitle.includes(BRAND.productName));
  assert.ok(BRAND.metadataDescription && BRAND.metadataDescription.length > 0);
});

test("i18n brand wordmark agrees with BRAND.productName for every locale", () => {
  // BRAND drives non-locale chrome (HTML <title>); t.brand.wordmark drives the
  // sidebar AppSidebar render. They must agree until a future rename moves
  // them in lockstep — that's exactly the drift this test catches.
  for (const locale of Object.keys(DICTIONARIES)) {
    assert.equal(
      DICTIONARIES[locale].brand.wordmark,
      BRAND.productName,
      `${locale} dictionary's brand.wordmark drifted from BRAND.productName`,
    );
  }
});

test("BRAND.tagline matches the EN i18n tagline (KO has its own translation)", () => {
  assert.equal(DICTIONARIES.en.brand.tagline, BRAND.tagline);
  // KO is a translation, not a copy — assert it exists but do NOT pin it to BRAND.tagline.
  assert.ok(DICTIONARIES.ko.brand.tagline && DICTIONARIES.ko.brand.tagline.length > 0);
});

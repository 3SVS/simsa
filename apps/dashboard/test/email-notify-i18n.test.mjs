/**
 * email-notify-i18n.test.mjs
 *
 * Email notifications settings block — dictionary namespace `emailNotify`.
 * EN/KO parity for the namespace is also covered by the structural check in
 * i18n.test.mjs; this file asserts the keys the settings page actually uses.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DICTIONARIES, getDictionary, LOCALES } from "../src/i18n/dictionary.mjs";

const REQUIRED_KEYS = [
  "title",
  "desc",
  "notConfigured",
  "address",
  "addressHint",
  "addressPlaceholder",
  "invalidAddress",
  "enable",
  "saving",
  "saved",
  "saveError",
  "sendTest",
  "sending",
  "testSent",
  "testError",
];

describe("emailNotify i18n namespace", () => {
  it("exists with all required non-empty keys in both locales", () => {
    for (const loc of LOCALES) {
      const d = getDictionary(loc);
      assert.ok(d.emailNotify, `${loc}.emailNotify missing`);
      for (const k of REQUIRED_KEYS) {
        assert.ok(
          typeof d.emailNotify[k] === "string" && d.emailNotify[k].length > 0,
          `${loc}.emailNotify.${k} missing or empty`,
        );
      }
    }
  });

  it("en and ko emailNotify key sets are identical", () => {
    const en = Object.keys(DICTIONARIES.en.emailNotify).sort();
    const ko = Object.keys(DICTIONARIES.ko.emailNotify).sort();
    assert.deepEqual(ko, en);
  });

  it("copy is channel-appropriate (mentions email, not Telegram)", () => {
    const en = getDictionary("en").emailNotify;
    assert.ok(en.title.toLowerCase().includes("email"));
    for (const k of REQUIRED_KEYS) {
      assert.ok(!/telegram/i.test(en[k]), `en.emailNotify.${k} must not mention Telegram`);
    }
  });
});

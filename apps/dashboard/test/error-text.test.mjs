import { test } from "node:test";
import assert from "node:assert/strict";
import { errorText } from "../src/i18n/error-text.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

const en = DICTIONARIES.en;
const ko = DICTIONARIES.ko;

test("maps known codes to localized copy (never the raw code)", () => {
  assert.equal(errorText(en, "insufficient_credits"), en.errors.insufficientCredits);
  assert.equal(errorText(ko, "insufficient_credits"), ko.errors.insufficientCredits);
  assert.equal(errorText(en, "rate_limited"), en.errors.rateLimited);
  assert.equal(errorText(en, "github_scope_required"), en.errors.githubScopeRequired);
  assert.equal(errorText(en, "db_error"), en.errors.server);
  assert.equal(errorText(en, "fetch_failed"), en.errors.network);
});

test("maps HTTP status shapes", () => {
  assert.equal(errorText(en, "HTTP 500"), en.errors.server);
  assert.equal(errorText(en, "HTTP 404"), en.errors.notFound);
  assert.equal(errorText(en, "HTTP 401"), en.errors.unauthorized);
  assert.equal(errorText(en, "429"), en.errors.rateLimited);
});

test("timeout / abort / network hints", () => {
  assert.equal(errorText(en, "The operation was aborted"), en.errors.timeout);
  assert.equal(errorText(en, "Failed to fetch"), en.errors.network);
});

test("unknown code falls back to generic (or explicit fallback)", () => {
  assert.equal(errorText(en, "some_unknown_code"), en.errors.generic);
  assert.equal(errorText(en, "some_unknown_code", "loadFailed"), en.errors.loadFailed);
  assert.equal(errorText(en, "some_unknown_code", "saveFailed"), en.errors.saveFailed);
});

test("empty / non-string input → fallback, never throws", () => {
  assert.equal(errorText(en, null), en.errors.generic);
  assert.equal(errorText(en, undefined), en.errors.generic);
  assert.equal(errorText(en, ""), en.errors.generic);
  assert.equal(errorText(en, 500), en.errors.generic);
});

test("never returns the raw code for a known code", () => {
  for (const code of ["insufficient_credits", "db_error", "HTTP 500", "fetch_failed"]) {
    const out = errorText(ko, code);
    assert.ok(!out.includes(code), `output must not contain raw code ${code}`);
  }
});

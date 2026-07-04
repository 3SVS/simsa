/**
 * simsa-landing dictionary — EN/KO parity + language resolution.
 *
 * Parity: both languages expose the exact same key tree (recursive), every
 * leaf is a non-empty string, and array leaves have equal lengths.
 * Jargon guard: KO copy must not leak developer jargon the dashboard bans
 * (acceptance → 확인, repo → 코드 저장소, PRD → 기획서).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { LANDING_DICT, resolveInitialLang, LANG_STORAGE_KEY } = await import(
  "../src/lib/dictionary.mjs"
);

function collectPaths(obj, prefix = "") {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      paths.push(`${p}[len:${value.length}]`);
      value.forEach((v, i) => {
        if (typeof v === "object" && v !== null) paths.push(...collectPaths(v, `${p}[${i}]`));
        else paths.push(`${p}[${i}]`);
      });
    } else if (typeof value === "object" && value !== null) {
      paths.push(...collectPaths(value, p));
    } else {
      paths.push(p);
    }
  }
  return paths.sort();
}

function collectLeafStrings(obj, out = []) {
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) value.forEach((v) => (typeof v === "object" ? collectLeafStrings(v, out) : out.push(v)));
    else if (typeof value === "object" && value !== null) collectLeafStrings(value, out);
    else out.push(value);
  }
  return out;
}

describe("landing dictionary parity", () => {
  it("EN and KO have the identical key tree (including array lengths)", () => {
    assert.deepEqual(collectPaths(LANDING_DICT.en), collectPaths(LANDING_DICT.ko));
  });

  it("every leaf is a non-empty string in both languages", () => {
    for (const lang of ["en", "ko"]) {
      for (const leaf of collectLeafStrings(LANDING_DICT[lang])) {
        assert.equal(typeof leaf, "string", `${lang} leaf must be a string`);
        assert.ok(leaf.trim().length > 0, `${lang} leaf must not be empty`);
      }
    }
  });

  it("KO copy avoids banned developer jargon", () => {
    const koText = collectLeafStrings(LANDING_DICT.ko).join(" ");
    for (const banned of ["acceptance", "PRD", "레포", "리포지토리", "pull request", "Pull request"]) {
      assert.ok(!koText.includes(banned), `KO copy must not contain "${banned}"`);
    }
  });

  it("KO actually renders in Korean (hangul present in every KO section title)", () => {
    const hangul = /[가-힣]/;
    assert.ok(hangul.test(LANDING_DICT.ko.hero.headline));
    assert.ok(hangul.test(LANDING_DICT.ko.startAnything.title));
    assert.ok(hangul.test(LANDING_DICT.ko.joinBeta.title));
  });
});

describe("resolveInitialLang", () => {
  it("stored manual choice wins", () => {
    assert.equal(resolveInitialLang({ stored: "ko", navigatorLanguage: "en-US" }), "ko");
    assert.equal(resolveInitialLang({ stored: "en", navigatorLanguage: "ko-KR" }), "en");
  });

  it("browser language ko / ko-KR → ko", () => {
    assert.equal(resolveInitialLang({ navigatorLanguage: "ko" }), "ko");
    assert.equal(resolveInitialLang({ navigatorLanguage: "ko-KR" }), "ko");
    assert.equal(resolveInitialLang({ navigatorLanguage: "KO-kr" }), "ko");
  });

  it("everything else (and garbage) → en", () => {
    assert.equal(resolveInitialLang({ navigatorLanguage: "en-US" }), "en");
    assert.equal(resolveInitialLang({ navigatorLanguage: "ja-JP" }), "en");
    assert.equal(resolveInitialLang({ stored: "fr", navigatorLanguage: null }), "en");
    assert.equal(resolveInitialLang({}), "en");
    assert.equal(resolveInitialLang(undefined), "en");
  });

  it("storage key is namespaced", () => {
    assert.ok(LANG_STORAGE_KEY.startsWith("simsa:"));
  });
});

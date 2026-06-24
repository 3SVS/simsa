// Stage 170 — local account-preferences tests (pure, node --test).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDisplayName,
  displayInitial,
  readDisplayName,
  writeDisplayName,
  DISPLAY_NAME_MAX,
  DEFAULT_DISPLAY_NAME,
  ACCOUNT_DISPLAY_NAME_KEY,
} from "../src/lib/account-preferences.mjs";

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

describe("normalizeDisplayName", () => {
  it("trims surrounding whitespace", () => {
    assert.equal(normalizeDisplayName("  Bae  "), "Bae");
  });
  it("enforces the max length", () => {
    const long = "x".repeat(200);
    assert.equal(normalizeDisplayName(long).length, DISPLAY_NAME_MAX);
  });
  it("falls back to the default for empty/whitespace", () => {
    assert.equal(normalizeDisplayName(""), DEFAULT_DISPLAY_NAME);
    assert.equal(normalizeDisplayName("   "), DEFAULT_DISPLAY_NAME);
  });
  it("honors a custom fallback, but defaults if the fallback is blank", () => {
    assert.equal(normalizeDisplayName("", "Custom"), "Custom");
    assert.equal(normalizeDisplayName("", "   "), DEFAULT_DISPLAY_NAME);
  });
  it("never throws on malformed input", () => {
    for (const bad of [null, undefined, 7, {}, []]) {
      assert.doesNotThrow(() => normalizeDisplayName(bad));
      assert.equal(normalizeDisplayName(bad), DEFAULT_DISPLAY_NAME);
    }
  });
});

describe("displayInitial", () => {
  it("returns the uppercase first letter", () => {
    assert.equal(displayInitial("bae"), "B");
  });
  it("falls back when empty/malformed", () => {
    assert.equal(displayInitial("", "S"), "S");
    assert.equal(displayInitial(null), "S");
  });
});

describe("read/writeDisplayName", () => {
  it("round-trips through storage with normalization", () => {
    const s = memStorage();
    writeDisplayName(s, "  Seunghun  ");
    assert.equal(s.getItem(ACCOUNT_DISPLAY_NAME_KEY), "Seunghun");
    assert.equal(readDisplayName(s), "Seunghun");
  });
  it("read falls back to default when unset", () => {
    assert.equal(readDisplayName(memStorage()), DEFAULT_DISPLAY_NAME);
  });
  it("never throws on null/throwing storage", () => {
    const throwing = {
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {
        throw new Error("nope");
      },
    };
    assert.doesNotThrow(() => writeDisplayName(null, "x"));
    assert.doesNotThrow(() => writeDisplayName(throwing, "x"));
    assert.equal(readDisplayName(throwing), DEFAULT_DISPLAY_NAME);
    assert.equal(readDisplayName(null), DEFAULT_DISPLAY_NAME);
  });
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveServiceValues,
  loadServiceValues,
  clearServiceValues,
} from "../src/lib/service-values-store.mjs";

// Minimal sessionStorage mock on globalThis.window.
function installStorage() {
  const map = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    },
  };
  return map;
}

describe("service-values-store (browser-only, sessionStorage)", () => {
  beforeEach(() => installStorage());

  it("round-trips services for a project", () => {
    const services = [{ id: "supabase", envVars: [{ key: "K", value: "secret_v" }] }];
    saveServiceValues("proj_1", services);
    assert.deepEqual(loadServiceValues("proj_1"), services);
  });

  it("is scoped per project", () => {
    saveServiceValues("proj_a", [{ id: "a" }]);
    saveServiceValues("proj_b", [{ id: "b" }]);
    assert.equal(loadServiceValues("proj_a")[0].id, "a");
    assert.equal(loadServiceValues("proj_b")[0].id, "b");
  });

  it("returns null for an unknown project", () => {
    assert.equal(loadServiceValues("nope"), null);
  });

  it("clear removes the stored values", () => {
    saveServiceValues("proj_1", [{ id: "x" }]);
    clearServiceValues("proj_1");
    assert.equal(loadServiceValues("proj_1"), null);
  });

  it("no-ops gracefully without window/storage (SSR)", () => {
    delete globalThis.window;
    assert.doesNotThrow(() => saveServiceValues("p", [{ id: "x" }]));
    assert.equal(loadServiceValues("p"), null);
    assert.doesNotThrow(() => clearServiceValues("p"));
  });

  it("survives corrupt stored JSON (returns null, no throw)", () => {
    globalThis.window.sessionStorage.setItem("conclave:service-values:proj_1", "{not json");
    assert.equal(loadServiceValues("proj_1"), null);
  });
});

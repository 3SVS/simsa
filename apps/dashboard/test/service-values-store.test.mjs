import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveServiceValues,
  loadServiceValues,
  clearServiceValues,
  seedServiceSetup,
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

  // A2b safety check 1: values entered in prep survive the move to export.
  // v2 (2026-07-21 i18n): the stored blob decides WHICH services + their
  // VALUES, but the copy is re-resolved from the catalog in the current
  // locale — a KO-saved blob must not pin the labels after switching to EN.
  it("seedServiceSetup keeps STORED values, re-resolves copy per locale", () => {
    const stored = [{ id: "supabase", envVars: [{ key: "SUPABASE_SERVICE_ROLE_KEY", value: "svc_real" }] }];
    saveServiceValues("proj_1", stored);

    const seededKo = seedServiceSetup("proj_1", { oneLine: "무엇이든" });
    assert.equal(seededKo.length, 1);
    assert.equal(seededKo[0].id, "supabase");
    const roleKo = seededKo[0].envVars.find((v) => v.key === "SUPABASE_SERVICE_ROLE_KEY");
    assert.equal(roleKo.value, "svc_real", "entered value survives");
    assert.ok(/데이터/.test(seededKo[0].label), "KO copy resolved");
    // Catalog vars the stored blob didn't carry come back (full entry restored).
    assert.ok(seededKo[0].envVars.some((v) => v.key === "NEXT_PUBLIC_SUPABASE_URL"));

    const seededEn = seedServiceSetup("proj_1", { oneLine: "anything" }, "en");
    const roleEn = seededEn[0].envVars.find((v) => v.key === "SUPABASE_SERVICE_ROLE_KEY");
    assert.equal(roleEn.value, "svc_real", "value survives locale switch");
    assert.ok(/data/.test(seededEn[0].label), "EN copy resolved");
    assert.ok(!/[가-힣]/.test(seededEn[0].label), "no Hangul in EN label");
  });

  it("seedServiceSetup passes unknown/legacy service ids through untouched", () => {
    const stored = [{ id: "custom-thing", label: "커스텀", envVars: [{ key: "X", value: "1" }] }];
    saveServiceValues("proj_legacy", stored);
    const seeded = seedServiceSetup("proj_legacy", null, "en");
    assert.deepEqual(seeded, stored);
  });

  // A2b safety check 2: spec detection still reaches the panel on its new screen.
  it("seedServiceSetup falls back to spec detection when nothing is stored", () => {
    const seeded = seedServiceSetup("proj_new", { oneLine: "가입하면 인증 메일을 보내는 앱" });
    const ids = seeded.map((s) => s.id);
    assert.ok(ids.includes("app-url"), "always detects app-url");
    assert.ok(ids.includes("resend"), "email spec → Resend reaches the panel");
  });
});

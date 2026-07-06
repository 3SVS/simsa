import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_CATALOG,
  catalogServiceById,
  detectServices,
  hasAnyValue,
} from "../src/lib/service-catalog.mjs";

describe("service-catalog", () => {
  it("every catalog entry has an id, label and at least one env var", () => {
    assert.ok(SERVICE_CATALOG.length > 0);
    for (const s of SERVICE_CATALOG) {
      assert.ok(typeof s.id === "string" && s.id.length > 0);
      assert.ok(typeof s.label === "string" && s.label.length > 0);
      assert.ok(Array.isArray(s.envVars) && s.envVars.length > 0);
      for (const v of s.envVars) {
        assert.ok(typeof v.key === "string" && v.key.length > 0);
        assert.ok(typeof v.description === "string" && v.description.length > 0);
      }
    }
  });

  it("catalog examples are placeholders, never real-looking secrets", () => {
    // Rule 3: the catalog is compiled into the browser bundle. It must not ship
    // anything resembling a real key.
    for (const s of SERVICE_CATALOG) {
      for (const v of s.envVars) {
        if (v.example === undefined) continue;
        assert.ok(!/^sk-/.test(v.example), `${v.key} example looks like a real key`);
        assert.ok(!/^ghp_/.test(v.example), `${v.key} example looks like a real token`);
        // no populated JWT (header.payload.signature with a long signature)
        assert.ok(
          !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}$/.test(v.example),
          `${v.key} example looks like a real JWT`,
        );
      }
    }
  });

  it("service_role key is marked secret; public keys are not", () => {
    const supabase = catalogServiceById("supabase");
    assert.ok(supabase);
    const serviceRole = supabase.envVars.find((v) => v.key === "SUPABASE_SERVICE_ROLE_KEY");
    const anon = supabase.envVars.find((v) => v.key === "NEXT_PUBLIC_SUPABASE_ANON_KEY");
    assert.equal(serviceRole?.secret, true);
    assert.notEqual(anon?.secret, true);
  });

  it("catalogServiceById returns a fresh clone (no shared mutation)", () => {
    const a = catalogServiceById("supabase");
    const b = catalogServiceById("supabase");
    assert.ok(a && b);
    a.envVars[0].value = "mutated";
    assert.equal(b.envVars[0].value, undefined, "clones must not share env var objects");
    // the shared catalog itself is untouched
    assert.equal(SERVICE_CATALOG.find((s) => s.id === "supabase").envVars[0].value, undefined);
  });

  it("catalogServiceById returns null for unknown id", () => {
    assert.equal(catalogServiceById("does-not-exist"), null);
  });

  it("detectServices always suggests app-url", () => {
    const out = detectServices({ oneLine: "간단한 계산기", included: ["더하기"] });
    assert.ok(out.some((s) => s.id === "app-url"));
  });

  it("detectServices suggests supabase when data keywords appear", () => {
    const out = detectServices({
      oneLine: "회원가입하고 글을 저장하는 앱",
      included: ["로그인", "게시글 목록"],
    });
    assert.ok(out.some((s) => s.id === "supabase"), "supabase should be detected");
  });

  it("detectServices matches english data keywords too", () => {
    const out = detectServices({ oneLine: "a simple app to store user notes" });
    assert.ok(out.some((s) => s.id === "supabase"));
  });

  it("detectServices does NOT suggest supabase for a pure static/no-data app", () => {
    const out = detectServices({
      oneLine: "고정된 회사 소개 한 페이지",
      included: ["소개 문구", "연락처 표시"],
    });
    assert.ok(!out.some((s) => s.id === "supabase"), "no data → no supabase");
    // app-url is still there
    assert.ok(out.some((s) => s.id === "app-url"));
  });

  it("detectServices tolerates null/empty spec", () => {
    assert.deepEqual(
      detectServices(null).map((s) => s.id),
      ["app-url"],
    );
    assert.deepEqual(
      detectServices({}).map((s) => s.id),
      ["app-url"],
    );
  });

  it("hasAnyValue is false until a value is entered, true after", () => {
    const services = detectServices({ oneLine: "글을 저장하는 앱" });
    assert.equal(hasAnyValue(services), false);
    services[1].envVars[0].value = "https://real.supabase.co";
    assert.equal(hasAnyValue(services), true);
  });

  it("hasAnyValue ignores whitespace-only values", () => {
    const services = detectServices({ oneLine: "글을 저장하는 앱" });
    services[1].envVars[0].value = "   ";
    assert.equal(hasAnyValue(services), false);
  });
});

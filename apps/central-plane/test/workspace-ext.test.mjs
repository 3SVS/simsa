import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G8 D-1 (DR-1 LOCKED): ext upsert 입구 검증 — userKey 필수, ext는 객체만,
// 256KB 캡. 내용 검열 없음(사용자의 것).

const { validateExtUpsert } = await import("../dist/routes/workspace-ext.js");

describe("validateExtUpsert — G8 D-1", () => {
  it("valid body → {userKey, extJson}", () => {
    const out = validateExtUpsert({ userKey: " u1 ", ext: { entryPath: "idea", checkResults: { results: [] } } });
    assert.equal(out.userKey, "u1");
    assert.ok(out.extJson.includes("entryPath"));
  });

  it("missing userKey / non-object ext / array ext → rejected", () => {
    assert.equal(validateExtUpsert({ ext: {} }), null);
    assert.equal(validateExtUpsert({ userKey: "u", ext: "string" }), null);
    assert.equal(validateExtUpsert({ userKey: "u", ext: [1, 2] }), null);
    assert.equal(validateExtUpsert({ userKey: "u" }), null);
    assert.equal(validateExtUpsert(null), null);
  });

  it("over 256KB → rejected", () => {
    assert.equal(validateExtUpsert({ userKey: "u", ext: { blob: "x".repeat(263_000) } }), null);
  });

  it("userKey capped at 64 chars", () => {
    const out = validateExtUpsert({ userKey: "k".repeat(100), ext: {} });
    assert.equal(out.userKey.length, 64);
  });
});

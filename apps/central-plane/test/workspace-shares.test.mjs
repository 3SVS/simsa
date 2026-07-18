import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G11 (docs/simsa-gap-backlog-2026-07-18.md): 스냅샷 공유의 입구 검증 —
// userKey/제목 필수, 크기 캡(60KB) 초과 거부. 내용은 사용자의 것(검열 없음).

const { sanitizeSharePayload } = await import("../dist/routes/shares.js");

describe("sanitizeSharePayload — G11", () => {
  it("valid share → normalized {userKey, projectId, payloadJson}", () => {
    const out = sanitizeSharePayload({
      userKey: " u1 ",
      projectId: "p1",
      payload: { title: "동네 빵집 예약 앱", items: [{ t: "a" }] },
    });
    assert.equal(out.userKey, "u1");
    assert.equal(out.projectId, "p1");
    assert.ok(out.payloadJson.includes("동네 빵집"));
  });

  it("missing userKey or title → rejected", () => {
    assert.equal(sanitizeSharePayload({ payload: { title: "t" } }), null);
    assert.equal(sanitizeSharePayload({ userKey: "u", payload: { title: "  " } }), null);
    assert.equal(sanitizeSharePayload({ userKey: "u", payload: {} }), null);
    assert.equal(sanitizeSharePayload({ userKey: "u" }), null);
    assert.equal(sanitizeSharePayload(null), null);
  });

  it("payload over 60KB → rejected", () => {
    const big = { title: "t", blob: "x".repeat(61_000) };
    assert.equal(sanitizeSharePayload({ userKey: "u", payload: big }), null);
  });

  it("projectId optional → null when absent", () => {
    const out = sanitizeSharePayload({ userKey: "u", payload: { title: "t" } });
    assert.equal(out.projectId, null);
  });
});

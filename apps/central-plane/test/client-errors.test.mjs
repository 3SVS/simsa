import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G12 (docs/simsa-gap-backlog-2026-07-18.md): 서버는 클라이언트를 신뢰하지 않고
// 절단을 강제하고, 경로의 쿼리/해시(토큰류 유입 경로)를 잘라낸다.

const { sanitizeClientError } = await import("../dist/routes/client-errors.js");

describe("sanitizeClientError — G12", () => {
  it("valid body → trimmed/truncated fields", () => {
    const out = sanitizeClientError({
      message: "  TypeError: x is not a function  ",
      stack: "s".repeat(3000),
      path: "/projects/p1/checks",
      userKey: "u1",
      userAgent: "Mozilla",
    });
    assert.equal(out.message, "TypeError: x is not a function");
    assert.equal(out.stack.length, 2000);
    assert.equal(out.path, "/projects/p1/checks");
  });

  it("query string and hash are stripped from path (no token leakage)", () => {
    const out = sanitizeClientError({ message: "m", path: "/p/x/connect?code=SECRET#frag" });
    assert.equal(out.path, "/p/x/connect");
  });

  it("missing/empty message → null (rejected)", () => {
    assert.equal(sanitizeClientError({ path: "/a" }), null);
    assert.equal(sanitizeClientError({ message: "   " }), null);
    assert.equal(sanitizeClientError(null), null);
    assert.equal(sanitizeClientError("string"), null);
  });

  it("message capped at 500, userKey at 64", () => {
    const out = sanitizeClientError({ message: "m".repeat(900), userKey: "k".repeat(100) });
    assert.equal(out.message.length, 500);
    assert.equal(out.userKey.length, 64);
  });
});

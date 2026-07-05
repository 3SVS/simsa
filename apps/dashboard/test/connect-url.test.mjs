import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeDeployUrl } from "../src/lib/connect-url.mjs";

describe("normalizeDeployUrl", () => {
  it("accepts a full https URL and returns a normalised href", () => {
    const res = normalizeDeployUrl("https://my-app.vercel.app");
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://my-app.vercel.app/");
  });

  it("accepts a full http URL", () => {
    const res = normalizeDeployUrl("http://example.com/path");
    assert.equal(res.ok, true);
    assert.equal(res.url, "http://example.com/path");
  });

  it("defaults a scheme-less host to https", () => {
    const res = normalizeDeployUrl("my-app.vercel.app");
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://my-app.vercel.app/");
  });

  it("trims surrounding whitespace", () => {
    const res = normalizeDeployUrl("  https://example.com  ");
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://example.com/");
  });

  it("rejects empty / whitespace input", () => {
    assert.deepEqual(normalizeDeployUrl(""), { ok: false, reason: "empty" });
    assert.deepEqual(normalizeDeployUrl("   "), { ok: false, reason: "empty" });
    assert.deepEqual(normalizeDeployUrl(null), { ok: false, reason: "empty" });
    assert.deepEqual(normalizeDeployUrl(undefined), { ok: false, reason: "empty" });
  });

  it("rejects a non-http(s) scheme", () => {
    assert.equal(normalizeDeployUrl("ftp://example.com").ok, false);
    assert.equal(normalizeDeployUrl("ftp://example.com").reason, "scheme");
    assert.equal(normalizeDeployUrl("javascript://alert(1)").reason, "scheme");
  });

  it("rejects a host with no dot (bare word / localhost)", () => {
    assert.equal(normalizeDeployUrl("myapp").reason, "host");
    assert.equal(normalizeDeployUrl("http://localhost:3000").reason, "host");
  });

  it("preserves the path and query of a valid URL", () => {
    const res = normalizeDeployUrl("https://app.example.com/dashboard?tab=live");
    assert.equal(res.ok, true);
    assert.equal(res.url, "https://app.example.com/dashboard?tab=live");
  });
});

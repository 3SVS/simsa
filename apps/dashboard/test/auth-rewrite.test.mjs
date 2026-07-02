/**
 * auth-rewrite.test.mjs
 *
 * Stage 232 — same-origin auth rewrite config. Verifies the rewrite destination resolves
 * fail-safe (missing/empty/invalid env → documented default), trims trailing slashes, and that
 * the rewrite is scoped to /api/auth/:path* only (no shadowing of other dashboard routes).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CENTRAL_PLANE_AUTH_ORIGIN,
  resolveCentralPlaneAuthOrigin,
  buildAuthRewrites,
} from "../src/lib/auth-rewrite.mjs";

test("default origin is the documented production Worker origin", () => {
  assert.equal(DEFAULT_CENTRAL_PLANE_AUTH_ORIGIN, "https://conclave-ai.seunghunbae.workers.dev");
});

test("missing / empty / invalid env → documented default (fail-safe)", () => {
  for (const env of [
    undefined,
    {},
    { CENTRAL_PLANE_AUTH_ORIGIN: "" },
    { CENTRAL_PLANE_AUTH_ORIGIN: "   " },
    { CENTRAL_PLANE_AUTH_ORIGIN: "not-a-url" },
    { CENTRAL_PLANE_AUTH_ORIGIN: "ftp://evil" },
    { CENTRAL_PLANE_AUTH_ORIGIN: 123 },
  ]) {
    assert.equal(resolveCentralPlaneAuthOrigin(env), DEFAULT_CENTRAL_PLANE_AUTH_ORIGIN);
  }
});

test("valid http(s) origin is used and trailing slashes stripped", () => {
  assert.equal(
    resolveCentralPlaneAuthOrigin({ CENTRAL_PLANE_AUTH_ORIGIN: "https://api.trysimsa.com" }),
    "https://api.trysimsa.com",
  );
  assert.equal(
    resolveCentralPlaneAuthOrigin({ CENTRAL_PLANE_AUTH_ORIGIN: "https://api.trysimsa.com/" }),
    "https://api.trysimsa.com",
  );
  assert.equal(
    resolveCentralPlaneAuthOrigin({ CENTRAL_PLANE_AUTH_ORIGIN: "  https://api.trysimsa.com//  " }),
    "https://api.trysimsa.com",
  );
  assert.equal(
    resolveCentralPlaneAuthOrigin({ CENTRAL_PLANE_AUTH_ORIGIN: "http://localhost:8787" }),
    "http://localhost:8787",
  );
});

test("buildAuthRewrites maps /api/auth + /api/membership to the worker, tightly scoped", () => {
  const rules = buildAuthRewrites("https://conclave-ai.seunghunbae.workers.dev");
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    source: "/api/auth/:path*",
    destination: "https://conclave-ai.seunghunbae.workers.dev/api/auth/:path*",
  });
  assert.deepEqual(rules[1], {
    source: "/api/membership/:path*",
    destination: "https://conclave-ai.seunghunbae.workers.dev/workspace/membership/:path*",
  });
  // Scoped — does not match other dashboard routes.
  assert.ok(rules.every((r) => r.source.startsWith("/api/auth/") || r.source.startsWith("/api/membership/")));
  assert.ok(!rules.some((r) => r.source === "/:path*" || r.source === "/api/:path*"));
});

test("end-to-end: default env produces the worker-proxying rule", () => {
  const rules = buildAuthRewrites(resolveCentralPlaneAuthOrigin(undefined));
  assert.equal(rules[0].destination, "https://conclave-ai.seunghunbae.workers.dev/api/auth/:path*");
});

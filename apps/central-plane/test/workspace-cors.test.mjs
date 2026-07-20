// Stage 91 — route-level CORS coverage.
//
// Before Stage 91, the experiment / benchmark / credits / admin-credits /
// admin-stats route modules shipped NO CORS headers, so the dashboard's
// browser-side calls to those features were blocked from every origin. These
// tests pin that those routes now return exact-origin CORS for the Simsa app
// domain + legacy dashboard origin, never echo a disallowed origin, and answer
// preflight OPTIONS. (Fails before the fix, passes after.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/router.js";

const CTX = { waitUntil() {}, passThroughOnException() {} };

// Minimal DB mock — the routes under test validate userKey / admin key and
// return early (4xx) before touching the DB, so queries should not run; the
// mock just guarantees nothing throws if one does.
function makeEnv() {
  return {
    ENVIRONMENT: "test",
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() { return null; },
              async run() { return { success: true }; },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
  };
}

async function req(path, { method = "GET", origin } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  return createApp().fetch(new Request("http://x" + path, { method, headers }), makeEnv(), CTX);
}

const APP = "https://app.trysimsa.com";
const LEGACY = "https://conclave-dashboard.vercel.app";
const EVIL = "https://evil.com";
const FALLBACK = "http://localhost:3002"; // ALLOWED_ORIGINS[0]

// One representative path per previously-uncovered browser-facing module.
const ROUTES = [
  ["/workspace/projects/p_smoke/evolution-learning", "experiment (evolution-learning)"],
  ["/workspace/projects/p_smoke/agent-benchmarks", "benchmark"],
  ["/workspace/credits", "credits"],
  ["/admin/credits", "admin-credits"],
  ["/admin/usage-stats", "admin-stats"],
];

for (const [path, label] of ROUTES) {
  test(`Stage 91 CORS: ${label} echoes app.trysimsa.com`, async () => {
    const res = await req(path, { origin: APP });
    assert.equal(res.headers.get("access-control-allow-origin"), APP);
  });
}

test("Stage 91 CORS: legacy dashboard origin still echoed (experiment route)", async () => {
  const res = await req("/workspace/projects/p_smoke/evolution-learning", { origin: LEGACY });
  assert.equal(res.headers.get("access-control-allow-origin"), LEGACY);
});

test("Stage 91 CORS: disallowed origin is NOT echoed (fallback, not evil.com)", async () => {
  const res = await req("/workspace/projects/p_smoke/evolution-learning", { origin: EVIL });
  const acao = res.headers.get("access-control-allow-origin");
  assert.notEqual(acao, EVIL);
  assert.equal(acao, FALLBACK);
});

test("Stage 91 CORS: OPTIONS preflight 204 + ACAO on a previously-missing route (benchmark)", async () => {
  const res = await req("/workspace/projects/p_smoke/agent-benchmarks", { method: "OPTIONS", origin: APP });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), APP);
});

test("Stage 91 CORS: admin route carries ACAO even on guard response when Origin allowed", async () => {
  // /admin/credits without an admin key returns a 4xx guard response, but it
  // must still carry the CORS header so the dashboard can read the error.
  const res = await req("/admin/credits", { origin: APP });
  assert.equal(res.headers.get("access-control-allow-origin"), APP);
});

// 2026-07-19 P0 regression: GitHub connect (oauth/start) returns
// Response.redirect(), whose headers are IMMUTABLE. The global corsMiddleware
// (now mounted on 15+ modules) tried to .set() CORS headers on it →
// "Can't modify immutable headers" → the global onError turned it into a 500,
// so every GitHub connection attempt died. The middleware must survive an
// immutable response: preserve the redirect (302 + Location) AND add CORS.
test("P0: oauth/start redirect through global CORS does not 500 (immutable headers)", async () => {
  const env = makeEnv();
  env.WORKSPACE_GH_CLIENT_ID = "Iv1.testclientid"; // non-REPLACE → passes the config gate
  const res = await createApp().fetch(
    new Request("http://x/workspace/github/oauth/start?userKey=uk_test&returnTo=https://app.trysimsa.com/", {
      headers: { origin: APP },
    }),
    env,
    CTX,
  );
  assert.notEqual(res.status, 500, "redirect must not 500 through the CORS middleware");
  assert.equal(res.status, 302, "GitHub auth redirect preserved");
  assert.ok(res.headers.get("location")?.includes("github.com"), "Location header survives the rebuild");
});

// ─── 2026-07-20 P0: PUT이 어떤 Allow-Methods 선언에도 없어 브라우저에서만
// G8 ext-sync PUT이 전멸("서버 저장에 실패했어요" 유령 배너). node/curl 프로브는
// CORS를 안 타서 8/8 green이었다. 계약: Allow-Methods 문자열 리터럴은 cors.ts의
// CORS_ALLOW_METHODS 단일 정본만 존재하고, 정본은 완전한 메서드 목록을 갖는다.
test("P0: Allow-Methods single source of truth — complete list, no stray literals", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/routes");

  const { CORS_ALLOW_METHODS } = await import("../dist/routes/cors.js");
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.ok(CORS_ALLOW_METHODS.includes(m), `canonical list must include ${m}`);
  }

  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith(".ts") || file === "cors.ts") continue;
    const src = readFileSync(path.join(routesDir, file), "utf8");
    const literal = /"Access-Control-Allow-Methods"\s*:\s*"/.exec(src);
    assert.ok(!literal, `${file} declares a hardcoded Allow-Methods literal — use CORS_ALLOW_METHODS from cors.ts`);
  }
});

test("P0: /workspace/projects/:id/ext preflight allows PUT (the G8 sync method)", async () => {
  const res = await createApp().fetch(
    new Request("http://x/workspace/projects/proj_x/ext", {
      method: "OPTIONS",
      headers: { origin: APP, "access-control-request-method": "PUT" },
    }),
    makeEnv(),
    CTX,
  );
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /PUT/);
});

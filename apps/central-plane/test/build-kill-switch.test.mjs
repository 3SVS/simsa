/**
 * Hotfix 2026-10-01 — build route kill switch (BUILD_ENABLED).
 * While "off", POST /workspace/projects/:id/build must answer 503 build_disabled before any
 * provisioning: no Cloudflare/GitHub fetch, no D1 row, no container dispatch.
 * Production ships "off" (wrangler.toml [vars]) until the build executor bundle is live.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { createApp } = await import("../dist/router.js");
const { dispatchBuild } = await import("../dist/routes/workspace-build-jobs.js");
const { buildEnabled, BUILD_DISABLED } = await import("../dist/workspace/service-switches.js");

function spyDb() {
  const sqls = [];
  const stmt = (sql) => ({
    bind: () => stmt(sql),
    run: async () => { sqls.push(sql); return { meta: { changes: 0 } }; },
    first: async () => { sqls.push(sql); return null; },
    all: async () => { sqls.push(sql); return { results: [] }; },
  });
  return { sqls, prepare: (sql) => stmt(sql) };
}

function spyBuilder() {
  const calls = [];
  return { calls, idFromName: (n) => ({ n }), get: () => ({ fetch: async (...a) => { calls.push(a); return new Response("{}", { status: 202 }); } }) };
}

function env(overrides = {}) {
  return {
    DB: spyDb(), BUILDER: spyBuilder(), INTERNAL_CALLBACK_TOKEN: "tok_internal", PUBLIC_BASE_URL: "https://cp.example",
    HOSTING_CF_API_TOKEN: "cf-ops-FAKE", HOSTING_CF_ACCOUNT_ID: "acc1", HOSTING_ROOT_DOMAIN: "simsa.page",
    ANTHROPIC_API_KEY: "fake-anthropic", OPENAI_API_KEY: "fake-openai",
    ...overrides,
  };
}

async function withFetchSpy(fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("{}", { status: 500 }); };
  try { return { result: await fn(), calls }; } finally { globalThis.fetch = orig; }
}

async function postBuild(e, projectId = "wsp_빵집_예약") {
  const app = createApp();
  const res = await app.fetch(new Request(`https://cp.example/workspace/projects/${encodeURIComponent(projectId)}/build`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://app.trysimsa.com" },
    body: JSON.stringify({ userKey: "uk_빵집사장님", locale: "ko" }),
  }), e);
  return { status: res.status, body: await res.json() };
}

test("BUILD_ENABLED=off → 503 build_disabled, no fetch · no DB · no container", async () => {
  const e = env({ BUILD_ENABLED: "off" });
  const { result, calls } = await withFetchSpy(() => postBuild(e));
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, error: "build_disabled" });
  assert.deepEqual(calls, [], "no Cloudflare/GitHub call");
  assert.ok(!e.DB.sqls.some((s) => /build_jobs|workspace_projects/.test(s)), `no project/job SQL: ${e.DB.sqls.join(" | ")}`);
  assert.equal(e.BUILDER.calls.length, 0);
});

test("BUILD_ENABLED unset/on → the route runs as before (unknown project → 404, not build_disabled)", async () => {
  for (const v of [undefined, "on", "OFF"]) {
    const e = env(v === undefined ? {} : { BUILD_ENABLED: v });
    const { result } = await withFetchSpy(() => postBuild(e, "wsp_없는_프로젝트"));
    assert.notEqual(result.body.error, "build_disabled", `value ${String(v)}`);
    assert.equal(result.status, 404, `value ${String(v)}: ${JSON.stringify(result.body)}`);
  }
});

test("dispatchBuild refuses when off (second gate — any future caller)", async () => {
  const e = env({ BUILD_ENABLED: "off" });
  const r = await dispatchBuild(e, { jobId: "bj_1" });
  assert.deepEqual(r, { dispatched: false, note: BUILD_DISABLED });
  assert.equal(e.BUILDER.calls.length, 0);
});

test("switch rule: only the exact string off", () => {
  assert.equal(buildEnabled({ BUILD_ENABLED: "off" }), false);
  for (const v of [undefined, "", "on", "OFF", "false"]) assert.equal(buildEnabled({ BUILD_ENABLED: v }), true);
});

test("production [vars] ships BUILD_ENABLED = \"off\" until the executor bundle is live", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^BUILD_ENABLED = "off"$/m);
});

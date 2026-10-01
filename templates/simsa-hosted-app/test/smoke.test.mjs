/**
 * Simsa 호스팅 템플릿 — 최소 스모크 테스트 (빌드 게이트 D-4의 `pnpm test`).
 *
 * 빌드 잡은 `pnpm run build` 다음에 `pnpm test`를 돌린다. 이 파일은 **플랫폼이 소유**한다(빌드 잡이 바뀐 내용을
 * 템플릿 원본으로 되돌린다) — 개발 AI는 새 테스트 파일을 test/ 아래에 더할 수 있지만 이 파일은 약하게 만들 수 없다.
 *
 * 무엇을 보나(네트워크·Cloudflare 없이, 템플릿에 이미 있는 vite만으로):
 *  1) 클라이언트 빌드 산출물이 있고, index.html이 가리키는 스크립트 파일이 실제로 있다.
 *  2) Worker(src/worker.ts)를 번들해 불러올 수 있고(가져오는 순간 던지지 않는다),
 *     `/api/health`가 200 `{ ok: true }`, 모르는 `/api/*`는 404다.
 * 새 의존성을 쓰지 않는다 — 설치는 lockfile 고정(--frozen-lockfile)이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("클라이언트 빌드 산출물: dist/client/index.html과 그것이 가리키는 스크립트가 있다", () => {
  const html = path.join(ROOT, "dist/client/index.html");
  assert.ok(existsSync(html), "dist/client/index.html이 없다 — `pnpm run build`를 먼저 돌린다");
  const src = readFileSync(html, "utf8");
  const scripts = [...src.matchAll(/<script[^>]*\ssrc="\/?([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, "index.html에 script src가 없다");
  for (const s of scripts) assert.ok(existsSync(path.join(ROOT, "dist/client", s)), `index.html이 가리키는 ${s}가 없다`);
});

/** health·404만 부르므로 DB는 쓰이지 않는다 — 쓰이면 빈 결과. */
function stubDb() {
  const stmt = {
    bind: () => stmt,
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ meta: { changes: 0 } }),
  };
  return { prepare: () => stmt };
}

test("Worker: 번들해 불러올 수 있고 /api/health는 200 {ok:true}, 모르는 /api/*는 404", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "simsa-smoke-"));
  try {
    await build({
      root: ROOT,
      configFile: false,
      logLevel: "silent",
      ssr: { noExternal: true, target: "webworker" },
      build: {
        ssr: path.join(ROOT, "src/worker.ts"),
        outDir: out,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { format: "es", entryFileNames: "worker.mjs" } },
      },
    });
    const mod = await import(pathToFileURL(path.join(out, "worker.mjs")).href);
    const app = mod.default;
    assert.equal(typeof app?.fetch, "function", "src/worker.ts의 default export는 fetch(req, env)를 가진 앱이어야 한다");
    const env = { DB: stubDb(), ASSETS: { fetch: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) } };

    const health = await app.fetch(new Request("http://app.local/api/health"), env);
    assert.equal(health.status, 200, "/api/health");
    const body = await health.json();
    assert.equal(body.ok, true, "/api/health는 { ok: true }");

    const unknown = await app.fetch(new Request("http://app.local/api/__simsa_smoke_unknown__"), env);
    assert.equal(unknown.status, 404, "모르는 /api/* 경로는 404");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

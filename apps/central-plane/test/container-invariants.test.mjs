/**
 * v0.14.4 — Sprint E6: live invariants across container.ts /
 * Dockerfile / server.mjs / wrangler.toml.
 *
 * These three files express the same port + image config in different
 * surfaces. When they drift (e.g. someone bumps defaultPort but forgets
 * to bump EXPOSE), the container deploys but the Worker can't reach it
 * and every /saas/review hangs. This test pins the alignment so drift
 * fails CI before deploy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const containerTs = readFileSync(path.join(ROOT, "src/container.ts"), "utf8");
const dockerfile = readFileSync(path.join(ROOT, "container/Dockerfile"), "utf8");
const serverMjs = readFileSync(path.join(ROOT, "container/server.mjs"), "utf8");
const wranglerToml = readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");

// ---- port alignment -----------------------------------------------------

test("defaultPort in container.ts matches EXPOSE in Dockerfile", () => {
  const doMatch = /defaultPort\s*=\s*(\d+)/.exec(containerTs);
  assert.ok(doMatch, "container.ts must declare defaultPort = <port>");
  const exposeMatch = /^EXPOSE\s+(\d+)/m.exec(dockerfile);
  assert.ok(exposeMatch, "Dockerfile must EXPOSE a port");
  assert.equal(
    doMatch[1],
    exposeMatch[1],
    `Port drift: container.ts defaultPort=${doMatch[1]} vs Dockerfile EXPOSE=${exposeMatch[1]}. ` +
    "Cloudflare routes to the DO's defaultPort; Dockerfile EXPOSE is the container's own listen port. They must match.",
  );
});

test("server.mjs PORT default matches container.ts defaultPort", () => {
  const doMatch = /defaultPort\s*=\s*(\d+)/.exec(containerTs);
  const serverMatch = /PORT\s*=\s*Number\(process\.env\.PORT\s*\?\?\s*(\d+)\)/.exec(serverMjs);
  assert.ok(serverMatch, "server.mjs must read PORT from env with a default literal");
  assert.equal(
    doMatch[1],
    serverMatch[1],
    `Port drift: container.ts defaultPort=${doMatch[1]} vs server.mjs PORT default=${serverMatch[1]}.`,
  );
});

// ---- DO class registration ---------------------------------------------

test("ConclaveSandbox class_name in wrangler.toml matches the export in src/index.ts", () => {
  // wrangler.toml's [[containers]] + [[durable_objects.bindings]] both
  // reference ConclaveSandbox. The Worker entry MUST export this class
  // by name or the CF runtime can't instantiate it.
  const wranglerClass = /class_name\s*=\s*"([^"]+)"/.exec(wranglerToml);
  assert.ok(wranglerClass, "wrangler.toml must declare class_name");
  const indexTs = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
  const exportLine = new RegExp(`export\\s+\\{\\s*${wranglerClass[1]}\\s*\\}`).test(indexTs);
  assert.ok(
    exportLine,
    `src/index.ts must export { ${wranglerClass[1]} } so the CF runtime can instantiate the Durable Object.`,
  );
});

test("wrangler.toml SANDBOX binding name matches Env.SANDBOX type field", () => {
  // The binding `name = "..."` is the value the Worker runtime injects
  // into env. It MUST exist as a typed field on Env or downstream code
  // that does `c.env.<NAME>` won't typecheck.
  // Regex is anchored on `^name = "..."` (line-start) within the
  // [[durable_objects.bindings]] block so it doesn't accidentally match
  // `class_name = "..."`.
  const bindingMatch = /\[\[durable_objects\.bindings\]\][\s\S]*?^name\s*=\s*"([^"]+)"/m.exec(wranglerToml);
  assert.ok(bindingMatch, "wrangler.toml must define a durable_objects binding name");
  const envTs = readFileSync(path.join(ROOT, "src/env.ts"), "utf8");
  const fieldMatch = new RegExp(`${bindingMatch[1]}\\?:\\s*DurableObjectNamespace`).test(envTs);
  assert.ok(
    fieldMatch,
    `Env.${bindingMatch[1]}?: DurableObjectNamespace must exist in src/env.ts to match the wrangler binding name.`,
  );
});

test("wrangler.toml [[containers]] image path resolves relative to apps/central-plane/", () => {
  const imageMatch = /\[\[containers\]\][\s\S]*?image\s*=\s*"([^"]+)"/.exec(wranglerToml);
  assert.ok(imageMatch, "wrangler.toml must specify an image path");
  // image is resolved relative to the wrangler.toml file's directory.
  const resolvedDockerfile = path.resolve(ROOT, imageMatch[1]);
  const stat = (() => {
    try { return readFileSync(resolvedDockerfile, "utf8"); }
    catch (e) { return null; }
  })();
  assert.ok(
    stat,
    `wrangler.toml [[containers]].image="${imageMatch[1]}" must resolve to an existing Dockerfile (resolved: ${resolvedDockerfile}).`,
  );
});

// ---- server.mjs structure regressions ----------------------------------

test("server.mjs imports the three pure helpers from coerce-result.mjs", () => {
  // Regression-safe — if someone removes the import while keeping the
  // call sites, server.mjs would crash at startup. Pin the import.
  assert.match(
    serverMjs,
    /from\s+["']\.\/coerce-result\.mjs["']/,
    "server.mjs must import from ./coerce-result.mjs",
  );
  assert.match(serverMjs, /coerceResult/, "server.mjs must reference coerceResult");
  assert.match(serverMjs, /extractHeaderEnv/, "server.mjs must reference extractHeaderEnv");
  assert.match(serverMjs, /validateRunPayload/, "server.mjs must reference validateRunPayload");
});

test("Dockerfile copies coerce-result.mjs alongside server.mjs", () => {
  // Both files must end up in the same dir inside the image so the
  // relative `./coerce-result.mjs` import resolves at runtime.
  assert.match(
    dockerfile,
    /COPY\s+apps\/central-plane\/container\/coerce-result\.mjs/,
    "Dockerfile must COPY container/coerce-result.mjs",
  );
});

// ---- Stage 270: auto-repair lock-step invariants -------------------------

test("Stage 270: Dockerfile compiles the CANONICAL repair-brief.ts the Worker builds (lock-step)", () => {
  // The container must run the exact same brief-parsing logic as
  // dist/workspace/repair-brief.js. The Dockerfile COPYs the canonical
  // source and compiles it in-image (inspector-container Stage 263
  // pattern) — never a hand-duplicated .mjs.
  assert.match(
    dockerfile,
    /COPY\s+apps\/central-plane\/src\/workspace\/repair-brief\.ts/,
    "Dockerfile must COPY src/workspace/repair-brief.ts (canonical source)",
  );
  assert.match(
    dockerfile,
    /tsc\s+container-src\/repair-brief\.ts/,
    "Dockerfile must compile repair-brief.ts with tsc",
  );
  assert.match(
    dockerfile,
    /container-dist\/package\.json/,
    "Dockerfile must write container-dist/package.json ({\"type\":\"module\"}) or the ESM output won't load",
  );
});

test("Stage 270: server.mjs drives the worker seam against the compiled brief module", () => {
  assert.match(
    serverMjs,
    /container-dist\/repair-brief\.js/,
    "server.mjs must import the in-image compiled repair-brief module",
  );
  assert.match(
    serverMjs,
    /packages\/agent-worker\/dist\/index\.js/,
    "server.mjs must lazy-import ClaudeWorker from the agent-worker dist",
  );
  assert.match(serverMjs, /x-anthropic-key/, "server.mjs must read the forwarded LLM key header for repair jobs");
  assert.match(serverMjs, /brief_only/, "server.mjs must report the brief_only fallback mode");
  assert.match(serverMjs, /auto_fix/, "server.mjs must report the auto_fix mode");
});

test("Stage 270: Dockerfile still builds @simsa/cli (whose dep graph provides agent-worker dist)", () => {
  // ClaudeWorker is imported from /app/packages/agent-worker/dist —
  // produced transitively because turbo's build dependsOn ^build and cli
  // depends on agent-worker. If the cli filter disappears, the repair
  // job's worker import breaks at runtime.
  assert.match(
    dockerfile,
    /--filter @simsa\/cli/,
    "Dockerfile must keep building @simsa/cli",
  );
});

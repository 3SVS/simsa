/**
 * SI 티어 Train B — B1: builder-container.ts / builder-container/Dockerfile /
 * builder-container/server.mjs / wrangler.toml / env.ts / index.ts / router.ts 간 불변식.
 *
 * inspector-invariants.test.mjs와 같은 규율: 포트·이미지 경로·DO 등록·playwright 버전이
 * 여러 표면에 흩어져 있어 어긋나도 배포는 되고 런타임에서만 깨진다. CI에서 먼저 잡는다.
 * 추가로 D-6(유저 배포 CLI 없음)을 이미지 수준에서 고정한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "../..");

const builderTs = readFileSync(path.join(ROOT, "src/builder-container.ts"), "utf8");
const dockerfile = readFileSync(path.join(ROOT, "builder-container/Dockerfile"), "utf8");
const serverMjs = readFileSync(path.join(ROOT, "builder-container/server.mjs"), "utf8");
const wranglerToml = readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
const indexTs = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
const routerTs = readFileSync(path.join(ROOT, "src/router.ts"), "utf8");
const envTs = readFileSync(path.join(ROOT, "src/env.ts"), "utf8");
const containerPkg = JSON.parse(readFileSync(path.join(ROOT, "builder-container/package.json"), "utf8"));
const inspectorDockerfile = readFileSync(path.join(ROOT, "inspector-container/Dockerfile"), "utf8");

test("SimsaBuilder defaultPort matches builder Dockerfile EXPOSE and server.mjs default", () => {
  const doMatch = /defaultPort\s*=\s*(\d+)/.exec(builderTs);
  assert.ok(doMatch, "builder-container.ts must declare defaultPort");
  const exposeMatch = /^EXPOSE\s+(\d+)/m.exec(dockerfile);
  assert.ok(exposeMatch, "builder Dockerfile must EXPOSE a port");
  assert.equal(doMatch[1], exposeMatch[1], "DO defaultPort vs Dockerfile EXPOSE drift");
  const serverMatch = /PORT\s*=\s*Number\(process\.env\.PORT\s*\?\?\s*(\d+)\)/.exec(serverMjs);
  assert.ok(serverMatch, "server.mjs must read PORT from env with a default literal");
  assert.equal(doMatch[1], serverMatch[1], "DO defaultPort vs server.mjs PORT default drift");
});

test("WORK_ROOT agrees between the DO envVars, server.mjs default and the Dockerfile mkdir", () => {
  const doRoot = /WORK_ROOT:\s*"([^"]+)"/.exec(builderTs);
  assert.ok(doRoot, "builder-container.ts must set WORK_ROOT");
  assert.match(serverMjs, new RegExp(`WORK_ROOT\\s*=\\s*process\\.env\\.WORK_ROOT\\s*\\?\\?\\s*"${doRoot[1].replace(/\//g, "\\/")}"`));
  assert.match(dockerfile, new RegExp(`mkdir -p ${doRoot[1].replace(/\//g, "\\/")}`), "Dockerfile must pre-create WORK_ROOT");
});

test("wrangler.toml declares SimsaBuilder container + BUILDER binding + v3 migration + standard instance (D-10)", () => {
  const block = /\[\[containers\]\]\s*\nclass_name\s*=\s*"SimsaBuilder"[\s\S]*?image\s*=\s*"([^"]+)"[\s\S]*?max_instances\s*=\s*(\d+)\s*\ninstance_type\s*=\s*"([^"]+)"/.exec(wranglerToml);
  assert.ok(block, "wrangler.toml must have a [[containers]] block for SimsaBuilder with max_instances + instance_type");
  const resolved = path.resolve(ROOT, block[1]);
  assert.doesNotThrow(() => readFileSync(resolved, "utf8"), `image path must resolve (${resolved})`);
  assert.equal(block[3], "standard", "D-10 [PILOT]: builder runs on instance_type standard (2 vCPU/4 GiB)");
  assert.ok(Number(block[2]) >= 1 && Number(block[2]) <= 20, "max_instances within pilot range");
  assert.match(
    wranglerToml,
    /\[\[durable_objects\.bindings\]\]\s*\nclass_name\s*=\s*"SimsaBuilder"\s*\nname\s*=\s*"BUILDER"/,
    "BUILDER DO binding must exist for SimsaBuilder",
  );
  assert.match(
    wranglerToml,
    /tag\s*=\s*"v3-builder"\s*\nnew_sqlite_classes\s*=\s*\["SimsaBuilder"\]/,
    "v3-builder DO migration must register SimsaBuilder",
  );
});

test("SimsaBuilder is exported from index.ts and NEVER imported into router.ts", () => {
  assert.match(indexTs, /export\s+\{\s*SimsaBuilder\s*\}/, "src/index.ts must export SimsaBuilder");
  assert.doesNotMatch(routerTs, /from\s+["'][^"']*builder-container/, "router.ts must not import builder-container");
  assert.doesNotMatch(routerTs, /from\s+["']@cloudflare\/containers/, "router.ts must not import @cloudflare/containers");
  // 프로브 라우트는 router.ts에 마운트되지만 DO 클래스가 아니라 바인딩(env.BUILDER)만 쓴다.
  assert.match(routerTs, /createBuilderProbeRoutes\(\)/, "router.ts must mount the builder probe routes");
});

test("Env.BUILDER is typed as an optional DurableObjectNamespace", () => {
  assert.match(envTs, /BUILDER\?:\s*DurableObjectNamespace/, "env.ts must type the BUILDER binding");
});

test("playwright version pinned identically in builder base image, builder package.json, inspector image, and the spike", () => {
  const baseTag = /FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/.exec(dockerfile);
  assert.ok(baseTag, "builder Dockerfile must use a pinned mcr.microsoft.com/playwright base tag");
  assert.equal(containerPkg.dependencies?.playwright, baseTag[1], "builder-container/package.json playwright must match the base tag");
  const inspectorTag = /FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/.exec(inspectorDockerfile);
  assert.equal(baseTag[1], inspectorTag?.[1], "builder and inspector must share the playwright base tag (same browser in build test + inspection)");
  const spikePkg = JSON.parse(readFileSync(path.join(REPO, "tools/simsa-completion-loop-spike/package.json"), "utf8"));
  assert.equal(spikePkg.devDependencies?.playwright, baseTag[1], "spike playwright version must match the builder image");
});

test("Dockerfile installs the T1 toolchain (pnpm · wrangler · git · gh) and copies the runner scripts", () => {
  assert.match(dockerfile, /npm install -g pnpm@\d+ wrangler@\d+/, "must install pinned-major pnpm + wrangler");
  assert.match(dockerfile, /apt-get install -y --no-install-recommends git/, "must install git");
  assert.match(dockerfile, /apt-get install -y --no-install-recommends gh/, "must install gh");
  assert.match(dockerfile, /COPY\s+apps\/central-plane\/builder-container\/server\.mjs/, "must COPY server.mjs");
  assert.match(dockerfile, /COPY\s+apps\/central-plane\/builder-container\/builder-run\.mjs/, "must COPY builder-run.mjs");
  assert.match(dockerfile, /CMD \["node", "\/builder\/server\.mjs"\]/, "CMD must start server.mjs");
});

test("D-6: the builder image never installs user-deploy CLIs (vercel · netlify) and the runner self-check forbids them", () => {
  assert.doesNotMatch(dockerfile, /npm install[^\n]*\b(vercel|netlify)\b/, "Dockerfile must not npm-install vercel/netlify");
  const runMjs = readFileSync(path.join(ROOT, "builder-container/builder-run.mjs"), "utf8");
  assert.match(runMjs, /FORBIDDEN_DEPLOY_CLIS\s*=\s*Object\.freeze\(\["vercel",\s*"netlify"\]\)/, "self-check must probe for forbidden deploy CLIs");
});

test("server.mjs keeps the inspector-style rails: 202 ack, SIGTERM drain, no secret logging", () => {
  assert.match(serverMjs, /json\(res, 202,/, "POST /run must ack with 202 before running");
  assert.match(serverMjs, /for \(const sig of \["SIGTERM", "SIGINT"\]\)/, "must drain on SIGTERM/SIGINT");
  assert.doesNotMatch(serverMjs, /console\.(log|error)\([^)]*(callbackToken|userKey)/, "never log callbackToken/userKey");
});

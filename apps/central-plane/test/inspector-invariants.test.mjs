/**
 * Stage 263 — live invariants across inspector-container.ts /
 * inspector-container/Dockerfile / inspector-container/server.mjs /
 * wrangler.toml / env.ts / index.ts / router.ts.
 *
 * Same discipline as container-invariants.test.mjs (the autofix sandbox):
 * the port, image path, DO class registration and playwright version are
 * expressed in several surfaces; drift deploys fine but breaks at runtime.
 * Pin the alignment so CI fails before deploy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "../..");

const inspectorTs = readFileSync(path.join(ROOT, "src/inspector-container.ts"), "utf8");
const dockerfile = readFileSync(path.join(ROOT, "inspector-container/Dockerfile"), "utf8");
const serverMjs = readFileSync(path.join(ROOT, "inspector-container/server.mjs"), "utf8");
const wranglerToml = readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
const indexTs = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
const routerTs = readFileSync(path.join(ROOT, "src/router.ts"), "utf8");
const envTs = readFileSync(path.join(ROOT, "src/env.ts"), "utf8");
const containerPkg = JSON.parse(readFileSync(path.join(ROOT, "inspector-container/package.json"), "utf8"));

// ---- port alignment -------------------------------------------------------

test("SimsaInspector defaultPort matches inspector Dockerfile EXPOSE and server.mjs default", () => {
  const doMatch = /defaultPort\s*=\s*(\d+)/.exec(inspectorTs);
  assert.ok(doMatch, "inspector-container.ts must declare defaultPort");
  const exposeMatch = /^EXPOSE\s+(\d+)/m.exec(dockerfile);
  assert.ok(exposeMatch, "inspector Dockerfile must EXPOSE a port");
  assert.equal(doMatch[1], exposeMatch[1], "DO defaultPort vs Dockerfile EXPOSE drift");
  const serverMatch = /PORT\s*=\s*Number\(process\.env\.PORT\s*\?\?\s*(\d+)\)/.exec(serverMjs);
  assert.ok(serverMatch, "server.mjs must read PORT from env with a default literal");
  assert.equal(doMatch[1], serverMatch[1], "DO defaultPort vs server.mjs PORT default drift");
});

// ---- DO class registration --------------------------------------------------

test("wrangler.toml declares SimsaInspector container + INSPECTOR binding + v2 migration", () => {
  const containersBlock = /\[\[containers\]\]\s*\nclass_name\s*=\s*"SimsaInspector"[\s\S]*?image\s*=\s*"([^"]+)"/.exec(wranglerToml);
  assert.ok(containersBlock, "wrangler.toml must have a [[containers]] block for SimsaInspector");
  const resolved = path.resolve(ROOT, containersBlock[1]);
  assert.doesNotThrow(() => readFileSync(resolved, "utf8"), `image path must resolve (${resolved})`);

  assert.match(
    wranglerToml,
    /\[\[durable_objects\.bindings\]\]\s*\nclass_name\s*=\s*"SimsaInspector"\s*\nname\s*=\s*"INSPECTOR"/,
    "INSPECTOR DO binding must exist for SimsaInspector",
  );
  assert.match(
    wranglerToml,
    /tag\s*=\s*"v2-inspector"\s*\nnew_sqlite_classes\s*=\s*\["SimsaInspector"\]/,
    "v2-inspector DO migration must register SimsaInspector",
  );
});

test("SimsaInspector is exported from index.ts and NEVER imported into router.ts", () => {
  assert.match(indexTs, /export\s+\{\s*SimsaInspector\s*\}/, "src/index.ts must export SimsaInspector");
  // router.ts must stay free of the cloudflare:workers import chain so
  // node --test consumers of createApp keep working (see router.ts header).
  // Match import statements only — the header comment MENTIONS the package.
  assert.doesNotMatch(routerTs, /from\s+["'][^"']*inspector-container/, "router.ts must not import inspector-container");
  assert.doesNotMatch(routerTs, /from\s+["']@cloudflare\/containers/, "router.ts must not import @cloudflare/containers");
});

test("Env.INSPECTOR is typed as an optional DurableObjectNamespace", () => {
  assert.match(envTs, /INSPECTOR\?:\s*DurableObjectNamespace/, "env.ts must type the INSPECTOR binding");
});

// ---- playwright version lock-step ------------------------------------------

test("playwright version pinned identically in base image, container package.json, and the spike", () => {
  const baseTag = /FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/.exec(dockerfile);
  assert.ok(baseTag, "Dockerfile must use a pinned mcr.microsoft.com/playwright base tag");
  assert.equal(
    containerPkg.dependencies?.playwright,
    baseTag[1],
    "inspector-container/package.json playwright must exactly match the base image tag " +
      "(browsers baked at /ms-playwright are version-locked to the library)",
  );
  const spikePkg = JSON.parse(
    readFileSync(path.join(REPO, "tools/simsa-completion-loop-spike/package.json"), "utf8"),
  );
  assert.equal(
    spikePkg.devDependencies?.playwright,
    baseTag[1],
    "spike playwright version must match the container so local + cloud runs use the same browser",
  );
});

// ---- canonical Simsa modules compiled in-image -------------------------------

test("Dockerfile copies the canonical Simsa modules + runner scripts into the image", () => {
  assert.match(dockerfile, /COPY\s+apps\/central-plane\/src\/visual-flow-plan\.ts/, "must COPY visual-flow-plan.ts");
  assert.match(dockerfile, /apps\/central-plane\/src\/nondev-report\.ts/, "must COPY nondev-report.ts");
  assert.match(dockerfile, /COPY\s+apps\/central-plane\/inspector-container\/server\.mjs/, "must COPY server.mjs");
  assert.match(dockerfile, /COPY\s+apps\/central-plane\/inspector-container\/inspector-run\.mjs/, "must COPY inspector-run.mjs");
  assert.match(dockerfile, /COPY\s+apps\/central-plane\/inspector-container\/safety\.mjs/, "must COPY safety.mjs");
});

test("the canonical Simsa modules stay dependency-free (standalone tsc compilable)", () => {
  // The Dockerfile compiles these two files with a bare tsc invocation —
  // an `import` added to either would silently break the image build.
  for (const f of ["src/visual-flow-plan.ts", "src/nondev-report.ts"]) {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /^\s*import\s/m, `${f} must not import anything (compiled standalone in the inspector image)`);
  }
});

// ---- runner safety rails -----------------------------------------------------

test("inspector runner keeps the forbidden-action + headless/viewport/timeout rails", () => {
  const runMjs = readFileSync(path.join(ROOT, "inspector-container/inspector-run.mjs"), "utf8");
  for (const word of ["payment", "delete", "invite", "publish", "deploy", "결제", "삭제", "발행", "배포", "로그아웃"]) {
    assert.ok(runMjs.includes(word), `forbidden-action list must include "${word}"`);
  }
  assert.match(runMjs, /classifyActionSafety/, "runner must re-check safety at click time");
  assert.match(runMjs, /headless:\s*true/, "runner must run headless");
  assert.match(runMjs, /width:\s*1280,\s*height:\s*800/, "viewport must be 1280x800");
  assert.match(serverMjs, /INSPECTION_TIMEOUT_MS\s*=\s*4\s*\*\s*60\s*\*\s*1000/, "wall-clock rail must be ~4 minutes");
});

test("inspector runner captures UNCAUGHT exceptions (pageerror), not just console.error", () => {
  // 2026-07-17 eval F4: a load-time crash fires "pageerror" — without this
  // listener consoleErrors stays empty and the D9 dead-button conjunction
  // can never fire, so a crashed app reads as "확인 필요" instead of broken.
  const runMjs = readFileSync(path.join(ROOT, "inspector-container/inspector-run.mjs"), "utf8");
  assert.match(runMjs, /page\.on\("pageerror"/, "runner must listen for pageerror");
});

test("E-corpus-1 #415: runner force-closes at budget and never re-throws (always partial report)", () => {
  // 2026-07-19: gard-only 접근(#412/#414)이 무거운 사이트에서 실패 → 러너를
  // "예산 도달 시 context 강제 종료 + catch에서 지금까지 evidence로 판정" 구조로
  // 재작성. killTimer가 context.close()로 진행 중 작업을 터뜨리고, catch가 그
  // throw를 삼켜 부분 리포트를 반환한다. 이 세 요소가 모두 있어야 빈손 타임아웃이
  // 구조적으로 불가능해진다.
  const runMjs = readFileSync(path.join(ROOT, "inspector-container/inspector-run.mjs"), "utf8");
  assert.match(runMjs, /killTimer\s*=\s*setTimeout/, "runner must arm a budget kill-timer");
  // #421: the close is now .then/.catch-chained for phase logging — assert the
  // structural fact (browser.close() invoked with a rejection handler inside
  // the kill-timer), not the exact chaining shape.
  assert.match(runMjs, /browser\s*\n?\s*\.close\(\)[\s\S]{0,200}\.catch\(/, "kill-timer must force-close the BROWSER (graceful context.close can't break a hang)");
  assert.match(runMjs, /\}\s*catch\s*\(err\)\s*\{[\s\S]*timedOutPartial[\s\S]*\}\s*finally/, "the main try must catch (not re-throw) and finalize");
});

test("E-corpus-1: soft budget is passed to the runner and sits BELOW the hard rail", () => {
  // 2026-07-19 corpus eval: heavy marketing sites hit the 4-min rail and
  // returned an EMPTY timeout failure. The soft budget must be strictly less
  // than the hard rail (so the runner self-terminates with a partial report
  // before the reject), and the runner must consume it via `budgetMs`.
  assert.match(serverMjs, /INSPECTION_SOFT_BUDGET_MS\s*=\s*INSPECTION_TIMEOUT_MS\s*-\s*\d/, "soft budget must be derived below the hard rail");
  assert.match(serverMjs, /runInspection\(\{[^}]*budgetMs:\s*INSPECTION_SOFT_BUDGET_MS/s, "runInspection must receive the soft budget");
  const runMjs = readFileSync(path.join(ROOT, "inspector-container/inspector-run.mjs"), "utf8");
  assert.match(runMjs, /budgetMs/, "runner must accept budgetMs");
  assert.match(runMjs, /timedOutPartial/, "runner must mark partial runs");
});

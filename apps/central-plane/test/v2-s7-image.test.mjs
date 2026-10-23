// v2 S7b (2026-10-23) — v2 실행기가 검사 컨테이너 이미지 안에서 **전부** 있는가.
// 실행기(.mjs)가 읽는 ./x.mjs·importPure("x.js")를 따라가고, 그 TS 원본이 import하는 ./y.js까지 닫힘을 구해
// Dockerfile COPY·tsc 목록·container-images 경로 필터에 모두 있는지 본다(새 파일 하나 빠지면 이미지 안에서만 깨진다 — 로컬 테스트는 못 본다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cp = join(here, "..");
const repo = join(cp, "..", "..");
const dockerfile = readFileSync(join(cp, "inspector-container", "Dockerfile"), "utf8");
const filter = readFileSync(join(repo, ".github", "workflows", "container-images.yml"), "utf8");

function closure() {
  const mjs = new Set();
  const ts = new Set();
  const visitMjs = (name) => {
    if (mjs.has(name)) return;
    mjs.add(name);
    const text = readFileSync(join(cp, "inspector-container", name), "utf8");
    for (const m of text.matchAll(/import\(\s*["']\.\/([\w-]+\.mjs)["']\s*\)|from\s+["']\.\/([\w-]+\.mjs)["']/g)) visitMjs(m[1] ?? m[2]);
    for (const m of text.matchAll(/importPure\(\s*["']([\w-]+)\.js["']\s*\)|dist\(\s*["']([\w-]+)\.js["']\s*\)/g)) visitTs(m[1] ?? m[2]);
  };
  const visitTs = (base) => {
    if (ts.has(base)) return;
    const path = join(cp, "src", `${base}.ts`);
    if (!existsSync(path)) return;
    ts.add(base);
    const text = readFileSync(path, "utf8");
    for (const m of text.matchAll(/from\s+["']\.\/([\w-]+)\.js["']/g)) visitTs(m[1]);
  };
  visitMjs("agent-v2-run.mjs");
  // 서버의 v2 분기가 읽는 것
  visitTs("v2-report");
  visitTs("agent-inspection");
  visitTs("nondev-report");
  return { mjs: [...mjs], ts: [...ts] };
}

test("server.mjs가 v2 분기에서 agent-v2-run.mjs와 v2-report를 읽는다", () => {
  const server = readFileSync(join(cp, "inspector-container", "server.mjs"), "utf8");
  assert.match(server, /payload\.agent\?\.version === "v2"/);
  assert.match(server, /import\("\.\/agent-v2-run\.mjs"\)/);
  assert.match(server, /dist\("v2-report\.js"\)/);
});

test("v2 실행 닫힘의 .mjs가 전부 COPY된다", () => {
  const { mjs } = closure();
  assert.ok(mjs.includes("agent-v2-run.mjs") && mjs.includes("recon-collect.mjs") && mjs.includes("single-file-fix.mjs"), mjs.join(","));
  for (const f of mjs) assert.match(dockerfile, new RegExp(`COPY\\s+apps/central-plane/inspector-container/${f.replace(".", "\\.")}\\s`), `Dockerfile must COPY ${f}`);
});

test("v2 실행 닫힘의 TS 원본이 전부 COPY·tsc·경로 필터에 있다", () => {
  const { ts } = closure();
  for (const b of ["v2-agent", "v2-judge", "v2-report", "evidence-chain", "recon", "v2-plan", "ac-semantics"]) assert.ok(ts.includes(b), `closure should include ${b}: ${ts.join(",")}`);
  const copyLine = dockerfile.split("\n").find((l) => /^COPY\s+apps\/central-plane\/src\/.*\.\/src\/\s*$/.test(l)) ?? "";
  const tscBlock = dockerfile.slice(dockerfile.indexOf("RUN npx tsc"), dockerfile.indexOf("--outDir"));
  for (const b of ts) {
    assert.ok(copyLine.includes(`apps/central-plane/src/${b}.ts`), `Dockerfile COPY must include src/${b}.ts`);
    assert.ok(tscBlock.includes(`src/${b}.ts`), `Dockerfile tsc must include src/${b}.ts`);
    assert.ok(filter.includes(`'apps/central-plane/src/${b}.ts'`), `container-images path filter must include src/${b}.ts`);
  }
});

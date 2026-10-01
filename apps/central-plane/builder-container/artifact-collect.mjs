#!/usr/bin/env node
/**
 * SI 티어 Train B — B-5b-4: 빌드 산출물 수집기 (컨테이너 안, **샌드박스 사용자로** 실행).
 *
 * 빌드 게이트가 초록불이 된 작업 폴더에서 Worker로 보낼 산출물을 모은다:
 *   worker     — `wrangler deploy --dry-run --outdir <workerOut>`(토큰 없이 번들만)이 만든 모듈. README.md·*.map은 뺀다.
 *                실측(2026-10-01, 템플릿 lockfile의 wrangler 4.141.0, 자격 증명 없음): exit 0, outdir = README.md ·
 *                worker.js · worker.js.map. 정적 자산은 outdir로 복사되지 않는다(아래 assets로 따로 모은다).
 *                main 모듈 이름 = wrangler.toml `main`의 파일 이름 + ".js"(esbuild entryNames = 엔트리 파일 이름).
 *   assets     — wrangler.toml [assets] directory(템플릿: ./dist/client)의 파일. 경로는 "/" + 상대 경로(Workers 정적 자산
 *                manifest 모양). `.assetsignore`·`_worker.js`(Pages 잔재 — wrangler도 거부)는 뺀다.
 *   migrations — migrations/*.sql(최상위만, 이름순). 이름은 MIGRATION_NAME_RE — 따옴표·공백이 끼지 않는다(Worker가 d1_migrations
 *                기록 SQL에 이름을 넣는다).
 *   source     — 저장소에 올릴 소스 트리. 스캐폴드와 **같은 제외 규칙**(builder-run.mjs isScaffoldExcluded — node_modules·dist·
 *                dotfile 기본 거부(.gitignore·.env.example만 허용)·키 묶음).
 *
 * 왜 별도 프로세스인가: 작업 폴더는 생성 코드(샌드박스 사용자)가 쓸 수 있다. root 서버가 직접 읽으면 생성 코드가 심은 링크
 * (중간 폴더를 /proc/<서버 pid>/environ 등으로 바꿔치기 — 검사와 읽기 사이 경합)를 root 권한으로 따라갈 수 있다. 그래서
 * 이 수집기는 **샌드박스 uid로** 돈다(builder-run.mjs가 sandboxExec uid/gid로 띄운다) — 따라가 봐야 샌드박스가 원래 읽을 수 있는
 * 것뿐이다(생성 코드가 이미 소스에 넣을 수 있는 것). 그래도 링크는 따라가지 않는다(lstat — 산출물에 링크를 싣지 않는다).
 *
 * 상한(BUILD_ARTIFACT_LIMITS)은 Worker(src/workspace/build-artifact.ts)와 **같은 값**이다(테스트가 두 쪽을 비교). 여기서 먼저
 * 걸러 큰 산출물이 컨테이너 메모리·네트워크를 쓰지 않게 하고, 권위는 Worker다(다시 센다).
 *
 * 출력: stdout에 JSON 한 줄 — { ok:true, artifact } | { ok:false, error }. 내용은 전부 base64(바이너리 자산·한글 파일 모두 안전).
 * 파일 이름은 원본 그대로(NFC) — 표시·저장소 push용. Worker가 R2 키를 ASCII로 만든다(키에 파일 이름을 넣지 않는다 — Rule 6).
 * 비밀은 다루지 않는다(이 프로세스의 env = 허용 목록 — jobToken 없음).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isScaffoldExcluded } from "./builder-run.mjs";

/**
 * [PILOT] 산출물 상한 — Worker BUILD_ARTIFACT_LIMITS와 같은 값(test/train-b-b5b-s3-deploy.test.mjs가 비교).
 * PR #569 S3 검증 결함 4: Worker isolate 메모리(128MB) 기준으로 낮췄다(본문 26 → 13 MiB). 이유는 Worker 쪽 머리말.
 */
export const ARTIFACT_LIMITS = Object.freeze({
  /** Worker가 받는 요청 본문(ASCII JSON) 상한 — base64(×4/3)와 JSON 틀(이스케이프된 한글 경로 포함)을 덮는다. */
  maxBodyBytes: 13 * 1024 * 1024,
  maxModules: 20,
  maxModuleBytes: 3 * 1024 * 1024,
  maxAssets: 300,
  maxAssetBytes: 3 * 1024 * 1024,
  maxAssetFileBytes: 2 * 1024 * 1024,
  maxMigrations: 50,
  maxMigrationBytes: 256 * 1024,
  maxSourceFiles: 300,
  maxSourceBytes: 2 * 1024 * 1024,
  maxSourceFileBytes: 256 * 1024,
});

/** 템플릿 wrangler.toml [assets] directory(보호 파일 — 게이트 전에 원본으로 되돌린다). */
export const ASSETS_DIR = "dist/client";
export const MIGRATIONS_DIR = "migrations";
/** Worker build-artifact.ts MIGRATION_NAME_RE와 같다. */
export const MIGRATION_NAME_RE = /^[0-9]{4}_[A-Za-z0-9_-]{1,80}\.sql$/;
/** Worker build-artifact.ts MODULE_NAME_RE와 같다 — multipart 이름·import 지정자라 ASCII만. */
export const MODULE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.(?:js|mjs|wasm)$/;
/** wrangler outdir에서 모듈이 아닌 것. */
const WORKER_OUT_SKIP = new Set(["README.md"]);
/** 자산에서 빼는 이름(wrangler 규칙과 같은 취지). */
const ASSET_SKIP = new Set([".assetsignore", "_worker.js"]);
/** 한 폴더 트리를 걸을 때의 항목 상한(생성 코드가 파일 수백만 개를 만들어도 수집기가 멈추지 않게). */
const WALK_MAX_ENTRIES = 20_000;

class CollectError extends Error {}
const fail = (code) => {
  throw new CollectError(code);
};

/** 트리를 걷는다(링크는 따라가지 않고 건너뛴다). skip(name, isDir)이 true면 그 항목(폴더면 그 아래 전부)을 뺀다. */
async function walk(root, { skip = () => false, fsImpl = fs } = {}) {
  const out = [];
  let seen = 0;
  const visit = async (abs, rel) => {
    let entries;
    try {
      entries = await fsImpl.readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (err?.code === "ENOENT" && rel === "") return;
      throw err;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      seen += 1;
      if (seen > WALK_MAX_ENTRIES) fail("too_many_entries");
      if (e.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skip(e.name, true)) continue;
        await visit(path.join(abs, e.name), childRel);
      } else if (e.isFile()) {
        if (skip(e.name, false)) continue;
        out.push(childRel);
      }
    }
  };
  await visit(root, "");
  return out;
}

/** 파일 하나(링크면 거부). 크기가 max를 넘으면 읽지 않고 too_large. */
async function readFileBounded(abs, max, section, fsImpl) {
  const st = await fsImpl.lstat(abs);
  if (!st.isFile()) fail(`not_a_file:${section}`);
  if (st.size > max) fail(`artifact_too_large:${section}_file`);
  const buf = await fsImpl.readFile(abs);
  if (buf.length > max) fail(`artifact_too_large:${section}_file`);
  return { buf, mode: st.mode };
}

/** wrangler.toml의 main → 번들 main 모듈 이름(예: src/worker.ts → worker.js). */
export function mainModuleNameFromToml(toml) {
  const m = /^main\s*=\s*"([^"\n]+)"\s*$/m.exec(String(toml ?? ""));
  if (!m || !m[1]) return null;
  const base = path.posix.basename(m[1].replace(/\\/g, "/"));
  const stem = base.replace(/\.[^.]+$/, "");
  return stem ? `${stem}.js` : null;
}

/**
 * 산출물 수집. 던지지 않는다 → { ok:true, artifact } | { ok:false, error }.
 * artifact = { worker:{ mainModule, modules:[{name,base64}] }, assets:[{path,base64}], migrations:[{name,base64}],
 *              source:[{path,base64,executable}], stats }
 */
export async function collectArtifact({ appDir, workerOutDir, fsImpl = fs, limits = ARTIFACT_LIMITS }) {
  try {
    const root = path.resolve(appDir);
    // ── worker 모듈 ──
    const toml = await fsImpl.readFile(path.join(root, "wrangler.toml"), "utf8").catch(() => fail("wrangler_toml_missing"));
    const wantMain = mainModuleNameFromToml(toml);
    if (!wantMain) fail("wrangler_main_missing");
    const outFiles = (await walk(path.resolve(workerOutDir), { fsImpl })).filter((f) => !WORKER_OUT_SKIP.has(f) && !f.endsWith(".map"));
    if (outFiles.length === 0) fail("worker_bundle_missing");
    if (outFiles.length > limits.maxModules) fail("artifact_too_large:modules_count");
    let mainModule = outFiles.includes(wantMain) ? wantMain : null;
    if (!mainModule) {
      const tops = outFiles.filter((f) => !f.includes("/") && /\.(?:js|mjs)$/.test(f));
      if (tops.length === 1) mainModule = tops[0];
      else fail("main_module_missing");
    }
    const modules = [];
    let moduleBytes = 0;
    for (const name of [mainModule, ...outFiles.filter((f) => f !== mainModule)]) {
      if (!MODULE_NAME_RE.test(name)) fail(`module_unsupported:${name.slice(0, 80)}`);
      const { buf } = await readFileBounded(path.join(path.resolve(workerOutDir), ...name.split("/")), limits.maxModuleBytes, "modules", fsImpl);
      moduleBytes += buf.length;
      if (moduleBytes > limits.maxModuleBytes) fail("artifact_too_large:modules");
      modules.push({ name, base64: buf.toString("base64") });
    }

    // ── 정적 자산 ──
    const assetRoot = path.join(root, ...ASSETS_DIR.split("/"));
    const assetFiles = await walk(assetRoot, { skip: (name) => ASSET_SKIP.has(name), fsImpl });
    if (assetFiles.length > limits.maxAssets) fail("artifact_too_large:assets_count");
    const assets = [];
    let assetBytes = 0;
    for (const rel of assetFiles) {
      const { buf } = await readFileBounded(path.join(assetRoot, ...rel.split("/")), limits.maxAssetFileBytes, "assets", fsImpl);
      assetBytes += buf.length;
      if (assetBytes > limits.maxAssetBytes) fail("artifact_too_large:assets");
      assets.push({ path: `/${rel.normalize("NFC")}`, base64: buf.toString("base64") });
    }

    // ── D1 마이그레이션 ──
    const migRoot = path.join(root, MIGRATIONS_DIR);
    let migEntries = [];
    try {
      migEntries = await fsImpl.readdir(migRoot, { withFileTypes: true });
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    const migNames = migEntries.filter((e) => e.isFile() && e.name.endsWith(".sql")).map((e) => e.name).sort();
    if (migNames.length > limits.maxMigrations) fail("artifact_too_large:migrations_count");
    const migrations = [];
    let migBytes = 0;
    for (const name of migNames) {
      if (!MIGRATION_NAME_RE.test(name)) fail(`migration_name_invalid:${name.slice(0, 80)}`);
      const { buf } = await readFileBounded(path.join(migRoot, name), limits.maxMigrationBytes, "migrations", fsImpl);
      migBytes += buf.length;
      if (migBytes > limits.maxMigrationBytes) fail("artifact_too_large:migrations");
      migrations.push({ name, base64: buf.toString("base64") });
    }

    // ── 소스 트리(저장소 push용) — 스캐폴드와 같은 제외 규칙 ──
    const srcFiles = await walk(root, { skip: (name) => isScaffoldExcluded(name), fsImpl });
    if (srcFiles.length > limits.maxSourceFiles) fail("artifact_too_large:source_count");
    const source = [];
    let srcBytes = 0;
    for (const rel of srcFiles) {
      const { buf, mode } = await readFileBounded(path.join(root, ...rel.split("/")), limits.maxSourceFileBytes, "source", fsImpl);
      srcBytes += buf.length;
      if (srcBytes > limits.maxSourceBytes) fail("artifact_too_large:source");
      source.push({ path: rel.normalize("NFC"), base64: buf.toString("base64"), executable: (Number(mode) & 0o111) !== 0 });
    }

    return {
      ok: true,
      artifact: {
        worker: { mainModule, modules },
        assets,
        migrations,
        source,
        stats: {
          modules: { count: modules.length, bytes: moduleBytes },
          assets: { count: assets.length, bytes: assetBytes },
          migrations: { count: migrations.length, bytes: migBytes },
          source: { count: source.length, bytes: srcBytes },
        },
      },
    };
  } catch (err) {
    if (err instanceof CollectError) return { ok: false, error: err.message.slice(0, 200) };
    return { ok: false, error: `collect_failed:${String(err?.code ?? err?.message ?? err).slice(0, 120)}` };
  }
}

/** CLI: node artifact-collect.mjs --app <appDir> --worker-out <dir> → stdout JSON 한 줄. */
export async function main(argv = process.argv.slice(2), out = process.stdout) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && typeof argv[i + 1] === "string" ? argv[i + 1] : null;
  };
  const appDir = arg("--app");
  const workerOutDir = arg("--worker-out");
  if (!appDir || !workerOutDir) {
    out.write(`${JSON.stringify({ ok: false, error: "collector_usage" })}\n`);
    return 2;
  }
  const result = await collectArtifact({ appDir, workerOutDir });
  await new Promise((resolve) => out.write(`${JSON.stringify(result)}\n`, resolve));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: `collector_crashed:${String(err?.message ?? err).slice(0, 120)}` })}\n`);
      process.exitCode = 1;
    },
  );
}

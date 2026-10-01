/**
 * PR #569 S3 검증 결함 4 — 산출물 라우트의 메모리 측정기(자식 프로세스: `node --expose-gc _b5b-s3-memory-probe.mjs <dist 폴더>`).
 *
 * 상한 근처 산출물 본문(한글 파일 이름 — Rule 6, 컨테이너가 보내는 대로 ASCII JSON)을 **스트림으로 만들어** 흘려보낸다(측정기가
 * 본문 전체를 따로 들고 있지 않게). R2 put 순간에 GC를 두 번 돌리고 이 요청이 붙잡은 라이브 메모리(heapUsed + external)를
 * 잰다 — put 인자(저장할 값)가 살아 있는 가장 무거운 순간이다. put은 잰 뒤 던진다(→ artifact_store_failed, 배포·네트워크 0).
 * 출력: stdout에 JSON 한 줄 { bodyBytes, deltaBytes, putValueKind }.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

if (typeof globalThis.gc !== "function") {
  console.log(JSON.stringify({ error: "run with --expose-gc" }));
  process.exit(2);
}
const distDir = path.resolve(process.argv[2] ?? new URL("../dist", import.meta.url).pathname);
const imp = (p) => import(pathToFileURL(path.join(distDir, p)).href);
const routesMod = await imp("routes/workspace-build-jobs.js");
const tokenMod = await imp("workspace/build-job-token.js");
const { BUILD_ARTIFACT_LIMITS: L } = await imp("workspace/build-artifact.js");

const JOB = "bj_mem0000001";
const PROJECT = "wsp_mem_빵집";
const row = { id: JOB, project_id: PROJECT, user_key: "uk_빵집 사장님", slug: "sogeum-bread-7a3f", status: "testing", failed_stage: null, error: null, wbs_done: 1, wbs_total: 1, budget_usd: 10, spent_usd: 1, d1_id: "5f0c8a4e-1b2d-4c3e-9f10-2a3b4c5d6e7f", repo_full_name: null, commit_sha: null, deployed_url: null, build_exit_code: null, locale: "ko", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };

const DB = {
  prepare(sql) {
    const h = (args) => ({
      async first() {
        if (sql.includes("FROM build_jobs WHERE id = ?")) return args[0] === JOB ? { ...row } : null;
        if (sql.includes("FROM workspace_projects WHERE id = ?")) return { id: PROJECT };
        return null;
      },
      async run() {
        if (sql.includes("SET build_exit_code = 0") && row.build_exit_code === null) {
          row.build_exit_code = 0;
          return { meta: { changes: 1 } };
        }
        if (sql.includes("SET status = 'failed'")) {
          row.status = "failed";
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
      async all() {
        return { results: [] };
      },
    });
    return { bind: (...a) => h(a), first: () => h([]).first(), run: () => h([]).run(), all: () => h([]).all() };
  },
  async batch() {
    return [];
  },
};

let measured = null;
const EVIDENCE = {
  async put(_key, value) {
    globalThis.gc();
    globalThis.gc();
    const m = process.memoryUsage();
    measured = { total: m.heapUsed + m.external, kind: typeof value === "string" ? "string" : value?.constructor?.name ?? typeof value };
    throw new Error("measured (FAKE) — stop before any deploy");
  },
  async delete() {},
  async list() {
    return { objects: [], truncated: false };
  },
};
const env = { DB, EVIDENCE, INTERNAL_CALLBACK_TOKEN: "internal-callback-FAKE-mem", CONCLAVE_TOKEN_KEK: "kek-FAKE-mem-not-a-real-key", PUBLIC_BASE_URL: "https://cp.example" };

// ── 본문: ASCII JSON 조각을 차례로(큰 base64는 64KiB씩 만들어 흘린다) ──
const esc = (s) => JSON.stringify(s).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** 3바이트 단위 반복 → base64도 4글자 단위 반복(패딩 없음). */
function b64Unit(unit) {
  const b = Buffer.from(unit, "utf8");
  if (b.length % 3 !== 0) throw new Error("unit must be a multiple of 3 bytes");
  return { text: b.toString("base64"), bytes: b.length };
}
const BIN = b64Unit("abcdefghi");
const SQL = b64Unit("SELECT 1;  \n");
function* b64Of(unit, decodedBytes) {
  const reps = Math.floor(decodedBytes / unit.bytes);
  const per = Math.max(1, Math.floor((64 * 1024) / unit.text.length));
  for (let done = 0; done < reps; done += per) yield unit.text.repeat(Math.min(per, reps - done));
}
function* file(prefix, pathKey, pathValue, unit, bytes, suffix = "") {
  yield `${prefix}{${esc(pathKey)}:${esc(pathValue)},"base64":"`;
  yield* b64Of(unit, bytes);
  yield `"${suffix}}`;
}
function* body() {
  const f = 0.97;
  yield `{"jobId":${esc(JOB)},"worker":{"mainModule":"worker.js","modules":[`;
  yield* file("", "name", "worker.js", BIN, Math.floor(L.maxModuleBytes * f));
  yield `]},"assets":[`;
  const assetFiles = Math.max(1, Math.ceil(L.maxAssetBytes / L.maxAssetFileBytes));
  for (let i = 0; i < assetFiles; i += 1) yield* file(i ? "," : "", "path", `/assets/소금빵 사진 ${i}.js`, BIN, Math.floor((L.maxAssetBytes * f) / assetFiles));
  yield `],"migrations":[`;
  yield* file("", "name", "0001_init.sql", SQL, Math.floor(L.maxMigrationBytes * f));
  yield `],"source":[`;
  const srcFiles = Math.max(1, Math.ceil(L.maxSourceBytes / L.maxSourceFileBytes));
  for (let i = 0; i < srcFiles; i += 1) yield* file(i ? "," : "", "path", `src/client/예약 화면 ${i}.tsx`, BIN, Math.floor((L.maxSourceBytes * f) / srcFiles), `,"executable":false`);
  yield `],"summary":{"commits":1,"wbsDone":1,"wbsFailed":[],"gateRounds":0}}`;
}

const token = await tokenMod.mintBuildJobToken(env, JOB);
const app = routesMod.createWorkspaceBuildJobRoutes(async () => new Response("no network (FAKE)", { status: 599 }), { sleep: async () => {} });

globalThis.gc();
globalThis.gc();
const base = process.memoryUsage();
const baseTotal = base.heapUsed + base.external;

let sent = 0;
const it = body();
const enc = new TextEncoder();
const stream = new ReadableStream({
  pull(controller) {
    const n = it.next();
    if (n.done) return controller.close();
    const chunk = enc.encode(n.value);
    sent += chunk.byteLength;
    controller.enqueue(chunk);
  },
});
const res = await app.fetch(new Request("https://cp.example/internal/build-artifact", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: stream, duplex: "half" }), env);
const reply = await res.json().catch(() => null);
console.log(JSON.stringify({ bodyBytes: sent, status: res.status, reply, deltaBytes: measured ? measured.total - baseTotal : null, putValueKind: measured?.kind ?? null }));

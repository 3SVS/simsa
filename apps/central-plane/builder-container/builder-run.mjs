/**
 * SI 티어 Train B — SimsaBuilder 잡 실행 모듈 (순수 + 주입 가능).
 *
 * server.mjs가 HTTP를 받고, 실제 일은 여기서 한다.
 *   B1       자가점검(selfcheck) — node·pnpm·git·gh·wrangler + 작업 디렉터리 쓰기 가능 + 시간
 *   B-5b-0   자가점검에 **agentWorker**(이미지 안에서 빌드한 packages/agent-worker를 실제로 import) ·
 *            **template**(S 템플릿이 이미지에 있고 D1 자리 표시자가 살아 있음) 항목
 *
 * 다음 스테이지가 이 모듈을 채운다(계획 §5.2 Train B):
 *   B-5b-1 scaffold   — 템플릿 복제 + wrangler.toml 채움 + 스캐폴드 커밋, 진행 콜백
 *   B-5b-2 implement  — WBS별 runBuildLoop(usage 콜백)
 *   B-5b-3 build/test — pnpm build · pnpm test · playwright, green 아니면 failed(building|testing)
 *   B-5b-4 deploy     — Workers for Platforms 업로드(운영 토큰은 페이로드로만)
 * 미구현 kind는 **정직하게** `builder_stage_not_implemented`로 실패한다 — 예시 성공을 꾸미지 않는다.
 *
 * 규칙:
 *  - 비밀(콜백 토큰·LLM 키·운영 토큰)은 로그에 쓰지 않는다. 로그 줄에는 jobId만.
 *  - exec·fs·agent-worker 로더는 주입 가능 — 테스트는 네트워크·프로세스 없이 돈다(seam).
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 이미지 롤아웃 확인용 마커(인스펙터 RUNNER_REV와 같은 용도 — 옛 이미지가 서빙 중인지 판별). */
export const RUNNER_REV = "b5b0-builder-2";

/** D-4 잡 상태 머신. 진행률 %가 아니라 이 상태를 그대로 보여준다(B5에서 D1 build_jobs로). */
export const BUILD_STAGES = Object.freeze([
  "queued",
  "scaffolding",
  "implementing",
  "building",
  "testing",
  "pushed",
  "done",
  "failed",
]);

/** Worker의 dispatchBuild 계약 — 전부 비어 있지 않은 문자열이어야 한다. */
export const REQUIRED_FIELDS = Object.freeze(["jobId", "projectId", "userKey", "kind", "baseUrl", "callbackUrl", "callbackToken"]);

export function validateJobPayload(payload) {
  const missing = REQUIRED_FIELDS.filter((f) => typeof payload?.[f] !== "string" || payload[f].length === 0);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── B-5b-0: 이미지 안의 agent-worker · 템플릿 ─────────────────────────────────────────────────────

/**
 * Dockerfile이 이미지 안에서 빌드한 agent-worker 진입점(/builder/ws = 축소 pnpm 워크스페이스).
 * 절대 경로 file URL로 import한다(sandbox container/server.mjs의 `file:///app/packages/agent-worker/...` 선례) —
 * agent-worker의 의존성(@simsa/core·@anthropic-ai/sdk)은 **그 패키지 자신의** node_modules에서 풀린다.
 */
export const AGENT_WORKER_ENTRY = "/builder/ws/packages/agent-worker/dist/index.js";

/** 빌드 실행체가 쓰는 agent-worker export. 하나라도 없으면 자가점검 실패(이름을 바꾸면 테스트가 실제 dist로 잡는다). */
export const REQUIRED_AGENT_WORKER_EXPORTS = Object.freeze([
  "runBuildLoop",
  "withOpenAiFallback",
  "decideCommand",
  "decidePath",
  "filterEnv",
  "BUILD_LIMITS",
  "BUILD_TOOLS",
  "usageRecordFromResponse",
]);

/** S 모드 템플릿(templates/simsa-hosted-app)이 이미지 안에 놓이는 곳. */
export const TEMPLATE_DIR = "/builder/templates/simsa-hosted-app";

/** 템플릿 wrangler.toml의 D1 자리 표시자(0으로 채운 id — 그대로 배포하면 wrangler가 거부). */
export const TEMPLATE_D1_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

export function defaultLoadAgentWorker(entry = AGENT_WORKER_ENTRY) {
  return import(pathToFileURL(entry).href);
}

/** agent-worker를 실제로 import해 필수 export가 있는지. 던지지 않는다. */
export async function checkAgentWorker({ entry = AGENT_WORKER_ENTRY, loadAgentWorker } = {}) {
  const t0 = Date.now();
  try {
    const mod = await (loadAgentWorker ? loadAgentWorker() : defaultLoadAgentWorker(entry));
    const missing = REQUIRED_AGENT_WORKER_EXPORTS.filter((name) => mod?.[name] === undefined || mod?.[name] === null);
    return { ok: missing.length === 0, entry, missing, ms: Date.now() - t0, error: null };
  } catch (err) {
    return { ok: false, entry, missing: [...REQUIRED_AGENT_WORKER_EXPORTS], ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 200) };
  }
}

/** 템플릿이 있고(package.json·wrangler.toml) D1 자리 표시자가 살아 있는지. 던지지 않는다. */
export async function checkTemplate(templateDir = TEMPLATE_DIR, fsImpl = fs) {
  const t0 = Date.now();
  try {
    const pkg = JSON.parse(await fsImpl.readFile(path.join(templateDir, "package.json"), "utf8"));
    const toml = await fsImpl.readFile(path.join(templateDir, "wrangler.toml"), "utf8");
    if (!toml.includes(TEMPLATE_D1_PLACEHOLDER)) {
      return { ok: false, version: null, ms: Date.now() - t0, error: "template_placeholder_missing:database_id" };
    }
    return { ok: true, version: typeof pkg?.version === "string" ? pkg.version : null, ms: Date.now() - t0, error: null };
  } catch (err) {
    return { ok: false, version: null, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 200) };
  }
}

// ─── B1: 툴체인 자가점검 ───────────────────────────────────────────────────────────────────────

/** 자가점검 툴체인. 순서는 빌드 잡이 실제로 쓰는 순서. */
export const TOOLCHAIN = Object.freeze([
  { name: "node", cmd: "node", args: ["-v"] },
  { name: "pnpm", cmd: "pnpm", args: ["-v"] },
  { name: "git", cmd: "git", args: ["--version"] },
  { name: "gh", cmd: "gh", args: ["--version"] },
  { name: "wrangler", cmd: "wrangler", args: ["--version"] },
]);

/** D-6: 이 컨테이너에 **있어서는 안 되는** 유저 배포 CLI. 있으면 자가점검이 실패한다. */
export const FORBIDDEN_DEPLOY_CLIS = Object.freeze(["vercel", "netlify"]);

/** `git version 2.43.0` · `v22.1.0` · `⛅️ wrangler 4.x` 같은 출력에서 버전 숫자만. */
export function parseVersion(stdout) {
  const m = /(\d+\.\d+\.\d+)/.exec(String(stdout ?? ""));
  return m ? m[1] : String(stdout ?? "").trim().split("\n")[0].slice(0, 40);
}

/** 기본 실행기 — child_process.execFile, 타임아웃 포함. 테스트는 이걸 갈아끼운다. */
export function defaultExec(cmd, args, { timeoutMs = 15_000, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, cwd, env: process.env, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === "number" ? err.code : -1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: err ? String(err.message ?? err).slice(0, 200) : null,
      });
    });
  });
}

/** 작업 디렉터리가 실제로 쓰기 가능한지(권한·디스크). */
export async function checkWorkRoot(workRoot, fsImpl = fs) {
  const t0 = Date.now();
  try {
    const dir = await fsImpl.mkdtemp(path.join(workRoot, "selfcheck-"));
    await fsImpl.writeFile(path.join(dir, "probe.txt"), "ok");
    await fsImpl.rm(dir, { recursive: true, force: true });
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 200) };
  }
}

/**
 * 자가점검. 각 도구를 한 번씩 실행해 버전과 소요 시간을 돌려준다.
 * ok = 모든 필수 도구가 있고 + 금지 CLI가 없고 + 작업 디렉터리가 쓰기 가능 + agent-worker import 가능 + 템플릿 있음.
 */
export async function selfCheck({
  exec = defaultExec,
  workRoot = "/var/lib/simsa-build",
  fsImpl = fs,
  toolTimeoutMs = 15_000,
  loadAgentWorker,
  agentWorkerEntry = AGENT_WORKER_ENTRY,
  templateDir = TEMPLATE_DIR,
  templateFs = fs,
} = {}) {
  const t0 = Date.now();
  const tools = [];
  for (const t of TOOLCHAIN) {
    const s = Date.now();
    const r = await exec(t.cmd, t.args, { timeoutMs: toolTimeoutMs });
    tools.push({ name: t.name, ok: r.ok, version: r.ok ? parseVersion(r.stdout) : null, ms: Date.now() - s, error: r.ok ? null : r.error });
  }
  const forbidden = [];
  for (const cli of FORBIDDEN_DEPLOY_CLIS) {
    const r = await exec(cli, ["--version"], { timeoutMs: 5_000 });
    if (r.ok) forbidden.push(cli);
  }
  const workRootCheck = await checkWorkRoot(workRoot, fsImpl);
  const agentWorker = await checkAgentWorker({ entry: agentWorkerEntry, loadAgentWorker });
  const template = await checkTemplate(templateDir, templateFs);
  const ok = tools.every((t) => t.ok) && forbidden.length === 0 && workRootCheck.ok && agentWorker.ok && template.ok;
  return { ok, runnerRev: RUNNER_REV, tools, forbiddenPresent: forbidden, workRoot: workRootCheck, agentWorker, template, totalMs: Date.now() - t0 };
}

/**
 * 잡 실행 진입점. 아직 `kind: "selfcheck"`만 안다(kind "build"는 B-5b-1).
 * 반환값은 그대로 콜백 본문이 된다(jobId 포함).
 */
export async function runBuildJob(payload, deps = {}) {
  const kind = payload?.kind;
  if (kind === "selfcheck") {
    const result = await selfCheck(deps);
    return { jobId: payload.jobId, ok: result.ok, kind, stage: result.ok ? "done" : "failed", result };
  }
  // B-5b-1 전까지는 정직하게 실패 — 예시로 대체하지 않는다(증거 규칙).
  const err = new Error(`builder_stage_not_implemented:${String(kind).slice(0, 40)}`);
  err.stage = "queued";
  throw err;
}

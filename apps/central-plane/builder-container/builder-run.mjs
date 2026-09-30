/**
 * SI 티어 Train B — SimsaBuilder 잡 실행 모듈 (순수 + 주입 가능).
 *
 * server.mjs가 HTTP를 받고, 실제 일은 여기서 한다.
 *   B1       자가점검(selfcheck) — node·pnpm·git·gh·wrangler + 작업 디렉터리 쓰기 가능 + 시간
 *   B-5b-0   자가점검에 **agentWorker**(이미지 안에서 빌드한 packages/agent-worker를 실제로 import) ·
 *            **template**(S 템플릿이 이미지에 있고 스캐폴드가 채울 자리 표시자가 전부 살아 있음) 항목
 *   B-5b-1   kind "build" — D-4 상태 머신 중 **scaffolding까지** 실제로 한다:
 *            페이로드 검증 → progress(scaffolding, scaffold_started) → 템플릿을 작업 폴더로 복사·wrangler.toml
 *            채움·로컬 스캐폴드 커밋 → progress(scaffolding, scaffold_ready) → implementing은 아직 없으므로
 *            `builder_stage_not_implemented:implementing`으로 **정직하게** 실패(조용한 성공·예시 성공 없음).
 *
 * 다음 스테이지가 이 모듈을 채운다(계획 §5.2 Train B):
 *   B-5b-2 implement — WBS별 runBuildLoop(onUsage → createUsageOutbox → progress usage[] 델타)
 *   B-5b-3 build/test — pnpm build · pnpm test · playwright, green 아니면 failed(building|testing)
 *   B-5b-4 deploy     — Workers for Platforms 업로드 + 프로젝트 D1 마이그레이션 + deployedUrl
 *   B-5b-5 push/done  — 저장소 push · done · 자동 T2 검수
 *
 * 규칙:
 *  - 비밀(콜백 토큰·LLM 키·운영 토큰·저장소 토큰)은 로그·진행 본문·exec 인자/환경에 쓰지 않는다.
 *    validateBuildPayload가 돌려주는 정규화 잡에는 비밀이 **없다** — 비밀이 필요한 단계만 원 페이로드에서 꺼낸다.
 *  - exec·fs·poster·agent-worker 로더는 주입 가능 — 테스트는 네트워크·프로세스 없이 돈다(seam).
 *  - 콜백 계약은 Worker가 정한다(routes/workspace-build-jobs.ts): progress는 진행 상태만(최종 상태 400),
 *    최종 본문의 실패 단계 키는 `failedStage`, usage[]는 #562 델타 규약.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 이미지 롤아웃 확인용 마커(인스펙터 RUNNER_REV와 같은 용도 — 옛 이미지가 서빙 중인지 판별). */
export const RUNNER_REV = "b5b1-builder-4";

/**
 * D-4 잡 상태 머신 — **D1 build_jobs.status와 같은 목록·같은 순서**(build-job-db.ts BUILD_JOB_STATUSES).
 * Worker는 역행 전이를 거부하므로(STAGE_ORDER) 순서가 어긋나면 진행 기록이 조용히 버려진다 — 테스트가 고정.
 * pushed(저장소에 올림) 다음이 deploying(호스팅 배포)이다.
 */
export const BUILD_STAGES = Object.freeze([
  "queued",
  "scaffolding",
  "implementing",
  "building",
  "testing",
  "pushed",
  "deploying",
  "done",
  "failed",
]);

/** 이 이미지가 **실제로** 수행하는 단계. 나머지는 `builder_stage_not_implemented:<단계>`로 실패한다. */
export const IMPLEMENTED_BUILD_STAGES = Object.freeze(["scaffolding"]);

/** Worker가 progress 콜백으로 받는 상태(최종 상태 done·failed는 build-done으로만). */
const PROGRESS_STATUSES = new Set(BUILD_STAGES.filter((s) => s !== "done" && s !== "failed"));

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
const TEMPLATE_NAME = "simsa-hosted-app";
/** hosting-provision.ts HOSTED_D1_PREFIX와 같다(프로젝트 D1 이름 `simsa-hosted-<slug>`). */
const HOSTED_D1_PREFIX = "simsa-hosted-";

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

/** 자가점검이 스캐폴드와 **같은 함수**로 wrangler.toml을 채워 볼 때 쓰는 가짜 값(배포되지 않는다). */
const SELFCHECK_PROBE = Object.freeze({ slug: "selfcheck-probe", d1Id: "00000000-0000-4000-8000-00000000c0de" });

/**
 * 템플릿이 있고(package.json·wrangler.toml) 스캐폴드가 **실제로** 채울 수 있는지. 던지지 않는다.
 * wrangler.toml은 scaffoldTemplate과 같은 patchWranglerToml로 채워 본다 — 자리 표시자(database_id·database_name·name)
 * 중 하나라도 없으면 ok=false + 어느 것인지(`template_placeholder_missing:<이름>`). 자가점검이 초록인데 모든 빌드가
 * scaffolding에서 실패하는 일(PR #569 검증 결함 1)을 막는다.
 */
export async function checkTemplate(templateDir = TEMPLATE_DIR, fsImpl = fs) {
  const t0 = Date.now();
  try {
    const pkg = JSON.parse(await fsImpl.readFile(path.join(templateDir, "package.json"), "utf8"));
    const toml = await fsImpl.readFile(path.join(templateDir, "wrangler.toml"), "utf8");
    try {
      patchWranglerToml(toml, SELFCHECK_PROBE);
    } catch (err) {
      return { ok: false, version: null, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 200) };
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

/**
 * 기본 실행기 — child_process.execFile, 타임아웃 포함. 테스트는 이걸 갈아끼운다.
 * `signal`(잡 마감·SIGTERM)이 끊기면 자식 프로세스를 죽인다 — 마감 뒤에 설치·빌드가 계속 돌지 않게.
 */
export function defaultExec(cmd, args, { timeoutMs = 15_000, cwd, signal } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, cwd, env: process.env, maxBuffer: 1024 * 1024, ...(signal ? { signal } : {}) }, (err, stdout, stderr) => {
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

// ─── B-5b-1: 빌드 페이로드 검증 (외부 경계 — 명시 가드) ─────────────────────────────────────────────

/** 작업 폴더 이름이 된다 — 경로 구분자·`..` 불가. Worker의 id는 `bj_<10 hex>`. */
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** hosting-provision.ts SLUG_RE와 같다(서브도메인·D1 이름·Worker 이름). */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;
/** wrangler.toml 문자열에 들어간다 — 따옴표·개행 불가(TOML 주입 차단). CF D1 id는 UUID. */
const D1_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** dev-spec.ts workBreakdown .max(120)와 같다. */
const MAX_WBS_ITEMS = 120;

function isStr(v, max = 10_000) {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function isStrArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 80);
}

function httpUrl(v) {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * kind "build" 페이로드(workspace-build-jobs.ts BuildDispatchPayload) 검증.
 * 반환 `job`은 **비밀 없는** 정규화 잡. 오류는 필드 이름만(값을 되풀이하지 않는다 — 비밀 누출 방지).
 */
export function validateBuildPayload(payload) {
  const p = typeof payload === "object" && payload !== null ? payload : {};
  const errors = [];
  if (p.kind !== "build") errors.push("kind");
  if (!(typeof p.jobId === "string" && JOB_ID_RE.test(p.jobId))) errors.push("jobId");
  if (!isStr(p.projectId, 200)) errors.push("projectId");
  if (!isStr(p.userKey, 200)) errors.push("userKey");
  if (!(typeof p.slug === "string" && SLUG_RE.test(p.slug))) errors.push("slug");
  if (p.locale !== "ko" && p.locale !== "en") errors.push("locale");
  if (!isStr(p.callbackToken, 4_096)) errors.push("callbackToken");
  const callback = httpUrl(p.callbackUrl);
  if (!callback) errors.push("callbackUrl");
  const progress = httpUrl(p.progressUrl);
  // 진행 콜백도 Bearer 토큰을 싣는다 — 최종 콜백과 같은 출처(Worker)가 아니면 보내지 않는다.
  if (!progress || (callback && progress.origin !== callback.origin)) errors.push("progressUrl");
  if (!(typeof p.budgetUsd === "number" && Number.isFinite(p.budgetUsd) && p.budgetUsd >= 0)) errors.push("budgetUsd");

  const spec = typeof p.spec === "object" && p.spec !== null ? p.spec : null;
  if (!spec || typeof spec.markdown !== "string") errors.push("spec.markdown");
  if (!spec || typeof spec.productName !== "string") errors.push("spec.productName");
  const wbsRaw = spec && Array.isArray(spec.wbs) ? spec.wbs : null;
  const wbsOk =
    wbsRaw !== null &&
    wbsRaw.length > 0 &&
    wbsRaw.length <= MAX_WBS_ITEMS &&
    wbsRaw.every(
      (w) =>
        typeof w === "object" && w !== null &&
        isStr(w.id, 40) && isStr(w.title, 300) &&
        typeof w.order === "number" && Number.isFinite(w.order) &&
        isStrArray(w.acceptanceIds) && isStrArray(w.dependsOn),
    );
  if (!wbsOk) errors.push("spec.wbs");

  const hosting = typeof p.hosting === "object" && p.hosting !== null ? p.hosting : null;
  if (!(hosting && typeof hosting.d1Id === "string" && D1_ID_RE.test(hosting.d1Id))) errors.push("hosting.d1Id");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    job: {
      jobId: p.jobId,
      projectId: p.projectId,
      slug: p.slug,
      locale: p.locale,
      progressUrl: p.progressUrl,
      callbackUrl: p.callbackUrl,
      budgetUsd: p.budgetUsd,
      d1Id: hosting.d1Id,
      productName: spec.productName,
      specMarkdown: spec.markdown,
      wbs: wbsRaw.map((w) => ({ id: w.id, title: w.title, order: w.order, acceptanceIds: [...w.acceptanceIds], dependsOn: [...w.dependsOn] })),
    },
  };
}

// ─── B-5b-1: 콜백 본문 (Worker 계약) ─────────────────────────────────────────────────────────────

/**
 * /internal/build-progress 본문. 진행 상태만 — 최종·미지 상태는 Worker가 400이므로 만들지 않는다(던짐).
 * usage[]는 비어 있지 않을 때만(#562 델타 — 이 콜백 사이에 새로 생긴 호출).
 */
export function progressBody(job, status, { message = "", meta = {}, wbsDone = 0, spentUsd = 0, usage = [] } = {}) {
  if (!PROGRESS_STATUSES.has(status)) throw new Error(`progress_status_invalid:${String(status).slice(0, 40)}`);
  const body = { jobId: job.jobId, status, message, meta, wbsDone, wbsTotal: job.wbs.length, spentUsd };
  if (Array.isArray(usage) && usage.length > 0) body.usage = usage;
  return body;
}

/** /internal/build-done 실패 본문. 실패 단계 키는 Worker가 읽는 `failedStage`. */
export function failureBody(jobId, { failedStage, error, spentUsd = 0, wbsDone = 0, usage = [] }) {
  const body = {
    jobId,
    ok: false,
    stage: "failed",
    failedStage: String(failedStage ?? "unknown").slice(0, 40),
    error: String(error ?? "unknown_error").slice(0, 500),
    spentUsd,
    wbsDone,
  };
  if (Array.isArray(usage) && usage.length > 0) body.usage = usage;
  return body;
}

/**
 * 예외 경로(runBuildJob이 던짐 · 45분 마감 · SIGTERM 드레인)의 본문 — startJob이 만든다.
 * 종전 server.mjs는 다른 키 이름(failed + At)을 보냈고 Worker는 `failedStage`만 읽어서 **모든 실패가 'unknown'으로** 기록됐다.
 * `spend`(우편함의 누적 비용·아직 안 보낸 usage)를 주면 싣는다 — 마감·드레인 본문에 지출이 없으면 build_jobs.spent_usd가
 * 0으로 남고 usage 행이 원장에서 빠진다(PR #569 검증 결함 6).
 */
export function failureCallbackBody(jobId, err, fallbackStage = "unknown", spend = null) {
  const stage = typeof err?.stage === "string" && err.stage ? err.stage : fallbackStage;
  const body = { jobId, ok: false, stage: "failed", failedStage: stage.slice(0, 40), error: String(err?.message ?? err).slice(0, 500) };
  if (spend) {
    body.spentUsd = typeof spend.spentUsd === "number" && Number.isFinite(spend.spentUsd) ? spend.spentUsd : 0;
    if (Array.isArray(spend.usage) && spend.usage.length > 0) body.usage = spend.usage;
  }
  return body;
}

/**
 * 콜백이 Worker에 **기록됐는가**. 2xx만으로는 아니다 — Worker 콜백 라우트는 성공하면 언제나 `{ ok: true, ... }` JSON을 준다.
 * 2xx인데 JSON이 아니거나 ok가 true가 아니면(프록시·캡티브 페이지 등) 기록되지 않은 것으로 보고 usage를 ack하지 않는다 —
 * ack하면 그 usage는 다시 실리지 않아 원장에서 조용히 빠진다(PR #569 검증 결함 2).
 */
function isCallbackRecorded(r) {
  return Boolean(r?.ok) && typeof r.json === "object" && r.json !== null && r.json.ok === true;
}

/**
 * 콜백 POST. 던지지 않는다 → { ok, status, json, error }. 4xx는 재시도하지 않는다(계약 파손·토큰 불일치는
 * 다시 보내도 같다). 네트워크·5xx는 `retries`번 더.
 */
export async function postCallback(url, token, body, { fetchImpl = globalThis.fetch, timeoutMs = 15_000, retries = 1, backoffMs = 1_000 } = {}) {
  let last = { ok: false, status: 0, json: null, error: "not_sent" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => "");
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      last = { ok: res.ok, status: res.status, json, error: res.ok ? null : `http_${res.status}:${text.slice(0, 200)}` };
      if (res.ok || (res.status >= 400 && res.status < 500)) return last;
    } catch (err) {
      last = { ok: false, status: 0, json: null, error: String(err?.message ?? err).slice(0, 200) };
    }
  }
  return last;
}

// ─── B-5b-1: usage 델타 우편함 (#562 규약) ──────────────────────────────────────────────────────

/** 콜백 한 번에 싣는 usage 항목 상한(llm-usage.ts CALLBACK_USAGE_MAX와 같다). */
export const USAGE_CALLBACK_MAX = 200;

function runNonce() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (typeof uuid === "string" && uuid) return uuid.replace(/-/g, "").slice(0, 12);
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * runBuildLoop `onUsage`(턴별 LlmUsageRecord)를 받아 콜백 usage[]로 내보내는 우편함.
 *   - callId = `<실행 nonce>:<태스크 id>:<턴>` — runBuildLoop는 태스크마다 턴을 0부터 세므로 태스크 id가 필요하다.
 *   - pending() = 아직 보내지 않은 것(최대 200). 콜백이 **기록됐을 때만** ack(callIds) — 아니면 다음 콜백에
 *     **같은 callId**로 다시 실린다(Worker가 행 id로 중복 제거). pendingCount() = 안 보낸 전체 수(200 초과 포함).
 *   - spentUsd() = 누적 비용(보냄 여부와 무관) — 진행 본문 spentUsd·예산 정지(B-6)의 원천.
 *   - outcome.usage(누적 전체)는 **싣지 않는다**(델타 규약).
 */
export function createUsageOutbox({ nonce = runNonce() } = {}) {
  const pendingItems = [];
  const turns = new Map();
  let spent = 0;
  const num = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const str = (s, max) => (typeof s === "string" ? s.trim().slice(0, max) : "");
  return {
    nonce,
    record(u, { taskId }) {
      try {
        if (!u || typeof u !== "object") return;
        const task = str(taskId, 40) || "task";
        const turn = turns.get(task) ?? 0;
        turns.set(task, turn + 1);
        if (typeof u.costUsd === "number" && Number.isFinite(u.costUsd) && u.costUsd > 0) spent += u.costUsd;
        const modelActual = str(u.modelActual, 120) || str(u.modelRequested, 120);
        if (!modelActual) return; // 모델을 모르면 원장 행을 만들 수 없다(Worker 스키마 min(1)).
        pendingItems.push({
          vendor: str(u.vendor, 40) || "unknown",
          modelRequested: str(u.modelRequested, 120) || modelActual,
          modelActual,
          inputTokens: num(u.inputTokens),
          cacheReadTokens: num(u.cacheReadTokens),
          cacheWriteTokens: num(u.cacheWriteTokens),
          outputTokens: num(u.outputTokens),
          latencyMs: num(u.latencyMs),
          callSite: "build-worker",
          callId: `${nonce}:${task}:${turn}`,
        });
      } catch {
        /* 우편함은 루프를 멈추지 않는다 */
      }
    },
    pending() {
      return pendingItems.slice(0, USAGE_CALLBACK_MAX).map((i) => ({ ...i }));
    },
    pendingCount() {
      return pendingItems.length;
    },
    ack(callIds) {
      const sent = new Set(callIds);
      for (let i = pendingItems.length - 1; i >= 0; i--) {
        if (sent.has(pendingItems[i].callId)) pendingItems.splice(i, 1);
      }
    },
    spentUsd() {
      return Math.round(spent * 1_000_000) / 1_000_000;
    },
  };
}

/** 비우기용 진행 본문 — usage만 나른다. message 없음(이벤트 행을 만들지 않는다) · wbs 필드 없음(행 값을 덮지 않는다). */
export function usageFlushBody(jobId, status, { spentUsd = 0, usage = [] } = {}) {
  if (!PROGRESS_STATUSES.has(status)) throw new Error(`progress_status_invalid:${String(status).slice(0, 40)}`);
  return { jobId, status, message: "", meta: {}, spentUsd, usage };
}

/**
 * 최종 본문 전에 200개를 넘는 usage를 진행 콜백으로 나눠 보낸다(PR #569 검증 결함 5).
 * Worker는 콜백 하나에서 200개만 원장에 쓰고(llm-usage.ts CALLBACK_USAGE_MAX) build-done 뒤에는 보낼 콜백이 없다 —
 * 넘친 것을 최종 본문에 실으면 201번째부터 조용히 사라진다.
 *   - `send(usage)` → 기록됐으면 true. Worker는 잡이 이미 끝났어도(transitioned:false) usage는 기록하므로 ack하고 계속.
 *   - 기록되지 않으면 **그 자리에서 멈춘다**(무한 재시도 없음 — 재시도는 postCallback 안의 한 번뿐). 남은 것은 최종 본문에 200개까지.
 * 반환: 최종 본문에도 못 싣는(200 초과) 남은 수 — 호출자가 로그에 남긴다.
 */
export async function flushUsageOverflow({ outbox, send, maxRounds = 100 }) {
  for (let round = 0; round < maxRounds && outbox.pendingCount() > USAGE_CALLBACK_MAX; round++) {
    const usage = outbox.pending();
    let recorded = false;
    try {
      recorded = await send(usage);
    } catch {
      recorded = false;
    }
    if (!recorded) break;
    outbox.ack(usage.map((u) => u.callId));
  }
  return Math.max(0, outbox.pendingCount() - USAGE_CALLBACK_MAX);
}

// ─── B-5b-1: 스캐폴드 ───────────────────────────────────────────────────────────────────────────

/**
 * 템플릿 wrangler.toml을 이 프로젝트용으로 채운다(template-smoke.yml의 sed와 같은 치환 + Worker 이름).
 * 자리 표시자가 없으면 **던진다** — 템플릿이 바뀌었는데 조용히 0 id로 배포하는 일을 막는다.
 */
export function patchWranglerToml(src, { slug, d1Id }) {
  if (!SLUG_RE.test(slug)) throw new Error("invalid_slug");
  if (!D1_ID_RE.test(d1Id)) throw new Error("invalid_d1_id");
  const idLine = `database_id = "${TEMPLATE_D1_PLACEHOLDER}"`;
  const dbNameLine = `database_name = "${TEMPLATE_NAME}"`;
  const nameRe = new RegExp(`^name = "${TEMPLATE_NAME}"$`, "m");
  if (!src.includes(idLine)) throw new Error("template_placeholder_missing:database_id");
  if (!src.includes(dbNameLine)) throw new Error("template_placeholder_missing:database_name");
  if (!nameRe.test(src)) throw new Error("template_placeholder_missing:name");
  return src
    .replace(idLine, `database_id = "${d1Id}"`)
    .replace(dbNameLine, `database_name = "${HOSTED_D1_PREFIX}${slug}"`)
    .replace(nameRe, `name = "${slug}"`);
}

/** 템플릿이 추적하는 dotfile 중 사용자 앱으로 따라가야 하는 것 — 이 목록 밖의 dotfile은 전부 거른다. */
const SCAFFOLD_ALLOWED_DOTFILES = new Set([".gitignore", ".env.example"]);
/** 설치물·산출물(이름이 dotfile이 아닌 것). */
const SCAFFOLD_EXCLUDED_NAMES = new Set(["node_modules", "dist"]);
/** 키·인증서 묶음 — 템플릿에 있을 이유가 없다. */
const SCAFFOLD_SECRET_FILE_RE = /\.(pem|key|p12|pfx)$/i;

/**
 * 템플릿에서 사용자 앱으로 따라오면 안 되는 이름(경로 조각 하나 — fs.cp filter가 폴더·파일마다 부른다).
 * **dotfile은 기본 거부**(허용 목록 `.gitignore`·`.env.example`만): `.npmrc`·`.envrc`·`.yarnrc*`·`.dev.vars`·`.env*`·
 * `.wrangler`·`.git`·`.turbo`·`.DS_Store`·`.vscode`… 종전 제외 목록 방식은 `.npmrc`·`.envrc`를 놓쳐 스캐폴드 커밋(→ B-5b-5가
 * simsa-hosted 저장소로 push)에 넣었다(PR #569 검증 결함 4). 템플릿이 새 dotfile을 추적하면 테스트
 * ('git이 추적하는 템플릿 파일은 하나도 빠지지 않는다')가 깨진다 — 그때 허용 목록에 명시적으로 넣는다.
 */
export function isScaffoldExcluded(name) {
  if (SCAFFOLD_EXCLUDED_NAMES.has(name)) return true;
  if (name.startsWith(".")) return !SCAFFOLD_ALLOWED_DOTFILES.has(name);
  return SCAFFOLD_SECRET_FILE_RE.test(name);
}

/** 템플릿 → appDir 복사 + wrangler.toml 채움. { files, templateVersion }. 실패는 던진다(호출자가 failed(scaffolding)). */
export async function scaffoldTemplate({ templateDir = TEMPLATE_DIR, appDir, slug, d1Id, fsImpl = fs }) {
  await fsImpl.access(path.join(templateDir, "package.json")).catch(() => {
    throw new Error("template_missing");
  });
  await fsImpl.mkdir(path.dirname(appDir), { recursive: true });
  await fsImpl.cp(templateDir, appDir, {
    recursive: true,
    // 템플릿 폴더 자체(rel "")는 이름과 무관하게 통과 — 그 아래 폴더·파일만 이름으로 거른다(거른 폴더 안으로는 내려가지 않는다).
    filter: (src) => path.relative(templateDir, src) === "" || !isScaffoldExcluded(path.basename(src)),
  });
  const tomlPath = path.join(appDir, "wrangler.toml");
  await fsImpl.writeFile(tomlPath, patchWranglerToml(await fsImpl.readFile(tomlPath, "utf8"), { slug, d1Id }));
  const pkg = JSON.parse(await fsImpl.readFile(path.join(appDir, "package.json"), "utf8"));
  const entries = await fsImpl.readdir(appDir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).length;
  return { files, templateVersion: typeof pkg?.version === "string" ? pkg.version : null };
}

/** 스캐폴드 커밋 작성자 — 저장소에 남는다(push는 B-5b-5). 서명·전역 설정에 기대지 않는다. */
const GIT_IDENTITY = ["-c", "user.name=Simsa Builder", "-c", "user.email=builder@simsa.page", "-c", "commit.gpgsign=false"];

/**
 * 로컬 저장소 초기화 + 스캐폴드 커밋. 커밋 sha를 돌려준다. 실패는 `git_<단계>_failed`로 던진다.
 * `signal`(마감·SIGTERM)이 끊기면 다음 git을 시작하지 않고 `job_aborted`로 던진다 — 실행 중인 것은 exec가 죽인다.
 */
export async function commitScaffold({ appDir, exec, signal = null }) {
  const steps = [
    ["init", ["init", "-q", "-b", "main"]],
    ["add", ["add", "-A"]],
    ["commit", [...GIT_IDENTITY, "commit", "-q", "-m", `chore: scaffold ${TEMPLATE_NAME} template`]],
  ];
  for (const [name, args] of steps) {
    if (signal?.aborted) throw new Error("job_aborted");
    const r = await exec("git", args, { cwd: appDir, timeoutMs: 60_000, signal });
    if (!r.ok) throw new Error(`git_${name}_failed:${String(r.error ?? r.stderr ?? "").slice(0, 120)}`);
  }
  if (signal?.aborted) throw new Error("job_aborted");
  const head = await exec("git", ["rev-parse", "HEAD"], { cwd: appDir, timeoutMs: 15_000, signal });
  if (!head.ok) throw new Error(`git_rev-parse_failed:${String(head.error ?? "").slice(0, 120)}`);
  return head.stdout.trim();
}

// ─── B-5b-1: kind "build" 실행 ─────────────────────────────────────────────────────────────────

/**
 * 빌드 잡(kind "build"). 반환값은 server.mjs가 callbackUrl(/internal/build-done)로 보내는 본문.
 * 이 이미지에서는 **항상 ok:false** — scaffolding까지만 실제로 하고 implementing에서 정직하게 멈춘다.
 *
 * 진행 콜백 응답 처리(비용 방어):
 *   - **기록됨**(2xx + Worker JSON `{ok:true}`)일 때만 usage를 ack한다. 2xx라도 Worker 응답이 아니면 기록되지 않은 것 —
 *     5xx처럼 계속 가고, usage는 다음 콜백에 **같은 callId**로 다시 실린다(PR #569 검증 결함 2).
 *   - 기록됨인데 transitioned:false → Worker가 이 잡을 활성으로 보지 않는다(스턱 스윕·디스패치 실패로 이미 failed) →
 *     즉시 멈춘다(`job_not_active`). 기록되지 않는 빌드에 돈을 쓰지 않는다.
 *   - 4xx → 계약 파손·토큰 불일치 → 멈춘다(`progress_rejected:<status>`).
 *   - 5xx·네트워크(재시도 후) → 기록 한 번 실패로 잡을 버리지 않는다.
 *
 * 마감·중단(`deps.signal`, startJob이 넘긴다): 끊기면 다음 진행 콜백을 보내지 않고 다음 exec를 시작하지 않는다(실행 중인
 * exec는 defaultExec가 죽인다). 그때의 반환 본문은 쓰이지 않는다 — 최종 본문은 startJob이 정한다(결함 6).
 * 최종 본문 전에는 200개를 넘는 usage를 진행 콜백으로 비운다(결함 5).
 */
export async function runBuild(payload, deps = {}) {
  const v = validateBuildPayload(payload);
  const jobIdForBody = typeof payload?.jobId === "string" ? payload.jobId.slice(0, 64) : "unknown";
  if (!v.ok) return failureBody(jobIdForBody, { failedStage: "queued", error: `invalid_build_payload:${v.errors.join(",")}` });
  const job = v.job;

  const workRoot = deps.workRoot ?? "/var/lib/simsa-build";
  const templateDir = deps.templateDir ?? TEMPLATE_DIR;
  const exec = deps.exec ?? defaultExec;
  const fsImpl = deps.fsImpl ?? fs;
  const post = deps.postCallback ?? ((url, token, body) => postCallback(url, token, body));
  const onStage = deps.onStage ?? (() => {});
  const log = deps.log ?? ((line) => console.log(`[job ${job.jobId}] ${line}`));
  const outbox = deps.usageOutbox ?? createUsageOutbox();
  const signal = deps.signal ?? null;
  const aborted = () => signal?.aborted === true;

  const workDir = path.join(workRoot, job.jobId);
  const appDir = path.join(workDir, "app");
  const token = payload.callbackToken;
  let wbsDone = 0;
  /** 실제로 들어간 단계 — 비우기 콜백의 status(실패 단계 implementing과 다를 수 있다: 거기까지 가지 않았다). */
  let reached = "queued";
  const enter = (stage) => {
    reached = stage;
    onStage(stage);
  };

  /** 진행 콜백 하나. 멈춰야 하면 사유 문자열, 계속이면 null. */
  const progress = async (status, message, meta = {}) => {
    if (aborted()) return "job_aborted";
    const usage = outbox.pending();
    const body = progressBody(job, status, { message, meta: { runnerRev: RUNNER_REV, ...meta }, wbsDone, spentUsd: outbox.spentUsd(), usage });
    const r = await post(job.progressUrl, token, body);
    if (isCallbackRecorded(r)) {
      outbox.ack(usage.map((u) => u.callId));
      if (r.json.transitioned === false) return "job_not_active";
      return null;
    }
    if (!r.ok && r.status >= 400 && r.status < 500) return `progress_rejected:${r.status}`;
    log(`progress ${status}/${message} not recorded (${r.status ? `http ${r.status}${r.ok ? " — not a Worker response" : ""}` : "network"}) — continuing`);
    return null;
  };
  const fail = async (failedStage, error) => {
    if (!aborted()) {
      const left = await flushUsageOverflow({
        outbox,
        send: async (usage) =>
          isCallbackRecorded(await post(job.progressUrl, token, usageFlushBody(job.jobId, reached, { spentUsd: outbox.spentUsd(), usage }))),
      });
      if (left > 0) log(`usage_overflow_unsent:${left} — flush callback not recorded; build-done carries the first ${USAGE_CALLBACK_MAX}`);
    }
    return failureBody(job.jobId, { failedStage, error, spentUsd: outbox.spentUsd(), wbsDone, usage: outbox.pending() });
  };

  try {
    // ── scaffolding ──
    enter("scaffolding");
    const stop1 = await progress("scaffolding", "scaffold_started", { template: TEMPLATE_NAME });
    if (stop1) return await fail("scaffolding", stop1);
    let scaffold;
    let baseCommit;
    try {
      await fsImpl.rm(workDir, { recursive: true, force: true });
      if (aborted()) throw new Error("job_aborted");
      scaffold = await scaffoldTemplate({ templateDir, appDir, slug: job.slug, d1Id: job.d1Id, fsImpl });
      baseCommit = await commitScaffold({ appDir, exec, signal });
    } catch (err) {
      return await fail("scaffolding", `scaffold_failed:${String(err?.message ?? err).slice(0, 200)}`);
    }
    const stop2 = await progress("scaffolding", "scaffold_ready", {
      template: TEMPLATE_NAME,
      templateVersion: scaffold.templateVersion,
      files: scaffold.files,
      baseCommit: baseCommit.slice(0, 12),
    });
    if (stop2) return await fail("scaffolding", stop2);

    // ── implementing 이후: B-5b-2~5 ──
    // 여기서 WBS별 runBuildLoop가 돈다(B-5b-2 — onUsage는 outbox.record, 턴 사이에 signal 확인·LLM 호출에 signal 전달).
    // 그 전까지는 정직하게 실패 — "완성"을 꾸미지 않는다(D-4 · 증거 규칙).
    return await fail("implementing", "builder_stage_not_implemented:implementing");
  } finally {
    // 작업 폴더에는 유저 지시서로 만든 코드가 있다 — 잡이 끝나면 인스턴스에 남기지 않는다.
    await fsImpl.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 잡 실행 진입점.
 *   kind "selfcheck" → 자가점검 결과
 *   kind "build"     → runBuild (scaffolding까지, 이후 정직한 실패)
 *   그 밖            → builder_stage_not_implemented (던짐)
 * 반환값은 그대로 콜백 본문이 된다(jobId 포함).
 */
export async function runBuildJob(payload, deps = {}) {
  const kind = payload?.kind;
  if (kind === "selfcheck") {
    const result = await selfCheck(deps);
    return { jobId: payload.jobId, ok: result.ok, kind, stage: result.ok ? "done" : "failed", result };
  }
  if (kind === "build") return runBuild(payload, deps);
  // 정직하게 실패 — 예시로 대체하지 않는다(증거 규칙).
  const err = new Error(`builder_stage_not_implemented:${String(kind).slice(0, 40)}`);
  err.stage = "queued";
  throw err;
}

// ─── 잡 하나의 수명: 마감·중단·예외 본문 (server.mjs가 쓴다) ─────────────────────────────────────────

/**
 * server.mjs의 잡 하나를 감싼다(PR #569 검증 결함 6).
 *   - 러너(runBuildJob)에 우편함·AbortSignal·onStage를 넘긴다 → 바깥에서도 지금까지의 지출·단계를 안다.
 *   - 마감(timeoutMs)이 먼저 오면: 러너를 **멈추고**(abort — 다음 진행 콜백·exec를 막고 실행 중인 exec는 죽인다),
 *     200개를 넘는 usage를 진행 콜백으로 비운 뒤(결함 5와 같은 규칙) spentUsd·usage를 실은 실패 본문으로 끝낸다.
 *     종전 server.mjs의 withTimeout은 경쟁만 해서 러너가 뒤에서 계속 돌며 progress를 보냈고, 본문에 지출이 없어
 *     build_jobs.spent_usd가 0으로 남았다(Worker의 markBuildJobFailed는 본문 값을 쓴다).
 *   - abort(err)(SIGTERM 드레인): **동기로** 같은 모양의 본문을 돌려준다 — 5초 안에 보내야 하므로 비우기는 하지 않고
 *     200을 넘는 수만 로그에 남긴다.
 *   - 러너가 던지면: 단계·지출을 실은 실패 본문.
 *   - 최종 본문은 **하나** — 먼저 정해진 것이 done·finished·abort()의 값이다. 마감·중단 뒤 러너의 늦은 본문은 버린다.
 * 반환: { done(최종 본문이 정해지는 순간), finished(러너가 실제로 끝난 뒤 — 값은 같은 최종 본문), abort, stage, signal, outbox }
 */
export function startJob(payload, { deps = {}, timeoutMs = 0, timeoutMessage = "build job timed out", runJob = runBuildJob } = {}) {
  const controller = new AbortController();
  const outbox = deps.usageOutbox ?? createUsageOutbox();
  const jobId = typeof payload?.jobId === "string" ? payload.jobId.slice(0, 64) : "unknown";
  const log = deps.log ?? ((line) => console.log(`[job ${jobId}] ${line}`));
  const post = deps.postCallback ?? ((url, token, body) => postCallback(url, token, body));
  // 비우기 콜백은 검증된 kind=build 페이로드의 progressUrl로만(같은 출처 확인 포함) — selfcheck에는 usage가 없다.
  const flushTarget = payload?.kind === "build" && validateBuildPayload(payload).ok ? { url: payload.progressUrl, token: payload.callbackToken } : null;

  let stage = "queued";
  let finalBody = null;
  let settle = () => {};
  const done = new Promise((resolve) => {
    settle = resolve;
  });
  const finish = (body) => {
    if (finalBody === null) {
      finalBody = body;
      settle(body);
    }
    return finalBody;
  };
  const spend = () => ({ spentUsd: outbox.spentUsd(), usage: outbox.pending() });
  const abort = (err) => {
    if (finalBody !== null) return finalBody;
    if (!controller.signal.aborted) controller.abort(err);
    const left = Math.max(0, outbox.pendingCount() - USAGE_CALLBACK_MAX);
    if (left > 0) log(`usage_overflow_unsent:${left} — job ended before a flush callback (${String(err?.message ?? err).slice(0, 80)})`);
    return finish(failureCallbackBody(jobId, err, stage, spend()));
  };

  let timer = null;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      void (async () => {
        if (finalBody !== null) return;
        const err = new Error(timeoutMessage);
        controller.abort(err);
        const flushStage = stage;
        if (flushTarget && PROGRESS_STATUSES.has(flushStage)) {
          await flushUsageOverflow({
            outbox,
            send: async (usage) =>
              isCallbackRecorded(await post(flushTarget.url, flushTarget.token, usageFlushBody(jobId, flushStage, { spentUsd: outbox.spentUsd(), usage }))),
          });
        }
        abort(err);
      })();
    }, timeoutMs);
  }

  const finished = (async () => {
    try {
      const result = await runJob(payload, {
        ...deps,
        usageOutbox: outbox,
        signal: controller.signal,
        onStage: (s) => {
          stage = s;
          deps.onStage?.(s);
        },
      });
      // 마감·중단이 먼저였다면 최종 본문은 그쪽이 정한다(비우기가 끝날 때까지 기다린다).
      if (controller.signal.aborted) return await done;
      return finish(result);
    } catch (err) {
      if (controller.signal.aborted) return await done;
      return finish(failureCallbackBody(jobId, err, stage, spend()));
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return {
    done,
    finished,
    abort,
    outbox,
    get stage() {
      return stage;
    },
    get signal() {
      return controller.signal;
    },
  };
}

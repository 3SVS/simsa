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
 *   B-5b S1  **비밀 최소화 + 예산 정지(B-6)**: 페이로드에는 비밀이 없다 — 이 잡에만 통하는 jobToken 하나(콜백 Bearer ·
 *            LLM 프록시 apiKey). 운영 CF 토큰·전역 콜백 토큰·조직 설치 토큰·LLM 키·userKey가 오면 **거절**한다(옛 Worker).
 *            LLM은 Worker 프록시(`<baseUrl>/internal/build-llm/*`)로만 — buildLlmConfig. 프록시가 402 budget_exhausted를
 *            주면 그 WBS에서 멈추고(지금까지 만든 것은 커밋) failed(<단계>, budget_exhausted). 원가·원장은 프록시가 쓰므로
 *            콜백 본문에 usage[]·spentUsd를 싣지 않는다(이중 계상 금지 — 종전 usage 우편함은 빌드 잡에서 제거).
 *            자식 프로세스 env는 허용 목록(childEnv — agent-worker filterEnv와 같은 키)만: jobToken은 env에 없다.
 *   B-5b-2   implementing — deps.implementWbs 기본값 = WBS별 agent-worker runBuildLoop(프록시 클라이언트 · 작업 폴더 실행기 —
 *            builder-work.mjs createDefaultImplementWbs). WBS마다 로컬 커밋("feat(WBS-001): …") + progress(implementing,
 *            wbs_done, meta{wbsId}). 끝내 done이 아니면 WBS_FAILURE_POLICY: must면 멈춤, 아니면 기록·되돌리고 계속.
 *   B-5b-3   빌드 게이트(D-4) — 보호 파일 복원 → pnpm install --frozen-lockfile --offline → pnpm run build → pnpm test.
 *            빨간불 → 로그 끝부분으로 수리 라운드(최대 GATE_LIMITS.repairRounds) → 그래도 빨간불이면 failed(building|testing).
 *            초록불이어도 push·배포는 Worker 몫(S3)이라 `builder_stage_not_implemented:pushed`로 정직하게 멈춘다.
 *            생성 코드는 샌드박스 사용자(SIMSA_SANDBOX_UID)로 돈다 — 서버(root) 메모리의 jobToken에 닿지 않는다.
 *
 * 다음 스테이지(계획 §5.2 Train B):
 *   B-5b-4 deploy     — Worker가 Workers for Platforms 업로드 + 프로젝트 D1 마이그레이션 + deployedUrl
 *   B-5b-5 push/done  — Worker가 저장소 push · done · 자동 T2 검수
 *
 * 규칙:
 *  - jobToken은 로그·진행 본문·exec 인자/환경·파일에 쓰지 않는다. validateBuildPayload가 돌려주는 정규화 잡에는 토큰이
 *    **없다** — 콜백·LLM 설정만 원 페이로드에서 꺼낸다.
 *  - exec·fs·poster·agent-worker 로더·implementWbs는 주입 가능 — 테스트는 네트워크·프로세스 없이 돈다(seam).
 *  - 콜백 계약은 Worker가 정한다(routes/workspace-build-jobs.ts): progress는 진행 상태만(최종 상태 400),
 *    최종 본문의 실패 단계 키는 `failedStage`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHILD_ENV_KEYS,
  GATE_COMMANDS,
  GATE_LIMITS,
  WBS_TIME_LIMIT_MS,
  checkSandbox,
  childEnv,
  chownTree,
  createDefaultImplementWbs,
  decideWbsFailure,
  installArgs,
  redactSecrets,
  restoreProtected,
  sandboxExec,
  sandboxFromEnv,
  snapshotProtected,
  stripAnsi,
  tailText,
  workEnv,
} from "./builder-work.mjs";

// 테스트·server.mjs가 builder-run.mjs 하나에서 가져가도록 다시 내보낸다(자식 env는 B-5b S1 계약).
export { CHILD_ENV_KEYS, childEnv };

/** 이미지 롤아웃 확인용 마커(인스펙터 RUNNER_REV와 같은 용도 — 옛 이미지가 서빙 중인지 판별). */
export const RUNNER_REV = "b5bS2-builder-7";

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

/**
 * 이 이미지가 **실제로** 수행하는 단계. 나머지(pushed·deploying — Worker 몫, S3)는 `builder_stage_not_implemented:<단계>`로
 * 실패한다. 빌드 게이트가 초록불이어도 done을 주장하지 않는다(done은 Worker만 — PR #569 S1 결함 2).
 */
export const IMPLEMENTED_BUILD_STAGES = Object.freeze(["scaffolding", "implementing", "building", "testing"]);

/** Worker가 progress 콜백으로 받는 상태(최종 상태 done·failed는 build-done으로만). */
const PROGRESS_STATUSES = new Set(BUILD_STAGES.filter((s) => s !== "done" && s !== "failed"));

/**
 * POST /run 공통 계약 — 전부 비어 있지 않은 문자열이어야 한다. B-5b S1: 콜백 인증은 이 잡의 `jobToken`
 * (종전 callbackToken = 전역 콜백 토큰·userKey는 더 이상 오지 않는다 — kind=build는 validateBuildPayload가 오면 거절).
 */
export const REQUIRED_FIELDS = Object.freeze(["jobId", "kind", "baseUrl", "callbackUrl", "jobToken"]);

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
 * 기본 실행기 — builder-work.mjs sandboxExec(spawn · 프로세스 그룹 · 시간·출력 상한 · 샌드박스 uid). 테스트는 이걸 갈아끼운다.
 * `signal`(잡 마감·SIGTERM·WBS 시간 상한)이 끊기면 자식 **그룹**을 죽인다 — 마감 뒤에 설치·빌드가 계속 돌지 않게.
 * env는 호출자가 준 것(runBuild는 workEnv() — 허용 목록 + HOME·NO_COLOR) — 없으면 childEnv(process.env).
 * process.env를 통째로 넘기지 않는다. 출력은 1M자 안에서 앞·끝만(넘쳐도 자식을 죽이지 않는다).
 */
export function defaultExec(cmd, args, opts = {}) {
  return sandboxExec(cmd, args, { maxOutputBytes: 1024 * 1024, ...opts });
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
 * ok = 모든 필수 도구가 있고 + 금지 CLI가 없고 + 작업 디렉터리가 쓰기 가능 + agent-worker import 가능 + 템플릿 있음
 *      + 샌드박스(B-5b-2): 설정돼 있으면 실제로 쓸 수 있어야 한다(root · 사용자 집 폴더 소유). 설정이 없으면(개발 PC) enabled:false.
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
  sandboxEnv = process.env,
  getuid,
  sandboxFs = fs,
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
  const sandbox = await checkSandbox({ env: sandboxEnv, ...(getuid ? { getuid } : {}), fsImpl: sandboxFs });
  const ok = tools.every((t) => t.ok) && forbidden.length === 0 && workRootCheck.ok && agentWorker.ok && template.ok && sandbox.ok;
  return { ok, runnerRev: RUNNER_REV, tools, forbiddenPresent: forbidden, workRoot: workRootCheck, agentWorker, template, sandbox, totalMs: Date.now() - t0 };
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
 * 옛 Worker(B-5b S1 이전)가 싣던 비밀 자리. 값이 있으면(null·undefined가 아니면) 페이로드를 **거절**한다 —
 * 받아서 안 쓰는 것으로는 부족하다: 이 프로세스 메모리에 있는 것만으로 같은 컨테이너의 생성 코드에 노출될 수 있고,
 * 거절해야 Worker 쪽 배포 불일치가 즉시 failed(queued)로 드러난다. 오류에는 경로만(값은 되풀이하지 않는다).
 */
export const FORBIDDEN_SECRET_PATHS = Object.freeze([
  "callbackToken",
  "userKey",
  "hosting.cfApiToken",
  "repo.token",
  "llm.anthropicApiKey",
  "llm.openaiApiKey",
]);

function valueAt(obj, dotted) {
  let cur = obj;
  for (const k of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** `bjt1.<jobId>.<64 hex>` — Worker build-job-token.ts와 같은 모양. 들어 있는 jobId가 페이로드 jobId와 같아야 한다. */
const JOB_TOKEN_RE = /^bjt1\.([A-Za-z0-9_-]{1,64})\.[0-9a-f]{64}$/;
/** 모델 id(설정값) — 따옴표·공백·경로 불가. */
const MODEL_RE = /^[A-Za-z0-9._:-]{1,120}$/;

/**
 * kind "build" 페이로드(workspace-build-jobs.ts BuildDispatchPayload) 검증.
 * 반환 `job`은 **토큰 없는** 정규화 잡. 오류는 필드 이름만(값을 되풀이하지 않는다 — 비밀 누출 방지).
 * B-5b S1: 비밀 자리(FORBIDDEN_SECRET_PATHS)에 값이 있으면 `forbidden:<경로>`로 거절. baseUrl·progressUrl·callbackUrl은
 * 같은 출처여야 한다 — jobToken(콜백 Bearer·LLM apiKey)을 Worker 밖으로 보내지 않는다.
 */
export function validateBuildPayload(payload) {
  const p = typeof payload === "object" && payload !== null ? payload : {};
  const errors = [];
  for (const secretPath of FORBIDDEN_SECRET_PATHS) {
    const v = valueAt(p, secretPath);
    if (v !== undefined && v !== null) errors.push(`forbidden:${secretPath}`);
  }
  if (p.kind !== "build") errors.push("kind");
  if (!(typeof p.jobId === "string" && JOB_ID_RE.test(p.jobId))) errors.push("jobId");
  if (!(typeof p.slug === "string" && SLUG_RE.test(p.slug))) errors.push("slug");
  if (p.locale !== "ko" && p.locale !== "en") errors.push("locale");
  const tokenMatch = typeof p.jobToken === "string" ? JOB_TOKEN_RE.exec(p.jobToken) : null;
  if (!tokenMatch || tokenMatch[1] !== p.jobId) errors.push("jobToken");
  const callback = httpUrl(p.callbackUrl);
  if (!callback) errors.push("callbackUrl");
  const progress = httpUrl(p.progressUrl);
  // 진행 콜백도 Bearer 토큰을 싣는다 — 최종 콜백과 같은 출처(Worker)가 아니면 보내지 않는다.
  if (!progress || (callback && progress.origin !== callback.origin)) errors.push("progressUrl");
  // LLM 프록시 주소의 뿌리 — 토큰이 apiKey로 가므로 같은 출처만.
  const base = httpUrl(p.baseUrl);
  if (!base || (callback && base.origin !== callback.origin)) errors.push("baseUrl");
  if (!(typeof p.budgetUsd === "number" && Number.isFinite(p.budgetUsd) && p.budgetUsd >= 0)) errors.push("budgetUsd");
  const llm = typeof p.llm === "object" && p.llm !== null ? p.llm : null;
  if (!(llm && typeof llm.model === "string" && MODEL_RE.test(llm.model))) errors.push("llm.model");
  if (!(llm && (llm.openaiModel === undefined || (typeof llm.openaiModel === "string" && MODEL_RE.test(llm.openaiModel))))) errors.push("llm.openaiModel");
  if (!(llm && typeof llm.preferFallback === "boolean")) errors.push("llm.preferFallback");

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
        isStrArray(w.acceptanceIds) && isStrArray(w.dependsOn) &&
        (w.must === undefined || typeof w.must === "boolean"),
    );
  if (!wbsOk) errors.push("spec.wbs");

  const hosting = typeof p.hosting === "object" && p.hosting !== null ? p.hosting : null;
  if (!(hosting && typeof hosting.d1Id === "string" && D1_ID_RE.test(hosting.d1Id))) errors.push("hosting.d1Id");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    job: {
      jobId: p.jobId,
      slug: p.slug,
      locale: p.locale,
      baseUrl: base.origin,
      progressUrl: p.progressUrl,
      callbackUrl: p.callbackUrl,
      budgetUsd: p.budgetUsd,
      d1Id: hosting.d1Id,
      productName: spec.productName,
      specMarkdown: spec.markdown,
      model: llm.model,
      openaiModel: typeof llm.openaiModel === "string" ? llm.openaiModel : null,
      preferFallback: llm.preferFallback,
      // must가 없으면(옛 Worker) must로 — 확인 못 한 항목을 선택 사항으로 낮추지 않는다(WBS_FAILURE_POLICY 보수 쪽).
      wbs: wbsRaw.map((w) => ({ id: w.id, title: w.title, order: w.order, acceptanceIds: [...w.acceptanceIds], dependsOn: [...w.dependsOn], must: w.must !== false })),
    },
  };
}

// ─── B-5b S1: LLM은 Worker 프록시로만 ────────────────────────────────────────────────────────────

/** Worker routes/build-llm-proxy.ts BUILD_LLM_*_BASE_SUFFIX와 같다(테스트가 두 쪽을 비교). */
export const LLM_PROXY_ANTHROPIC_SUFFIX = "/internal/build-llm/anthropic";
export const LLM_PROXY_OPENAI_SUFFIX = "/internal/build-llm/openai/v1";

/**
 * B-5b-2가 쓸 LLM 클라이언트 설정. 키 자리에는 **jobToken**이 들어간다 — 실제 벤더 키는 Worker에만 있다.
 *   - anthropicBaseUrl: ClaudeWorker/Anthropic SDK baseURL(SDK가 `/v1/messages`를 붙인다) — apiKey는 `x-api-key`로
 *   - openaiBaseUrl: withOpenAiFallback openaiBaseUrl(`/chat/completions`를 붙인다) — apiKey는 `Authorization: Bearer`로
 * 반환값은 로그·진행 본문에 넣지 않는다(apiKey).
 */
export function buildLlmConfig(job, jobToken) {
  const origin = String(job.baseUrl).replace(/\/+$/, "");
  return {
    anthropicBaseUrl: `${origin}${LLM_PROXY_ANTHROPIC_SUFFIX}`,
    openaiBaseUrl: `${origin}${LLM_PROXY_OPENAI_SUFFIX}`,
    apiKey: jobToken,
    model: job.model,
    openaiModel: job.openaiModel ?? undefined,
    preferFallback: job.preferFallback === true,
  };
}

/** 프록시의 예산 정지 오류 코드(Worker build-llm-proxy.ts BUDGET_EXHAUSTED와 같다). */
export const BUDGET_EXHAUSTED = "budget_exhausted";
const BUDGET_RE = /\bbudget_exhausted\b/;

function safeText(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

/**
 * 프록시가 예산을 이유로 거절했는가(402 + budget_exhausted). 어느 모양으로 와도 안다:
 *   - Anthropic SDK 오류: `status: 402`, `error: { type:"error", error:{ type:"budget_exhausted" } }`,
 *     message `402 {"type":"error","error":{"type":"budget_exhausted",…}}`
 *   - withOpenAiFallback 오류: message `OpenAI 402: {"error":{"type":"budget_exhausted",…}}`
 *   - runBuildLoop 결과: `{ status: "llm_error", summary: "llm_error: 402 …budget_exhausted…" }`
 * 402 없이 문자열만 같은 것(모델이 쓴 텍스트 등)은 아니다.
 */
export function isBudgetExhausted(x) {
  if (x === null || x === undefined) return false;
  if (typeof x === "string") return /\b402\b/.test(x) && BUDGET_RE.test(x);
  if (typeof x !== "object") return false;
  if (x.status === 402 && BUDGET_RE.test(safeText(x.error ?? x.body ?? x.message))) return true;
  for (const k of ["summary", "message", "error"]) if (typeof x[k] === "string" && isBudgetExhausted(x[k])) return true;
  return false;
}

// ─── B-5b-1: 콜백 본문 (Worker 계약) ─────────────────────────────────────────────────────────────

/**
 * /internal/build-progress 본문. 진행 상태만 — 최종·미지 상태는 Worker가 400이므로 만들지 않는다(던짐).
 * B-5b S1: spentUsd·usage[]를 싣지 않는다 — 원가는 LLM 프록시가 계량한다(Worker는 본문의 두 필드를 무시한다).
 */
export function progressBody(job, status, { message = "", meta = {}, wbsDone = 0 } = {}) {
  if (!PROGRESS_STATUSES.has(status)) throw new Error(`progress_status_invalid:${String(status).slice(0, 40)}`);
  return { jobId: job.jobId, status, message, meta, wbsDone, wbsTotal: job.wbs.length };
}

/**
 * /internal/build-done 실패 본문. 실패 단계 키는 Worker가 읽는 `failedStage`.
 * buildExitCode·testExitCode(빌드 게이트 실패 때만)는 참고용이다 — Worker는 컨테이너의 종료 코드 주장을 저장하지 않는다
 * (build_exit_code는 Worker 소유 — PR #569 S1 결함 1). 사람이 읽을 코드는 error(`build_failed:exit_2`)와 진행 이벤트 logTail에.
 */
export function failureBody(jobId, { failedStage, error, wbsDone = 0, buildExitCode, testExitCode }) {
  return {
    jobId,
    ok: false,
    stage: "failed",
    failedStage: String(failedStage ?? "unknown").slice(0, 40),
    error: String(error ?? "unknown_error").slice(0, 500),
    wbsDone,
    ...(Number.isInteger(buildExitCode) ? { buildExitCode } : {}),
    ...(Number.isInteger(testExitCode) ? { testExitCode } : {}),
  };
}

/**
 * 예외 경로(runBuildJob이 던짐 · 45분 마감 · SIGTERM 드레인)의 본문 — startJob이 만든다.
 * 종전 server.mjs는 다른 키 이름(failed + At)을 보냈고 Worker는 `failedStage`만 읽어서 **모든 실패가 'unknown'으로** 기록됐다.
 * (종전에 싣던 spentUsd·usage는 B-5b S1부터 프록시가 계량한다 — 마감·드레인이어도 이미 쓴 돈은 spent_usd에 들어 있다.)
 */
export function failureCallbackBody(jobId, err, fallbackStage = "unknown") {
  const stage = typeof err?.stage === "string" && err.stage ? err.stage : fallbackStage;
  return { jobId, ok: false, stage: "failed", failedStage: stage.slice(0, 40), error: String(err?.message ?? err).slice(0, 500) };
}

/**
 * 콜백이 Worker에 **기록됐는가**. 2xx만으로는 아니다 — Worker 콜백 라우트는 성공하면 언제나 `{ ok: true, ... }` JSON을 준다.
 * 2xx인데 JSON이 아니거나 ok가 true가 아니면(프록시·캡티브 페이지 등) 기록되지 않은 것으로 본다(PR #569 검증 결함 2) —
 * 그때 transitioned:false를 "잡이 끝났다"로 읽지 않는다(5xx처럼 계속 간다).
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

/**
 * 스캐폴드 커밋 작성자 — 저장소에 남는다(push는 B-5b-5). 서명·전역 설정에 기대지 않는다.
 * core.hooksPath=/dev/null(B-5b-2): 생성 코드가 .git/hooks에 무엇을 심어도 우리 git이 실행하지 않는다.
 */
const GIT_IDENTITY = ["-c", "user.name=Simsa Builder", "-c", "user.email=builder@simsa.page", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

/**
 * 로컬 저장소 초기화 + 스캐폴드 커밋. 커밋 sha를 돌려준다. 실패는 `git_<단계>_failed`로 던진다.
 * `signal`(마감·SIGTERM)이 끊기면 다음 git을 시작하지 않고 `job_aborted`로 던진다 — 실행 중인 것은 exec가 죽인다.
 */
export async function commitScaffold({ appDir, exec, signal = null, env }) {
  const steps = [
    ["init", ["init", "-q", "-b", "main"]],
    ["add", ["add", "-A"]],
    ["commit", [...GIT_IDENTITY, "commit", "-q", "-m", `chore: scaffold ${TEMPLATE_NAME} template`]],
  ];
  for (const [name, args] of steps) {
    if (signal?.aborted) throw new Error("job_aborted");
    const r = await exec("git", args, { cwd: appDir, timeoutMs: 60_000, signal, env });
    if (!r.ok) throw new Error(`git_${name}_failed:${String(r.error ?? r.stderr ?? "").slice(0, 120)}`);
  }
  if (signal?.aborted) throw new Error("job_aborted");
  const head = await exec("git", ["rev-parse", "HEAD"], { cwd: appDir, timeoutMs: 15_000, signal, env });
  if (!head.ok) throw new Error(`git_rev-parse_failed:${String(head.error ?? "").slice(0, 120)}`);
  return head.stdout.trim();
}

/**
 * 작업 폴더의 변경을 커밋한다(B-5b S1 — 예산 정지 때 "지금까지 만든 것"을 남긴다; B-5b-2는 WBS마다 쓴다).
 * `--allow-empty` — 바뀐 것이 없어도 멈춘 지점이 이력에 남는다. 커밋 sha. 실패는 `git_<단계>_failed`로 던진다.
 */
export async function commitWork({ appDir, exec, signal = null, message, env }) {
  const steps = [
    ["add", ["add", "-A"]],
    ["commit", [...GIT_IDENTITY, "commit", "-q", "--allow-empty", "-m", String(message).slice(0, 200)]],
  ];
  for (const [name, args] of steps) {
    if (signal?.aborted) throw new Error("job_aborted");
    const r = await exec("git", args, { cwd: appDir, timeoutMs: 60_000, signal, env });
    if (!r.ok) throw new Error(`git_${name}_failed:${String(r.error ?? r.stderr ?? "").slice(0, 120)}`);
  }
  const head = await exec("git", ["rev-parse", "HEAD"], { cwd: appDir, timeoutMs: 15_000, signal, env });
  if (!head.ok) throw new Error(`git_rev-parse_failed:${String(head.error ?? "").slice(0, 120)}`);
  return head.stdout.trim();
}

/**
 * 마지막 커밋으로 되돌린다(B-5b-2 — 계속 가는 실패 WBS의 반쯤 쓴 코드가 뒤 WBS·게이트를 막지 않게).
 * `clean -fd`는 무시 파일(node_modules·dist)을 남긴다(-x 없음). 실패는 `git_<단계>_failed`로 던진다.
 */
export async function revertWork({ appDir, exec, signal = null, env }) {
  const steps = [
    ["reset", [...GIT_IDENTITY, "reset", "-q", "--hard", "HEAD"]],
    ["clean", [...GIT_IDENTITY, "clean", "-q", "-f", "-d"]],
  ];
  for (const [name, args] of steps) {
    if (signal?.aborted) throw new Error("job_aborted");
    const r = await exec("git", args, { cwd: appDir, timeoutMs: 60_000, signal, env });
    if (!r.ok) throw new Error(`git_${name}_failed:${String(r.error ?? r.stderr ?? "").slice(0, 120)}`);
  }
}

// ─── B-5b-2 · B-5b-3: 설치 · 시간 상한 · 게이트 ─────────────────────────────────────────────────────

function exitLabel(r) {
  return r?.timedOut ? "timeout" : `exit_${typeof r?.code === "number" ? r.code : -1}`;
}

/**
 * 스캐폴드 직후 의존성 설치(lockfile 고정). 먼저 **오프라인**(이미지가 샌드박스 저장소에 미리 받아 둔 것) — 저장소가 비었으면
 * (개발 환경·옛 이미지) 한 번만 레지스트리로(`--prefer-offline`). 네트워크는 이 설치 단계에서만 쓴다. mode로 어느 쪽이었는지 남긴다.
 */
async function installDeps({ appDir, exec, env, signal, sandbox }) {
  const opts = { cwd: appDir, env, timeoutMs: GATE_LIMITS.installMs, signal, maxOutputBytes: GATE_LIMITS.maxOutputBytes };
  const t0 = Date.now();
  const offline = await exec("pnpm", installArgs({ storeDir: sandbox?.storeDir ?? null, offline: true }), opts);
  if (offline.ok || offline.aborted || signal?.aborted) return { ok: offline.ok, mode: "offline", result: offline, ms: Date.now() - t0 };
  const online = await exec("pnpm", installArgs({ storeDir: sandbox?.storeDir ?? null, offline: false }), opts);
  return { ok: online.ok, mode: "network", result: online, ms: Date.now() - t0 };
}

/**
 * fn(signal)을 ms 안에서. 부모 신호(잡 마감·SIGTERM)도 잇는다. 던지면 llm_error 모양 결과로.
 * 반환 { outcome, timedOut } — 시간이 넘었으면 결과가 무엇이든 limit_time으로 분류한다(호출자).
 */
async function runTimed(ms, parentSignal, fn) {
  const ac = new AbortController();
  const onParent = () => ac.abort(parentSignal.reason);
  if (parentSignal?.aborted) ac.abort(parentSignal.reason);
  else parentSignal?.addEventListener?.("abort", onParent, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new Error("wbs_time_limit"));
  }, Math.max(1, ms));
  try {
    let outcome;
    try {
      outcome = await fn(ac.signal);
    } catch (err) {
      outcome = { status: "llm_error", summary: String(err?.message ?? err).slice(0, 300), error: err };
    }
    return { outcome, timedOut };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener?.("abort", onParent);
  }
}

/**
 * 빌드 게이트(D-4). 반환 { ok:true, rounds } | { ok:false, failedStage, error, buildExitCode?, testExitCode? }.
 *   반복: 보호 파일 복원 → install(frozen·offline, 실패는 수리 없음 — 의존성은 고정) → build → (처음이면 testing 진입) → test.
 *   build/test 빨간불 → 진행 이벤트(끝부분 로그, 비밀 가림) → 라운드가 남았으면 repair() 후 처음부터, 아니면 실패.
 * 진행 상태는 뒤로 가지 않는다(Worker STAGE_ORDER): testing에 들어간 뒤의 빌드 실패도 이벤트 상태는 testing이고,
 * 최종 failedStage는 **빨간 명령의 단계**(빌드면 building, 테스트면 testing)다.
 */
async function runGate({ appDir, exec, env, offlineEnv, sandbox, signal, fsImpl, snapshot, progress, onStage, repair, literals, limits = GATE_LIMITS, wbsFailed = [] }) {
  let rounds = 0;
  let testing = false;
  const status = () => (testing ? "testing" : "building");
  const clean = (r) => redactSecrets(stripAnsi(`${r?.stdout ?? ""}\n${r?.stderr ?? ""}`), literals).trim();
  const stop = (failedStage, error, extra = {}) => ({ ok: false, failedStage, error, ...extra });
  const cmdOpts = (cmdEnv, timeoutMs) => ({ cwd: appDir, env: cmdEnv, timeoutMs, signal, maxOutputBytes: limits.maxOutputBytes });
  const aborted = (r) => r?.aborted === true || signal?.aborted === true;

  const s0 = await progress("building", "gate_started", { wbsFailed, repairRounds: limits.repairRounds });
  if (s0) return stop("building", s0);
  for (;;) {
    if (signal?.aborted) return stop(status(), "job_aborted");
    let restored;
    try {
      restored = await restoreProtected(appDir, snapshot, { sandbox, fsImpl });
    } catch (err) {
      return stop(status(), `restore_failed:${String(err?.message ?? err).slice(0, 120)}`);
    }
    if (restored.length > 0) {
      const s = await progress(status(), "protected_restored", { files: restored });
      if (s) return stop(status(), s);
    }

    const inst = await exec("pnpm", installArgs({ storeDir: sandbox?.storeDir ?? null, offline: true }), cmdOpts(env, limits.installMs));
    if (aborted(inst)) return stop(status(), "job_aborted");
    if (!inst.ok) {
      await progress(status(), "install_failed", { exit: exitLabel(inst), logTail: tailText(clean(inst), limits.eventLogTailChars) });
      return stop("building", `install_failed:${exitLabel(inst)}`);
    }

    const [bCmd, bArgs] = GATE_COMMANDS.build;
    const t0 = Date.now();
    const b = await exec(bCmd, [...bArgs], cmdOpts(offlineEnv, limits.buildMs));
    if (aborted(b)) return stop(status(), "job_aborted");
    if (!b.ok) {
      const tail = clean(b);
      const final = rounds >= limits.repairRounds;
      const s = await progress(status(), "build_failed", { exit: exitLabel(b), round: rounds, final, logTail: tailText(tail, limits.eventLogTailChars) });
      if (final) return stop("building", `build_failed:${exitLabel(b)}`, { buildExitCode: b.code });
      if (s) return stop(status(), s);
      rounds += 1;
      const rep = await repair({ stage: "building", status: status(), round: rounds, maxRounds: limits.repairRounds, command: `${bCmd} ${bArgs.join(" ")}`, exitLabel: exitLabel(b), logTail: tailText(tail, limits.logTailChars) });
      if (rep.stop) return stop("building", rep.stop);
      continue;
    }
    const buildMs = Date.now() - t0;
    if (!testing) {
      testing = true;
      onStage("testing");
      const s = await progress("testing", "test_started", { buildMs, round: rounds });
      if (s) return stop("testing", s);
    }

    const [tCmd, tArgs] = GATE_COMMANDS.test;
    const t = await exec(tCmd, [...tArgs], cmdOpts(offlineEnv, limits.testMs));
    if (aborted(t)) return stop("testing", "job_aborted");
    if (!t.ok) {
      const tail = clean(t);
      const final = rounds >= limits.repairRounds;
      const s = await progress("testing", "test_failed", { exit: exitLabel(t), round: rounds, final, logTail: tailText(tail, limits.eventLogTailChars) });
      if (final) return stop("testing", `test_failed:${exitLabel(t)}`, { buildExitCode: 0, testExitCode: t.code });
      if (s) return stop("testing", s);
      rounds += 1;
      const rep = await repair({ stage: "testing", status: "testing", round: rounds, maxRounds: limits.repairRounds, command: `${tCmd} ${tArgs.join(" ")}`, exitLabel: exitLabel(t), logTail: tailText(tail, limits.logTailChars) });
      if (rep.stop) return stop("testing", rep.stop);
      continue;
    }
    const s = await progress("testing", "gate_passed", { rounds, buildExit: 0, testExit: 0 });
    if (s) return stop("testing", s);
    return { ok: true, rounds };
  }
}

// ─── B-5b-1: kind "build" 실행 ─────────────────────────────────────────────────────────────────

/**
 * 빌드 잡(kind "build"). 반환값은 server.mjs가 callbackUrl(/internal/build-done)로 보내는 본문.
 * 이 이미지에서는 **항상 ok:false** — 초록불 게이트까지 가도 push·배포는 Worker 몫(S3)이라 `builder_stage_not_implemented:pushed`.
 *
 * 진행 콜백 응답 처리(비용 방어):
 *   - 기록됨(2xx + Worker JSON `{ok:true}`)인데 transitioned:false → Worker가 이 잡을 활성으로 보지 않는다(스턱 스윕·
 *     디스패치 실패·킬스위치로 이미 failed) → 즉시 멈춘다(`job_not_active`). 기록되지 않는 빌드에 돈을 쓰지 않는다.
 *   - 2xx라도 Worker 응답이 아니면 기록되지 않은 것 — 5xx처럼 계속 간다(PR #569 검증 결함 2).
 *   - 4xx → 계약 파손·토큰 불일치(다른 잡의 토큰 403 포함) → 멈춘다(`progress_rejected:<status>`).
 *   - 5xx·네트워크(재시도 후) → 기록 한 번 실패로 잡을 버리지 않는다.
 *
 * scaffolding: 템플릿 복사 → (샌드박스면) 소유자 = 샌드박스 사용자 → 보호 파일 스냅샷 → 스캐폴드 커밋 → 의존성 설치(오프라인 먼저).
 *
 * implementing(B-5b-2): WBS를 order 순서로 `implementWbs({ item, job, appDir, llm, exec, signal, env, plan })`.
 *   기본값 = createDefaultImplementWbs(agent-worker runBuildLoop · 프록시 클라이언트). agent-worker를 못 불러오면 정직하게
 *   failed(implementing, agent_worker_unavailable:…). WBS 하나의 벽시계 상한 WBS_TIME_LIMIT_MS(넘으면 limit_time).
 *   - 프록시 402 budget_exhausted → **그 WBS에서 멈춘다**: 지금까지 만든 것을 커밋하고 failed(implementing, budget_exhausted).
 *   - done → 커밋 + wbsDone + progress(wbs_done, {wbsId, commit}).
 *   - 그 밖 → progress(wbs_failed) → WBS_FAILURE_POLICY: must면 failed(implementing, wbs_failed:<id>:<상태>),
 *     아니면 그 WBS 변경을 되돌리고 계속. 실패·건너뛴 WBS에 기대는 WBS는 건너뛴다(must면 wbs_blocked:<id>:<선행>).
 *
 * building·testing(B-5b-3): runGate — 초록불이 아니면 failed(building|testing). 수리 라운드는 같은 implementWbs에
 *   `repair`(단계·명령·종료 코드·로그 끝부분)를 실어 부른다.
 *
 * 마감·중단(`deps.signal`, startJob이 넘긴다): 끊기면 다음 진행 콜백을 보내지 않고 다음 exec를 시작하지 않는다(실행 중인
 * exec는 defaultExec가 그룹째 죽인다). 그때의 반환 본문은 쓰이지 않는다 — 최종 본문은 startJob이 정한다(결함 6).
 * 자식 프로세스: env = workEnv(deps.baseEnv ?? process.env) — 허용 키 + HOME·NO_COLOR, jobToken 없음. uid = 샌드박스 사용자
 * (deps.sandbox, 없으면 SIMSA_SANDBOX_* 환경 — 설정됐는데 쓸 수 없으면 failed(scaffolding, sandbox_unavailable:…)).
 */
export async function runBuild(payload, deps = {}) {
  const v = validateBuildPayload(payload);
  const jobIdForBody = typeof payload?.jobId === "string" ? payload.jobId.slice(0, 64) : "unknown";
  if (!v.ok) return failureBody(jobIdForBody, { failedStage: "queued", error: `invalid_build_payload:${v.errors.join(",")}` });
  const job = v.job;

  const workRoot = deps.workRoot ?? "/var/lib/simsa-build";
  const templateDir = deps.templateDir ?? TEMPLATE_DIR;
  const baseExec = deps.exec ?? defaultExec;
  const fsImpl = deps.fsImpl ?? fs;
  const post = deps.postCallback ?? ((url, token, body) => postCallback(url, token, body));
  const onStage = deps.onStage ?? (() => {});
  const token = payload.jobToken;
  const literals = [token];
  const rawLog = deps.log ?? ((line) => console.log(`[job ${job.jobId}] ${line}`));
  const log = (line) => rawLog(redactSecrets(String(line), literals));
  const signal = deps.signal ?? null;
  const aborted = () => signal?.aborted === true;
  const gateLimits = { ...GATE_LIMITS, ...(deps.gateLimits ?? {}) };
  const wbsTimeLimitMs = Number.isFinite(deps.wbsTimeLimitMs) && deps.wbsTimeLimitMs > 0 ? deps.wbsTimeLimitMs : WBS_TIME_LIMIT_MS;

  // 샌드박스 사용자 — 테스트는 deps.sandbox(null 또는 {uid,gid,home,storeDir})로 정한다.
  const sandboxCheck = deps.sandbox !== undefined ? { ok: true, sandbox: deps.sandbox, reason: null } : sandboxFromEnv(deps.sandboxEnv ?? process.env);
  const sandbox = sandboxCheck.ok ? sandboxCheck.sandbox : null;
  const exec = sandbox ? (cmd, args, opts = {}) => baseExec(cmd, args, { ...opts, uid: sandbox.uid, gid: sandbox.gid }) : baseExec;
  const baseEnv = deps.baseEnv ?? process.env;
  /** git·설치. */
  const env = workEnv(baseEnv, { sandbox });
  /** 모델 명령·빌드·테스트 — pnpm이 레지스트리에 닿지 않는다. */
  const offlineEnv = workEnv(baseEnv, { sandbox, offline: true });

  const workDir = path.join(workRoot, job.jobId);
  const appDir = path.join(workDir, "app");
  let wbsDone = 0;

  /** 진행 콜백 하나. 멈춰야 하면 사유 문자열, 계속이면 null. */
  const progress = async (status, message, meta = {}) => {
    if (aborted()) return "job_aborted";
    const body = progressBody(job, status, { message, meta: { runnerRev: RUNNER_REV, ...meta }, wbsDone });
    const r = await post(job.progressUrl, token, body);
    if (isCallbackRecorded(r)) return r.json.transitioned === false ? "job_not_active" : null;
    if (!r.ok && r.status >= 400 && r.status < 500) return `progress_rejected:${r.status}`;
    log(`progress ${status}/${message} not recorded (${r.status ? `http ${r.status}${r.ok ? " — not a Worker response" : ""}` : "network"}) — continuing`);
    return null;
  };
  const fail = (failedStage, error, extra = {}) => failureBody(job.jobId, { failedStage, error, wbsDone, ...extra });

  try {
    // ── scaffolding ──
    onStage("scaffolding");
    const stop1 = await progress("scaffolding", "scaffold_started", { template: TEMPLATE_NAME });
    if (stop1) return fail("scaffolding", stop1);
    // 샌드박스가 설정돼 있는데 쓸 수 없으면 생성 코드를 root로 돌리지 않는다(fail closed).
    if (!sandboxCheck.ok) return fail("scaffolding", `sandbox_unavailable:${sandboxCheck.reason}`);
    let scaffold;
    let baseCommit;
    let snapshot;
    try {
      await fsImpl.rm(workDir, { recursive: true, force: true });
      if (aborted()) throw new Error("job_aborted");
      scaffold = await scaffoldTemplate({ templateDir, appDir, slug: job.slug, d1Id: job.d1Id, fsImpl });
      if (sandbox) await chownTree(workDir, sandbox.uid, sandbox.gid, fsImpl);
      snapshot = await snapshotProtected(appDir, fsImpl);
      baseCommit = await commitScaffold({ appDir, exec, signal, env });
    } catch (err) {
      return fail("scaffolding", `scaffold_failed:${String(err?.message ?? err).slice(0, 200)}`);
    }
    if (aborted()) return fail("scaffolding", "job_aborted");
    const install = await installDeps({ appDir, exec, env, signal, sandbox });
    if (aborted()) return fail("scaffolding", "job_aborted");
    if (!install.ok) {
      log(`deps install failed (${exitLabel(install.result)}): ${tailText(stripAnsi(`${install.result?.stdout ?? ""}\n${install.result?.stderr ?? ""}`), 400)}`);
      return fail("scaffolding", `deps_install_failed:${exitLabel(install.result)}`);
    }
    const stop2 = await progress("scaffolding", "scaffold_ready", {
      template: TEMPLATE_NAME,
      templateVersion: scaffold.templateVersion,
      files: scaffold.files,
      baseCommit: baseCommit.slice(0, 12),
      installMode: install.mode,
      installMs: install.ms,
      sandbox: sandbox ? { uid: sandbox.uid } : null,
    });
    if (stop2) return fail("scaffolding", stop2);

    // ── implementing (B-5b-2) ──
    onStage("implementing");
    let implementWbs = typeof deps.implementWbs === "function" ? deps.implementWbs : null;
    if (!implementWbs) {
      try {
        const agentWorker = await (deps.loadAgentWorker ? deps.loadAgentWorker() : defaultLoadAgentWorker());
        implementWbs = createDefaultImplementWbs({ agentWorker, fetchImpl: deps.fetchImpl ?? globalThis.fetch, sandbox, log, fsImpl, retryOptions: deps.llmRetryOptions ?? {} });
      } catch (err) {
        // 정직하게 실패 — 예시 구현·조용한 성공 없음(D-4 · 증거 규칙).
        return fail("implementing", `agent_worker_unavailable:${String(err?.message ?? err).slice(0, 120)}`);
      }
    }
    const llm = buildLlmConfig(job, token);
    const items = [...job.wbs].sort((a, b) => a.order - b.order);
    const state = new Map(items.map((w) => [w.id, "pending"]));
    const plan = () => items.map((w) => ({ id: w.id, title: w.title, must: w.must, state: state.get(w.id) }));
    const wbsFailed = [];
    /** 예산 정지: 지금까지 만든 것을 커밋하고 멈춘다(B-6 — 판정은 서버). */
    const budgetStop = async (label, stage) => {
      log(`${BUDGET_EXHAUSTED} at ${label} — committing the work so far and stopping`);
      await commitWork({ appDir, exec, signal, env, message: `wip(${label}): stopped — build budget exhausted` }).catch((err) =>
        log(`budget_stop_commit_failed:${String(err?.message ?? err).slice(0, 120)}`),
      );
      return fail(stage, BUDGET_EXHAUSTED);
    };

    for (const item of items) {
      if (aborted()) return fail("implementing", "job_aborted");
      const blocker = item.dependsOn.find((d) => state.get(d) === "failed" || state.get(d) === "skipped");
      if (blocker) {
        state.set(item.id, "skipped");
        const s = await progress("implementing", "wbs_skipped", { wbsId: item.id, dependsOn: blocker, must: item.must });
        if (item.must !== false) return fail("implementing", `wbs_blocked:${item.id}:${blocker}`);
        if (s) return fail("implementing", s);
        wbsFailed.push(item.id);
        continue;
      }
      const stopW = await progress("implementing", "wbs_started", { wbsId: item.id });
      if (stopW) return fail("implementing", stopW);
      const run = await runTimed(wbsTimeLimitMs, signal, (wbsSignal) => implementWbs({ item, job, appDir, llm, exec, signal: wbsSignal, env: offlineEnv, plan: plan() }));
      const outcome = run.outcome;
      if (isBudgetExhausted(outcome) || isBudgetExhausted(outcome?.error)) return budgetStop(item.id, "implementing");
      if (aborted()) return fail("implementing", "job_aborted");
      const status = run.timedOut ? "limit_time" : String(outcome?.status ?? "unknown").slice(0, 40);
      if (status === "done") {
        let sha;
        try {
          sha = await commitWork({ appDir, exec, signal, env, message: typeof outcome.commitMessage === "string" && outcome.commitMessage ? outcome.commitMessage : `feat(${item.id}): ${item.title}` });
        } catch (err) {
          return fail("implementing", `commit_failed:${item.id}:${String(err?.message ?? err).slice(0, 120)}`);
        }
        state.set(item.id, "done");
        wbsDone += 1;
        const stopD = await progress("implementing", "wbs_done", { wbsId: item.id, commit: sha.slice(0, 12) });
        if (stopD) return fail("implementing", stopD);
        continue;
      }
      // 끝내 done이 아니다 — 정책대로 멈추거나, 기록하고 되돌린 뒤 계속.
      state.set(item.id, "failed");
      const decision = decideWbsFailure(item, status);
      const summary = redactSecrets(stripAnsi(String(outcome?.summary ?? "")), literals).slice(0, 300);
      const s = await progress("implementing", "wbs_failed", { wbsId: item.id, status, must: item.must, decision, summary });
      if (decision === "stop") return fail("implementing", `wbs_failed:${item.id}:${status}`);
      if (s) return fail("implementing", s);
      try {
        await revertWork({ appDir, exec, signal, env });
      } catch (err) {
        return fail("implementing", `revert_failed:${item.id}:${String(err?.message ?? err).slice(0, 120)}`);
      }
      wbsFailed.push(item.id);
    }

    // ── building · testing (B-5b-3): 초록불이 아니면 절대 다음 단계로 가지 않는다(D-4) ──
    onStage("building");
    const repair = async ({ stage, status, round, maxRounds, command, exitLabel: exit, logTail }) => {
      const label = `REPAIR-${round}`;
      const s = await progress(status, "repair_started", { round, stage });
      if (s) return { stop: s };
      const item = { id: label, title: `Fix the failing ${stage === "testing" ? "tests" : "build"} (${command})`, order: 0, acceptanceIds: [], dependsOn: [], must: true };
      const run = await runTimed(gateLimits.repairTimeMs, signal, (sig) =>
        implementWbs({ item, job, appDir, llm, exec, signal: sig, env: offlineEnv, plan: plan(), repair: { stage, round, maxRounds, command, exitLabel: exit, logTail } }),
      );
      if (isBudgetExhausted(run.outcome) || isBudgetExhausted(run.outcome?.error)) {
        const b = await budgetStop(label, stage);
        return { stop: b.error };
      }
      if (aborted()) return { stop: "job_aborted" };
      const repairStatus = run.timedOut ? "limit_time" : String(run.outcome?.status ?? "unknown").slice(0, 40);
      let sha;
      try {
        sha = await commitWork({ appDir, exec, signal, env, message: `fix(gate): repair ${stage} — round ${round}` });
      } catch (err) {
        return { stop: `commit_failed:${label}:${String(err?.message ?? err).slice(0, 120)}` };
      }
      const s2 = await progress(status, "repair_done", { round, status: repairStatus, commit: sha.slice(0, 12) });
      if (s2) return { stop: s2 };
      return {};
    };
    const gate = await runGate({ appDir, exec, env, offlineEnv, sandbox, signal, fsImpl, snapshot, progress, onStage, repair, literals, limits: gateLimits, wbsFailed });
    if (!gate.ok) {
      const extra = {};
      if (Number.isInteger(gate.buildExitCode)) extra.buildExitCode = gate.buildExitCode;
      if (Number.isInteger(gate.testExitCode)) extra.testExitCode = gate.testExitCode;
      return fail(gate.failedStage, gate.error, extra);
    }

    // ── pushed 이후(B-5b-4·5): 저장소 push·배포·done은 Worker가 한다(S3 — 컨테이너에는 자격이 없다). 정직하게 여기서 멈춘다. ──
    return fail("pushed", "builder_stage_not_implemented:pushed");
  } finally {
    // 작업 폴더에는 유저 지시서로 만든 코드가 있다 — 잡이 끝나면 인스턴스에 남기지 않는다.
    await fsImpl.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 잡 실행 진입점.
 *   kind "selfcheck" → 자가점검 결과
 *   kind "build"     → runBuild (scaffolding → implementing → 빌드 게이트, push·배포 앞에서 정직한 실패)
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
 *   - 러너(runBuildJob)에 AbortSignal·onStage를 넘긴다 → 바깥에서도 지금 단계를 안다.
 *   - 마감(timeoutMs)이 먼저 오면: 러너를 **멈추고**(abort — 다음 진행 콜백·exec를 막고 실행 중인 exec는 죽인다)
 *     그 단계의 실패 본문으로 끝낸다. 종전 server.mjs의 withTimeout은 경쟁만 해서 러너가 뒤에서 계속 돌며 progress를 보냈다.
 *   - abort(err)(SIGTERM 드레인): **동기로** 같은 모양의 본문을 돌려준다(5초 안에 보내야 한다).
 *   - 러너가 던지면: 단계를 실은 실패 본문.
 *   - 최종 본문은 **하나** — 먼저 정해진 것이 done·finished·abort()의 값이다. 마감·중단 뒤 러너의 늦은 본문은 버린다.
 *   (B-5b S1: 지출은 LLM 프록시가 서버에서 계량한다 — 마감·드레인 본문에 지출을 실을 필요가 없어졌다.)
 * 반환: { done(최종 본문이 정해지는 순간), finished(러너가 실제로 끝난 뒤 — 값은 같은 최종 본문), abort, stage, signal }
 */
export function startJob(payload, { deps = {}, timeoutMs = 0, timeoutMessage = "build job timed out", runJob = runBuildJob } = {}) {
  const controller = new AbortController();
  const jobId = typeof payload?.jobId === "string" ? payload.jobId.slice(0, 64) : "unknown";

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
  const abort = (err) => {
    if (finalBody !== null) return finalBody;
    if (!controller.signal.aborted) controller.abort(err);
    return finish(failureCallbackBody(jobId, err, stage));
  };

  let timer = null;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      if (finalBody === null) abort(new Error(timeoutMessage));
    }, timeoutMs);
  }

  const finished = (async () => {
    try {
      const result = await runJob(payload, {
        ...deps,
        signal: controller.signal,
        onStage: (s) => {
          stage = s;
          deps.onStage?.(s);
        },
      });
      // 마감·중단이 먼저였다면 최종 본문은 그쪽이 정했다.
      if (controller.signal.aborted) return await done;
      return finish(result);
    } catch (err) {
      if (controller.signal.aborted) return await done;
      return finish(failureCallbackBody(jobId, err, stage));
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return {
    done,
    finished,
    abort,
    get stage() {
      return stage;
    },
    get signal() {
      return controller.signal;
    },
  };
}

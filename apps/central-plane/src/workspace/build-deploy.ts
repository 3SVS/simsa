/**
 * workspace/build-deploy.ts — SI 티어 Train B · B-5b-4·5 (S3): 산출물 → 저장소 push → 배포 → 내용 확인 → done → 자동 확인(T2).
 *
 * 컨테이너(생성 코드가 돈 곳)에는 배포 자격이 없다(B-5b S1 · D-6). 컨테이너가 올린 산출물(build-artifact.ts로 검증)을 받아
 * **Worker가** 한다 — 운영 자격(HOSTING_CF_API_TOKEN · 호스팅 GitHub App 키)은 Worker secret에만 있다:
 *
 *   1) 관문(checkpoint) — **바깥에 무엇이든 쓰기 직전마다**(push · D1 마이그레이션 · 자산 · Worker 업로드) 다시 본다
 *      (PR #569 S3 검증 결함 1·3·5·7 — 종전에는 push 앞·배포 앞 두 번만 보고, 그 뒤에는 잡이 실패·정지돼도 끝까지 올렸다):
 *        · 마감(BUILD_DEPLOY_DEADLINE_MS [PILOT] 8분 < 컨테이너 업로드 대기 10분) — 넘으면 failed(deploying, deploy_timeout).
 *          파이프라인의 모든 바깥 호출은 마감 신호에 묶인다(걸린 요청도 마감에 끊긴다).
 *        · 잡이 아직 Worker 소유(활성 + build_exit_code 0)인가 — 누가 닫았으면(스턱 스윕·프로젝트 삭제) 그 기록대로 멈춘다.
 *        · 킬스위치(BUILD_ENABLED) — 꺼져 있으면 그 단계에서 멈춤(stopActiveBuildJob, build_disabled).
 *        · 프로젝트가 아직 있나 — 없으면 멈춤(project_deleted). 업로드 **뒤에** 프로젝트가 사라졌으면 방금 올린 Worker를 지운다.
 *        · push 앞·업로드 앞: 정지 목록(B-7) — 조회 오류는 한 번 다시, 그래도 안 되면 **fail-closed**(suspension_check_failed).
 *   2) 저장소 push(B-5b-5) — 잡 행의 repo_full_name(insert 때 Worker가 정한 값)이 `<호스팅 조직>/<slug>`일 때만. 토큰은 그때
 *      **그 저장소 하나 · contents:write만**으로 좁혀 새로 발급(getRepoScopedInstallationToken)하고 push 뒤 폐기한다. 소스 트리를
 *      한 커밋으로(pushScaffold — Git Data API). 성공 → commit_sha 기록 + pushed.
 *      [PILOT] PUSH_FAILURE_POLICY = "continue": 저장소가 없거나(조직·App 미준비) push가 실패해도 **배포는 계속**하고 이벤트에
 *      정직하게 남긴다(상태는 pushed로 가지 않는다 — testing → deploying). 근거: 문 (a)의 완료 정의는 "<slug>.simsa.page에서
 *      must 항목이 작동"이고 저장소는 그 경로 밖이다. 산출물 원본은 R2(builds/<jobId>/artifact.json)에 남아 다시 올릴 수 있다.
 *      재검토 트리거: B-9(내 GitHub로 가져가기)가 저장소를 전제로 할 때.
 *   3) 배포(B-5b-4) — deploying. 정지된 slug(B-7 정지 목록 KV `suspended:<slug>`, 바인딩이 있을 때만)는 push도 배포도 하지
 *      않는다(관문) → D1 마이그레이션(잡 행의 d1_id — 산출물에서 받지 않는다) → 정적 자산 업로드(해시는 Worker가 계산) → 유저 Worker 업로드
 *      (호환 날짜·자산 라우팅 = Worker 상수). 주소 = `https://<slug>.<HOSTING_ROOT_DOMAIN>` — **Worker가 계산**(컨테이너 URL 무시).
 *   4) 내용 확인 — 그 주소에 GET: `/api/health`가 200 + JSON `{ ok: true }` 이고 `/`가 200 + HTML에 `<script … src=` 가 있을 때만
 *      성공(상태 코드만 보지 않는다 — 둘 다 템플릿의 보호된 스모크 테스트가 빌드 전에 보장하는 마커다). 전파 지연을 위해 몇 번 다시.
 *   5) done(markBuildJobDone — 행의 build_exit_code가 0이어야: 그 UPDATE의 WHERE 조건) → 자동 확인(T2): 배포 주소를 지시서의 수용 기준(acceptancePlan)과
 *      함께 검수 1회 디스패치. 검수 킬스위치·프로젝트당 활성 검수 1개·**별도 일일 상한**(시스템 시작 검수 — 유저 상한 밖,
 *      verify-sweep과 같은 원칙) 준수. 확인 런 id는 이벤트 meta.checkRunId(B-8 화면·영수증이 잇는다). 건너뛰면 사유를 이벤트에.
 * 실패는 전부 failed(<단계>, <코드>) + 이벤트 — 조용한 성공 없음. 토큰·키는 오류·이벤트·로그에 싣지 않는다.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { acceptancePlanFromDevSpec, agentAcsFromDevSpec, devSpecAcSource } from "../acceptance-plan.js";
import { resolveTier } from "./tier-resolve.js";
import { confirmedIntentFromProject, defaultInspectionIntent, dispatchInspection } from "../routes/workspace-visual-check-runs.js";
import { getProject, projectExists } from "./db.js";
import { validateDevSpec } from "./dev-spec.js";
import {
  PROJECT_DELETED, advanceBuildJob, appendBuildJobEvent, getBuildJobById, isWorkerOwnedBuildJob, markBuildJobDone, markBuildJobFailed,
  recordBuildJobCommit, stopActiveBuildJob,
  type DbBuildJob,
} from "./build-job-db.js";
import type { BuildArtifact } from "./build-artifact.js";
import { base64ToBytes } from "./build-artifact.js";
import {
  HOSTED_ASSETS_CONFIG, HOSTED_COMPATIBILITY_DATE, applyD1Migrations, deleteUserWorker, uploadUserWorker, uploadUserWorkerAssets,
  type ProvisionResult, type UserWorkerModule,
} from "./hosting-provision.js";
import { getRepoScopedInstallationToken, hostingOrg, pushScaffold, revokeInstallationToken } from "./hosting-repo.js";
import { BUILD_DISABLED, buildEnabled, inspectionEnabled } from "./service-switches.js";
import { consumeDailyCaps, type DailyCap } from "./rate-limit.js";
import { findActiveVisualCheckForProject, insertQueuedVisualCheck, markVisualCheckFailed } from "./visual-check-db.js";

/** [PILOT] 저장소 push가 안 돼도 배포는 계속(머리말 2). */
export const PUSH_FAILURE_POLICY = "continue" as const;

/** [PILOT] 배포 뒤 내용 확인: 시도 횟수 · 시도 사이 대기(전파) · 요청 하나의 시간 상한 · 본문 읽기 상한. */
export const CONTENT_CHECK = Object.freeze({ attempts: 3, delaysMs: Object.freeze([2_000, 5_000]), timeoutMs: 15_000, maxBodyBytes: 256 * 1024 });

/**
 * [PILOT] Worker 배포 파이프라인 전체 마감(산출물 수령부터). 컨테이너가 답을 기다리는 시간(builder-run.mjs
 * ARTIFACT_TIMEOUTS.uploadMs = 10분)보다 **짧아야** 한다 — 컨테이너가 먼저 포기하면 "앱은 올라갔는데 잡은 실패"가 된다
 * (PR #569 S3 검증 결함 7, 테스트가 두 값을 비교). 넘으면 failed(deploying, deploy_timeout).
 */
export const BUILD_DEPLOY_DEADLINE_MS = 8 * 60 * 1000;
export const DEPLOY_TIMEOUT = "deploy_timeout";
/** 정지 목록을 두 번 읽지 못하면 배포하지 않는다(fail-closed — 결함 5). */
export const SUSPENSION_CHECK_FAILED = "suspension_check_failed";
/** 마감 밖에서 도는 부수 호출(토큰 폐기·삭제된 프로젝트의 Worker 되돌리기)의 시간 상한. */
const SIDE_CALL_TIMEOUT_MS = 15_000;

/** B-7 정지 목록 KV 키(hosting-duties.ts SUSPENDED_KEY_PREFIX와 같은 규칙 — 그 브랜치가 머지되면 그 함수로 바꾼다). */
export function suspendedKvKey(slug: string): string {
  return `suspended:${slug}`;
}

/**
 * [PILOT] 빌드 뒤 자동 확인(시스템이 시작한 검수)의 서비스 전체 일일 상한 — 유저 검수 상한(beta-limits)에 세지 않는다
 * (유저가 누른 게 아니다). 빌드 서비스 상한(30/일)과 같은 값: 빌드 하나에 자동 확인은 하나. env로 조정.
 */
export const BUILD_AUTO_CHECK_DAILY_LIMIT = 30;
export const BUILD_AUTO_CHECK_BUCKET = "build-auto-check-global";

export function buildAutoCheckDailyLimit(env: Pick<Env, "BETA_BUILD_AUTO_CHECK_DAILY_LIMIT">): number {
  const n = parseInt(env.BETA_BUILD_AUTO_CHECK_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : BUILD_AUTO_CHECK_DAILY_LIMIT;
}

export type AutoCheckOutcome =
  | { started: true; checkRunId: string; acceptanceIds: string[] }
  | { started: false; reason: string };

export type BuildDeployOutcome =
  | { status: "done"; deployedUrl: string; commitSha: string | null; autoCheck: AutoCheckOutcome }
  | { status: "failed"; failedStage: string; error: string };

export type BuildDeployDeps = {
  fetch: FetchLike;
  /** 자동 확인 디스패치의 콜백 뿌리(검수 컨테이너가 부른다). */
  publicBaseUrl: string;
  sleep?: (ms: number) => Promise<void>;
  /** B-7 정지 목록 조회(기본: HOSTING_SUSPENDED KV가 있으면 그것, 없으면 항상 false — 머리말 3). 던지면 = 조회 오류. */
  isSuspended?: (slug: string) => Promise<boolean>;
  contentCheck?: { attempts: number; delaysMs: readonly number[]; timeoutMs: number; maxBodyBytes: number };
  /** 파이프라인 마감(기본 BUILD_DEPLOY_DEADLINE_MS) — 테스트 seam. */
  deadlineMs?: number;
};

type KvLike = { get(key: string): Promise<string | null> };
function isKvLike(v: unknown): v is KvLike {
  return typeof v === "object" && v !== null && typeof (v as { get?: unknown }).get === "function";
}

/**
 * 기본 정지 조회. B-7(feat/train-b7-hosting-duties)의 `HOSTING_SUSPENDED` KV 바인딩이 **있을 때만** 읽는다 — 아직 Env 타입에
 * 없는 이름이라 모양으로 확인한다(TODO(B-7 머지 뒤): env.HOSTING_SUSPENDED + hosting-duties.ts suspendedKey로). 바인딩이 없으면
 * 건너뛴다(false — 정지 목록 자체가 없다). **읽기 오류는 던진다** — 호출자(suspensionState)가 한 번 다시 읽고, 그래도 안 되면
 * 배포하지 않는다(PR #569 S3 검증 결함 5: 종전에는 오류를 false로 삼켜 정지된 slug도 재배포됐다).
 */
export function defaultSuspensionCheck(env: Env): (slug: string) => Promise<boolean> {
  const kv: unknown = Reflect.get(env, "HOSTING_SUSPENDED");
  if (!isKvLike(kv)) return async () => false;
  return async (slug) => (await kv.get(suspendedKvKey(slug))) !== null;
}

/**
 * 정지 여부 — 오류면 한 번 다시 읽고, 그래도 안 되면 "error"(호출자는 fail-closed). 결함 5.
 */
export async function suspensionState(check: (slug: string) => Promise<boolean>, slug: string): Promise<"clear" | "suspended" | "error"> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return (await check(slug)) ? "suspended" : "clear";
    } catch (err) {
      console.error(JSON.stringify({ event: "build_suspension_read_failed", slug, attempt, reason: String((err as Error)?.message ?? err).slice(0, 120) }));
    }
  }
  return "error";
}

/**
 * fetch에 신호를 묶는다(요청 자신의 신호 + 파이프라인 마감 + 선택 시간 상한 중 먼저 오는 것). 결함 7: 마감을 넘긴 바깥 호출이
 * 파이프라인을 붙잡지 못하게.
 */
function withSignals(fetchImpl: FetchLike, extra: AbortSignal | null, timeoutMs?: number): FetchLike {
  return (input, init) => {
    const signals: AbortSignal[] = [];
    if (init?.signal) signals.push(init.signal);
    if (extra) signals.push(extra);
    if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
    const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    return fetchImpl(input, signal ? { ...(init ?? {}), signal } : init);
  };
}

/** CF 결과 → 짧은 오류 꼬리(`cf_<코드>` · `http_<상태>` · 메시지 · network · not_configured). 토큰 없음. */
function cfTail<T>(r: Extract<ProvisionResult<T>, { ok: false }>): string {
  const code = r.cfErrors?.[0]?.code;
  if (typeof code === "number" && code > 0) return `cf_${code}`;
  if (r.message) return r.message.slice(0, 80);
  if (r.status) return `http_${r.status}`;
  return r.error;
}

async function readTextCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) break;
      const room = max - total;
      if (value.byteLength >= room) {
        chunks.push(value.subarray(0, room));
        total = max;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    /* 읽은 데까지 */
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    buf.set(ch, off);
    off += ch.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** 한 번의 확인. 사유 코드: health_status_<n> · health_not_json · health_not_ok · page_status_<n> · page_empty · page_marker_missing · network. */
async function checkOnce(baseUrl: string, fetchImpl: FetchLike, timeoutMs: number, maxBody: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const h = await fetchImpl(`${baseUrl}/api/health`, { method: "GET", redirect: "manual", headers: { accept: "application/json", "cache-control": "no-cache" }, signal: AbortSignal.timeout(timeoutMs) });
    const hText = await readTextCapped(h, maxBody);
    if (h.status !== 200) return { ok: false, reason: `health_status_${h.status}` };
    let hJson: unknown;
    try {
      hJson = JSON.parse(hText);
    } catch {
      return { ok: false, reason: "health_not_json" };
    }
    if (typeof hJson !== "object" || hJson === null || (hJson as { ok?: unknown }).ok !== true) return { ok: false, reason: "health_not_ok" };
    const p = await fetchImpl(`${baseUrl}/`, { method: "GET", redirect: "manual", headers: { accept: "text/html", "cache-control": "no-cache" }, signal: AbortSignal.timeout(timeoutMs) });
    const pText = await readTextCapped(p, maxBody);
    if (p.status !== 200) return { ok: false, reason: `page_status_${p.status}` };
    if (pText.trim().length === 0) return { ok: false, reason: "page_empty" };
    if (!/<script\b[^>]*\bsrc\s*=/i.test(pText)) return { ok: false, reason: "page_marker_missing" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `network:${String((err as Error)?.name ?? "error").slice(0, 40)}` };
  }
}

/**
 * 배포 뒤 **내용** 확인(상태 코드만이 아니라): `/api/health` 200 + JSON ok:true, `/` 200 + 비어 있지 않은 HTML + `<script … src=`.
 * 실패면 attempts번까지 다시(전파 지연). 마지막 사유를 돌려준다.
 */
export async function checkDeployedContent(
  deployedUrl: string,
  fetchImpl: FetchLike,
  { attempts = CONTENT_CHECK.attempts, delaysMs = CONTENT_CHECK.delaysMs, timeoutMs = CONTENT_CHECK.timeoutMs, maxBodyBytes = CONTENT_CHECK.maxBodyBytes, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: { attempts?: number; delaysMs?: readonly number[]; timeoutMs?: number; maxBodyBytes?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: true; attempts: number } | { ok: false; reason: string; attempts: number }> {
  const base = deployedUrl.replace(/\/+$/, "");
  let last = "not_checked";
  const n = Math.max(1, attempts);
  for (let i = 0; i < n; i += 1) {
    if (i > 0) await sleep(delaysMs[Math.min(i - 1, delaysMs.length - 1)] ?? 0);
    const r = await checkOnce(base, fetchImpl, timeoutMs, maxBodyBytes);
    if (r.ok) return { ok: true, attempts: i + 1 };
    last = r.reason;
  }
  return { ok: false, reason: last, attempts: n };
}

function commitMessageFor(job: DbBuildJob, artifact: BuildArtifact): string {
  const s = artifact.summary;
  const done = s?.wbsDone ?? job.wbsDone;
  const failed = s?.wbsFailed ?? [];
  if (job.locale === "en") {
    return `Simsa build ${job.id}: ${done} work item(s) done${failed.length ? ` · not done: ${failed.slice(0, 10).join(", ")}` : ""}\n\nBuild gate: install → build → test passed.`;
  }
  return `Simsa 빌드 ${job.id}: 작업 ${done}개 완료${failed.length ? ` · 못 한 작업: ${failed.slice(0, 10).join(", ")}` : ""}\n\n빌드 게이트(설치 → 빌드 → 테스트) 통과.`;
}

/**
 * 저장소 push(B-5b-5). 결과만 돌려준다 — 상태 전이·이벤트는 호출자. 토큰 폐기는 마감에 묶이지 않은 revokeFetch로(마감에 걸려
 * push가 끊겨도 폐기는 한다).
 */
async function pushSource(env: Env, job: DbBuildJob, artifact: BuildArtifact, fetchImpl: FetchLike, revokeFetch: FetchLike): Promise<{ pushed: true; commitSha: string; files: number; repo: string } | { pushed: false; reason: string }> {
  if (!job.repoFullName) return { pushed: false, reason: "no_repo" };
  const expected = `${hostingOrg(env)}/${job.slug}`;
  if (job.repoFullName.toLowerCase() !== expected.toLowerCase()) return { pushed: false, reason: "repo_mismatch" };
  if (artifact.source.length === 0) return { pushed: false, reason: "no_source" };
  const tok = await getRepoScopedInstallationToken(env, job.slug, fetchImpl);
  if (!tok.ok) return { pushed: false, reason: `token_${tok.error}${tok.message === "scope_not_narrowed" ? ":scope_not_narrowed" : ""}` };
  try {
    const r = await pushScaffold(
      {
        token: tok.value.token,
        org: tok.value.org,
        name: tok.value.name,
        files: artifact.source.map((f) => ({ path: f.path, content: "", base64: f.base64, executable: f.executable })),
        message: commitMessageFor(job, artifact),
      },
      fetchImpl,
    );
    if (!r.ok) return { pushed: false, reason: `push_${r.error}${r.status ? `_${r.status}` : ""}` };
    return { pushed: true, commitSha: r.value.commitSha, files: r.value.fileCount, repo: expected };
  } finally {
    await revokeInstallationToken(tok.value.token, revokeFetch);
  }
}

function toUploadModules(artifact: BuildArtifact): UserWorkerModule[] {
  return artifact.worker.modules.map((m) => ({
    name: m.name,
    content: base64ToBytes(m.base64),
    type: m.kind === "wasm" ? "application/wasm" : "application/javascript+module",
  }));
}

/**
 * 빌드 뒤 자동 확인(T2) 1회. 시스템 시작 — 유저 일일 상한 밖, 별도 서비스 상한(BUILD_AUTO_CHECK_*). 건너뛴 사유:
 * inspection_disabled · project_missing · active_check · daily_capacity · save_failed · dispatch_failed:<note>.
 */
export async function startBuildAutoCheck(
  env: Env,
  args: { job: DbBuildJob; deployedUrl: string; publicBaseUrl: string },
): Promise<AutoCheckOutcome> {
  const { job, deployedUrl } = args;
  if (!inspectionEnabled(env)) return { started: false, reason: "inspection_disabled" };
  const project = await getProject(env, job.projectId).catch(() => null);
  if (!project) return { started: false, reason: "project_missing" };
  const active = await findActiveVisualCheckForProject(env, job.projectId).catch(() => null);
  if (active) return { started: false, reason: "active_check" };
  const cap: DailyCap = { scope: "service", bucket: BUILD_AUTO_CHECK_BUCKET, key: "all", limit: buildAutoCheckDailyLimit(env) };
  const caps = await consumeDailyCaps(env, [cap]);
  if (caps.limited) return { started: false, reason: "daily_capacity" };
  const acceptancePlan = acceptancePlanFromDevSpec(project.devSpec);
  const locale: "ko" | "en" = job.locale === "en" ? "en" : "ko";
  const spec = validateDevSpec(project.devSpec);
  const intent = confirmedIntentFromProject(project) ?? (spec.ok && spec.spec.brief.oneLine.trim() ? spec.spec.brief.oneLine.trim().slice(0, 1000) : defaultInspectionIntent(locale));
  let runId: string;
  try {
    const run = await insertQueuedVisualCheck(env, { projectId: job.projectId, userKey: job.userKey, targetUrl: deployedUrl, intent, locale, sourceCheckId: null });
    runId = run.id;
  } catch (err) {
    console.error(JSON.stringify({ event: "build_auto_check_insert_failed", jobId: job.id, reason: String((err as Error)?.message ?? err).slice(0, 120) }));
    await caps.refund();
    return { started: false, reason: "save_failed" };
  }
  // 2026-10-05 문 (a): 스태프 티어 빌드는 **같은 지시서 AC**를 agent 엔진(수용 기준 실행기)으로 실제로 해 본다.
  //  실패한 AC는 런의 고침 지시(agentPrompt)가 되고, 다시 만들기(POST build · fixFromCheckRunId)가 그것을 빌드 지시서에 붙인다.
  const tier = await resolveTier(env, job.userKey).catch(() => "free" as const);
  const agentAcs = tier === "staff" ? agentAcsFromDevSpec(project.devSpec) : [];
  const dispatch = await dispatchInspection(env, {
    runId, projectId: job.projectId, userKey: job.userKey, targetUrl: deployedUrl, intent, locale, publicBaseUrl: args.publicBaseUrl, acceptancePlan,
    ...(agentAcs.length > 0 ? { agent: { acs: agentAcs, acSource: devSpecAcSource(project.devSpec, project.entryPath), loginMode: "none" as const } } : {}),
  });
  if (!dispatch.dispatched) {
    await markVisualCheckFailed(env, runId, dispatch.note ?? "dispatch_failed").catch(() => undefined);
    await caps.refund();
    return { started: false, reason: `dispatch_failed:${String(dispatch.note ?? "unknown").slice(0, 60)}` };
  }
  return { started: true, checkRunId: runId, acceptanceIds: agentAcs.length > 0 ? agentAcs.map((a) => a.id) : acceptancePlan.map((s) => s.acceptanceId) };
}

/**
 * 산출물을 받은(claimBuildArtifact) 잡 하나의 나머지 전부 — 머리말 1)~5). 던지지 않는다(예외는 failed(현재 단계, deploy_crashed)).
 * 바깥에 쓰기 직전마다 관문(checkpoint)을 지난다 — 머리말 1). 모든 바깥 호출은 마감 신호에 묶인다.
 */
export async function runBuildDeploy(env: Env, job: DbBuildJob, artifact: BuildArtifact, deps: BuildDeployDeps): Promise<BuildDeployOutcome> {
  const deadlineMs = Math.max(1, Math.floor(deps.deadlineMs ?? BUILD_DEPLOY_DEADLINE_MS));
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(deadlineMs);
  const timedOut = (): boolean => deadline.aborted || Date.now() - startedAt >= deadlineMs;
  /** 파이프라인의 바깥 호출(GitHub push · D1 · 자산 · Worker 업로드 · 내용 확인) — 마감에 끊긴다. */
  const fetchImpl = withSignals(deps.fetch, deadline);
  /** 마감 밖의 부수 호출(토큰 폐기 · 삭제된 프로젝트의 Worker 되돌리기) — 자기 시간 상한만. */
  const sideFetch = withSignals(deps.fetch, null, SIDE_CALL_TIMEOUT_MS);
  const isSuspended = deps.isSuspended ?? defaultSuspensionCheck(env);
  let stage: string = job.status;

  /** 잡이 이미 (다른 누군가에 의해) 끝났으면 그 기록 그대로. */
  const endedAs = (cur: DbBuildJob | null, fallback: string): BuildDeployOutcome => ({
    status: "failed", failedStage: cur?.failedStage ?? stage, error: cur?.error ?? fallback,
  });
  const failAt = async (failedStage: string, error: string): Promise<BuildDeployOutcome> => {
    const changed = await markBuildJobFailed(env, job.id, { failedStage, error });
    if (changed) {
      await appendBuildJobEvent(env, job.id, "failed", error, { failedStage });
      return { status: "failed", failedStage, error };
    }
    return endedAs(await getBuildJobById(env, job.id), error);
  };
  /**
   * 관문 — 바깥에 쓰기 직전마다(결함 1·3·5·7). 통과면 null. 순서: 마감 → 잡이 아직 Worker 소유인가 → 킬스위치 → 프로젝트 존재 →
   * (push 앞·업로드 앞) 정지 목록.
   */
  const checkpoint = async (opts: { suspension?: boolean } = {}): Promise<BuildDeployOutcome | null> => {
    if (timedOut()) return failAt("deploying", DEPLOY_TIMEOUT);
    const cur = await getBuildJobById(env, job.id);
    // 행이 없다 = 프로젝트 삭제의 호스팅 정리가 잡 행까지 지웠다(또는 알 수 없는 삭제).
    if (!cur) return { status: "failed", failedStage: stage, error: (await projectExists(env, job.projectId)) ? "job_not_active" : PROJECT_DELETED };
    if (!isWorkerOwnedBuildJob(cur)) return endedAs(cur, "job_not_active");
    if (!buildEnabled(env)) {
      await stopActiveBuildJob(env, job.id, BUILD_DISABLED, cur);
      return { status: "failed", failedStage: cur.status, error: BUILD_DISABLED };
    }
    if (!(await projectExists(env, job.projectId))) {
      await stopActiveBuildJob(env, job.id, PROJECT_DELETED, cur);
      return { status: "failed", failedStage: cur.status, error: PROJECT_DELETED };
    }
    if (opts.suspension) {
      const s = await suspensionState(isSuspended, job.slug);
      if (s === "suspended") return failAt("deploying", "slug_suspended");
      if (s === "error") return failAt("deploying", SUSPENSION_CHECK_FAILED);
    }
    return null;
  };
  /**
   * Worker 업로드 **뒤**(과 done 직전) — 업로드가 도는 사이 프로젝트가 지워졌으면 방금 올린 공개 Worker를 되돌린다(삭제 정리가
   * 업로드보다 먼저 끝났을 수 있다 — 결함 1). 그 경우 삭제된 프로젝트의 잡에는 타임라인을 더 쓰지 않는다(로그만). 잡이 다른
   * 이유로 끝났거나 킬스위치가 꺼졌으면 그대로 멈춘다(앱은 올라가 있다 — worker_uploaded 이벤트가 그 사실을 남긴다).
   */
  const afterUpload = async (): Promise<BuildDeployOutcome | null> => {
    const cur = await getBuildJobById(env, job.id);
    const deleted = cur?.error === PROJECT_DELETED || !(await projectExists(env, job.projectId));
    if (deleted) {
      if (cur && isWorkerOwnedBuildJob(cur)) await markBuildJobFailed(env, job.id, { failedStage: cur.status, error: PROJECT_DELETED });
      const undo = await deleteUserWorker(env, job.slug, sideFetch);
      console.log(JSON.stringify({ event: "build_deploy_undo_deleted_project", jobId: job.id, slug: job.slug, removed: undo.ok, reason: undo.ok ? null : undo.error }));
      return { status: "failed", failedStage: stage, error: PROJECT_DELETED };
    }
    if (!cur || !isWorkerOwnedBuildJob(cur)) return endedAs(cur, "job_not_active");
    if (!buildEnabled(env)) {
      await stopActiveBuildJob(env, job.id, BUILD_DISABLED, cur);
      return { status: "failed", failedStage: cur.status, error: BUILD_DISABLED };
    }
    return null;
  };

  try {
    const gate1 = await checkpoint({ suspension: true });
    if (gate1) return gate1;

    // ── 2) 저장소 push ──
    const push = await pushSource(env, job, artifact, fetchImpl, sideFetch);
    let commitSha: string | null = null;
    if (push.pushed) {
      commitSha = push.commitSha;
      await recordBuildJobCommit(env, job.id, push.commitSha);
      if (await advanceBuildJob(env, job.id, { status: "pushed" })) stage = "pushed";
      await appendBuildJobEvent(env, job.id, "pushed", "repo_pushed", { repo: push.repo, commit: push.commitSha.slice(0, 12), files: push.files });
    } else {
      await appendBuildJobEvent(env, job.id, stage, `push_skipped:${push.reason}`.slice(0, 120), { policy: PUSH_FAILURE_POLICY });
    }

    const gate2 = await checkpoint();
    if (gate2) return gate2;

    // ── 3) 배포 ──
    if (!(await advanceBuildJob(env, job.id, { status: "deploying" }))) return endedAs(await getBuildJobById(env, job.id), "job_not_active");
    stage = "deploying";
    await appendBuildJobEvent(env, job.id, "deploying", "deploy_started", { modules: artifact.stats.modules.count, assets: artifact.stats.assets.count, migrations: artifact.stats.migrations.count });
    const hostRoot = (env.HOSTING_ROOT_DOMAIN ?? "").trim().replace(/^\.+|\.+$/g, "");
    if (!hostRoot) return failAt("deploying", "hosting_not_configured");

    if (artifact.migrations.length > 0) {
      if (!job.d1Id) return failAt("deploying", "d1_missing");
      const gateD1 = await checkpoint();
      if (gateD1) return gateD1;
      const mig = await applyD1Migrations(env, job.d1Id, artifact.migrations, fetchImpl);
      if (!mig.ok) return failAt("deploying", timedOut() ? DEPLOY_TIMEOUT : `d1_migration_failed:${cfTail(mig)}`);
      await appendBuildJobEvent(env, job.id, "deploying", "d1_migrated", { applied: mig.value.applied, alreadyApplied: mig.value.alreadyApplied });
    }

    const gateAssets = await checkpoint();
    if (gateAssets) return gateAssets;
    const assets = await uploadUserWorkerAssets(env, { slug: job.slug, files: artifact.assets }, fetchImpl);
    if (!assets.ok) return failAt("deploying", timedOut() ? DEPLOY_TIMEOUT : `assets_upload_failed:${cfTail(assets)}`);

    const gateUpload = await checkpoint({ suspension: true });
    if (gateUpload) return gateUpload;
    const up = await uploadUserWorker(
      env,
      {
        slug: job.slug,
        modules: toUploadModules(artifact),
        compatibilityDate: HOSTED_COMPATIBILITY_DATE,
        ...(job.d1Id ? { d1Id: job.d1Id } : {}),
        ...(assets.value ? { assets: { jwt: assets.value.jwt, config: { ...HOSTED_ASSETS_CONFIG, run_worker_first: [...HOSTED_ASSETS_CONFIG.run_worker_first] } } } : {}),
      },
      fetchImpl,
    );
    if (!up.ok) return failAt("deploying", timedOut() ? DEPLOY_TIMEOUT : `worker_upload_failed:${cfTail(up)}`);
    const afterUp = await afterUpload();
    if (afterUp && afterUp.status === "failed" && afterUp.error === PROJECT_DELETED) return afterUp;
    await appendBuildJobEvent(env, job.id, "deploying", "worker_uploaded", { assetsUploaded: assets.value?.uploaded ?? 0, assetsTotal: assets.value?.total ?? 0 });
    if (afterUp) return afterUp;

    // ── 4) 내용 확인 — 주소는 Worker가 계산 ──
    const deployedUrl = `https://${job.slug}.${hostRoot}`;
    const check = await checkDeployedContent(deployedUrl, fetchImpl, { ...(deps.contentCheck ?? {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) });
    if (!check.ok) return failAt("deploying", timedOut() ? DEPLOY_TIMEOUT : `content_check_failed:${check.reason}`);
    if (timedOut()) return failAt("deploying", DEPLOY_TIMEOUT);

    // ── 5) done → 자동 확인 ──
    const beforeDone = await afterUpload();
    if (beforeDone) return beforeDone;
    const fresh = await getBuildJobById(env, job.id);
    const done = await markBuildJobDone(env, job.id, { deployedUrl, commitSha, spentUsd: 0, buildExitCode: 0, wbsDone: fresh?.wbsDone ?? job.wbsDone });
    if (!done.ok) {
      if (done.reason === "not_active") return endedAs(await getBuildJobById(env, job.id), "job_not_active");
      return failAt("deploying", `done_rejected:${done.reason}`);
    }
    await appendBuildJobEvent(env, job.id, "done", "deployed", { url: deployedUrl, commit: commitSha ? commitSha.slice(0, 12) : null, contentCheckAttempts: check.attempts });
    let autoCheck: AutoCheckOutcome;
    try {
      autoCheck = await startBuildAutoCheck(env, { job: fresh ?? job, deployedUrl, publicBaseUrl: deps.publicBaseUrl });
    } catch (err) {
      autoCheck = { started: false, reason: `crashed:${String((err as Error)?.message ?? err).slice(0, 60)}` };
    }
    if (autoCheck.started) {
      await appendBuildJobEvent(env, job.id, "done", "auto_check_started", { checkRunId: autoCheck.checkRunId, acceptanceIds: autoCheck.acceptanceIds, targetUrl: deployedUrl });
    } else {
      await appendBuildJobEvent(env, job.id, "done", `auto_check_skipped:${autoCheck.reason}`.slice(0, 120), {});
    }
    return { status: "done", deployedUrl, commitSha, autoCheck };
  } catch (err) {
    console.error(JSON.stringify({ event: "build_deploy_crashed", jobId: job.id, stage, reason: String((err as Error)?.message ?? err).slice(0, 200) }));
    return failAt(stage, "deploy_crashed");
  }
}

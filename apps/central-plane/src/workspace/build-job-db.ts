/**
 * workspace/build-job-db.ts — SI 티어 Train B — B5: T1 빌드 잡 상태 머신 (D-4 · D-7).
 *
 * visual-check-db.ts와 같은 규율: 전이는 "진행 중 상태에서만" 허용되고 done/failed는 최종이다.
 * 상태 순서는 D-4 그대로. 대시보드는 status와 wbs_done/wbs_total을 그대로 보여준다(진행률 % 없음).
 */
import type { Env } from "../env.js";

export const BUILD_JOB_STATUSES = ["queued", "scaffolding", "implementing", "building", "testing", "pushed", "deploying", "done", "failed"] as const;
export type BuildJobStatus = (typeof BUILD_JOB_STATUSES)[number];
export const BUILD_JOB_ACTIVE: ReadonlySet<BuildJobStatus> = new Set(["queued", "scaffolding", "implementing", "building", "testing", "pushed", "deploying"]);
/** 진행 단계 순서 — 역행 전이는 거부한다(컨테이너 콜백이 늦게 도착해도 상태가 뒤로 가지 않게). */
const STAGE_ORDER: Readonly<Record<BuildJobStatus, number>> = { queued: 0, scaffolding: 1, implementing: 2, building: 3, testing: 4, pushed: 5, deploying: 6, done: 7, failed: 7 };

/** D-7 [PILOT] 프로젝트당 T1 예산. 과금 도입은 별도 결정(PRD §12 무료 유지). */
export const DEFAULT_BUILD_BUDGET_USD = 10;

export type DbBuildJob = {
  id: string;
  projectId: string;
  userKey: string;
  slug: string;
  status: BuildJobStatus;
  failedStage: string | null;
  error: string | null;
  wbsDone: number;
  wbsTotal: number;
  budgetUsd: number;
  spentUsd: number;
  d1Id: string | null;
  repoFullName: string | null;
  commitSha: string | null;
  deployedUrl: string | null;
  buildExitCode: number | null;
  locale: "ko" | "en" | null;
  createdAt: string;
  updatedAt: string;
};

export type BuildJobEvent = { id: string; jobId: string; at: string; stage: string; message: string; meta: Record<string, unknown> };

function randId(prefix: string): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${raw.slice(0, 10)}`;
}

type Row = {
  id: string; project_id: string; user_key: string; slug: string; status: string; failed_stage: string | null; error: string | null;
  wbs_done: number; wbs_total: number; budget_usd: number; spent_usd: number; d1_id: string | null; repo_full_name: string | null;
  commit_sha: string | null; deployed_url: string | null; build_exit_code: number | null; locale: string | null; created_at: string; updated_at: string;
};

function rowToJob(r: Row): DbBuildJob {
  return {
    id: r.id, projectId: r.project_id, userKey: r.user_key, slug: r.slug,
    status: (BUILD_JOB_STATUSES as readonly string[]).includes(r.status) ? (r.status as BuildJobStatus) : "failed",
    failedStage: r.failed_stage ?? null, error: r.error ?? null,
    wbsDone: Number(r.wbs_done ?? 0), wbsTotal: Number(r.wbs_total ?? 0),
    budgetUsd: Number(r.budget_usd ?? 0), spentUsd: Number(r.spent_usd ?? 0),
    d1Id: r.d1_id ?? null, repoFullName: r.repo_full_name ?? null, commitSha: r.commit_sha ?? null, deployedUrl: r.deployed_url ?? null,
    buildExitCode: r.build_exit_code === null || r.build_exit_code === undefined ? null : Number(r.build_exit_code),
    locale: r.locale === "en" ? "en" : r.locale === "ko" ? "ko" : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const COLS = `id, project_id, user_key, slug, status, failed_stage, error, wbs_done, wbs_total, budget_usd, spent_usd, d1_id, repo_full_name, commit_sha, deployed_url, build_exit_code, locale, created_at, updated_at`;

export async function insertQueuedBuildJob(
  env: Env,
  input: { projectId: string; userKey: string; slug: string; wbsTotal: number; budgetUsd?: number; locale?: "ko" | "en"; d1Id?: string | null; repoFullName?: string | null; now?: string },
): Promise<DbBuildJob> {
  const id = randId("bj");
  const now = input.now ?? new Date().toISOString();
  const budget = input.budgetUsd ?? DEFAULT_BUILD_BUDGET_USD;
  await env.DB.prepare(
    `INSERT INTO build_jobs (${COLS})
     VALUES (?, ?, ?, ?, 'queued', NULL, NULL, 0, ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
  )
    .bind(id, input.projectId, input.userKey, input.slug, input.wbsTotal, budget, input.d1Id ?? null, input.repoFullName ?? null, input.locale ?? null, now, now)
    .run();
  return {
    id, projectId: input.projectId, userKey: input.userKey, slug: input.slug, status: "queued", failedStage: null, error: null,
    wbsDone: 0, wbsTotal: input.wbsTotal, budgetUsd: budget, spentUsd: 0, d1Id: input.d1Id ?? null, repoFullName: input.repoFullName ?? null,
    commitSha: null, deployedUrl: null, buildExitCode: null, locale: input.locale ?? null, createdAt: now, updatedAt: now,
  };
}

export async function getBuildJobById(env: Env, id: string): Promise<DbBuildJob | null> {
  const row = (await env.DB.prepare(`SELECT ${COLS} FROM build_jobs WHERE id = ?`).bind(id).first()) as Row | null;
  return row ? rowToJob(row) : null;
}

export async function listBuildJobsForProject(env: Env, projectId: string, limit = 20): Promise<DbBuildJob[]> {
  const res = await env.DB.prepare(`SELECT ${COLS} FROM build_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`).bind(projectId, limit).all<Row>();
  return (res.results ?? []).map(rowToJob);
}

export async function findActiveBuildJobForProject(env: Env, projectId: string): Promise<{ id: string; status: BuildJobStatus } | null> {
  const row = (await env.DB.prepare(
    `SELECT id, status FROM build_jobs WHERE project_id = ? AND status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying') ORDER BY created_at DESC LIMIT 1`,
  ).bind(projectId).first()) as { id: string; status: BuildJobStatus } | null;
  return row ?? null;
}

/**
 * 진행 전이(컨테이너 progress 콜백). 현재 상태가 활성이고 **뒤로 가지 않을 때만** 갱신. 쓰는 칸은 status·wbs_done뿐.
 *
 * PR #569 S1 검증 결함 1: 이 함수는 컨테이너가 부른다 — 컨테이너(B-5b-2부터 LLM이 만든 코드를 실행)가 정할 수 있는 것은
 * "지금 어느 단계인가"와 "WBS 몇 개 끝냈나"뿐이다. repo_full_name(push 대상)·commit_sha·build_exit_code·wbs_total은
 * **Worker 소유**다: repo와 WBS 수는 insert 때 Worker가 정하고, 커밋·빌드 결과·배포 주소는 S3에서 Worker가 자기 push·
 * 배포 뒤에 쓴다(콜백 입력에서 받지 않는다 — 종전에는 잡 토큰 하나로 push 대상을 조직의 다른 저장소로 바꿀 수 있었다).
 * wbsDone은 단조 증가 + wbs_total 상한. spent_usd는 건드리지 않는다(LLM 프록시만 — 잃어버린 갱신이 원천적으로 없다).
 */
export async function advanceBuildJob(
  env: Env,
  id: string,
  input: { status: Exclude<BuildJobStatus, "done" | "failed">; wbsDone?: number },
): Promise<boolean> {
  const current = await getBuildJobById(env, id);
  if (!current || !BUILD_JOB_ACTIVE.has(current.status)) return false;
  if (STAGE_ORDER[input.status] < STAGE_ORDER[current.status]) return false;
  const claimed = Number.isFinite(input.wbsDone) ? Math.floor(input.wbsDone as number) : 0;
  const wbsDone = Math.min(Math.max(current.wbsDone, claimed), Math.max(current.wbsTotal, current.wbsDone));
  const res = await env.DB.prepare(
    `UPDATE build_jobs
        SET status = ?, wbs_done = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying')`,
  )
    .bind(input.status, wbsDone, new Date().toISOString(), id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * 배포 주소로 저장해도 되는가 — https, 자격 증명 없음. S3에서 Worker가 `https://<slug>.<HOSTING_ROOT_DOMAIN>`을 **스스로
 * 계산해** 넘긴다(콜백 입력이 아니다). 그래도 이 칸은 B-8이 비개발자에게 링크로 보여 주므로 저장 직전에 한 번 더 막는다
 * (PR #569 S1 검증 결함 2 — 종전 라우트는 `javascript:` 주소도 저장했다).
 */
export function isStorableDeployedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.username === "" && u.password === "" && u.hostname.length > 0;
}

/**
 * 최종 성공 — **Worker만 부른다**(S3: 자기 배포가 끝난 뒤). 컨테이너의 done 주장(/internal/build-done ok:true)은 라우트가
 * 거절한다(결함 2). D-4: build_exit_code가 0이 아니면 done으로 못 간다 — 호출자가 걸러도 여기서 한 번 더 막는다.
 * deployedUrl은 https만(isStorableDeployedUrl). spent_usd는 `MAX(spent_usd, ?)` — 프록시가 계량한 값보다 내려가지 않는다.
 */
export async function markBuildJobDone(
  env: Env,
  id: string,
  input: { deployedUrl: string; commitSha: string | null; spentUsd: number; buildExitCode: number; wbsDone: number },
): Promise<{ ok: true } | { ok: false; reason: "not_active" | "build_not_green" | "invalid_deployed_url" }> {
  if (input.buildExitCode !== 0) return { ok: false, reason: "build_not_green" };
  if (!isStorableDeployedUrl(input.deployedUrl)) return { ok: false, reason: "invalid_deployed_url" };
  const res = await env.DB.prepare(
    `UPDATE build_jobs
        SET status = 'done', deployed_url = ?, commit_sha = COALESCE(?, commit_sha), spent_usd = MAX(spent_usd, ?), build_exit_code = 0, wbs_done = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying')`,
  )
    .bind(input.deployedUrl, input.commitSha, input.spentUsd, input.wbsDone, new Date().toISOString(), id)
    .run();
  return (res.meta?.changes ?? 0) > 0 ? { ok: true } : { ok: false, reason: "not_active" };
}

export async function markBuildJobFailed(env: Env, id: string, input: { failedStage: string; error: string; spentUsd?: number; buildExitCode?: number | null }): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE build_jobs
        SET status = 'failed', failed_stage = ?, error = ?, spent_usd = MAX(spent_usd, ?), build_exit_code = COALESCE(?, build_exit_code), updated_at = ?
      WHERE id = ? AND status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying')`,
  )
    .bind(input.failedStage.slice(0, 40), input.error.slice(0, 500), input.spentUsd ?? 0, input.buildExitCode ?? null, new Date().toISOString(), id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * 활성 잡을 **지금 단계에서** 멈춘다: failed(현재 단계, reason) + 타임라인 한 줄(행이 실제로 바뀐 때만). 이미 끝난 잡이면
 * 아무것도 하지 않는다. 킬스위치(build_disabled)·컨테이너의 done 주장 거절(done_not_worker_owned)이 쓴다 — 멈추는 이유가
 * 스피너가 아니라 대시보드의 정직한 실패로 남게. `known`은 호출자가 이미 읽은 행(다시 읽지 않는다). 멈췄나를 돌려준다.
 */
export async function stopActiveBuildJob(env: Env, id: string, reason: string, known?: DbBuildJob | null): Promise<boolean> {
  const job = known ?? (await getBuildJobById(env, id));
  if (!job || !BUILD_JOB_ACTIVE.has(job.status)) return false;
  const stopped = await markBuildJobFailed(env, id, { failedStage: job.status, error: reason });
  if (stopped) await appendBuildJobEvent(env, id, "failed", reason, { failedStage: job.status });
  return stopped;
}

/** 활성 상태 목록 — SQL 조건용(BUILD_JOB_ACTIVE와 같은 집합). */
const ACTIVE_SQL = `('queued','scaffolding','implementing','building','testing','pushed','deploying')`;

/**
 * B-6 서버 권위 예산 — spent_usd의 **유일한 증가 경로**는 LLM 프록시의 예약·정산이다(컨테이너 본문의 spentUsd는 라우트가
 * 쓰지 않는다). updated_at도 올린다(LLM 호출 = 진행 중 — 스턱 스윕이 일하는 잡을 치우지 않게).
 *
 * PR #569 S1 검증 결함 4 — 예산은 **예약**이다(스키마 변경 없음, 같은 spent_usd 칸).
 * LLM 프록시가 업스트림을 부르기 **전에** 그 호출의 최악 비용을 원자적으로 더한다. 조건: 잡이 활성이고 spent_usd < budget_usd
 * (예약분 포함). 종전에는 "읽고 → 부르고 → 더하기"라 같은 잡의 동시 호출이 모두 같은 옛 spent를 보고 통과했다(40개 동시 →
 * 예산의 4.7배). 이제 한 번에 하나만 들어가고, 들어간 호출의 초과 폭은 그 호출 1회 비용이 상한이다.
 * 입장 조건을 "spent + 최악 ≤ budget"이 아니라 "spent < budget"으로 둔 이유: 최악 추정(바이트=토큰·최고 단가·출력 상한)은
 * 실제보다 몇 배 크다 — 엄격 조건이면 예산의 1/3을 남긴 채 멈춘다. 반환: 예약했나(false = 예산 소진이거나 끝난 잡).
 */
export async function reserveBuildJobSpend(env: Env, id: string, maxUsd: number): Promise<boolean> {
  const amount = Number.isFinite(maxUsd) && maxUsd > 0 ? maxUsd : 0;
  const res = await env.DB.prepare(
    `UPDATE build_jobs SET spent_usd = spent_usd + ?, updated_at = ? WHERE id = ? AND status IN ${ACTIVE_SQL} AND spent_usd < budget_usd`,
  )
    .bind(amount, new Date().toISOString(), id)
    .run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * 예약 정산: 예약분을 빼고 실제 비용을 더한다(한 문장 — 원자). 상태와 무관(그 사이 잡이 끝났어도 쓴 돈은 쓴 돈).
 * 0 아래로 내려가지 않는다. 업스트림이 실패하면 actual = 0(예약 해제). Worker가 정산 전에 죽으면 예약이 남는다 —
 * 보수 쪽(예산이 덜 남는다)으로 실패한다.
 */
export async function settleBuildJobSpend(env: Env, id: string, reservedUsd: number, actualUsd: number): Promise<void> {
  const reserved = Number.isFinite(reservedUsd) && reservedUsd > 0 ? reservedUsd : 0;
  const actual = Number.isFinite(actualUsd) && actualUsd > 0 ? actualUsd : 0;
  await env.DB.prepare(`UPDATE build_jobs SET spent_usd = MAX(0, spent_usd - ? + ?), updated_at = ? WHERE id = ?`)
    .bind(reserved, actual, new Date().toISOString(), id)
    .run();
}

/**
 * 잡 하나의 타임라인 행 상한(PR #569 S1 검증 결함 7). 정상 잡의 최대 = WBS 120(dev-spec 상한) × (started·done) + 단계 행
 * 십여 개 ≈ 260. 컨테이너가 진행 콜백을 무한히 보내도 D1 행은 이 수를 넘지 않는다.
 */
export const BUILD_JOB_EVENT_CAP = 400;

/** 타임라인 한 줄. 잡당 BUILD_JOB_EVENT_CAP을 넘으면 쓰지 않는다(한 문장 — 세기와 쓰기 사이 경합 없음). 썼나를 돌려준다. */
export async function appendBuildJobEvent(env: Env, jobId: string, stage: string, message: string, meta: Record<string, unknown> = {}): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO build_job_events (id, job_id, at, stage, message, meta_json)
     SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM build_job_events WHERE job_id = ?) < ?`,
  )
    .bind(randId("bje"), jobId, new Date().toISOString(), stage.slice(0, 40), message.slice(0, 500), JSON.stringify(meta).slice(0, 4000), jobId, BUILD_JOB_EVENT_CAP)
    .run();
  return Number(res.meta?.changes ?? 0) > 0;
}

export async function listBuildJobEvents(env: Env, jobId: string, limit = 200): Promise<BuildJobEvent[]> {
  const res = await env.DB.prepare(`SELECT id, job_id, at, stage, message, meta_json FROM build_job_events WHERE job_id = ? ORDER BY at ASC LIMIT ?`).bind(jobId, limit).all<{ id: string; job_id: string; at: string; stage: string; message: string; meta_json: string }>();
  return (res.results ?? []).map((r) => {
    let meta: Record<string, unknown> = {};
    try { const v = JSON.parse(r.meta_json); if (v && typeof v === "object") meta = v as Record<string, unknown>; } catch { /* ignore */ }
    return { id: r.id, jobId: r.job_id, at: r.at, stage: r.stage, message: r.message, meta };
  });
}

/** 컨테이너가 죽어 활성 상태에 갇힌 잡(스턱 스윕용). */
export async function listStuckBuildJobs(env: Env, cutoffIso: string, limit = 50): Promise<Array<{ id: string; status: BuildJobStatus }>> {
  const res = await env.DB.prepare(
    `SELECT id, status FROM build_jobs WHERE status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying') AND updated_at < ? ORDER BY updated_at ASC LIMIT ?`,
  ).bind(cutoffIso, limit).all<{ id: string; status: BuildJobStatus }>();
  return res.results ?? [];
}

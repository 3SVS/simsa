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
 * 진행 전이(컨테이너 progress 콜백). 현재 상태가 활성이고 **뒤로 가지 않을 때만** 갱신.
 * wbsDone·spentUsd·d1Id·repo·commit은 있으면 함께 갱신(단조 증가/마지막 값).
 */
export async function advanceBuildJob(
  env: Env,
  id: string,
  input: { status: Exclude<BuildJobStatus, "done" | "failed">; wbsDone?: number; wbsTotal?: number; spentUsd?: number; commitSha?: string; repoFullName?: string; buildExitCode?: number },
): Promise<boolean> {
  const current = await getBuildJobById(env, id);
  if (!current || !BUILD_JOB_ACTIVE.has(current.status)) return false;
  if (STAGE_ORDER[input.status] < STAGE_ORDER[current.status]) return false;
  const res = await env.DB.prepare(
    `UPDATE build_jobs
        SET status = ?, wbs_done = ?, wbs_total = ?, spent_usd = ?, commit_sha = COALESCE(?, commit_sha),
            repo_full_name = COALESCE(?, repo_full_name), build_exit_code = COALESCE(?, build_exit_code), updated_at = ?
      WHERE id = ? AND status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying')`,
  )
    .bind(
      input.status,
      Math.max(current.wbsDone, input.wbsDone ?? 0),
      input.wbsTotal ?? current.wbsTotal,
      Math.max(current.spentUsd, input.spentUsd ?? 0),
      input.commitSha ?? null,
      input.repoFullName ?? null,
      input.buildExitCode ?? null,
      new Date().toISOString(),
      id,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** 최종 성공. D-4: build_exit_code가 0이 아니면 done으로 못 간다 — 호출자가 걸러도 여기서 한 번 더 막는다. */
export async function markBuildJobDone(
  env: Env,
  id: string,
  input: { deployedUrl: string; commitSha: string | null; spentUsd: number; buildExitCode: number; wbsDone: number },
): Promise<{ ok: true } | { ok: false; reason: "not_active" | "build_not_green" }> {
  if (input.buildExitCode !== 0) return { ok: false, reason: "build_not_green" };
  const res = await env.DB.prepare(
    `UPDATE build_jobs
        SET status = 'done', deployed_url = ?, commit_sha = COALESCE(?, commit_sha), spent_usd = ?, build_exit_code = 0, wbs_done = ?, updated_at = ?
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

export async function appendBuildJobEvent(env: Env, jobId: string, stage: string, message: string, meta: Record<string, unknown> = {}): Promise<void> {
  await env.DB.prepare(`INSERT INTO build_job_events (id, job_id, at, stage, message, meta_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(randId("bje"), jobId, new Date().toISOString(), stage.slice(0, 40), message.slice(0, 500), JSON.stringify(meta).slice(0, 4000))
    .run();
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

/**
 * workspace/repair-job-db.ts — Stage 268
 *
 * D1 persistence for Simsa repair jobs: one row per "[고치기]" click on a
 * failed visual check. Mirrors visual-check-db.ts operationally (queued →
 * running → done|failed, updated_at as the staleness clock for the stuck
 * sweep). The repo/branch/PR fields are filled in by the container's
 * /internal/repair-done callback.
 */
import type { Env } from "../env.js";

export const REPAIR_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type RepairJobStatus = (typeof REPAIR_JOB_STATUSES)[number];

export type DbRepairJob = {
  id: string;
  projectId: string;
  userKey: string;
  visualCheckId: string;
  repoFullName: string;
  status: RepairJobStatus;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  envCause: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type RawRow = {
  id: string;
  project_id: string;
  user_key: string;
  visual_check_id: string;
  repo_full_name: string;
  status: RepairJobStatus;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  env_cause: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  `id, project_id, user_key, visual_check_id, repo_full_name, status,
   branch_name, pr_url, pr_number, env_cause, error, created_at, updated_at`;

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `wrj_${ts}${r}`;
}

function fromRow(row: RawRow): DbRepairJob {
  return {
    id: row.id,
    projectId: row.project_id,
    userKey: row.user_key,
    visualCheckId: row.visual_check_id,
    repoFullName: row.repo_full_name,
    status: row.status,
    branchName: row.branch_name ?? undefined,
    prUrl: row.pr_url ?? undefined,
    prNumber: row.pr_number ?? undefined,
    envCause: row.env_cause === 1,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertQueuedRepairJob(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    visualCheckId: string;
    repoFullName: string;
    branchName: string;
    envCause: boolean;
    now?: string;
  },
): Promise<DbRepairJob> {
  const id = randId();
  const now = input.now ?? new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_repair_jobs
       (id, project_id, user_key, visual_check_id, repo_full_name,
        status, branch_name, pr_url, pr_number, env_cause, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      input.projectId,
      input.userKey,
      input.visualCheckId,
      input.repoFullName,
      input.branchName,
      input.envCause ? 1 : 0,
      now,
      now,
    )
    .run();
  return {
    id,
    projectId: input.projectId,
    userKey: input.userKey,
    visualCheckId: input.visualCheckId,
    repoFullName: input.repoFullName,
    status: "queued",
    branchName: input.branchName,
    envCause: input.envCause,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getRepairJobById(env: Env, id: string): Promise<DbRepairJob | null> {
  const row = (await env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM workspace_repair_jobs WHERE id = ?`,
  )
    .bind(id)
    .first()) as RawRow | null;
  return row ? fromRow(row) : null;
}

/** One active (queued|running) repair per visual check — 409 guard. */
export async function findActiveRepairJobForRun(
  env: Env,
  visualCheckId: string,
): Promise<{ id: string; status: RepairJobStatus } | null> {
  const row = (await env.DB.prepare(
    `SELECT id, status FROM workspace_repair_jobs
      WHERE visual_check_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(visualCheckId)
    .first()) as { id: string; status: RepairJobStatus } | null;
  return row ?? null;
}

/** Latest repair job for a run (dashboard polling). */
export async function getLatestRepairJobForRun(
  env: Env,
  visualCheckId: string,
): Promise<DbRepairJob | null> {
  const row = (await env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM workspace_repair_jobs
      WHERE visual_check_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(visualCheckId)
    .first()) as RawRow | null;
  return row ? fromRow(row) : null;
}

/** queued → running (only from an in-flight state; done/failed are final). */
export async function markRepairJobRunning(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE workspace_repair_jobs
        SET status = 'running', updated_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Terminal success: repair branch + PR exist on the user's repo. */
export async function markRepairJobDone(
  env: Env,
  id: string,
  input: { prUrl?: string; prNumber?: number; branchName?: string; envCause?: boolean },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_repair_jobs
        SET status = 'done',
            pr_url = COALESCE(?, pr_url),
            pr_number = COALESCE(?, pr_number),
            branch_name = COALESCE(?, branch_name),
            env_cause = CASE WHEN ? = 1 THEN 1 ELSE env_cause END,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      input.prUrl ?? null,
      input.prNumber ?? null,
      input.branchName ?? null,
      input.envCause === true ? 1 : 0,
      new Date().toISOString(),
      id,
    )
    .run();
}

/** Terminal failure — stores a truncated error for the dashboard. */
export async function markRepairJobFailed(env: Env, id: string, error: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_repair_jobs
        SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(error.slice(0, 500), new Date().toISOString(), id)
    .run();
}

/** Repair jobs stuck in queued|running past the cutoff (stuck sweep). */
export async function listStuckRepairJobs(
  env: Env,
  cutoffIso: string,
  limit: number,
): Promise<Array<{ id: string; status: RepairJobStatus }>> {
  const rs = await env.DB.prepare(
    `SELECT id, status FROM workspace_repair_jobs
      WHERE status IN ('queued', 'running') AND updated_at < ?
      ORDER BY updated_at ASC
      LIMIT ?`,
  )
    .bind(cutoffIso, limit)
    .all<{ id: string; status: RepairJobStatus }>();
  return rs.results ?? [];
}

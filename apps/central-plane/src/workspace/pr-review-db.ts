/**
 * workspace/pr-review-db.ts
 *
 * D1 helpers for workspace_pr_review_runs.
 * Stores PR code-review executions triggered from the dashboard.
 */
import type { Env } from "../env.js";

export type ReviewRunStatus = "queued" | "running" | "passed" | "failed" | "inconclusive" | "error";

export type DbReviewRun = {
  id: string;
  projectId: string;
  userKey: string;
  repoFullName: string;
  prNumber: number;
  linkedPrId?: string;
  selectedItemIds: string[];
  status: ReviewRunStatus;
  resultJson?: string;
  errorMessage?: string;
  rerunOfReviewRunId?: string;
  /** R2 key of this run's training record, if one was captured (consent on). */
  trainingR2Key?: string;
  createdAt: string;
  updatedAt: string;
};

// ─── Shared column list ───────────────────────────────────────────────────────

const COLS = `id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
              selected_item_ids_json, status, result_json, error_message,
              rerun_of_review_run_id, training_r2_key, created_at, updated_at`;

type RawRow = {
  id: string;
  project_id: string;
  user_key: string;
  repo_full_name: string;
  pr_number: number;
  linked_pr_id: string | null;
  selected_item_ids_json: string;
  status: string;
  result_json: string | null;
  error_message: string | null;
  rerun_of_review_run_id: string | null;
  training_r2_key: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: RawRow): DbReviewRun {
  return {
    id: row.id,
    projectId: row.project_id,
    userKey: row.user_key,
    repoFullName: row.repo_full_name,
    prNumber: row.pr_number,
    linkedPrId: row.linked_pr_id ?? undefined,
    selectedItemIds: (() => { try { return JSON.parse(row.selected_item_ids_json) as string[]; } catch { return []; } })(),
    status: row.status as ReviewRunStatus,
    resultJson: row.result_json ?? undefined,
    errorMessage: row.error_message ?? undefined,
    rerunOfReviewRunId: row.rerun_of_review_run_id ?? undefined,
    trainingR2Key: row.training_r2_key ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Remember where this run's training record landed in R2 (for the outcome poll). */
export async function setReviewRunTrainingKey(env: Env, runId: string, key: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_pr_review_runs SET training_r2_key = ? WHERE id = ?`,
  ).bind(key, runId).run();
}

// ─── randId ───────────────────────────────────────────────────────────────────

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `wprr_${ts}${r}`;
}

// ─── insertReviewRun ──────────────────────────────────────────────────────────

export async function insertReviewRun(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    repoFullName: string;
    prNumber: number;
    linkedPrId?: string;
    selectedItemIds: string[];
    status: ReviewRunStatus;
    rerunOfReviewRunId?: string;
  },
): Promise<DbReviewRun> {
  const now = new Date().toISOString();
  const id = randId();

  await env.DB.prepare(
    `INSERT INTO workspace_pr_review_runs
       (id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
        selected_item_ids_json, status, rerun_of_review_run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, input.projectId, input.userKey, input.repoFullName, input.prNumber,
      input.linkedPrId ?? null, JSON.stringify(input.selectedItemIds),
      input.status, input.rerunOfReviewRunId ?? null, now, now,
    )
    .run();

  return {
    id,
    projectId: input.projectId,
    userKey: input.userKey,
    repoFullName: input.repoFullName,
    prNumber: input.prNumber,
    linkedPrId: input.linkedPrId,
    selectedItemIds: input.selectedItemIds,
    status: input.status,
    rerunOfReviewRunId: input.rerunOfReviewRunId,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── updateReviewRun ──────────────────────────────────────────────────────────

export async function updateReviewRun(
  env: Env,
  id: string,
  update: {
    status: ReviewRunStatus;
    resultJson?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE workspace_pr_review_runs
     SET status = ?, result_json = ?, error_message = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(update.status, update.resultJson ?? null, update.errorMessage ?? null, now, id)
    .run();
}

// ─── getReviewRunById ─────────────────────────────────────────────────────────

export async function getReviewRunById(
  env: Env,
  runId: string,
): Promise<DbReviewRun | null> {
  const row = await env.DB.prepare(
    `SELECT ${COLS} FROM workspace_pr_review_runs WHERE id = ?`,
  )
    .bind(runId)
    .first<RawRow>();

  return row ? mapRow(row) : null;
}

// ─── getLatestReviewRun ───────────────────────────────────────────────────────

export async function getLatestReviewRun(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
): Promise<DbReviewRun | null> {
  const row = await env.DB.prepare(
    `SELECT ${COLS} FROM workspace_pr_review_runs
     WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(projectId, repoFullName, prNumber)
    .first<RawRow>();

  return row ? mapRow(row) : null;
}

// ─── getLatestTwoPrReviewRuns ─────────────────────────────────────────────────

export async function getLatestTwoPrReviewRuns(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
): Promise<[DbReviewRun | null, DbReviewRun | null]> {
  const rows = await env.DB.prepare(
    `SELECT ${COLS} FROM workspace_pr_review_runs
     WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
       AND status NOT IN ('running', 'queued', 'error')
     ORDER BY updated_at DESC LIMIT 2`,
  )
    .bind(projectId, repoFullName, prNumber)
    .all<RawRow>();

  const list = rows.results ?? [];
  const latest = list[0] ? mapRow(list[0]) : null;
  const previous = list[1] ? mapRow(list[1]) : null;
  return [latest, previous];
}

// ─── listPRReviewRuns ─────────────────────────────────────────────────────────

export async function listPRReviewRuns(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
  opts: { limit?: number } = {},
): Promise<DbReviewRun[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const rows = await env.DB.prepare(
    `SELECT ${COLS} FROM workspace_pr_review_runs
     WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(projectId, repoFullName, prNumber, limit)
    .all<RawRow>();

  return (rows.results ?? []).map(mapRow);
}

// ─── listProjectReviewRuns ────────────────────────────────────────────────────

export async function listProjectReviewRuns(
  env: Env,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<DbReviewRun[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = await env.DB.prepare(
    `SELECT ${COLS} FROM workspace_pr_review_runs
     WHERE project_id = ?
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(projectId, limit)
    .all<RawRow>();

  return (rows.results ?? []).map(mapRow);
}

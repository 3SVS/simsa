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
  createdAt: string;
  updatedAt: string;
};

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `wprr_${ts}${r}`;
}

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
  },
): Promise<DbReviewRun> {
  const now = new Date().toISOString();
  const id = randId();

  await env.DB.prepare(
    `INSERT INTO workspace_pr_review_runs
       (id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
        selected_item_ids_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, input.projectId, input.userKey, input.repoFullName, input.prNumber,
      input.linkedPrId ?? null, JSON.stringify(input.selectedItemIds),
      input.status, now, now,
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
    createdAt: now,
    updatedAt: now,
  };
}

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

export async function getLatestTwoPrReviewRuns(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
): Promise<[DbReviewRun | null, DbReviewRun | null]> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
            selected_item_ids_json, status, result_json, error_message, created_at, updated_at
     FROM workspace_pr_review_runs
     WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
       AND status NOT IN ('running', 'queued', 'error')
     ORDER BY updated_at DESC LIMIT 2`,
  )
    .bind(projectId, repoFullName, prNumber)
    .all<{
      id: string; project_id: string; user_key: string; repo_full_name: string;
      pr_number: number; linked_pr_id: string | null;
      selected_item_ids_json: string; status: string;
      result_json: string | null; error_message: string | null;
      created_at: string; updated_at: string;
    }>();

  function mapRow(row: typeof rows.results[number]): DbReviewRun {
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const list = rows.results ?? [];
  const latest = list[0] ? mapRow(list[0]) : null;
  const previous = list[1] ? mapRow(list[1]) : null;
  return [latest, previous];
}

export async function getReviewRunById(
  env: Env,
  runId: string,
): Promise<DbReviewRun | null> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
            selected_item_ids_json, status, result_json, error_message, created_at, updated_at
     FROM workspace_pr_review_runs
     WHERE id = ?`,
  )
    .bind(runId)
    .first<{
      id: string; project_id: string; user_key: string; repo_full_name: string;
      pr_number: number; linked_pr_id: string | null;
      selected_item_ids_json: string; status: string;
      result_json: string | null; error_message: string | null;
      created_at: string; updated_at: string;
    }>();

  if (!row) return null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPRReviewRuns(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
  opts: { limit?: number } = {},
): Promise<DbReviewRun[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const rows = await env.DB.prepare(
    `SELECT id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
            selected_item_ids_json, status, result_json, error_message, created_at, updated_at
     FROM workspace_pr_review_runs
     WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(projectId, repoFullName, prNumber, limit)
    .all<{
      id: string; project_id: string; user_key: string; repo_full_name: string;
      pr_number: number; linked_pr_id: string | null;
      selected_item_ids_json: string; status: string;
      result_json: string | null; error_message: string | null;
      created_at: string; updated_at: string;
    }>();

  return (rows.results ?? []).map((row) => ({
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listProjectReviewRuns(
  env: Env,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<DbReviewRun[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = await env.DB.prepare(
    `SELECT id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
            selected_item_ids_json, status, result_json, error_message, created_at, updated_at
     FROM workspace_pr_review_runs
     WHERE project_id = ?
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(projectId, limit)
    .all<{
      id: string; project_id: string; user_key: string; repo_full_name: string;
      pr_number: number; linked_pr_id: string | null;
      selected_item_ids_json: string; status: string;
      result_json: string | null; error_message: string | null;
      created_at: string; updated_at: string;
    }>();

  return (rows.results ?? []).map((row) => ({
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getLatestReviewRun(
  env: Env,
  projectId: string,
  repoFullName: string,
  prNumber: number,
): Promise<DbReviewRun | null> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, user_key, repo_full_name, pr_number, linked_pr_id,
            selected_item_ids_json, status, result_json, error_message, created_at, updated_at
     FROM workspace_pr_review_runs
     WHERE project_id = ? AND repo_full_name = ? AND pr_number = ?
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(projectId, repoFullName, prNumber)
    .first<{
      id: string; project_id: string; user_key: string; repo_full_name: string;
      pr_number: number; linked_pr_id: string | null;
      selected_item_ids_json: string; status: string;
      result_json: string | null; error_message: string | null;
      created_at: string; updated_at: string;
    }>();

  if (!row) return null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

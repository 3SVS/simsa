/**
 * workspace/visual-check-db.ts — Stage 261
 *
 * D1 persistence for Simsa visual completion-check runs. The full non-dev
 * report snapshot lives in report_json; screenshots/video live in R2 and their
 * keys are tracked in evidence_keys_json (appended as each file is uploaded).
 */
import type { Env } from "../env.js";

export const VISUAL_CHECK_STATUSES = ["uploaded", "queued", "running", "done", "failed"] as const;
export type VisualCheckStatus = (typeof VISUAL_CHECK_STATUSES)[number];

export const VISUAL_CHECK_EXECUTORS = ["local", "container"] as const;
export type VisualCheckExecutor = (typeof VISUAL_CHECK_EXECUTORS)[number];

export type DbVisualCheck = {
  id: string;
  projectId: string;
  userKey: string;
  targetUrl: string;
  intent: string;
  decision: string;
  works: boolean | null;
  status: VisualCheckStatus;
  executor: VisualCheckExecutor;
  reportJson: string;
  agentPrompt?: string;
  evidenceKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type VisualCheckListItem = {
  id: string;
  targetUrl: string;
  decision: string;
  works: boolean | null;
  status: VisualCheckStatus;
  executor: VisualCheckExecutor;
  evidenceCount: number;
  createdAt: string;
};

type RawRow = {
  id: string;
  project_id: string;
  user_key: string;
  target_url: string;
  intent: string;
  decision: string;
  works: number | null;
  status: VisualCheckStatus;
  executor: VisualCheckExecutor;
  report_json: string;
  agent_prompt: string | null;
  evidence_keys_json: string;
  created_at: string;
  updated_at: string;
};

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `wvc_${ts}${r}`;
}

function parseKeys(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function worksFromDb(n: number | null): boolean | null {
  if (n === null) return null;
  return n === 1;
}

function fromRow(row: RawRow): DbVisualCheck {
  return {
    id: row.id,
    projectId: row.project_id,
    userKey: row.user_key,
    targetUrl: row.target_url,
    intent: row.intent,
    decision: row.decision,
    works: worksFromDb(row.works),
    status: row.status,
    executor: row.executor,
    reportJson: row.report_json,
    agentPrompt: row.agent_prompt ?? undefined,
    evidenceKeys: parseKeys(row.evidence_keys_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertVisualCheck(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    targetUrl: string;
    intent: string;
    decision: string;
    works: boolean | null;
    executor: VisualCheckExecutor;
    reportJson: string;
    agentPrompt?: string;
    now?: string;
  },
): Promise<DbVisualCheck> {
  const id = randId();
  const now = input.now ?? new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_visual_checks
       (id, project_id, user_key, target_url, intent, decision, works,
        status, executor, report_json, agent_prompt, evidence_keys_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, '[]', ?, ?)`,
  )
    .bind(
      id,
      input.projectId,
      input.userKey,
      input.targetUrl,
      input.intent,
      input.decision,
      input.works === null ? null : input.works ? 1 : 0,
      input.executor,
      input.reportJson,
      input.agentPrompt ?? null,
      now,
      now,
    )
    .run();
  return {
    id,
    projectId: input.projectId,
    userKey: input.userKey,
    targetUrl: input.targetUrl,
    intent: input.intent,
    decision: input.decision,
    works: input.works,
    status: "uploaded",
    executor: input.executor,
    reportJson: input.reportJson,
    agentPrompt: input.agentPrompt,
    evidenceKeys: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function listVisualChecks(env: Env, projectId: string): Promise<VisualCheckListItem[]> {
  const res = await env.DB.prepare(
    `SELECT id, project_id, user_key, target_url, intent, decision, works,
            status, executor, report_json, agent_prompt, evidence_keys_json, created_at, updated_at
       FROM workspace_visual_checks
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
  )
    .bind(projectId)
    .all();
  return ((res?.results ?? []) as RawRow[]).map((row) => ({
    id: row.id,
    targetUrl: row.target_url,
    decision: row.decision,
    works: worksFromDb(row.works),
    status: row.status,
    executor: row.executor,
    evidenceCount: parseKeys(row.evidence_keys_json).length,
    createdAt: row.created_at,
  }));
}

export async function getVisualCheckById(env: Env, id: string): Promise<DbVisualCheck | null> {
  const row = (await env.DB.prepare(
    `SELECT id, project_id, user_key, target_url, intent, decision, works,
            status, executor, report_json, agent_prompt, evidence_keys_json, created_at, updated_at
       FROM workspace_visual_checks
      WHERE id = ?`,
  )
    .bind(id)
    .first()) as RawRow | null;
  return row ? fromRow(row) : null;
}

/**
 * Stage 263 — insert a QUEUED cloud-runner row. The container fills the real
 * report/decision later via /internal/visual-check-done; until then the row
 * carries a placeholder report and a 'Not Judged' decision so list/detail
 * render consistently while the run is in flight.
 */
export async function insertQueuedVisualCheck(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    targetUrl: string;
    intent: string;
    now?: string;
  },
): Promise<DbVisualCheck> {
  const id = randId();
  const now = input.now ?? new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_visual_checks
       (id, project_id, user_key, target_url, intent, decision, works,
        status, executor, report_json, agent_prompt, evidence_keys_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Not Judged', NULL, 'queued', 'container', '{}', NULL, '[]', ?, ?)`,
  )
    .bind(id, input.projectId, input.userKey, input.targetUrl, input.intent, now, now)
    .run();
  return {
    id,
    projectId: input.projectId,
    userKey: input.userKey,
    targetUrl: input.targetUrl,
    intent: input.intent,
    decision: "Not Judged",
    works: null,
    status: "queued",
    executor: "container",
    reportJson: "{}",
    evidenceKeys: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Stage 263 — a project's currently active (queued|running) cloud run, if any. */
export async function findActiveVisualCheckForProject(
  env: Env,
  projectId: string,
): Promise<{ id: string; status: VisualCheckStatus } | null> {
  const row = (await env.DB.prepare(
    `SELECT id, status FROM workspace_visual_checks
      WHERE project_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(projectId)
    .first()) as { id: string; status: VisualCheckStatus } | null;
  return row ?? null;
}

/** Stage 263 — queued → running (only from an in-flight state; done/failed are final). */
export async function markVisualCheckRunning(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE workspace_visual_checks
        SET status = 'running', updated_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Stage 263 — terminal success: store the container's report + verdict. */
export async function markVisualCheckDone(
  env: Env,
  id: string,
  input: { decision: string; works: boolean | null; reportJson: string; agentPrompt?: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_visual_checks
        SET status = 'done', decision = ?, works = ?, report_json = ?, agent_prompt = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      input.decision,
      input.works === null ? null : input.works ? 1 : 0,
      input.reportJson,
      input.agentPrompt ?? null,
      new Date().toISOString(),
      id,
    )
    .run();
}

/**
 * Stage 263 — terminal failure. Keeps works NULL (we could not verify) and
 * snapshots the error into report_json only when the run still carries the
 * queued placeholder, so a partial report the container managed to send is
 * never clobbered.
 */
export async function markVisualCheckFailed(env: Env, id: string, error: string): Promise<void> {
  const truncated = error.slice(0, 500);
  await env.DB.prepare(
    `UPDATE workspace_visual_checks
        SET status = 'failed',
            decision = 'Not Verified',
            report_json = CASE WHEN report_json = '{}' THEN ? ELSE report_json END,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(JSON.stringify({ error: truncated }), new Date().toISOString(), id)
    .run();
}

/**
 * Stage 263 — cloud runs stuck in queued|running past the cutoff (container
 * killed mid-run / dispatch lost). Mirrors the saas jobs stuck sweep.
 */
export async function listStuckVisualChecks(
  env: Env,
  cutoffIso: string,
  limit: number,
): Promise<Array<{ id: string; status: VisualCheckStatus }>> {
  const rs = await env.DB.prepare(
    `SELECT id, status FROM workspace_visual_checks
      WHERE status IN ('queued', 'running') AND updated_at < ?
      ORDER BY updated_at ASC
      LIMIT ?`,
  )
    .bind(cutoffIso, limit)
    .all<{ id: string; status: VisualCheckStatus }>();
  return rs.results ?? [];
}

/** Append an uploaded evidence key to the run's manifest (read-modify-write). */
export async function appendVisualCheckEvidenceKey(env: Env, id: string, key: string): Promise<string[]> {
  const row = await getVisualCheckById(env, id);
  if (!row) throw new Error("visual_check_not_found");
  const keys = row.evidenceKeys.includes(key) ? row.evidenceKeys : [...row.evidenceKeys, key];
  await env.DB.prepare(
    `UPDATE workspace_visual_checks SET evidence_keys_json = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(JSON.stringify(keys), new Date().toISOString(), id)
    .run();
  return keys;
}

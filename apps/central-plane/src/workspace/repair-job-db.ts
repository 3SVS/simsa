/**
 * workspace/repair-job-db.ts — Stage 268
 *
 * D1 persistence for Simsa repair jobs: one row per "[고치기]" click on a
 * failed visual check. Mirrors visual-check-db.ts operationally (queued →
 * running → done|failed, updated_at as the staleness clock for the stuck
 * sweep). The repo/branch/PR fields are filled in by the container's
 * /internal/repair-done callback.
 *
 * Train W · W-3 — `buildVerified` has no column of its own (no migration: the
 * next numbers are reserved for L-3/K-1). It rides the DONE row's `error`
 * column as a machine marker, exactly like the brief_only `modeReason`
 * diagnostic already does (2026-07-20 precedent: the dashboard renders `error`
 * only on FAILED rows). The two never collide: modeReason is stored only for
 * brief_only, the build marker only for auto_fix. fromRow turns the marker back
 * into `buildVerified` and clears `error`, so the API never shows it as an
 * error message.
 */
import type { Env } from "../env.js";

export const REPAIR_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type RepairJobStatus = (typeof REPAIR_JOB_STATUSES)[number];

/** Stage 270 — how the container concluded a done repair. */
export const REPAIR_JOB_MODES = ["auto_fix", "brief_only"] as const;
export type RepairJobMode = (typeof REPAIR_JOB_MODES)[number];

/** Train W · W-3 — machine markers stored in `error` on DONE auto_fix rows. */
export const BUILD_CHECK_VERIFIED_MARKER = "build_check:verified";
export const BUILD_CHECK_UNVERIFIED_MARKER = "build_check:unverified";

/**
 * 비용 권고 ② (2026-09-30) — the brief_only `modeReason` the repair container sends
 * when it stopped calling the AI because the job reached its USD budget
 * ("budget_exceeded(cap=$2.00)…", container/coerce-result.mjs REPAIR_BUDGET_STOP —
 * lock-stepped by test). No column of its own: like every brief_only reason it
 * rides the DONE row's `error` slot, and fromRow reads it back as `stoppedByBudget`.
 */
export const REPAIR_BUDGET_STOP_REASON = "budget_exceeded";

/** true only for the budget stop's own marker at the start (not "budget_exceededish"). */
export function isBudgetStopReason(raw: string | null | undefined): boolean {
  return typeof raw === "string" && new RegExp(`^${REPAIR_BUDGET_STOP_REASON}(?![A-Za-z0-9_])`).test(raw);
}

/** Marker → buildVerified; anything else (null, a diagnostic, garbage) → null. */
export function parseBuildCheckMarker(raw: string | null | undefined): boolean | null {
  if (raw === BUILD_CHECK_VERIFIED_MARKER) return true;
  if (raw === BUILD_CHECK_UNVERIFIED_MARKER) return false;
  return null;
}

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
  /** Stage 270 — 'auto_fix' (worker applied code) | 'brief_only' (Stage 268 fallback). Unset on legacy/in-flight rows. */
  mode?: RepairJobMode;
  /** Stage 270 — number of code files the worker actually changed (auto_fix). */
  changedFiles?: number;
  /**
   * Train W · W-3 — did the container's post-apply check (node --check on
   * .js/.mjs/.cjs) cover every changed file? Only DONE auto_fix rows carry a
   * boolean; brief_only / legacy / in-flight / undecidable → null.
   */
  buildVerified: boolean | null;
  /**
   * 비용 권고 ② — a DONE brief_only row whose fallback reason is the job budget stop
   * (REPAIR_BUDGET_STOP_REASON). false for everything else, never a guess.
   */
  stoppedByBudget: boolean;
  error?: string;
  /** 0069 (C4a): ISO-3166 국가 코드(수리 요청 시점). null = 미기록. */
  region: string | null;
  /** 0069 (C2a): verify-sweep이 이 수리 뒤에 디스패치한 재검수 런 id. null = 아직/없음. */
  verifyCheckId: string | null;
  /** 0069 (C2a): 재검수 결과 — true(works) · false(broken) · null(판정 불가/미완). */
  resolved: boolean | null;
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
  mode: string | null;
  changed_files: number | null;
  error: string | null;
  region: string | null;
  verify_check_id: string | null;
  resolved: number | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  `id, project_id, user_key, visual_check_id, repo_full_name, status,
   branch_name, pr_url, pr_number, env_cause, mode, changed_files, error,
   region, verify_check_id, resolved, created_at, updated_at`;

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `wrj_${ts}${r}`;
}

function fromRow(row: RawRow): DbRepairJob {
  // W-3: only a DONE auto_fix row can carry the build marker (in `error`).
  const buildVerified =
    row.status === "done" && row.mode === "auto_fix" ? parseBuildCheckMarker(row.error) : null;
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
    mode: row.mode === "auto_fix" || row.mode === "brief_only" ? row.mode : undefined,
    changedFiles: typeof row.changed_files === "number" ? row.changed_files : undefined,
    buildVerified,
    stoppedByBudget: row.status === "done" && row.mode === "brief_only" && isBudgetStopReason(row.error),
    // The build marker is a flag, not an error message — never surfaced as one.
    error: buildVerified !== null ? undefined : row.error ?? undefined,
    region: typeof row.region === "string" && row.region ? row.region : null,
    verifyCheckId: typeof row.verify_check_id === "string" && row.verify_check_id ? row.verify_check_id : null,
    resolved: row.resolved === 1 ? true : row.resolved === 0 ? false : null,
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
    /** 0069: request.cf.country at repair time. */
    region?: string | null;
    now?: string;
  },
): Promise<DbRepairJob> {
  const id = randId();
  const now = input.now ?? new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_repair_jobs
       (id, project_id, user_key, visual_check_id, repo_full_name,
        status, branch_name, pr_url, pr_number, env_cause, error, region, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, ?, NULL, ?, ?, ?)`,
  )
    .bind(
      id,
      input.projectId,
      input.userKey,
      input.visualCheckId,
      input.repoFullName,
      input.branchName,
      input.envCause ? 1 : 0,
      input.region ?? null,
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
    buildVerified: null,
    stoppedByBudget: false,
    region: input.region ?? null,
    verifyCheckId: null,
    resolved: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * C2a (0069) — link the repair to the re-inspection run verify-sweep dispatched
 * after its PR merged. Leaves updated_at alone (stuck-sweep clock; the job is
 * already terminal here).
 */
export async function setRepairJobVerifyCheck(env: Env, id: string, verifyCheckId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE workspace_repair_jobs SET verify_check_id = ? WHERE id = ?`,
  )
    .bind(verifyCheckId, id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * C2a (0069) — the re-inspection finished: works===true → resolved=1,
 * works===false → 0, null (not verified) → leave NULL (never claim). Returns the
 * number of repair jobs that pointed at this verify run (0 when none — e.g. a
 * C2b builder-fix recheck has no repair job).
 */
export async function resolveRepairJobsByVerifyCheck(
  env: Env,
  verifyCheckId: string,
  works: boolean | null,
): Promise<number> {
  if (works === null) return 0;
  const res = await env.DB.prepare(
    `UPDATE workspace_repair_jobs SET resolved = ? WHERE verify_check_id = ?`,
  )
    .bind(works ? 1 : 0, verifyCheckId)
    .run();
  return res.meta?.changes ?? 0;
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

/**
 * Train W (PR #561 review P2) — the in-flight repair of a run that was INSERTED
 * first (rowid = insertion order). Same role as firstActiveVisualCheckIdForProject:
 * after its own insert a request keeps going only if its row is this one, so two
 * containers never force-push the same fix/simsa-<runId> branch at once.
 */
export async function firstActiveRepairJobIdForRun(
  env: Env,
  visualCheckId: string,
): Promise<string | null> {
  const row = (await env.DB.prepare(
    `SELECT id FROM workspace_repair_jobs
      WHERE visual_check_id = ? AND status IN ('queued', 'running')
      ORDER BY rowid ASC
      LIMIT 1`,
  )
    .bind(visualCheckId)
    .first()) as { id?: unknown } | null;
  return row && typeof row.id === "string" ? row.id : null;
}

/** Remove a repair job this request just inserted and never dispatched (lost a concurrent start). */
export async function discardQueuedRepairJob(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM workspace_repair_jobs WHERE id = ? AND status = 'queued'`).bind(id).run();
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
  input: {
    prUrl?: string;
    prNumber?: number;
    branchName?: string;
    envCause?: boolean;
    mode?: RepairJobMode;
    changedFiles?: number;
    /**
     * auto_fix 정직성 (2026-07-20): WHY the container fell back to brief_only
     * (e.g. "worker_returned_no_rewrites; oversize_skipped: index.html(389KB)").
     * Stored in the existing `error` column on DONE rows — the dashboard only
     * renders `error` on FAILED rows, so this is API-level diagnostics without
     * a migration. Container stdout is unreachable (no tail), so this is the
     * only place the fallback reason survives.
     */
    modeReason?: string;
    /**
     * Train W · W-3 — auto_fix only: whether node --check covered every
     * changed file. Stored as a marker in the same `error` slot (see header);
     * modeReason wins if both were ever passed (they are mutually exclusive by
     * mode at the only call site, /internal/repair-done).
     */
    buildVerified?: boolean;
  },
): Promise<void> {
  const diagnostic =
    typeof input.modeReason === "string" && input.modeReason
      ? input.modeReason.slice(0, 300)
      : input.buildVerified === true
        ? BUILD_CHECK_VERIFIED_MARKER
        : input.buildVerified === false
          ? BUILD_CHECK_UNVERIFIED_MARKER
          : null;
  await env.DB.prepare(
    `UPDATE workspace_repair_jobs
        SET status = 'done',
            pr_url = COALESCE(?, pr_url),
            pr_number = COALESCE(?, pr_number),
            branch_name = COALESCE(?, branch_name),
            env_cause = CASE WHEN ? = 1 THEN 1 ELSE env_cause END,
            mode = COALESCE(?, mode),
            changed_files = COALESCE(?, changed_files),
            error = COALESCE(?, error),
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      input.prUrl ?? null,
      input.prNumber ?? null,
      input.branchName ?? null,
      input.envCause === true ? 1 : 0,
      input.mode ?? null,
      typeof input.changedFiles === "number" && Number.isInteger(input.changedFiles) && input.changedFiles >= 0
        ? input.changedFiles
        : null,
      diagnostic,
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

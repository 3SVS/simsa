/**
 * Sweep `jobs` rows that have been stuck in `accepted` for too long.
 *
 * A job is considered stuck if it's been in `accepted` for >30 minutes
 * with no callback from the container. This usually means the container
 * was killed mid-run by a deploy rollout, OOM, or wall-clock timeout —
 * cases the catch block in server.mjs can't handle.
 *
 * For each stuck row:
 *   1. Mark it status=`failed` with an error_message
 *   2. Post a PR comment so the user knows to retry
 *
 * Runs every 5 minutes via the cron trigger in wrangler.toml.
 */
import type { Env } from "./env.js";
import { findInstallationByRepoSlug } from "./db/saas.js";
import { postPrComment } from "./gh-app.js";
import { listStuckVisualChecks, markVisualCheckFailed } from "./workspace/visual-check-db.js";
import { listStuckRepairJobs, markRepairJobFailed } from "./workspace/repair-job-db.js";

const STUCK_AFTER_MS = 30 * 60 * 1000; // 30 minutes
const SWEEP_LIMIT = 50; // safety cap; never touch more than 50 rows in a single tick

export async function cleanupStuckJobs(
  env: Env,
): Promise<{ swept: number; commented: number; errors: number }> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  // Pull stuck rows. Note: we read createdAt as the staleness clock —
  // there is no `updated_at` on jobs, so a long-running job in
  // `accepted` for the full window is treated the same as one that
  // never got a callback. Acceptable: 30 min already exceeds the
  // pipeline's hard 5-min budget by 6x.
  const rs = await env.DB.prepare(
    `SELECT id, repo_slug, pr_number FROM jobs
       WHERE status = 'accepted' AND created_at < ?
       ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(cutoff, SWEEP_LIMIT)
    .all<{ id: string; repo_slug: string; pr_number: number }>();
  const rows = rs.results ?? [];
  if (rows.length === 0) {
    return { swept: 0, commented: 0, errors: 0 };
  }
  let commented = 0;
  let errors = 0;
  const reason = "container did not call back within 30 minutes — likely killed by a deploy rollout or LLM provider timeout";
  for (const r of rows) {
    try {
      await env.DB.prepare(
        `UPDATE jobs
            SET status = 'failed',
                error_message = ?,
                completed_at = ?
          WHERE id = ? AND status = 'accepted'`,
      )
        .bind(reason, new Date().toISOString(), r.id)
        .run();
      const inst = await findInstallationByRepoSlug(env, r.repo_slug);
      if (inst) {
        const ok = await postPrComment(
          env,
          inst.installationId,
          r.repo_slug,
          r.pr_number,
          [
            `❌ **Conclave AI review timed out.**`,
            ``,
            `The sandbox didn't return a verdict within 30 minutes — usually a container got killed by a deploy rollout or an LLM provider hung. Push again to retry; this should be quick on the second attempt.`,
            ``,
            `Job: \`${r.id}\``,
          ].join("\n"),
        ).catch(() => null);
        if (ok) commented += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`[stuck-cleanup] failed on ${r.id}:`, err);
    }
  }
  return { swept: rows.length, commented, errors };
}

/**
 * Stage 263 — sweep Simsa visual-check runs stuck in queued|running >30 min.
 *
 * Mirrors cleanupStuckJobs: the SimsaInspector container was killed mid-run
 * (deploy rollout, OOM, wall-clock timeout) or the dispatch was lost, so no
 * /internal/visual-check-done callback will ever arrive. Uses updated_at as
 * the staleness clock (the row is touched on queue + on the running ack).
 * Runs on the same `*\/5 * * * *` cron tick as the saas jobs sweep.
 */
export async function cleanupStuckVisualChecks(
  env: Env,
): Promise<{ swept: number; errors: number }> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  let rows: Array<{ id: string; status: string }>;
  try {
    rows = await listStuckVisualChecks(env, cutoff, SWEEP_LIMIT);
  } catch (err) {
    // Table may not exist yet on a fresh D1 (migration 0050 unapplied) —
    // don't let the visual sweep break the jobs sweep sharing this cron.
    console.error("[stuck-cleanup] visual-check query failed:", err);
    return { swept: 0, errors: 1 };
  }
  let errors = 0;
  const reason =
    "inspector container did not report a result within 30 minutes — likely killed by a deploy rollout or a hung page load. Run the inspection again.";
  for (const r of rows) {
    try {
      await markVisualCheckFailed(env, r.id, reason);
    } catch (err) {
      errors += 1;
      console.error(`[stuck-cleanup] visual-check ${r.id} failed:`, err);
    }
  }
  return { swept: rows.length, errors };
}

/**
 * Stage 268 — sweep Simsa repair jobs stuck in queued|running >30 min.
 *
 * Same failure modes as the other sweeps: the ConclaveSandbox container was
 * killed mid-repair (deploy rollout, OOM, wall-clock timeout) or the dispatch
 * was lost, so no /internal/repair-done callback will ever arrive. Uses
 * updated_at as the staleness clock (touched on queue + on the running ack).
 * Runs on the same `*\/5 * * * *` cron tick.
 */
export async function cleanupStuckRepairJobs(
  env: Env,
): Promise<{ swept: number; errors: number }> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  let rows: Array<{ id: string; status: string }>;
  try {
    rows = await listStuckRepairJobs(env, cutoff, SWEEP_LIMIT);
  } catch (err) {
    // Table may not exist yet on a fresh D1 (migration 0051 unapplied) —
    // don't let the repair sweep break the other sweeps sharing this cron.
    console.error("[stuck-cleanup] repair-job query failed:", err);
    return { swept: 0, errors: 1 };
  }
  let errors = 0;
  const reason =
    "repair container did not report a result within 30 minutes — likely killed by a deploy rollout. Start the repair again.";
  for (const r of rows) {
    try {
      await markRepairJobFailed(env, r.id, reason);
    } catch (err) {
      errors += 1;
      console.error(`[stuck-cleanup] repair-job ${r.id} failed:`, err);
    }
  }
  return { swept: rows.length, errors };
}

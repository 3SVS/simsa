/**
 * rate-limit-retention.ts — purge request-limit rows 48 hours after their window
 * started (workspace_rate_limit · demo_rate_limit).
 *
 * Why: the limiters only ever read the CURRENT window (this UTC hour / this UTC
 * day), yet nothing deleted the rows, so every IP-keyed counter since 0011/0026
 * stayed forever. The privacy policy now says these records are deleted after
 * 48 hours (apps/dashboard src/lib/privacy-ops-info.mjs — a test pins the
 * number to RATE_LIMIT_RETENTION_HOURS below).
 *
 * Rule: a row goes once its window STARTED at least 48h ago. Every write lands
 * inside its window, so no record outlives 48h + the cron interval (6h), and an
 * active window (≤ 24h old) is never touched.
 *
 * The window column mixes two formats (rate-limit.ts):
 *   hour window  "YYYY-MM-DDTHH"  (13 chars) — hourly limiters
 *   day window   "YYYY-MM-DD"     (10 chars) — daily caps (and the whole demo table)
 * Both are zero-padded ISO prefixes, so within ONE format string order is time
 * order. Across formats a single `< cutoffHour` would also happen to work (a day
 * key sorts just before its own "T00" hour), but we compare each format with
 * its own cutoff so the rule never rests on that coincidence — and a value in
 * any other format is left alone rather than guessed at.
 *
 * Deletion is batched (rowid subquery + LIMIT) so the first run, which also
 * clears every legacy row (including the old unkeyed IP hashes), stays small
 * per statement. Fail-open: an error is reported in the result, never thrown —
 * a cleanup problem must not break the cron tick that carries it.
 */
import type { Env } from "./env.js";

/** Rows are deleted once their window started this many hours ago. Policy text says "48시간". */
export const RATE_LIMIT_RETENTION_HOURS = 48;

const PURGE_BATCH = 5_000;
/** Per table per run: 20 × 5,000 = 100k rows; anything left goes next tick (`more: true`). */
const PURGE_MAX_BATCHES = 20;

/** Binds: (cutoffHourKey, cutoffDayKey, batchLimit). */
export const WORKSPACE_RATE_LIMIT_PURGE_SQL = `DELETE FROM workspace_rate_limit
 WHERE rowid IN (
   SELECT rowid FROM workspace_rate_limit
    WHERE (length(hour_utc) = 13 AND hour_utc <= ?)
       OR (length(hour_utc) = 10 AND hour_utc <= ?)
    LIMIT ?)`;

/** Binds: (cutoffDayKey, batchLimit). */
export const DEMO_RATE_LIMIT_PURGE_SQL = `DELETE FROM demo_rate_limit
 WHERE rowid IN (
   SELECT rowid FROM demo_rate_limit
    WHERE length(day_utc) = 10 AND day_utc <= ?
    LIMIT ?)`;

export type TablePurgeResult = {
  deleted: number;
  batches: number;
  /** true when the per-run batch ceiling was hit — the next tick continues. */
  more: boolean;
  error?: string;
};

export type RateLimitPurgeResult = {
  /** ISO instant: windows that started at or before this are gone. */
  cutoff: string;
  workspace: TablePurgeResult;
  demo: TablePurgeResult;
};

/**
 * The window keys at the cutoff. A window whose key is ≤ these started at or
 * before `now - 48h`: an hour key "H" starts at H:00 ≤ cutoff ⇔ H ≤ hour(cutoff);
 * a day key "D" starts at D 00:00 ≤ cutoff ⇔ D ≤ day(cutoff).
 */
export function rateLimitPurgeCutoff(now: Date): { cutoffIso: string; hourKey: string; dayKey: string } {
  const cutoffIso = new Date(now.getTime() - RATE_LIMIT_RETENTION_HOURS * 3_600_000).toISOString();
  return { cutoffIso, hourKey: cutoffIso.slice(0, 13), dayKey: cutoffIso.slice(0, 10) };
}

async function purgeTable(
  db: D1Database,
  sql: string,
  binds: readonly (string | number)[],
): Promise<TablePurgeResult> {
  let deleted = 0;
  let batches = 0;
  try {
    while (batches < PURGE_MAX_BATCHES) {
      // Widened on purpose: a result without a numeric change count ends the loop.
      const result: { meta?: { changes?: unknown } } | null | undefined = await db
        .prepare(sql)
        .bind(...binds, PURGE_BATCH)
        .run();
      batches += 1;
      const changes = result?.meta?.changes;
      const n = typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
      deleted += n;
      if (n < PURGE_BATCH) return { deleted, batches, more: false };
    }
    return { deleted, batches, more: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { deleted, batches, more: false, error: message.slice(0, 200) };
  }
}

/**
 * Delete every request-limit row whose window started ≥ 48h before `now`.
 * Never throws; each table is attempted independently.
 */
export async function purgeExpiredRateLimitRows(
  env: Pick<Env, "DB">,
  now: Date = new Date(),
): Promise<RateLimitPurgeResult> {
  const { cutoffIso, hourKey, dayKey } = rateLimitPurgeCutoff(now);
  const workspace = await purgeTable(env.DB, WORKSPACE_RATE_LIMIT_PURGE_SQL, [hourKey, dayKey]);
  const demo = await purgeTable(env.DB, DEMO_RATE_LIMIT_PURGE_SQL, [dayKey]);
  return { cutoff: cutoffIso, workspace, demo };
}

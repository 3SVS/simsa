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
 * Legacy rows (PR #566 review P1): the window rule alone would keep a row
 * written by the OLD code in the 48h before the deploy — the unkeyed
 * sha256(`workspace::${ip}`)-style IP hashes and the plain-sha256 userKey rows —
 * for up to 48h + 6h after the deploy, and in that time the policy sentence
 * "IP is stored only under a secret key" would be false. So every key the new
 * code writes starts with "v1:" (rate-limit-key.ts RATE_LIMIT_KEY_PREFIX) and a
 * second pass deletes every row WITHOUT that marker, whatever its window. Those
 * rows are dead: the new code computes different keys and never reads them.
 * The first tick after the deploy therefore clears every legacy row (more than
 * 100k per table → `more: true`, the next tick continues); after that the pass
 * finds nothing unless something wrote an unmarked key again.
 *
 * Deletion is batched (rowid subquery + LIMIT) so each statement stays small.
 * Fail-open: an error is reported in the result, never thrown — a cleanup
 * problem must not break the cron tick that carries it.
 */
import type { Env } from "./env.js";
import { RATE_LIMIT_KEY_PREFIX } from "./workspace/rate-limit-key.js";

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

/**
 * Rows whose key lacks the "v1:" marker (written before the keyed scheme).
 * Binds: (prefixLength, prefix, batchLimit). substr + <> is exact and
 * case-sensitive (LIKE would not be).
 */
export const WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL = `DELETE FROM workspace_rate_limit
 WHERE rowid IN (
   SELECT rowid FROM workspace_rate_limit
    WHERE substr(ip_hash, 1, ?) <> ?
    LIMIT ?)`;

/** Binds: (prefixLength, prefix, batchLimit). */
export const DEMO_RATE_LIMIT_LEGACY_PURGE_SQL = `DELETE FROM demo_rate_limit
 WHERE rowid IN (
   SELECT rowid FROM demo_rate_limit
    WHERE substr(ip_hash, 1, ?) <> ?
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
  /** Expired windows (≥ 48h since the window started). */
  workspace: TablePurgeResult;
  demo: TablePurgeResult;
  /** Rows without the "v1:" key marker — every row written before the keyed scheme. */
  legacy: { workspace: TablePurgeResult; demo: TablePurgeResult };
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
 * Delete every request-limit row whose window started ≥ 48h before `now`, and
 * every row written before the keyed scheme (no "v1:" marker) whatever its
 * window. Never throws; each statement is attempted independently.
 */
export async function purgeExpiredRateLimitRows(
  env: Pick<Env, "DB">,
  now: Date = new Date(),
): Promise<RateLimitPurgeResult> {
  const { cutoffIso, hourKey, dayKey } = rateLimitPurgeCutoff(now);
  const marker = [RATE_LIMIT_KEY_PREFIX.length, RATE_LIMIT_KEY_PREFIX] as const;
  // Legacy first: those are the rows the policy sentence depends on.
  const legacy = {
    workspace: await purgeTable(env.DB, WORKSPACE_RATE_LIMIT_LEGACY_PURGE_SQL, marker),
    demo: await purgeTable(env.DB, DEMO_RATE_LIMIT_LEGACY_PURGE_SQL, marker),
  };
  const workspace = await purgeTable(env.DB, WORKSPACE_RATE_LIMIT_PURGE_SQL, [hourKey, dayKey]);
  const demo = await purgeTable(env.DB, DEMO_RATE_LIMIT_PURGE_SQL, [dayKey]);
  return { cutoff: cutoffIso, workspace, demo, legacy };
}

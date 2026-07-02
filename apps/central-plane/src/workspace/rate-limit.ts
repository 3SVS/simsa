/**
 * rate-limit.ts — shared hourly rate-limit helpers for workspace routes.
 *
 * Generalizes the per-IP hourly limiter (workspace.ts / workspace-document-
 * intake.ts) into a keyed hourly limiter that also supports per-userKey
 * buckets. Reuses the existing `workspace_rate_limit` D1 table: the `ip_hash`
 * column stores sha256(`${bucket}::${key}`), so no migration is required.
 *
 * All D1 failures are non-fatal: a read failure counts as 0 (never blocks a
 * legitimate request on infrastructure trouble) and a write failure only logs.
 */
import type { Env } from "../env.js";

/** SHA-256 hex of `input` using the Web Crypto API available in Workers. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** UTC hour bucket, e.g. "2026-07-03T15" — resets every full UTC hour. */
function currentHourUtc(): string {
  return new Date().toISOString().slice(0, 13);
}

/** Seconds until the next full UTC hour (floor 60s). */
export function secondsUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}

async function getCount(db: D1Database, hash: string, hourUtc: string): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT count FROM workspace_rate_limit WHERE ip_hash = ? AND hour_utc = ?")
      .bind(hash, hourUtc)
      .first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    // Table may not exist yet in local dev — treat as 0
    return 0;
  }
}

async function increment(db: D1Database, hash: string, hourUtc: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (ip_hash, hour_utc) DO UPDATE SET
           count = count + 1, last_at = excluded.last_at`,
      )
      .bind(hash, hourUtc, now, now)
      .run();
  } catch (err) {
    console.warn(`[workspace/rate-limit] upsert failed (non-fatal):`, err);
  }
}

export type HourlyLimitResult = {
  limited: boolean;
  retryAfterSeconds: number;
};

/**
 * Check + consume one slot from a per-userKey hourly bucket.
 * Attempt-based: the counter is bumped as soon as the check passes, so retry
 * storms cannot bypass the limit by failing later in the handler.
 */
export async function consumeUserHourlyLimit(
  env: Env,
  bucket: string,
  userKey: string,
  limitPerHour: number,
): Promise<HourlyLimitResult> {
  const hash = await sha256Hex(`${bucket}::${userKey}`);
  const hourUtc = currentHourUtc();
  const count = await getCount(env.DB, hash, hourUtc);
  if (count >= limitPerHour) {
    return { limited: true, retryAfterSeconds: secondsUntilNextHour() };
  }
  await increment(env.DB, hash, hourUtc);
  return { limited: false, retryAfterSeconds: 0 };
}

/** Parse an hourly-limit env var with a default (invalid/absent → default). */
export function hourlyLimitFromEnv(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

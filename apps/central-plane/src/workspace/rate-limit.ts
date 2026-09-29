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

/** UTC day bucket, e.g. "2026-07-03" — resets at UTC midnight. */
function currentDayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO instant of the next UTC midnight after `now` — when a day bucket rolls over. */
export function nextDayUtcIso(now: Date = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

/** Seconds until the next UTC midnight (floor 60s). */
export function secondsUntilNextDayUtc(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
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

/**
 * Check + consume one slot from a per-userKey DAILY bucket (UTC calendar day).
 * Same `workspace_rate_limit` table as the hourly limiter — the `hour_utc`
 * column simply stores the day key ("2026-07-03"), which can never collide
 * with an hour key ("2026-07-03T15"). Attempt-based, like the hourly variant.
 */
export async function consumeUserDailyLimit(
  env: Env,
  bucket: string,
  userKey: string,
  limitPerDay: number,
): Promise<HourlyLimitResult> {
  const hash = await sha256Hex(`${bucket}::${userKey}`);
  const dayUtc = currentDayUtc();
  const count = await getCount(env.DB, hash, dayUtc);
  if (count >= limitPerDay) {
    return { limited: true, retryAfterSeconds: secondsUntilNextDayUtc() };
  }
  await increment(env.DB, hash, dayUtc);
  return { limited: false, retryAfterSeconds: 0 };
}

// ─── Train W · W-2 — atomic daily caps for the container paths ─────────────────
//
// consumeUserDailyLimit above is "read, then increment": two D1 round trips, so
// requests that arrive together all read the same count and all pass (PR #561
// review P2 — 15 concurrent inspections against a cap of 10 were all accepted).
// That is tolerable for the older soft caps; it is not for the paths that start
// a container on our bill. These use ONE statement per bucket: the conditional
// upsert below only bumps the counter while it is under the limit, so a result
// of zero changed rows means "full" and SQLite never lets two requests take the
// last slot (D1 runs one statement at a time; meta.changes is sqlite3_changes —
// a no-op upsert is 0, measured on the real 0026 schema in the test suite).
//
// And one bucket is not enough (PR #561 review P1): userKey is a client-made
// anonymous id, so a per-userKey cap is a guard against mistakes, not a cost
// ceiling — a loop that mints a fresh key per call walks right past it. The
// same consume therefore also takes a slot from a per-network bucket (hashed
// cf-connecting-ip) and a service-wide bucket; whichever is full first answers.

/**
 * The single-statement consume. Binds: (hash, dayKey, nowIso, nowIso, limit).
 * 1 changed row = slot taken; 0 = the bucket is already at `limit`.
 * Exported so a test can run the exact text against the real 0026 schema.
 */
export const DAILY_SLOT_CONSUME_SQL = `INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (ip_hash, hour_utc) DO UPDATE SET
       count = workspace_rate_limit.count + 1, last_at = excluded.last_at
     WHERE workspace_rate_limit.count < ?`;

/** Who a daily cap protects against. The response differs (see beta-limits.ts). */
export type DailyCapScope = "user" | "network" | "service";

export type DailyCap = {
  scope: DailyCapScope;
  /** Bucket name — also the hash salt (`${bucket}::${key}`). */
  bucket: string;
  /** userKey · client IP · a fixed service key. Hashed before it is stored. */
  key: string;
  limit: number;
};

export type DailyCapsResult =
  | {
      limited: false;
      /** The UTC day the slots came from ("2026-09-29"). */
      dayUtc: string;
      resetAt: string;
      /** Hand every slot back (the work never started). Idempotent, fail-open. */
      refund: () => Promise<void>;
    }
  | {
      limited: true;
      /** The first cap that was full, in the order given. */
      scope: DailyCapScope;
      limit: number;
      dayUtc: string;
      resetAt: string;
      retryAfterSeconds: number;
    };

/**
 * One atomic slot. false ONLY when D1 reports that the statement changed no row
 * (the bucket is full). true = taken — and also on D1 trouble or a result
 * without a change count (fail-open, like every limiter in this file).
 */
async function takeDailySlot(db: D1Database, hash: string, dayUtc: string, limit: number): Promise<boolean> {
  const nowIso = new Date().toISOString();
  try {
    // Widened on purpose: only a numeric 0 means "full"; anything else is taken.
    const result: { meta?: { changes?: unknown } } | null | undefined = await db
      .prepare(DAILY_SLOT_CONSUME_SQL)
      .bind(hash, dayUtc, nowIso, nowIso, limit)
      .run();
    const changes = result?.meta?.changes;
    return !(typeof changes === "number" && changes === 0);
  } catch (err) {
    // Same stance as every limiter in this file: infrastructure trouble never
    // blocks a legitimate request (the kill switch is the hard stop).
    console.warn(`[workspace/rate-limit] daily slot upsert failed (non-fatal):`, err);
    return true;
  }
}

/** Give one slot back to a day bucket. Never below 0; a D1 error only logs. */
async function returnDailySlot(db: D1Database, hash: string, dayUtc: string): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE workspace_rate_limit
            SET count = count - 1, last_at = ?
          WHERE ip_hash = ? AND hour_utc = ? AND count > 0`,
      )
      .bind(new Date().toISOString(), hash, dayUtc)
      .run();
  } catch (err) {
    console.warn(`[workspace/rate-limit] refund failed (non-fatal):`, err);
  }
}

/**
 * Take one slot from EVERY cap, in order, each with a single atomic statement.
 * When one is full, the slots already taken are handed back and the full cap is
 * named — so a request stopped by the service bucket costs its user nothing.
 * On success the caller gets `refund()` for when the work never starts (row not
 * saved, container refused, lost a concurrent start): our failure is not the
 * user's attempt. The refund goes to the day the slots came from, never to a
 * new day after UTC midnight.
 */
export async function consumeDailyCaps(
  env: Env,
  caps: readonly DailyCap[],
  now: Date = new Date(),
): Promise<DailyCapsResult> {
  const dayUtc = currentDayUtc(now);
  const resetAt = nextDayUtcIso(now);
  const taken: string[] = [];
  const giveBack = async () => {
    const hashes = taken.splice(0, taken.length);
    for (const hash of hashes) await returnDailySlot(env.DB, hash, dayUtc);
  };
  for (const cap of caps) {
    const hash = await sha256Hex(`${cap.bucket}::${cap.key}`);
    if (!(await takeDailySlot(env.DB, hash, dayUtc, cap.limit))) {
      await giveBack();
      return {
        limited: true,
        scope: cap.scope,
        limit: cap.limit,
        dayUtc,
        resetAt,
        retryAfterSeconds: secondsUntilNextDayUtc(now),
      };
    }
    taken.push(hash);
  }
  return { limited: false, dayUtc, resetAt, refund: giveBack };
}

/** Parse an hourly-limit env var with a default (invalid/absent → default). */
export function hourlyLimitFromEnv(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

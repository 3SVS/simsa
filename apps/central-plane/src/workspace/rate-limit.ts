/**
 * rate-limit.ts — shared hourly rate-limit helpers for workspace routes.
 *
 * Generalizes the per-IP hourly limiter (workspace.ts / workspace-document-
 * intake.ts) into a keyed hourly limiter that also supports per-userKey
 * buckets. Reuses the existing `workspace_rate_limit` D1 table, so no migration
 * is required. The `ip_hash` column stores (rate-limit-key.ts, all "v1:"-marked):
 *   IP buckets      → keyed HMAC (an unkeyed hash of an IPv4 address is reversible by brute force)
 *   userKey buckets → keyed HMAC (a plain hash links back to the user_key the DB keeps in plain text)
 *   service buckets → sha256 of a fixed, non-personal key
 * Rows older than 48h — and rows without the "v1:" marker — are purged by the
 * 6-hourly cron (rate-limit-retention.ts).
 *
 * All D1 failures are non-fatal: a read failure counts as 0 (never blocks a
 * legitimate request on infrastructure trouble) and a write failure only logs.
 */
import type { Env } from "../env.js";
import { ipRateLimitKey, ipWideRateLimitKey, serviceRateLimitKey, userRateLimitKey } from "./rate-limit-key.js";

/** UTC hour bucket, e.g. "2026-07-03T15" — resets every full UTC hour. */
function currentHourUtc(): string {
  return new Date().toISOString().slice(0, 13);
}

/** UTC day bucket, e.g. "2026-07-03" — resets at UTC midnight. */
function currentDayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * UTC month bucket, e.g. "2026-10" (D-24 T-4 — monthly repair quota). 7 chars, so it can
 * never collide with a day key (10) or an hour key (13); rate-limit-retention.ts purges a
 * month row once that month has been over for 48 hours.
 */
export function currentMonthUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** ISO instant of the first moment of the next UTC month — when a month bucket rolls over. */
export function nextMonthUtcIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
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
  const hash = await userRateLimitKey(env, bucket, userKey);
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
  const hash = await userRateLimitKey(env, bucket, userKey);
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
// same consume therefore also takes a slot from a per-network bucket
// (cf-connecting-ip, stored as a keyed HMAC like the userKey) and a service-wide bucket;
// whichever is full first answers.
//
// An IPv6 network is counted at two widths (PR #580 review P1): its /64 — the
// network cap's own row and limit — and the /48 around it, a second row with
// the larger share below. A /64 is one LAN, not one caller's allocation (home
// prefix delegation /56 or /60, a free tunnel broker's routed /48), so the /64
// alone let one /48 open 65,536 fresh network counters and, with 16 of them,
// take all 50 of the service's daily repairs. IPv4 has no second row.

/**
 * [PILOT] How many /64 caps one IPv6 /48 may take together (before the
 * service-half limit below). 2 = a site with several LANs (a /56 home, an
 * office /48) gets twice one LAN's share. The procedure is fixed; the number
 * may be tuned before the pilot. Raising a network cap (BETA_*_PER_IP) scales
 * the /48 share with it.
 */
export const IPV6_WIDE_NETWORK_MULTIPLIER = 2;

/**
 * The /48 share of an IPv6 network cap:
 *
 *   max(L, min(IPV6_WIDE_NETWORK_MULTIPLIER × L, largest integer below S / 2))
 *
 * L = the network cap (per /64), S = the service cap of the same consume (the
 * smallest, if several; none → no upper bound but the multiplier).
 *   - Under half of S: one /48 — a /56 home or one free tunnel — can never empty
 *     the service bucket alone, nor take half of it (PR #576's rule for the
 *     network share, kept for the wider tier).
 *   - Never below L: an IPv6 LAN never gets less than one IPv4 address does.
 *     If L itself is S/2 or more, the /48 share is L (the operator chose that
 *     network share; the wider tier does not second-guess it).
 * main: inspection 30/300 → 60 · repair 15/50 → 24. PR #576: repair 6/20 → 9 ·
 * generation 100/500 → 200 · dev-spec 40/200 → 80. PR #569: build 5/30 → 10.
 *
 * What a network cap does NOT do: stop someone holding several networks. It
 * takes ⌈S / L⌉ IPv4 addresses or ⌈S / share⌉ IPv6 /48s to empty a service
 * bucket (main: inspection 10 addresses or 5 /48s, repair 4 or 3) — the service
 * cap and the kill switches are the ceiling for that
 * (docs/simsa-rate-limit-network-units-2026-10-01.md).
 */
export function ipv6WideNetworkLimit(networkLimit: number, serviceLimit: number | null): number {
  const wide = networkLimit * IPV6_WIDE_NETWORK_MULTIPLIER;
  if (serviceLimit === null) return wide;
  const belowHalf = Math.floor((serviceLimit - 1) / 2);
  return Math.max(networkLimit, Math.min(wide, belowHalf));
}

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
  /**
   * userKey · client IP · a fixed service key. Never stored as-is
   * (dailyCapStoredKey): the user and network scopes → keyed HMAC; the service
   * scope → sha256 of its fixed key.
   */
  key: string;
  limit: number;
  /**
   * D-24 T-4: the window this cap counts in. Absent / "day" = the UTC day (every cap
   * before T-4). "month" = the UTC month (the monthly repair quota) — its row lives until
   * the month has been over for 48h (rate-limit-retention.ts).
   */
  period?: "day" | "month";
};

/**
 * What a daily cap's row is stored under (rate-limit-key.ts). The network scope
 * carries the client IP and the user scope a userKey the DB also keeps in plain
 * text — both get the keyed HMAC. The service key ("all") is not personal.
 */
async function dailyCapStoredKey(env: Pick<Env, "CONCLAVE_TOKEN_KEK">, cap: DailyCap): Promise<string> {
  switch (cap.scope) {
    case "network":
      return ipRateLimitKey(env, cap.bucket, cap.key);
    case "user":
      return userRateLimitKey(env, cap.bucket, cap.key);
    case "service":
      return serviceRateLimitKey(cap.bucket, cap.key);
  }
}

/** One row a consume takes a slot from: a cap's own row, or the /48 row of an IPv6 network cap. */
type DailySlot = { scope: DailyCapScope; limit: number; hash: string; period: "day" | "month" };

/**
 * The rows of `caps`, in order. A network cap whose key is an IPv6 address is
 * followed by its /48 row (ipWideRateLimitKey, limit ipv6WideNetworkLimit) —
 * so the /64 answers first and the order stays user → network → service.
 */
async function dailySlotsFor(env: Pick<Env, "CONCLAVE_TOKEN_KEK">, caps: readonly DailyCap[]): Promise<DailySlot[]> {
  const serviceLimits = caps.filter((cap) => cap.scope === "service").map((cap) => cap.limit);
  const serviceLimit = serviceLimits.length > 0 ? Math.min(...serviceLimits) : null;
  const slots: DailySlot[] = [];
  for (const cap of caps) {
    const period = cap.period ?? "day";
    slots.push({ scope: cap.scope, limit: cap.limit, hash: await dailyCapStoredKey(env, cap), period });
    if (cap.scope !== "network") continue;
    const wide = await ipWideRateLimitKey(env, cap.bucket, cap.key);
    if (wide) slots.push({ scope: "network", limit: ipv6WideNetworkLimit(cap.limit, serviceLimit), hash: wide, period });
  }
  return slots;
}

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
      /** That row's limit — for an IPv6 network, the /64 cap or the /48 share (ipv6WideNetworkLimit). */
      limit: number;
      dayUtc: string;
      resetAt: string;
      retryAfterSeconds: number;
      /** D-24 T-4: which window the full cap counts in ("month" → resetAt = next UTC month). */
      period: "day" | "month";
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
 * Take one slot from EVERY cap, in order, each with a single atomic statement
 * (an IPv6 network cap is two rows, its /64 then its /48 — dailySlotsFor).
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
  const monthUtc = currentMonthUtc(now);
  const resetAt = nextDayUtcIso(now);
  // Each taken slot remembers its own window, so a refund after UTC midnight (or month end)
  // still goes back to the window the slot came from.
  const taken: Array<{ hash: string; window: string }> = [];
  const giveBack = async () => {
    const slots = taken.splice(0, taken.length);
    for (const t of slots) await returnDailySlot(env.DB, t.hash, t.window);
  };
  for (const slot of await dailySlotsFor(env, caps)) {
    const window = slot.period === "month" ? monthUtc : dayUtc;
    if (!(await takeDailySlot(env.DB, slot.hash, window, slot.limit))) {
      await giveBack();
      const monthly = slot.period === "month";
      const reset = monthly ? nextMonthUtcIso(now) : resetAt;
      return {
        limited: true,
        scope: slot.scope,
        limit: slot.limit,
        dayUtc,
        resetAt: reset,
        retryAfterSeconds: monthly
          ? Math.max(60, Math.floor((new Date(reset).getTime() - now.getTime()) / 1000))
          : secondsUntilNextDayUtc(now),
        period: monthly ? "month" : "day",
      };
    }
    taken.push({ hash: slot.hash, window });
  }
  return { limited: false, dayUtc, resetAt, refund: giveBack };
}

export type DailyCapsPeek = {
  /** The smallest headroom across the caps (0 = the next consume is refused). */
  remaining: number;
  /** The cap that leaves the least headroom (null when `caps` is empty). */
  tightest: { scope: DailyCapScope; limit: number } | null;
  resetAt: string;
};

/**
 * Read-only view of what consumeDailyCaps would allow right now — for showing
 * "N left today" BEFORE the user spends effort (D-24.3). Takes no slot. A D1
 * read failure counts as 0 used (fail-open, same as the consume path).
 * `caps` empty → Infinity remaining.
 */
export async function peekDailyCaps(
  env: Env,
  caps: readonly DailyCap[],
  now: Date = new Date(),
): Promise<DailyCapsPeek> {
  const dayUtc = currentDayUtc(now);
  let remaining = Number.POSITIVE_INFINITY;
  let tightest: DailyCapsPeek["tightest"] = null;
  for (const cap of caps) {
    const window = cap.period === "month" ? currentMonthUtc(now) : dayUtc;
    const used = await getCount(env.DB, await dailyCapStoredKey(env, cap), window);
    const left = Math.max(0, cap.limit - used);
    if (left < remaining) {
      remaining = left;
      tightest = { scope: cap.scope, limit: cap.limit };
    }
  }
  return { remaining, tightest, resetAt: nextDayUtcIso(now) };
}

/** Parse an hourly-limit env var with a default (invalid/absent → default). */
export function hourlyLimitFromEnv(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Type declarations for daily-limit.mjs (Train W — W-2 client).

export type DailyLimitKind = "inspection" | "repair";

export type DailyLimitInfo = {
  kind: DailyLimitKind | null;
  limit: number | null;
  resetAt: string | null;
  /** D-24 T-4: the caller's tier — present only when the server sent a known value. */
  tier?: "free" | "basic" | "pro" | "staff";
  /** D-24 T-4: "month" for the monthly repair quota — present only then. */
  period?: "month";
};

/** Dictionary words for "when can I try again" (t.visualChecks.resetWhen). */
export type ResetWords = {
  today: string;
  tomorrow: string;
  onDate: string;
  time: string;
  timeWithMinute: string;
  am: string;
  pm: string;
  midnightHour: string;
  months: readonly string[];
};

/** Parse a 429 `daily_limit_reached` body; null for anything else. */
export function readDailyLimit(body: unknown): DailyLimitInfo | null;

/**
 * True only when the answer arrived before the reset and the reset has passed since:
 * receivedAt < resetAt <= now (reader's clock). Fresh refusals, clock skew and a
 * missing/odd receivedAt → false.
 */
export function resetPassedSinceReceipt(resetAt: unknown, receivedAt: unknown, opts?: { now?: Date }): boolean;

/** "내일 오전 9시 이후" / "after 8 PM today" in the reader's clock (dictionary words), or null. */
export function formatResetAt(
  resetAt: unknown,
  words: ResetWords,
  opts?: { now?: Date; timeZone?: string },
): string | null;

/**
 * Dictionary sentence for an error key. Daily cap: reset passed while the notice was
 * on screen (opts.receivedAt < resetAt <= now) → dailyLimitCleared; future resetAt →
 * dailyLimitReachedAt with "{when}"; otherwise dailyLimitReached.
 */
export function errorNoticeText(
  errors: {
    generic: string;
    dailyLimitReached?: string;
    dailyLimitReachedAt?: string;
    monthlyLimitReached?: string;
    monthlyLimitReachedAt?: string;
    dailyLimitCleared?: string;
  } & Record<string, string>,
  key: string,
  resetAt: string | null | undefined,
  words: ResetWords,
  opts?: { now?: Date; timeZone?: string; receivedAt?: number },
): string;

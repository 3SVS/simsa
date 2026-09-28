// Type declarations for daily-limit.mjs (Train W — W-2 client).

export type DailyLimitKind = "inspection" | "repair";

export type DailyLimitInfo = {
  kind: DailyLimitKind | null;
  limit: number | null;
  resetAt: string | null;
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

/** True when resetAt is a valid timestamp that has already passed (the notice outlived it). */
export function resetAtPassed(resetAt: unknown, opts?: { now?: Date }): boolean;

/** "내일 오전 9시 이후" / "after 8 PM today" in the reader's clock (dictionary words), or null. */
export function formatResetAt(
  resetAt: unknown,
  words: ResetWords,
  opts?: { now?: Date; timeZone?: string },
): string | null;

/**
 * Dictionary sentence for an error key. Daily cap: past resetAt → dailyLimitCleared;
 * future resetAt → dailyLimitReachedAt with "{when}"; otherwise dailyLimitReached.
 */
export function errorNoticeText(
  errors: {
    generic: string;
    dailyLimitReached?: string;
    dailyLimitReachedAt?: string;
    dailyLimitCleared?: string;
  } & Record<string, string>,
  key: string,
  resetAt: string | null | undefined,
  words: ResetWords,
  opts?: { now?: Date; timeZone?: string },
): string;

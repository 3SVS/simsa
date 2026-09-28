// Type declarations for daily-limit.mjs (Train W — W-2 client).

export type DailyLimitKind = "inspection" | "repair";

export type DailyLimitInfo = {
  kind: DailyLimitKind | null;
  limit: number | null;
  resetAt: string | null;
};

/** Parse a 429 `daily_limit_reached` body; null for anything else. */
export function readDailyLimit(body: unknown): DailyLimitInfo | null;

/** "내일 오전 9시 이후" / "after 8 PM today" in the reader's clock, or null (→ general copy). */
export function formatResetAt(
  resetAt: unknown,
  locale: "ko" | "en",
  opts?: { now?: Date; timeZone?: string },
): string | null;

/** Dictionary sentence for an error key; fills "{when}" for the daily cap when resetAt is usable. */
export function errorNoticeText(
  errors: { generic: string; dailyLimitReached?: string; dailyLimitReachedAt?: string } & Record<string, string>,
  key: string,
  resetAt: string | null | undefined,
  locale: "ko" | "en",
  opts?: { now?: Date; timeZone?: string },
): string;

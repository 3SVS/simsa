// Type declarations for visual-check-recheck.mjs (Train C — C0).

export type RecheckBody = {
  userKey: string;
  locale: "ko" | "en";
  /**
   * The source run's own intent, else the project's confirmed one-line. Omitted
   * when neither exists (the server default sentence counts as "none") — the
   * server then inherits from the source run.
   */
  intent?: string;
  /** The run being re-checked; the server copies its intent/targetUrl and stores source_check_id. */
  sourceCheckId?: string;
};

/** Same letters as central-plane DEFAULT_INSPECTION_INTENT (drift-tested). */
export const SERVER_DEFAULT_INTENT: string;

export function isServerDefaultIntent(raw: unknown): boolean;

/**
 * C-A7 P2-5: when the project's confirmed intent was last set — the later of the
 * "맞나요?" confirmation and an interview revision. Broken values are ignored; null if neither.
 */
export function confirmedIntentAtOf(
  ext: { intentConfirmedAt?: unknown; intentRevisedAt?: unknown } | null | undefined,
): string | null;

export function buildRecheckBody(
  check: { id?: unknown; intent?: unknown; createdAt?: unknown } | null | undefined,
  userKey: string,
  locale: "ko" | "en",
  opts?: { confirmedIntent?: unknown; confirmedIntentAt?: unknown },
): RecheckBody;

/**
 * PR #571 검증 결함 3: a check with the one-line the user just confirmed on the
 * intent card (door (c)) — explicit intent, no sourceCheckId, cut at 1000 chars.
 */
export function intentRecheckBody(
  oneLine: unknown,
  userKey: string,
  locale: "ko" | "en",
): { userKey: string; locale: "ko" | "en"; intent?: string };

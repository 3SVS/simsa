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

export function buildRecheckBody(
  check: { id?: unknown; intent?: unknown } | null | undefined,
  userKey: string,
  locale: "ko" | "en",
  opts?: { confirmedIntent?: unknown },
): RecheckBody;

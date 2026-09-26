// Type declarations for visual-check-recheck.mjs (Train C — C0).

export type RecheckBody = {
  userKey: string;
  locale: "ko" | "en";
  /** Omitted when the source run has no (non-blank) intent — the server then inherits. */
  intent?: string;
  /** The run being re-checked; the server copies its intent/targetUrl and stores source_check_id. */
  sourceCheckId?: string;
};

export function buildRecheckBody(
  check: { id?: unknown; intent?: unknown } | null | undefined,
  userKey: string,
  locale: "ko" | "en",
): RecheckBody;

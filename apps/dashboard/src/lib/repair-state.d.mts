// Type declarations for repair-state.mjs (Stage 269).

export type RepairErrorKey =
  | "notRepairable"
  | "repoRequired"
  | "tokenRequired"
  | "alreadyActive"
  | "notFound"
  | "forbidden"
  /** Train W — W-2: 429 daily_limit_reached (수리 5/일, UTC 일 기준). */
  | "dailyLimitReached"
  /** Train W — W-2: 503 repair_disabled (REPAIR_ENABLED="off"). */
  | "repairDisabled"
  | "generic";

export const REPAIR_POLL_INTERVAL_MS: number;

export function canRepair(
  check: { status?: unknown; works?: unknown; decision?: unknown; report?: unknown } | null | undefined,
): boolean;

/** Anything to fix? Same rule as the server report's next steps (non-info finding · not working · open verdict other than "no problem found"). */
export function hasSomethingToFix(check: unknown): boolean;

/** Train C — C2a: "repair" (linked repo) · "builder_paste" (address-only / unknown) · "none". */
export type RepairEntryMode = "repair" | "builder_paste" | "none";

export function repairEntryMode(
  check: { status?: unknown; works?: unknown } | null | undefined,
  hasRepo: boolean | null | undefined,
  /** hasRepairJob: an existing repair job keeps the "repair" card whatever the repo fact says. */
  opts?: { hasRepairJob?: boolean },
): RepairEntryMode;

export function isRepairActive(
  repair: { status?: unknown } | null | undefined,
): boolean;

export function nextRepairPollMs(status: unknown): number | null;

export function isEnvCause(
  repair: { envCause?: unknown } | null | undefined,
): boolean;

export function repairErrorKey(codeOrStatus: unknown): RepairErrorKey;

export type RepairFailureKind = "repoAccessDenied" | "generic";

export function repairFailureKind(
  repair: { status?: unknown; error?: unknown } | null | undefined,
): RepairFailureKind | null;

/** Train W — W-2: the whole answer → error key + resetAt (daily cap only; null otherwise). */
export function repairErrorNotice(res: unknown): { errorKey: RepairErrorKey; resetAt: string | null };

/** Callout tone: today's cap and a paused service are information, not a red error. */
export function repairErrorTone(key: RepairErrorKey): "info" | "error";

/**
 * Train W — W-3 ③: true only for a finished `mode: "auto_fix"` job whose server says
 * buildVerified === false (same test as repairDoneKind; brief_only → server sends null).
 */
export function showBuildUnverified(
  repair: { status?: unknown; mode?: unknown; buildVerified?: unknown } | null | undefined,
): boolean;

/** "autoFix" (real code changes, Stage 270) · "briefOnly" (fix-brief draft PR, legacy/unknown). */
export function repairDoneKind(repair: { mode?: unknown } | null | undefined): "autoFix" | "briefOnly";

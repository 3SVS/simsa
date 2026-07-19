// Type declarations for repair-state.mjs (Stage 269).

export type RepairErrorKey =
  | "notRepairable"
  | "repoRequired"
  | "tokenRequired"
  | "alreadyActive"
  | "notFound"
  | "forbidden"
  | "generic";

export const REPAIR_POLL_INTERVAL_MS: number;

export function canRepair(
  check: { status?: unknown; works?: unknown } | null | undefined,
): boolean;

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

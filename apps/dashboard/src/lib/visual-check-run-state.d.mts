// Type declarations for visual-check-run-state.mjs (Stage 264).

export type RunErrorKey =
  | "websiteSourceRequired"
  | "runAlreadyActive"
  | "projectNotFound"
  | "forbidden"
  | "invalidIntent"
  /** Train W — W-2: 429 daily_limit_reached (검수 10/일, UTC 일 기준). */
  | "dailyLimitReached"
  /** Train W — W-2: 503 inspection_disabled (INSPECTION_ENABLED="off"). */
  | "inspectionDisabled"
  | "generic";

export type RunButtonReasonKey = "runAlreadyActive" | "websiteSourceRequired";

export const RUN_POLL_INTERVAL_MS: number;

export function isActiveStatus(status: unknown): boolean;

export function nextPollDelayMs(status: unknown): number | null;

export function runButtonState(input?: {
  hasWebsiteSource?: boolean;
  hasActiveRun?: boolean;
}): { disabled: boolean; reasonKey: RunButtonReasonKey | null };

export function mapRunError(codeOrStatus: unknown): RunErrorKey;

/** Train W — W-2: the whole answer → error key + resetAt (daily cap only; null otherwise). */
export function runErrorNotice(res: unknown): { errorKey: RunErrorKey; resetAt: string | null };

/** Callout tone: cap / pause / already running / needs an address are information, not a red error. */
export function runErrorTone(key: RunErrorKey): "info" | "error";

/** Daily cap or kill switch — the automatic first inspection must not swallow these. */
export function isServiceGateKey(key: unknown): key is "dailyLimitReached" | "inspectionDisabled";

/** Duration (ms) of the new-project flow's service-gate info toast (default toast = 3 s). */
export const SERVICE_GATE_TOAST_MS: number;

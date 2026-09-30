// Type declarations for privacy-ops-info.mjs (Train W — W-9 방침 고지).

export type OpsInfoItem = {
  label: string;
  detail: string;
  /** D1 columns this item discloses (0069+ migrations, and the 0055/0056 project capture columns). */
  columns?: readonly string[];
  /** RunEnvelope fields (central-plane workspace/envelope.ts) this item discloses. */
  envelope?: readonly string[];
};

/** Privacy policy effective date (YYYY-MM-DD) — set to the deploy date right before deploying. */
export const PRIVACY_EFFECTIVE_DATE: string;
/**
 * Change history, ascending; append a line per policy change (never rewrite old lines).
 * Published lines carry a literal date; only the newest line uses PRIVACY_EFFECTIVE_DATE.
 */
export const PRIVACY_CHANGE_LOG: ReadonlyArray<{ date: string; summary: string }>;
export const OPS_INFO_TITLE: string;
export const OPS_INFO_LEAD: string;
export const OPS_INFO_ITEMS: ReadonlyArray<OpsInfoItem>;
export const OPS_INFO_PURPOSE: string;
export const OPS_INFO_BASIS: string;
export const OPS_INFO_RETENTION: string;
/** Opt-in training copies are not removed by project deletion (§1 retention + §3 share this sentence). */
export const TRAINING_COPY_NOTE: string;
/** Request-limit records are deleted after 48 hours (§1 retention + §3 share this sentence). */
export const RATE_LIMIT_RETENTION_NOTE: string;
export const OPS_INFO_OPT_OUT: string;

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
/**
 * Opt-in training copies: indexed copies are deleted on withdrawal / project deletion; copies saved
 * before the index existed are an honest exception handled on request (§1 retention + §3 share it).
 */
export const TRAINING_COPY_NOTE: string;
/** §2 "학습 데이터 제공(선택)" paragraph (anchor #training-data). */
export const TRAINING_DATA_TITLE: string;
export const TRAINING_DATA_SCOPE: string;
export const TRAINING_DATA_PURPOSE: string;
export const TRAINING_DATA_BASIS: string;
export const TRAINING_DATA_CHOICE: string;
/** Request-limit records are deleted after 48 hours (§1 retention + §3 share this sentence). */
export const RATE_LIMIT_RETENTION_NOTE: string;
/** Columns the "record off" switch stops writing (Train K contract 3) — and the ones it keeps. */
export const OPS_META_OFF_STOPS: readonly string[];
export const OPS_META_OFF_KEEPS: readonly string[];
export const OPS_INFO_OPT_OUT: string;

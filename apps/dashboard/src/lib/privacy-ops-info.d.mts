// Type declarations for privacy-ops-info.mjs (Train W — W-9 방침 고지).

export type OpsInfoItem = {
  label: string;
  detail: string;
  /** D1 columns this item discloses (0069+ migrations, and the 0055/0056 project capture columns). */
  columns?: readonly string[];
  /** RunEnvelope fields (central-plane workspace/envelope.ts) this item discloses. */
  envelope?: readonly string[];
};

/** Privacy policy effective date (YYYY-MM-DD) — change only this on deploy. */
export const PRIVACY_EFFECTIVE_DATE: string;
export const OPS_INFO_TITLE: string;
export const OPS_INFO_LEAD: string;
export const OPS_INFO_ITEMS: ReadonlyArray<OpsInfoItem>;
export const OPS_INFO_PURPOSE: string;
export const OPS_INFO_BASIS: string;
export const OPS_INFO_RETENTION: string;
export const OPS_INFO_OPT_OUT: string;

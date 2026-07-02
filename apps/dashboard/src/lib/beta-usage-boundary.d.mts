// Type declarations for beta-usage-boundary.mjs (Stage 122).

export const BETA_USAGE_BOUNDARY_HEADING: string;
export const BETA_USAGE_BOUNDARY_ITEMS: string[];
export const BETA_USAGE_NOT_ACTIVE_COPY: string;
export const SAVED_WORKFLOW_USAGE_NOTE: string;
export const ADMIN_USAGE_BOUNDARY_NOTE: string;
export const ADMIN_COUNTS_SIGNAL_NOTE: string;

export type BetaUsageBoundaryCopy = {
  heading: string;
  items: string[];
  notActive: string;
  savedWorkflowNote: string;
};

export const BETA_USAGE_BOUNDARY_COPY: Record<"en" | "ko", BetaUsageBoundaryCopy>;
export function getBetaUsageBoundaryCopy(locale: string): BetaUsageBoundaryCopy;

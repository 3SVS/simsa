// Type declarations for project-quota.mjs (D-24 새 프로젝트 하루 상한 문장).

export type ProjectLimitInfo = {
  tier: string;
  limit: number;
  resetAt: string;
  limitedBy: "user" | "network" | "service" | null;
};

export function quotaRemainingText(
  quota: { limit: number; remaining: number } | null | undefined,
  tq: { remaining: string },
): string | null;

export function projectLimitText(
  info: ProjectLimitInfo,
  tq: {
    limitTitle: string;
    limitTitleNetwork?: string;
    limitBody: string;
    limitBodyNetwork: string;
    resetAt: string;
    resetFallback: string;
    tierNames: Record<string, string>;
  },
  resetWords: unknown,
  opts?: { now?: Date; timeZone?: string },
): { title: string; body: string; reset: string; showSignIn: boolean };

export function blockedFromQuota(
  quota: { tier: string; limit: number; remaining: number; resetAt: string; limitedBy: "user" | "network" | "service" | null } | null | undefined,
): ProjectLimitInfo | null;

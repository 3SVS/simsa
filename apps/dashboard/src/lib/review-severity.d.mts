export type SeverityTier = "p0" | "p1" | "p2" | "ok" | "neutral";

export type ReviewVerdictInput = {
  passed?: number;
  failed?: number;
  inconclusive?: number;
  needsDecision?: number;
};

export type ReviewVerdict = {
  total: number;
  passed: number;
  needsAction: number;
  tone: "pass" | "fail";
};

export function severityForStatus(status: string): SeverityTier;
export function severityCode(status: string): string;
export function severityChipClass(status: string): string;
export function isActionableStatus(status: string): boolean;
export function buildReviewVerdict(summary: ReviewVerdictInput | null | undefined): ReviewVerdict;
export function reviewProgress(done: number, total: number): { done: number; total: number };

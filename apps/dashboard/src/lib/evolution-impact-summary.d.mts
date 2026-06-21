// Type declarations for evolution-impact-summary.mjs (Stage 80).
import type {
  EvolutionImpactSummary,
  EvolutionImpactSummaryOverallVerdict,
} from "./workspace-experiment-api";

export const SUMMARY_OVERALL_VERDICTS: EvolutionImpactSummaryOverallVerdict[];

export function summaryVerdictLabelKey(
  verdict: EvolutionImpactSummaryOverallVerdict | string | null | undefined,
): string;
export function summaryReasonLabelKey(reason: string | null | undefined): string;

export function formatAverageDeltaPercent(value: number | null | undefined): string;
export function formatAverageDeltaCount(value: number | null | undefined): string;
export function summaryHasNoFollowups(summary: EvolutionImpactSummary | null | undefined): boolean;

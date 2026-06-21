/**
 * workspace/evolution-impact-summary.ts — Stage 80
 *
 * Pure aggregator: takes per-pack EvolutionImpactComparison results from Stage
 * 79 and rolls them up into an experiment-level summary. NO LLM, NO network,
 * NO randomness. Verdict rules are deterministic and additive — every reason
 * code maps to a single rule the test suite asserts.
 *
 * Stage 80 deliberately calls into Stage 79's `buildImpactComparison` via the
 * input entries; we never re-derive the per-pack verdict here. That keeps the
 * single source of truth for the formula in `evolution-impact.ts`.
 */
import type { EvolutionImpactComparison } from "./evolution-impact.js";

export type EvolutionImpactSummaryOverallVerdict =
  | "mostly_improved"
  | "mixed"
  | "mostly_inconclusive"
  | "no_followups"
  | "regressed";

export type EvolutionImpactSummaryReason =
  | "no_saved_action_packs"
  | "no_followups"
  | "more_improved_than_regressed"
  | "regressions_detected"
  | "mostly_inconclusive"
  | "mixed_results"
  | "not_enough_comparable_data";

export type EvolutionImpactSummaryEntry = {
  comparison: EvolutionImpactComparison;
  followed: boolean;
  recommendedAction: string;
};

export type EvolutionImpactSummaryVerdictCounts = {
  improved: number;
  regressed: number;
  unchanged: number;
  inconclusive: number;
};

export type EvolutionImpactSummaryRecommendedActionVerdict = {
  recommendedAction: string;
  total: number;
  improved: number;
  regressed: number;
  unchanged: number;
  inconclusive: number;
};

export type EvolutionImpactSummaryAverageDelta = {
  passRateDelta: number | null;
  criticalIssueDelta: number | null;
  notVerifiedDelta: number | null;
  blockerDelta: number | null;
};

export type EvolutionImpactSummary = {
  projectId: string;
  experimentId: string;
  actionPackCount: number;
  followedPackCount: number;
  verdictCounts: EvolutionImpactSummaryVerdictCounts;
  recommendedActionCounts: Record<string, number>;
  recommendedActionVerdicts: EvolutionImpactSummaryRecommendedActionVerdict[];
  averageDelta: EvolutionImpactSummaryAverageDelta;
  overallVerdict: EvolutionImpactSummaryOverallVerdict;
  reasons: EvolutionImpactSummaryReason[];
  limitations: string[];
};

const MOSTLY_INCONCLUSIVE_THRESHOLD = 0.7;

function meanOrNull(values: Array<number | null | undefined>): number | null {
  const filtered: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) filtered.push(v);
  }
  if (filtered.length === 0) return null;
  let sum = 0;
  for (const v of filtered) sum += v;
  return sum / filtered.length;
}

/** Pure aggregator. Tests call this directly with hand-built entries. */
export function buildEvolutionImpactSummary(args: {
  projectId: string;
  experimentId: string;
  entries: EvolutionImpactSummaryEntry[];
}): EvolutionImpactSummary {
  const { projectId, experimentId, entries } = args;

  // ── Counts ────────────────────────────────────────────────────────────────
  const actionPackCount = entries.length;
  const followedPackCount = entries.reduce((n, e) => n + (e.followed ? 1 : 0), 0);

  const verdictCounts: EvolutionImpactSummaryVerdictCounts = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    inconclusive: 0,
  };
  const recommendedActionCounts: Record<string, number> = {};
  const recommendedActionBuckets = new Map<string, EvolutionImpactSummaryRecommendedActionVerdict>();
  for (const entry of entries) {
    const v = entry.comparison.verdict;
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;

    const action = entry.recommendedAction;
    recommendedActionCounts[action] = (recommendedActionCounts[action] ?? 0) + 1;

    let bucket = recommendedActionBuckets.get(action);
    if (!bucket) {
      bucket = { recommendedAction: action, total: 0, improved: 0, regressed: 0, unchanged: 0, inconclusive: 0 };
      recommendedActionBuckets.set(action, bucket);
    }
    bucket.total += 1;
    bucket[v] += 1;
  }
  // Stable order for downstream UIs / golden tests.
  const recommendedActionVerdicts: EvolutionImpactSummaryRecommendedActionVerdict[] = [
    ...recommendedActionBuckets.values(),
  ].sort((a, b) => a.recommendedAction.localeCompare(b.recommendedAction));

  // ── Average delta (simple unweighted mean of non-null per-pack deltas) ───
  // Per Stage 80 spec we do NOT weight by total item count; document caveat.
  const averageDelta: EvolutionImpactSummaryAverageDelta = {
    passRateDelta: meanOrNull(entries.map((e) => e.comparison.delta?.passRateDelta)),
    criticalIssueDelta: meanOrNull(entries.map((e) => e.comparison.delta?.criticalIssueDelta)),
    notVerifiedDelta: meanOrNull(entries.map((e) => e.comparison.delta?.notVerifiedDelta)),
    blockerDelta: meanOrNull(entries.map((e) => e.comparison.delta?.blockerDelta)),
  };

  // ── Unique limitations across all packs (sorted for determinism) ────────
  const limitationSet = new Set<string>();
  for (const e of entries) for (const l of e.comparison.limitations) limitationSet.add(l);
  const limitations = [...limitationSet].sort();

  // ── Overall verdict (first matching rule wins; mirrors spec exactly) ────
  let overallVerdict: EvolutionImpactSummaryOverallVerdict;
  const reasons: EvolutionImpactSummaryReason[] = [];

  if (actionPackCount === 0) {
    overallVerdict = "no_followups";
    reasons.push("no_saved_action_packs");
  } else if (followedPackCount === 0) {
    overallVerdict = "no_followups";
    reasons.push("no_followups");
  } else if (verdictCounts.inconclusive / actionPackCount >= MOSTLY_INCONCLUSIVE_THRESHOLD) {
    overallVerdict = "mostly_inconclusive";
    reasons.push("mostly_inconclusive");
  } else if (verdictCounts.regressed > verdictCounts.improved) {
    overallVerdict = "regressed";
    reasons.push("regressions_detected");
  } else if (verdictCounts.improved > verdictCounts.regressed && verdictCounts.improved > 0) {
    overallVerdict = "mostly_improved";
    reasons.push("more_improved_than_regressed");
  } else {
    overallVerdict = "mixed";
    reasons.push("mixed_results");
  }

  // Layered reason: if no per-pack delivered a comparable delta at all, flag it.
  const hadAnyDelta = entries.some((e) => e.comparison.delta !== null);
  if (actionPackCount > 0 && followedPackCount > 0 && !hadAnyDelta) {
    reasons.push("not_enough_comparable_data");
  }

  return {
    projectId,
    experimentId,
    actionPackCount,
    followedPackCount,
    verdictCounts,
    recommendedActionCounts,
    recommendedActionVerdicts,
    averageDelta,
    overallVerdict,
    reasons,
    limitations,
  };
}

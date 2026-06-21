"use client";

/**
 * Dashboard client for persisted Manual Multi-Agent Experiments (Stage 72).
 */
import type {
  AgentExperimentMode,
  AgentExperimentRole,
  SuggestedAgent,
} from "./agent-experiment.mjs";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

export type SaveExperimentCandidate = {
  id: string;
  label: string;
  mode: AgentExperimentMode;
  role: AgentExperimentRole;
  suggestedAgent: SuggestedAgent;
};

export type ExperimentCandidate = {
  id: string;
  candidateId: string;
  label: string;
  mode: string;
  role: string;
  suggestedAgent: string;
  status: string;
  pullRequestNumber?: number;
  reviewRunId?: string;
  benchmarkId?: string;
  outcome?: string;
  outcomeNote?: string;
  decidedAt?: string;
};

export type SavedExperimentListItem = {
  id: string;
  title: string;
  templateId: string;
  status: string;
  candidateCount: number;
  createdAt: string;
};

export type SavedExperiment = {
  id: string;
  projectId: string;
  title: string;
  templateId: string;
  status: string;
  createdAt: string;
  decisionStatus?: string;
  selectedCandidateId?: string;
  decisionNote?: string;
  decidedAt?: string;
  candidates: ExperimentCandidate[];
};

export type DecisionInput = {
  userKey: string;
  selectedCandidateId?: string;
  candidateOutcomes: Array<{ candidateId: string; outcome: string; note?: string }>;
  decisionStatus: string;
  decisionNote?: string;
};

export type DecisionResponse =
  | { ok: true; experiment: SavedExperiment }
  | { ok: false; error: string };

type SaveResponse = { ok: true; experiment: SavedExperiment } | { ok: false; error: string };
type ListResponse = { ok: true; experiments: SavedExperimentListItem[] } | { ok: false; error: string };
type DetailResponse = { ok: true; experiment: SavedExperiment } | { ok: false; error: string };
type PatchResponse = { ok: true; candidate: ExperimentCandidate } | { ok: false; error: string };

const base = (projectId: string) =>
  `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/agent-experiments`;

export async function saveExperiment(
  projectId: string,
  input: { userKey: string; title: string; templateId: string; candidates: SaveExperimentCandidate[] },
): Promise<SaveResponse> {
  try {
    const resp = await fetch(base(projectId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    return (await resp.json()) as SaveResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listExperiments(projectId: string, userKey: string): Promise<ListResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(`${base(projectId)}?${params}`, { signal: AbortSignal.timeout(8000) });
    return (await resp.json()) as ListResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getExperiment(
  projectId: string,
  experimentId: string,
  userKey: string,
): Promise<DetailResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(`${base(projectId)}/${encodeURIComponent(experimentId)}?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    return (await resp.json()) as DetailResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type BenchmarkFromExperimentResponse =
  | { ok: true; benchmark: { id: string; title?: string; sourceExperimentId?: string }; experiment: SavedExperiment }
  | { ok: false; error: string };

export async function createBenchmarkFromExperiment(
  projectId: string,
  experimentId: string,
  userKey: string,
): Promise<BenchmarkFromExperimentResponse> {
  try {
    const resp = await fetch(`${base(projectId)}/${encodeURIComponent(experimentId)}/benchmark`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey }),
      signal: AbortSignal.timeout(12000),
    });
    return (await resp.json()) as BenchmarkFromExperimentResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type OutcomeScorecard = {
  experimentId: string;
  projectId: string;
  selectedCandidateId?: string;
  decisionStatus: string;
  quality: {
    acceptancePassRate: number | null;
    unresolvedBlockerCount: number;
    criticalIssueCount: number;
    notVerifiedCount: number;
    needsDecisionCount: number;
    evidenceCoverageRate: number | null;
    score: number;
    grade: string;
  };
  signals: {
    hasBenchmark: boolean;
    hasDecision: boolean;
    hasSelectedCandidate: boolean;
    hasItemLevelEvidence: boolean;
    acceptanceSetAligned?: boolean;
  };
  nextEvolution: {
    recommendedAction: string;
    reasons: string[];
    suggestedFocusItemIds: string[];
  };
};

export type OutcomeScorecardResponse =
  | { ok: true; scorecard: OutcomeScorecard }
  | { ok: false; error: string };

export async function getOutcomeScorecard(
  projectId: string,
  experimentId: string,
  userKey: string,
): Promise<OutcomeScorecardResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(`${base(projectId)}/${encodeURIComponent(experimentId)}/outcome-scorecard?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    return (await resp.json()) as OutcomeScorecardResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function saveExperimentDecision(
  projectId: string,
  experimentId: string,
  input: DecisionInput,
): Promise<DecisionResponse> {
  try {
    const resp = await fetch(`${base(projectId)}/${encodeURIComponent(experimentId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    return (await resp.json()) as DecisionResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Stage 77: persisted Evolution Action Packs ─────────────────────────────

export type SavedEvolutionActionPackSection = { title: string; body: string };

export type SavedEvolutionActionPack = {
  projectId: string;
  experimentId: string;
  recommendedAction: string;
  title: string;
  summary: string;
  targetCandidateId?: string;
  focusItemIds: string[];
  sections: SavedEvolutionActionPackSection[];
};

// Stage 78 — follow-up tracking.
export type ActionPackFollowupStatus =
  | "not_started"
  | "copied"
  | "in_progress"
  | "reviewed"
  | "benchmarked"
  | "completed"
  | "abandoned";

export const ACTION_PACK_FOLLOWUP_STATUSES: ActionPackFollowupStatus[] = [
  "not_started",
  "copied",
  "in_progress",
  "reviewed",
  "benchmarked",
  "completed",
  "abandoned",
];

export type ActionPackFollowup = {
  status: ActionPackFollowupStatus;
  pullRequestNumber?: number;
  reviewRunId?: string;
  benchmarkId?: string;
  note?: string;
  followedAt?: string;
};

export type SavedEvolutionActionPackListItem = {
  id: string;
  experimentId: string;
  recommendedAction: string;
  title: string;
  createdAt: string;
  followupStatus: ActionPackFollowupStatus;
  followupPullRequestNumber?: number;
  followupReviewRunId?: string;
  followupBenchmarkId?: string;
  followedAt?: string;
};

export type SavedEvolutionActionPackDetail = {
  id: string;
  experimentId: string;
  recommendedAction: string;
  title: string;
  createdAt: string;
  pack: SavedEvolutionActionPack;
  text: string;
  followup: ActionPackFollowup;
};

type SaveActionPackResponse =
  | { ok: true; actionPack: SavedEvolutionActionPackDetail }
  | { ok: false; error: string };
type ListActionPacksResponse =
  | { ok: true; actionPacks: SavedEvolutionActionPackListItem[] }
  | { ok: false; error: string };
type GetActionPackResponse =
  | { ok: true; actionPack: SavedEvolutionActionPackDetail }
  | { ok: false; error: string };

export async function saveEvolutionActionPack(
  projectId: string,
  experimentId: string,
  userKey: string,
): Promise<SaveActionPackResponse> {
  try {
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/evolution-action-packs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey }),
        signal: AbortSignal.timeout(8000),
      },
    );
    return (await resp.json()) as SaveActionPackResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listEvolutionActionPacks(
  projectId: string,
  experimentId: string,
  userKey: string,
): Promise<ListActionPacksResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/evolution-action-packs?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    return (await resp.json()) as ListActionPacksResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getEvolutionActionPack(
  projectId: string,
  experimentId: string,
  actionPackId: string,
  userKey: string,
): Promise<GetActionPackResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/evolution-action-packs/${encodeURIComponent(actionPackId)}?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    return (await resp.json()) as GetActionPackResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Stage 79 — Before/After Evolution Impact comparison.
export type EvolutionImpactVerdict = "improved" | "regressed" | "unchanged" | "inconclusive";
export type EvolutionImpactSource = "benchmark" | "review_run";

export type EvolutionImpactSnapshot = {
  source: EvolutionImpactSource;
  sourceId: string;
  passRate: number | null;
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  needsDecisionCount: number;
  criticalIssueCount: number;
  notVerifiedCount: number;
  blockerCount: number;
  totalCount: number;
  itemIds?: string[];
};

export type EvolutionImpactDelta = {
  passRateDelta: number | null;
  passedDelta: number;
  criticalIssueDelta: number;
  notVerifiedDelta: number;
  blockerDelta: number;
};

export type EvolutionImpactComparison = {
  actionPackId: string;
  experimentId: string;
  projectId: string;
  recommendedAction: string;
  before: EvolutionImpactSnapshot | null;
  after: EvolutionImpactSnapshot | null;
  delta: EvolutionImpactDelta | null;
  verdict: EvolutionImpactVerdict;
  reasons: string[];
  limitations: string[];
};

type GetImpactResponse =
  | { ok: true; impact: EvolutionImpactComparison }
  | { ok: false; error: string };

export async function getEvolutionActionPackImpact(
  projectId: string,
  experimentId: string,
  actionPackId: string,
  userKey: string,
): Promise<GetImpactResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/evolution-action-packs/${encodeURIComponent(actionPackId)}/impact?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    return (await resp.json()) as GetImpactResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Stage 80 — experiment-level Evolution Impact Summary.
export type EvolutionImpactSummaryOverallVerdict =
  | "mostly_improved"
  | "mixed"
  | "mostly_inconclusive"
  | "no_followups"
  | "regressed";

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
  reasons: string[];
  limitations: string[];
};

type GetImpactSummaryResponse =
  | { ok: true; summary: EvolutionImpactSummary }
  | { ok: false; error: string };

export async function getEvolutionImpactSummary(
  projectId: string,
  experimentId: string,
  userKey: string,
): Promise<GetImpactSummaryResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/evolution-impact-summary?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    return (await resp.json()) as GetImpactSummaryResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type ActionPackFollowupInput = {
  userKey: string;
  status: ActionPackFollowupStatus;
  pullRequestNumber?: number;
  reviewRunId?: string;
  benchmarkId?: string;
  note?: string;
};

export async function patchEvolutionActionPackFollowup(
  projectId: string,
  experimentId: string,
  actionPackId: string,
  input: ActionPackFollowupInput,
): Promise<GetActionPackResponse> {
  try {
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/evolution-action-packs/${encodeURIComponent(actionPackId)}/followup`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(8000),
      },
    );
    return (await resp.json()) as GetActionPackResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function patchExperimentCandidate(
  projectId: string,
  experimentId: string,
  candidateRowId: string,
  input: { userKey: string; pullRequestNumber?: number; reviewRunId?: string; benchmarkId?: string },
): Promise<PatchResponse> {
  try {
    const resp = await fetch(
      `${base(projectId)}/${encodeURIComponent(experimentId)}/candidates/${encodeURIComponent(candidateRowId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(8000),
      },
    );
    return (await resp.json()) as PatchResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * v0.7.1 — structured JSON emitter for `conclave review --json`.
 *
 * Purpose: `conclave autofix` (and any downstream tool — benchmarks,
 * Telegram bot, dashboards) needs a parseable verdict stream without
 * scraping ANSI-colored human output. Previously, autofix required a
 * hand-crafted verdict JSON file because there was no supported way
 * to capture the live review output programmatically. This emitter
 * closes that gap.
 *
 * Shape invariants (pinned — do NOT break at v0.7.1+):
 * - `verdict`: the council's final verdict, "approve" | "rework" | "reject"
 * - `domain`: "code" | "design" | "mixed" (matches CLI-layer resolvedDomain)
 * - `tiers`: present when TieredCouncil ran; tier-2 fields are 0/"" when no escalation
 * - `agents`: per-agent results, each with blockers + summary
 * - `metrics`: EfficiencyGate summary snapshot
 * - `episodicId`, `sha`, `repo`: traceability fields for autofix + record-outcome
 * - `prNumber`: optional (absent for plain `git diff` runs)
 * - `plainSummary`: present when plain-summary generation succeeded; optional
 *
 * Keep this emitter pure — no process.* / fs / network. Callers own stdout.
 */
import type {
  Blocker,
  MetricsSummary,
  PlainSummary,
  ReviewResult,
} from "@simsa/core";

export interface ReviewJsonInput {
  repo: string;
  sha: string;
  pullNumber?: number;
  councilVerdict: "approve" | "rework" | "reject";
  domain: "code" | "design" | "mixed";
  results: readonly ReviewResult[];
  metrics: MetricsSummary;
  episodicId: string;
  /** Present when TieredCouncil was used. */
  tier?: {
    escalated: boolean;
    reason: string;
    tier1Rounds: number;
    tier2Rounds?: number;
    tier1Ids: readonly string[];
    tier2Ids: readonly string[];
    tier1Verdict: "approve" | "rework" | "reject";
    tier2Verdict?: "approve" | "rework" | "reject";
  };
  plainSummary?: PlainSummary;
  /**
   * v0.16.11 — Sprint D: RAG-injection telemetry. Counts of context
   * entries that were available to agents in this review pass. Lets
   * downstream measurement tools answer "did Phase 4 / Sprint C add
   * meaningful context, or were the prompts effectively unchanged?"
   */
  ragInjection?: RagInjectionTelemetry;
  /**
   * v0.17 — Sprint E5 smoke-pass attribution: kebab agent_ids of every
   * spawned-agent persona that participated in this review. Empty when
   * no trial/promoted agents matched the domain. Consumed by
   * autofix-pipeline: after the smoke step, autofix PATCHes
   * `/admin/spawned-agent-outcomes` for each id so auto-graduation's
   * pass-rate reflects build/test reality, not just review verdict.
   */
  spawnedAgentParticipants?: readonly string[];
}

export interface RagInjectionTelemetry {
  /** Local-memory answer-keys (user .conclave/ + bundled solo-cto seeds). */
  answerKeysLocal: number;
  /** Promoted seeds fetched from /seeds/promoted/:domain (Sprint C). */
  answerKeysPromoted: number;
  /** External curated references fetched from /references/:domain (Phase 4). */
  answerKeysExternal: number;
  /** OSS PR patterns fetched from /seeds/oss-patterns/:domain (Sprint E2). */
  answerKeysOssPatterns?: number;
  /** Spec-update entries from /seeds/spec-updates/:domain (Sprint E3). */
  answerKeysSpecUpdates?: number;
  /** External-intel entries from /seeds/external-intel/:domain (Sprint E7 —
   *  CVE advisory + MCP registry + shadcn blocks + awesome-lists). */
  answerKeysExternalIntel?: number;
  /** Local-memory failure-catalog entries. */
  failureCatalogLocal: number;
  /** Promoted seeds (failure kind). */
  failureCatalogPromoted: number;
  /** External curated references (failure kind). */
  failureCatalogExternal: number;
  /** OSS PR patterns (failure kind). */
  failureCatalogOssPatterns?: number;
  /** Spec-update entries (failure kind). */
  failureCatalogSpecUpdates?: number;
  /** External-intel (failure kind — CVE rows). */
  failureCatalogExternalIntel?: number;
}

export interface ReviewJsonOutputAgent {
  id: string;
  verdict: "approve" | "rework" | "reject";
  blockers: readonly Blocker[];
  summary: string;
}

export interface ReviewJsonOutput {
  verdict: "approve" | "rework" | "reject";
  domain: "code" | "design" | "mixed";
  tiers: {
    tier1Count: number;
    tier1Verdict: "approve" | "rework" | "reject" | "";
    tier2Count: number;
    tier2Verdict: "approve" | "rework" | "reject" | "";
  };
  agents: ReviewJsonOutputAgent[];
  metrics: {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
    cacheHitRate: number;
    /** v0.16.11 — Sprint D RAG-injection telemetry. */
    rag?: RagInjectionTelemetry;
  };
  episodicId: string;
  sha: string;
  repo: string;
  prNumber?: number;
  plainSummary?: PlainSummary;
  /** v0.17 — Sprint E5: kebab agent_ids of spawned-agent participants. Absent when none. */
  spawnedAgentParticipants?: readonly string[];
}

/**
 * Build the structured JSON payload. Pure function — accepts the same
 * shape `renderReview` sees plus the persisted episodic id so downstream
 * tools can call `conclave record-outcome --id <episodicId>`.
 *
 * When TieredCouncil was used, the tiers block carries actual participant
 * counts and per-tier verdicts. For flat Council runs, tier1Count = agent
 * count and tier1Verdict = councilVerdict (with tier2 zero/empty).
 */
export function buildReviewJson(input: ReviewJsonInput): ReviewJsonOutput {
  const agents: ReviewJsonOutputAgent[] = input.results.map((r) => ({
    id: r.agent,
    verdict: r.verdict,
    blockers: r.blockers,
    summary: r.summary,
  }));

  const tiers = input.tier
    ? {
        tier1Count: input.tier.tier1Ids.length,
        tier1Verdict: input.tier.tier1Verdict,
        tier2Count: input.tier.tier2Ids.length,
        tier2Verdict: (input.tier.tier2Verdict ?? "") as
          | "approve"
          | "rework"
          | "reject"
          | "",
      }
    : {
        tier1Count: input.results.length,
        tier1Verdict: input.councilVerdict,
        tier2Count: 0,
        tier2Verdict: "" as const,
      };

  const metrics: ReviewJsonOutput["metrics"] = {
    calls: input.metrics.callCount,
    tokensIn: input.metrics.totalInputTokens,
    tokensOut: input.metrics.totalOutputTokens,
    costUsd: input.metrics.totalCostUsd,
    latencyMs: input.metrics.totalLatencyMs,
    cacheHitRate: input.metrics.cacheHitRate,
  };
  if (input.ragInjection) {
    metrics.rag = input.ragInjection;
  }

  const out: ReviewJsonOutput = {
    verdict: input.councilVerdict,
    domain: input.domain,
    tiers,
    agents,
    metrics,
    episodicId: input.episodicId,
    sha: input.sha,
    repo: input.repo,
  };
  if (input.pullNumber !== undefined && input.pullNumber > 0) {
    out.prNumber = input.pullNumber;
  }
  if (input.plainSummary) {
    out.plainSummary = input.plainSummary;
  }
  if (input.spawnedAgentParticipants && input.spawnedAgentParticipants.length > 0) {
    out.spawnedAgentParticipants = input.spawnedAgentParticipants;
  }
  return out;
}

/**
 * Serialize the payload for stdout. Standalone so callers can inject
 * a different JSON.stringify replacer / indent in tests.
 *
 * Always terminates with "\n" — downstream parsers can rely on
 * line-oriented framing (e.g. `process.stdout` piped through `head -1`
 * in a bash script still returns the full JSON).
 */
export function serializeReviewJson(output: ReviewJsonOutput): string {
  return JSON.stringify(output) + "\n";
}

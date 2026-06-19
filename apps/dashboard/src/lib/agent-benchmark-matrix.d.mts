// Type declarations for agent-benchmark-matrix.mjs (Stage 69).
import type { AgentCandidate, BenchmarkCandidateItemOutcome } from "./agent-benchmark.mjs";

export type MatrixStatus = "passed" | "failed" | "inconclusive" | "needs_decision" | "missing";

export type BenchmarkItemMatrixRow = {
  itemId: string;
  title: string;
  statusesByCandidate: Record<string, MatrixStatus>;
  evidenceByCandidate?: Record<string, string>;
  hasDisagreement: boolean;
  bestStatus?: MatrixStatus;
  worstStatus?: MatrixStatus;
};

export type BenchmarkMatrix = {
  available: boolean;
  rows: BenchmarkItemMatrixRow[];
  itemsCompared: number;
  disagreementCount: number;
};

export function buildBenchmarkMatrix(input: {
  candidates: AgentCandidate[];
  itemOutcomesByCandidate?: Record<string, BenchmarkCandidateItemOutcome[]>;
}): BenchmarkMatrix;

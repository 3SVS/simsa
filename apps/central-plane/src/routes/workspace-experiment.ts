/**
 * workspace-experiment.ts — Stage 72
 *
 * Persisted Manual Multi-Agent Experiments. Saves an experiment plan and tracks
 * each candidate's manually-linked PR number / review run / benchmark. No agent
 * execution. Ownership enforced server-side; linked review runs and benchmarks
 * must belong to the same project AND userKey.
 *
 * POST   /workspace/projects/:id/agent-experiments
 * GET    /workspace/projects/:id/agent-experiments
 * GET    /workspace/projects/:id/agent-experiments/:experimentId
 * PATCH  /workspace/projects/:id/agent-experiments/:experimentId/candidates/:candidateId
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { getReviewRunById } from "../workspace/pr-review-db.js";
import { getAgentBenchmarkById, insertAgentBenchmark } from "../workspace/agent-benchmark-db.js";
import {
  buildBenchmarkResult,
  computeAcceptanceSetAlignment,
} from "../workspace/agent-benchmark.js";
import type {
  AgentCandidate,
  CandidateMode,
  CandidateSource,
  ReviewSummaryCounts,
  ReviewItemInput,
  AgentBenchmarkResult,
} from "../workspace/agent-benchmark.js";
import { computeOutcomeScorecard } from "../workspace/experiment-outcome-scorecard.js";
import {
  insertExperiment,
  listExperiments,
  getExperimentById,
  listExperimentCandidates,
  getCandidateById,
  updateCandidateLink,
  updateExperimentStatus,
  updateCandidateOutcome,
  updateExperimentDecision,
} from "../workspace/agent-experiment-db.js";
import {
  buildEvolutionActionPack,
  buildEvolutionActionPackText,
  DEFAULT_EVOLUTION_STRINGS,
} from "../workspace/evolution-action-pack.js";
import {
  insertEvolutionActionPack,
  listEvolutionActionPacks,
  getEvolutionActionPackById,
  updateEvolutionActionPackFollowup,
  FOLLOWUP_STATUSES,
} from "../workspace/evolution-action-pack-db.js";
import type { FollowupStatus } from "../workspace/evolution-action-pack-db.js";
import {
  buildImpactComparison,
  snapshotFromBenchmark,
  snapshotFromReviewRun,
} from "../workspace/evolution-impact.js";
import type { EvolutionImpactSnapshot } from "../workspace/evolution-impact.js";
import { buildEvolutionImpactSummary } from "../workspace/evolution-impact-summary.js";

const DECISION_STATUSES = ["undecided", "selected", "needs_fix", "no_clear_winner"];
const CANDIDATE_OUTCOMES = ["selected", "rejected", "needs_fix", "undecided"];
const NOTE_MAX = 1000;

/** Parse a review run's stored summary counts. */
function parseSummaryCounts(resultJson: string | undefined): ReviewSummaryCounts {
  if (!resultJson) return {};
  try {
    return (JSON.parse(resultJson) as { summary?: ReviewSummaryCounts }).summary ?? {};
  } catch {
    return {};
  }
}

/** Parse a review run's stored per-item results. */
function parseResultItems(resultJson: string | undefined): ReviewItemInput[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { results?: unknown };
    return Array.isArray(parsed.results) ? (parsed.results as ReviewItemInput[]) : [];
  } catch {
    return [];
  }
}

const TEMPLATE_IDS = ["single_agent_baseline", "multi_agent_split", "builder_reviewer"];
const MODES = ["single_agent", "multi_agent", "reviewer_agent", "hybrid"];
const ROLES = ["builder", "reviewer", "fixer", "integrator"];
const AGENTS = ["claude_code", "codex", "cursor", "manual", "other"];

type CandidateInput = {
  id?: unknown;
  label?: unknown;
  mode?: unknown;
  role?: unknown;
  suggestedAgent?: unknown;
};

/** Candidate status from its current links (no separate automation). */
function candidateStatus(links: { pullRequestNumber?: number; reviewRunId?: string; benchmarkId?: string }): string {
  if (links.benchmarkId) return "benchmarked";
  if (links.reviewRunId) return "reviewed";
  if (typeof links.pullRequestNumber === "number") return "pr_linked";
  return "planned";
}

/**
 * Stage 79 + Stage 80 shared helper. Resolves the before/after snapshots for a
 * saved action pack and runs them through the canonical impact comparison. Used
 * by the per-pack GET impact endpoint AND by the per-experiment aggregator —
 * the verdict rules MUST stay deterministic and identical across both surfaces.
 */
async function loadImpactForActionPack(
  env: Env,
  row: import("../workspace/evolution-action-pack-db.js").DbEvolutionActionPack,
  opts: {
    projectId: string;
    experimentId: string;
    userKey: string;
    /** Pre-resolved fallback benchmark id (typically the experiment's first
     *  linked benchmark) so callers can hoist this lookup when iterating. */
    experimentLinkedBenchmarkId?: string;
  },
): Promise<import("../workspace/evolution-impact.js").EvolutionImpactComparison> {
  const limitations: string[] = [];

  // Recover the pack's saved target candidate (Stage 76 metadata in pack_json).
  let packTargetCandidateId: string | undefined;
  try {
    const pack = JSON.parse(row.packJson) as { targetCandidateId?: string };
    packTargetCandidateId = pack.targetCandidateId;
  } catch {
    limitations.push("pack_json_unreadable");
  }

  // ── BEFORE: pack.benchmarkId column (Stage 77) → experiment fallback ──
  let before: EvolutionImpactSnapshot | null = null;
  const beforeBenchmarkId = row.benchmarkId ?? opts.experimentLinkedBenchmarkId;
  if (beforeBenchmarkId) {
    const benchRow = await getAgentBenchmarkById(env, beforeBenchmarkId).catch(() => null);
    if (benchRow && benchRow.projectId === opts.projectId && benchRow.userKey === opts.userKey) {
      try {
        const benchmark = JSON.parse(benchRow.resultJson) as AgentBenchmarkResult;
        before = snapshotFromBenchmark(benchmark, {
          sourceId: beforeBenchmarkId,
          selectedCandidateId: row.selectedCandidateId,
          packTargetCandidateId,
        });
      } catch {
        limitations.push("before_benchmark_unreadable");
      }
    } else if (benchRow) {
      limitations.push("before_benchmark_other_owner");
    }
  }

  // ── AFTER: followup_benchmark_id → followup_review_run_id fallback ──
  let after: EvolutionImpactSnapshot | null = null;
  if (row.followup.benchmarkId) {
    const benchRow = await getAgentBenchmarkById(env, row.followup.benchmarkId).catch(() => null);
    if (benchRow && benchRow.projectId === opts.projectId && benchRow.userKey === opts.userKey) {
      try {
        const benchmark = JSON.parse(benchRow.resultJson) as AgentBenchmarkResult;
        after = snapshotFromBenchmark(benchmark, {
          sourceId: row.followup.benchmarkId,
          selectedCandidateId: row.selectedCandidateId,
          packTargetCandidateId,
        });
      } catch {
        limitations.push("after_benchmark_unreadable");
      }
    } else if (benchRow) {
      limitations.push("after_benchmark_other_owner");
    }
  }
  if (!after && row.followup.reviewRunId) {
    const run = await getReviewRunById(env, row.followup.reviewRunId).catch(() => null);
    if (run && run.projectId === opts.projectId && run.userKey === opts.userKey) {
      after = snapshotFromReviewRun(run.resultJson, { sourceId: row.followup.reviewRunId });
      if (!after) limitations.push("after_review_run_unreadable");
    } else if (run) {
      limitations.push("after_review_run_other_owner");
    }
  }

  return buildImpactComparison({
    actionPackId: row.id,
    experimentId: row.experimentId,
    projectId: row.projectId,
    recommendedAction: row.recommendedAction,
    before,
    after,
    limitations,
  });
}

export function createWorkspaceExperimentRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── POST create ────────────────────────────────────────────────────────────
  app.post("/workspace/projects/:id/agent-experiments", async (c) => {
    const projectId = c.req.param("id");

    let body: { userKey?: string; title?: string; templateId?: string; candidates?: CandidateInput[]; plan?: { candidates?: CandidateInput[] } };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return c.json({ ok: false, error: "title_required" }, 400);

    const templateId = typeof body.templateId === "string" ? body.templateId : "";
    if (!TEMPLATE_IDS.includes(templateId)) return c.json({ ok: false, error: "invalid_template" }, 400);

    const rawCandidates = Array.isArray(body.candidates)
      ? body.candidates
      : Array.isArray(body.plan?.candidates)
        ? body.plan.candidates
        : [];
    if (rawCandidates.length < 1 || rawCandidates.length > 8) {
      return c.json({ ok: false, error: "candidate_count_invalid" }, 400);
    }

    const candidates: Array<{ candidateId: string; label: string; mode: string; role: string; suggestedAgent: string }> = [];
    const seen = new Set<string>();
    for (const rc of rawCandidates) {
      const candidateId = typeof rc.id === "string" ? rc.id : "";
      const label = typeof rc.label === "string" ? rc.label.trim() : "";
      const mode = typeof rc.mode === "string" ? rc.mode : "";
      const role = typeof rc.role === "string" ? rc.role : "";
      const suggestedAgent = typeof rc.suggestedAgent === "string" ? rc.suggestedAgent : "";
      if (!candidateId || !label) return c.json({ ok: false, error: "invalid_candidate" }, 400);
      if (!MODES.includes(mode) || !ROLES.includes(role) || !AGENTS.includes(suggestedAgent)) {
        return c.json({ ok: false, error: "invalid_candidate" }, 400);
      }
      if (seen.has(candidateId)) return c.json({ ok: false, error: "duplicate_candidate_ids" }, 400);
      seen.add(candidateId);
      candidates.push({ candidateId, label, mode, role, suggestedAgent });
    }

    try {
      const planJson = JSON.stringify({ templateId, candidates });
      const saved = await insertExperiment(c.env, { projectId, userKey, title, templateId, planJson, candidates });
      return c.json(
        {
          ok: true,
          experiment: {
            id: saved.experiment.id,
            projectId,
            title: saved.experiment.title,
            templateId: saved.experiment.templateId,
            status: saved.experiment.status,
            createdAt: saved.experiment.createdAt,
            candidates: saved.candidates,
          },
        },
        201,
      );
    } catch (err) {
      console.error("[workspace/agent-experiments POST] save failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
  });

  // ── GET list ───────────────────────────────────────────────────────────────
  app.get("/workspace/projects/:id/agent-experiments", async (c) => {
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    try {
      const experiments = await listExperiments(c.env, projectId, { limit: 50 });
      return c.json({ ok: true, experiments });
    } catch (err) {
      console.error("[workspace/agent-experiments GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── GET detail ─────────────────────────────────────────────────────────────
  app.get("/workspace/projects/:id/agent-experiments/:experimentId", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);
      const candidates = await listExperimentCandidates(c.env, experimentId);
      return c.json({
        ok: true,
        experiment: {
          id: exp.id,
          projectId: exp.projectId,
          title: exp.title,
          templateId: exp.templateId,
          status: exp.status,
          createdAt: exp.createdAt,
          decisionStatus: exp.decisionStatus,
          selectedCandidateId: exp.selectedCandidateId,
          decisionNote: exp.decisionNote,
          decidedAt: exp.decidedAt,
          candidates,
        },
      });
    } catch (err) {
      console.error("[workspace/agent-experiments detail GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── PATCH candidate link ─────────────────────────────────────────────────────
  app.patch("/workspace/projects/:id/agent-experiments/:experimentId/candidates/:candidateId", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");
    const candidateRowId = c.req.param("candidateId");

    let b: { userKey?: string; pullRequestNumber?: unknown; reviewRunId?: unknown; benchmarkId?: unknown };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof b.userKey === "string" ? b.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      const cand = await getCandidateById(c.env, candidateRowId);
      if (!cand || cand.experimentId !== experimentId) return c.json({ ok: false, error: "candidate_not_found" }, 404);

      // Merge: a provided value overrides; absent keeps existing.
      let pullRequestNumber = cand.pullRequestNumber;
      if (b.pullRequestNumber !== undefined && b.pullRequestNumber !== null) {
        if (typeof b.pullRequestNumber !== "number" || !Number.isInteger(b.pullRequestNumber) || b.pullRequestNumber < 1) {
          return c.json({ ok: false, error: "invalid_pr_number" }, 400);
        }
        pullRequestNumber = b.pullRequestNumber;
      }

      let reviewRunId = cand.reviewRunId;
      if (typeof b.reviewRunId === "string" && b.reviewRunId) {
        const run = await getReviewRunById(c.env, b.reviewRunId).catch(() => null);
        if (!run) return c.json({ ok: false, error: "review_run_not_found" }, 400);
        if (run.projectId !== projectId || run.userKey !== userKey) {
          return c.json({ ok: false, error: "review_run_mismatch" }, 400);
        }
        reviewRunId = b.reviewRunId;
      }

      let benchmarkId = cand.benchmarkId;
      if (typeof b.benchmarkId === "string" && b.benchmarkId) {
        const bench = await getAgentBenchmarkById(c.env, b.benchmarkId).catch(() => null);
        if (!bench) return c.json({ ok: false, error: "benchmark_not_found" }, 400);
        if (bench.projectId !== projectId || bench.userKey !== userKey) {
          return c.json({ ok: false, error: "benchmark_mismatch" }, 400);
        }
        benchmarkId = b.benchmarkId;
      }

      const status = candidateStatus({ pullRequestNumber, reviewRunId, benchmarkId });
      await updateCandidateLink(c.env, candidateRowId, { pullRequestNumber, reviewRunId, benchmarkId, status });

      return c.json({
        ok: true,
        candidate: { ...cand, pullRequestNumber, reviewRunId, benchmarkId, status },
      });
    } catch (err) {
      console.error("[workspace/agent-experiments PATCH candidate] failed:", err);
      return c.json({ ok: false, error: "update_failed" }, 500);
    }
  });

  // ── POST create benchmark from experiment (Stage 73 handoff) ─────────────────
  // Reuses the Stage 65 benchmark calculation; does not duplicate it.
  app.post("/workspace/projects/:id/agent-experiments/:experimentId/benchmark", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");

    let b: { userKey?: string };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof b.userKey === "string" ? b.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      const allCandidates = await listExperimentCandidates(c.env, experimentId);
      const linked = allCandidates.filter((cc) => cc.reviewRunId);
      if (linked.length < 2) return c.json({ ok: false, error: "not_enough_linked_runs" }, 400);

      const candidates: AgentCandidate[] = [];
      const countsByCandidate: Record<string, ReviewSummaryCounts> = {};
      const itemResultsByCandidate: Record<string, ReviewItemInput[]> = {};
      const selectedItemIdsByCandidate: Record<string, string[]> = {};

      for (const cc of linked) {
        const run = await getReviewRunById(c.env, cc.reviewRunId!).catch(() => null);
        if (!run) return c.json({ ok: false, error: "review_run_not_found" }, 400);
        if (run.projectId !== projectId || run.userKey !== userKey) {
          return c.json({ ok: false, error: "review_run_mismatch" }, 400);
        }
        candidates.push({
          id: cc.candidateId,
          label: cc.label,
          mode: cc.mode as CandidateMode,
          source: cc.suggestedAgent as CandidateSource,
          reviewRunId: cc.reviewRunId,
          pullRequestNumber: cc.pullRequestNumber ?? run.prNumber,
        });
        countsByCandidate[cc.candidateId] = parseSummaryCounts(run.resultJson);
        selectedItemIdsByCandidate[cc.candidateId] = run.selectedItemIds;
        itemResultsByCandidate[cc.candidateId] = parseResultItems(run.resultJson);
      }

      const result = buildBenchmarkResult({ projectId, candidates, countsByCandidate, itemResultsByCandidate });
      result.acceptanceSetAlignment = computeAcceptanceSetAlignment(candidates, selectedItemIdsByCandidate);
      const winnerCandidateId = result.recommendation?.winnerCandidateId;
      const noClearWinner = result.recommendation !== undefined && result.recommendation.winnerCandidateId === undefined;

      const saved = await insertAgentBenchmark(c.env, {
        projectId,
        userKey,
        title: `${exp.title} — benchmark`,
        candidateCount: candidates.length,
        winnerCandidateId,
        noClearWinner,
        resultJson: JSON.stringify(result),
        sourceExperimentId: experimentId,
      });

      for (const cc of linked) {
        await updateCandidateLink(c.env, cc.id, {
          pullRequestNumber: cc.pullRequestNumber,
          reviewRunId: cc.reviewRunId,
          benchmarkId: saved.id,
          status: "benchmarked",
        });
      }
      await updateExperimentStatus(c.env, experimentId, "benchmarked");

      const candidatesAfter = await listExperimentCandidates(c.env, experimentId);
      return c.json(
        {
          ok: true,
          benchmark: {
            id: saved.id,
            projectId,
            title: saved.title,
            candidateCount: saved.candidateCount,
            winnerCandidateId,
            noClearWinner,
            sourceExperimentId: experimentId,
            result,
          },
          experiment: {
            id: exp.id,
            projectId,
            title: exp.title,
            templateId: exp.templateId,
            status: "benchmarked",
            createdAt: exp.createdAt,
            candidates: candidatesAfter,
          },
        },
        201,
      );
    } catch (err) {
      console.error("[workspace/agent-experiments benchmark POST] failed:", err);
      return c.json({ ok: false, error: "benchmark_from_experiment_failed" }, 500);
    }
  });

  // ── POST decision (Stage 74) — record candidate outcomes + experiment summary ─
  app.post("/workspace/projects/:id/agent-experiments/:experimentId/decision", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");

    let b: {
      userKey?: string;
      selectedCandidateId?: unknown;
      candidateOutcomes?: Array<{ candidateId?: unknown; outcome?: unknown; note?: unknown }>;
      decisionStatus?: unknown;
      decisionNote?: unknown;
    };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof b.userKey === "string" ? b.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const decisionStatus = typeof b.decisionStatus === "string" ? b.decisionStatus : "";
    if (!DECISION_STATUSES.includes(decisionStatus)) return c.json({ ok: false, error: "invalid_decision_status" }, 400);
    const decisionNote = typeof b.decisionNote === "string" ? b.decisionNote : undefined;
    if (decisionNote && decisionNote.length > NOTE_MAX) return c.json({ ok: false, error: "note_too_long" }, 400);
    const selectedCandidateId = typeof b.selectedCandidateId === "string" ? b.selectedCandidateId : undefined;
    const rawOutcomes = Array.isArray(b.candidateOutcomes) ? b.candidateOutcomes : [];

    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      const candidates = await listExperimentCandidates(c.env, experimentId);
      const byCandidateId = new Map(candidates.map((cc) => [cc.candidateId, cc]));

      const parsed: Array<{ row: (typeof candidates)[number]; outcome: string; note?: string }> = [];
      let selectedCount = 0;
      for (const o of rawOutcomes) {
        const cid = typeof o.candidateId === "string" ? o.candidateId : "";
        const outcome = typeof o.outcome === "string" ? o.outcome : "";
        const note = typeof o.note === "string" ? o.note : undefined;
        const row = byCandidateId.get(cid);
        if (!row) return c.json({ ok: false, error: "unknown_candidate" }, 400);
        if (!CANDIDATE_OUTCOMES.includes(outcome)) return c.json({ ok: false, error: "invalid_outcome" }, 400);
        if (note && note.length > NOTE_MAX) return c.json({ ok: false, error: "note_too_long" }, 400);
        if (outcome === "selected") selectedCount += 1;
        parsed.push({ row, outcome, note });
      }
      if (selectedCount > 1) return c.json({ ok: false, error: "multiple_selected" }, 400);
      if (selectedCandidateId) {
        const sel = parsed.find((p) => p.row.candidateId === selectedCandidateId);
        if (!sel || sel.outcome !== "selected") return c.json({ ok: false, error: "selected_mismatch" }, 400);
      }

      const now = new Date().toISOString();
      for (const p of parsed) {
        const status = p.outcome === "undecided" ? p.row.status : p.outcome;
        await updateCandidateOutcome(c.env, p.row.id, { outcome: p.outcome, outcomeNote: p.note, status, decidedAt: now });
      }

      const expStatus =
        decisionStatus === "selected" ? "completed" : decisionStatus === "undecided" ? exp.status : "decision_made";
      await updateExperimentDecision(c.env, experimentId, {
        decisionStatus,
        selectedCandidateId,
        decisionNote,
        status: expStatus,
        decidedAt: now,
      });

      const candidatesAfter = await listExperimentCandidates(c.env, experimentId);
      return c.json({
        ok: true,
        experiment: {
          id: exp.id,
          projectId,
          title: exp.title,
          templateId: exp.templateId,
          status: expStatus,
          createdAt: exp.createdAt,
          decisionStatus,
          selectedCandidateId,
          decisionNote,
          decidedAt: now,
          candidates: candidatesAfter,
        },
      });
    } catch (err) {
      console.error("[workspace/agent-experiments decision POST] failed:", err);
      return c.json({ ok: false, error: "decision_failed" }, 500);
    }
  });

  // ── GET outcome-scorecard (Stage 75) — computed on demand, no persistence ─────
  app.get("/workspace/projects/:id/agent-experiments/:experimentId/outcome-scorecard", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      const candidates = await listExperimentCandidates(c.env, experimentId);
      const benchmarkId = candidates.find((cc) => cc.benchmarkId)?.benchmarkId;

      let benchmark: AgentBenchmarkResult | null = null;
      if (benchmarkId) {
        const row = await getAgentBenchmarkById(c.env, benchmarkId);
        if (row && row.projectId === projectId && row.userKey === userKey) {
          try {
            benchmark = JSON.parse(row.resultJson) as AgentBenchmarkResult;
          } catch {
            benchmark = null;
          }
        }
      }

      const scorecard = computeOutcomeScorecard({
        experimentId,
        projectId,
        decisionStatus: exp.decisionStatus,
        selectedCandidateId: exp.selectedCandidateId,
        benchmark,
      });

      return c.json({ ok: true, scorecard });
    } catch (err) {
      console.error("[workspace/agent-experiments outcome-scorecard GET] failed:", err);
      return c.json({ ok: false, error: "scorecard_failed" }, 500);
    }
  });

  // ── Stage 77: evolution action packs ────────────────────────────────────────
  // Loads scorecard + linked benchmark using Stage 75 logic, builds the pack
  // server-side with the canonical helper, and persists the snapshot. The
  // client never supplies pack content.
  app.post("/workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");

    let b: { userKey?: string };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof b.userKey === "string" ? b.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      const candidates = await listExperimentCandidates(c.env, experimentId);
      const benchmarkId = candidates.find((cc) => cc.benchmarkId)?.benchmarkId;

      let benchmark: AgentBenchmarkResult | null = null;
      if (benchmarkId) {
        const row = await getAgentBenchmarkById(c.env, benchmarkId);
        if (row && row.projectId === projectId && row.userKey === userKey) {
          try {
            benchmark = JSON.parse(row.resultJson) as AgentBenchmarkResult;
          } catch {
            benchmark = null;
          }
        }
      }

      const scorecard = computeOutcomeScorecard({
        experimentId,
        projectId,
        decisionStatus: exp.decisionStatus,
        selectedCandidateId: exp.selectedCandidateId,
        benchmark,
      });

      const pack = buildEvolutionActionPack(
        { projectId, experiment: { id: exp.id, title: exp.title }, scorecard, benchmark },
        DEFAULT_EVOLUTION_STRINGS,
      );
      const text = buildEvolutionActionPackText(pack, DEFAULT_EVOLUTION_STRINGS, {
        experimentTitle: exp.title,
      });

      const saved = await insertEvolutionActionPack(c.env, {
        projectId,
        userKey,
        experimentId,
        benchmarkId: benchmarkId ?? undefined,
        selectedCandidateId: exp.selectedCandidateId ?? undefined,
        recommendedAction: pack.recommendedAction,
        title: pack.title,
        packJson: JSON.stringify(pack),
      });

      return c.json(
        {
          ok: true,
          actionPack: {
            id: saved.id,
            experimentId: saved.experimentId,
            recommendedAction: saved.recommendedAction,
            title: saved.title,
            createdAt: saved.createdAt,
            pack,
            text,
            followup: saved.followup,
          },
        },
        201,
      );
    } catch (err) {
      console.error("[workspace/agent-experiments evolution-action-packs POST] failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
  });

  app.get("/workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs", async (c) => {
    const projectId = c.req.param("id");
    const experimentId = c.req.param("experimentId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    try {
      const exp = await getExperimentById(c.env, experimentId);
      if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);
      const actionPacks = await listEvolutionActionPacks(c.env, { projectId, experimentId });
      return c.json({ ok: true, actionPacks });
    } catch (err) {
      console.error("[workspace/agent-experiments evolution-action-packs GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  app.get(
    "/workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs/:actionPackId",
    async (c) => {
      const projectId = c.req.param("id");
      const experimentId = c.req.param("experimentId");
      const actionPackId = c.req.param("actionPackId");
      const userKey = c.req.query("userKey") ?? "";
      if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
      try {
        const row = await getEvolutionActionPackById(c.env, actionPackId);
        if (!row || row.projectId !== projectId || row.experimentId !== experimentId) {
          return c.json({ ok: false, error: "not_found" }, 404);
        }
        if (row.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);
        let pack;
        try {
          pack = JSON.parse(row.packJson);
        } catch {
          return c.json({ ok: false, error: "corrupt_pack" }, 500);
        }
        // Pull experiment title so the rebuilt text matches what POST returned.
        const exp = await getExperimentById(c.env, experimentId);
        const text = buildEvolutionActionPackText(pack, DEFAULT_EVOLUTION_STRINGS, {
          experimentTitle: exp?.title,
        });
        return c.json({
          ok: true,
          actionPack: {
            id: row.id,
            experimentId: row.experimentId,
            recommendedAction: row.recommendedAction,
            title: row.title,
            createdAt: row.createdAt,
            pack,
            text,
            followup: row.followup,
          },
        });
      } catch (err) {
        console.error("[workspace/agent-experiments evolution-action-packs detail GET] failed:", err);
        return c.json({ ok: false, error: "query_failed" }, 500);
      }
    },
  );

  // ── Stage 78: action pack follow-up tracking ────────────────────────────────
  // Records what happened after the user used a saved pack — manual entry only.
  // No agent auto-run, no LLM judgement, no benchmark auto-create.
  app.patch(
    "/workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs/:actionPackId/followup",
    async (c) => {
      const projectId = c.req.param("id");
      const experimentId = c.req.param("experimentId");
      const actionPackId = c.req.param("actionPackId");

      let b: {
        userKey?: string;
        status?: unknown;
        pullRequestNumber?: unknown;
        reviewRunId?: unknown;
        benchmarkId?: unknown;
        note?: unknown;
      };
      try {
        b = await c.req.json();
      } catch {
        return c.json({ ok: false, error: "invalid_json" }, 400);
      }
      const userKey = typeof b.userKey === "string" ? b.userKey : "";
      if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

      const status = typeof b.status === "string" ? b.status : "";
      if (!(FOLLOWUP_STATUSES as string[]).includes(status)) {
        return c.json({ ok: false, error: "invalid_status" }, 400);
      }

      try {
        const row = await getEvolutionActionPackById(c.env, actionPackId);
        if (!row || row.projectId !== projectId || row.experimentId !== experimentId) {
          return c.json({ ok: false, error: "not_found" }, 404);
        }
        if (row.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

        // PR number — keep existing if absent in body, validate if present.
        let pullRequestNumber = row.followup.pullRequestNumber;
        if (b.pullRequestNumber !== undefined && b.pullRequestNumber !== null) {
          if (
            typeof b.pullRequestNumber !== "number" ||
            !Number.isInteger(b.pullRequestNumber) ||
            b.pullRequestNumber < 1
          ) {
            return c.json({ ok: false, error: "invalid_pr_number" }, 400);
          }
          pullRequestNumber = b.pullRequestNumber;
        }

        // Review run — validate ownership before linking.
        let reviewRunId = row.followup.reviewRunId;
        if (typeof b.reviewRunId === "string" && b.reviewRunId) {
          const run = await getReviewRunById(c.env, b.reviewRunId).catch(() => null);
          if (!run) return c.json({ ok: false, error: "review_run_not_found" }, 400);
          if (run.projectId !== projectId || run.userKey !== userKey) {
            return c.json({ ok: false, error: "review_run_mismatch" }, 400);
          }
          reviewRunId = b.reviewRunId;
        }

        // Benchmark — validate ownership before linking.
        let benchmarkId = row.followup.benchmarkId;
        if (typeof b.benchmarkId === "string" && b.benchmarkId) {
          const bench = await getAgentBenchmarkById(c.env, b.benchmarkId).catch(() => null);
          if (!bench) return c.json({ ok: false, error: "benchmark_not_found" }, 400);
          if (bench.projectId !== projectId || bench.userKey !== userKey) {
            return c.json({ ok: false, error: "benchmark_mismatch" }, 400);
          }
          benchmarkId = b.benchmarkId;
        }

        let note = row.followup.note;
        if (b.note !== undefined && b.note !== null) {
          if (typeof b.note !== "string") return c.json({ ok: false, error: "invalid_note" }, 400);
          if (b.note.length > NOTE_MAX) return c.json({ ok: false, error: "note_too_long" }, 400);
          note = b.note;
        }

        // followedAt: first time the user moves out of not_started, stamp it.
        const now = new Date().toISOString();
        const followedAt =
          status !== "not_started" && !row.followup.followedAt ? now : row.followup.followedAt;

        await updateEvolutionActionPackFollowup(c.env, actionPackId, {
          status: status as FollowupStatus,
          pullRequestNumber,
          reviewRunId,
          benchmarkId,
          note,
          followedAt,
          now,
        });

        let pack;
        try {
          pack = JSON.parse(row.packJson);
        } catch {
          return c.json({ ok: false, error: "corrupt_pack" }, 500);
        }
        const exp = await getExperimentById(c.env, experimentId);
        const text = buildEvolutionActionPackText(pack, DEFAULT_EVOLUTION_STRINGS, {
          experimentTitle: exp?.title,
        });

        return c.json({
          ok: true,
          actionPack: {
            id: row.id,
            experimentId: row.experimentId,
            recommendedAction: row.recommendedAction,
            title: row.title,
            createdAt: row.createdAt,
            pack,
            text,
            followup: {
              status: status as FollowupStatus,
              pullRequestNumber,
              reviewRunId,
              benchmarkId,
              note,
              followedAt,
            },
          },
        });
      } catch (err) {
        console.error("[workspace/agent-experiments evolution-action-packs followup PATCH] failed:", err);
        return c.json({ ok: false, error: "update_failed" }, 500);
      }
    },
  );

  // ── Stage 79: before/after evolution impact comparison ──────────────────────
  // On-demand only (no D1 persistence — formula keeps evolving). Compares the
  // action pack's source benchmark (selected/winner/basis candidate metrics)
  // against the Stage-78 follow-up benchmark or review run. Deterministic.
  app.get(
    "/workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs/:actionPackId/impact",
    async (c) => {
      const projectId = c.req.param("id");
      const experimentId = c.req.param("experimentId");
      const actionPackId = c.req.param("actionPackId");
      const userKey = c.req.query("userKey") ?? "";
      if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

      try {
        const row = await getEvolutionActionPackById(c.env, actionPackId);
        if (!row || row.projectId !== projectId || row.experimentId !== experimentId) {
          return c.json({ ok: false, error: "not_found" }, 404);
        }
        if (row.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

        const cands = await listExperimentCandidates(c.env, experimentId).catch(() => []);
        const experimentLinkedBenchmarkId = cands.find((cc) => cc.benchmarkId)?.benchmarkId;
        const impact = await loadImpactForActionPack(c.env, row, {
          projectId,
          experimentId,
          userKey,
          experimentLinkedBenchmarkId,
        });
        return c.json({ ok: true, impact });
      } catch (err) {
        console.error("[workspace/agent-experiments evolution-action-packs impact GET] failed:", err);
        return c.json({ ok: false, error: "impact_failed" }, 500);
      }
    },
  );

  // ── Stage 80: experiment-level Evolution Impact Summary ─────────────────────
  // Aggregates Stage 79 impact comparisons across every saved action pack for
  // an experiment. Deterministic, on-demand, no persistence — the verdict
  // formula will keep evolving as real evolution loops accumulate.
  app.get(
    "/workspace/projects/:id/agent-experiments/:experimentId/evolution-impact-summary",
    async (c) => {
      const projectId = c.req.param("id");
      const experimentId = c.req.param("experimentId");
      const userKey = c.req.query("userKey") ?? "";
      if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

      try {
        const exp = await getExperimentById(c.env, experimentId);
        if (!exp || exp.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
        if (exp.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

        const items = await listEvolutionActionPacks(c.env, { projectId, experimentId });
        // Hoist the fallback once instead of looking it up per pack.
        const cands = await listExperimentCandidates(c.env, experimentId).catch(() => []);
        const experimentLinkedBenchmarkId = cands.find((cc) => cc.benchmarkId)?.benchmarkId;

        const entries = [] as Array<{
          comparison: import("../workspace/evolution-impact.js").EvolutionImpactComparison;
          followed: boolean;
          recommendedAction: string;
        }>;

        for (const item of items) {
          const row = await getEvolutionActionPackById(c.env, item.id);
          // Defensive: skip rows that vanished mid-iteration or whose ownership
          // shifted (should not happen — packs are immutable in Stage 77/78).
          if (!row || row.projectId !== projectId || row.userKey !== userKey || row.experimentId !== experimentId) {
            continue;
          }
          const comparison = await loadImpactForActionPack(c.env, row, {
            projectId,
            experimentId,
            userKey,
            experimentLinkedBenchmarkId,
          });
          const followed =
            row.followup.status !== "not_started" ||
            row.followup.reviewRunId !== undefined ||
            row.followup.benchmarkId !== undefined ||
            row.followup.pullRequestNumber !== undefined;
          entries.push({ comparison, followed, recommendedAction: row.recommendedAction });
        }

        const summary = buildEvolutionImpactSummary({ projectId, experimentId, entries });
        return c.json({ ok: true, summary });
      } catch (err) {
        console.error("[workspace/agent-experiments evolution-impact-summary GET] failed:", err);
        return c.json({ ok: false, error: "summary_failed" }, 500);
      }
    },
  );

  return app;
}

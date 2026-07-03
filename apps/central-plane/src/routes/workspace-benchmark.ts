/**
 * workspace-benchmark.ts — Stage 65
 *
 * Persisted Multi-Agent Build Benchmarks. Compares EXISTING review runs as
 * candidates against acceptance results — no agent execution, no LLM judgement.
 *
 * POST /workspace/projects/:id/agent-benchmarks               — create + save
 * GET  /workspace/projects/:id/agent-benchmarks?userKey=...   — list (lightweight)
 * GET  /workspace/projects/:id/agent-benchmarks/:bid?userKey= — saved detail
 *
 * Ownership is enforced server-side: every candidate's reviewRun must belong to
 * this project AND this userKey, and saved benchmarks are only returned to the
 * userKey that created them.
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getReviewRunById } from "../workspace/pr-review-db.js";
import {
  buildBenchmarkResult,
  computeAcceptanceSetAlignment,
  CANDIDATE_MODES,
  CANDIDATE_SOURCES,
} from "../workspace/agent-benchmark.js";
import type {
  AgentCandidate,
  CandidateMode,
  CandidateSource,
  ReviewSummaryCounts,
  ReviewItemInput,
} from "../workspace/agent-benchmark.js";
import {
  insertAgentBenchmark,
  listAgentBenchmarks,
  getAgentBenchmarkById,
} from "../workspace/agent-benchmark-db.js";
import { getOwnedProject } from "../workspace/db.js";

type CandidateInput = {
  id?: unknown;
  label?: unknown;
  mode?: unknown;
  source?: unknown;
  reviewRunId?: unknown;
  notes?: unknown;
};

/** Parse a review run's stored summary counts. Missing/garbage → zeros. */
function parseSummaryCounts(resultJson: string | undefined): ReviewSummaryCounts {
  if (!resultJson) return {};
  try {
    const parsed = JSON.parse(resultJson) as { summary?: ReviewSummaryCounts };
    return parsed.summary ?? {};
  } catch {
    return {};
  }
}

/** Parse a review run's stored per-item results. Missing/garbage → []. */
function parseResultItems(resultJson: string | undefined): ReviewItemInput[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { results?: unknown };
    return Array.isArray(parsed.results) ? (parsed.results as ReviewItemInput[]) : [];
  } catch {
    return [];
  }
}

export function createWorkspaceBenchmarkRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // Stage 91: browser-facing CORS (preflight + headers on every response).
  app.use("*", corsMiddleware);

  // ── POST /workspace/projects/:id/agent-benchmarks ──────────────────────────
  app.post("/workspace/projects/:id/agent-benchmarks", async (c) => {
    const projectId = c.req.param("id");

    let body: { userKey?: string; title?: string; candidates?: CandidateInput[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (rawCandidates.length < 2 || rawCandidates.length > 5) {
      return c.json({ ok: false, error: "candidate_count_invalid" }, 400);
    }

    // Validate each candidate's shape; collect ids for uniqueness.
    const candidates: AgentCandidate[] = [];
    const seenIds = new Set<string>();
    for (const rc of rawCandidates) {
      const id = typeof rc.id === "string" ? rc.id : "";
      const label = typeof rc.label === "string" ? rc.label.trim() : "";
      const mode = rc.mode as CandidateMode;
      const source = rc.source as CandidateSource;
      const reviewRunId = typeof rc.reviewRunId === "string" ? rc.reviewRunId : "";

      if (!id || !label) return c.json({ ok: false, error: "invalid_candidate" }, 400);
      if (!CANDIDATE_MODES.includes(mode) || !CANDIDATE_SOURCES.includes(source)) {
        return c.json({ ok: false, error: "invalid_candidate" }, 400);
      }
      if (!reviewRunId) return c.json({ ok: false, error: "review_run_required" }, 400);
      if (seenIds.has(id)) return c.json({ ok: false, error: "duplicate_candidate_ids" }, 400);
      seenIds.add(id);

      candidates.push({
        id,
        label,
        mode,
        source,
        reviewRunId,
        notes: typeof rc.notes === "string" ? rc.notes : undefined,
      });
    }

    // Validate each reviewRun: exists, belongs to this project AND this userKey.
    const countsByCandidate: Record<string, ReviewSummaryCounts> = {};
    const selectedItemIdsByCandidate: Record<string, string[]> = {};
    const itemResultsByCandidate: Record<string, ReviewItemInput[]> = {};
    try {
      for (const cand of candidates) {
        const run = await getReviewRunById(c.env, cand.reviewRunId!).catch(() => null);
        if (!run) return c.json({ ok: false, error: "review_run_not_found" }, 400);
        if (run.projectId !== projectId) {
          return c.json({ ok: false, error: "review_run_project_mismatch" }, 400);
        }
        if (run.userKey !== userKey) {
          return c.json({ ok: false, error: "forbidden" }, 403);
        }
        countsByCandidate[cand.id] = parseSummaryCounts(run.resultJson);
        selectedItemIdsByCandidate[cand.id] = run.selectedItemIds;
        itemResultsByCandidate[cand.id] = parseResultItems(run.resultJson);
        cand.pullRequestNumber = run.prNumber;
      }
    } catch (err) {
      console.error("[workspace/agent-benchmarks POST] run validation failed:", err);
      return c.json({ ok: false, error: "run_validation_failed" }, 500);
    }

    // Deterministic comparison (canonical, server-side) + item-level evidence.
    const result = buildBenchmarkResult({ projectId, candidates, countsByCandidate, itemResultsByCandidate });
    result.acceptanceSetAlignment = computeAcceptanceSetAlignment(candidates, selectedItemIdsByCandidate);

    const winnerCandidateId = result.recommendation?.winnerCandidateId;
    const noClearWinner =
      result.recommendation !== undefined && result.recommendation.winnerCandidateId === undefined;

    try {
      const saved = await insertAgentBenchmark(c.env, {
        projectId,
        userKey,
        title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
        candidateCount: candidates.length,
        winnerCandidateId,
        noClearWinner,
        resultJson: JSON.stringify(result),
      });

      return c.json(
        {
          ok: true,
          benchmark: {
            id: saved.id,
            projectId,
            title: saved.title,
            createdAt: saved.createdAt,
            candidateCount: saved.candidateCount,
            winnerCandidateId: saved.winnerCandidateId,
            noClearWinner: saved.noClearWinner,
            result,
          },
        },
        201,
      );
    } catch (err) {
      console.error("[workspace/agent-benchmarks POST] save failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/agent-benchmarks ───────────────────────────
  app.get("/workspace/projects/:id/agent-benchmarks", async (c) => {
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    // Ownership: the list query is project-scoped (no user_key column in the
    // lightweight select), so gate on the project itself. 404 for missing OR
    // not-owned — no existence oracle.
    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) return c.json({ ok: false, error: "not_found" }, 404);

    try {
      const benchmarks = await listAgentBenchmarks(c.env, projectId, { limit: 50 });
      return c.json({ ok: true, benchmarks });
    } catch (err) {
      console.error("[workspace/agent-benchmarks GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/agent-benchmarks/:benchmarkId ──────────────
  app.get("/workspace/projects/:id/agent-benchmarks/:benchmarkId", async (c) => {
    const projectId = c.req.param("id");
    const benchmarkId = c.req.param("benchmarkId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const row = await getAgentBenchmarkById(c.env, benchmarkId);
      if (!row || row.projectId !== projectId) {
        return c.json({ ok: false, error: "not_found" }, 404);
      }
      if (row.userKey !== userKey) {
        return c.json({ ok: false, error: "forbidden" }, 403);
      }

      let result: unknown = null;
      try {
        result = JSON.parse(row.resultJson);
      } catch {
        result = null;
      }

      return c.json({
        ok: true,
        benchmark: {
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          createdAt: row.createdAt,
          candidateCount: row.candidateCount,
          winnerCandidateId: row.winnerCandidateId,
          noClearWinner: row.noClearWinner,
          sourceExperimentId: row.sourceExperimentId,
          result,
        },
      });
    } catch (err) {
      console.error("[workspace/agent-benchmarks detail GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  return app;
}

/**
 * workspace-repair-jobs.ts — Stage 268
 *
 * Repair loop backend: "[고치기]" on a failed Simsa visual check turns the
 * check's stored deterministic agent fix prompt (Stage 260B, `agent_prompt`
 * on the run) into a repair branch + draft PR on the user's connected GitHub
 * repo, executed inside the EXISTING ConclaveSandbox container as a new
 * `simsa_repair` job type (no third container).
 *
 *   POST /workspace/projects/:id/visual-checks/:runId/repair — queue + dispatch
 *   GET  /workspace/projects/:id/visual-checks/:runId/repair — latest job (polling)
 *   POST /internal/repair-running                            — container ack
 *   POST /internal/repair-done                               — container result
 *
 * SECURITY:
 *   - Ownership chain enforced twice: project → userKey AND run → project+userKey.
 *   - The user's OAuth token (AES-GCM encrypted at rest, CONCLAVE_TOKEN_KEK)
 *     is decrypted ONLY here, passed to the container in the job payload, and
 *     never persisted anywhere else or echoed in any response.
 *   - /internal/* endpoints require Bearer INTERNAL_CALLBACK_TOKEN (same gate
 *     as /internal/visual-check-* and /internal/job-done).
 *
 * HONEST BOUNDARIES (env-cause): when the run's evidence points at a
 * dead-backend/env-var root cause (ERR_NAME_NOT_RESOLVED / ENOTFOUND /
 * connection-refused), the repair still dispatches — fallback-style code
 * fixes are legitimate (golf-now PR #38 was exactly this) — but env_cause=1
 * is stored so the UI can warn "코드 수정만으로 완전히 해결되지 않을 수
 * 있어요".
 *
 * Fail-fast (Stage 263.1 semantics): when the SANDBOX binding / callback
 * token is absent or the container refuses the job, the row is created and
 * immediately marked failed with dispatched:false + note — nothing consumes
 * queued rows later, and a wedged queued row would block the 409 guard for
 * 30 min until the stuck sweep.
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getProject } from "../workspace/db.js";
import { getVisualCheckById, type DbVisualCheck } from "../workspace/visual-check-db.js";
import { getProjectRepo, getGitHubConnectionByUserKey } from "../workspace/github-db.js";
import { listProjectSources } from "../workspace/project-sources-db.js";
import { decryptToken } from "../crypto.js";
import {
  findActiveRepairJobForRun,
  getLatestRepairJobForRun,
  getRepairJobById,
  insertQueuedRepairJob,
  markRepairJobDone,
  markRepairJobFailed,
  markRepairJobRunning,
  type DbRepairJob,
} from "../workspace/repair-job-db.js";

const MAX_ERROR_CHARS = 500;

/**
 * Env-cause pre-check (pure, tested). True when the check's evidence
 * (agent_prompt + report_json snapshots the browser observations verbatim)
 * contains dead-backend / unresolvable-host patterns — the classic "the env
 * var points at a deleted backend" failure. DNS-level failures
 * (ERR_NAME_NOT_RESOLVED, ENOTFOUND, getaddrinfo) and connection-refused
 * (ERR_CONNECTION_REFUSED, ECONNREFUSED) both mean no code change alone can
 * revive the host.
 */
const ENV_CAUSE_PATTERN =
  /ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo|ERR_CONNECTION_REFUSED|ECONNREFUSED/i;

export function detectEnvCause(agentPrompt: string, reportJson: string): boolean {
  return ENV_CAUSE_PATTERN.test(`${agentPrompt ?? ""} ${reportJson ?? ""}`);
}

/** done + not-working + fix prompt present — the only repairable shape. */
export function isRunRepairable(run: Pick<DbVisualCheck, "status" | "works" | "agentPrompt">): boolean {
  return run.status === "done" && run.works !== true && typeof run.agentPrompt === "string" && run.agentPrompt.length > 0;
}

/**
 * Normalize a project_sources github_repo reference into "owner/repo".
 * Accepts bare "owner/repo" and https://github.com/owner/repo(.git) URLs.
 */
export function normalizeRepoReference(reference: string): string | null {
  let ref = (reference ?? "").trim();
  ref = ref.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  ref = ref.replace(/\.git$/i, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ref) ? ref : null;
}

function requireInternalToken(c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "callback_disabled" };
  const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || m[1] !== expected) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}

function repairJobView(job: DbRepairJob) {
  return {
    id: job.id,
    visualCheckId: job.visualCheckId,
    repoFullName: job.repoFullName,
    status: job.status,
    branchName: job.branchName ?? null,
    prUrl: job.prUrl ?? null,
    prNumber: job.prNumber ?? null,
    envCause: job.envCause,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Dispatch the queued repair into the ConclaveSandbox container DO as a
 * `simsa_repair` job. Mirrors spawnSandbox/dispatchInspection: fire-and-forget
 * — the container acks 202 and reports back via /internal/repair-*.
 * The GitHub token travels only in the job payload (memory → container env),
 * never in a D1 row or response body.
 */
export async function dispatchRepairJob(
  env: Env,
  args: {
    jobId: string;
    projectId: string;
    userKey: string;
    visualCheckId: string;
    repo: string;
    githubToken: string;
    branch: string;
    agentPrompt: string;
    intent: string;
    targetUrl: string;
    decision: string;
    envCause: boolean;
    publicBaseUrl: string;
  },
): Promise<{ dispatched: boolean; note?: string }> {
  if (!env.SANDBOX) {
    return { dispatched: false, note: "sandbox_unavailable" };
  }
  if (!env.INTERNAL_CALLBACK_TOKEN) {
    return { dispatched: false, note: "callback_token_missing" };
  }
  const base = args.publicBaseUrl.replace(/\/+$/, "");
  const payload = {
    jobType: "simsa_repair",
    jobId: args.jobId,
    projectId: args.projectId,
    visualCheckId: args.visualCheckId,
    repo: args.repo,
    githubToken: args.githubToken,
    branch: args.branch,
    agentPrompt: args.agentPrompt,
    intent: args.intent,
    targetUrl: args.targetUrl,
    decision: args.decision,
    envCause: args.envCause,
    callbackUrl: `${base}/internal/repair-done`,
    runningUrl: `${base}/internal/repair-running`,
    callbackToken: env.INTERNAL_CALLBACK_TOKEN,
  };
  try {
    const id = env.SANDBOX.idFromName(`repair-${args.jobId}`);
    const stub = env.SANDBOX.get(id);
    const r = await stub.fetch("http://sandbox/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const tail = await r.text();
      return { dispatched: false, note: `container returned ${r.status}: ${tail.slice(0, 200)}` };
    }
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, note: `container fetch failed: ${(err as Error).message.slice(0, 200)}` };
  }
}

export function createWorkspaceRepairJobRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/workspace/*", corsMiddleware);

  // ── POST /workspace/projects/:id/visual-checks/:runId/repair ───────────────
  app.post("/workspace/projects/:id/visual-checks/:runId/repair", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");

    let body: { userKey?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    // Ownership chain: project → userKey, run → project + userKey.
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);
    if (project.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

    const run = await getVisualCheckById(c.env, runId);
    if (!run || run.projectId !== projectId || run.userKey !== userKey) {
      return c.json({ ok: false, error: "run_not_found" }, 404);
    }

    // Repairable gate: only a finished check that did NOT verify as working
    // and that carries the deterministic fix prompt can be repaired.
    const agentPrompt = run.agentPrompt ?? "";
    if (!isRunRepairable(run) || !agentPrompt) {
      return c.json(
        {
          ok: false,
          error: "run_not_repairable",
          message: "이 검사 결과로는 고치기를 시작할 수 없어요. 검사가 끝났고 문제가 발견된 경우에만 고칠 수 있어요.",
        },
        400,
      );
    }

    // Resolve the repo. Prefer the explicit workspace-github connection (it
    // has the token); fall back to a project_sources github_repo row.
    let repoFullName: string | null = null;
    const projectRepo = await getProjectRepo(c.env, projectId).catch(() => null);
    if (projectRepo) {
      repoFullName = projectRepo.repoFullName;
    } else {
      const sources = await listProjectSources(c.env, projectId).catch(() => []);
      for (const s of sources) {
        if (s.type !== "github_repo") continue;
        const normalized = normalizeRepoReference(s.reference);
        if (normalized) {
          repoFullName = normalized;
          break;
        }
      }
    }
    if (!repoFullName) {
      return c.json(
        {
          ok: false,
          error: "github_repo_required",
          message: "연결된 GitHub 저장소가 없어요. 프로젝트 설정에서 저장소를 먼저 연결해 주세요.",
        },
        400,
      );
    }

    // Resolve + decrypt the user's OAuth token (public_repo scope).
    const tokenRequired = {
      ok: false,
      error: "github_token_required",
      message: "GitHub 계정 연결이 필요해요. 설정에서 GitHub을 다시 연결해 주세요.",
    };
    const conn = await getGitHubConnectionByUserKey(c.env, userKey).catch(() => null);
    if (!conn || !conn.accessTokenEnc || !c.env.CONCLAVE_TOKEN_KEK) {
      return c.json(tokenRequired, 400);
    }
    let githubToken: string;
    try {
      githubToken = await decryptToken(conn.accessTokenEnc, c.env.CONCLAVE_TOKEN_KEK);
    } catch {
      return c.json(tokenRequired, 400);
    }

    // One active repair per run.
    const active = await findActiveRepairJobForRun(c.env, runId);
    if (active) {
      return c.json({ ok: false, error: "repair_already_active", activeJobId: active.id }, 409);
    }

    // Honest boundary: env-cause evidence still dispatches (fallback-style
    // code fixes are legitimate) but flags the row so the UI can warn.
    const envCause = detectEnvCause(agentPrompt, run.reportJson ?? "");
    const branch = `fix/simsa-${runId}`;

    let job;
    try {
      job = await insertQueuedRepairJob(c.env, {
        projectId,
        userKey,
        visualCheckId: runId,
        repoFullName,
        branchName: branch,
        envCause,
      });
    } catch (err) {
      console.error("[repair-jobs POST] insert failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }

    const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
    const dispatch = await dispatchRepairJob(c.env, {
      jobId: job.id,
      projectId,
      userKey,
      visualCheckId: runId,
      repo: repoFullName,
      githubToken,
      branch,
      agentPrompt,
      intent: run.intent,
      targetUrl: run.targetUrl,
      decision: run.decision,
      envCause,
      publicBaseUrl,
    });

    // Fail fast on undispatched jobs (Stage 263.1 semantics): a queued row
    // nothing will ever pick up would wedge the 409 guard until the sweep.
    let status = job.status;
    if (!dispatch.dispatched) {
      try {
        await markRepairJobFailed(c.env, job.id, dispatch.note ?? "dispatch_failed");
        status = "failed";
      } catch (err) {
        console.error("[repair-jobs POST] fail-fast mark failed:", err);
      }
    }

    return c.json(
      {
        ok: true,
        repair: { ...repairJobView(job), status },
        dispatched: dispatch.dispatched,
        ...(dispatch.note ? { note: dispatch.note } : {}),
      },
      202,
    );
  });

  // ── GET /workspace/projects/:id/visual-checks/:runId/repair?userKey=... ────
  // Latest repair job for the run — dashboard polling.
  app.get("/workspace/projects/:id/visual-checks/:runId/repair", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);
    if (project.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

    const run = await getVisualCheckById(c.env, runId);
    if (!run || run.projectId !== projectId || run.userKey !== userKey) {
      return c.json({ ok: false, error: "run_not_found" }, 404);
    }

    const job = await getLatestRepairJobForRun(c.env, runId);
    return c.json({ ok: true, repair: job ? repairJobView(job) : null });
  });

  // ── POST /internal/repair-running ───────────────────────────────────────────
  // Container ack: the repair actually started executing (queued → running).
  app.post("/internal/repair-running", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as { jobId?: string } | null;
    if (!body || typeof body.jobId !== "string" || !body.jobId) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const job = await getRepairJobById(c.env, body.jobId);
    if (!job) return c.json({ error: "not_found" }, 404);

    const transitioned = await markRepairJobRunning(c.env, body.jobId);
    return c.json({ ok: true, transitioned });
  });

  // ── POST /internal/repair-done ──────────────────────────────────────────────
  // Container result callback: → done (branch + PR created) | failed.
  app.post("/internal/repair-done", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as
      | {
          jobId?: string;
          ok?: boolean;
          prUrl?: string;
          prNumber?: number;
          branch?: string;
          envCause?: boolean;
          error?: string;
        }
      | null;
    if (!body || typeof body.jobId !== "string" || !body.jobId || typeof body.ok !== "boolean") {
      return c.json({ error: "invalid_request" }, 400);
    }

    const job = await getRepairJobById(c.env, body.jobId);
    if (!job) return c.json({ error: "not_found" }, 404);

    if (!body.ok) {
      const error = typeof body.error === "string" && body.error ? body.error : "repair failed";
      await markRepairJobFailed(c.env, body.jobId, error.slice(0, MAX_ERROR_CHARS));
      return c.json({ ok: true, status: "failed" });
    }

    await markRepairJobDone(c.env, body.jobId, {
      prUrl: typeof body.prUrl === "string" && body.prUrl ? body.prUrl : undefined,
      prNumber: typeof body.prNumber === "number" && Number.isInteger(body.prNumber) && body.prNumber > 0
        ? body.prNumber
        : undefined,
      branchName: typeof body.branch === "string" && body.branch ? body.branch : undefined,
      envCause: body.envCause === true,
    });
    return c.json({ ok: true, status: "done" });
  });

  return app;
}

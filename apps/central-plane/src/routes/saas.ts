/**
 * v0.16 (Problem 3) — SaaS pipeline endpoints.
 *
 *   POST /saas/review   — body: { repo, pr_number, prd? }
 *   POST /saas/autofix  — body: { repo, pr_number, prd?, max_cycles? }
 *
 * Both require Authorization: Bearer <token> issued via the Device Flow
 * (see /auth/device + /auth/token in saas-auth.ts).
 *
 * End-to-end flow:
 *   1. Validate the bearer token → resolve saas_users row.
 *   2. Validate the GH App is installed on the target repo + has access.
 *   3. Consume a review credit (byo → trial → paid_credits) — 402 if
 *      none and the user must top up.
 *   4. Record a usage_meters row + create a jobs row (jobId).
 *   5. spawnSandbox(): mint an installation token, address the
 *      ConclaveSandbox Container DO by `pr-<owner>-<repo>-<pr>`, and
 *      POST the run payload. One DO instance per PR keeps concurrent
 *      calls ordered + isolated.
 *   6. Return 202 with { job_id, status: "accepted" }.
 *   7. The container clones the repo, runs runAutofix from cli/dist,
 *      and POSTs the result to /internal/job-done (auth'd with
 *      INTERNAL_CALLBACK_TOKEN). The callback completes the job row
 *      and posts the PR comment + Telegram card.
 *
 * Graceful degradation: when env.SANDBOX is unbound or
 * INTERNAL_CALLBACK_TOKEN is missing, spawnSandbox returns
 * { accepted: false, reason } and the 202 carries status:
 * "queued_pending_infra" so the user gets a clear hint without
 * dropping the job row.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  completeJob,
  consumeReviewCredit,
  createJob,
  findInstallationByRepoSlug,
  findJob,
  findUserByToken,
  recordMeter,
} from "../db/saas.js";
import { createCouncilCheckRun, getInstallationToken, postPrComment } from "../gh-app.js";

const SANDBOX_NOT_BOUND_NOTE =
  "Sandbox container binding not yet provisioned on this Worker. The job is recorded; pipeline runs in the next deploy.";

/**
 * Spawn the sandbox container for a single PR + run the pipeline.
 *
 * Returns immediately when the container accepts the job (202). The
 * actual work happens async; the container POSTs back to
 * /internal/job-done when finished.
 *
 * On any setup error (no installation token, container binding
 * missing, container ack timeout), the job is logged as accepted but
 * the user gets a clear hint in the response.
 */
export async function spawnSandbox(
  env: Env,
  args: {
    jobId: string;
    repo: string;
    prNumber: number;
    prd?: string;
    autofix: boolean;
    reworkCycle?: number;
    publicBaseUrl: string;
  },
): Promise<{ accepted: boolean; reason?: string }> {
  if (!env.SANDBOX) {
    return { accepted: false, reason: SANDBOX_NOT_BOUND_NOTE };
  }
  if (!env.INTERNAL_CALLBACK_TOKEN) {
    return {
      accepted: false,
      reason: "INTERNAL_CALLBACK_TOKEN secret not set — container can't authenticate the callback",
    };
  }

  // Installation token is only valid for ~60 minutes; mint fresh per
  // job. The container handles clone + push with this token.
  const inst = await findInstallationByRepoSlug(env, args.repo);
  if (!inst) {
    return { accepted: false, reason: "GitHub App not installed on this owner" };
  }
  let installationToken: string;
  try {
    const tokenInfo = await getInstallationToken(env, inst.installationId);
    installationToken = tokenInfo.token;
  } catch (err) {
    return { accepted: false, reason: `installation token mint failed: ${(err as Error).message}` };
  }

  // One container instance per PR — keeps concurrent autofix calls on
  // the same PR ordered + isolated. CF Container DO routing handles
  // the queue.
  const containerName = `pr-${args.repo.replace("/", "-")}-${args.prNumber}`;
  const id = env.SANDBOX.idFromName(containerName);
  const stub = env.SANDBOX.get(id);

  const payload = {
    jobId: args.jobId,
    repo: args.repo,
    prNumber: args.prNumber,
    installationToken,
    autofix: args.autofix,
    reworkCycle: args.reworkCycle ?? 0,
    callbackUrl: `${args.publicBaseUrl.replace(/\/+$/, "")}/internal/job-done`,
    callbackToken: env.INTERNAL_CALLBACK_TOKEN,
    ...(args.prd ? { prd: args.prd } : {}),
  };

  // Forward LLM keys via env so the container's pipeline can call
  // Anthropic / OpenAI / Gemini. Telegram bot token is also forwarded
  // so the cli's integration-telegram package can deliver the verdict
  // card from inside the container. The container reads these from
  // process.env at runtime.
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (env.ANTHROPIC_API_KEY) headers["x-anthropic-key"] = env.ANTHROPIC_API_KEY;
  if (env.OPENAI_API_KEY) headers["x-openai-key"] = env.OPENAI_API_KEY;
  if (env.GEMINI_API_KEY) headers["x-gemini-key"] = env.GEMINI_API_KEY;
  if (env.TELEGRAM_BOT_TOKEN) headers["x-telegram-bot-token"] = env.TELEGRAM_BOT_TOKEN;

  try {
    const r = await stub.fetch("http://sandbox/run", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const tail = await r.text();
      return { accepted: false, reason: `container returned ${r.status}: ${tail.slice(0, 200)}` };
    }
    return { accepted: true };
  } catch (err) {
    return { accepted: false, reason: `container fetch failed: ${(err as Error).message}` };
  }
}

export function createSaasRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/saas/review", async (c) => {
    const auth = await requireAuth(c);
    if ("error" in auth) return c.json({ error: auth.error }, auth.status);
    const { user } = auth;

    const body = (await c.req.json().catch(() => null)) as
      | { repo?: string; pr_number?: number; prd?: string }
      | null;
    if (!body || !body.repo || typeof body.pr_number !== "number") {
      return c.json({ error: "invalid_request", error_description: "repo + pr_number required" }, 400);
    }

    // Verify Conclave AI Code Council is installed on the repo's owner.
    const inst = await findInstallationByRepoSlug(c.env, body.repo);
    if (!inst) {
      return c.json(
        {
          error: "app_not_installed",
          error_description: `Install Conclave AI Code Council on ${body.repo.split("/")[0]} first.`,
          install_url: "https://github.com/apps/conclave-ai-code-council",
        },
        403,
      );
    }
    if (inst.suspendedAt) {
      return c.json({ error: "app_suspended" }, 403);
    }

    // Credit gate. Order: byo (free) → trial (1× free) → paid_credits.
    // 402 means the user must top up before retrying.
    const billed = await consumeReviewCredit(c.env, user.id);
    if (billed === null) {
      const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
      return c.json(
        {
          error: "credits_exhausted",
          error_description:
            "Your free trial has been used. Buy a $3 first-PR pass, add your own Anthropic key for unlimited free, or DM @baessi1 on Threads.",
          buy_credits_url: `${publicBaseUrl}/billing`,
          byo_setup_url: "https://github.com/3SVS/conclave-ai#byo",
        },
        402,
      );
    }

    const jobId = `job_${Math.floor(Date.now()).toString(36)}_${randHex(8)}`;
    await recordMeter(c.env, {
      userId: user.id,
      meterName: `review.requested.${billed}`,
      quantity: 1,
      repoSlug: body.repo,
    });
    await createJob(c.env, {
      jobId,
      userId: user.id,
      repoSlug: body.repo,
      prNumber: body.pr_number,
      kind: "review",
      prdPresent: Boolean(body.prd),
    }).catch(() => undefined);

    const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
    const spawnArgs: Parameters<typeof spawnSandbox>[1] = {
      jobId,
      repo: body.repo,
      prNumber: body.pr_number,
      autofix: false,
      publicBaseUrl,
    };
    if (body.prd) spawnArgs.prd = body.prd;
    const spawn = await spawnSandbox(c.env, spawnArgs);
    if (!spawn.accepted) {
      return c.json(
        {
          job_id: jobId,
          status: "queued_pending_infra",
          note: spawn.reason,
        },
        202,
      );
    }

    return c.json(
      {
        job_id: jobId,
        status: "accepted",
        note: "Council review running in sandbox. Result delivered via PR comment + Telegram (if linked).",
      },
      202,
    );
  });

  app.post("/saas/autofix", async (c) => {
    const auth = await requireAuth(c);
    if ("error" in auth) return c.json({ error: auth.error }, auth.status);
    const { user } = auth;

    const body = (await c.req.json().catch(() => null)) as
      | { repo?: string; pr_number?: number; prd?: string; max_cycles?: number }
      | null;
    if (!body || !body.repo || typeof body.pr_number !== "number") {
      return c.json({ error: "invalid_request", error_description: "repo + pr_number required" }, 400);
    }

    const inst = await findInstallationByRepoSlug(c.env, body.repo);
    if (!inst) {
      return c.json(
        {
          error: "app_not_installed",
          install_url: "https://github.com/apps/conclave-ai-code-council",
        },
        403,
      );
    }
    if (inst.suspendedAt) {
      return c.json({ error: "app_suspended" }, 403);
    }

    const jobId = `job_${Math.floor(Date.now()).toString(36)}_${randHex(8)}`;
    await recordMeter(c.env, {
      userId: user.id,
      meterName: "autofix.requested",
      quantity: 1,
      repoSlug: body.repo,
    });
    await createJob(c.env, {
      jobId,
      userId: user.id,
      repoSlug: body.repo,
      prNumber: body.pr_number,
      kind: "autofix",
      prdPresent: Boolean(body.prd),
    }).catch(() => undefined);

    const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
    const spawnArgs: Parameters<typeof spawnSandbox>[1] = {
      jobId,
      repo: body.repo,
      prNumber: body.pr_number,
      autofix: true,
      publicBaseUrl,
    };
    if (body.prd) spawnArgs.prd = body.prd;
    const spawn = await spawnSandbox(c.env, spawnArgs);
    if (!spawn.accepted) {
      return c.json(
        {
          job_id: jobId,
          status: "queued_pending_infra",
          note: spawn.reason,
        },
        202,
      );
    }

    return c.json(
      {
        job_id: jobId,
        status: "accepted",
        note: "Autofix pipeline running in sandbox. Up to 3 rework cycles. Result delivered via PR comment + Telegram (if linked).",
      },
      202,
    );
  });

  // POST /internal/job-done — sandbox container's callback endpoint.
  //
  // Auth: Bearer <INTERNAL_CALLBACK_TOKEN> — random per deploy, never
  // leaves the Worker except as part of the spawn payload. The
  // container holds it for the lifetime of the job.
  //
  // Body: { jobId, repo, prNumber, verdict, blockers, cycles, durationMs,
  //         error?, smokeOutcome?, deployUrl? }
  //
  // Side effects: writes a usage_meters row recording the completion +
  // updates jobs table (when migration 0010 is applied). Telegram +
  // PR-comment delivery already happens inside the pipeline running
  // in the container, so this endpoint is purely accounting.
  app.post("/internal/job-done", async (c) => {
    const expected = c.env.INTERNAL_CALLBACK_TOKEN;
    if (!expected) {
      return c.json({ error: "callback_disabled" }, 503);
    }
    const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || m[1] !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as
      | {
          jobId?: string;
          repo?: string;
          prNumber?: number;
          verdict?: string;
          blockers?: number;
          blockerSummaries?: Array<{
            category?: string;
            severity?: string;
            message?: string;
            file?: string;
            line?: number;
          }>;
          cycles?: number;
          durationMs?: number;
          error?: string;
          smokeOutcome?: "ok" | "broken" | "skipped";
          deployUrl?: string;
          headSha?: string;
        }
      | null;
    if (!body || !body.jobId || !body.repo || typeof body.prNumber !== "number") {
      return c.json({ error: "invalid_request" }, 400);
    }

    const status: "done" | "failed" =
      body.error || body.verdict === "reject" ? "failed" : "done";

    const completeArgs: Parameters<typeof completeJob>[1] = {
      jobId: body.jobId,
      status,
    };
    if (body.verdict !== undefined) completeArgs.verdict = body.verdict;
    if (body.blockers !== undefined) completeArgs.blockers = body.blockers;
    if (body.cycles !== undefined) completeArgs.cycles = body.cycles;
    if (body.durationMs !== undefined) completeArgs.durationMs = body.durationMs;
    if (body.smokeOutcome !== undefined) completeArgs.smokeOutcome = body.smokeOutcome;
    if (body.deployUrl !== undefined) completeArgs.deployUrl = body.deployUrl;
    if (body.error !== undefined) completeArgs.errorMessage = body.error;
    if (typeof body.headSha === "string" && body.headSha.length > 0) completeArgs.headSha = body.headSha;

    await completeJob(c.env, completeArgs).catch(() => undefined);

    // Best-effort tally row so usage_meters has a completion signal even
    // when the jobs row was lost (cold-start race with migration apply).
    const job = await findJob(c.env, body.jobId);
    if (job) {
      await recordMeter(c.env, {
        userId: job.userId,
        meterName: "job.completed",
        quantity: 1,
        repoSlug: body.repo,
      }).catch(() => undefined);
    }

    // Tell the user the result on the PR — silent verdicts confuse
    // people. Best-effort; if the comment fails the row still has the
    // truth in D1 for the dashboard.
    const inst = await findInstallationByRepoSlug(c.env, body.repo);
    if (inst) {
      const repoForComment = body.repo;
      const prNumberForComment = body.prNumber;
      const commentBody = renderResultComment({
        verdict: body.verdict,
        blockers: body.blockers,
        blockerSummaries: body.blockerSummaries,
        error: body.error,
        durationMs: body.durationMs,
        deployUrl: body.deployUrl,
      });
      await postPrComment(
        c.env,
        inst.installationId,
        repoForComment,
        prNumberForComment,
        commentBody,
      ).catch(() => undefined);
      // Council verdict as a GH check-run so PR's "Checks" tab reflects
      // the real state — not just the build/CI checks. Without this,
      // a PR with REWORK verdict still shows green-merge-ready when
      // Vercel + CI happen to pass.
      if (typeof body.headSha === "string" && body.headSha.length > 0) {
        await createCouncilCheckRun(
          c.env,
          inst.installationId,
          repoForComment,
          body.headSha,
          {
            ...(body.verdict !== undefined ? { verdict: body.verdict } : {}),
            ...(body.blockers !== undefined ? { blockers: body.blockers } : {}),
            ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
          },
        ).catch(() => undefined);
      }
    }

    return c.json({ ok: true });
  });

  // GET /saas/jobs/:id — poll job status. CLI uses this so `conclave
  // review --pr N --use-saas` can stream progress without webhooks.
  app.get("/saas/jobs/:id", async (c) => {
    const auth = await requireAuth(c);
    if ("error" in auth) return c.json({ error: auth.error }, auth.status);
    const { user } = auth;
    const id = c.req.param("id");
    const job = await findJob(c.env, id);
    if (!job) return c.json({ error: "not_found" }, 404);
    if (job.userId !== user.id) return c.json({ error: "forbidden" }, 403);
    return c.json({
      id: job.id,
      kind: job.kind,
      status: job.status,
      repo: job.repoSlug,
      pr_number: job.prNumber,
      verdict: job.verdict,
      blockers: job.blockers,
      cycles: job.cycles,
      duration_ms: job.durationMs,
      smoke_outcome: job.smokeOutcome,
      deploy_url: job.deployUrl,
      error: job.errorMessage,
      created_at: job.createdAt,
      completed_at: job.completedAt,
    });
  });

  // Convenience: GET /saas/me — returns the authenticated user. CLI uses
  // this on `conclave login` confirmation + `conclave whoami`.
  app.get("/saas/me", async (c) => {
    const auth = await requireAuth(c);
    if ("error" in auth) return c.json({ error: auth.error }, auth.status);
    const { user } = auth;
    return c.json({
      id: user.id,
      github_login: user.githubLogin,
      email: user.email,
      tier: user.tier,
      byo_anthropic: user.byoAnthropic,
      data_share_opt_in: user.dataShareOptIn,
    });
  });

  return app;
}

async function requireAuth(c: any): Promise<
  | { user: NonNullable<Awaited<ReturnType<typeof findUserByToken>>>["user"]; tokenId: string }
  | { error: string; status: 401 | 403 }
> {
  const header = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return { error: "missing or malformed Authorization: Bearer <token>", status: 401 };
  const found = await findUserByToken(c.env, m[1]!);
  if (!found) return { error: "invalid or revoked token", status: 401 };
  return found;
}

function randHex(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Render the PR comment posted when /internal/job-done fires.
 *  Keeps the messaging consistent across review + autofix paths and
 *  handles the empty-verdict / errored case so users always know
 *  what happened. */
function renderResultComment(args: {
  verdict?: string;
  blockers?: number;
  blockerSummaries?: Array<{
    category?: string;
    severity?: string;
    message?: string;
    file?: string;
    line?: number;
  }>;
  error?: string;
  durationMs?: number;
  deployUrl?: string;
}): string {
  const dur = typeof args.durationMs === "number" ? `${Math.round(args.durationMs / 1000)}s` : "";
  if (args.error) {
    return [
      `❌ **Conclave AI review failed.**`,
      ``,
      `Reason: \`${args.error.slice(0, 400)}\``,
      ``,
      `Try pushing again. If it keeps happening, this is on us — please [open an issue](https://github.com/3SVS/conclave-ai/issues/new).`,
    ].join("\n");
  }
  const v = (args.verdict ?? "").toLowerCase();
  if (v === "approve") {
    return [
      `✅ **Conclave AI verdict: APPROVE**${dur ? ` · ${dur}` : ""}`,
      ``,
      `Three-agent council found no blockers. Safe to merge.`,
    ].join("\n");
  }
  if (v === "reject" || v === "rework") {
    const heading = v === "reject"
      ? `🛑 **Conclave AI verdict: REJECT**${dur ? ` · ${dur}` : ""}`
      : `🔁 **Conclave AI verdict: REWORK**${dur ? ` · ${dur}` : ""}`;
    const total = args.blockers ?? 0;
    const lines: string[] = [
      heading,
      ``,
      `${total} blocker${total === 1 ? "" : "s"} found.`,
    ];
    const summaries = Array.isArray(args.blockerSummaries) ? args.blockerSummaries : [];
    if (summaries.length > 0) {
      lines.push("");
      summaries.forEach((b, i) => {
        const cat = b.category ?? "uncategorized";
        const sev = b.severity ? ` · _${b.severity}_` : "";
        const loc = b.file
          ? `\n   \`${b.file}${typeof b.line === "number" ? `:${b.line}` : ""}\``
          : "";
        const msg = (b.message ?? "").trim();
        lines.push(`${i + 1}. **[${cat}]**${sev} ${msg}${loc}`);
      });
      if (total > summaries.length) {
        lines.push("");
        lines.push(`_+ ${total - summaries.length} more — full set in the episodic log._`);
      }
    }
    if (v === "rework") {
      lines.push("");
      lines.push(
        `Push a fix or run \`conclave autofix --use-saas --pr <N>\` to let the worker agent attempt the fixes.`,
      );
    } else {
      lines.push("");
      lines.push(`Council recommends not merging in this shape — address the blockers above and push again.`);
    }
    return lines.join("\n");
  }
  // No verdict, no error — odd but possible (e.g. cli exited 0 without
  // emitting one). Surface the run as completed-without-judgment.
  return [
    `🤖 **Conclave AI** finished${dur ? ` in ${dur}` : ""} but didn't produce a verdict.`,
    ``,
    `This usually means the diff was below the review threshold or the council couldn't reach consensus. Push again to retry.`,
  ].join("\n");
}

#!/usr/bin/env node
/**
 * Conclave AI sandbox container — HTTP server entry.
 *
 * Spawned per-request by the Worker (Cloudflare Container Durable
 * Object). Listens on PORT (default 8080), accepts POST /run with the
 * job payload, clones the user's repo via the GitHub App installation
 * token, runs the autofix-pipeline (cli@latest dist), and posts the
 * result to the Worker's /internal/job-done callback.
 *
 * Why a thin HTTP shim and not call the CLI directly: the CF
 * Container DO needs an HTTP listener (the Worker's `container.fetch`
 * speaks HTTP to the container). We import runAutofix from the CLI
 * package's published dist instead of spawning a child CLI process —
 * keeps everything in one Node process for clean shutdown + lower
 * memory.
 *
 * The server uses Node's built-in http module — no Express, no Hono,
 * no extra deps in the container image.
 */

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);

const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_ROOT ?? "/var/lib/conclave";

// In-flight job registry. Drained on SIGTERM so users get a clean
// "review failed: container was killed" callback instead of a silent
// `accepted` stuck row. Key = jobId, value = full payload (we need
// callbackUrl + callbackToken + repo + prNumber to call back).
const inFlightJobs = new Map();

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "POST /run only" }));
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body", detail: err.message }));
    return;
  }

  // Validate the minimum required fields. We don't trust the Worker
  // entirely — some fields are user-supplied (PRD, repo slug) and
  // could have unexpected shapes.
  const required = ["jobId", "repo", "prNumber", "installationToken", "callbackUrl", "callbackToken"];
  const missing = required.filter((k) => payload[k] === undefined || payload[k] === null);
  if (missing.length > 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `missing fields: ${missing.join(", ")}` }));
    return;
  }

  // Hoist Worker-forwarded secrets (LLM keys + Telegram bot token)
  // from request headers into process.env so the cli pipeline picks
  // them up via its standard env reads. CF Containers don't auto-inject
  // Worker secrets, so this is the bridge.
  const headerEnvMap = {
    "x-anthropic-key": "ANTHROPIC_API_KEY",
    "x-openai-key": "OPENAI_API_KEY",
    "x-gemini-key": "GEMINI_API_KEY",
    "x-telegram-bot-token": "TELEGRAM_BOT_TOKEN",
  };
  for (const [h, e] of Object.entries(headerEnvMap)) {
    const v = req.headers[h];
    if (typeof v === "string" && v.length > 0) process.env[e] = v;
  }

  // Acknowledge the job immediately. The actual work runs async; result
  // is delivered via the callback. Keeping the original Worker request
  // open for 1–3 minutes would burn CF Worker CPU budget.
  res.writeHead(202, { "content-type": "application/json" });
  res.end(JSON.stringify({ jobId: payload.jobId, status: "accepted" }));

  // Track in-flight jobs so the SIGTERM handler can errored-callback
  // them when CF kills us mid-run (deploy rollouts, sleepAfter expiry).
  // Without this, jobs disappear silently and the user sees no result.
  inFlightJobs.set(payload.jobId, payload);
  // Fire-and-forget. Top-level await would block the listener; spawn
  // an async task and report errors via the callback path.
  runJob(payload)
    .catch(async (err) => {
      console.error(`[job ${payload.jobId}] crashed:`, err);
      await postCallback(payload.callbackUrl, payload.callbackToken, {
        jobId: payload.jobId,
        repo: payload.repo,
        prNumber: payload.prNumber,
        status: "errored",
        error: err.message ?? String(err),
      }).catch((cbErr) => {
        console.error(`[job ${payload.jobId}] callback also failed:`, cbErr);
      });
    })
    .finally(() => inFlightJobs.delete(payload.jobId));
});

server.listen(PORT, () => {
  console.log(`conclave-sandbox listening on :${PORT}`);
});

// Graceful shutdown — CF Containers send SIGTERM on sleepAfter expiry
// AND on new-image rollouts. If any jobs are still running when that
// happens, the cli's runAutofix is interrupted mid-call and the user
// would see no result. Drain inFlightJobs by sending each one an
// errored callback so the worker can update D1 + post a PR comment.
//
// Cap the drain at 5s — beyond that CF will hard-kill us anyway.
let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${sig} — draining ${inFlightJobs.size} in-flight job(s)`);
  const drains = Array.from(inFlightJobs.values()).map((p) =>
    postCallback(p.callbackUrl, p.callbackToken, {
      jobId: p.jobId,
      repo: p.repo,
      prNumber: p.prNumber,
      status: "errored",
      error: `container was killed by ${sig} mid-run (deploy rollout or sleepAfter)`,
    }).catch((cbErr) => {
      console.error(`[shutdown] callback failed for ${p.jobId}:`, cbErr);
    }),
  );
  const drainTimeout = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([Promise.all(drains), drainTimeout]);
  server.close(() => process.exit(0));
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    void gracefulShutdown(sig);
  });
}

// --- Job runner -----------------------------------------------------------

/**
 * Run a single autofix-pipeline job.
 *
 * Steps:
 *   1. Clone the repo via installation token
 *   2. Checkout the PR branch
 *   3. Read .conclaverc.json + .conclave/prd.md if present
 *   4. Build a payload for runAutofix
 *   5. Invoke runAutofix from @conclave-ai/cli/dist/autofix-pipeline.js
 *   6. POST the result to the Worker callback
 */
async function runJob(payload) {
  const {
    jobId,
    repo, // e.g. "seunghunbae-3svs/eventbadge"
    prNumber,
    installationToken,
    autofix = false, // true → autofix path, false → review-only
    callbackUrl,
    callbackToken,
  } = payload;

  const start = Date.now();
  console.log(`[job ${jobId}] start: ${repo}#${prNumber} (autofix=${autofix})`);

  // 1. Clone into a fresh dir. Use the installation token as the
  //    HTTPS auth (GitHub accepts `x-access-token:<token>` for App
  //    installations). Also export it as GH_TOKEN so the cli
  //    pipeline's `gh` invocations (PR fetch, comment, status check)
  //    inherit auth without each callsite needing to wire it up.
  const workDir = await fs.mkdtemp(path.join(WORK_ROOT, `${jobId}-`));
  process.env.GH_TOKEN = installationToken;
  process.env.GITHUB_TOKEN = installationToken;
  // GH_REPO lets `gh` calls work without being inside the repo's git
  // dir (cli's `gh pr view N` falls back without --repo, which fails
  // when run from anywhere but the workDir). Setting GH_REPO is
  // process-wide and matches gh CLI's standard env contract.
  process.env.GH_REPO = repo;
  try {
    const cloneUrl = `https://x-access-token:${installationToken}@github.com/${repo}.git`;
    await execFileP("git", ["clone", "--depth", "20", cloneUrl, workDir], { timeout: 90_000 });
    console.log(`[job ${jobId}] cloned into ${workDir}`);

    // 2. Resolve PR head ref + checkout. PR may be on a fork — for
    //    same-repo PRs `gh pr checkout` style works via fetching
    //    refs/pull/N/head.
    await execFileP("git", ["-C", workDir, "fetch", "origin", `pull/${prNumber}/head:pr-${prNumber}`], {
      timeout: 60_000,
    });
    await execFileP("git", ["-C", workDir, "checkout", `pr-${prNumber}`], { timeout: 30_000 });
    const headSha = (await execFileP("git", ["-C", workDir, "rev-parse", "HEAD"], { timeout: 10_000 })).stdout.trim();
    console.log(`[job ${jobId}] checked out ${headSha.slice(0, 7)}`);

    // 3. Configure git user for any commits autofix may make.
    await execFileP("git", [
      "-C", workDir,
      "config", "user.name", "conclave-ai-code-council[bot]"
    ]);
    await execFileP("git", [
      "-C", workDir,
      "config", "user.email", "3620556+conclave-ai-code-council[bot]@users.noreply.github.com"
    ]);

    // 4. Lazy import the pipeline. Direct monorepo path (not via
    //    /app/node_modules/@conclave-ai/cli) — pnpm's workspace symlink
    //    layout under .pnpm/ doesn't always expose dist at the bare
    //    /node_modules/<pkg>/dist path inside the container. The
    //    Dockerfile COPYs the whole `packages/` tree and `pnpm turbo`
    //    builds cli's dist in place, so this absolute path is stable.
    const pipelineUrl = new URL("file:///app/packages/cli/dist/autofix-pipeline.js");
    const { runAutofix } = await import(pipelineUrl.href);

    // cli's pipeline shells out to `gh` and `git` from the current
    // working directory. Without this chdir, those commands run from
    // /app and bail with "not a git repository". One container handles
    // one PR at a time so a process-wide chdir is safe here.
    process.chdir(workDir);

    // 5. Build minimal AutofixArgs + AutofixDeps.
    //
    // CRITICAL: defaultSpawnReview shells out to a `conclave` binary on
    // PATH (or re-execs argv[1] if it's a conclave entry). The container
    // image has neither — server.mjs is the entry, no global conclave
    // bin is installed. Without this override every review subprocess
    // ENOENTs and returns `bailed-no-patches` with verdict null, which
    // looks identical to "council had nothing to say" downstream.
    // Inject an in-process spawn that re-execs the cli's own bin entry.
    const conclaveBin = "/app/packages/cli/dist/bin/conclave.js";
    const spawnReview = async (input) => {
      try {
        const { stdout, stderr } = await execFileP(
          process.execPath,
          [conclaveBin, "review", "--pr", String(input.prNumber), "--json", "--no-notify"],
          {
            cwd: input.cwd,
            maxBuffer: 20 * 1024 * 1024,
            timeout: input.timeoutMs ?? 5 * 60 * 1000,
            env: process.env,
          },
        );
        return { stdout, stderr, code: 0 };
      } catch (err) {
        const e = err;
        return {
          stdout: e?.stdout ?? "",
          stderr: e?.stderr ?? String(e?.message ?? err),
          code: typeof e?.code === "number" ? e.code : 1,
        };
      }
    };
    const args = {
      pr: prNumber,
      cwd: workDir,
      budgetUsd: 5, // hard cap per job
      maxIterations: 1, // single iteration per Container spawn — Worker re-spawns for cycle 2
      autonomy: "l2",
      dryRun: !autofix,
      help: false,
      allowSecrets: [],
      skipSecretGuard: false,
      reworkCycle: payload.reworkCycle ?? 0,
    };
    if (payload.prd) args.prd = payload.prd;

    // 6. Run. Inject our spawnReview as a dep so cli doesn't try to
    //    shell out to a `conclave` binary that isn't on PATH inside
    //    the container.
    const { code, result } = await runAutofix(args, { spawnReview });
    console.log(`[job ${jobId}] runAutofix exit=${code} status=${result.status}`);

    // 7. Callback to Worker. Worker's /internal/job-done expects flat
    //    fields (jobId, repo, prNumber, verdict, blockers, error,
    //    durationMs); without repo+prNumber it 400s and the row stays
    //    in `accepted` forever. Flatten what the worker reads + keep
    //    `result` for any future deeper introspection.
    //
    // runAutofix has multiple result shapes:
    //   - `{ verdict: "approve|rework|reject", reviews, ... }` (normal)
    //   - `{ status: "approved", ... }` (fast-return when council OKs)
    //   - `{ status: "bailed-no-patches", reason, ... }` (review fail)
    //   - `{ status: "bailed-max-iter", ... }` (autonomy ceiling)
    // We coerce `status` into `verdict` when verdict isn't set so the
    // worker / PR-comment renderer always has something to show.
    const rawVerdict =
      result && typeof result === "object" && "verdict" in result ? result.verdict : undefined;
    const rawStatus =
      result && typeof result === "object" && "status" in result ? result.status : undefined;
    const verdict =
      rawVerdict ??
      (rawStatus === "approved"
        ? "approve"
        : rawStatus === "bailed-no-patches" || rawStatus === "bailed-max-iter" || rawStatus === "errored"
          ? "rework"
          : undefined);
    const blockers =
      result && typeof result === "object" && Array.isArray(result.remainingBlockers)
        ? result.remainingBlockers.length
        : result && typeof result === "object" && Array.isArray(result.blockers)
          ? result.blockers.length
          : undefined;
    // Diagnostic: if neither verdict nor status came back the cli
    // exited without producing one — ship that fact via the error
    // channel so D1's error_message captures it (and the user sees
    // it in the PR comment) instead of "didn't produce a verdict".
    const noOutcome = verdict === undefined && rawStatus === undefined;
    const diagnosticError = noOutcome
      ? `cli returned no verdict/status. exitCode=${code}. keys=[${Object.keys(result ?? {}).join(",")}]`
      : undefined;
    await postCallback(callbackUrl, callbackToken, {
      jobId,
      repo,
      prNumber,
      status: noOutcome ? "errored" : "done",
      ...(verdict !== undefined ? { verdict } : {}),
      ...(blockers !== undefined ? { blockers } : {}),
      ...(diagnosticError ? { error: diagnosticError } : {}),
      exitCode: code,
      result,
      headSha,
      durationMs: Date.now() - start,
    });
    console.log(`[job ${jobId}] callback delivered (verdict=${verdict} status=${rawStatus})`);
  } catch (err) {
    console.error(`[job ${jobId}] failed:`, err);
    await postCallback(callbackUrl, callbackToken, {
      jobId,
      repo,
      prNumber,
      status: "errored",
      error: err.message ?? String(err),
      durationMs: Date.now() - start,
    });
  } finally {
    // Clean up the clone — ephemeral storage but free it explicitly.
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[job ${jobId}] cleanup failed:`, cleanupErr);
    }
  }
}

async function postCallback(url, token, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const tail = await r.text();
    throw new Error(`callback ${url} returned ${r.status}: ${tail.slice(0, 300)}`);
  }
}

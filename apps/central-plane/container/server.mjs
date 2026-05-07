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

  // Fire-and-forget. Top-level await would block the listener; spawn
  // an async task and report errors via the callback path.
  runJob(payload).catch(async (err) => {
    console.error(`[job ${payload.jobId}] crashed:`, err);
    await postCallback(payload.callbackUrl, payload.callbackToken, {
      jobId: payload.jobId,
      status: "errored",
      error: err.message ?? String(err),
    }).catch((cbErr) => {
      console.error(`[job ${payload.jobId}] callback also failed:`, cbErr);
    });
  });
});

server.listen(PORT, () => {
  console.log(`conclave-sandbox listening on :${PORT}`);
});

// Graceful shutdown — CF Containers send SIGTERM on sleepAfter expiry.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`received ${sig} — shutting down`);
    server.close(() => process.exit(0));
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
  //    installations).
  const workDir = await fs.mkdtemp(path.join(WORK_ROOT, `${jobId}-`));
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

    // 5. Build minimal AutofixArgs + AutofixDeps. Many deps default
    //    to local-spawn implementations that work fine inside the
    //    container.
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

    // 6. Run.
    const { code, result } = await runAutofix(args);
    console.log(`[job ${jobId}] runAutofix exit=${code} status=${result.status}`);

    // 7. Callback to Worker. Worker's /internal/job-done expects flat
    //    fields (jobId, repo, prNumber, verdict, blockers, error,
    //    durationMs); without repo+prNumber it 400s and the row stays
    //    in `accepted` forever. Flatten what the worker reads + keep
    //    `result` for any future deeper introspection.
    const verdict =
      result && typeof result === "object" && "verdict" in result ? result.verdict : undefined;
    const blockers =
      result && typeof result === "object" && Array.isArray(result.blockers)
        ? result.blockers.length
        : undefined;
    await postCallback(callbackUrl, callbackToken, {
      jobId,
      repo,
      prNumber,
      status: "done",
      ...(verdict !== undefined ? { verdict } : {}),
      ...(blockers !== undefined ? { blockers } : {}),
      exitCode: code,
      result,
      headSha,
      durationMs: Date.now() - start,
    });
    console.log(`[job ${jobId}] callback delivered`);
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

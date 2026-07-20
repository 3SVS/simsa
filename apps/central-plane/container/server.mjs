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
import {
  buildBriefOnlyDiagnosis,
  buildRepairPrContent,
  classifyCloneError,
  coerceResult,
  extractHeaderEnv,
  redactSecret,
  validateRepairPayload,
  validateRunPayload,
} from "./coerce-result.mjs";

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

  // Stage 268 — job-type switch. A `simsa_repair` job (visual-check repair
  // loop) reuses this same container + /run endpoint but takes a different
  // payload (user OAuth token + agent fix prompt, no PR yet) and a different
  // execution path (repair branch + draft PR instead of runAutofix).
  if (payload.jobType === "simsa_repair") {
    const repairValidation = validateRepairPayload(payload);
    if (!repairValidation.ok) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `missing fields: ${repairValidation.missing.join(", ")}` }));
      return;
    }
    // Stage 270 — the Worker forwards ANTHROPIC_API_KEY via the same
    // x-anthropic-key header the autofix spawn uses. Scoped to this job
    // (passed explicitly to the worker agent), NOT written to process.env.
    // Absent key → Stage 268 brief-only behavior.
    const anthropicApiKey =
      typeof req.headers["x-anthropic-key"] === "string" && req.headers["x-anthropic-key"].length > 0
        ? req.headers["x-anthropic-key"]
        : undefined;
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ jobId: payload.jobId, status: "accepted" }));

    inFlightJobs.set(payload.jobId, payload);
    runRepairJob(payload, anthropicApiKey)
      .catch(async (err) => {
        console.error(`[repair ${payload.jobId}] crashed:`, redactSecret(err?.message ?? String(err), payload.githubToken));
        await postCallback(payload.callbackUrl, payload.callbackToken, {
          jobId: payload.jobId,
          ok: false,
          error: redactSecret(err?.message ?? String(err), payload.githubToken),
        }).catch((cbErr) => {
          console.error(`[repair ${payload.jobId}] callback also failed:`, cbErr);
        });
      })
      .finally(() => inFlightJobs.delete(payload.jobId));
    return;
  }

  // Validate the minimum required fields. We don't trust the Worker
  // entirely — some fields are user-supplied (PRD, repo slug) and
  // could have unexpected shapes. Logic lives in coerce-result.mjs so
  // it's testable without an HTTP server.
  const validation = validateRunPayload(payload);
  if (!validation.ok) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `missing fields: ${validation.missing.join(", ")}` }));
    return;
  }

  // Hoist Worker-forwarded secrets (LLM keys + Telegram bot token)
  // from request headers into process.env so the cli pipeline picks
  // them up via its standard env reads. CF Containers don't auto-inject
  // Worker secrets, so this is the bridge.
  for (const [envName, value] of Object.entries(extractHeaderEnv(req.headers))) {
    process.env[envName] = value;
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
    postCallback(
      p.callbackUrl,
      p.callbackToken,
      // Stage 268 — repair jobs use the /internal/repair-done payload shape
      // ({jobId, ok, error}); autofix jobs keep the /internal/job-done shape.
      p.jobType === "simsa_repair"
        ? {
            jobId: p.jobId,
            ok: false,
            error: `container was killed by ${sig} mid-run (deploy rollout or sleepAfter)`,
          }
        : {
            jobId: p.jobId,
            repo: p.repo,
            prNumber: p.prNumber,
            status: "errored",
            error: `container was killed by ${sig} mid-run (deploy rollout or sleepAfter)`,
          },
    ).catch((cbErr) => {
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
 *   5. Invoke runAutofix from @simsa/cli/dist/autofix-pipeline.js
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

    // 3.5 Wait for deploy preview status to settle BEFORE running cli.
    //     Vercel/Netlify/CF builds typically take 60-120s; without this
    //     wait, cli fires fetchDeployStatus during the build window and
    //     gets "unknown", so the council never learns that the deploy
    //     actually failed. We poll the GH check-runs API for the head
    //     SHA every 8s up to 120s, then proceed regardless. The cli's
    //     own fetchDeployStatus call afterwards reads the same API and
    //     gets the now-settled answer.
    const deployFinal = await waitForDeployStatus(repo, headSha, installationToken, 120_000);
    console.log(`[job ${jobId}] deploy probe settled: ${deployFinal}`);

    // 4. Lazy import the pipeline. Direct monorepo path (not via
    //    /app/node_modules/@simsa/cli) — pnpm's workspace symlink
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
    // coerceResult handles the four runAutofix result shapes (see
    // coerce-result.mjs) and produces a uniform { verdict, blockers,
    // blockerSummaries, diagnosticError } envelope. When verdict is
    // undefined the diagnosticError captures whatever cli actually
    // returned so D1's error_message has actionable detail.
    const coerced = coerceResult(result, code);
    const { verdict, blockers, blockerSummaries, diagnosticError } = coerced;
    console.log(`[job ${jobId}] ${coerced.debugLine}`);
    await postCallback(callbackUrl, callbackToken, {
      jobId,
      repo,
      prNumber,
      status: verdict === undefined ? "errored" : "done",
      ...(verdict !== undefined ? { verdict } : {}),
      ...(blockers !== undefined ? { blockers } : {}),
      ...(blockerSummaries !== undefined ? { blockerSummaries } : {}),
      ...(diagnosticError ? { error: diagnosticError } : {}),
      exitCode: code,
      result,
      headSha,
      durationMs: Date.now() - start,
    });
    console.log(`[job ${jobId}] callback delivered (verdict=${verdict} status=${verdict === undefined ? "errored" : "done"})`);
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

// --- Stage 268: simsa_repair job runner ------------------------------------

/**
 * Run a single visual-check repair job.
 *
 * Stage 270 behavior (true auto-repair): when the Worker forwards an
 * ANTHROPIC_API_KEY, the container drives the REAL worker agent
 * (@simsa/agent-worker ClaudeWorker.work) with the Simsa fix brief as
 * the blocker input so actual code changes land on the repair branch:
 *
 *   1. Shallow-clones the repo with the user's OAuth token (public_repo)
 *   2. Creates the repair branch (fix/simsa-{runId})
 *   3. Parses the fix brief (canonical src/workspace/repair-brief.ts,
 *      compiled in-image) into WorkerContext reviews/blockers, feeds ranked
 *      file-snapshot batches to ClaudeWorker — bounded at 3 iterations /
 *      5 min wall clock — and applies sanitized full-file rewrites
 *   4. Commits code changes + SIMSA-FIX-BRIEF.md, pushes, opens a NON-draft
 *      PR "Simsa 자동 수리: ..." listing what changed per finding
 *   5. Reports {jobId, ok, prUrl, prNumber, branch, envCause, mode,
 *      changedFiles} to /internal/repair-done
 *
 * HONEST FALLBACK (Stage 268 semantics preserved): no key, zero parsed
 * findings, worker declines/errors, rewrites all rejected by the sanitizer,
 * or the quick syntax check fails → the working tree is reset to a clean
 * state and the job degrades to the brief-only DRAFT PR ("Simsa 수리
 * 시작점: ...", mode "brief_only") — never a broken half-state.
 *
 * The tokens live only in memory (clone URL + API Authorization header +
 * worker client); the GitHub token is redacted from every error message
 * before it leaves this process, and the Anthropic key never reaches the
 * repo, the PR, or the callback.
 */
async function runRepairJob(payload, anthropicApiKey) {
  const {
    jobId,
    repo, // "owner/name"
    githubToken,
    branch,
    callbackUrl,
    callbackToken,
    runningUrl,
    envCause = false,
  } = payload;

  const start = Date.now();
  console.log(`[repair ${jobId}] start: ${repo} branch=${branch} envCause=${envCause} keyPresent=${Boolean(anthropicApiKey)}`);

  // Ack running (best effort — the Worker treats queued/running the same for
  // the 409 guard; a lost ack only affects dashboard status granularity).
  if (runningUrl) {
    await postCallback(runningUrl, callbackToken, { jobId }).catch((err) => {
      console.error(`[repair ${jobId}] running ack failed:`, err?.message ?? err);
    });
  }

  const workDir = await fs.mkdtemp(path.join(WORK_ROOT, `repair-${jobId}-`));
  try {
    // 1. Shallow clone with the resolved token (user OAuth, or the GitHub App
    //    installation token the Worker minted for a private repo).
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${repo}.git`;
    try {
      await execFileP("git", ["clone", "--depth", "1", cloneUrl, workDir], { timeout: 90_000 });
    } catch (cloneErr) {
      const detail = String(cloneErr?.stderr ?? cloneErr?.message ?? cloneErr);
      if (classifyCloneError(detail) === "access_denied") {
        // Stable prefix — the dashboard renders the non-dev guidance card off
        // this. Never echo git's stderr here (it embeds the clone URL + token).
        throw new Error(
          `repo_access_denied: ${repo} 저장소를 읽을 수 없어요 (비공개 저장소이거나 접근 권한이 없음)`,
        );
      }
      throw cloneErr;
    }

    // Base branch = whatever the clone checked out (the repo default).
    const baseBranch = (
      await execFileP("git", ["-C", workDir, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 10_000 })
    ).stdout.trim();

    // 2. Repair branch. Deterministic name per run — a retry after a failed
    //    earlier attempt force-pushes the same branch instead of erroring.
    await execFileP("git", ["-C", workDir, "checkout", "-b", branch], { timeout: 10_000 });

    // 3. Stage 270 — attempt the real fix. Any failure inside resets the
    //    tree and returns null → brief-only fallback below.
    let autoFix = null;
    // auto_fix 정직성: attemptAutoFix가 왜 포기했는지의 out-param — brief_only
    // 콜백의 modeReason과 draft PR 본문의 정직 노트가 여기서 나온다.
    const diag = { skippedOversize: [], reason: null };
    if (anthropicApiKey) {
      try {
        autoFix = await attemptAutoFix({ workDir, payload, anthropicApiKey, diag });
      } catch (err) {
        console.error(
          `[repair ${jobId}] auto-fix crashed (falling back to brief-only):`,
          redactSecret(err?.message ?? String(err), githubToken),
        );
        autoFix = null;
      }
      if (!autoFix) await resetWorkTree(workDir);
    }
    const mode = autoFix ? "auto_fix" : "brief_only";
    const changedFiles = autoFix ? autoFix.changedFiles : [];
    // brief_only 폴백의 사유 — 키 부재는 diag를 거치지 않으므로 직접 명명.
    let modeReason = null;
    let briefPrNote = null;
    if (!autoFix) {
      if (!anthropicApiKey) {
        modeReason = "no_anthropic_key";
      } else {
        const d = buildBriefOnlyDiagnosis(diag);
        // diag.reason이 워커 에러 메시지를 담을 수 있다 — 콜백에 나가기 전
        // 토큰을 반드시 걸러낸다(에러 문자열은 신뢰 경계 밖으로 취급).
        modeReason = redactSecret(d.modeReason, githubToken);
        briefPrNote = d.prNote;
      }
    }
    console.log(`[repair ${jobId}] mode=${mode} changedFiles=${changedFiles.length}${modeReason ? ` reason=${modeReason}` : ""}`);

    // 4. Commit. Both modes carry SIMSA-FIX-BRIEF.md (the repair's evidence
    //    + instructions); auto_fix additionally commits the worker's changes.
    const briefContent = buildRepairPrContent(payload);
    let title = briefContent.title;
    let body = briefContent.body;
    let commitArgs = ["-m", briefContent.title];
    if (autoFix) {
      const prContent = autoFix.prContent;
      title = prContent.title;
      body = prContent.body;
      commitArgs = ["-m", prContent.commitMessage, "-m", prContent.commitBody];
    } else if (briefPrNote) {
      // 정직 노트: 크기 한도로 스킵된 핵심 파일이 있으면 draft PR 본문에 밝힌다
      // (사용자는 왜 코드 수정이 아닌 지시서인지 알 권리가 있다).
      body = `${body}\n\n${briefPrNote}`;
    }
    await fs.writeFile(path.join(workDir, briefContent.briefFileName), briefContent.briefContent, "utf8");
    await execFileP("git", ["-C", workDir, "config", "user.name", "simsa-repair[bot]"]);
    await execFileP("git", ["-C", workDir, "config", "user.email", "simsa-repair@trysimsa.com"]);
    await execFileP(
      "git",
      ["-C", workDir, "add", briefContent.briefFileName, ...changedFiles],
      { timeout: 10_000 },
    );
    await execFileP("git", ["-C", workDir, "commit", ...commitArgs], { timeout: 10_000 });
    await execFileP("git", ["-C", workDir, "push", "--force", "origin", `HEAD:${branch}`], { timeout: 60_000 });
    console.log(`[repair ${jobId}] pushed ${branch} (base ${baseBranch})`);

    // 5. PR via the REST API. auto_fix → NON-draft (real code changed);
    //    brief_only → draft (Stage 268 semantics). If a PR for this head
    //    already exists (retry path), reuse it + refresh title/body.
    const pr = await createOrReuseRepairPr({
      repo,
      token: githubToken,
      head: branch,
      base: baseBranch,
      title,
      body,
      draft: mode !== "auto_fix",
    });
    console.log(`[repair ${jobId}] PR ready: #${pr.number} ${pr.html_url}`);

    // 6. Report done.
    await postCallback(callbackUrl, callbackToken, {
      jobId,
      ok: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch,
      envCause: envCause === true,
      mode,
      changedFiles: changedFiles.length,
      ...(modeReason ? { modeReason } : {}),
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = redactSecret(err?.message ?? String(err), githubToken);
    console.error(`[repair ${jobId}] failed:`, message);
    await postCallback(callbackUrl, callbackToken, {
      jobId,
      ok: false,
      error: message.slice(0, 500),
      durationMs: Date.now() - start,
    });
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[repair ${jobId}] cleanup failed:`, cleanupErr);
    }
  }
}

// --- Stage 270: auto-fix executor -------------------------------------------

/** Bounds for the worker-agent loop (Stage 270 spec). */
const AUTO_FIX_MAX_ITERATIONS = 3;
const AUTO_FIX_DEADLINE_MS = 5 * 60 * 1000;
/** Per-snapshot read cap — anything bigger blows the worker prompt budget. */
const AUTO_FIX_MAX_SNAPSHOT_BYTES = 200 * 1024;

/** `git reset --hard && git clean -fd` — restore a pristine tree after any failed attempt. */
async function resetWorkTree(workDir) {
  await execFileP("git", ["-C", workDir, "reset", "--hard", "HEAD"], { timeout: 30_000 });
  await execFileP("git", ["-C", workDir, "clean", "-fd"], { timeout: 30_000 });
}

/**
 * Cheap post-apply sanity check: `node --check` on every changed plain-JS
 * file. Deliberately NOT a universal CI — a fresh clone has no node_modules,
 * so builds/tests can't run; a syntax-valid rewrite is the honest bar here.
 * Non-JS files (ts/tsx/css/html/...) are skipped.
 */
async function quickSyntaxCheck(workDir, changedFiles) {
  for (const rel of changedFiles) {
    if (!/\.(js|mjs|cjs)$/i.test(rel)) continue;
    try {
      await execFileP(process.execPath, ["--check", path.join(workDir, rel)], { timeout: 15_000 });
    } catch (err) {
      return { ok: false, file: rel, detail: String(err?.stderr ?? err?.message ?? err).slice(0, 300) };
    }
  }
  return { ok: true };
}

/**
 * Drive the REAL worker agent (ClaudeWorker.work) with the parsed Simsa fix
 * brief. Contract (packages/agent-worker):
 *
 *   worker.work({ repo, pullNumber, newSha, reviews, fileSnapshots, ... })
 *     → { rewrites: [{path, content}], message, appliedFiles, ... }
 *
 * The worker emits FULL-FILE rewrites (v0.14+ — no unified diffs), so
 * "applying" is a sanitized overwrite; the legacy git-apply/GNU-patch fuzz
 * path is not involved. Bounded: AUTO_FIX_MAX_ITERATIONS worker calls inside
 * AUTO_FIX_DEADLINE_MS, each with the next ranked snapshot batch (the
 * outcome does not surface the model's free-text file requests, so retries
 * rotate the snapshot window instead).
 *
 * Returns { changedFiles, prContent } on success, or null when the brief /
 * worker produced nothing applicable — callers reset the tree + fall back
 * to brief-only. Never leaves a dirty tree on the null path.
 */
async function attemptAutoFix({ workDir, payload, anthropicApiKey, diag = { skippedOversize: [], reason: null } }) {
  const jobId = payload.jobId;
  const deadline = Date.now() + AUTO_FIX_DEADLINE_MS;

  // Canonical brief helpers — compiled in-image from
  // apps/central-plane/src/workspace/repair-brief.ts (see Dockerfile).
  const brief = await import(new URL("./container-dist/repair-brief.js", import.meta.url).href);
  const parsed = brief.parseRepairBrief(payload.agentPrompt);
  const decision = brief.decideRepairMode({
    hasAnthropicKey: true,
    findingsCount: parsed.findings.length,
  });
  if (decision.mode !== "auto_fix") {
    console.log(`[repair ${jobId}] auto-fix skipped: ${decision.reason}`);
    diag.reason = decision.reason;
    return null;
  }

  // Repo inventory + ranked snapshot candidates.
  const lsFiles = await execFileP("git", ["-C", workDir, "ls-files"], {
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const repoFiles = lsFiles.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const ranked = brief.rankSnapshotCandidates(parsed, repoFiles);
  if (ranked.length === 0) {
    console.log(`[repair ${jobId}] auto-fix skipped: no snapshot candidates in repo`);
    diag.reason = "no_snapshot_candidates";
    return null;
  }

  const headSha = (
    await execFileP("git", ["-C", workDir, "rev-parse", "HEAD"], { timeout: 10_000 })
  ).stdout.trim();
  const review = brief.buildRepairReview(parsed, { repoFiles });

  // The worker agent — same dist layout the autofix path uses for cli.
  const { ClaudeWorker } = await import("file:///app/packages/agent-worker/dist/index.js");
  const worker = new ClaudeWorker({ apiKey: anthropicApiKey });

  for (let iteration = 0; iteration < AUTO_FIX_MAX_ITERATIONS; iteration++) {
    if (Date.now() >= deadline) {
      console.log(`[repair ${jobId}] auto-fix deadline reached at iteration ${iteration}`);
      break;
    }
    const batch = brief.pickSnapshotBatch(ranked, iteration);
    if (batch.length === 0) break;

    const fileSnapshots = [];
    const originals = {};
    for (const rel of batch) {
      try {
        const stat = await fs.stat(path.join(workDir, rel));
        if (stat.size > AUTO_FIX_MAX_SNAPSHOT_BYTES) {
          // auto_fix 정직성: 크기 한도로 스킵된 파일을 기록한다 — 단일 대형
          // index.html(vibe 툴 전형)에서 워커가 앱의 유일한 실코드를 본 적도
          // 없이 brief_only가 되는 케이스(apply-walmart 389KB 실측)를 사용자와
          // 운영자 모두에게 드러내기 위함.
          diag.skippedOversize.push({ path: rel, bytes: stat.size });
          continue;
        }
        const contents = await fs.readFile(path.join(workDir, rel), "utf8");
        fileSnapshots.push({ path: rel, contents });
        originals[rel] = contents;
      } catch {
        // unreadable file — skip it, the batch still proceeds
      }
    }
    if (fileSnapshots.length === 0) continue;

    let outcome;
    try {
      outcome = await worker.work({
        repo: payload.repo,
        pullNumber: 0, // repair runs pre-PR; prompt context only
        newSha: headSha,
        reviews: [review],
        fileSnapshots,
      });
    } catch (err) {
      console.error(`[repair ${jobId}] worker call failed (iter ${iteration}):`, err?.message ?? err);
      // 실패 클래스만으론 진단이 안 된다(apply-walmart 실측 — 원인 불명의
      // worker_call_failed). 메시지 앞부분을 싣는다; 토큰류는 runRepairJob이
      // 콜백 직전에 redactSecret으로 걸러낸다.
      diag.reason = `worker_call_failed: ${String(err?.message ?? err).slice(0, 100)}`;
      continue;
    }
    if (!Array.isArray(outcome.rewrites) || outcome.rewrites.length === 0) {
      console.log(`[repair ${jobId}] worker returned no rewrites (iter ${iteration})`);
      diag.reason = "worker_returned_no_rewrites";
      continue;
    }

    const { accepted, rejected } = brief.sanitizeRewrites(outcome.rewrites, repoFiles, originals);
    if (rejected.length > 0) {
      console.log(
        `[repair ${jobId}] sanitizer rejected ${rejected.length} rewrite(s): ` +
          rejected.map((r) => `${r.path}:${r.reason}`).join(", "),
      );
    }
    if (accepted.length === 0) {
      diag.reason = "rewrites_rejected_by_sanitizer";
      continue;
    }

    for (const rw of accepted) {
      await fs.writeFile(path.join(workDir, rw.path), rw.content, "utf8");
    }

    // Real-change gate: the worker may return byte-identical content.
    const diff = await execFileP("git", ["-C", workDir, "diff", "--name-only"], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const changedFiles = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (changedFiles.length === 0) {
      console.log(`[repair ${jobId}] rewrites were no-ops (iter ${iteration})`);
      diag.reason = "rewrites_were_noops";
      continue;
    }

    const verify = await quickSyntaxCheck(workDir, changedFiles);
    if (!verify.ok) {
      console.error(`[repair ${jobId}] syntax check failed on ${verify.file}: ${verify.detail}`);
      diag.reason = "syntax_check_failed";
      await resetWorkTree(workDir);
      continue;
    }

    const prContent = brief.buildAutoFixPrContent({
      runId: payload.visualCheckId ?? jobId,
      intent: payload.intent,
      decision: payload.decision,
      targetUrl: payload.targetUrl,
      visualCheckId: payload.visualCheckId,
      envCause: payload.envCause === true,
      findings: parsed.findings,
      changedFiles,
      workerCommitMessage: outcome.message,
    });
    console.log(
      `[repair ${jobId}] auto-fix applied: ${changedFiles.length} file(s) after ${iteration + 1} iteration(s)`,
    );
    return { changedFiles, prContent };
  }

  // Oversize ladder rung: the full-file loop produced nothing AND at least
  // one candidate was skipped for size (apply-walmart class — a single huge
  // index.html holding the app's only real code). Try the excerpt+exact-edit
  // path before giving up. Engages ONLY here, so every previously-green path
  // is byte-identical to before this rung existed.
  if (diag.skippedOversize.length > 0 && Date.now() < deadline) {
    const editFix = await attemptOversizeEditFix({
      workDir,
      payload,
      brief,
      parsed,
      review,
      worker,
      repoFiles,
      headSha,
      diag,
    });
    if (editFix) return editFix;
  }
  return null;
}

/**
 * Excerpt + exact-edit attempt for files above AUTO_FIX_MAX_SNAPSHOT_BYTES.
 * One bounded worker call (no iteration loop): deterministic excerpts around
 * the brief's evidence tokens go to ClaudeWorker.workEdits; returned
 * search/replace edits are applied ONLY when each search matches exactly
 * once (applyExactEdits) — a bad edit is rejected, never a corrupted file.
 * Returns { changedFiles, prContent } or null (caller resets the tree).
 */
async function attemptOversizeEditFix({ workDir, payload, brief, parsed, review, worker, repoFiles, headSha, diag }) {
  const jobId = payload.jobId;

  // Rank order was preserved when skippedOversize was recorded; dedupe and
  // keep the top 2 files (excerpt budget is per-call, not per-file).
  const seen = new Set();
  const targets = [];
  for (const s of diag.skippedOversize) {
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    targets.push(s);
    if (targets.length >= 2) break;
  }

  const tokens = brief.extractEvidenceTokens(parsed);
  const fileExcerpts = [];
  const originals = {};
  for (const t of targets) {
    try {
      const content = await fs.readFile(path.join(workDir, t.path), "utf8");
      const regions = brief.buildOversizeExcerpts(content, tokens);
      if (regions.length === 0) continue;
      originals[t.path] = content;
      fileExcerpts.push({
        path: t.path,
        totalBytes: t.bytes,
        totalLines: content.split("\n").length,
        regions,
      });
    } catch {
      // unreadable file — skip
    }
  }
  if (fileExcerpts.length === 0) {
    diag.reason = "oversize_excerpts_empty";
    return null;
  }

  console.log(
    `[repair ${jobId}] oversize edit attempt: ${fileExcerpts
      .map((f) => `${f.path}(${f.regions.length} region(s))`)
      .join(", ")}`,
  );

  let outcome;
  try {
    outcome = await worker.workEdits({
      repo: payload.repo,
      pullNumber: 0,
      newSha: headSha,
      reviews: [review],
      fileExcerpts,
    });
  } catch (err) {
    console.error(`[repair ${jobId}] edit worker call failed:`, err?.message ?? err);
    diag.reason = `edit_worker_call_failed: ${String(err?.message ?? err).slice(0, 100)}`;
    return null;
  }
  if (!Array.isArray(outcome.edits) || outcome.edits.length === 0) {
    console.log(`[repair ${jobId}] edit worker returned no edits`);
    diag.reason = "edit_worker_returned_no_edits";
    return null;
  }

  const { contents, applied, rejected } = brief.applyExactEdits(originals, outcome.edits);
  if (rejected.length > 0) {
    console.log(
      `[repair ${jobId}] edit(s) rejected: ` + rejected.map((r) => `${r.path}:${r.reason}`).join(", "),
    );
  }
  if (applied.length === 0) {
    diag.reason = `edits_rejected: ${rejected.map((r) => r.reason).join(",")}`.slice(0, 120);
    return null;
  }

  const appliedPaths = [...new Set(applied.map((a) => a.path))];
  for (const p of appliedPaths) {
    await fs.writeFile(path.join(workDir, p), contents[p], "utf8");
  }

  // Same gates as the full-file path: real change + JS syntax check.
  const diff = await execFileP("git", ["-C", workDir, "diff", "--name-only"], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const changedFiles = diff.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (changedFiles.length === 0) {
    diag.reason = "edits_were_noops";
    return null;
  }
  const verify = await quickSyntaxCheck(workDir, changedFiles);
  if (!verify.ok) {
    console.error(`[repair ${jobId}] edit syntax check failed on ${verify.file}: ${verify.detail}`);
    diag.reason = "edit_syntax_check_failed";
    await resetWorkTree(workDir);
    return null;
  }

  const prContent = brief.buildAutoFixPrContent({
    runId: payload.visualCheckId ?? jobId,
    intent: payload.intent,
    decision: payload.decision,
    targetUrl: payload.targetUrl,
    visualCheckId: payload.visualCheckId,
    envCause: payload.envCause === true,
    findings: parsed.findings,
    changedFiles,
    workerCommitMessage: outcome.message,
    editedOversizeFiles: appliedPaths,
  });
  console.log(
    `[repair ${jobId}] oversize edit applied: ${applied.length} edit(s) across ${appliedPaths.length} file(s)`,
  );
  return { changedFiles, prContent };
}

/**
 * Create the repair PR (draft for brief-only, non-draft for auto-fix),
 * falling back gracefully:
 *   - 422 "already exists" → reuse the existing open PR for the head and
 *     refresh its title/body (retry-safe on the same branch; a draft PR
 *     stays draft — REST cannot un-draft)
 *   - 422 mentioning draft (plan doesn't support draft PRs) → retry non-draft
 */
async function createOrReuseRepairPr({ repo, token, head, base, title, body, draft = true }) {
  const apiHeaders = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "simsa-repair",
  };
  const owner = repo.split("/")[0];

  const create = async (asDraft) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ title, head, base, body, draft: asDraft }),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };

  let res = await create(draft);
  if (res.status === 422) {
    const detail = JSON.stringify(res.json.errors ?? res.json.message ?? "");
    if (/already exists/i.test(detail)) {
      const list = await fetch(
        `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`,
        { headers: apiHeaders },
      );
      const pulls = list.ok ? await list.json().catch(() => []) : [];
      if (Array.isArray(pulls) && pulls[0]?.html_url) {
        const existing = pulls[0];
        // Refresh title/body so a retry (or brief-only → auto-fix upgrade)
        // is reflected on the reused PR. Best effort — the PR itself is fine
        // even if the PATCH fails.
        await fetch(`https://api.github.com/repos/${repo}/pulls/${existing.number}`, {
          method: "PATCH",
          headers: apiHeaders,
          body: JSON.stringify({ title, body }),
        }).catch(() => {});
        return existing;
      }
    }
    if (/draft/i.test(detail)) {
      res = await create(false);
    }
  }
  if (res.status !== 201) {
    throw new Error(`PR create failed: ${res.status} ${JSON.stringify(res.json.message ?? res.json).slice(0, 300)}`);
  }
  return res.json;
}

/**
 * Poll GH check-runs for the deploy preview's terminal status.
 *
 * Why: Vercel / Netlify / Cloudflare preview builds run async and
 * usually finish 60-120s after the PR push. Conclave's review fires
 * within seconds of webhook, so a single fetchDeployStatus call almost
 * always sees `pending` and the council never learns that the deploy
 * actually failed. The whole "review = deploy + code together" promise
 * hinges on this wait.
 *
 * Returns the GH conclusion (`success` | `failure` | `cancelled` | etc)
 * or `"timeout"` if the wait window expires.
 *
 * Cap: 120s. Beyond that we let the council decide on code alone — the
 * Sprint 2 follow-up will be a `commit_status` webhook that re-fires
 * the review when Vercel finishes late.
 */
async function waitForDeployStatus(repo, sha, token, timeoutMs = 120_000) {
  if (!sha || !repo) return "no-sha";
  const start = Date.now();
  const intervalMs = 8_000;
  // GH App installation tokens hit the same /repos/.../check-runs
  // endpoint a user PAT does — `metadata: read` is enough.
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "conclave-ai-code-council",
          },
        },
      );
      if (r.ok) {
        const j = await r.json();
        const runs = Array.isArray(j?.check_runs) ? j.check_runs : [];
        // Match any deploy-platform check (Vercel, Netlify, Cloudflare
        // Workers/Pages, Render, etc). Names are platform-controlled
        // so a contains-check is the most robust.
        const deployRun = runs.find((c) =>
          /vercel|netlify|cloudflare|deploy|preview/i.test(c?.name ?? ""),
        );
        if (deployRun && deployRun.status === "completed") {
          return deployRun.conclusion ?? "completed";
        }
      }
    } catch {
      // network blip — keep polling
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return "timeout";
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

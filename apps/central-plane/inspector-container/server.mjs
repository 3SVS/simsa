#!/usr/bin/env node
/**
 * Stage 263 — SimsaInspector container: HTTP server entry.
 *
 * Spawned per visual-check run by the Worker (INSPECTOR Durable Object).
 * Listens on PORT (default 8080), accepts POST /run with the job payload,
 * executes the Playwright deep-flow inspection (inspector-run.mjs), uploads
 * evidence to the Stage 261 evidence endpoint, and reports the verdict to the
 * Worker's /internal/visual-check-done callback.
 *
 * Mirrors container/server.mjs (the autofix sandbox shim): thin node:http
 * server, 202 ack + async work, SIGTERM drain so killed-mid-run jobs still
 * produce a failed callback instead of a silently stuck row.
 *
 * PRIVACY: userKey and callbackToken are never logged — log lines carry only
 * the runId.
 */
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_ROOT ?? "/var/lib/simsa";
/** Total wall-clock budget for one inspection (browser phase). */
const INSPECTION_TIMEOUT_MS = 4 * 60 * 1000;

/** Required job payload fields (Worker's dispatchInspection contract). */
const REQUIRED_FIELDS = ["runId", "projectId", "userKey", "targetUrl", "intent", "baseUrl", "callbackUrl", "callbackToken"];

export function validateJobPayload(payload) {
  const missing = REQUIRED_FIELDS.filter(
    (f) => typeof payload?.[f] !== "string" || payload[f].length === 0,
  );
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// In-flight registry, drained on SIGTERM (deploy rollouts / sleepAfter kills).
const inFlightRuns = new Map();

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

  const validation = validateJobPayload(payload);
  if (!validation.ok) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `missing fields: ${validation.missing.join(", ")}` }));
    return;
  }

  // Ack immediately; the inspection runs async and reports via callbacks.
  res.writeHead(202, { "content-type": "application/json" });
  res.end(JSON.stringify({ runId: payload.runId, status: "accepted" }));

  inFlightRuns.set(payload.runId, payload);
  runJob(payload)
    .catch(async (err) => {
      console.error(`[run ${payload.runId}] crashed:`, err);
      await postJson(payload.callbackUrl, payload.callbackToken, {
        runId: payload.runId,
        ok: false,
        error: String(err?.message ?? err).slice(0, 500),
      }).catch((cbErr) => {
        console.error(`[run ${payload.runId}] callback also failed:`, cbErr);
      });
    })
    .finally(() => inFlightRuns.delete(payload.runId));
});

server.listen(PORT, () => {
  console.log(`simsa-inspector listening on :${PORT}`);
});

// Graceful shutdown — mirror container/server.mjs. Cap the drain at 5s.
let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${sig} — draining ${inFlightRuns.size} in-flight run(s)`);
  const drains = Array.from(inFlightRuns.values()).map((p) =>
    postJson(p.callbackUrl, p.callbackToken, {
      runId: p.runId,
      ok: false,
      error: `inspector container was killed by ${sig} mid-run (deploy rollout or sleepAfter)`,
    }).catch((cbErr) => {
      console.error(`[shutdown] callback failed for ${p.runId}:`, cbErr);
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

// --- Job runner -------------------------------------------------------------

async function runJob(payload) {
  const { runId, projectId, userKey, targetUrl, intent, baseUrl, callbackUrl, callbackToken, runningUrl } = payload;
  // Report language, dispatched with the job. Older Workers won't send it —
  // fall back to "ko" rather than trusting an arbitrary value off the wire.
  const locale = payload.locale === "en" ? "en" : "ko";
  const start = Date.now();
  console.log(`[run ${runId}] start (target host: ${safeHost(targetUrl)})`);

  // queued → running (best-effort; the inspection proceeds regardless).
  if (typeof runningUrl === "string" && runningUrl) {
    await postJson(runningUrl, callbackToken, { runId }).catch((err) => {
      console.error(`[run ${runId}] running-ack failed:`, err?.message ?? err);
    });
  }

  const outDir = await fs.mkdtemp(path.join(WORK_ROOT, `vc-`));
  try {
    // Lazy import keeps startup fast and lets a broken Playwright install
    // surface as a per-run failure callback instead of a dead container.
    const { runInspection } = await import("./inspector-run.mjs");

    // Wall-clock rail: Chromium hangs (infinite spinners, slow hosts) must
    // not exceed ~4 minutes. On timeout the run is reported failed; the
    // leaked browser (if any) dies with the container's sleepAfter.
    const result = await withTimeout(
      runInspection({ targetUrl, intent, outDir, locale }),
      INSPECTION_TIMEOUT_MS,
      `inspection timed out after ${Math.round(INSPECTION_TIMEOUT_MS / 1000)}s`,
    );

    // 1) Upload evidence through the EXISTING Stage 261 endpoint (it
    //    validates names + sizes server-side). Failures are non-fatal —
    //    the report is still worth delivering.
    let uploaded = 0;
    for (const file of result.evidenceFiles) {
      try {
        const bytes = readFileSync(file.path);
        const url =
          `${baseUrl}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/evidence` +
          `?userKey=${encodeURIComponent(userKey)}&name=${encodeURIComponent(file.name)}`;
        const r = await fetch(url, { method: "POST", body: bytes });
        if (r.ok) uploaded += 1;
        else console.error(`[run ${runId}] evidence upload ${file.name} → ${r.status}`);
      } catch (err) {
        console.error(`[run ${runId}] evidence upload ${file.name} failed:`, err?.message ?? err);
      }
    }
    console.log(`[run ${runId}] evidence uploaded ${uploaded}/${result.evidenceFiles.length}`);

    // 2) Final verdict callback.
    await postJson(callbackUrl, callbackToken, {
      runId,
      ok: true,
      decision: result.decision,
      works: result.works,
      report: result.report,
      agentPrompt: result.agentPrompt,
    });
    console.log(`[run ${runId}] done (decision=${result.decision}, ${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[run ${runId}] failed:`, err);
    await postJson(callbackUrl, callbackToken, {
      runId,
      ok: false,
      error: String(err?.message ?? err).slice(0, 500),
    });
  } finally {
    try {
      await fs.rm(outDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[run ${runId}] cleanup failed:`, cleanupErr);
    }
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

async function postJson(url, token, body) {
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
    throw new Error(`callback returned ${r.status}: ${tail.slice(0, 300)}`);
  }
}

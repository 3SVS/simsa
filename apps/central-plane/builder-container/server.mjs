#!/usr/bin/env node
/**
 * SI 티어 Train B — B1: SimsaBuilder 컨테이너 HTTP 진입점.
 *
 * Worker(BUILDER Durable Object)가 잡 하나당 인스턴스 하나를 띄우고 이 서버에 말한다.
 * inspector-container/server.mjs와 같은 골격: 얇은 node:http, 202 ack + 비동기 실행,
 * SIGTERM 드레인(롤아웃·sleepAfter로 죽어도 콜백은 남긴다).
 *
 *   GET  /health     — 살아 있나 + RUNNER_REV(옛 이미지 서빙 판별)
 *   GET  /selfcheck  — 툴체인 자가점검을 **동기**로 돌려 JSON 반환(B1 완료 조건: 30초 내 pnpm -v).
 *                      Worker의 /internal/builder/selfcheck가 이걸 호출한다.
 *   POST /run        — 잡 페이로드(validateJobPayload) → 202 → runBuildJob → callbackUrl로 결과.
 *
 * PRIVACY: userKey·callbackToken·운영 토큰은 로그에 쓰지 않는다 — 로그 줄에는 jobId만.
 */
import { createServer } from "node:http";
import { RUNNER_REV, runBuildJob, selfCheck, validateJobPayload } from "./builder-run.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_ROOT ?? "/var/lib/simsa-build";
/** D-4 [PILOT] 잡 전체 45분 상한 — B5의 상태 머신이 단계별 예산을 더 잘게 나눈다. */
const JOB_TIMEOUT_MS = 45 * 60 * 1000;

const inFlightJobs = new Map();

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { ok: true, runnerRev: RUNNER_REV, ts: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && req.url === "/selfcheck") {
    try {
      const result = await selfCheck({ workRoot: WORK_ROOT });
      json(res, result.ok ? 200 : 503, result);
    } catch (err) {
      json(res, 500, { ok: false, runnerRev: RUNNER_REV, error: String(err?.message ?? err).slice(0, 300) });
    }
    return;
  }

  if (req.method !== "POST" || req.url !== "/run") {
    json(res, 404, { error: "GET /health · GET /selfcheck · POST /run only" });
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    json(res, 400, { error: "invalid JSON body", detail: err.message });
    return;
  }
  const validation = validateJobPayload(payload);
  if (!validation.ok) {
    json(res, 400, { error: `missing fields: ${validation.missing.join(", ")}` });
    return;
  }

  json(res, 202, { jobId: payload.jobId, status: "accepted", runnerRev: RUNNER_REV });

  inFlightJobs.set(payload.jobId, payload);
  runJob(payload).finally(() => inFlightJobs.delete(payload.jobId));
});

server.listen(PORT, () => {
  console.log(`simsa-builder ${RUNNER_REV} listening on :${PORT}`);
});

let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${sig} — draining ${inFlightJobs.size} in-flight job(s)`);
  const drains = Array.from(inFlightJobs.values()).map((p) =>
    postJson(p.callbackUrl, p.callbackToken, {
      jobId: p.jobId,
      ok: false,
      stage: "failed",
      error: `builder container was killed by ${sig} mid-job (deploy rollout or sleepAfter)`,
    }).catch((cbErr) => console.error(`[shutdown] callback failed for ${p.jobId}:`, cbErr?.message ?? cbErr)),
  );
  await Promise.race([Promise.all(drains), new Promise((r) => setTimeout(r, 5000))]);
  server.close(() => process.exit(0));
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => void gracefulShutdown(sig));
}

// --- Job runner -------------------------------------------------------------

async function runJob(payload) {
  const { jobId, callbackUrl, callbackToken } = payload;
  const start = Date.now();
  console.log(`[job ${jobId}] start kind=${String(payload.kind).slice(0, 20)}`);
  try {
    const result = await withTimeout(
      runBuildJob(payload, { workRoot: WORK_ROOT }),
      JOB_TIMEOUT_MS,
      `build job timed out after ${Math.round(JOB_TIMEOUT_MS / 60000)} min`,
    );
    await postJson(callbackUrl, callbackToken, result);
    console.log(`[job ${jobId}] ${result.stage} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[job ${jobId}] failed:`, err?.message ?? err);
    await postJson(callbackUrl, callbackToken, {
      jobId,
      ok: false,
      stage: "failed",
      failedAt: typeof err?.stage === "string" ? err.stage : "unknown",
      error: String(err?.message ?? err).slice(0, 500),
    }).catch((cbErr) => console.error(`[job ${jobId}] callback also failed:`, cbErr?.message ?? cbErr));
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function postJson(url, token, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const tail = await r.text();
    throw new Error(`callback returned ${r.status}: ${tail.slice(0, 300)}`);
  }
}

#!/usr/bin/env node
/**
 * SI 티어 Train B — SimsaBuilder 컨테이너 HTTP 진입점.
 *
 * Worker(BUILDER Durable Object)가 잡 하나당 인스턴스 하나를 띄우고 이 서버에 말한다.
 * inspector-container/server.mjs와 같은 골격: 얇은 node:http, 202 ack + 비동기 실행,
 * SIGTERM 드레인(롤아웃·sleepAfter로 죽어도 콜백은 남긴다).
 *
 *   GET  /health     — 살아 있나 + RUNNER_REV(옛 이미지 서빙 판별)
 *   GET  /selfcheck  — 툴체인·agent-worker·템플릿 자가점검을 **동기**로 돌려 JSON 반환.
 *                      Worker의 /internal/builder/selfcheck가 이걸 호출한다.
 *   POST /run        — 잡 페이로드(validateJobPayload, kind=build면 validateBuildPayload까지) → 202 →
 *                      runBuildJob(진행은 progressUrl로) → 최종 본문을 callbackUrl(/internal/build-done)로.
 *
 * 실패 본문은 builder-run.mjs failureCallbackBody 하나로 만든다 — Worker가 읽는 키는 `failedStage`다
 * (B-5b-1 이전에는 다른 키 이름으로 보내서 Worker가 무시했고, 모든 실패가 'unknown' 단계로 기록됐다).
 *
 * PRIVACY: userKey·callbackToken·운영 토큰은 로그에 쓰지 않는다 — 로그 줄에는 jobId만.
 */
import { createServer } from "node:http";
import {
  RUNNER_REV,
  failureCallbackBody,
  postCallback,
  runBuildJob,
  selfCheck,
  validateBuildPayload,
  validateJobPayload,
} from "./builder-run.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_ROOT ?? "/var/lib/simsa-build";
/** D-4 [PILOT] 잡 전체 45분 상한 — 단계별 예산은 B-5b-2~5에서 더 잘게 나눈다. */
const JOB_TIMEOUT_MS = 45 * 60 * 1000;

/** jobId → { payload, stage } — stage는 runBuildJob의 onStage로 갱신(드레인·타임아웃 본문의 failedStage). */
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
  // kind=build는 202 전에 전부 검사한다 — 거절이 동기로 돌아가야 Worker의 dispatchBuild가 즉시 failed(queued)를 기록한다.
  if (payload.kind === "build") {
    const vb = validateBuildPayload(payload);
    if (!vb.ok) {
      json(res, 400, { error: `invalid build payload: ${vb.errors.join(", ")}` });
      return;
    }
  }

  json(res, 202, { jobId: payload.jobId, status: "accepted", runnerRev: RUNNER_REV });

  const entry = { payload, stage: "queued" };
  inFlightJobs.set(payload.jobId, entry);
  runJob(entry).finally(() => inFlightJobs.delete(payload.jobId));
});

server.listen(PORT, () => {
  console.log(`simsa-builder ${RUNNER_REV} listening on :${PORT}`);
});

let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${sig} — draining ${inFlightJobs.size} in-flight job(s)`);
  const drains = Array.from(inFlightJobs.values()).map(async ({ payload: p, stage }) => {
    const bodyOut = failureCallbackBody(p.jobId, new Error(`builder container was killed by ${sig} mid-job (deploy rollout or sleepAfter)`), stage);
    const r = await postCallback(p.callbackUrl, p.callbackToken, bodyOut, { retries: 0 });
    if (!r.ok) console.error(`[shutdown] callback failed for ${p.jobId}: ${r.error}`);
  });
  await Promise.race([Promise.all(drains), new Promise((r) => setTimeout(r, 5000))]);
  server.close(() => process.exit(0));
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => void gracefulShutdown(sig));
}

// --- Job runner -------------------------------------------------------------

async function runJob(entry) {
  const { jobId, callbackUrl, callbackToken } = entry.payload;
  const start = Date.now();
  console.log(`[job ${jobId}] start kind=${String(entry.payload.kind).slice(0, 20)}`);
  let result;
  try {
    result = await withTimeout(
      runBuildJob(entry.payload, { workRoot: WORK_ROOT, onStage: (s) => { entry.stage = s; } }),
      JOB_TIMEOUT_MS,
      `build job timed out after ${Math.round(JOB_TIMEOUT_MS / 60000)} min`,
    );
  } catch (err) {
    console.error(`[job ${jobId}] failed at ${entry.stage}:`, err?.message ?? err);
    result = failureCallbackBody(jobId, err, entry.stage);
  }
  const r = await postCallback(callbackUrl, callbackToken, result);
  if (!r.ok) console.error(`[job ${jobId}] final callback failed: ${r.error}`);
  console.log(`[job ${jobId}] ${result.stage}${result.failedStage ? `(${result.failedStage})` : ""} (${Date.now() - start}ms)`);
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

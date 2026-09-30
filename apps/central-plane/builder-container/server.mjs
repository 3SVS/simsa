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
 * 잡 하나의 수명은 builder-run.mjs **startJob**이 쥔다: 45분 마감이면 러너를 멈추고(AbortSignal) 그 단계의
 * 실패 본문, SIGTERM 드레인은 job.abort()의 같은 모양 본문, 러너 예외도 단계를 싣는다
 * (PR #569 검증 결함 6 — 종전 withTimeout은 경쟁만 해서 러너가 뒤에서 계속 돌았다). 지출은 Worker의 LLM 프록시가
 * 서버에서 계량한다(B-5b S1) — 본문에 싣지 않는다.
 * 실패 본문은 failureCallbackBody 하나로 만든다 — Worker가 읽는 키는 `failedStage`다
 * (B-5b-1 이전에는 다른 키 이름으로 보내서 Worker가 무시했고, 모든 실패가 'unknown' 단계로 기록됐다).
 * 최종 콜백은 잡마다 **한 번**(entry.reported) — 드레인이 먼저 보냈으면 runJob은 보내지 않는다.
 *
 * PRIVACY: jobToken은 로그에 쓰지 않는다 — 로그 줄에는 jobId만. B-5b S1부터 페이로드에 운영 토큰·전역 콜백 토큰·
 * LLM 키·userKey가 없다(오면 validateBuildPayload가 거절). 콜백 Bearer = 이 잡의 jobToken.
 * B-5b-2: 이 서버는 root로 돌고 jobToken은 이 프로세스 메모리에만 있다. 생성 코드는 샌드박스 사용자(SIMSA_SANDBOX_UID)로
 * 돈다(builder-work.mjs) — 이 프로세스의 메모리·환경을 읽을 수 없다. 빌드 잡은 인스턴스당 하나(두 번째는 409 builder_busy).
 */
import { createServer } from "node:http";
import {
  RUNNER_REV,
  postCallback,
  selfCheck,
  startJob,
  validateBuildPayload,
  validateJobPayload,
} from "./builder-run.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_ROOT ?? "/var/lib/simsa-build";
/** D-4 [PILOT] 잡 전체 45분 상한 — 단계별 예산은 B-5b-2~5에서 더 잘게 나눈다. */
const JOB_TIMEOUT_MS = 45 * 60 * 1000;

/** jobId → { payload, job(startJob — 단계·지출·abort), reported(최종 콜백을 보냈나) }. */
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
    // B-5b-2: 인스턴스 하나 = 빌드 잡 하나(DO 이름 `build-<jobId>`). 두 번째 빌드는 정당한 경로가 없다 — 생성 코드(같은 컨테이너,
    // 샌드박스 사용자)가 localhost:8080으로 같은 jobId를 다시 넣어 작업 폴더를 지우거나 드레인 목록을 덮어쓰지 못하게 409.
    if (inFlightJobs.has(payload.jobId) || [...inFlightJobs.values()].some((e) => e.payload.kind === "build")) {
      json(res, 409, { error: "builder_busy" });
      return;
    }
  }

  json(res, 202, { jobId: payload.jobId, status: "accepted", runnerRev: RUNNER_REV });

  const entry = { payload, job: null, reported: false };
  inFlightJobs.set(payload.jobId, entry);
  runJob(entry)
    .catch((err) => console.error(`[job ${payload.jobId}] runner crashed: ${String(err?.message ?? err).slice(0, 200)}`))
    .finally(() => inFlightJobs.delete(payload.jobId));
});

server.listen(PORT, () => {
  console.log(`simsa-builder ${RUNNER_REV} listening on :${PORT}`);
});

let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${sig} — draining ${inFlightJobs.size} in-flight job(s)`);
  const pending = Array.from(inFlightJobs.values()).filter((entry) => entry.job && !entry.reported);
  const drains = pending.map(async (entry) => {
    entry.reported = true;
    const p = entry.payload;
    // job.abort: 러너를 멈추고 그 단계의 실패 본문(runJob의 done도 같은 본문 — 두 번 보내지 않는다).
    const bodyOut = entry.job.abort(new Error(`builder container was killed by ${sig} mid-job (deploy rollout or sleepAfter)`));
    const r = await postCallback(p.callbackUrl, p.jobToken, bodyOut, { retries: 0 });
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
  const { jobId, callbackUrl, jobToken } = entry.payload;
  const start = Date.now();
  console.log(`[job ${jobId}] start kind=${String(entry.payload.kind).slice(0, 20)}`);
  entry.job = startJob(entry.payload, {
    deps: { workRoot: WORK_ROOT },
    timeoutMs: JOB_TIMEOUT_MS,
    timeoutMessage: `build job timed out after ${Math.round(JOB_TIMEOUT_MS / 60000)} min`,
  });
  const result = await entry.job.done;
  if (entry.reported) return; // SIGTERM 드레인이 이미 최종 본문을 보냈다
  entry.reported = true;
  const r = await postCallback(callbackUrl, jobToken, result);
  if (!r.ok) console.error(`[job ${jobId}] final callback failed: ${r.error}`);
  const failure = result.failedStage ? `(${result.failedStage}: ${String(result.error ?? "").slice(0, 120)})` : "";
  console.log(`[job ${jobId}] ${result.stage}${failure} (${Date.now() - start}ms)`);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

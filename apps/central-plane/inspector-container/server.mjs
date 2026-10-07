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
/** Hard safety rail: kills a truly hung Chromium (last resort). */
const INSPECTION_TIMEOUT_MS = 4 * 60 * 1000;
/** E-corpus-1 (2026-07-19): soft budget handed to the runner so it stops
 *  driving new steps ~40s before the hard rail and returns a PARTIAL report
 *  from evidence gathered so far — a heavy marketing site should yield "couldn't
 *  finish, here's what I saw", never an empty timeout failure. */
const INSPECTION_SOFT_BUDGET_MS = INSPECTION_TIMEOUT_MS - 40_000;

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

  // 직접 로그인해서 넘겨주기 — Worker(소유자·런 토큰 확인 뒤)만 이 컨테이너에 닿는다(DO 바인딩).
  if (req.url && req.url.startsWith("/live/")) {
    await handleLive(req, res);
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

// --- 직접 로그인 라이브 세션 -------------------------------------------------
// runId → { driver, state, done(), typed[] }. 입력 글자(비밀번호 포함)는 typed에만 — 결과물 가림용, 로그 없음.
const liveSessions = new Map();

function createLiveSession(runId, driver) {
  let resolveDone = null;
  const donePromise = new Promise((r) => {
    resolveDone = r;
  });
  const s = {
    driver,
    state: "starting",
    typed: [],
    setState(v) {
      s.state = v;
    },
    async waitDone(ms) {
      let timer;
      const t = new Promise((r) => {
        timer = setTimeout(() => r(false), ms);
      });
      const v = await Promise.race([donePromise.then(() => true), t]);
      clearTimeout(timer);
      return v;
    },
    markDone() {
      resolveDone?.();
    },
    typedSecrets: () => s.typed.filter((x) => typeof x === "string" && x.length >= 3),
  };
  liveSessions.set(runId, s);
  return s;
}

async function readJson(req) {
  let body = "";
  req.setEncoding("utf8");
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) break;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function handleLive(req, res) {
  const u = new URL(req.url, "http://inspector");
  const what = u.pathname.slice("/live/".length);
  const json = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  const body = req.method === "POST" ? await readJson(req) : null;
  const runId = req.method === "POST" ? body?.runId : u.searchParams.get("runId");
  const s = typeof runId === "string" ? liveSessions.get(runId) : null;
  if (!s) return json(404, { ok: false, error: "no_live_session" });
  try {
    if (what === "state" && req.method === "GET") return json(200, { ok: true, state: s.state });
    if (what === "frame" && req.method === "GET") {
      if (s.state !== "awaiting_login") return json(409, { ok: false, error: "not_awaiting_login", state: s.state });
      const jpg = await s.driver.liveFrame();
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
      res.end(jpg);
      return;
    }
    if (what === "input" && req.method === "POST") {
      if (s.state !== "awaiting_login") return json(409, { ok: false, error: "not_awaiting_login" });
      if (body.kind === "type" && typeof body.text === "string") s.typed.push(body.text);
      await s.driver.liveInput(body);
      return json(200, { ok: true });
    }
    if (what === "done" && req.method === "POST") {
      s.markDone();
      return json(200, { ok: true });
    }
    return json(404, { ok: false, error: "unknown_live_action" });
  } catch (err) {
    // 입력 내용은 오류 메시지에도 싣지 않는다.
    return json(500, { ok: false, error: "live_failed" });
  }
}

/** 기록 문자열에서 시험 계정·직접 입력 글자를 가린다(실패 콜백·위상 로그용). */
function redactWith(secrets, text) {
  let out = String(text ?? "");
  for (const s of secrets) if (typeof s === "string" && s.length >= 3) out = out.split(s).join("[REDACTED]");
  return out;
}

// --- Job runner -------------------------------------------------------------

async function runJob(payload) {
  const { runId, projectId, userKey, targetUrl, intent, baseUrl, callbackUrl, callbackToken, runningUrl } = payload;
  // 로그인 뒤 검수 설정. Worker가 동의를 확인한 뒤에만 실어 보낸다(기본 부재).
  const signup = payload.signup;
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
    // 기본 엔진 모듈은 그 엔진일 때만 읽는다(agent 런이 기본 엔진의 의존성 때문에 깨지지 않게).
    const isAgent = payload.engine === "agent" || payload.engine === "agent_v2";
    const { runInspection } = isAgent ? { runInspection: null } : await import("./inspector-run.mjs");

    // Wall-clock rail: Chromium hangs (infinite spinners, slow hosts) must
    // not exceed ~4 minutes. On timeout the run is reported failed; the
    // leaked browser (if any) dies with the container's sleepAfter.
    //
    // ec1-dbg2 in-band diagnostics: container stdout never reaches
    // `wrangler tail` (measured 2026-07-20), so the runner's phase log is
    // collected HERE and, when the run fails, shipped inside the error string
    // → markVisualCheckFailed snapshots it into report_json → readable via
    // the normal GET. The failed row itself now names the hang point.
    const phases = [];
    const onPhase = (line) => {
      phases.push(line);
      if (phases.length > 60) phases.splice(1, 1); // keep [0] = runner-rev marker
    };
    const result = payload.engine === "agent_v2"
      ? await runAgentV2Job(payload, { outDir, locale, onPhase, phases, signup })
      : payload.engine === "agent" ? await runAgentJob(payload, { outDir, locale, onPhase, phases, signup }) : await withTimeout(
      runInspection({
        targetUrl, intent, outDir, locale, budgetMs: INSPECTION_SOFT_BUDGET_MS, runId, onPhase,
        // SI 티어 A5: 지시서의 수용 기준 시나리오(없으면 undefined → 종전 동작).
        acceptancePlan: Array.isArray(payload.acceptancePlan) ? payload.acceptancePlan.slice(0, 8) : undefined,
        // ★로그인 뒤 검수 — Worker가 **명시적 동의가 있을 때만** 실어 보낸다.
        //  기본은 꺼짐이다. 남의 앱에 계정을 만드는 일이므로 자동으로 켜지지 않는다.
        signup: signup?.enabled
          ? {
              enabled: true,
              runId,
              mailDomain: signup.mailDomain,
              callbackBaseUrl: signup.callbackBaseUrl,
              internalToken: signup.internalToken,
            }
          : undefined,
      }),
      INSPECTION_TIMEOUT_MS,
      `inspection timed out after ${Math.round(INSPECTION_TIMEOUT_MS / 1000)}s`,
    ).catch((err) => {
      const trace = [phases[0], ...phases.slice(-9)].filter(Boolean).join(" | ");
      throw new Error(`${String(err?.message ?? err)} ||trace: ${trace}`.slice(0, 490));
    });

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
    // 서버 안내(예: 하루 예산으로 기본 검수로 돈 이유)를 리포트 노트 맨 앞에 — 어느 엔진이든.
    if (Array.isArray(payload.serverNotes) && result.report && typeof result.report === "object") {
      const extra = payload.serverNotes.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 400).slice(0, 5);
      if (extra.length) result.report.notes = [...extra, ...(Array.isArray(result.report.notes) ? result.report.notes : [])];
    }
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
    const secrets = [payload.credentials?.username, payload.credentials?.password, ...(liveSessions.get(runId)?.typedSecrets() ?? [])];
    const message = redactWith(secrets, String(err?.message ?? err)).slice(0, 500);
    console.error(`[run ${runId}] failed: ${message}`);
    await postJson(callbackUrl, callbackToken, {
      runId,
      ok: false,
      error: message,
    });
  } finally {
    liveSessions.delete(runId);
    try {
      await fs.rm(outDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[run ${runId}] cleanup failed:`, cleanupErr);
    }
  }
}

/** agent 엔진: 실행 15분 + (직접 로그인이면) 사람 대기 10분. 넘으면 실패 콜백(마지막 위상 포함). */
const AGENT_RUN_BUDGET_MS = 13 * 60 * 1000;
const AGENT_HARD_MS = 15 * 60 * 1000;
const HANDOVER_WAIT_MS = 10 * 60 * 1000;

async function runAgentJob(payload, { outDir, locale, onPhase, phases, signup }) {
  const { runAgentInspection, partialAgentResult } = await import("./agent-run.mjs");
  const progress = {};
  const { createPlaywrightDriver } = await import("./agent-driver.mjs");
  const { createProxyLlm } = await import("./agent-llm.mjs");
  // 이미지 안은 ./dist, 저장소에서 직접 돌릴 때(C9 로컬 실행 검증)는 central-plane tsc 출력 ../dist.
  const { isNoiseResource } = await import("./dist/nondev-report.js").catch(() => import("../dist/nondev-report.js"));
  // 가입 실행은 동의된 런에서만 읽는다.
  const { attemptSignup } = signup?.enabled ? await import("./signup-run.mjs") : { attemptSignup: null };
  const agent = payload.agent ?? {};
  const driver = await createPlaywrightDriver({ outDir, locale, isNoiseResource, attemptSignup });
  const live = agent.loginMode === "handover" ? createLiveSession(payload.runId, driver) : null;
  const secrets = () => [payload.credentials?.username, payload.credentials?.password, ...(live?.typedSecrets() ?? [])];
  const hard = AGENT_HARD_MS + (live ? HANDOVER_WAIT_MS : 0);
  return withTimeout(
    runAgentInspection({
      targetUrl: payload.targetUrl,
      intent: payload.intent,
      locale,
      // 오픈 베타: 티어 상한의 실행 시간(분)이 있으면 그것(엔진 상한 이하).
      budgetMs: Math.min(AGENT_RUN_BUDGET_MS, Number(agent.caps?.maxMinutes) > 0 ? Number(agent.caps.maxMinutes) * 60_000 : AGENT_RUN_BUDGET_MS),
      caps: agent.caps,
      readOnly: agent.readOnly === true,
      acs: Array.isArray(agent.acs) ? agent.acs : [],
      acSource: agent.acSource,
      loginMode: agent.loginMode ?? "none",
      credentials: payload.credentials,
      signup: signup?.enabled
        ? { enabled: true, runId: payload.runId, mailDomain: signup.mailDomain, callbackBaseUrl: signup.callbackBaseUrl, internalToken: signup.internalToken }
        : undefined,
      llm: createProxyLlm({ url: agent.llmUrl, token: agent.llmToken }),
      driver,
      live,
      handoverWaitMs: HANDOVER_WAIT_MS,
      onPhase,
      progress,
    }),
    hard,
    `agent inspection timed out after ${Math.round(hard / 1000)}s`,
  ).catch(async (err) => {
    await driver.close().catch(() => {});
    // C11: 기준을 하나라도 잡았으면 빈손 실패 대신 여기까지의 부분 리포트(돌지 못한 기준 = 시간 한도로 확인 못 함).
    const partial = await partialAgentResult(progress).catch(() => null);
    if (partial) {
      onPhase(`agent:partial after ${String(err?.message ?? err).slice(0, 80)}`);
      return partial;
    }
    const trace = [phases[0], ...phases.slice(-9)].filter(Boolean).join(" | ");
    throw new Error(redactWith(secrets(), `${String(err?.message ?? err)} ||trace: ${trace}`).slice(0, 490));
  });
}

/**
 * 검사 엔진 v2(engine "agent_v2", 스태프 전용): 증거 고리 실행 18분 + 여유 4분(+ 직접 로그인이면 사람 대기 10분).
 * 넘으면 여기까지의 증거로 부분 리포트(빈손 실패 대신).
 */
const AGENT_V2_RUN_BUDGET_MS = 18 * 60 * 1000;
const AGENT_V2_HARD_MS = 22 * 60 * 1000;

async function runAgentV2Job(payload, { outDir, locale, onPhase, phases, signup }) {
  const { runAgentV2 } = await import("./agent-v2-run.mjs");
  const { createPlaywrightDriver } = await import("./agent-driver.mjs");
  const { createProxyResponses } = await import("./agent-llm.mjs");
  const { isNoiseResource } = await import("./dist/nondev-report.js").catch(() => import("../dist/nondev-report.js"));
  const { attemptSignup } = signup?.enabled ? await import("./signup-run.mjs") : { attemptSignup: null };
  const agent = payload.agent ?? {};
  const progress = {};
  const driver = await createPlaywrightDriver({ outDir, locale, isNoiseResource, attemptSignup });
  const live = agent.loginMode === "handover" ? createLiveSession(payload.runId, driver) : null;
  const secrets = () => [payload.credentials?.username, payload.credentials?.password, ...(live?.typedSecrets() ?? [])];
  const hard = AGENT_V2_HARD_MS + (live ? HANDOVER_WAIT_MS : 0);
  return withTimeout(
    runAgentV2({
      targetUrl: payload.targetUrl,
      intent: payload.intent,
      locale,
      budgetMs: Math.min(AGENT_V2_RUN_BUDGET_MS, Number(agent.caps?.maxMinutes) > 0 ? Number(agent.caps.maxMinutes) * 60_000 : AGENT_V2_RUN_BUDGET_MS),
      caps: agent.caps,
      readOnly: agent.readOnly === true,
      acs: Array.isArray(agent.acs) ? agent.acs : [],
      acSource: agent.acSource,
      priorPlan: agent.priorPlan ?? null,
      loginMode: agent.loginMode ?? "none",
      credentials: payload.credentials,
      signup: signup?.enabled
        ? { enabled: true, runId: payload.runId, mailDomain: signup.mailDomain, callbackBaseUrl: signup.callbackBaseUrl, internalToken: signup.internalToken }
        : undefined,
      llm: createProxyResponses({ url: agent.llmUrl, token: agent.llmToken }),
      driver,
      live,
      handoverWaitMs: HANDOVER_WAIT_MS,
      onPhase,
      progress,
    }),
    hard,
    `agent_v2 inspection timed out after ${Math.round(hard / 1000)}s`,
  ).catch(async (err) => {
    await driver.close().catch(() => {});
    const partial = progress.partialResult ? await Promise.resolve(progress.partialResult()).catch(() => null) : null;
    if (partial) {
      onPhase(`agent_v2:partial after ${String(err?.message ?? err).slice(0, 80)}`);
      return partial;
    }
    const trace = [phases[0], ...phases.slice(-9)].filter(Boolean).join(" | ");
    throw new Error(redactWith(secrets(), `${String(err?.message ?? err)} ||trace: ${trace}`).slice(0, 490));
  });
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

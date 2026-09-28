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
 *
 * Train W (재정렬 D-7 amend [PILOT] · D-4 keep, 2026-09-28):
 *   - W-2 킬스위치 REPAIR_ENABLED — 판정은 dispatchRepairJob **안**(service-switches.ts). 라우트는
 *     같은 헬퍼로 행·토큰 조회 전에 묻고 503 `repair_disabled`.
 *   - W-2 일일 상한 수리 5/일(userKey, UTC 일) — 소유권·검증·409 뒤에서 차감, 행 저장 실패·
 *     디스패치 실패 시 환급. 초과 → 429 { error:"daily_limit_reached", kind:"repair", limit, resetAt }.
 *     PR #561 검증 후속: 네트워크 15/일·서비스 전체 50/일 버킷을 같은 차감에(원자적), 진행 중
 *     1개 가드는 삽입 뒤 rowid 순으로 한 번 더(같은 수리 브랜치를 두 컨테이너가 동시에 밀지 않게).
 *   - W-3 잡 뷰 `buildVerified` — 컨테이너의 사후 검증(node --check)이 바뀐 파일을 전부 덮었는가.
 *     auto_fix만 boolean, brief_only·레거시·판단 불가 = null (repair-job-db.ts, 새 컬럼 없음).
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { normalizeGithubRepoRef } from "../workspace/github-repo-ref.js";
import { getProject } from "../workspace/db.js";
import { getVisualCheckById, type DbVisualCheck } from "../workspace/visual-check-db.js";
import { getProjectRepo } from "../workspace/github-db.js";
import { listProjectSources } from "../workspace/project-sources-db.js";
import { getAppInstallationToken, resolveRepoAccessToken } from "../workspace/github-app-access.js";
import { regionFromRequest } from "../workspace/envelope.js";
import { REPAIR_DISABLED, repairEnabled } from "../workspace/service-switches.js";
import { consumeDailyCaps } from "../workspace/rate-limit.js";
import { clientNetworkKey, dailyCapRejection, dailyCapsFor } from "../workspace/beta-limits.js";
import type { FetchLike } from "../github.js";
import {
  discardQueuedRepairJob,
  findActiveRepairJobForRun,
  firstActiveRepairJobIdForRun,
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
 * 하위호환 별칭 — 정규화 로직은 workspace/github-repo-ref.ts 단일 출처.
 * (이 함수를 부르는 기존 호출부·테스트를 그대로 두기 위한 재수출.)
 */
export const normalizeRepoReference = normalizeGithubRepoRef;

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
    // Stage 270 — how the repair concluded: 'auto_fix' (worker agent applied
    // real code changes, non-draft PR) vs 'brief_only' (Stage 268 draft-PR
    // fallback). Null on legacy rows and while in flight.
    mode: job.mode ?? null,
    changedFiles: job.changedFiles ?? null,
    // Train W · W-3 (contract 3, #558 showBuildUnverified): did the container's
    // post-apply check (node --check) cover every file the repair changed?
    // false → the dashboard's one line "we couldn't confirm the fixed code
    // builds". Only an auto_fix job carries a boolean; brief_only / legacy /
    // in-flight / undecidable → null (never a guess).
    buildVerified: job.buildVerified,
    error: job.error ?? null,
    // Train C · C2a (0069): the re-inspection verify-sweep dispatched after the
    // PR merged, and its outcome (true/false; null = not verified yet/at all).
    verifyCheckId: job.verifyCheckId,
    resolved: job.resolved,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Reader-facing messages for the two "cannot start" answers, EN/KO. The
 * dashboard shows these verbatim, so an EN reader must not get Korean
 * (재정렬 §1 끊김 5: 하드코딩 한국어). Wording deliberately avoids developer
 * vocabulary for the repo case — the dashboard's default flow shows the C2b
 * path (paste into your builder's chat) instead of a "connect" CTA (D-17 amend).
 */
const REPAIR_ENTRY_MESSAGES = {
  ko: {
    repoRequired: "이 프로젝트에 연결된 코드가 없어요. 빌더 채팅에 고침 지시를 붙여넣어 고친 뒤 '다시 확인'을 눌러 주세요. 코드를 연결하면 Simsa가 직접 고쳐 볼 수도 있어요.",
    tokenRequired: "GitHub 계정 연결이 필요해요. 설정에서 GitHub을 다시 연결해 주세요.",
  },
  en: {
    repoRequired: "This project has no code connected. Paste the fix instructions into your builder's chat, then press 'Check again'. If you connect your code, Simsa can also try the fix for you.",
    tokenRequired: "A GitHub account connection is needed. Please reconnect GitHub in Settings.",
  },
} as const;

/**
 * Dispatch the queued repair into the ConclaveSandbox container DO as a
 * `simsa_repair` job. Mirrors spawnSandbox/dispatchInspection: fire-and-forget
 * — the container acks 202 and reports back via /internal/repair-*.
 * The GitHub token travels only in the job payload (memory → container env),
 * never in a D1 row or response body.
 *
 * Train W · W-2: the REPAIR_ENABLED kill switch is enforced HERE, so every
 * caller passes the same gate (`disabled: true` = switched off, as opposed to
 * the sandbox being unavailable).
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
    /** Reader's locale — PR title/body prose is built in the container at job
     *  time, so it must travel WITH the job (visual-check run과 동일 독트린). */
    locale: "ko" | "en";
    publicBaseUrl: string;
  },
): Promise<{ dispatched: boolean; note?: string; disabled?: boolean }> {
  if (!repairEnabled(env)) {
    return { dispatched: false, note: REPAIR_DISABLED, disabled: true };
  }
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
    locale: args.locale,
    callbackUrl: `${base}/internal/repair-done`,
    runningUrl: `${base}/internal/repair-running`,
    callbackToken: env.INTERNAL_CALLBACK_TOKEN,
  };
  // Stage 270 — forward the worker-agent LLM key the same way the autofix
  // spawn does (routes/saas.ts): via header, not body, so the key never
  // shows up in anything that logs request bodies. Absent key → the
  // container keeps the Stage 268 brief-only behavior (mode 'brief_only').
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.ANTHROPIC_API_KEY) headers["x-anthropic-key"] = env.ANTHROPIC_API_KEY;
  // 2026-07-21 — route the container's worker-agent calls through the CF AI
  // Gateway. Direct container→Anthropic egress 403s intermittently
  // ("Request not allowed" — Worker-side direct egress measured ~90% 403 on
  // 2026-07-05; repair hit the same class today). Base URL is not a secret
  // (wrangler.toml [vars]); absent → container keeps the direct default.
  // ★벤더 폴백 (2026-08-26) — Anthropic이 egress에서 막힌 뒤 이 경로만 폴백이
  //  없어서 "고쳐줘"가 통째로 멈춰 있었을 가능성이 높다. 키가 없으면 안 실린다.
  if (env.OPENAI_API_KEY) headers["x-openai-key"] = env.OPENAI_API_KEY;
  if (env.CF_AI_GATEWAY_OPENAI_URL) headers["x-openai-base-url"] = env.CF_AI_GATEWAY_OPENAI_URL;
  // 킬스위치를 컨테이너에도 전달 — 막힌 문을 컨테이너가 다시 두드릴 이유가 없다.
  if (env.ANTHROPIC_ENABLED === "off") headers["x-anthropic-disabled"] = "1";
  if (env.CF_AI_GATEWAY_ANTHROPIC_URL) {
    headers["x-anthropic-base-url"] = env.CF_AI_GATEWAY_ANTHROPIC_URL;
  }
  try {
    const id = env.SANDBOX.idFromName(`repair-${args.jobId}`);
    const stub = env.SANDBOX.get(id);
    const r = await stub.fetch("http://sandbox/run", {
      method: "POST",
      headers,
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

export function createWorkspaceRepairJobRoutes(
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/workspace/*", corsMiddleware);

  // ── POST /workspace/projects/:id/visual-checks/:runId/repair ───────────────
  app.post("/workspace/projects/:id/visual-checks/:runId/repair", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");

    let body: { userKey?: unknown; locale?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    // Train E (2026-07-21): repair PR 제목/본문도 리더의 언어로 — 런 생성과
    // 같은 방식으로 대시보드가 UI locale을 싣는다. 미전송 = ko(기존 동작).
    const locale: "ko" | "en" = body.locale === "en" ? "en" : "ko";

    // Ownership chain: project → userKey, run → project + userKey.
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);
    if (project.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

    const run = await getVisualCheckById(c.env, runId);
    if (!run || run.projectId !== projectId || run.userKey !== userKey) {
      return c.json({ ok: false, error: "run_not_found" }, 404);
    }

    // Train W · W-2 — kill switch, asked BEFORE any row exists and before any
    // token is resolved (same helper dispatchRepairJob enforces). After the
    // ownership chain: a stranger still gets 403/404, never a hint.
    if (!repairEnabled(c.env)) {
      return c.json({ ok: false, error: REPAIR_DISABLED }, 503);
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
    const messages = REPAIR_ENTRY_MESSAGES[locale];
    if (!repoFullName) {
      return c.json({ ok: false, error: "github_repo_required", message: messages.repoRequired }, 400);
    }

    // Resolve the token that can actually SEE the repo. Public repos keep the
    // exact pre-existing path (OAuth token, zero extra GitHub calls — the
    // repoPrivate:false fast path). A private linked repo falls back to the
    // GitHub App installation token when the App is installed there
    // (github-app-access.ts) — before this, private repos always died in the
    // container with a clone 403 (실측 2026-07-19, simsa-autofix-test).
    const tokenRequired = { ok: false, error: "github_token_required", message: messages.tokenRequired };
    const slash = repoFullName.indexOf("/");
    const repoOwner = repoFullName.slice(0, slash);
    const repoName = repoFullName.slice(slash + 1);
    const access = await resolveRepoAccessToken(c.env, userKey, repoOwner, repoName, fetchImpl, {
      // Only the linked-repo record knows privacy. A project_sources fallback
      // repo keeps the exact pre-App behavior (OAuth direct, zero probes) —
      // repoPrivate:false is the documented fast path for that.
      repoPrivate: projectRepo ? projectRepo.private : false,
    });
    let githubToken: string;
    if (access.ok) {
      githubToken = access.token;
    } else if (projectRepo) {
      // Train C · C2a (재정렬 D-15 keep, D-17 amend): no OAuth connection (or an
      // unusable one) must not be the end of the road when the GitHub App is
      // installed on the repo — the App installation token can see it, and the
      // App is exactly what the default flow offers as the OPTIONAL "connect your
      // code" step. Still nothing here: then the old answer stands.
      //
      // ONLY for the LINKED repo (workspace_project_repos). That row exists only
      // because this user, signed in to GitHub through OAuth, linked the repo
      // (workspace-github.ts POST /workspace/projects/:id/repo → 401 without a
      // connection). A `project_sources` github_repo row is a self-typed string:
      // github-repo-ref.ts normalizes its FORMAT and nothing checks ownership
      // ("관대하게 받되" — a normalizer, not a gate). Minting an App installation
      // token for such a string would let anyone with no GitHub identity at all
      // clone + push + open a PR on ANY repo that installed the Simsa App
      // (PR #553 review P0, cross-tenant). The App can vouch for a repo; it
      // cannot vouch for the requester — the link is what ties the two.
      const appAccess = await getAppInstallationToken(c.env, repoOwner, repoName, fetchImpl);
      if (!appAccess) return c.json(tokenRequired, 400);
      githubToken = appAccess.token;
    } else {
      // Sources-only repo without a usable OAuth token: exactly the pre-C2a
      // answer. No App lookup is attempted (nothing proves this user may touch
      // that repo), so no installation token is ever minted for it.
      return c.json(tokenRequired, 400);
    }

    // One active repair per run.
    const active = await findActiveRepairJobForRun(c.env, runId);
    if (active) {
      return c.json({ ok: false, error: "repair_already_active", activeJobId: active.id }, 409);
    }

    // Train W · W-2 — daily caps (D-7 amend [PILOT]): this user 5 · this network
    // 15 · the whole service 50 (beta-limits.ts). Same placement as the
    // inspection route: after ownership + validation + the one-active-repair
    // guard, one atomic statement per bucket, refunded below if the job never
    // starts.
    const caps = await consumeDailyCaps(c.env, dailyCapsFor("repair", c.env, userKey, clientNetworkKey(c.req.raw)));
    if (caps.limited) {
      const rejection = dailyCapRejection("repair", caps);
      c.header("Retry-After", String(rejection.retryAfterSeconds));
      return c.json(rejection.body, rejection.status);
    }
    const refundSlot = caps.refund;

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
        // C4a (0069): country at repair time — the failure map's region axis.
        region: regionFromRequest(c.req.raw),
      });
    } catch (err) {
      console.error("[repair-jobs POST] insert failed:", err);
      await refundSlot();
      return c.json({ ok: false, error: "save_failed" }, 500);
    }

    // One active repair per run, under concurrency (PR #561 review P2): the
    // 409 check above is read-then-insert, so requests that arrive together all
    // pass it — and two containers would force-push the same fix branch. The
    // in-flight job inserted FIRST wins; a later one backs out (row removed,
    // slots returned, the same 409). A D1 error here keeps going (fail-open).
    const firstActiveId = await firstActiveRepairJobIdForRun(c.env, runId).catch(() => null);
    if (firstActiveId !== null && firstActiveId !== job.id) {
      const jobId = job.id;
      await discardQueuedRepairJob(c.env, jobId).catch(async (err) => {
        console.error("[repair-jobs POST] discard after lost start failed:", err);
        await markRepairJobFailed(c.env, jobId, "superseded_by_concurrent_repair").catch(() => undefined);
      });
      await refundSlot();
      return c.json({ ok: false, error: "repair_already_active", activeJobId: firstActiveId }, 409);
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
      locale,
      publicBaseUrl,
    });

    // Fail fast on undispatched jobs (Stage 263.1 semantics): a queued row
    // nothing will ever pick up would wedge the 409 guard until the sweep.
    let status = job.status;
    if (!dispatch.dispatched) {
      // W-2: nothing ran — the user's slot goes back.
      await refundSlot();
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
          mode?: string;
          changedFiles?: number;
          modeReason?: string;
          /** Train W · W-3: true/false from the container; anything else = not recorded. */
          buildVerified?: unknown;
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
      // Stage 270 — additive: how the container concluded. Anything outside
      // the enum is dropped (old containers send neither field).
      mode: body.mode === "auto_fix" || body.mode === "brief_only" ? body.mode : undefined,
      changedFiles:
        typeof body.changedFiles === "number" && Number.isInteger(body.changedFiles) && body.changedFiles >= 0
          ? body.changedFiles
          : undefined,
      // auto_fix 정직성 (2026-07-20): brief_only 폴백 사유(in-band 진단 —
      // 컨테이너 stdout은 tail로 볼 수 없다). brief_only일 때만 저장.
      modeReason:
        body.mode === "brief_only" && typeof body.modeReason === "string" && body.modeReason
          ? body.modeReason
          : undefined,
      // Train W · W-3 (contract 3): only an auto_fix job changed code, so only
      // it can be "verified" or not. brief_only / old containers / non-boolean
      // values leave it unrecorded (the view says null — no guess).
      buildVerified:
        body.mode === "auto_fix" && typeof body.buildVerified === "boolean" ? body.buildVerified : undefined,
    });
    return c.json({ ok: true, status: "done" });
  });

  return app;
}

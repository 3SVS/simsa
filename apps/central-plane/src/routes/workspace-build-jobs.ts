/**
 * routes/workspace-build-jobs.ts — SI 티어 Train B — B5: T1 빌드 잡 (D-4 · D-5 · D-6 · D-7 · D-12).
 *
 *   POST /workspace/projects/:id/build                 — 지시서가 있는 프로젝트의 빌드 잡 시작(S 모드, 계정 0)
 *   GET  /workspace/projects/:id/build-jobs            — 최근 잡 목록
 *   GET  /workspace/projects/:id/build-jobs/:jobId     — 잡 + 타임라인
 *   POST /internal/build-progress                      — 컨테이너 단계 콜백(Bearer = 그 잡의 jobToken)
 *   POST /internal/build-done                          — 컨테이너 최종 콜백(같은 인증)
 *   (LLM은 routes/build-llm-proxy.ts — 같은 jobToken, 서버 키, 서버 권위 예산)
 *
 * ★B-5b S1 (2026-10-01) — 컨테이너 비밀 최소화 + B-6 예산 정지:
 *   - 컨테이너 페이로드에 **비밀이 없다**: 운영 CF 토큰·전역 콜백 토큰·조직 설치 토큰·LLM 키·userKey를 싣지 않는다.
 *     B-5b-2부터 그 컨테이너가 LLM이 만든 코드와 의존성(postinstall 포함)을 실행하기 때문이다(D-6 "운영 자격은
 *     Worker/Actions secret에만"). 컨테이너가 받는 것은 식별자(jobId·slug·d1Id)·지시서·locale·예산·Worker 주소, 그리고
 *     이 잡에만 통하는 **jobToken**(build-job-token.ts) 하나. 배포·push는 Worker가 한다(S3).
 *   - 콜백 인증: 그 잡의 jobToken(다른 잡의 토큰은 403 — 교차 잡 위조 차단). 전역 INTERNAL_CALLBACK_TOKEN은 옛 이미지를
 *     위해 **한 릴리스만** 받는다(TODO — build-job-token.ts authenticateBuildCallback).
 *   - 원가: **LLM 프록시 한 곳에서만** 원장·spent_usd를 쓴다. 콜백 본문의 usage[]·spentUsd는 무시한다(이중 계상 금지 —
 *     L-3 #562의 콜백 usage[] 경로는 수리 컨테이너(repair-done)에만 남는다).
 *   - 일일 상한(build-daily-caps.ts): 사용자 3 · 네트워크 5 [PILOT] · 서비스 30 [PILOT] / UTC 일. 일이 시작되지 않으면 환급.
 *
 * 시작 시 Worker가 하는 것:
 *   1) 지시서(dev_spec)에서 WBS 목록·지시서 마크다운을 만든다
 *   2) 일일 상한 슬롯(설정·소유권·지시서·활성 잡 검사 뒤, 프로비저닝 전)
 *   3) 네임스페이스 보장 + 프로젝트 D1 생성(hosting-provision) — 실패면 잡을 만들지 않고 슬롯 환급(정직)
 *   4) (조직이 설정되고 App이 설치돼 있으면) private 저장소 생성 — 없으면 repo 없이 진행하고 표시. 설치 토큰은 컨테이너로 가지 않는다
 *   5) build_jobs 행(queued) + jobToken + BUILDER 컨테이너 디스패치. 디스패치 실패는 즉시 failed(queued) + 슬롯 환급
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getOwnedProject } from "../workspace/db.js";
import { validateDevSpec, type DevSpec } from "../workspace/dev-spec.js";
import { renderDevSpecFiles } from "../workspace/render-dev-spec.js";
import { createProjectD1, ensureNamespace, toHostedSlug } from "../workspace/hosting-provision.js";
import { ensureHostedRepo } from "../workspace/hosting-repo.js";
import {
  advanceBuildJob, appendBuildJobEvent, findActiveBuildJobForProject, getBuildJobById, insertQueuedBuildJob,
  listBuildJobEvents, listBuildJobsForProject, markBuildJobDone, markBuildJobFailed, BUILD_JOB_STATUSES, DEFAULT_BUILD_BUDGET_USD,
  type BuildJobStatus,
} from "../workspace/build-job-db.js";
import { RESERVED_SLUGS_FOR_HOSTING } from "../workspace/hosting-reserved.js";
import { BUILD_DISABLED, buildEnabled } from "../workspace/service-switches.js";
import { authenticateBuildCallback, checkCallbackJob, mintBuildJobToken } from "../workspace/build-job-token.js";
import { buildDailyCapRejection, buildDailyCapsFor } from "../workspace/build-daily-caps.js";
import { consumeDailyCaps } from "../workspace/rate-limit.js";
import { clientNetworkKey } from "../workspace/beta-limits.js";
import { OPENAI_FALLBACK_MODEL } from "../workspace/anthropic-fetch.js";
import { DEFAULT_BUILD_MODEL } from "./build-llm-proxy.js";

const MAX_ERROR_CHARS = 500;

/** 컨테이너가 받는 WBS 항목(지시서에서 순서대로). */
export type BuildWbsItem = { id: string; title: string; order: number; acceptanceIds: string[]; dependsOn: string[] };

export function wbsFromDevSpec(spec: DevSpec): BuildWbsItem[] {
  return [...spec.workBreakdown]
    .sort((a, b) => a.order - b.order)
    .map((w) => ({ id: w.id, title: w.title, order: w.order, acceptanceIds: [...w.acceptanceIds], dependsOn: [...w.dependsOn] }));
}

/** 컨테이너가 모델에게 줄 지시서 마크다운(요구사항·화면·데이터·API·작업·테스트 — 렌더러와 동일 문서). */
export function specMarkdownForBuild(spec: DevSpec, locale: "ko" | "en"): string {
  return renderDevSpecFiles(spec, locale, "").map((f) => `<!-- ${f.path} -->\n${f.content}`).join("\n\n");
}

/**
 * 빌더 컨테이너 페이로드 — **비밀 없음**(B-5b S1). 식별자·지시서·locale·예산·Worker 주소, 그리고 이 잡에만 통하는
 * jobToken 하나. 컨테이너는 LLM을 `<baseUrl>/internal/build-llm/*`로 부른다(키는 Worker에만). 여기에 필드를 더할 때는
 * "생성 코드가 이 값을 읽어 내보내면 무엇이 위험해지나"를 먼저 묻는다 — test/train-b-b5b-s1-secrets-budget.test.mjs가
 * 이 타입과 실제 디스패치 본문을 비밀 이름·값으로 검사한다. (userKey도 싣지 않는다: 익명 사용자의 열쇠다.)
 */
export type BuildDispatchPayload = {
  jobId: string; kind: "build"; slug: string; locale: "ko" | "en";
  baseUrl: string; callbackUrl: string; progressUrl: string; jobToken: string;
  budgetUsd: number;
  spec: { markdown: string; wbs: BuildWbsItem[]; productName: string };
  hosting: { d1Id: string };
  llm: { model: string; openaiModel: string; preferFallback: boolean };
};

export async function dispatchBuild(env: Env, payload: BuildDispatchPayload): Promise<{ dispatched: boolean; note?: string }> {
  if (!buildEnabled(env)) return { dispatched: false, note: BUILD_DISABLED };
  if (!env.BUILDER) return { dispatched: false, note: "builder_unavailable" };
  try {
    const id = env.BUILDER.idFromName(`build-${payload.jobId}`);
    const stub = env.BUILDER.get(id);
    const r = await stub.fetch("http://builder/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) return { dispatched: false, note: `container returned ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, note: `container fetch failed: ${String((err as Error)?.message ?? err).slice(0, 200)}` };
  }
}

export function createWorkspaceBuildJobRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/workspace/*", corsMiddleware);

  // ── POST /workspace/projects/:id/build ──────────────────────────────────────
  app.post("/workspace/projects/:id/build", async (c) => {
    // Kill switch first — before parsing, ownership, provisioning or any row (hotfix 2026-10-01).
    if (!buildEnabled(c.env)) return c.json({ ok: false, error: BUILD_DISABLED }, 503);
    const projectId = c.req.param("id");
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ ok: false, error: "invalid_json" }, 400); }
    const userKey = typeof body["userKey"] === "string" ? body["userKey"] : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    const locale: "ko" | "en" = body["locale"] === "en" ? "en" : "ko";

    const project = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!project) return c.json({ ok: false, error: "not_found" }, 404);
    const v = validateDevSpec(project.devSpec);
    if (!v.ok) return c.json({ ok: false, error: "dev_spec_required" }, 409);
    const wbs = wbsFromDevSpec(v.spec);
    if (wbs.length === 0) return c.json({ ok: false, error: "dev_spec_has_no_work_items" }, 409);

    const active = await findActiveBuildJobForProject(c.env, projectId);
    if (active) return c.json({ ok: false, error: "build_already_active", activeJobId: active.id, status: active.status }, 409);

    // 설정 — 우리 쪽 준비가 안 됐으면 사용자 슬롯을 쓰지 않고 503.
    if (!c.env.INTERNAL_CALLBACK_TOKEN) return c.json({ ok: false, error: "callback_token_missing" }, 503);
    if (!c.env.BUILDER) return c.json({ ok: false, error: "builder_unavailable" }, 503);
    const hostRoot = (c.env.HOSTING_ROOT_DOMAIN ?? "").trim();
    if (!c.env.HOSTING_CF_API_TOKEN || !c.env.HOSTING_CF_ACCOUNT_ID || !hostRoot) return c.json({ ok: false, error: "hosting_not_configured" }, 503);
    if (!c.env.ANTHROPIC_API_KEY && !c.env.OPENAI_API_KEY) return c.json({ ok: false, error: "llm_not_configured" }, 503);

    // 2) 일일 상한(B-5b S1) — 소유권·지시서·활성 잡·설정을 다 통과한 뒤, 무엇이든 만들기 전에. 원자 문장 하나씩(#561).
    const caps = await consumeDailyCaps(c.env, buildDailyCapsFor(c.env, userKey, clientNetworkKey(c.req.raw)));
    if (caps.limited) {
      const rejection = buildDailyCapRejection(caps);
      c.header("Retry-After", String(rejection.retryAfterSeconds));
      return c.json(rejection.body, rejection.status);
    }
    const refundSlot = caps.refund;

    // 3) 호스팅 프로비저닝 — 실패면 잡을 만들지 않고 슬롯을 돌려준다(우리 실패는 사용자의 시도가 아니다).
    const slug = toHostedSlug(project.title, project.id, RESERVED_SLUGS_FOR_HOSTING);
    const ns = await ensureNamespace(c.env);
    if (!ns.ok) {
      await refundSlot();
      return c.json({ ok: false, error: "hosting_namespace_failed", detail: ns.error, cf: ns.cfErrors ?? null }, 502);
    }
    const d1 = await createProjectD1(c.env, slug);
    if (!d1.ok) {
      await refundSlot();
      return c.json({ ok: false, error: "hosting_d1_failed", detail: d1.error, cf: d1.cfErrors ?? null }, 502);
    }

    // 4) 저장소 — 조직/App이 준비된 경우에만. 없으면 정직하게 없이 간다. 설치 토큰은 여기서 버린다(컨테이너로 가지 않는다 —
    //    push는 Worker가 한다, S3).
    let repoFullName: string | null = null;
    let repoNote: string | null = null;
    const repoRes = await ensureHostedRepo(c.env, { slug, description: project.title }).catch(() => null);
    if (repoRes && repoRes.ok) repoFullName = `${repoRes.value.org}/${repoRes.value.name}`;
    else repoNote = repoRes && !repoRes.ok ? repoRes.error : "repo_error";

    // 5) 잡 행 + jobToken + 디스패치
    let job;
    try {
      job = await insertQueuedBuildJob(c.env, { projectId, userKey, slug, wbsTotal: wbs.length, budgetUsd: DEFAULT_BUILD_BUDGET_USD, locale, d1Id: d1.value.id, repoFullName });
    } catch (err) {
      console.error(JSON.stringify({ event: "build_job_insert_failed", project: projectId, reason: String((err as Error)?.message ?? err).slice(0, 200) }));
      await refundSlot();
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
    await appendBuildJobEvent(c.env, job.id, "queued", repoFullName ? "repo_ready" : `repo_skipped:${repoNote ?? "unknown"}`, { slug, d1Id: d1.value.id });

    const jobToken = await mintBuildJobToken(c.env, job.id);
    const base = (c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/+$/, "");
    const dispatch: { dispatched: boolean; note?: string } = jobToken
      ? await dispatchBuild(c.env, {
          jobId: job.id, kind: "build", slug, locale,
          baseUrl: base, callbackUrl: `${base}/internal/build-done`, progressUrl: `${base}/internal/build-progress`, jobToken,
          budgetUsd: job.budgetUsd,
          spec: { markdown: specMarkdownForBuild(v.spec, locale), wbs, productName: v.spec.brief.productName || project.title },
          hosting: { d1Id: d1.value.id },
          llm: {
            model: (c.env.BUILD_MODEL ?? "").trim() || DEFAULT_BUILD_MODEL,
            openaiModel: OPENAI_FALLBACK_MODEL,
            preferFallback: (c.env.ANTHROPIC_ENABLED ?? "").toLowerCase() === "off" || !c.env.ANTHROPIC_API_KEY,
          },
        })
      : { dispatched: false, note: "job_token_unavailable" };
    let status: BuildJobStatus = job.status;
    if (!dispatch.dispatched) {
      await markBuildJobFailed(c.env, job.id, { failedStage: "queued", error: dispatch.note ?? "dispatch_failed" });
      await refundSlot();
      status = "failed";
    }
    console.log(JSON.stringify({ event: "build_job_start", jobId: job.id, project: projectId, slug, wbs: wbs.length, repo: Boolean(repoFullName), dispatched: dispatch.dispatched, note: dispatch.note ?? null }));
    return c.json({ ok: true, job: { id: job.id, status, slug, wbsTotal: wbs.length, budgetUsd: job.budgetUsd, repoFullName: job.repoFullName, hostUrl: `https://${slug}.${hostRoot}` }, dispatched: dispatch.dispatched, ...(dispatch.note ? { note: dispatch.note } : {}) }, dispatch.dispatched ? 202 : 200);
  });

  // ── GET /workspace/projects/:id/build-jobs ──────────────────────────────────
  app.get("/workspace/projects/:id/build-jobs", async (c) => {
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    const project = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!project) return c.json({ ok: false, error: "not_found" }, 404);
    const jobs = await listBuildJobsForProject(c.env, projectId);
    return c.json({ ok: true, jobs, hostRoot: c.env.HOSTING_ROOT_DOMAIN ?? null });
  });

  // ── GET /workspace/projects/:id/build-jobs/:jobId ───────────────────────────
  app.get("/workspace/projects/:id/build-jobs/:jobId", async (c) => {
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    const project = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!project) return c.json({ ok: false, error: "not_found" }, 404);
    const job = await getBuildJobById(c.env, c.req.param("jobId"));
    if (!job || job.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
    const events = await listBuildJobEvents(c.env, job.id);
    return c.json({ ok: true, job, events });
  });

  // ── POST /internal/build-progress ───────────────────────────────────────────
  // 본문의 usage[]·spentUsd는 읽지 않는다(B-5b S1): 원가·예산은 LLM 프록시만 쓴다 — 여기서도 쓰면 같은 호출이 두 번 잡힌다.
  app.post("/internal/build-progress", async (c) => {
    const auth = await authenticateBuildCallback(c.env, c.req.header("authorization"));
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ ok: false, error: "invalid_json" }, 400); }
    const jobId = typeof body["jobId"] === "string" ? body["jobId"] : "";
    const status = typeof body["status"] === "string" ? body["status"] : "";
    if (!jobId || !(BUILD_JOB_STATUSES as readonly string[]).includes(status) || status === "done" || status === "failed") return c.json({ ok: false, error: "invalid_progress" }, 400);
    const scope = checkCallbackJob(auth, jobId);
    if (!scope.ok) return c.json({ ok: false, error: scope.error }, scope.status);
    const ok = await advanceBuildJob(c.env, jobId, {
      status: status as Exclude<BuildJobStatus, "done" | "failed">,
      wbsDone: typeof body["wbsDone"] === "number" ? body["wbsDone"] : undefined,
      wbsTotal: typeof body["wbsTotal"] === "number" ? body["wbsTotal"] : undefined,
      commitSha: typeof body["commitSha"] === "string" ? body["commitSha"] : undefined,
      repoFullName: typeof body["repoFullName"] === "string" ? body["repoFullName"] : undefined,
      buildExitCode: typeof body["buildExitCode"] === "number" ? body["buildExitCode"] : undefined,
    });
    if (typeof body["message"] === "string" && body["message"]) await appendBuildJobEvent(c.env, jobId, status, body["message"], typeof body["meta"] === "object" && body["meta"] ? (body["meta"] as Record<string, unknown>) : {});
    return c.json({ ok: true, transitioned: ok });
  });

  // ── POST /internal/build-done ───────────────────────────────────────────────
  app.post("/internal/build-done", async (c) => {
    const auth = await authenticateBuildCallback(c.env, c.req.header("authorization"));
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ ok: false, error: "invalid_json" }, 400); }
    const jobId = typeof body["jobId"] === "string" ? body["jobId"] : "";
    if (!jobId) return c.json({ ok: false, error: "jobId_required" }, 400);
    const scope = checkCallbackJob(auth, jobId);
    if (!scope.ok) return c.json({ ok: false, error: scope.error }, scope.status);
    // spent_usd는 프록시가 계량한 값 그대로 — 본문 spentUsd로 올리지도 내리지도 않는다(서버 권위). usage[]도 무시(이중 계상 금지).
    const buildExitCode = typeof body["buildExitCode"] === "number" ? body["buildExitCode"] : null;
    if (body["ok"] === true) {
      const deployedUrl = typeof body["deployedUrl"] === "string" ? body["deployedUrl"] : "";
      if (!deployedUrl) return c.json({ ok: false, error: "deployedUrl_required" }, 400);
      const r = await markBuildJobDone(c.env, jobId, { deployedUrl, commitSha: typeof body["commitSha"] === "string" ? body["commitSha"] : null, spentUsd: 0, buildExitCode: buildExitCode ?? -1, wbsDone: typeof body["wbsDone"] === "number" ? body["wbsDone"] : 0 });
      if (!r.ok && r.reason === "build_not_green") {
        // D-4: 컨테이너가 done이라 해도 빌드가 green이 아니면 믿지 않는다.
        await markBuildJobFailed(c.env, jobId, { failedStage: "building", error: `done claimed with build exit ${buildExitCode}`, buildExitCode });
        await appendBuildJobEvent(c.env, jobId, "failed", "build_not_green_rejected", { buildExitCode });
        return c.json({ ok: true, accepted: false, reason: "build_not_green" });
      }
      await appendBuildJobEvent(c.env, jobId, "done", "deployed", { deployedUrl });
      return c.json({ ok: true, accepted: r.ok });
    }
    const error = typeof body["error"] === "string" ? body["error"] : "unknown_error";
    const failedStage = typeof body["failedStage"] === "string" ? body["failedStage"] : "unknown";
    const ok = await markBuildJobFailed(c.env, jobId, { failedStage, error: error.slice(0, MAX_ERROR_CHARS), buildExitCode });
    await appendBuildJobEvent(c.env, jobId, "failed", error.slice(0, MAX_ERROR_CHARS), { failedStage });
    return c.json({ ok: true, accepted: ok });
  });

  return app;
}

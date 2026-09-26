/**
 * routes/workspace-build-jobs.ts — SI 티어 Train B — B5: T1 빌드 잡 (D-4 · D-5 · D-6 · D-7 · D-12).
 *
 *   POST /workspace/projects/:id/build                 — 지시서가 있는 프로젝트의 빌드 잡 시작(S 모드, 계정 0)
 *   GET  /workspace/projects/:id/build-jobs            — 최근 잡 목록
 *   GET  /workspace/projects/:id/build-jobs/:jobId     — 잡 + 타임라인
 *   POST /internal/build-progress                      — 컨테이너 단계 콜백(Bearer INTERNAL_CALLBACK_TOKEN)
 *   POST /internal/build-done                          — 컨테이너 최종 콜백
 *
 * 시작 시 Worker가 하는 것(컨테이너에 비밀을 덜 주기 위해 여기서 프로비저닝):
 *   1) 지시서(dev_spec)에서 WBS 목록·지시서 마크다운을 만든다
 *   2) 네임스페이스 보장 + 프로젝트 D1 생성(hosting-provision) — 실패면 잡을 만들지 않는다(정직)
 *   3) (조직이 설정되고 App이 설치돼 있으면) private 저장소 생성 — 없으면 repo 없이 진행하고 표시
 *   4) build_jobs 행(queued) + BUILDER 컨테이너 디스패치. 디스패치 실패는 즉시 failed(queued)
 * 컨테이너 페이로드의 비밀(운영 CF 토큰·LLM 키·repo 토큰)은 잡 수명 동안 메모리에만(D-16 불변식).
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getOwnedProject } from "../workspace/db.js";
import { validateDevSpec, type DevSpec } from "../workspace/dev-spec.js";
import { renderDevSpecFiles } from "../workspace/render-dev-spec.js";
import { createProjectD1, ensureNamespace, toHostedSlug, HOSTING_NAMESPACE } from "../workspace/hosting-provision.js";
import { ensureHostedRepo } from "../workspace/hosting-repo.js";
import {
  advanceBuildJob, appendBuildJobEvent, findActiveBuildJobForProject, getBuildJobById, insertQueuedBuildJob,
  listBuildJobEvents, listBuildJobsForProject, markBuildJobDone, markBuildJobFailed, BUILD_JOB_STATUSES, DEFAULT_BUILD_BUDGET_USD,
  type BuildJobStatus,
} from "../workspace/build-job-db.js";
import { RESERVED_SLUGS_FOR_HOSTING } from "../workspace/hosting-reserved.js";

const MAX_ERROR_CHARS = 500;

function requireInternalToken(c: { env: Env; req: { header: (name: string) => string | undefined } }): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "callback_disabled" };
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m || m[1] !== expected) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}

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

export type BuildDispatchPayload = {
  jobId: string; projectId: string; userKey: string; kind: "build"; slug: string; locale: "ko" | "en";
  baseUrl: string; callbackUrl: string; progressUrl: string; callbackToken: string;
  budgetUsd: number;
  spec: { markdown: string; wbs: BuildWbsItem[]; productName: string };
  hosting: { cfApiToken: string; cfAccountId: string; namespace: string; hostRoot: string; d1Id: string };
  repo: { token: string; org: string; name: string } | null;
  llm: { anthropicApiKey: string | null; anthropicBaseUrl: string | null; openaiApiKey: string | null; model: string; preferFallback: boolean };
};

export async function dispatchBuild(env: Env, payload: BuildDispatchPayload): Promise<{ dispatched: boolean; note?: string }> {
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

    if (!c.env.INTERNAL_CALLBACK_TOKEN) return c.json({ ok: false, error: "callback_token_missing" }, 503);
    if (!c.env.BUILDER) return c.json({ ok: false, error: "builder_unavailable" }, 503);
    const cfToken = c.env.HOSTING_CF_API_TOKEN ?? "";
    const cfAccount = c.env.HOSTING_CF_ACCOUNT_ID ?? "";
    const hostRoot = (c.env.HOSTING_ROOT_DOMAIN ?? "").trim();
    if (!cfToken || !cfAccount || !hostRoot) return c.json({ ok: false, error: "hosting_not_configured" }, 503);
    const anthropicKey = c.env.ANTHROPIC_API_KEY ?? null;
    const openaiKey = c.env.OPENAI_API_KEY ?? null;
    if (!anthropicKey && !openaiKey) return c.json({ ok: false, error: "llm_not_configured" }, 503);

    // 2) 호스팅 프로비저닝 — 실패면 잡을 만들지 않는다.
    const slug = toHostedSlug(project.title, project.id, RESERVED_SLUGS_FOR_HOSTING);
    const ns = await ensureNamespace(c.env);
    if (!ns.ok) return c.json({ ok: false, error: "hosting_namespace_failed", detail: ns.error, cf: ns.cfErrors ?? null }, 502);
    const d1 = await createProjectD1(c.env, slug);
    if (!d1.ok) return c.json({ ok: false, error: "hosting_d1_failed", detail: d1.error, cf: d1.cfErrors ?? null }, 502);

    // 3) 저장소 — 조직/App이 준비된 경우에만. 없으면 정직하게 없이 간다(zip은 여전히 가능).
    let repo: BuildDispatchPayload["repo"] = null;
    let repoNote: string | null = null;
    const repoRes = await ensureHostedRepo(c.env, { slug, description: project.title }).catch(() => null);
    if (repoRes && repoRes.ok) repo = { token: repoRes.value.token, org: repoRes.value.org, name: repoRes.value.name };
    else repoNote = repoRes && !repoRes.ok ? repoRes.error : "repo_error";

    // 4) 잡 행 + 디스패치
    const job = await insertQueuedBuildJob(c.env, { projectId, userKey, slug, wbsTotal: wbs.length, budgetUsd: DEFAULT_BUILD_BUDGET_USD, locale, d1Id: d1.value.id, repoFullName: repo ? `${repo.org}/${repo.name}` : null });
    await appendBuildJobEvent(c.env, job.id, "queued", repo ? "repo_ready" : `repo_skipped:${repoNote ?? "unknown"}`, { slug, d1Id: d1.value.id });

    const base = (c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/+$/, "");
    const payload: BuildDispatchPayload = {
      jobId: job.id, projectId, userKey, kind: "build", slug, locale,
      baseUrl: base, callbackUrl: `${base}/internal/build-done`, progressUrl: `${base}/internal/build-progress`, callbackToken: c.env.INTERNAL_CALLBACK_TOKEN,
      budgetUsd: job.budgetUsd,
      spec: { markdown: specMarkdownForBuild(v.spec, locale), wbs, productName: v.spec.brief.productName || project.title },
      hosting: { cfApiToken: cfToken, cfAccountId: cfAccount, namespace: HOSTING_NAMESPACE, hostRoot, d1Id: d1.value.id },
      repo,
      llm: { anthropicApiKey: anthropicKey, anthropicBaseUrl: c.env.CF_AI_GATEWAY_ANTHROPIC_URL ?? null, openaiApiKey: openaiKey, model: c.env.BUILD_MODEL ?? "claude-sonnet-4-6", preferFallback: (c.env.ANTHROPIC_ENABLED ?? "").toLowerCase() === "off" },
    };
    const dispatch = await dispatchBuild(c.env, payload);
    let status: BuildJobStatus = job.status;
    if (!dispatch.dispatched) {
      await markBuildJobFailed(c.env, job.id, { failedStage: "queued", error: dispatch.note ?? "dispatch_failed" });
      status = "failed";
    }
    console.log(JSON.stringify({ event: "build_job_start", jobId: job.id, project: projectId, slug, wbs: wbs.length, repo: Boolean(repo), dispatched: dispatch.dispatched, note: dispatch.note ?? null }));
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
  app.post("/internal/build-progress", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ ok: false, error: "invalid_json" }, 400); }
    const jobId = typeof body["jobId"] === "string" ? body["jobId"] : "";
    const status = typeof body["status"] === "string" ? body["status"] : "";
    if (!jobId || !(BUILD_JOB_STATUSES as readonly string[]).includes(status) || status === "done" || status === "failed") return c.json({ ok: false, error: "invalid_progress" }, 400);
    const ok = await advanceBuildJob(c.env, jobId, {
      status: status as Exclude<BuildJobStatus, "done" | "failed">,
      wbsDone: typeof body["wbsDone"] === "number" ? body["wbsDone"] : undefined,
      wbsTotal: typeof body["wbsTotal"] === "number" ? body["wbsTotal"] : undefined,
      spentUsd: typeof body["spentUsd"] === "number" ? body["spentUsd"] : undefined,
      commitSha: typeof body["commitSha"] === "string" ? body["commitSha"] : undefined,
      repoFullName: typeof body["repoFullName"] === "string" ? body["repoFullName"] : undefined,
      buildExitCode: typeof body["buildExitCode"] === "number" ? body["buildExitCode"] : undefined,
    });
    if (typeof body["message"] === "string" && body["message"]) await appendBuildJobEvent(c.env, jobId, status, body["message"], typeof body["meta"] === "object" && body["meta"] ? (body["meta"] as Record<string, unknown>) : {});
    return c.json({ ok: true, transitioned: ok });
  });

  // ── POST /internal/build-done ───────────────────────────────────────────────
  app.post("/internal/build-done", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ ok: false, error: "invalid_json" }, 400); }
    const jobId = typeof body["jobId"] === "string" ? body["jobId"] : "";
    if (!jobId) return c.json({ ok: false, error: "jobId_required" }, 400);
    const spentUsd = typeof body["spentUsd"] === "number" ? body["spentUsd"] : 0;
    const buildExitCode = typeof body["buildExitCode"] === "number" ? body["buildExitCode"] : null;
    if (body["ok"] === true) {
      const deployedUrl = typeof body["deployedUrl"] === "string" ? body["deployedUrl"] : "";
      if (!deployedUrl) return c.json({ ok: false, error: "deployedUrl_required" }, 400);
      const r = await markBuildJobDone(c.env, jobId, { deployedUrl, commitSha: typeof body["commitSha"] === "string" ? body["commitSha"] : null, spentUsd, buildExitCode: buildExitCode ?? -1, wbsDone: typeof body["wbsDone"] === "number" ? body["wbsDone"] : 0 });
      if (!r.ok && r.reason === "build_not_green") {
        // D-4: 컨테이너가 done이라 해도 빌드가 green이 아니면 믿지 않는다.
        await markBuildJobFailed(c.env, jobId, { failedStage: "building", error: `done claimed with build exit ${buildExitCode}`, spentUsd, buildExitCode });
        await appendBuildJobEvent(c.env, jobId, "failed", "build_not_green_rejected", { buildExitCode });
        return c.json({ ok: true, accepted: false, reason: "build_not_green" });
      }
      await appendBuildJobEvent(c.env, jobId, "done", "deployed", { deployedUrl });
      return c.json({ ok: true, accepted: r.ok });
    }
    const error = typeof body["error"] === "string" ? body["error"] : "unknown_error";
    const failedStage = typeof body["failedStage"] === "string" ? body["failedStage"] : "unknown";
    const ok = await markBuildJobFailed(c.env, jobId, { failedStage, error: error.slice(0, MAX_ERROR_CHARS), spentUsd, buildExitCode });
    await appendBuildJobEvent(c.env, jobId, "failed", error.slice(0, MAX_ERROR_CHARS), { failedStage });
    return c.json({ ok: true, accepted: ok });
  });

  return app;
}

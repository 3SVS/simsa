/**
 * routes/workspace-build-jobs.ts — SI 티어 Train B — B5: T1 빌드 잡 (D-4 · D-5 · D-6 · D-7 · D-12).
 *
 *   GET  /workspace/build-availability                 — [만들기]를 내밀어도 되는가(B-8 #578 결함 2: BUILD_OPEN + 설정)
 *   POST /workspace/projects/:id/build                 — 지시서가 있는 프로젝트의 빌드 잡 시작(S 모드, 계정 0)
 *   GET  /workspace/projects/:id/build-jobs            — 최근 잡 목록
 *   GET  /workspace/projects/:id/build-jobs/:jobId     — 잡 + 타임라인
 *   POST /internal/build-progress                      — 컨테이너 단계 콜백(Bearer INTERNAL_CALLBACK_TOKEN)
 *   POST /internal/build-done                          — 컨테이너 최종 콜백
 *
 * L-3 (Train L) 콜백 계약 확장: 두 콜백 모두 선택 필드
 *   usage: Array<{ vendor, modelRequested, modelActual, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, latencyMs, callSite?, callId? }>
 * 를 받아 llm_usage 원장(0070)에 job_kind "build"로 쓴다. 최대 200개, 잘못된 항목은 버리고 본 처리는 계속
 * (400 아님). 옛 컨테이너가 안 보내면 무시.
 *
 * ★델타 규약(#562 결함 2 — B-5b-2 구현자 필독): 각 콜백은 **직전 콜백 이후 새로 생긴 호출만** 싣는다.
 *   - build-progress: 그 사이 runBuildLoop `onUsage`로 받은 레코드만
 *   - build-done: 아직 보내지 않은 나머지만 — `outcome.usage`(누적 전체)를 **통째로 다시 보내지 않는다**
 *   - 각 항목에 `callId`(잡 안에서 유일, 재전송에 불변: 예 `<실행 nonce>:<태스크 id>:<턴>`)를 싣는다.
 *     runBuildLoop는 태스크마다 턴 번호를 0부터 다시 세므로 태스크 id를 넣지 않으면 충돌한다.
 * 규약을 어겨도 원가가 2배가 되지는 않는다 — 행 id가 (job_kind, job_id, callId|내용)에서 결정론적으로 나오고
 * `ON CONFLICT(id) DO NOTHING`이라 겹친 항목은 한 번만 남는다(llm-usage.ts CallbackUsageItemSchema 주석).
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
import { createProjectD1, ensureNamespace, toHostedSlug, HOSTED_D1_PREFIX, HOSTING_NAMESPACE } from "../workspace/hosting-provision.js";
import { ensureHostedRepo } from "../workspace/hosting-repo.js";
import {
  advanceBuildJob, appendBuildJobEvent, findActiveBuildJobForProject, getBuildJobById, insertQueuedBuildJob,
  listBuildJobEvents, listBuildJobsForProject, markBuildJobDone, markBuildJobFailed, BUILD_JOB_STATUSES, DEFAULT_BUILD_BUDGET_USD,
  type BuildJobStatus,
} from "../workspace/build-job-db.js";
import { RESERVED_SLUGS_FOR_HOSTING } from "../workspace/hosting-reserved.js";
import { recordCallbackUsage } from "../workspace/llm-usage.js";
import { BUILD_DISABLED, buildEnabled } from "../workspace/service-switches.js";

/**
 * L-3 (Train L): 콜백 본문의 선택 필드 `usage[]`를 원장에 쓴다. project·user는 **D1 잡 행에서**
 * (콜백 본문 값은 쓰지 않는다). 모르는 잡이면 쓰지 않는다. 옛 컨테이너가 안 보내면 아무 일도 없다.
 * 절대 던지지 않고, 잘못된 usage 때문에 본 처리(상태 전이)를 막지 않는다.
 */
async function recordBuildUsage(env: Env, jobId: string, raw: unknown): Promise<void> {
  if (raw === undefined || raw === null) return;
  try {
    const job = await getBuildJobById(env, jobId);
    if (!job) return;
    await recordCallbackUsage(env, raw, { jobKind: "build", jobId: job.id, projectId: job.projectId, userKey: job.userKey });
  } catch (err) {
    console.error(JSON.stringify({ event: "llm_usage_record_failed", job_kind: "build", job_id: jobId, reason: String((err as Error)?.message ?? err).slice(0, 200) }));
  }
}

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

/**
 * B-8 (PR #578 검증 결함 2) — 문 (a) "만들기"가 **지금 이 서버에서 끝까지 되는가.**
 *
 * 대시보드는 buildEnabled가 true일 때만 [만들기]를 보인다. "빌드 라우트가 있다"만으로는 부족하다: 실행체가
 * kind=build를 끝까지 못 하는 동안(builder_stage_not_implemented) 버튼을 내밀면, 누르기 전 안내(길면 45분 ·
 * Simsa 주소에 올라가요)가 없는 기능을 약속하고 모든 사용자가 "준비 중인 단계에서 멈췄어요"로 끝난다.
 *
 * 열림 = BUILD_OPEN이 **정확히 "on"**(fail-closed) **그리고** POST /build가 503으로 막을 설정이 하나도 없음
 * (콜백 토큰 · BUILDER · 호스팅 · LLM — POST와 같은 순서). reason은 운영 확인용(비밀 없음 — POST 오류 코드와 같은 말).
 */
export type BuildAvailabilityReason = "open" | "not_open" | "callback_token_missing" | "builder_unavailable" | "hosting_not_configured" | "llm_not_configured";

export function buildAvailabilityFor(env: Env): { buildEnabled: boolean; reason: BuildAvailabilityReason } {
  const closed = (reason: BuildAvailabilityReason) => ({ buildEnabled: false, reason });
  if (env.BUILD_OPEN !== "on") return closed("not_open");
  if (!env.INTERNAL_CALLBACK_TOKEN) return closed("callback_token_missing");
  if (!env.BUILDER) return closed("builder_unavailable");
  if (!env.HOSTING_CF_API_TOKEN || !env.HOSTING_CF_ACCOUNT_ID || !(env.HOSTING_ROOT_DOMAIN ?? "").trim()) return closed("hosting_not_configured");
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) return closed("llm_not_configured");
  return { buildEnabled: true, reason: "open" };
}

export function createWorkspaceBuildJobRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/workspace/*", corsMiddleware);

  // ── GET /workspace/build-availability ───────────────────────────────────────
  // 프로젝트와 무관한 서버 사실(계정·userKey 불필요). 옛 서버는 이 경로가 없어 전역 404 → 대시보드는 닫힘으로 본다.
  app.get("/workspace/build-availability", (c) => {
    const a = buildAvailabilityFor(c.env);
    return c.json({ ok: true, buildEnabled: a.buildEnabled, reason: a.reason }, 200, { "cache-control": "no-store" });
  });

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
    // #578 검증 결함 3: [다시 시도]는 같은 프로젝트·같은 slug다 — 전 잡의 D1을 그대로 쓴다(D-12 프로젝트당 D1 하나).
    // 종전엔 매번 새로 만들려다 이름 충돌 → 502 hosting_d1_failed로 다시 시도가 막다른 길이었다. 전 잡 행이 없는데
    // D1만 남은 경우(고아)는 createProjectD1이 이름으로 찾아 쓴다.
    const prior = (await listBuildJobsForProject(c.env, projectId, 20)).find((j) => j.slug === slug && j.d1Id);
    const d1 = prior?.d1Id
      ? { ok: true as const, value: { id: prior.d1Id, name: `${HOSTED_D1_PREFIX}${slug}` } }
      : await createProjectD1(c.env, slug);
    if (!d1.ok) return c.json({ ok: false, error: "hosting_d1_failed", detail: d1.error, cf: d1.cfErrors ?? null }, 502);

    // 3) 저장소 — 조직/App이 준비된 경우에만. 없으면 정직하게 없이 간다(zip은 여전히 가능).
    let repo: BuildDispatchPayload["repo"] = null;
    let repoNote: string | null = null;
    const repoRes = await ensureHostedRepo(c.env, { slug, description: project.title }).catch(() => null);
    if (repoRes && repoRes.ok) repo = { token: repoRes.value.token, org: repoRes.value.org, name: repoRes.value.name };
    else repoNote = repoRes && !repoRes.ok ? repoRes.error : "repo_error";

    // 4) 잡 행 + 디스패치
    const job = await insertQueuedBuildJob(c.env, { projectId, userKey, slug, wbsTotal: wbs.length, budgetUsd: DEFAULT_BUILD_BUDGET_USD, locale, d1Id: d1.value.id, repoFullName: repo ? `${repo.org}/${repo.name}` : null });
    await appendBuildJobEvent(c.env, job.id, "queued", repo ? "repo_ready" : `repo_skipped:${repoNote ?? "unknown"}`, { slug, d1Id: d1.value.id, d1Reused: Boolean(prior) });

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
    await recordBuildUsage(c.env, jobId, body["usage"]);
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
    await recordBuildUsage(c.env, jobId, body["usage"]);
    const spentUsd = typeof body["spentUsd"] === "number" ? body["spentUsd"] : 0;
    const buildExitCode = typeof body["buildExitCode"] === "number" ? body["buildExitCode"] : null;
    if (body["ok"] === true) {
      const deployedUrl = typeof body["deployedUrl"] === "string" ? body["deployedUrl"] : "";
      if (!deployedUrl) return c.json({ ok: false, error: "deployedUrl_required" }, 400);
      const r = await markBuildJobDone(c.env, jobId, { deployedUrl, commitSha: typeof body["commitSha"] === "string" ? body["commitSha"] : null, spentUsd, buildExitCode: buildExitCode ?? -1, wbsDone: typeof body["wbsDone"] === "number" ? body["wbsDone"] : 0 });
      if (!r.ok && r.reason === "build_not_green") {
        // D-4: 컨테이너가 done이라 해도 빌드가 green이 아니면 믿지 않는다.
        await markBuildJobFailed(c.env, jobId, { failedStage: "building", error: `done claimed with build exit ${buildExitCode}`, spentUsd, buildExitCode });
        // #578 검증 결함 5: 잡에는 주소를 저장하지 않지만(확인되지 않은 앱을 '내 앱'으로 보이지 않게), 컨테이너가
        // 올렸다고 주장한 주소는 남긴다 — 그 주소에 무언가 떠 있을 수 있고, 운영자가 찾아 내릴 수 있어야 한다.
        await appendBuildJobEvent(c.env, jobId, "failed", "build_not_green_rejected", { buildExitCode, claimedUrl: deployedUrl.slice(0, 300) });
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

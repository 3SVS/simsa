/**
 * routes/workspace-build-jobs.ts — SI 티어 Train B — B5: T1 빌드 잡 (D-4 · D-5 · D-6 · D-7 · D-12).
 *
 *   POST /workspace/projects/:id/build                 — 지시서가 있는 프로젝트의 빌드 잡 시작(S 모드, 계정 0)
 *   GET  /workspace/projects/:id/build-jobs            — 최근 잡 목록
 *   GET  /workspace/projects/:id/build-jobs/:jobId     — 잡 + 타임라인
 *   POST /internal/build-progress                      — 컨테이너 단계 콜백(Bearer = 그 잡의 jobToken) — 단계·wbsDone만
 *   POST /internal/build-artifact                      — B-5b-4·5(S3): 게이트 초록불 뒤 산출물(같은 인증) → R2 → **Worker가**
 *                                                        저장소 push · D1 마이그레이션 · WfP 배포 · 내용 확인 · done · 자동 확인(T2)
 *   POST /internal/build-done                          — 컨테이너 최종 보고(같은 인증). 실패는 기록, 성공 주장은 Worker가 이미
 *                                                        done을 기록한 잡에서만 받아 준다(기록하지 않는 보고). done은 Worker만
 *   (LLM은 routes/build-llm-proxy.ts — 같은 jobToken, 서버 키, 서버 권위 예산·예약)
 *
 * ★B-5b S3 (2026-10-01) — 산출물 → 배포(workspace/build-deploy.ts · build-artifact.ts):
 *   - 컨테이너는 배포 자격이 없다. 산출물(Worker 모듈·정적 자산·D1 마이그레이션·소스)은 **신뢰하지 않는 입력**으로 받는다:
 *     본문 상한(스트림 계수) → Zod strict + 경로 정규화(../·절대 경로·.git 거부, 원본 이름 보존) → 개수·바이트 [PILOT] 상한
 *     (넘으면 413 + failed(deploying, artifact_too_large:<구역>)) → 잡 토큰의 잡과 본문 jobId가 같아야(다르면 403, 상태 변화 없음).
 *   - 잡당 한 번(claimBuildArtifact — status='testing'이고 build_exit_code가 NULL일 때 원자적으로 0): 중복·재시도는 409.
 *   - 받은 산출물은 R2 `builds/<jobId>/artifact.json`(ASCII 키 — Rule 6)에 먼저 저장하고, 배포 설정·주소·d1 id·push 대상은
 *     전부 Worker 값(잡 행·상수)으로 정한다. deployed_url은 Worker가 자기 배포와 내용 확인 뒤에만 쓴다(컨테이너 URL 무시).
 *
 * ★B-5b S1 (2026-10-01) — 컨테이너 비밀 최소화 + B-6 예산 정지:
 *   - 컨테이너 페이로드에 **비밀이 없다**: 운영 CF 토큰·전역 콜백 토큰·조직 설치 토큰·LLM 키·userKey를 싣지 않는다.
 *     B-5b-2부터 그 컨테이너가 LLM이 만든 코드와 의존성(postinstall 포함)을 실행하기 때문이다(D-6 "운영 자격은
 *     Worker/Actions secret에만"). 컨테이너가 받는 것은 식별자(jobId·slug·d1Id)·지시서·locale·예산·Worker 주소, 그리고
 *     이 잡에만 통하는 **jobToken**(build-job-token.ts) 하나. 배포·push는 Worker가 한다(S3).
 *   - 콜백 인증: 그 잡의 jobToken만(다른 잡의 토큰 403 — 교차 잡 위조 차단, 전역 INTERNAL_CALLBACK_TOKEN도 403 —
 *     PR #569 S1 검증 결함 8로 호환 분기를 코드에서 닫았다).
 *   - 콜백이 쓸 수 있는 칸(결함 1·2): 단계·wbsDone·실패 사유뿐. repo_full_name(push 대상)·commit_sha·build_exit_code·
 *     wbs_total·deployed_url·done은 **Worker 소유** — S3의 push·배포는 insert 때 정한 repo_full_name·slug로 Worker가 한다
 *     (콜백 입력에서 대상을 받지 않는다). 콜백은 끝난 잡에 아무 흔적도 남기지 않는다(결함 7 — 이벤트는 전이가 있을 때만).
 *   - 킬스위치 BUILD_ENABLED="off"는 새 빌드뿐 아니라 **진행 중인 빌드**도 멈춘다(결함 6 — 진행 콜백·LLM 프록시에서).
 *     S3에서 더할 Worker 쪽 push·배포 단계도 시작 전에 buildEnabled를 먼저 본다(꺼져 있으면 stopActiveBuildJob).
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
  advanceBuildJob, appendBuildJobEvent, claimBuildArtifact, findActiveBuildJobForProject, getBuildJobById, insertQueuedBuildJob,
  listBuildJobEvents, listBuildJobsForProject, markBuildJobFailed, stopActiveBuildJob, BUILD_JOB_ACTIVE, BUILD_JOB_STATUSES, DEFAULT_BUILD_BUDGET_USD,
  type BuildJobStatus,
} from "../workspace/build-job-db.js";
import { BUILD_ARTIFACT_LIMITS, buildArtifactR2Key, parseBuildArtifact, serializeArtifactForStorage } from "../workspace/build-artifact.js";
import { runBuildDeploy, type BuildDeployDeps } from "../workspace/build-deploy.js";
import type { FetchLike } from "../github.js";
import { RESERVED_SLUGS_FOR_HOSTING } from "../workspace/hosting-reserved.js";
import { BUILD_DISABLED, buildEnabled } from "../workspace/service-switches.js";
import { authenticateBuildCallback, checkCallbackJob, mintBuildJobToken } from "../workspace/build-job-token.js";
import { buildDailyCapRejection, buildDailyCapsFor } from "../workspace/build-daily-caps.js";
import { consumeDailyCaps } from "../workspace/rate-limit.js";
import { clientNetworkKey } from "../workspace/beta-limits.js";
import { OPENAI_FALLBACK_MODEL } from "../workspace/anthropic-fetch.js";
import { DEFAULT_BUILD_MODEL, readCappedBody } from "./build-llm-proxy.js";

const MAX_ERROR_CHARS = 500;
/** 컨테이너가 done(ok:true)을 주장했을 때의 오류 코드 — 배포는 Worker만 한다(PR #569 S1 검증 결함 2). */
export const DONE_NOT_WORKER_OWNED = "done_not_worker_owned";
/** 컨테이너 builder-run.mjs BUILD_ARTIFACT_PATH와 같다(테스트가 비교). */
export const BUILD_ARTIFACT_PATH = "/internal/build-artifact";

/** 테스트 seam — 배포 파이프라인의 대기(sleep)·정지 조회·내용 확인 설정. 운영은 기본값. */
export type BuildJobRouteOptions = Partial<Pick<BuildDeployDeps, "sleep" | "isSuspended" | "contentCheck">>;

/**
 * 컨테이너가 받는 WBS 항목(지시서에서 순서대로).
 * B-5b-2: `must` — 이 항목의 완료 조건 중 하나라도 must 기능(features[].priority)에 속하면 true. 컨테이너의 WBS 실패 정책
 * (builder-work.mjs WBS_FAILURE_POLICY)이 이것으로 "멈춤(must) / 기록 후 계속(should·could)"을 가른다. 모르는 완료 조건·
 * 모르는 기능이 섞이면 must로 본다(보수 쪽 — 확인 못 한 것을 선택 사항으로 낮추지 않는다).
 */
export type BuildWbsItem = { id: string; title: string; order: number; acceptanceIds: string[]; dependsOn: string[]; must: boolean };

export function wbsFromDevSpec(spec: DevSpec): BuildWbsItem[] {
  const mustFeatures = new Set(spec.features.filter((f) => f.priority === "must").map((f) => f.id));
  const knownFeatures = new Set(spec.features.map((f) => f.id));
  const featureOfAc = new Map(spec.acceptance.map((a) => [a.id, a.featureId] as const));
  const isMust = (acceptanceIds: readonly string[]): boolean =>
    acceptanceIds.length === 0 ||
    acceptanceIds.some((id) => {
      const f = featureOfAc.get(id);
      return f === undefined || !knownFeatures.has(f) || mustFeatures.has(f);
    });
  return [...spec.workBreakdown]
    .sort((a, b) => a.order - b.order)
    .map((w) => ({ id: w.id, title: w.title, order: w.order, acceptanceIds: [...w.acceptanceIds], dependsOn: [...w.dependsOn], must: isMust(w.acceptanceIds) }));
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

export function createWorkspaceBuildJobRoutes(
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
  options: BuildJobRouteOptions = {},
): Hono<{ Bindings: Env }> {
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
  // 컨테이너가 쓸 수 있는 것은 단계(status)와 wbsDone뿐이다(PR #569 S1 검증 결함 1). repoFullName·commitSha·buildExitCode·
  // wbsTotal은 본문에 있어도 읽지 않는다 — push 대상·커밋·빌드 결과·WBS 수는 Worker 소유(insert 때 · S3에서 Worker가).
  // 본문의 usage[]·spentUsd도 읽지 않는다(B-5b S1): 원가·예산은 LLM 프록시만 쓴다 — 여기서도 쓰면 같은 호출이 두 번 잡힌다.
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
    // 킬스위치(결함 6): 꺼졌으면 진행 중인 잡도 여기서 멈춘다 — failed(그 단계, build_disabled) + transitioned:false
    // (컨테이너는 transitioned:false를 받으면 다음 단계로 가지 않는다). 새 빌드만 막던 종전 스위치는 폭주를 못 멈췄다.
    if (!buildEnabled(c.env)) {
      const stopped = await stopActiveBuildJob(c.env, jobId, BUILD_DISABLED);
      return c.json({ ok: true, transitioned: false, reason: BUILD_DISABLED, stopped });
    }
    const ok = await advanceBuildJob(c.env, jobId, {
      status: status as Exclude<BuildJobStatus, "done" | "failed">,
      wbsDone: typeof body["wbsDone"] === "number" ? body["wbsDone"] : undefined,
    });
    // 이벤트는 전이가 실제로 일어났을 때만(결함 7) — 끝난 잡·역행 콜백은 타임라인에 아무것도 남기지 않는다.
    if (ok && typeof body["message"] === "string" && body["message"]) await appendBuildJobEvent(c.env, jobId, status, body["message"], typeof body["meta"] === "object" && body["meta"] ? (body["meta"] as Record<string, unknown>) : {});
    return c.json({ ok: true, transitioned: ok });
  });

  // ── POST /internal/build-artifact (B-5b-4·5, S3) ────────────────────────────
  // 게이트 초록불 뒤 컨테이너가 산출물을 올린다. 받으면(잡당 한 번) R2에 저장하고 **이 요청 안에서** push → 배포 → 내용 확인 →
  // done → 자동 확인까지 하고 결과를 돌려준다(컨테이너는 최대 10분 기다린다 — 그사이 마감이면 컨테이너의 실패 보고가 잡을 닫는다).
  // 답 모양은 builder-run.mjs interpretArtifactReply가 읽는다:
  //   받음   → 200 { ok:true, accepted:true, status:"done"|"failed", failedStage?, error?, autoCheck? }
  //   안 받음 → 200 { ok:true, accepted:false, reason }(킬스위치·끝난 잡) · 409 artifact_already_received · 409 artifact_before_tests
  //   거절   → 401/403(인증 — 상태 변화 없음) · 413 artifact_too_large · 400 artifact_invalid(둘 다 잡을 failed(deploying)로)
  app.post(BUILD_ARTIFACT_PATH, async (c) => {
    const auth = await authenticateBuildCallback(c.env, c.req.header("authorization"));
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const jobId = auth.tokenJobId;
    /** 산출물 단계의 실패 — 토큰이 증명한 그 잡만(교차 잡은 여기 오기 전에 403). */
    const failArtifact = async (error: string): Promise<void> => {
      const changed = await markBuildJobFailed(c.env, jobId, { failedStage: "deploying", error: error.slice(0, MAX_ERROR_CHARS) });
      if (changed) await appendBuildJobEvent(c.env, jobId, "failed", error.slice(0, MAX_ERROR_CHARS), { failedStage: "deploying" });
    };
    const read = await readCappedBody(c.req.raw, BUILD_ARTIFACT_LIMITS.maxBodyBytes);
    if (!read.ok) {
      if (read.reason === "too_large") {
        await failArtifact("artifact_too_large:body");
        return c.json({ ok: false, error: "artifact_too_large", detail: "artifact_too_large:body" }, 413);
      }
      await failArtifact("artifact_invalid:unreadable");
      return c.json({ ok: false, error: "artifact_invalid", detail: "artifact_invalid:unreadable" }, 400);
    }
    const parsed = parseBuildArtifact(read.text);
    if (!parsed.ok) {
      // 본문이 다른 잡을 말하면(교차 잡) 아무것도 바꾸지 않는다.
      if (parsed.jobId !== null && !checkCallbackJob(auth, parsed.jobId).ok) return c.json({ ok: false, error: "job_token_mismatch" }, 403);
      await failArtifact(parsed.error);
      return c.json({ ok: false, error: parsed.status === 413 ? "artifact_too_large" : "artifact_invalid", detail: parsed.error }, parsed.status);
    }
    const scope = checkCallbackJob(auth, parsed.artifact.jobId);
    if (!scope.ok) return c.json({ ok: false, error: scope.error }, scope.status);
    // 킬스위치: 새 push·배포를 시작하지 않고 잡을 지금 단계에서 멈춘다.
    if (!buildEnabled(c.env)) {
      const stopped = await stopActiveBuildJob(c.env, jobId, BUILD_DISABLED);
      return c.json({ ok: true, accepted: false, reason: BUILD_DISABLED, stopped });
    }
    const job = await getBuildJobById(c.env, jobId);
    if (!job) return c.json({ ok: false, error: "not_found" }, 404);
    if (!BUILD_JOB_ACTIVE.has(job.status)) return c.json({ ok: true, accepted: false, reason: "job_not_active" });
    if (job.buildExitCode !== null) return c.json({ ok: false, error: "artifact_already_received" }, 409);
    if (job.status !== "testing") {
      // 테스트 단계(게이트)를 지나지 않은 산출물은 받지 않는다 — D-4.
      await failArtifact(`artifact_before_tests:${job.status}`);
      return c.json({ ok: false, error: "artifact_before_tests", status: job.status }, 409);
    }
    if (!(await claimBuildArtifact(c.env, jobId))) return c.json({ ok: false, error: "artifact_already_received" }, 409);

    // R2 — 받은 것을 먼저 남긴다(재배포·B-9의 원본). 키는 ASCII(`builds/<jobId>/artifact.json`).
    const failedReply = async (error: string) => {
      await failArtifact(error);
      return c.json({ ok: true, accepted: true, status: "failed", failedStage: "deploying", error });
    };
    if (!c.env.EVIDENCE) return failedReply("artifact_storage_unconfigured");
    try {
      await c.env.EVIDENCE.put(buildArtifactR2Key(jobId), serializeArtifactForStorage(parsed.artifact, new Date().toISOString()), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (err) {
      console.error(JSON.stringify({ event: "build_artifact_store_failed", jobId, reason: String((err as Error)?.message ?? err).slice(0, 120) }));
      return failedReply("artifact_store_failed");
    }
    await appendBuildJobEvent(c.env, jobId, "testing", "artifact_received", { stats: parsed.artifact.stats, summary: parsed.artifact.summary });

    const base = (c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/+$/, "");
    const outcome = await runBuildDeploy(c.env, { ...job, buildExitCode: 0 }, parsed.artifact, {
      fetch: fetchImpl,
      publicBaseUrl: base,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.isSuspended ? { isSuspended: options.isSuspended } : {}),
      ...(options.contentCheck ? { contentCheck: options.contentCheck } : {}),
    });
    console.log(JSON.stringify({ event: "build_deploy", jobId, status: outcome.status, ...(outcome.status === "failed" ? { failedStage: outcome.failedStage, error: outcome.error } : { autoCheck: outcome.autoCheck.started ? "started" : outcome.autoCheck.reason }) }));
    if (outcome.status === "done") {
      return c.json({ ok: true, accepted: true, status: "done", autoCheck: outcome.autoCheck.started ? { started: true } : { started: false, reason: outcome.autoCheck.reason } });
    }
    return c.json({ ok: true, accepted: true, status: "failed", failedStage: outcome.failedStage, error: outcome.error });
  });

  // ── POST /internal/build-done ───────────────────────────────────────────────
  // 컨테이너의 최종 보고. 실패는 그대로 기록한다. 성공 주장(ok:true)은 **Worker가 이미 done을 기록한 잡**에서만 받아 준다
  // (S3: Worker가 산출물로 배포·내용 확인을 끝낸 뒤 — 그 보고는 기록하지 않는다, 결함 7). 아직 활성인 잡의 성공 주장은
  // 배포로 뒷받침되지 않은 것이다(PR #569 S1 검증 결함 2) → 409 done_not_worker_owned + failed(그 단계). 본문의 deployedUrl
  // 같은 필드는 어느 경우에도 읽지 않는다 — done·deployed_url·commit_sha는 Worker가 자기 push·배포 뒤에만 쓴다.
  app.post("/internal/build-done", async (c) => {
    const auth = await authenticateBuildCallback(c.env, c.req.header("authorization"));
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ ok: false, error: "invalid_json" }, 400); }
    const jobId = typeof body["jobId"] === "string" ? body["jobId"] : "";
    if (!jobId) return c.json({ ok: false, error: "jobId_required" }, 400);
    const scope = checkCallbackJob(auth, jobId);
    if (!scope.ok) return c.json({ ok: false, error: scope.error }, scope.status);
    if (body["ok"] === true) {
      const current = await getBuildJobById(c.env, jobId);
      if (current && current.status === "done") return c.json({ ok: true, accepted: false, reason: "worker_owned_done" });
      await stopActiveBuildJob(c.env, jobId, DONE_NOT_WORKER_OWNED, current);
      return c.json({ ok: false, error: DONE_NOT_WORKER_OWNED }, 409);
    }
    // 실패 보고는 킬스위치가 꺼져 있어도 받는다(사유를 잃지 않게). spent_usd는 프록시가 계량한 값 그대로 — 본문
    // spentUsd·usage[]는 무시(서버 권위·이중 계상 금지). 빌드 종료 코드도 컨테이너의 주장이라 저장하지 않는다(결함 1).
    const error = typeof body["error"] === "string" ? body["error"] : "unknown_error";
    const failedStage = typeof body["failedStage"] === "string" ? body["failedStage"] : "unknown";
    const ok = await markBuildJobFailed(c.env, jobId, { failedStage, error: error.slice(0, MAX_ERROR_CHARS) });
    if (ok) await appendBuildJobEvent(c.env, jobId, "failed", error.slice(0, MAX_ERROR_CHARS), { failedStage });
    return c.json({ ok: true, accepted: ok });
  });

  return app;
}

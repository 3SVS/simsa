/**
 * routes/workspace-dev-spec.ts — T0 개발 지시서 저장/조회 (SI 티어 D-2, 2026-09-24).
 *
 *   PUT /workspace/projects/:id/dev-spec           — { userKey, devSpec } 저장.
 *                                                    스키마·무결성 실패 = 422 (저장 안 함).
 *   GET /workspace/projects/:id/dev-spec?userKey=  — 소유자만 조회. 없으면 404 no_dev_spec.
 *   POST /workspace/projects/:id/dev-spec/generate — { userKey, locale? } 브리프+항목에서 다단계
 *                                                    생성(D-3) → 무결성 통과본만 저장·반환.
 *                                                    실패는 503 llm_unavailable / 422 dev_spec_invalid.
 *
 *   POST /workspace/projects/:id/interview-pack   — C-A7: { userKey, locale?, confirmedItemIds? } → 유저가 자기
 *                                                    AI 채팅에 붙여넣을 인터뷰 텍스트(역추론 지시서 요약 기반).
 *   POST /workspace/projects/:id/interview-answer — C-A7: { userKey, answer } → 고정 양식 회수(Zod).
 *                                                    저장하지 않는다 — 로컬 정본에 반영 후 미러(C0 경로).
 *
 * 소유권 = 기존 owned-project 게이트(getOwnedProject). 응답은 "missing"과 "not owned"를
 * 구분하지 않는다(프로젝트 id 탐색 방지, workspace-ext와 동일 규율).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { corsHeaders, corsMiddleware } from "./cors.js";
import { getOwnedProject, type DbProject } from "../workspace/db.js";
import { listProjectSources } from "../workspace/project-sources-db.js";
import { evidenceFromRepo, evidenceFromWebsite, type FetchLike, type StackHint } from "../workspace/source-evidence.js";
import { mergeStackHints, provenanceFrom, type BaseProvenance } from "../workspace/provenance.js";
import { MAX_ANSWER_CHARS, buildInterviewPrompt, parseInterviewAnswer } from "../workspace/interview-pack.js";
import { validateDevSpec, summarizeForBeginner, type DevSpecValidation } from "../workspace/dev-spec.js";
import { generateDevSpec, makeDevSpecLlmCaller } from "../workspace/generate-dev-spec.js";
import { vendorFallback } from "../workspace/vendor-routing.js";
import { consumeUserDailyLimit } from "../workspace/rate-limit.js";
import { betaProjectCreateDailyLimit } from "../workspace/beta-limits.js";
import { insertUsageEvent } from "../workspace/usage-events-db.js";
import { sendLangfuseGeneration } from "../workspace/langfuse.js";
import { createUsageCollector, newLlmJobId, recordCollectedUsage, runAfterResponse } from "../workspace/llm-usage.js";

/** 베타 일일 상한 버킷 — 지시서 생성은 프로젝트 생성과 같은 한도(기본 20/day)를 따로 센다. */
export const BETA_DEV_SPEC_DAILY_BUCKET = "beta-dev-spec-daily";

/** 지시서는 텍스트 상태만 — 512KB 캡(스크린샷류는 R2). */
export const DEV_SPEC_JSON_CAP = 524_288;

export type DevSpecUpsertParse =
  | { ok: true; userKey: string; devSpecJson: string }
  | { ok: false; error: "invalid_body" | "userKey_required" | "dev_spec_too_large" | "dev_spec_invalid"; detail?: DevSpecValidation };

/** Pure — 입구 검증. 형식·크기·스키마·무결성 순. 테스트 고정. */
export function parseDevSpecUpsert(body: unknown): DevSpecUpsertParse {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim().slice(0, 64) : "";
  if (!userKey) return { ok: false, error: "userKey_required" };
  const v = validateDevSpec(b["devSpec"]);
  if (!v.ok) return { ok: false, error: "dev_spec_invalid", detail: v };
  const devSpecJson = JSON.stringify(v.spec);
  if (devSpecJson.length > DEV_SPEC_JSON_CAP) return { ok: false, error: "dev_spec_too_large" };
  return { ok: true, userKey, devSpecJson };
}

const json = (headers: Record<string, string>, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/**
 * D-2 amend — 유저가 확인한 항목 id(= "맞나요?" 카드에서 체크를 남긴 items[].id, 인터뷰 회수의 MUST).
 * 없으면 빈 배열(옛 클라이언트: 확인된 must 0). 모양이 틀리면 400 — 조용히 버리지 않는다.
 */
export const ConfirmedItemIdsSchema = z.array(z.string().trim().min(1).max(64)).max(60).optional();

/**
 * 기존 앱 문(entry_path = "code")의 지시서는 **앱에서 읽어낸 것**이다 — 클라이언트가 출처를 고르지
 * 않는다(정직성은 서버가 정한다). 나머지 갈래는 종전대로 generated.
 */
export function devSpecSourceFor(project: Pick<DbProject, "entryPath">): "generated" | "inferred" {
  return project.entryPath === "code" ? "inferred" : "generated";
}

/**
 * 역추론 출처 수집 — 새 감지기 없이 infer-intent가 쓰는 증거 수집기를 그대로 부른다.
 * 실패는 조용히: 스택을 못 읽으면 스택 키를 비울 뿐 생성은 계속한다(부가 정보).
 */
export async function gatherInferredProvenance(
  env: Env,
  project: Pick<DbProject, "id" | "entryPath" | "builtWith">,
  fetchImpl: FetchLike,
): Promise<BaseProvenance> {
  let stack: StackHint | null = null;
  try {
    const sources = await listProjectSources(env, project.id);
    const repo = sources.find((s) => s.type === "github_repo");
    const site = sources.find((s) => s.type === "website");
    const [siteEv, repoEv] = await Promise.all([
      site ? evidenceFromWebsite(site.reference, fetchImpl).catch(() => null) : Promise.resolve(null),
      repo ? evidenceFromRepo(repo.reference, fetchImpl).catch(() => null) : Promise.resolve(null),
    ]);
    stack = mergeStackHints(siteEv?.stack ?? null, repoEv?.stack ?? null);
  } catch (err) {
    console.warn("[workspace/dev-spec] provenance evidence failed:", err);
  }
  return provenanceFrom({ stack, entryPath: project.entryPath, declaredBuiltWith: project.builtWith });
}

/**
 * C-A7 — 인터뷰 프롬프트의 재료: 역추론 지시서 요약(기능 + 확인 여부). 순수.
 *
 * 유효한 지시서가 있으면 그 기능 목록을 쓴다 — inferred면 must = 유저가 확인한 것(D-2 amend 무결성이
 * 보장), 그 밖의 출처는 유저 자신의 기획이라 전부 확인된 것으로 본다. 지시서가 없거나 깨졌으면
 * 프로젝트 항목 + 클라이언트가 보낸 확인 id로 대신한다.
 */
export function interviewFeaturesFor(
  project: Pick<DbProject, "devSpec" | "items">,
  confirmedItemIds: readonly string[],
): { basis: "dev_spec" | "items" | "none"; features: Array<{ title: string; confirmed: boolean }> } {
  const v = project.devSpec ? validateDevSpec(project.devSpec) : null;
  if (v && v.ok) {
    const inferred = v.spec.meta.source === "inferred";
    return {
      basis: "dev_spec",
      features: v.spec.features.map((f) => ({ title: f.title, confirmed: inferred ? f.priority === "must" : true })),
    };
  }
  const wanted = new Set(confirmedItemIds);
  const items = Array.isArray(project.items) ? project.items : [];
  const features: Array<{ title: string; confirmed: boolean }> = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const title = typeof r["title"] === "string" ? r["title"].trim() : "";
    if (!title) continue;
    features.push({ title, confirmed: typeof r["id"] === "string" && wanted.has(r["id"]) });
  }
  return { basis: features.length ? "items" : "none", features };
}

const InterviewAnswerBodySchema = z.object({
  userKey: z.string().trim().min(1).max(64),
  answer: z.string().max(MAX_ANSWER_CHARS),
});

export function createWorkspaceDevSpecRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  app.put("/workspace/projects/:id/dev-spec", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(headers, 400, { ok: false, error: "invalid_json" });
    }
    const parsed = parseDevSpecUpsert(body);
    if (!parsed.ok) {
      if (parsed.error === "dev_spec_invalid" && parsed.detail && !parsed.detail.ok) {
        // 422: 무엇이 틀렸는지 기계가 읽을 수 있게 돌려준다(생성기가 해당 섹션만 재생성).
        return json(headers, 422, { ok: false, error: parsed.error, stage: parsed.detail.stage, issues: parsed.detail.issues });
      }
      return json(headers, 400, { ok: false, error: parsed.error });
    }

    const owned = await getOwnedProject(c.env, projectId, parsed.userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE workspace_projects
         SET dev_spec_json = ?, dev_spec_updated_at = ?
       WHERE id = ? AND user_key = ?`,
    )
      .bind(parsed.devSpecJson, now, projectId, parsed.userKey)
      .run();

    return json(headers, 200, { ok: true, updatedAt: now });
  });

  app.post("/workspace/projects/:id/dev-spec/generate", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(headers, 400, { ok: false, error: "invalid_json" });
    }
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim().slice(0, 64) : "";
    if (!userKey) return json(headers, 400, { ok: false, error: "userKey_required" });
    const locale = b["locale"] === "en" ? "en" : "ko";
    const confirmedParse = ConfirmedItemIdsSchema.safeParse(b["confirmedItemIds"] ?? undefined);
    if (!confirmedParse.success) return json(headers, 400, { ok: false, error: "invalid_confirmed_items" });
    const confirmedItemIds = confirmedParse.data ?? [];

    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    if (!c.env.ANTHROPIC_API_KEY) {
      // D-3: 예시 폴백 없음 — 키가 없으면 정직하게 불가.
      return json(headers, 503, { ok: false, error: "llm_unavailable" });
    }

    const daily = await consumeUserDailyLimit(c.env, BETA_DEV_SPEC_DAILY_BUCKET, userKey, betaProjectCreateDailyLimit(c.env));
    if (daily.limited) {
      return new Response(
        JSON.stringify({ ok: false, error: "rate_limited", scope: "beta_daily", retryAfterSeconds: daily.retryAfterSeconds }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": String(daily.retryAfterSeconds), ...headers } },
      );
    }

    // L-3 (Train L): 패스·재시도 호출마다 원장 1행(job_kind dev_spec, 한 job_id). 422·503이어도 기록 — 비용은 났다.
    const usage = createUsageCollector();
    const call = makeDevSpecLlmCaller(c.env.ANTHROPIC_API_KEY, c.env.CF_AI_GATEWAY_ANTHROPIC_URL, vendorFallback(c.env), c.env.DEV_SPEC_MODEL || undefined, usage.sink);
    // D-2 amend: 기존 앱 문은 역추론 — 출처(도구·갈래·스택)와 유저 확인 목록이 함께 간다.
    const source = devSpecSourceFor(owned);
    const provenance =
      source === "inferred" ? await gatherInferredProvenance(c.env, owned, fetch.bind(globalThis) as FetchLike) : undefined;
    const result = await generateDevSpec(
      {
        brief: owned.productSpec,
        items: owned.items,
        idea: owned.idea,
        locale,
        source,
        ...(source === "inferred" ? { confirmedItemIds, ...(provenance ? { provenance } : {}) } : {}),
      },
      call,
    );
    if (usage.events.length > 0) {
      await runAfterResponse(c, recordCollectedUsage(c.env, usage.events, { jobKind: "dev_spec", jobId: newLlmJobId("dsp"), projectId, userKey }));
    }

    // 관측: 패스 기록은 로그로, 토큰은 Langfuse로(사용자 응답에는 넣지 않는다 — llmUsage strip 규율).
    console.log(JSON.stringify({ event: "dev_spec_generate", project: projectId, ok: result.ok, passes: result.passes }));
    for (const u of result.llmUsage) {
      c.executionCtx.waitUntil(
        sendLangfuseGeneration(c.env, {
          traceName: "workspace/dev-spec-generate",
          callSite: "dev-spec",
          model: u.model,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cacheCreationInputTokens: u.cacheCreationInputTokens,
          cacheReadInputTokens: u.cacheReadInputTokens,
          latencyMs: u.latencyMs,
          metadata: { locale, ok: result.ok },
        }),
      );
    }
    await insertUsageEvent(c.env, { userKey, eventType: "workspace_dev_spec_generated", metadata: { ok: result.ok, passes: result.passes.length, source, confirmedItems: source === "inferred" ? confirmedItemIds.length : 0 } }).catch(() => undefined);

    if (!result.ok) {
      if (result.error === "llm_unavailable") return json(headers, 503, { ok: false, error: "llm_unavailable" });
      return json(headers, 422, { ok: false, error: "dev_spec_invalid", stage: result.stage, issues: result.issues });
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE workspace_projects SET dev_spec_json = ?, dev_spec_updated_at = ? WHERE id = ? AND user_key = ?`,
    )
      .bind(JSON.stringify(result.devSpec), now, projectId, userKey)
      .run();

    return json(headers, 200, { ok: true, devSpec: result.devSpec, summary: summarizeForBeginner(result.devSpec), repaired: result.repaired, updatedAt: now });
  });

  // ── C-A7: 인터뷰 프롬프트 팩 ──────────────────────────────────────────────
  // 유저가 자기 AI 채팅에 붙여넣을 텍스트. LLM 호출 없음(비용 0) — 결정론 조립.
  app.post("/workspace/projects/:id/interview-pack", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(headers, 400, { ok: false, error: "invalid_json" });
    }
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"].trim().slice(0, 64) : "";
    if (!userKey) return json(headers, 400, { ok: false, error: "userKey_required" });
    const locale = b["locale"] === "en" ? "en" : "ko";
    const confirmedParse = ConfirmedItemIdsSchema.safeParse(b["confirmedItemIds"] ?? undefined);
    if (!confirmedParse.success) return json(headers, 400, { ok: false, error: "invalid_confirmed_items" });

    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    const sources = await listProjectSources(c.env, projectId).catch(() => []);
    const site = sources.find((s) => s.type === "website");
    const { basis, features } = interviewFeaturesFor(owned, confirmedParse.data ?? []);
    const prompt = buildInterviewPrompt({ locale, appName: owned.title, appUrl: site?.reference ?? null, features });
    return json(headers, 200, {
      ok: true,
      prompt,
      basis,
      featureCount: features.length,
      unconfirmedCount: features.filter((f) => !f.confirmed).length,
    });
  });

  // ── C-A7: 인터뷰 답 회수 ──────────────────────────────────────────────────
  // 저장하지 않는다: 대시보드는 로컬이 정본이라, 회수 결과를 로컬에 반영한 뒤 미러(C0 경로)한다.
  // 서버에 곧장 쓰면 다음 자동 저장이 로컬 값으로 덮어써 조용히 사라진다.
  app.post("/workspace/projects/:id/interview-answer", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json(headers, 400, { ok: false, error: "invalid_json" });
    }
    const parsedBody = InterviewAnswerBodySchema.safeParse(body);
    if (!parsedBody.success) {
      const tooLong = parsedBody.error.issues.some((i) => i.path[0] === "answer" && i.code === "too_big");
      return json(headers, 400, { ok: false, error: tooLong ? "answer_too_long" : "invalid_body" });
    }
    const { userKey, answer } = parsedBody.data;

    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    const r = parseInterviewAnswer(answer);
    // 계측은 개수만 — 답의 내용(의도 원문)은 저장하지 않는다(D-21 ⓑ 내용 데이터는 opt-in).
    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_interview_answer_parsed",
      metadata: r.ok
        ? { ok: true, must: r.answer.must.length, differentNow: r.answer.differentNow.length, unread: r.answer.unread }
        : { ok: false, reason: r.reason },
    }).catch(() => undefined);
    if (!r.ok) return json(headers, 422, { ok: false, error: "answer_unreadable", reason: r.reason });
    return json(headers, 200, { ok: true, answer: r.answer });
  });

  app.get("/workspace/projects/:id/dev-spec", async (c) => {
    const headers = corsHeaders(c.req.header("origin") ?? null);
    const projectId = c.req.param("id");
    const userKey = (c.req.query("userKey") ?? "").trim();
    if (!userKey) return json(headers, 400, { ok: false, error: "userKey_required" });

    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) return json(headers, 404, { ok: false, error: "not_found" });

    const row = await c.env.DB.prepare(
      `SELECT dev_spec_json, dev_spec_updated_at FROM workspace_projects WHERE id = ? AND user_key = ?`,
    )
      .bind(projectId, userKey)
      .first<{ dev_spec_json: string | null; dev_spec_updated_at: string | null }>()
      .catch(() => null);
    if (!row || !row.dev_spec_json) return json(headers, 404, { ok: false, error: "no_dev_spec" });

    let devSpec: unknown;
    try {
      devSpec = JSON.parse(row.dev_spec_json);
    } catch {
      return json(headers, 404, { ok: false, error: "no_dev_spec" });
    }
    return json(headers, 200, { ok: true, devSpec, updatedAt: row.dev_spec_updated_at });
  });

  return app;
}

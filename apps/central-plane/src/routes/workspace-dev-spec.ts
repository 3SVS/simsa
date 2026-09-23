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
 * 소유권 = 기존 owned-project 게이트(getOwnedProject). 응답은 "missing"과 "not owned"를
 * 구분하지 않는다(프로젝트 id 탐색 방지, workspace-ext와 동일 규율).
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { corsHeaders, corsMiddleware } from "./cors.js";
import { getOwnedProject } from "../workspace/db.js";
import { validateDevSpec, summarizeForBeginner, type DevSpecValidation } from "../workspace/dev-spec.js";
import { generateDevSpec, makeDevSpecLlmCaller } from "../workspace/generate-dev-spec.js";
import { vendorFallback } from "../workspace/vendor-routing.js";
import { consumeUserDailyLimit } from "../workspace/rate-limit.js";
import { betaProjectCreateDailyLimit } from "../workspace/beta-limits.js";
import { insertUsageEvent } from "../workspace/usage-events-db.js";
import { sendLangfuseGeneration } from "../workspace/langfuse.js";

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

    const call = makeDevSpecLlmCaller(c.env.ANTHROPIC_API_KEY, c.env.CF_AI_GATEWAY_ANTHROPIC_URL, vendorFallback(c.env), c.env.DEV_SPEC_MODEL || undefined);
    const result = await generateDevSpec(
      { brief: owned.productSpec, items: owned.items, idea: owned.idea, locale, source: "generated" },
      call,
    );

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
    await insertUsageEvent(c.env, { userKey, eventType: "workspace_dev_spec_generated", metadata: { ok: result.ok, passes: result.passes.length } }).catch(() => undefined);

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

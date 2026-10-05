/**
 * routes/inspect-llm-proxy.ts — 검수 "agent" 엔진 전용 LLM 프록시 (2026-10-05).
 *
 *   POST /internal/inspect-llm/v1/messages   { system, user, maxTokens }  →  { ok, text }
 *
 * build-llm-proxy.ts의 원칙을 그대로 따른다(키는 Worker에만 · 런 범위 토큰 · 서버 고정 모델 · 서버 권위 예산 ·
 * 원장 단일 경로). 다른 점: 검수 실행기는 도구 호출·대화 재전송이 필요 없어 **단일 턴 텍스트**만 받는다 —
 * 허용 표면이 작을수록 과금을 바꾸는 필드가 섞일 틈이 없다.
 *
 * 한 번의 호출:
 *   1) 인증 — Bearer irt1.<runId>.<mac> (런 범위 토큰). 없음·위조 401. 전역 콜백 토큰은 403.
 *   2) 런 — 있어야(404) 하고 진행 중(queued·running)이어야(409) 한다. 검수 킬스위치 off면 503.
 *   3) 요청 — 크기·필드 허용 목록(Zod strict). 모델은 요청에서 받지 않는다(서버 고정, INSPECT_AGENT_MODEL).
 *   4) 예약 — 최악 비용을 inspection_agent_spend에 원자적으로 더한다(예산·호출 수 안에서만, 아니면 402).
 *   5) anthropicMessages(벤더 폴백·게이트웨이 회전 포함 — 기존 경로 그대로) → 실제 비용으로 정산 → 원장 1행
 *      (job_kind inspection · call_site inspect_agent · job_id = runId). 업스트림 실패는 정산 0(예약 해제).
 * 프롬프트 본문은 로그에 남기지 않는다(컨테이너가 이미 비밀을 가렸지만, 여기서도 내용은 찍지 않는다).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { anthropicEndpoint, anthropicMessages, type LlmUsageEvent } from "../workspace/anthropic-fetch.js";
import { vendorFallback } from "../workspace/vendor-routing.js";
import { priceTokens } from "../workspace/llm-pricing.js";
import { recordLlmUsage } from "../workspace/llm-usage.js";
import { inspectionEnabled, INSPECTION_DISABLED } from "../workspace/service-switches.js";
import { getVisualCheckById } from "../workspace/visual-check-db.js";
import { worstCaseCallUsd } from "./build-llm-proxy.js";
import { bearerOf, inspectAgentModel, reserveAgentSpend, settleAgentSpend, verifyRunToken } from "../workspace/inspection-agent.js";
import { constantTimeEqual } from "../workspace/build-job-token.js";

export const INSPECT_LLM_PATH = "/internal/inspect-llm/v1/messages";
export const INSPECT_AGENT_CALL_SITE = "inspect_agent";
export const INSPECT_LLM_MAX_OUTPUT_TOKENS = 2048;
const MAX_BODY_BYTES = 200 * 1024;
const UPSTREAM_TIMEOUT_MS = 90_000;

const BodySchema = z
  .object({
    system: z.string().min(1).max(20_000),
    user: z.string().min(1).max(60_000),
    maxTokens: z.number().int().positive().max(INSPECT_LLM_MAX_OUTPUT_TOKENS).optional(),
  })
  .strict();

function err(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json" } });
}

export function createInspectLlmProxyRoutes(fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post(INSPECT_LLM_PATH, async (c) => {
    const env = c.env;
    const presented = bearerOf(c.req.header("authorization"));
    if (!presented) return err(401, "unauthorized");
    const ict = env.INTERNAL_CALLBACK_TOKEN;
    if (typeof ict === "string" && ict.length > 0 && constantTimeEqual(presented, ict)) return err(403, "run_token_required");
    const auth = await verifyRunToken(env, "llm", presented);
    if (!auth.ok) return err(401, "unauthorized");
    const runId = auth.runId;

    if (!inspectionEnabled(env)) return err(503, INSPECTION_DISABLED);
    const run = await getVisualCheckById(env, runId);
    if (!run) return err(404, "run_not_found");
    if (run.status !== "queued" && run.status !== "running") return err(409, "run_not_active");
    if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) return err(503, "llm_unavailable");

    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return err(413, "request_too_large");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return err(400, "invalid_json");
    }
    const parsed = BodySchema.safeParse(parsedJson);
    if (!parsed.success) return err(400, "invalid_request");
    const maxTokens = parsed.data.maxTokens ?? 1024;

    const reservedUsd = worstCaseCallUsd(new TextEncoder().encode(raw).length, maxTokens);
    const reserved = await reserveAgentSpend(env, runId, reservedUsd);
    if (reserved === "not_agent_run") return err(403, "not_agent_run");
    if (reserved === "exhausted") return err(402, "budget_exhausted");

    const model = inspectAgentModel(env);
    const events: LlmUsageEvent[] = [];
    let actualUsd = 0;
    try {
      const data = await anthropicMessages(
        env.ANTHROPIC_API_KEY ?? "",
        { model, max_tokens: maxTokens, messages: [{ role: "user", content: `${parsed.data.system}\n\n---\n\n${parsed.data.user}` }] },
        UPSTREAM_TIMEOUT_MS,
        fetchImpl,
        anthropicEndpoint(env.CF_AI_GATEWAY_ANTHROPIC_URL),
        INSPECT_AGENT_CALL_SITE,
        { fallback: vendorFallback(env), onUsage: (u) => events.push(u), maxTotalMs: 20_000 },
      );
      const text = (data.content ?? []).map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
      for (const e of events) {
        const priced = priceTokens(e.modelActual, e);
        actualUsd += priced.costUsd;
        await recordLlmUsage(env, {
          ...e,
          callSite: INSPECT_AGENT_CALL_SITE,
          jobKind: "inspection",
          jobId: runId,
          projectId: run.projectId,
          userKey: run.userKey,
          costOverride: { costUsd: priced.costUsd, unpriced: priced.unpriced },
        }).catch(() => false);
      }
      await settleAgentSpend(env, runId, reservedUsd, actualUsd);
      return c.json({ ok: true, text });
    } catch (e) {
      await settleAgentSpend(env, runId, reservedUsd, actualUsd).catch(() => undefined);
      console.error(JSON.stringify({ event: "inspect_llm_failed", run_id: runId, reason: String((e as Error)?.message ?? e).slice(0, 160) }));
      return err(502, "upstream_failed");
    }
  });

  return app;
}

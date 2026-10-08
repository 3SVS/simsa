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
import { bearerOf, inspectAgentModelFor, inspectAgentV2Effort, inspectAgentV2Route, reserveAgentSpend, settleAgentSpend, verifyRunToken } from "../workspace/inspection-agent.js";
import { buildV2ResponsesBody, fromAnthropicResponse, toAnthropicRequest, usageFromResponses } from "../agent-v2.js";
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
    /** 오픈 베타 최소 비용: cheap = 관찰·행동(싼 모델), strong = 판정·추정(기본). 모델 이름은 서버가 고른다. */
    tier: z.enum(["cheap", "strong"]).optional(),
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

    const { model, fallbackModel } = inspectAgentModelFor(env, parsed.data.tier ?? "strong");
    const fb = vendorFallback(env);
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
        { fallback: fb && fallbackModel ? { ...fb, model: fallbackModel } : fb, onUsage: (u) => events.push(u), maxTotalMs: 20_000 },
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

  // ── 검사 엔진 v2: OpenAI Responses(함수 도구) — 같은 원칙(런 토큰·서버 고정 모델·원자 예약·원장 단일 경로) ──
  app.post(INSPECT_LLM_V2_PATH, async (c) => {
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
    if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) return err(503, "llm_unavailable");

    const raw = await c.req.text();
    if (raw.length > V2_MAX_BODY_BYTES) return err(413, "request_too_large");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return err(400, "invalid_json");
    }
    const parsed = V2BodySchema.safeParse(parsedJson);
    if (!parsed.success) return err(400, "invalid_request");

    // V-5 · Bae 2026-10-07: 주 = Claude 최상위(v2 전용 스위치), 대체 = gpt-5.6-sol. 모델은 서버가 고른다(요청은 못 고른다).
    const route = inspectAgentV2Route(env);
    if (route.length === 0) return err(503, "llm_unavailable");
    const req = { instructions: parsed.data.instructions, input: parsed.data.input, tools: parsed.data.tools, ...(parsed.data.maxOutputTokens ? { maxOutputTokens: parsed.data.maxOutputTokens } : {}) };
    const maxOut = Math.min(Math.max(256, parsed.data.maxOutputTokens ?? 8000), 16000);
    // 예약 = 경로 중 가장 비싼 모델 기준 최악 비용(대체로 넘어가도 예약이 모자라지 않게).
    const reservedUsd = Math.max(...route.map((r) => v2WorstCaseUsd(r.model, raw, maxOut)));
    const reserved = await reserveAgentSpend(env, runId, reservedUsd);
    if (reserved === "not_agent_run") return err(403, "not_agent_run");
    if (reserved === "exhausted") return err(402, "budget_exhausted");

    const t0 = Date.now();
    let lastStatus = 0;
    let lastDetail = "";
    for (const { vendor, model } of route) {
      const gwBase = (vendor === "anthropic" ? env.CF_AI_GATEWAY_ANTHROPIC_URL : env.CF_AI_GATEWAY_OPENAI_URL ?? "")?.trim().replace(/\/$/, "") ?? "";
      const targets =
        vendor === "anthropic"
          ? [...(gwBase ? [anthropicEndpoint(gwBase)] : []), anthropicEndpoint()]
          : [...(gwBase ? [`${gwBase}/responses`] : []), OPENAI_RESPONSES_DIRECT];
      const payload = vendor === "anthropic" ? toAnthropicRequest(req, model) : buildV2ResponsesBody(req, { model, effort: inspectAgentV2Effort(env) });
      const headers: Record<string, string> =
        vendor === "anthropic"
          ? { "x-api-key": env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" }
          : { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" };
      let badRequest = false;
      for (const url of targets) {
        let r: Response;
        try {
          r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(V2_UPSTREAM_TIMEOUT_MS) });
        } catch (e) {
          lastStatus = 0;
          lastDetail = `${vendor}: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
          continue;
        }
        if (!r.ok) {
          lastStatus = r.status;
          lastDetail = `${vendor}: ${(await r.text().catch(() => "")).slice(0, 300)}`;
          // 요청 자체가 잘못된 것(400·422)은 같은 벤더 다른 경로로도 같다 — 다음 벤더로. 게이트웨이 거절·5xx·429는 직행으로 한 번 더.
          if (r.status === 400 || r.status === 422) {
            badRequest = true;
            break;
          }
          continue;
        }
        const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        const conv = vendor === "anthropic" ? fromAnthropicResponse(j) : { output: Array.isArray(j?.["output"]) ? (j!["output"] as unknown[]) : [], model: typeof j?.["model"] === "string" ? (j!["model"] as string) : null, tokens: usageFromResponses(j?.["usage"]) };
        const modelActual = conv.model || model;
        const priced = priceTokens(modelActual, conv.tokens);
        await recordLlmUsage(env, {
          vendor,
          modelRequested: model,
          modelActual,
          ...conv.tokens,
          latencyMs: Date.now() - t0,
          callSite: INSPECT_AGENT_CALL_SITE,
          jobKind: "inspection",
          jobId: runId,
          projectId: run.projectId,
          userKey: run.userKey,
          costOverride: { costUsd: priced.costUsd, unpriced: priced.unpriced },
        }).catch(() => false);
        await settleAgentSpend(env, runId, reservedUsd, priced.costUsd);
        if (route[0] && route[0].model !== model) console.warn(JSON.stringify({ event: "inspect_llm_v2_fallback", run_id: runId, from: route[0].model, to: model, primary_status: lastStatus }));
        return c.json({ ok: true, output: conv.output, usage: conv.tokens, model: modelActual, vendor });
      }
      void badRequest;
    }
    await settleAgentSpend(env, runId, reservedUsd, 0).catch(() => undefined);
    console.error(JSON.stringify({ event: "inspect_llm_v2_failed", run_id: runId, status: lastStatus, detail: lastDetail.slice(0, 160) }));
    return err(502, `upstream_failed:${lastStatus}`);
  });

  return app;
}

export const INSPECT_LLM_V2_PATH = "/internal/inspect-llm/v2/responses";
const OPENAI_RESPONSES_DIRECT = "https://api.openai.com/v1/responses";
const V2_MAX_BODY_BYTES = 8 * 1024 * 1024;
const V2_UPSTREAM_TIMEOUT_MS = 200_000;

/** 대화에 들어올 수 있는 항목만(메시지·함수 호출·함수 결과·추론). 서버 키로 다른 도구(웹 검색 등)를 쓰지 못하게 도구는 function만. */
const V2ItemSchema = z.union([
  z.object({ role: z.enum(["user", "assistant"]), content: z.union([z.string().max(200_000), z.array(z.record(z.string(), z.unknown())).max(20)]) }).passthrough(),
  z.object({ type: z.enum(["function_call", "function_call_output", "reasoning", "message"]) }).passthrough(),
]);
const V2BodySchema = z
  .object({
    instructions: z.string().min(1).max(40_000),
    input: z.array(V2ItemSchema).min(1).max(2_000),
    tools: z.array(z.object({ type: z.literal("function"), name: z.string().min(1).max(64) }).passthrough()).max(40),
    maxOutputTokens: z.number().int().positive().max(16_000).optional(),
  })
  .strict();

/** 최악 비용 예약: 이미지(base64)는 장당 ~1,600토큰으로, 나머지 글자는 3자=1토큰으로 어림 — 캐시 없음·출력 상한까지. */
export function v2WorstCaseUsd(model: string, rawBody: string, maxOutputTokens: number): number {
  const images = (rawBody.match(/data:image\/[a-z]+;base64,/g) ?? []).length;
  const textChars = rawBody.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "").length;
  const inputTokens = Math.ceil(textChars / 3) + images * 1600;
  return priceTokens(model, { inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: maxOutputTokens }).costUsd;
}

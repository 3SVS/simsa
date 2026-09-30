/**
 * routes/build-llm-proxy.ts — Train B · B-5b S1: 빌드 전용 LLM 프록시 (B-6 서버 권위 예산).
 *
 *   POST /internal/build-llm/anthropic/v1/messages         — Anthropic Messages 모양 그대로
 *   POST /internal/build-llm/openai/v1/chat/completions    — OpenAI Chat Completions 모양 그대로
 *
 * 왜: 빌더 컨테이너는 B-5b-2부터 LLM이 만든 코드와 그 의존성을 실행한다. 그 안에 LLM 키를 두면 생성 코드가 읽어
 * 내보낼 수 있다. 그래서 컨테이너는 **잡 범위 토큰(jobToken)**만 들고, 키는 Worker에만 있다. 경로는 agent-worker
 * 클라이언트가 base URL만 바꿔 그대로 쓰는 모양이다:
 *   - ClaudeWorker/Anthropic SDK: baseURL = `<Worker>/internal/build-llm/anthropic` → SDK가 `/v1/messages`를 붙인다.
 *     jobToken은 SDK의 apiKey 자리(`x-api-key`)로 온다.
 *   - withOpenAiFallback: openaiBaseUrl = `<Worker>/internal/build-llm/openai/v1` → `/chat/completions`를 붙인다.
 *     jobToken은 openaiApiKey 자리(`Authorization: Bearer`)로 온다.
 * 둘 다 스트리밍을 쓰지 않는다(runBuildLoop = messages.create, 폴백 = 단일 POST) — 그래서 `stream: true`는 거절하고
 * 응답을 그대로 전달한 뒤 usage를 읽는다(원가를 정확히 셀 수 있는 모양만 받는다).
 *
 * 한 번의 호출:
 *   1) 메서드 POST만(405)
 *   2) 인증 — jobToken(x-api-key 또는 Bearer). 없음·위조(jobId 바꿔치기 포함) 401. 전역 콜백 토큰은 403
 *      (`job_token_required` — 어느 잡의 예산으로 쓸지 모르는 열쇠로는 돈을 쓰지 않는다)
 *   3) 잡 — 토큰의 잡이 있어야(404) 하고 활성이어야(409) 한다
 *   4) **예산** — spent_usd ≥ budget_usd면 업스트림을 부르지 않고 402 `budget_exhausted`
 *   5) 벤더 — Anthropic 킬스위치(ANTHROPIC_ENABLED="off")·키 없음은 503(업스트림 0)
 *   6) 요청 — 크기 상한(413) · JSON · Zod(모델 문자열·출력 상한·스트리밍 금지·n=1) · **모델 허용 목록**(서버가 고정)
 *   7) 업스트림(기존 게이트웨이 URL·서버 키 — anthropic-fetch.ts anthropicEndpoint · vendor-routing과 같은 설정) 전달
 *   8) 2xx면 응답의 usage·실응답 모델로 비용(llm-pricing.ts) → **build_jobs.spent_usd 원자 증가** + **llm_usage 원장 1행**
 *      (job_kind build, call_site build-proxy) → 응답 전달. usage를 못 읽으면 보수 추정(최고 단가 · 요청 크기 · 출력 상한)
 *      + unpriced — 조용한 $0은 없다.
 * 원장은 **여기 한 곳에서만** 쓴다. 빌드 콜백(build-progress·build-done)의 usage[]·spentUsd는 무시한다(이중 계상 금지).
 *
 * 우리 쪽 거절은 전부 `x-should-retry: false` — Anthropic SDK는 409·5xx를 기본 재시도하는데 그 거절은 다시 해도 같다.
 * 업스트림 오류는 상태·본문을 그대로 넘긴다(SDK가 5xx·429는 재시도, 폴백 클라이언트는 다음 벤더로).
 *
 * 한계(정직): 예산 확인과 증가 사이에 같은 잡의 호출이 **동시에** 여러 개 들어오면 각각 한 번씩 초과할 수 있다
 * (초과 폭 ≤ 동시 호출 수 × 호출 1회 비용 — 출력 상한이 1회 비용을 묶는다). 빌드 루프는 호출을 순서대로 한다.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { anthropicEndpoint, openAiUsageToAnthropic, OPENAI_FALLBACK_MODEL, usageEventFrom, type AnthropicMessagesData } from "../workspace/anthropic-fetch.js";
import { addBuildJobSpend, BUILD_JOB_ACTIVE, getBuildJobById } from "../workspace/build-job-db.js";
import { bearerOf, constantTimeEqual, parseBuildJobToken, verifyBuildJobToken } from "../workspace/build-job-token.js";
import { priceTokens } from "../workspace/llm-pricing.js";
import { recordLlmUsage } from "../workspace/llm-usage.js";

export const BUILD_LLM_ANTHROPIC_PATH = "/internal/build-llm/anthropic/v1/messages";
export const BUILD_LLM_OPENAI_PATH = "/internal/build-llm/openai/v1/chat/completions";
/** 컨테이너가 쓸 base URL 접미(Worker 출처 뒤) — builder-run.mjs buildLlmConfig와 같아야 한다(테스트 고정). */
export const BUILD_LLM_ANTHROPIC_BASE_SUFFIX = "/internal/build-llm/anthropic";
export const BUILD_LLM_OPENAI_BASE_SUFFIX = "/internal/build-llm/openai/v1";

/** 요청 본문 상한. 빌드 루프는 턴마다 대화 전체를 다시 보낸다 — 컨텍스트 창(수십만 토큰)보다 넉넉하고 그 이상은 거절. */
export const BUILD_LLM_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
/** 호출 1회 출력 상한 — 1회 비용의 상한이자 동시 호출 초과 폭의 상한. runBuildLoop 8192 · 폴백 예산 최대 64000. */
export const BUILD_LLM_MAX_OUTPUT_TOKENS = Object.freeze({ anthropic: 32_768, openai: 64_000 });
/** 업스트림 대기 상한(SDK 기본 타임아웃과 같은 10분). */
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;
export const BUILD_LLM_CALL_SITE = "build-proxy";
/** B5 [PILOT]: 구현 모델 기본값(BUILD_MODEL 미설정). workspace-build-jobs.ts가 페이로드에 같은 값을 싣는다. */
export const DEFAULT_BUILD_MODEL = "claude-sonnet-4-6";
/** 오류 코드 — 컨테이너(builder-run.mjs BUDGET_EXHAUSTED)가 이 문자열로 예산 정지를 안다. */
export const BUDGET_EXHAUSTED = "budget_exhausted";

type Vendor = "anthropic" | "openai";

/** 서버가 고정하는 모델 허용 목록. 요청이 다른 모델을 부르면(더 비싼 모델·다른 용도) 400. */
export function buildLlmAllowedModels(env: Pick<Env, "BUILD_MODEL">): Readonly<Record<Vendor, readonly string[]>> {
  const configured = (env.BUILD_MODEL ?? "").trim();
  return { anthropic: [configured || DEFAULT_BUILD_MODEL], openai: [OPENAI_FALLBACK_MODEL] };
}

/** anthropic-fetch.ts openAiUrl과 같은 규칙(게이트웨이 베이스면 `/chat/completions`, 없으면 직행). */
function openAiChatEndpoint(baseUrl?: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
}

/** 우리 쪽 거절 — 벤더 오류 모양(SDK가 그대로 오류로 만든다) + 재시도 금지. */
function reject(vendor: Vendor, status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  const body = vendor === "anthropic" ? { type: "error", error: { type: code, message } } : { error: { type: code, code, message } };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-should-retry": "false", ...extra } });
}

const AnthropicRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(120),
    max_tokens: z.number().int().positive().max(BUILD_LLM_MAX_OUTPUT_TOKENS.anthropic),
    messages: z.array(z.unknown()).min(1).max(5_000),
    stream: z.literal(false).optional(),
  })
  .passthrough();

const OpenAiRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(120),
    messages: z.array(z.unknown()).min(1).max(10_000),
    // 출력 상한은 필수 — 없으면 모델 최대까지 생성할 수 있다(1회 비용 상한이 사라진다).
    max_completion_tokens: z.number().int().positive().max(BUILD_LLM_MAX_OUTPUT_TOKENS.openai),
    max_tokens: z.number().int().positive().max(BUILD_LLM_MAX_OUTPUT_TOKENS.openai).optional(),
    n: z.literal(1).optional(),
    stream: z.literal(false).optional(),
  })
  .passthrough();

/** content-length를 믿지 않고 스트림을 세며 읽는다. 넘치면 읽기를 멈춘다. */
async function readCappedBody(req: Request, max: number): Promise<{ ok: true; text: string; bytes: number } | { ok: false; reason: "too_large" | "unreadable" }> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: true, text: "", bytes: 0 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return { ok: false, reason: "unreadable" };
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf), bytes: total };
}

function logLine(fields: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify(fields));
  } catch {
    /* 로깅이 호출을 깨면 안 된다 */
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function handle(vendor: Vendor, c: { env: Env; req: { raw: Request; method: string; header: (name: string) => string | undefined } }, fetchImpl: FetchLike): Promise<Response> {
  const env = c.env;
  if (c.req.method !== "POST") return reject(vendor, 405, "method_not_allowed", "POST only", { allow: "POST" });

  // ── 2) 인증: 잡 범위 토큰만 ──
  const presented = (c.req.header("x-api-key") ?? "").trim() || bearerOf(c.req.header("authorization"));
  if (!presented) return reject(vendor, 401, "unauthorized", "job token required");
  let jobId: string;
  if (parseBuildJobToken(presented)) {
    const v = await verifyBuildJobToken(env, presented);
    if (!v.ok) return reject(vendor, 401, "unauthorized", "invalid job token");
    jobId = v.jobId;
  } else if (env.INTERNAL_CALLBACK_TOKEN && constantTimeEqual(presented, env.INTERNAL_CALLBACK_TOKEN)) {
    return reject(vendor, 403, "job_token_required", "this route spends one build job's budget — use that job's token");
  } else {
    return reject(vendor, 401, "unauthorized", "invalid job token");
  }

  // ── 3) 잡 ──
  const job = await getBuildJobById(env, jobId).catch(() => null);
  if (!job) return reject(vendor, 404, "job_not_found", "unknown build job");
  if (!BUILD_JOB_ACTIVE.has(job.status)) return reject(vendor, 409, "job_not_active", `build job is ${job.status}`);

  // ── 4) 예산(서버 권위) ──
  if (job.spentUsd >= job.budgetUsd) {
    logLine({ event: "build_llm_budget_exhausted", job_id: job.id, vendor, spent_usd: job.spentUsd, budget_usd: job.budgetUsd });
    return reject(vendor, 402, BUDGET_EXHAUSTED, `build budget exhausted ($${job.spentUsd.toFixed(2)} of $${job.budgetUsd.toFixed(2)})`, {
      "x-simsa-build-spent-usd": String(job.spentUsd),
      "x-simsa-build-budget-usd": String(job.budgetUsd),
    });
  }

  // ── 5) 벤더 ──
  if (vendor === "anthropic" && env.ANTHROPIC_ENABLED === "off") return reject(vendor, 503, "vendor_disabled", "anthropic is switched off — use the openai route");
  const serverKey = vendor === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!serverKey) return reject(vendor, 503, "vendor_not_configured", `${vendor} is not configured`);

  // ── 6) 요청 ──
  const read = await readCappedBody(c.req.raw, BUILD_LLM_MAX_REQUEST_BYTES);
  if (!read.ok) return read.reason === "too_large" ? reject(vendor, 413, "request_too_large", `request body over ${BUILD_LLM_MAX_REQUEST_BYTES} bytes`) : reject(vendor, 400, "invalid_request", "unreadable body");
  const raw = safeJson(read.text);
  if (!raw) return reject(vendor, 400, "invalid_request", "body must be a JSON object");
  if (raw["stream"] === true) return reject(vendor, 400, "stream_not_supported", "streaming is not supported on the build proxy");
  const parsed = vendor === "anthropic" ? AnthropicRequestSchema.safeParse(raw) : OpenAiRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "body").slice(0, 5).join(",");
    return reject(vendor, 400, "invalid_request", `invalid fields: ${fields}`);
  }
  const requestBody: Record<string, unknown> = { ...parsed.data };
  const requestModel = String(requestBody["model"]);
  if (!buildLlmAllowedModels(env)[vendor].includes(requestModel)) return reject(vendor, 400, "model_not_allowed", `model ${requestModel.slice(0, 60)} is not allowed for builds`);
  if (vendor === "openai") delete requestBody["service_tier"]; // 단가표(Standard)와 다른 등급을 부르지 않는다
  const maxOut = Number(vendor === "anthropic" ? requestBody["max_tokens"] : requestBody["max_completion_tokens"]);

  // ── 7) 업스트림 ──
  const url = vendor === "anthropic" ? anthropicEndpoint(env.CF_AI_GATEWAY_ANTHROPIC_URL) : openAiChatEndpoint(env.CF_AI_GATEWAY_OPENAI_URL);
  const version = (c.req.header("anthropic-version") ?? "").trim();
  const headers: Record<string, string> =
    vendor === "anthropic"
      ? { "x-api-key": serverKey, "anthropic-version": /^\d{4}-\d{2}-\d{2}$/.test(version) ? version : "2023-06-01", "content-type": "application/json", "user-agent": "simsa-central-plane/1.0 (build-proxy)" }
      : { authorization: `Bearer ${serverKey}`, "content-type": "application/json" };
  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    logLine({ event: "build_llm_upstream_error", job_id: job.id, vendor, status: null, reason: String((err as Error)?.message ?? err).slice(0, 160) });
    return reject(vendor, 502, "upstream_unreachable", "LLM upstream unreachable");
  }
  const latencyMs = Date.now() - t0;
  const text = await upstream.text().catch(() => "");
  if (!upstream.ok) {
    logLine({ event: "build_llm_upstream_error", job_id: job.id, vendor, status: upstream.status, latency_ms: latencyMs });
    const passHeaders: Record<string, string> = { "content-type": upstream.headers.get("content-type") ?? "application/json" };
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) passHeaders["retry-after"] = retryAfter;
    const requestId = upstream.headers.get("request-id");
    if (requestId) passHeaders["request-id"] = requestId;
    return new Response(text.slice(0, 8_000), { status: upstream.status, headers: passHeaders });
  }

  // ── 8) 계량: 비용 → spent_usd(원자) → 원장 1행 ──
  const resp = safeJson(text);
  const modelActual = typeof resp?.["model"] === "string" && resp["model"].trim() ? resp["model"].trim() : requestModel;
  const usageRaw = resp?.["usage"];
  const hasUsage = typeof usageRaw === "object" && usageRaw !== null;
  const usage: AnthropicMessagesData["usage"] = vendor === "anthropic" ? (hasUsage ? (usageRaw as AnthropicMessagesData["usage"]) : undefined) : openAiUsageToAnthropic(usageRaw);
  let event = usageEventFrom(vendor, requestModel, modelActual, usage, latencyMs, BUILD_LLM_CALL_SITE);
  let priced = priceTokens(modelActual, event);
  if (!hasUsage) {
    // usage 없는 2xx — 청구는 됐을 수 있다. 요청 크기(≈4바이트/토큰)·출력 상한을 최고 단가로(조용한 $0 금지).
    event = { ...event, inputTokens: Math.ceil(read.bytes / 4), cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: Number.isFinite(maxOut) ? maxOut : 0 };
    priced = { ...priceTokens("", event), unpriced: true };
    logLine({ event: "build_llm_usage_missing", job_id: job.id, vendor, model_actual: modelActual });
  }
  const costUsd = Number.isFinite(priced.costUsd) && priced.costUsd > 0 ? priced.costUsd : 0;
  try {
    await addBuildJobSpend(env, job.id, costUsd);
  } catch (err) {
    logLine({ event: "build_llm_spend_failed", job_id: job.id, cost_usd: costUsd, reason: String((err as Error)?.message ?? err).slice(0, 160) });
  }
  const responseId = typeof resp?.["id"] === "string" && resp["id"] ? resp["id"].slice(0, 80) : "";
  await recordLlmUsage(env, {
    ...event,
    jobKind: "build",
    jobId: job.id,
    projectId: job.projectId,
    userKey: job.userKey,
    costOverride: { costUsd, unpriced: priced.unpriced },
    ...(responseId ? { rowKey: `proxy:${vendor}:${responseId}` } : {}),
  });
  const spentAfter = Math.round((job.spentUsd + costUsd) * 1_000_000) / 1_000_000;
  logLine({ event: "build_llm_call", job_id: job.id, vendor, model_actual: modelActual, cost_usd: costUsd, unpriced: priced.unpriced, spent_usd: spentAfter, budget_usd: job.budgetUsd, latency_ms: latencyMs });
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-simsa-build-spent-usd": String(spentAfter),
      "x-simsa-build-budget-usd": String(job.budgetUsd),
    },
  });
}

export function createBuildLlmProxyRoutes(fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.all(BUILD_LLM_ANTHROPIC_PATH, (c) => handle("anthropic", c, fetchImpl));
  app.all(BUILD_LLM_OPENAI_PATH, (c) => handle("openai", c, fetchImpl));
  return app;
}

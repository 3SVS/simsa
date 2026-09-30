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
 *   4) **킬스위치** — BUILD_ENABLED="off"면 업스트림을 부르지 않고 503 `build_disabled` + 잡을 그 단계에서 failed로
 *      (PR #569 S1 검증 결함 6: 종전 스위치는 새 빌드만 막아서 진행 중인 잡은 예산 끝까지 계속 썼다)
 *   5) **예산 빠른 확인** — spent_usd ≥ budget_usd면 본문도 읽지 않고 402 `budget_exhausted`
 *   6) 벤더 — Anthropic 킬스위치(ANTHROPIC_ENABLED="off")·키 없음은 503(업스트림 0)
 *   7) 요청 — 크기 상한(413) · JSON · **필드 허용 목록**(Zod strict — 빌드 루프가 실제로 보내는 필드만; 서버 도구·MCP·
 *      service_tier·thinking·1시간 캐시·이미지/문서 블록 등 과금을 바꾸는 것은 400 — 결함 5) · **모델 허용 목록**(서버 고정)
 *   8) **예약**(결함 4) — 그 호출의 최악 비용을 spent_usd에 원자적으로 더한다(활성 · spent < budget일 때만; 아니면 402).
 *      동시 호출이 몇 개든 한 번에 하나만 들어간다 → 예산 초과 폭 ≤ 호출 1회 비용
 *   9) 업스트림(기존 게이트웨이 URL·서버 키 — anthropic-fetch.ts anthropicEndpoint · vendor-routing과 같은 설정) 전달
 *  10) 2xx면 응답의 usage·실응답 모델로 비용(llm-pricing.ts) → **정산**(예약분 − 실제) + **llm_usage 원장 1행**
 *      (job_kind build, call_site build-proxy) → 응답 전달. usage를 못 읽으면 보수 추정(최고 단가 · 요청 크기 · 출력 상한)
 *      + unpriced — 조용한 $0은 없다. 업스트림 실패는 정산 0(예약 해제).
 * 원장은 **여기 한 곳에서만** 쓴다. 빌드 콜백(build-progress·build-done)의 usage[]·spentUsd는 무시한다(이중 계상 금지).
 *
 * 우리 쪽 거절은 전부 `x-should-retry: false` — Anthropic SDK는 409·5xx를 기본 재시도하는데 그 거절은 다시 해도 같다.
 * 업스트림 오류는 상태·본문을 그대로 넘긴다(SDK가 5xx·429는 재시도, 폴백 클라이언트는 다음 벤더로).
 *
 * 예약의 한계(정직): 같은 잡의 호출이 동시에 오면(빌드 루프는 순차라 정상 경로에는 없다) 먼저 들어간 호출이 정산될
 * 때까지 나머지는 402다 — 남은 예산이 있어도. Worker가 정산 전에 죽으면 예약분이 spent에 남는다(보수 쪽 실패).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { anthropicEndpoint, openAiUsageToAnthropic, OPENAI_FALLBACK_MODEL, usageEventFrom, type AnthropicMessagesData } from "../workspace/anthropic-fetch.js";
import { BUILD_JOB_ACTIVE, getBuildJobById, reserveBuildJobSpend, settleBuildJobSpend, stopActiveBuildJob } from "../workspace/build-job-db.js";
import { bearerOf, constantTimeEqual, parseBuildJobToken, verifyBuildJobToken } from "../workspace/build-job-token.js";
import { CONSERVATIVE_PRICING, priceTokens } from "../workspace/llm-pricing.js";
import { recordLlmUsage } from "../workspace/llm-usage.js";
import { BUILD_DISABLED, buildEnabled } from "../workspace/service-switches.js";

export const BUILD_LLM_ANTHROPIC_PATH = "/internal/build-llm/anthropic/v1/messages";
export const BUILD_LLM_OPENAI_PATH = "/internal/build-llm/openai/v1/chat/completions";
/** 컨테이너가 쓸 base URL 접미(Worker 출처 뒤) — builder-run.mjs buildLlmConfig와 같아야 한다(테스트 고정). */
export const BUILD_LLM_ANTHROPIC_BASE_SUFFIX = "/internal/build-llm/anthropic";
export const BUILD_LLM_OPENAI_BASE_SUFFIX = "/internal/build-llm/openai/v1";

/** 요청 본문 상한. 빌드 루프는 턴마다 대화 전체를 다시 보낸다 — 컨텍스트 창(수십만 토큰)보다 넉넉하고 그 이상은 거절. */
export const BUILD_LLM_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
/** 호출 1회 출력 상한 — 1회 비용의 상한(= 예약액의 출력 몫). runBuildLoop 8192 · 폴백 예산 최대 64000. */
export const BUILD_LLM_MAX_OUTPUT_TOKENS = Object.freeze({ anthropic: 32_768, openai: 64_000 });
/** 예약 계산의 입력 여유 토큰 — 벤더가 붙이는 도구 사용 시스템 프롬프트(수백 토큰)를 덮는다. */
export const BUILD_LLM_RESERVE_OVERHEAD_TOKENS = 2_000;
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

/**
 * 호출 1회의 최악 비용(USD) = 예약액(결함 4). 실제 청구가 이것을 넘지 않게 잡는다:
 *   - 입력 토큰 ≤ 요청 바이트(바이트 수준 BPE — 토큰 하나는 1바이트 이상) + 여유(BUILD_LLM_RESERVE_OVERHEAD_TOKENS)
 *   - 입력 쪽 단가 = 표 전체의 최고(입력·캐시 쓰기 중 큰 것) — 실응답 모델이 무엇이든
 *   - 출력 = 요청의 출력 상한 × 표 최고 출력 단가
 * usage 없는 2xx의 보수 청구(바이트/4 · 출력 상한 · 최고 단가)도 이 안에 든다.
 */
export function worstCaseCallUsd(requestBytes: number, maxOutputTokens: number): number {
  const bytes = Number.isFinite(requestBytes) && requestBytes > 0 ? requestBytes : 0;
  const out = Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 0;
  const inputRate = Math.max(CONSERVATIVE_PRICING.inputPerMTok, CONSERVATIVE_PRICING.cacheWritePerMTok);
  return ((bytes + BUILD_LLM_RESERVE_OVERHEAD_TOKENS) * inputRate + out * CONSERVATIVE_PRICING.outputPerMTok) / 1_000_000;
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

// ── 요청 허용 목록(결함 5) ────────────────────────────────────────────────────────────────────────────
// 원가는 네 토큰 카운터로만 센다(llm-pricing). 그러니 **그 넷 밖에서 청구되는 것**(서버 도구 사용료·MCP·등급·1시간 캐시
// 쓰기 가산 등)이 섞일 수 있는 필드는 업스트림에 보내지 않는다. 기준은 agent-worker가 실제로 보내는 모양:
//   Anthropic — runBuildLoop: model·max_tokens·system(블록 + cache_control ephemeral)·messages·tools(함수)·tool_choice
//   OpenAI    — openai-fallback toOpenAiBody: model·max_completion_tokens·messages(system·user·assistant+tool_calls·tool)·
//               tools(function)·tool_choice
// 최상위·도구·시스템은 strict(모르는 키 400). 메시지 블록은 **종류**를 제한하고(text·tool_use·tool_result) 모르는 키는
// 통과시킨다 — runBuildLoop가 응답의 tool_use 블록을 그대로 되돌려 보내므로 벤더가 응답에 새 필드를 더해도 빌드가 깨지지
// 않게. 대신 cache_control은 어디서든 strict(ephemeral · ttl 5m만).

const CacheControlSchema = z.object({ type: z.literal("ephemeral"), ttl: z.literal("5m").optional() }).strict();
const AnthropicTextBlockSchema = z.object({ type: z.literal("text"), text: z.string(), cache_control: CacheControlSchema.optional() }).passthrough();
const AnthropicToolUseBlockSchema = z
  .object({ type: z.literal("tool_use"), id: z.string().min(1).max(256), name: z.string().min(1).max(128), input: z.unknown(), cache_control: CacheControlSchema.optional() })
  .passthrough();
const AnthropicToolResultBlockSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().min(1).max(256),
    content: z.union([z.string(), z.array(AnthropicTextBlockSchema)]).optional(),
    is_error: z.boolean().optional(),
    cache_control: CacheControlSchema.optional(),
  })
  .passthrough();
const AnthropicBlockSchema = z.discriminatedUnion("type", [AnthropicTextBlockSchema, AnthropicToolUseBlockSchema, AnthropicToolResultBlockSchema]);
const AnthropicMessageSchema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.union([z.string(), z.array(AnthropicBlockSchema).min(1)]) })
  .strict();
/** 클라이언트 함수 도구만 — 서버 도구(web_search·code_execution·web_fetch …)는 `type`·전용 키가 달라 strict에서 걸린다. */
const AnthropicToolSchema = z
  .object({
    type: z.literal("custom").optional(),
    name: z.string().min(1).max(128),
    description: z.string().max(10_000).optional(),
    input_schema: z.record(z.string(), z.unknown()),
    cache_control: CacheControlSchema.optional(),
  })
  .strict();
const AnthropicToolChoiceSchema = z.union([
  z.object({ type: z.enum(["auto", "any", "none"]), disable_parallel_tool_use: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("tool"), name: z.string().min(1).max(128), disable_parallel_tool_use: z.boolean().optional() }).strict(),
]);
const AnthropicSystemSchema = z.union([
  z.string(),
  z.array(z.object({ type: z.literal("text"), text: z.string(), cache_control: CacheControlSchema.optional() }).strict()).max(20),
]);

const AnthropicRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(120),
    max_tokens: z.number().int().positive().max(BUILD_LLM_MAX_OUTPUT_TOKENS.anthropic),
    messages: z.array(AnthropicMessageSchema).min(1).max(5_000),
    system: AnthropicSystemSchema.optional(),
    tools: z.array(AnthropicToolSchema).max(64).optional(),
    tool_choice: AnthropicToolChoiceSchema.optional(),
    temperature: z.number().min(0).max(1).optional(),
    stream: z.literal(false).optional(),
  })
  .strict();

const OpenAiTextPartSchema = z.object({ type: z.literal("text"), text: z.string() }).strict();
const OpenAiContentSchema = z.union([z.string(), z.array(OpenAiTextPartSchema)]);
const OpenAiToolCallSchema = z
  .object({ id: z.string().min(1).max(256), type: z.literal("function"), function: z.object({ name: z.string().min(1).max(128), arguments: z.string() }).strict() })
  .strict();
const OpenAiMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: OpenAiContentSchema }).strict(),
  z.object({ role: z.literal("user"), content: OpenAiContentSchema }).strict(),
  z.object({ role: z.literal("assistant"), content: z.union([OpenAiContentSchema, z.null()]).optional(), tool_calls: z.array(OpenAiToolCallSchema).optional() }).strict(),
  z.object({ role: z.literal("tool"), tool_call_id: z.string().min(1).max(256), content: OpenAiContentSchema }).strict(),
]);
const OpenAiToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({ name: z.string().min(1).max(128), description: z.string().max(10_000).optional(), parameters: z.record(z.string(), z.unknown()).optional(), strict: z.boolean().optional() })
      .strict(),
  })
  .strict();
const OpenAiToolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z.object({ type: z.literal("function"), function: z.object({ name: z.string().min(1).max(128) }).strict() }).strict(),
]);

const OpenAiRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(120),
    messages: z.array(OpenAiMessageSchema).min(1).max(10_000),
    // 출력 상한은 필수 — 없으면 모델 최대까지 생성할 수 있다(1회 비용 상한 = 예약액이 사라진다).
    max_completion_tokens: z.number().int().positive().max(BUILD_LLM_MAX_OUTPUT_TOKENS.openai),
    max_tokens: z.number().int().positive().max(BUILD_LLM_MAX_OUTPUT_TOKENS.openai).optional(),
    n: z.literal(1).optional(),
    stream: z.literal(false).optional(),
    tools: z.array(OpenAiToolSchema).max(64).optional(),
    tool_choice: OpenAiToolChoiceSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

/** Zod 오류 → 짧은 필드 목록(모르는 키는 이름까지). 값은 되풀이하지 않는다. */
function issueFields(issues: readonly z.ZodIssue[]): string {
  return issues
    .map((i) => {
      const at = i.path.join(".") || "body";
      return i.code === "unrecognized_keys" ? `${at}:${i.keys.join("+").slice(0, 80)}` : at;
    })
    .slice(0, 5)
    .join(",");
}

/** content-length를 믿지 않고 스트림을 세며 읽는다. 넘치면 읽기를 멈춘다. (B-5b S3: /internal/build-artifact도 쓴다.) */
export async function readCappedBody(req: Request, max: number): Promise<{ ok: true; text: string; bytes: number } | { ok: false; reason: "too_large" | "unreadable" }> {
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

  // ── 4) 킬스위치(결함 6): 진행 중인 잡도 여기서 멈춘다 — 업스트림 0, 잡은 그 단계에서 failed(build_disabled) ──
  if (!buildEnabled(env)) {
    await stopActiveBuildJob(env, job.id, BUILD_DISABLED, job).catch(() => false);
    logLine({ event: "build_llm_kill_switch", job_id: job.id, vendor, status: job.status });
    return reject(vendor, 503, BUILD_DISABLED, "builds are switched off (BUILD_ENABLED=off) — this job was stopped");
  }

  // ── 5) 예산 빠른 확인(본문을 읽기 전에) — 판정의 권위는 8)의 원자 예약 ──
  if (job.spentUsd >= job.budgetUsd) {
    logLine({ event: "build_llm_budget_exhausted", job_id: job.id, vendor, spent_usd: job.spentUsd, budget_usd: job.budgetUsd });
    return reject(vendor, 402, BUDGET_EXHAUSTED, `build budget exhausted ($${job.spentUsd.toFixed(2)} of $${job.budgetUsd.toFixed(2)})`, {
      "x-simsa-build-spent-usd": String(job.spentUsd),
      "x-simsa-build-budget-usd": String(job.budgetUsd),
    });
  }

  // ── 6) 벤더 ──
  if (vendor === "anthropic" && env.ANTHROPIC_ENABLED === "off") return reject(vendor, 503, "vendor_disabled", "anthropic is switched off — use the openai route");
  const serverKey = vendor === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!serverKey) return reject(vendor, 503, "vendor_not_configured", `${vendor} is not configured`);

  // ── 7) 요청: 크기 · JSON · 필드 허용 목록 · 모델 허용 목록 ──
  const read = await readCappedBody(c.req.raw, BUILD_LLM_MAX_REQUEST_BYTES);
  if (!read.ok) return read.reason === "too_large" ? reject(vendor, 413, "request_too_large", `request body over ${BUILD_LLM_MAX_REQUEST_BYTES} bytes`) : reject(vendor, 400, "invalid_request", "unreadable body");
  const raw = safeJson(read.text);
  if (!raw) return reject(vendor, 400, "invalid_request", "body must be a JSON object");
  if (raw["stream"] === true) return reject(vendor, 400, "stream_not_supported", "streaming is not supported on the build proxy");
  let requestBody: Record<string, unknown>;
  let requestModel: string;
  let maxOut: number;
  if (vendor === "anthropic") {
    const parsed = AnthropicRequestSchema.safeParse(raw);
    if (!parsed.success) return reject(vendor, 400, "invalid_request", `unsupported or invalid fields: ${issueFields(parsed.error.issues)}`);
    requestBody = { ...parsed.data };
    requestModel = parsed.data.model;
    maxOut = parsed.data.max_tokens;
  } else {
    const parsed = OpenAiRequestSchema.safeParse(raw);
    if (!parsed.success) return reject(vendor, 400, "invalid_request", `unsupported or invalid fields: ${issueFields(parsed.error.issues)}`);
    requestBody = { ...parsed.data };
    requestModel = parsed.data.model;
    maxOut = Math.max(parsed.data.max_completion_tokens, parsed.data.max_tokens ?? 0);
  }
  if (!buildLlmAllowedModels(env)[vendor].includes(requestModel)) return reject(vendor, 400, "model_not_allowed", `model ${requestModel.slice(0, 60)} is not allowed for builds`);

  // ── 8) 예약(결함 4): 최악 비용을 원자적으로 — 활성 · spent < budget일 때만. 동시 호출은 여기서 하나만 지난다 ──
  const reservedUsd = worstCaseCallUsd(read.bytes, maxOut);
  const reserved = await reserveBuildJobSpend(env, job.id, reservedUsd).catch(() => false);
  if (!reserved) {
    const now = await getBuildJobById(env, job.id).catch(() => null);
    if (!now) return reject(vendor, 404, "job_not_found", "unknown build job");
    if (!BUILD_JOB_ACTIVE.has(now.status)) return reject(vendor, 409, "job_not_active", `build job is ${now.status}`);
    logLine({ event: "build_llm_budget_exhausted", job_id: job.id, vendor, spent_usd: now.spentUsd, budget_usd: job.budgetUsd, reason: "reservation_refused" });
    return reject(vendor, 402, BUDGET_EXHAUSTED, "build budget exhausted (no room to reserve this call)", { "x-simsa-build-budget-usd": String(job.budgetUsd) });
  }
  // 이 아래 어떤 길로 나가든 정산은 한 번 — 실패하면 actual 0(예약 해제), 성공하면 계량한 비용.
  let actualUsd = 0;
  let settled = false;
  const settle = async (): Promise<void> => {
    if (settled) return;
    settled = true;
    try {
      await settleBuildJobSpend(env, job.id, reservedUsd, actualUsd);
    } catch (err) {
      logLine({ event: "build_llm_settle_failed", job_id: job.id, reserved_usd: reservedUsd, actual_usd: actualUsd, reason: String((err as Error)?.message ?? err).slice(0, 160) });
    }
  };

  try {
    // ── 9) 업스트림 ──
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

    // ── 10) 계량: 비용 → 정산(원자) → 원장 1행 ──
    const resp = safeJson(text);
    const modelActual = typeof resp?.["model"] === "string" && resp["model"].trim() ? resp["model"].trim() : requestModel;
    const usageRaw = resp?.["usage"];
    const hasUsage = typeof usageRaw === "object" && usageRaw !== null;
    const usage: AnthropicMessagesData["usage"] = vendor === "anthropic" ? (hasUsage ? (usageRaw as AnthropicMessagesData["usage"]) : undefined) : openAiUsageToAnthropic(usageRaw);
    let event = usageEventFrom(vendor, requestModel, modelActual, usage, latencyMs, BUILD_LLM_CALL_SITE);
    let priced = priceTokens(modelActual, event);
    if (!hasUsage) {
      // usage 없는 2xx — 청구는 됐을 수 있다. 요청 크기(≈4바이트/토큰)·출력 상한을 최고 단가로(조용한 $0 금지).
      event = { ...event, inputTokens: Math.ceil(read.bytes / 4), cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: maxOut };
      priced = { ...priceTokens("", event), unpriced: true };
      logLine({ event: "build_llm_usage_missing", job_id: job.id, vendor, model_actual: modelActual });
    }
    const costUsd = Number.isFinite(priced.costUsd) && priced.costUsd > 0 ? priced.costUsd : 0;
    actualUsd = costUsd;
    await settle();
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
    logLine({ event: "build_llm_call", job_id: job.id, vendor, model_actual: modelActual, cost_usd: costUsd, reserved_usd: reservedUsd, unpriced: priced.unpriced, spent_usd: spentAfter, budget_usd: job.budgetUsd, latency_ms: latencyMs });
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "x-simsa-build-spent-usd": String(spentAfter),
        "x-simsa-build-budget-usd": String(job.budgetUsd),
      },
    });
  } finally {
    await settle();
  }
}

export function createBuildLlmProxyRoutes(fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.all(BUILD_LLM_ANTHROPIC_PATH, (c) => handle("anthropic", c, fetchImpl));
  app.all(BUILD_LLM_OPENAI_PATH, (c) => handle("openai", c, fetchImpl));
  return app;
}

import { EfficiencyGate, estimateTokens } from "@simsa/core";
import type { AnthropicCreateParams, AnthropicLike, AnthropicResponse } from "./anthropic-types.js";
import {
  REWRITE_TOOL_NAME,
  REWRITE_TOOL_DESCRIPTION,
  REWRITE_TOOL_INPUT_SCHEMA,
  EDIT_TOOL_NAME,
  EDIT_TOOL_DESCRIPTION,
  EDIT_TOOL_INPUT_SCHEMA,
} from "./patch-tool.js";
import {
  buildWorkerPrompt,
  buildCacheablePrefix,
  buildEditWorkerPrompt,
  buildEditCacheablePrefix,
  WORKER_SYSTEM_PROMPT,
} from "./prompts.js";
import { parseRewriteToolUse, parseEditToolUse } from "./patch-parser.js";
import { withOpenAiFallback, type FallbackOptions } from "./openai-fallback.js";
import { actualCost, estimateCallCost } from "./pricing.js";
import type { WorkerContext, WorkerOutcome, EditWorkerContext, EditWorkerOutcome } from "./types.js";

export interface ClaudeWorkerOptions {
  apiKey?: string;
  /** Defaults to claude-sonnet-4-6. Gate router may force a different model per call. */
  model?: string;
  maxTokens?: number;
  /** Shared gate (recommended). If omitted, the worker creates its own. */
  gate?: EfficiencyGate;
  /** For tests or alternate providers — inject a Messages-compatible client. */
  client?: AnthropicLike;
  /** Factory used when `client` is not supplied. Defaults to lazy-loading @anthropic-ai/sdk. */
  clientFactory?: (apiKey: string, baseURL?: string) => Promise<AnthropicLike>;
  /**
   * Optional Anthropic-compatible base URL (e.g. a CF AI Gateway provider
   * endpoint). First-class here — NOT via a caller-side clientFactory —
   * because @anthropic-ai/sdk must resolve from THIS package's context;
   * a dynamic import from an app entrypoint fails module resolution
   * (2026-07-21 실측: container server.mjs "Cannot find package").
   */
  baseURL?: string;
  /**
   * ★벤더 폴백 (2026-08-26). Anthropic이 Cloudflare egress에서 완전 차단된 뒤,
   * 중앙 플레인의 LLM 호출에는 폴백을 붙였지만 **이 워커에는 없었다** — 검수는
   * 문제를 짚어주는데 "고쳐줘"는 아무 일도 못 하는 상태였다.
   * 키가 없으면 undefined로 두면 되고, 그러면 종전과 동일하게 동작한다.
   */
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  /** 킬스위치 — Anthropic을 아예 건너뛴다(중앙 플레인 ANTHROPIC_ENABLED="off"와 같은 뜻). */
  preferFallback?: boolean;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
/**
 * Output budget for worker calls is larger than review — a patch with
 * a few hunks can easily run 4-5K output tokens, and truncating the
 * patch midway corrupts the diff.
 */
const DEFAULT_MAX_TOKENS = 16_384;

async function defaultClientFactory(apiKey: string, baseURL?: string): Promise<AnthropicLike> {
  const mod = (await import("@anthropic-ai/sdk")) as unknown as {
    default: new (opts: { apiKey: string; baseURL?: string }) => AnthropicLike;
  };
  const Ctor = mod.default;
  return new Ctor(baseURL ? { apiKey, baseURL } : { apiKey });
}

/**
 * ClaudeWorker — turns Council blockers into a unified-diff patch.
 *
 * Deliberately does NOT implement `Agent` (which is a review-producing
 * interface). A worker consumes reviews and emits a patch; conflating
 * the two at the type level would force either side to carry fields
 * the other doesn't use.
 *
 * The worker is pure w.r.t. the filesystem — it never reads files or
 * shells out to git. The caller (typically the `conclave rework` CLI)
 * is responsible for reading file snapshots, applying the returned
 * patch, and committing back to the PR branch. That separation lets
 * us unit-test the LLM layer without a git fixture.
 */
export class ClaudeWorker {
  readonly id = "worker";
  readonly displayName = "Worker";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly gate: EfficiencyGate;
  private readonly clientFactory: (apiKey: string, baseURL?: string) => Promise<AnthropicLike>;
  private readonly baseURL: string | undefined;
  private clientPromise: Promise<AnthropicLike> | null;
  private readonly fallback: FallbackOptions | undefined;

  constructor(opts: ClaudeWorkerOptions = {}) {
    const key = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    // 폴백 키만 있어도 동작해야 한다 — Anthropic이 막힌 상황에서 자동수리를
    // 벤더 하나에 묶어두면 "고쳐줘"가 통째로 멈춘다.
    if (!key && !opts.client && !opts.openaiApiKey) {
      throw new Error(
        "ClaudeWorker: no LLM configured (pass opts.apiKey, opts.openaiApiKey, opts.client, or the env var)",
      );
    }
    this.apiKey = key;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.gate = opts.gate ?? new EfficiencyGate();
    this.clientFactory = opts.clientFactory ?? defaultClientFactory;
    this.baseURL = opts.baseURL;
    this.fallback = opts.openaiApiKey
      ? {
          openaiApiKey: opts.openaiApiKey,
          ...(opts.openaiBaseUrl ? { openaiBaseUrl: opts.openaiBaseUrl } : {}),
          ...(opts.preferFallback ? { preferFallback: true } : {}),
        }
      : undefined;
    this.clientPromise = opts.client ? Promise.resolve(opts.client) : null;
  }

  private async getClient(): Promise<AnthropicLike> {
    if (!this.clientPromise) {
      // 폴백이 설정돼 있으면 감싼다. Anthropic 키가 없어도(빈 문자열) 폴백만으로
      // 동작한다 — 자동수리가 벤더 하나에 묶여 있지 않게 한다.
      this.clientPromise = (async () => {
        const primary = this.apiKey ? await this.clientFactory(this.apiKey, this.baseURL) : null;
        if (!this.fallback) {
          if (!primary) throw new Error("ClaudeWorker: no Anthropic key and no fallback configured");
          return primary;
        }
        return withOpenAiFallback(primary, this.fallback);
      })();
    }
    return this.clientPromise;
  }

  async work(ctx: WorkerContext): Promise<WorkerOutcome> {
    const cacheablePrefix = buildCacheablePrefix(ctx);
    const userPrompt = buildWorkerPrompt(ctx);
    const inputTokenEstimate = estimateTokens(cacheablePrefix) + estimateTokens(userPrompt);
    const estimatedCost = estimateCallCost(this.model, inputTokenEstimate, this.maxTokens);

    const outcome = await this.gate.run<Omit<WorkerOutcome, "tokensUsed" | "costUsd">>(
      {
        agent: this.id,
        cacheablePrefix,
        prompt: cacheablePrefix + "\n" + userPrompt,
        estimatedCostUsd: estimatedCost,
        forceModel: this.model,
      },
      async ({ model }) => {
        const started = Date.now();
        const client = await this.getClient();
        const params: AnthropicCreateParams = {
          model,
          max_tokens: this.maxTokens,
          system: [{ type: "text", text: cacheablePrefix, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userPrompt }],
          tools: [
            {
              name: REWRITE_TOOL_NAME,
              description: REWRITE_TOOL_DESCRIPTION,
              input_schema: REWRITE_TOOL_INPUT_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: REWRITE_TOOL_NAME },
        };
        const response: AnthropicResponse = await client.messages.create(params);
        const latencyMs = Date.now() - started;

        const parsed = parseRewriteToolUse(response);
        const cost = actualCost(model, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens,
        });

        return {
          result: parsed,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          costUsd: cost,
          latencyMs,
        };
      },
    );

    return {
      ...outcome.result,
      tokensUsed: outcome.metric.inputTokens + outcome.metric.outputTokens,
      costUsd: outcome.metric.costUsd,
    };
  }

  /**
   * Edit-mode invocation for files above the snapshot byte cap: the model
   * sees excerpts (EditWorkerContext.fileExcerpts) and returns exact
   * search/replace edits instead of full-file rewrites. Same gate, pricing,
   * and single-tool pattern as work(); only the tool contract differs.
   * The caller is responsible for the exactly-once match check + apply.
   */
  async workEdits(ctx: EditWorkerContext): Promise<EditWorkerOutcome> {
    const cacheablePrefix = buildEditCacheablePrefix(ctx);
    const userPrompt = buildEditWorkerPrompt(ctx);
    const inputTokenEstimate = estimateTokens(cacheablePrefix) + estimateTokens(userPrompt);
    const estimatedCost = estimateCallCost(this.model, inputTokenEstimate, this.maxTokens);

    const outcome = await this.gate.run<Omit<EditWorkerOutcome, "tokensUsed" | "costUsd">>(
      {
        agent: this.id,
        cacheablePrefix,
        prompt: cacheablePrefix + "\n" + userPrompt,
        estimatedCostUsd: estimatedCost,
        forceModel: this.model,
      },
      async ({ model }) => {
        const started = Date.now();
        const client = await this.getClient();
        const params: AnthropicCreateParams = {
          model,
          max_tokens: this.maxTokens,
          system: [{ type: "text", text: cacheablePrefix, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userPrompt }],
          tools: [
            {
              name: EDIT_TOOL_NAME,
              description: EDIT_TOOL_DESCRIPTION,
              input_schema: EDIT_TOOL_INPUT_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: EDIT_TOOL_NAME },
        };
        const response: AnthropicResponse = await client.messages.create(params);
        const latencyMs = Date.now() - started;

        const parsed = parseEditToolUse(response);
        const cost = actualCost(model, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens,
        });

        return {
          result: parsed,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          costUsd: cost,
          latencyMs,
        };
      },
    );

    return {
      ...outcome.result,
      tokensUsed: outcome.metric.inputTokens + outcome.metric.outputTokens,
      costUsd: outcome.metric.costUsd,
    };
  }
}

export { WORKER_SYSTEM_PROMPT };

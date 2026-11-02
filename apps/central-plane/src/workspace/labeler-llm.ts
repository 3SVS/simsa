/**
 * workspace/labeler-llm.ts — 라벨링 에이전트 패스의 LLM 호출 단일 경로 (train L3, 2026-11-02).
 *
 * 설계 §0.0 "서로 다른 벤더 두 패스": 패스마다 벤더·모델을 서버가 고정하고 **벤더 대체를 끈다.** 검수 프록시의 폴백을 그대로 쓰면
 * 한쪽 벤더가 막혔을 때 두 패스가 몰래 같은 벤더가 되어 일치도(κ)가 의미를 잃는다 — 막히면 그 패스가 실패하는 것이 맞다.
 * 예산은 inspection_agent_spend 행(잡 id)으로 서버가 쥔다. 원장은 call_site를 갈라 사용자 검수의 하루 예산(inspect_agent)을 쓰지 않는다.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { worstCaseCallUsd } from "../routes/build-llm-proxy.js";
import { anthropicEndpoint, anthropicMessages, type LlmUsageEvent } from "./anthropic-fetch.js";
import { reserveAgentSpend, settleAgentSpend } from "./inspection-agent.js";
import { priceTokens } from "./llm-pricing.js";
import { recordLlmUsage } from "./llm-usage.js";

export const LABELER_CALL_SITE = "inspect_labeler";
/** 패스 표: 로컬 실측(docs/dataset/train-l2-labeler-2026-11-02.md)과 같은 A·B. C = 칸 분쟁용 세 번째 패스(프로덕션 도달성 실측 2026-10-26). */
export const LABELER_PASSES = Object.freeze({
  A: { passId: "A", vendor: "openai", model: "gpt-5.6-sol" },
  B: { passId: "B", vendor: "anthropic", model: "claude-opus-5-5" },
  C: { passId: "C", vendor: "openai", model: "gpt-5.4" },
} as const);
export type LabelerPassId = keyof typeof LABELER_PASSES;
export const LABELER_PASS_BUDGET_USD = 5;
export const LABELER_PASS_MAX_CALLS = 200;
/** Opus 5.5는 생각을 끌 수 없어 같은 예산에서 먼저 쓴다 — 로컬 실측과 같은 하한. */
const ANTHROPIC_MIN_MAX_TOKENS = 8000;
const UPSTREAM_TIMEOUT_MS = 90_000;

export const labelerJobId = (runId: string, pass: LabelerPassId): string => `lab_${runId}_${pass}`;
export function parseLabelerJobId(jobId: string): { runId: string; pass: LabelerPassId } | null {
  const m = /^lab_([A-Za-z0-9_-]+)_([ABC])$/.exec(jobId);
  return m && m[1] && m[2] ? { runId: m[1], pass: m[2] as LabelerPassId } : null;
}

export class LabelerLlmError extends Error {
  constructor(readonly status: 402 | 403 | 502 | 503, readonly code: string) {
    super(code);
  }
}

export async function labelerLlmCall(
  env: Env,
  fetchImpl: FetchLike,
  jobId: string,
  args: { system: string; user: string; maxTokens?: number },
  owner: { projectId: string | null; userKey: string | null },
): Promise<string> {
  const parsed = parseLabelerJobId(jobId);
  if (!parsed) throw new LabelerLlmError(403, "not_labeler_job");
  const pass = LABELER_PASSES[parsed.pass];
  const key = pass.vendor === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
  if (!key) throw new LabelerLlmError(503, "llm_unavailable");

  const wanted = args.maxTokens ?? 1024;
  const maxTokens = pass.vendor === "anthropic" ? Math.max(wanted, ANTHROPIC_MIN_MAX_TOKENS) : wanted;
  const reservedUsd = worstCaseCallUsd(new TextEncoder().encode(args.system + args.user).length, maxTokens);
  const reserved = await reserveAgentSpend(env, jobId, reservedUsd);
  if (reserved === "not_agent_run") throw new LabelerLlmError(403, "not_labeler_job");
  if (reserved === "exhausted") throw new LabelerLlmError(402, "budget_exhausted");

  const content = `${args.system}\n\n---\n\n${args.user}`;
  const events: LlmUsageEvent[] = [];
  let actualUsd = 0;
  try {
    const data = await anthropicMessages(
      env.ANTHROPIC_API_KEY ?? "",
      {
        model: pass.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content }],
        ...(pass.vendor === "anthropic" ? { output_config: { effort: "high" as const } } : {}),
      },
      UPSTREAM_TIMEOUT_MS,
      fetchImpl,
      anthropicEndpoint(env.CF_AI_GATEWAY_ANTHROPIC_URL),
      LABELER_CALL_SITE,
      {
        // 대체 없음: Anthropic 패스는 fallback을 주지 않고, OpenAI 패스는 Anthropic을 건너뛰게 한다(실패하면 그대로 던진다).
        ...(pass.vendor === "openai" ? { fallback: { openaiApiKey: key, openaiBaseUrl: env.CF_AI_GATEWAY_OPENAI_URL, preferFallback: true, model: pass.model } } : {}),
        onUsage: (u: LlmUsageEvent) => events.push(u),
        maxTotalMs: 20_000,
      },
    );
    for (const e of events) {
      const priced = priceTokens(e.modelActual, e);
      actualUsd += priced.costUsd;
      await recordLlmUsage(env, {
        ...e,
        callSite: LABELER_CALL_SITE,
        jobKind: "inspection",
        jobId,
        projectId: owner.projectId,
        userKey: owner.userKey,
        costOverride: { costUsd: priced.costUsd, unpriced: priced.unpriced },
      }).catch(() => false);
    }
    await settleAgentSpend(env, jobId, reservedUsd, actualUsd);
    if (events.some((e) => e.vendor !== pass.vendor)) throw new LabelerLlmError(502, "vendor_mismatch");
    return (data.content ?? []).map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
  } catch (e) {
    if (e instanceof LabelerLlmError) throw e;
    await settleAgentSpend(env, jobId, reservedUsd, actualUsd).catch(() => undefined);
    console.error(JSON.stringify({ event: "labeler_llm_failed", job_id: jobId, reason: String((e as Error)?.message ?? e).slice(0, 160) }));
    throw new LabelerLlmError(502, "upstream_failed");
  }
}

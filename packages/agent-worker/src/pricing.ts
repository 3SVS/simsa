/**
 * Train L — L-1 공식 단가 (2026-09-28).
 *
 * 출처(접근일 2026-09-28):
 *   - Anthropic https://platform.claude.com/docs/en/about-claude/pricing — base input / 5m cache write / cache hit / output
 *   - OpenAI    https://developers.openai.com/api/docs/pricing — gpt-5.4 Standard 티어 "(<272K context length)"
 *
 * 옛 표의 결함(BM §1 [확정]): haiku-4-5 $0.25/$1.25(공식 $1/$5), opus-4-7 $15/$75(공식 $5/$25),
 * gpt-5.4·opus-5·sonnet-5 부재, 미지 모델은 호출부가 $0으로 삼킴. 이 표가 D-7 예산 게이트의 입력이므로
 * 틀린 단가 = 틀린 예산이다.
 *
 * 규칙:
 *   - Anthropic 캐시: 5분 쓰기 = 1.25× 기본 입력, 읽기 = 0.1× — **단 Opus 5.5는 읽기 0.05×($0.20)** (공식 각주 2).
 *   - OpenAI: 캐시 쓰기 할증 없음(쓰기 = 기본 입력가), cached input = 할인가.
 *   - gpt-5.4는 <272K 컨텍스트 가격만 공식 페이지에 있다. 272K 초과 구간은 2026-09-28 페이지에 **가격이 없다**
 *     (2026-09 조사 메모의 $5/$0.50/$22.50은 확인 불가) → 초과 호출은 unpriced(보수)로 표시한다.
 *   - 표에 없는 모델은 조용히 $0이 아니라 **표의 성분별 최대 단가**로 보수 계산하고 `unpriced: true`를 붙인다
 *     — 예산 게이트를 "모르는 모델"로 우회하지 못하게.
 *
 * `apps/central-plane/src/workspace/llm-pricing.ts`에 같은 표가 있다(패키지 독립 유지를 위한 의도적 복제).
 * 두 표의 일치는 central-plane 테스트(train-l-metering)가 dist를 비교해 고정한다.
 */
export interface ModelPricing {
  /** USD / 1M 입력 토큰(캐시 아님). */
  inputPerMTok: number;
  /** USD / 1M 캐시 쓰기 토큰(Anthropic 5분 캐시). OpenAI는 기본 입력가와 같다. */
  cacheWritePerMTok: number;
  /** USD / 1M 캐시 읽기 토큰. */
  cacheReadPerMTok: number;
  /** USD / 1M 출력 토큰. */
  outputPerMTok: number;
  /** 이 단가가 유효한 최대 입력(캐시 포함) 토큰. 넘으면 공식 단가 없음 → unpriced. */
  maxPricedInputTokens?: number;
}

export const PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-haiku-4-5": { inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outputPerMTok: 15 },
  "claude-sonnet-5": { inputPerMTok: 2, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2, outputPerMTok: 10 },
  "claude-opus-4-7": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  "claude-opus-5": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  "claude-opus-5-5": { inputPerMTok: 4, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2, outputPerMTok: 20 },
  "gpt-5.4": { inputPerMTok: 2.5, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.25, outputPerMTok: 15, maxPricedInputTokens: 272_000 },
};

function maxOf(key: "inputPerMTok" | "cacheWritePerMTok" | "cacheReadPerMTok" | "outputPerMTok"): number {
  return Math.max(...Object.values(PRICING).map((p) => p[key]));
}

/** 표에 없는 모델에 쓰는 보수 단가 — 표의 성분별 최대값(표가 바뀌면 자동으로 따라간다). */
export const CONSERVATIVE_PRICING: Readonly<ModelPricing> = {
  inputPerMTok: maxOf("inputPerMTok"),
  cacheWritePerMTok: maxOf("cacheWritePerMTok"),
  cacheReadPerMTok: maxOf("cacheReadPerMTok"),
  outputPerMTok: maxOf("outputPerMTok"),
};

/**
 * 토큰 사용량. **Anthropic 의미**: `inputTokens`는 캐시 쓰기·읽기를 **제외한** 입력 토큰이다
 * (Anthropic 응답의 input_tokens와 같다 — 총 입력 = input + cacheCreation + cacheRead).
 * OpenAI 폴백은 prompt_tokens − cached_tokens를 input으로 옮긴다(openai-fallback.ts).
 */
export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export type PricedUsage = {
  costUsd: number;
  /** true = 공식 단가를 모른다 → 보수 단가로 계산했다(운영자가 봐야 할 신호). */
  unpriced: boolean;
  /** 실제로 적용한 가격표 키. unpriced면 null. */
  pricedAs: string | null;
};

/** 날짜 접미사를 뗀다: claude-haiku-4-5-20251001 → claude-haiku-4-5, gpt-5.4-2026-03-05 → gpt-5.4. */
export function normalizeModelId(model: string): string {
  return model.trim().replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
}

/** 모델 → (단가, 가격표 키). 표에 없거나 유효 구간을 넘으면 보수 단가 + pricedAs null. */
export function resolvePricing(model: string, totalInputTokens = 0): { pricing: ModelPricing; pricedAs: string | null } {
  const raw = (model ?? "").trim();
  const key = raw in PRICING ? raw : normalizeModelId(raw);
  const p = PRICING[key];
  if (!p) return { pricing: CONSERVATIVE_PRICING, pricedAs: null };
  if (p.maxPricedInputTokens !== undefined && totalInputTokens > p.maxPricedInputTokens) {
    return { pricing: CONSERVATIVE_PRICING, pricedAs: null };
  }
  return { pricing: p, pricedAs: key };
}

function nonNeg(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** 실제 비용 + 단가를 알았는지. 절대 던지지 않는다. */
export function priceUsage(model: string, usage: UsageBreakdown): PricedUsage {
  const input = nonNeg(usage.inputTokens);
  const write = nonNeg(usage.cacheCreationTokens);
  const read = nonNeg(usage.cacheReadTokens);
  const output = nonNeg(usage.outputTokens);
  const { pricing: p, pricedAs } = resolvePricing(model, input + write + read);
  const costUsd =
    (input * p.inputPerMTok + write * p.cacheWritePerMTok + read * p.cacheReadPerMTok + output * p.outputPerMTok) / 1_000_000;
  return { costUsd, unpriced: pricedAs === null, pricedAs };
}

/** 실제 비용(USD). 미지 모델은 보수 단가 — 던지지 않는다(옛 동작은 throw → 호출부가 $0으로 삼켰다). */
export function actualCost(model: string, usage: UsageBreakdown): number {
  return priceUsage(model, usage).costUsd;
}

/** 사전 예약용 추정(캐시 없음 가정 = 비관적). 미지 모델은 보수 단가. */
export function estimateCallCost(model: string, estimatedInputTokens: number, maxOutputTokens: number): number {
  return priceUsage(model, { inputTokens: estimatedInputTokens, outputTokens: maxOutputTokens }).costUsd;
}

/**
 * 한 번의 LLM 호출 사용량 레코드 — 컨테이너 콜백 `usage[]`(central-plane /internal/build-*,
 * /internal/repair-done)과 같은 필드에 costUsd·unpriced를 더한 것.
 */
export type LlmUsageRecord = {
  vendor: string;
  modelRequested: string;
  modelActual: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  unpriced: boolean;
};

/** 응답에 vendor 표시가 없을 때 모델 id로 추정한다(표시가 있으면 그것이 우선). */
export function inferVendor(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt-") || /^o\d/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "google";
  return "unknown";
}

/** 응답(Anthropic 형태, 폴백 포함)에서 사용량 레코드를 만든다 — 과금은 **응답의 실제 모델**로. */
export function usageRecordFromResponse(
  modelRequested: string,
  response: {
    model?: string;
    vendor?: string;
    usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  },
  latencyMs: number,
): LlmUsageRecord {
  const modelActual = typeof response.model === "string" && response.model.trim() ? response.model.trim() : modelRequested;
  const inputTokens = nonNeg(response.usage.input_tokens);
  const cacheReadTokens = nonNeg(response.usage.cache_read_input_tokens);
  const cacheWriteTokens = nonNeg(response.usage.cache_creation_input_tokens);
  const outputTokens = nonNeg(response.usage.output_tokens);
  const priced = priceUsage(modelActual, { inputTokens, outputTokens, cacheCreationTokens: cacheWriteTokens, cacheReadTokens });
  return {
    vendor: typeof response.vendor === "string" && response.vendor ? response.vendor : inferVendor(modelActual),
    modelRequested,
    modelActual,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    latencyMs: nonNeg(latencyMs),
    costUsd: priced.costUsd,
    unpriced: priced.unpriced,
  };
}

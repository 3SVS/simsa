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
  // 2026-10-05 공식 단가(developers.openai.com/api/docs/pricing, Standard): 입력 $0.75 · 캐시 입력 $0.075 · 출력 $4.50 /1M. 긴 문맥 단가 없음.
  "gpt-5.4-mini": { inputPerMTok: 0.75, cacheWritePerMTok: 0.75, cacheReadPerMTok: 0.075, outputPerMTok: 4.5 },
  // 2026-10-07 공식 단가(developers.openai.com/api/docs/pricing, Standard, 조회 2026-10-07): GPT-5.6 계열(검사 엔진 v2 기본 = sol).
  //  캐시 쓰기 가산은 없다(입력 단가 그대로). 긴 문맥 구간 단가는 페이지에 없음.
  // 2026-10-07 Anthropic 공식 단가(platform.claude.com/docs/en/about-claude/pricing): Fable 5.1 입력 $10 · 5분 캐시 쓰기 $12.50 ·
  //  캐시 적중 $0.25(0.025x) · 출력 $50. 검사 엔진 v2 주 모델 기본.
  "claude-fable-5-1": { inputPerMTok: 10, cacheWritePerMTok: 12.5, cacheReadPerMTok: 0.25, outputPerMTok: 50 },
  "gpt-5.6-sol": { inputPerMTok: 4, cacheWritePerMTok: 4, cacheReadPerMTok: 0.4, outputPerMTok: 20 },
  "gpt-5.6-terra": { inputPerMTok: 2, cacheWritePerMTok: 2, cacheReadPerMTok: 0.2, outputPerMTok: 12 },
  "gpt-5.6-luna": { inputPerMTok: 0.2, cacheWritePerMTok: 0.2, cacheReadPerMTok: 0.02, outputPerMTok: 1.2 },
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

/**
 * 가격표 조회는 **자기 키만**. `raw in PRICING`·`PRICING[k]`는 Object.prototype 키(constructor·__proto__·
 * toString…)에도 참/truthy라, 모델 문자열이 신뢰 경계 밖(응답 model·콜백 본문)에서 오면 단가 필드가
 * undefined인 "알려진 모델"이 되어 비용이 NaN(→ 예산 게이트 무력)이 된다(#562 결함 7).
 */
function ownPricing(key: string): ModelPricing | undefined {
  return Object.hasOwn(PRICING, key) ? PRICING[key] : undefined;
}

/** 모델 → (단가, 가격표 키). 표에 없거나 유효 구간을 넘으면 보수 단가 + pricedAs null. */
export function resolvePricing(model: string, totalInputTokens = 0): { pricing: ModelPricing; pricedAs: string | null } {
  const raw = (model ?? "").trim();
  const key = Object.hasOwn(PRICING, raw) ? raw : normalizeModelId(raw);
  const p = ownPricing(key);
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
  const costOf = (q: ModelPricing): number =>
    (input * q.inputPerMTok + write * q.cacheWritePerMTok + read * q.cacheReadPerMTok + output * q.outputPerMTok) / 1_000_000;
  const costUsd = costOf(p);
  // 방어선: 어떤 경로로든 유한수가 아니면(NaN·Infinity) 조용히 넘기지 않고 보수 단가 + unpriced.
  if (!Number.isFinite(costUsd)) return { costUsd: costOf(CONSERVATIVE_PRICING), unpriced: true, pricedAs: null };
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
  /**
   * PR #576 검증 P2-8: 벤더가 답했는데 사용량(usage)을 알려주지 않았다. 토큰 수는 0으로 두되(지어내지 않는다)
   * costUsd는 호출자가 준 추정(입력 추정 + 최대 출력)을 보수 단가로 매긴 값이고 unpriced도 true다. 예산 게이트는
   * 이 표시를 "비용 모름"으로 다뤄야 한다(수리 잡 예산 = 상한 전체). 알 때는 필드가 없다.
   */
  usageUnknown?: true;
};

/** 사용량을 모를 때의 추정 재료 — 입력은 호출 전 추정, 출력은 max_tokens(비관적). */
export type UnknownUsageEstimate = { inputTokens: number; outputTokens: number };

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** usage 블록이 있고 토큰 수를 하나라도 숫자로 말했는가(0도 "말한 것"이다). */
export function hasKnownUsage(usage: unknown): boolean {
  if (!usage || typeof usage !== "object") return false;
  const u = usage as Record<string, unknown>;
  return isFiniteNumber(u["input_tokens"]) || isFiniteNumber(u["output_tokens"]);
}

/**
 * 사용량을 모르는 호출의 레코드. 토큰은 0(모름), 비용은 추정을 **보수 단가(표의 성분별 최대)**로 — 절대 던지지
 * 않는다. 추정이 없거나 잘못되면 비용 0이지만 unpriced·usageUnknown 표시는 남는다(소비자가 판단).
 */
export function unknownUsageRecord(
  modelRequested: string,
  modelActual: string,
  vendor: string,
  latencyMs: number,
  estimate?: UnknownUsageEstimate | null,
): LlmUsageRecord {
  const input = nonNeg(estimate?.inputTokens);
  const output = nonNeg(estimate?.outputTokens);
  const c = CONSERVATIVE_PRICING;
  const costUsd = (input * c.inputPerMTok + output * c.outputPerMTok) / 1_000_000;
  return {
    vendor,
    modelRequested,
    modelActual,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    latencyMs: nonNeg(latencyMs),
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    unpriced: true,
    usageUnknown: true,
  };
}

/** 응답에 vendor 표시가 없을 때 모델 id로 추정한다(표시가 있으면 그것이 우선). */
export function inferVendor(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt-") || /^o\d/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "google";
  return "unknown";
}

/**
 * 응답(Anthropic 형태, 폴백 포함)에서 사용량 레코드를 만든다 — 과금은 **응답의 실제 모델**로. 던지지 않는다.
 *
 * PR #576 검증 P2-8: usage 블록이 없거나(Anthropic 형태 — 종전엔 여기서 TypeError), 폴백 변환이 "모름"
 * (`usageUnknown: true`)이라고 표시했으면(종전엔 0 토큰 → $0) unknownUsageRecord로 — 호출자가 주는
 * `unknownUsageEstimate`(입력 추정 + 최대 출력)를 보수 단가로 매기고 unpriced·usageUnknown을 붙인다.
 */
export function usageRecordFromResponse(
  modelRequested: string,
  response: {
    model?: string;
    vendor?: string;
    usageUnknown?: boolean;
    usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | null;
  },
  latencyMs: number,
  unknownUsageEstimate?: UnknownUsageEstimate | null,
): LlmUsageRecord {
  const modelActual = typeof response.model === "string" && response.model.trim() ? response.model.trim() : modelRequested;
  if (response.usageUnknown === true || !response.usage || !hasKnownUsage(response.usage)) {
    const vendor = typeof response.vendor === "string" && response.vendor ? response.vendor : inferVendor(modelActual);
    return unknownUsageRecord(modelRequested, modelActual, vendor, latencyMs, unknownUsageEstimate);
  }
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

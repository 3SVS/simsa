/**
 * workspace/llm-pricing.ts — Train L · L-1 공식 단가 (central-plane 사본).
 *
 * 출처(접근일 2026-09-28):
 *   - Anthropic https://platform.claude.com/docs/en/about-claude/pricing
 *   - OpenAI    https://developers.openai.com/api/docs/pricing (gpt-5.4 Standard, <272K 컨텍스트)
 *
 * `packages/agent-worker/src/pricing.ts`와 **같은 표**다. central-plane은 agent-worker에 의존하지 않으므로
 * (Worker 번들에 SDK를 끌어오지 않기 위해) 의도적으로 복제하고, 동일성은 테스트
 * (test/train-l-l3-usage-ledger.test.mjs ②)가 두 dist를 비교해 고정한다. 한쪽만 고치면 CI가 깨진다.
 *
 * 규칙은 agent-worker와 같다: 미지 모델·유효 구간 밖(gpt-5.4 272K 초과)은 표의 성분별 최대 단가로
 * 보수 계산 + unpriced. 조용한 $0은 없다.
 */
export type ModelPricing = {
  inputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
  maxPricedInputTokens?: number;
};

export const LLM_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-haiku-4-5": { inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outputPerMTok: 15 },
  "claude-sonnet-5": { inputPerMTok: 2, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2, outputPerMTok: 10 },
  "claude-opus-4-7": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  "claude-opus-5": { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 },
  "claude-opus-5-5": { inputPerMTok: 4, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2, outputPerMTok: 20 },
  "gpt-5.4": { inputPerMTok: 2.5, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.25, outputPerMTok: 15, maxPricedInputTokens: 272_000 },
};

function maxOf(key: "inputPerMTok" | "cacheWritePerMTok" | "cacheReadPerMTok" | "outputPerMTok"): number {
  return Math.max(...Object.values(LLM_PRICING).map((p) => p[key]));
}

export const CONSERVATIVE_PRICING: Readonly<ModelPricing> = {
  inputPerMTok: maxOf("inputPerMTok"),
  cacheWritePerMTok: maxOf("cacheWritePerMTok"),
  cacheReadPerMTok: maxOf("cacheReadPerMTok"),
  outputPerMTok: maxOf("outputPerMTok"),
};

export function normalizeModelId(model: string): string {
  return model.trim().replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
}

export type TokenCounts = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };

function nonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 실응답 모델의 공식 단가로 비용 계산. 절대 던지지 않는다. input은 Anthropic 의미(캐시 제외분). */
export function priceTokens(model: string, t: TokenCounts): { costUsd: number; unpriced: boolean; pricedAs: string | null } {
  const input = nonNeg(t.inputTokens);
  const read = nonNeg(t.cacheReadTokens);
  const write = nonNeg(t.cacheWriteTokens);
  const output = nonNeg(t.outputTokens);
  const raw = (model ?? "").trim();
  // 자기 키만 조회한다 — `in`·`[]`는 Object.prototype 키(constructor·__proto__·toString…)에도 참/truthy라
  // 콜백 본문·응답의 model이 그 이름이면 단가 undefined → NaN 비용이 unpriced=0으로 통과했다(#562 결함 7).
  const key = Object.hasOwn(LLM_PRICING, raw) ? raw : normalizeModelId(raw);
  const known = Object.hasOwn(LLM_PRICING, key) ? LLM_PRICING[key] : undefined;
  const withinRange = known && (known.maxPricedInputTokens === undefined || input + read + write <= known.maxPricedInputTokens);
  const p = known && withinRange ? known : CONSERVATIVE_PRICING;
  const pricedAs = known && withinRange ? key : null;
  const costOf = (q: ModelPricing): number =>
    (input * q.inputPerMTok + write * q.cacheWritePerMTok + read * q.cacheReadPerMTok + output * q.outputPerMTok) / 1_000_000;
  const costUsd = costOf(p);
  // 방어선: 유한수가 아니면 조용히 넘기지 않고 보수 단가 + unpriced.
  if (!Number.isFinite(costUsd)) return { costUsd: costOf(CONSERVATIVE_PRICING), unpriced: true, pricedAs: null };
  return { costUsd, unpriced: pricedAs === null, pricedAs };
}

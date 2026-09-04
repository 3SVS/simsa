/**
 * vendor-routing.ts — 어느 벤더로 갈지 정하는 **단일 출처** (2026-08-25).
 *
 * ## 왜 한 곳으로 모았나
 *
 * 폴백 설정이 라우트 네 곳에 각각 인라인으로 복제돼 있었다. 그 상태에서 킬스위치를
 * 넣으면 **일부 경로만 바뀐다** — 스위치를 켰는데 절반은 여전히 막힌 문을 두드리는,
 * 알아채기 어려운 반쪽 상태가 된다. (같은 종류의 결함을 이미 두 번 겪었다:
 * GitHub 저장소 정규화가 입력구와 소비처에서 갈렸던 것, 클라이언트 검증이 서버보다
 * 엄격했던 것.)
 *
 * ## 킬스위치 (ANTHROPIC_ENABLED)
 *
 * 실측(2026-08-25): 같은 API 키가 **노트북에서는 200**, Cloudflare Worker에서는
 * **403 "Request not allowed"**. 키·계정·지역 문제가 아니라 **egress 차단**이 확정됐다.
 *
 * 그렇다면 요청마다 6회 재시도로 태우는 ~7초는 **순손실**이다. `"off"`로 두면
 * Anthropic을 아예 건너뛰고 곧장 폴백으로 간다.
 *
 * **되돌리기는 한 줄이다** — `wrangler.toml`의 값을 `"on"`으로 바꾸고 배포.
 * 복구 여부는 `POST /internal/llm-probe`의 `anthropic:*` 항목으로 확인한다
 * (`usable`이 살아나면 되돌릴 때다). 회로 차단기와 달리 이 스위치는 **스스로
 * 복구하지 않는다** — 사람이 실측하고 켜는 것이 의도된 설계다.
 */
import type { Env } from "../env.js";
import type { VendorFallback } from "./anthropic-fetch.js";

/**
 * 이 요청이 쓸 벤더 폴백 설정. OpenAI 키가 없으면 undefined —
 * 그러면 종전과 완전히 동일하게 Anthropic만 쓴다.
 */
export function vendorFallback(env: Env): VendorFallback | undefined {
  if (!env.OPENAI_API_KEY) return undefined;
  return {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.CF_AI_GATEWAY_OPENAI_URL,
    // 명시적으로 "off"일 때만 건너뛴다 — 값이 없으면 종전 동작(Anthropic 먼저).
    ...(env.ANTHROPIC_ENABLED === "off" ? { preferFallback: true } : {}),
  };
}

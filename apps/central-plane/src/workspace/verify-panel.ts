/**
 * workspace/verify-panel.ts — RC-2 검증 패널 (A 티어, 전원 적용).
 *
 * check-draft의 "안 맞음(failed)" 판정 — 사용자에게 유죄를 선고하는 판정 — 에만
 * 두 번째 모델의 독립 교차 확인을 붙인다. 후하게 만드는 장치가 아니라 틀린
 * 유죄판결을 막는 장치다 (정확도=신호/잡음 분리 원칙):
 *
 *   - 양쪽 동의       → 판정 유지 + verification: "dual_confirmed"
 *   - 불일치          → "확인 부족(inconclusive)"으로 강등 + 두 관점 병기 ("downgraded")
 *   - 2차 호출 실패   → 원판정 유지 + verification: "single" (조용히 2중인 척 금지)
 *
 * passed/inconclusive/needs_decision은 건드리지 않는다. 교차 확인은 교차-벤더
 * 우선(OpenAI), 불가 시 Anthropic 상위 모델 폴백. 상한/모델은 파라미터(RC-2).
 */
import type { CheckResultItem, ProductSpecForCheck, WorkspaceCheckDraftResponse } from "./check.js";
import { anthropicEndpoint } from "./anthropic-fetch.js";

export type VerificationTag = "dual_confirmed" | "downgraded" | "single";

export type VerifyPanelEnv = {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** CF AI Gateway 경유 (직행 Worker 이그레스는 403 — anthropic과 동일 함정). */
  CF_AI_GATEWAY_OPENAI_URL?: string;
  CF_AI_GATEWAY_ANTHROPIC_URL?: string;
};

function openaiEndpoint(baseUrl?: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
}

export type VerifyPanelOpts = {
  /** 검수당 교차 확인 상한 (RC-5: 기본 5) */
  maxChecks?: number;
  timeoutMs?: number;
  openaiModel?: string;
  anthropicModel?: string;
  fetchImpl?: typeof fetch;
};

type SecondOpinion = { supported: boolean; noteKo: string };

function opinionPrompt(spec: ProductSpecForCheck, item: CheckResultItem): string {
  return `You are an INDEPENDENT second reviewer. A first reviewer marked a product-spec item as "failed" (conflicts with the spec's excluded scope or decided directions). Decide independently whether the evidence supports that verdict.

[Product spec]
${JSON.stringify(spec)}

[Item]
title: ${item.title}
first verdict: failed
first reason: ${item.reason}
first evidence: ${JSON.stringify(item.evidence)}

Rule: supported=true ONLY if the item clearly conflicts with the spec's excluded scope or decided directions. If the conflict is unclear, arguable, or the evidence is weak, supported=false.

Answer with JSON only (no markdown):
{"supported": true, "note_ko": "<판단 근거 한 문장, 한국어>"}`;
}

function parseOpinion(text: string): SecondOpinion | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    if (typeof o["supported"] !== "boolean") return null;
    return {
      supported: o["supported"],
      noteKo: typeof o["note_ko"] === "string" ? o["note_ko"].slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}

async function askOpenAi(
  key: string,
  prompt: string,
  model: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  baseUrl?: string,
): Promise<SecondOpinion | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(openaiEndpoint(baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 300,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseOpinion(j.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function askAnthropic(
  key: string,
  prompt: string,
  model: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  baseUrl?: string,
): Promise<SecondOpinion | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(anthropicEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
    return parseOpinion((j.content ?? []).find((b) => b.type === "text")?.text ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 교차-벤더 우선: OpenAI → (불가/실패 시) Anthropic 상위 모델. 둘 다 없으면 null. */
async function secondOpinion(
  env: VerifyPanelEnv,
  prompt: string,
  opts: Required<Pick<VerifyPanelOpts, "timeoutMs" | "openaiModel" | "anthropicModel">>,
  fetchImpl: typeof fetch,
): Promise<SecondOpinion | null> {
  if (env.OPENAI_API_KEY) {
    const o = await askOpenAi(env.OPENAI_API_KEY, prompt, opts.openaiModel, opts.timeoutMs, fetchImpl, env.CF_AI_GATEWAY_OPENAI_URL);
    if (o) return o;
  }
  if (env.ANTHROPIC_API_KEY) {
    return askAnthropic(env.ANTHROPIC_API_KEY, prompt, opts.anthropicModel, opts.timeoutMs, fetchImpl, env.CF_AI_GATEWAY_ANTHROPIC_URL);
  }
  return null;
}

/**
 * failed 판정에 교차 확인을 적용하고 (필요시) 강등해 새 response를 만든다.
 * 어떤 실패에도 검수 자체를 깨지 않는다 (fail-open + 정직 표기).
 */
export async function applyVerifyPanel(
  response: WorkspaceCheckDraftResponse,
  spec: ProductSpecForCheck,
  env: VerifyPanelEnv,
  opts: VerifyPanelOpts = {},
): Promise<WorkspaceCheckDraftResponse> {
  const maxChecks = opts.maxChecks ?? 5;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const openaiModel = opts.openaiModel ?? "gpt-5.4";
  const anthropicModel = opts.anthropicModel ?? "claude-sonnet-5";
  const fetchImpl = opts.fetchImpl ?? fetch;

  const failedIdx = response.results
    .map((r, i) => (r.status === "failed" ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, maxChecks);
  if (failedIdx.length === 0) return response;

  const results = [...response.results];
  await Promise.all(
    failedIdx.map(async (i) => {
      const item = results[i];
      if (!item) return;
      const opinion = await secondOpinion(
        env,
        opinionPrompt(spec, item),
        { timeoutMs, openaiModel, anthropicModel },
        fetchImpl,
      );
      if (opinion === null) {
        results[i] = { ...item, verification: "single" };
        return;
      }
      if (opinion.supported) {
        results[i] = { ...item, verification: "dual_confirmed" };
        return;
      }
      // 불일치 — 유죄판정을 단정하지 않는다. 강등 + 두 관점 병기.
      results[i] = {
        ...item,
        status: "inconclusive",
        userLabel: "확인 부족",
        verification: "downgraded",
        reason: `두 AI의 판단이 갈렸습니다. 1차 판단: ${item.reason} / 2차 판단: ${opinion.noteKo || "충돌 근거가 분명하지 않습니다."} 직접 한 번 확인해보세요.`,
      };
    }),
  );

  const summary = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: results.filter((r) => r.status === "needs_decision").length,
  };

  return { ...response, results, summary };
}

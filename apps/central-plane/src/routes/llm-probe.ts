/**
 * llm-probe.ts — 벤더별 LLM 도달성 관측 도구 (2026-08-22).
 *
 * 왜 필요한가: `Anthropic 403 "Request not allowed"`를 두고 네 번 가설을 세우고
 * 네 번 틀렸다(용량 → 경로 → 지터 → 동시성). 매번 "고쳐서 배포하고 프로브"를
 * 반복했고, 그때마다 원인이 다른 곳에 있었다. 마지막 실측에서 **완전 직렬화도
 * 0/3 실패** — 동시성조차 아니고 **시간대별 차단**이었다.
 *
 * 그래서 추측을 끊고 **사실을 재는 도구**를 먼저 둔다: 벤더별로 Worker egress에서
 * 실제 도달하는지, 지연은 얼마인지, 동시성에서 달라지는지.
 *
 *   POST /internal/llm-probe            — 세 벤더 각 1회
 *   POST /internal/llm-probe?n=4        — 각 벤더 동시 4회
 *
 * 규칙:
 *   - INTERNAL_CALLBACK_TOKEN 필수(공개 노출 금지)
 *   - **재시도 없음** — 순수 도달성 측정이므로 anthropic-fetch의 재시도를 타지 않는다
 *   - 최소 토큰(max 5)만 소비. 프로덕션 예산에 부담을 주지 않는다
 *   - 어떤 벤더 키도 응답에 담지 않는다
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { anthropicEndpoint, OPENAI_FALLBACK_MODEL } from "../workspace/anthropic-fetch.js";

type Vendor = "anthropic" | "openai" | "gemini";

type ProbeResult = {
  vendor: Vendor;
  path: "gateway" | "direct";
  /** 잰 모델(2026-10-21 v2 S0 — 후보 모델을 고를 수 있게 되면서 결과에 남긴다). */
  model?: string;
  status: number | "network_error" | "no_key";
  ms: number;
  /** 실패 본문의 앞부분 — 원인 분류에 필요한 최소치만. */
  detail?: string;
  /**
   * ★200이 곧 "쓸 만하다"가 아니다 (2026-08-22 교훈).
   *
   * 종전 프로브는 **HTTP 상태만** 봤다. 그 결과 "openai 4/4 200"을 근거로 폴백을
   * 그 모델에 걸었는데, 그건 **도달 가능**의 증거일 뿐 **텍스트를 돌려준다**는
   * 증거가 아니었다. 추론형 모델은 토큰 예산을 추론에 다 쓰고 본문을 비워 보내도
   * 200이다. 폴백이 이 모델에 의존하므로, 프로브가 그 질문에 직접 답해야 한다.
   */
  usable?: boolean;
  /** 실제로 받은 텍스트 길이 — usable의 근거를 숫자로 남긴다. */
  textChars?: number;
  /**
   * ★벤더가 응답에 붙인 요청 식별자 (2026-08-29).
   * Anthropic 지원팀이 자기네 로그에서 우리 요청을 찾으려면 **이것이 있어야 한다** —
   * 상태 코드와 시각만으로는 조회가 안 된다. 403 원인 조사를 넘기려고 잡는다.
   * 비밀이 아니다(키가 아니라 요청 번호).
   */
  requestId?: string | null;
};

const PROMPT = "Reply with the single word: ok";

/** 기본 모델(종전 프로브와 같다). */
const DEFAULT_MODELS: Record<Vendor, string> = { anthropic: "claude-haiku-4-5-20251001", openai: OPENAI_FALLBACK_MODEL, gemini: "gemini-2.5-flash" };

/**
 * (2026-10-21 v2 S0, V-5 "프로덕션에서 실제로 닿는 가장 강한 모델") 프로덕션 키로 부를 수 있는 후보 모델 — **닫힌 목록**.
 * 요청이 임의 모델을 부르지 못하게 한다(비용·키 오남용). 후보를 늘리려면 이 목록을 고치는 PR로.
 */
export const PROBE_MODEL_ALLOWLIST: Record<Vendor, readonly string[]> = {
  anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"],
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3.8-flash"],
};
const MAX_PROBE_MODELS = 8;

/** "vendor:model,…" → 목록. 허용 목록 밖·형식 오류·상한 초과면 null. */
export function parseProbeModels(raw: string | undefined): Array<{ vendor: Vendor; model: string }> | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_PROBE_MODELS) return null;
  const out: Array<{ vendor: Vendor; model: string }> = [];
  for (const part of parts) {
    const m = /^(anthropic|openai|gemini):([A-Za-z0-9._-]{1,64})$/.exec(part);
    if (!m) return null;
    const vendor = m[1] as Vendor;
    if (!PROBE_MODEL_ALLOWLIST[vendor].includes(m[2]!)) return null;
    out.push({ vendor, model: m[2]! });
  }
  return out;
}
/** 추론형 모델이 예산을 추론에 다 써서 본문을 비우지 않도록 넉넉히. 그래도 응답은 한 단어다. */
const MAX_OUT = 512;

type Probed = {
  status: number | "network_error";
  detail?: string;
  usable?: boolean;
  textChars?: number;
  requestId?: string | null;
};

async function timed(fn: () => Promise<Probed>): Promise<Probed & { ms: number }> {
  const t = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t };
  } catch (err) {
    return { status: "network_error", detail: String(err).slice(0, 120), ms: Date.now() - t };
  }
}

async function probeAnthropic(env: Env, useGateway: boolean, model = DEFAULT_MODELS.anthropic): Promise<ProbeResult> {
  const key = env.ANTHROPIC_API_KEY;
  const path = useGateway ? "gateway" : "direct";
  if (!key) return { vendor: "anthropic", path, model, status: "no_key", ms: 0 };
  const url = useGateway ? anthropicEndpoint(env.CF_AI_GATEWAY_ANTHROPIC_URL) : anthropicEndpoint();
  const out = await timed(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "user-agent": "simsa-central-plane/1.0" },
      body: JSON.stringify({ model, max_tokens: MAX_OUT, messages: [{ role: "user", content: PROMPT }] }),
    });
    if (!r.ok) {
      return {
        status: r.status,
        detail: (await r.text().catch(() => "")).slice(0, 120),
        requestId: r.headers.get("request-id") ?? r.headers.get("x-request-id"),
      };
    }
    const j = (await r.json().catch(() => null)) as { content?: Array<{ type: string; text?: string }> } | null;
    const text = (j?.content ?? []).find((b) => b.type === "text")?.text ?? "";
    return { status: r.status, usable: text.trim().length > 0, textChars: text.length };
  });
  return { vendor: "anthropic", path, model, ...out };
}

async function probeOpenAi(env: Env, model = DEFAULT_MODELS.openai): Promise<ProbeResult> {
  const key = env.OPENAI_API_KEY;
  const base = (env.CF_AI_GATEWAY_OPENAI_URL ?? "").trim().replace(/\/$/, "");
  const path = base ? "gateway" : "direct";
  if (!key) return { vendor: "openai", path, model, status: "no_key", ms: 0 };
  const url = base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
  const out = await timed(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_completion_tokens: MAX_OUT, messages: [{ role: "user", content: PROMPT }] }),
    });
    if (!r.ok) return { status: r.status, detail: (await r.text().catch(() => "")).slice(0, 120) };
    const j = (await r.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const text = j?.choices?.[0]?.message?.content ?? "";
    return { status: r.status, usable: text.trim().length > 0, textChars: text.length };
  });
  return { vendor: "openai", path, model, ...out };
}

async function probeGemini(env: Env, model = DEFAULT_MODELS.gemini): Promise<ProbeResult> {
  const key = env.GEMINI_API_KEY;
  const base = (env.CF_AI_GATEWAY_GOOGLE_URL ?? "").trim().replace(/\/$/, "");
  const path = base ? "gateway" : "direct";
  if (!key) return { vendor: "gemini", path, model, status: "no_key", ms: 0 };
  const url = base
    ? `${base}/v1beta/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const out = await timed(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
    });
    if (!r.ok) return { status: r.status, detail: (await r.text().catch(() => "")).slice(0, 120) };
    const j = (await r.json().catch(() => null)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return { status: r.status, usable: text.trim().length > 0, textChars: text.length };
  });
  return { vendor: "gemini", path, model, ...out };
}

export function createLlmProbeRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/internal/llm-probe", async (c) => {
    // 관측 전용 토큰이 있으면 그것을, 없으면 기존 내부 토큰을 받는다.
    // (전용 토큰을 따로 두는 이유는 env.ts LLM_PROBE_TOKEN 주석 참조.)
    const expected = c.env.LLM_PROBE_TOKEN ?? c.env.INTERNAL_CALLBACK_TOKEN;
    if (!expected) return c.json({ ok: false, error: "probe_disabled" }, 503);
    const auth = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || m[1] !== expected) return c.json({ ok: false, error: "unauthorized" }, 401);

    const n = Math.min(Math.max(parseInt(c.req.query("n") ?? "1", 10) || 1, 1), 4);
    const picked = parseProbeModels(c.req.query("models"));
    if (picked === null) return c.json({ ok: false, error: "model_not_allowed", allowlist: PROBE_MODEL_ALLOWLIST }, 400);
    const one = () =>
      picked === undefined
        ? [probeAnthropic(c.env, true), probeAnthropic(c.env, false), probeOpenAi(c.env), probeGemini(c.env)]
        : picked.flatMap(({ vendor, model }) =>
            vendor === "anthropic"
              ? [probeAnthropic(c.env, true, model), probeAnthropic(c.env, false, model)]
              : vendor === "openai"
                ? [probeOpenAi(c.env, model)]
                : [probeGemini(c.env, model)],
          );
    const rounds = Array.from({ length: n }, () => one()).flat();
    const results = await Promise.all(rounds);

    // 벤더·경로별 요약 — 사람이 한눈에 보고 판단하기 위한 집계.
    // ok(=200 도달)와 usable(=실제 텍스트를 받음)을 **따로** 센다. 둘이 갈리는
    // 경우가 정확히 폴백이 조용히 망가지는 지점이다.
    const summary: Record<string, { ok: number; usable: number; total: number; statuses: Record<string, number>; avgMs: number }> = {};
    for (const r of results) {
      // 모델을 고른 런은 모델별로 센다(기본 런은 종전 키 그대로).
      const k = picked === undefined ? `${r.vendor}:${r.path}` : `${r.vendor}:${r.path}:${r.model}`;
      const s = (summary[k] ??= { ok: 0, usable: 0, total: 0, statuses: {}, avgMs: 0 });
      s.total += 1;
      if (r.status === 200) s.ok += 1;
      if (r.usable) s.usable += 1;
      const key = String(r.status);
      s.statuses[key] = (s.statuses[key] ?? 0) + 1;
      s.avgMs += r.ms;
    }
    for (const s of Object.values(summary)) s.avgMs = Math.round(s.avgMs / Math.max(s.total, 1));

    console.log(JSON.stringify({ event: "llm_probe", concurrency: n, summary }));
    return c.json({ ok: true, concurrency: n, summary, results });
  });

  return app;
}

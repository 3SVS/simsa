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
import { anthropicEndpoint } from "../workspace/anthropic-fetch.js";

type ProbeResult = {
  vendor: "anthropic" | "openai" | "gemini";
  path: "gateway" | "direct";
  status: number | "network_error" | "no_key";
  ms: number;
  /** 실패 본문의 앞부분 — 원인 분류에 필요한 최소치만. */
  detail?: string;
};

const PROMPT = "Reply with the single word: ok";

async function timed(fn: () => Promise<{ status: number | "network_error"; detail?: string }>): Promise<{ status: number | "network_error"; detail?: string; ms: number }> {
  const t = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t };
  } catch (err) {
    return { status: "network_error", detail: String(err).slice(0, 120), ms: Date.now() - t };
  }
}

async function probeAnthropic(env: Env, useGateway: boolean): Promise<ProbeResult> {
  const key = env.ANTHROPIC_API_KEY;
  const path = useGateway ? "gateway" : "direct";
  if (!key) return { vendor: "anthropic", path, status: "no_key", ms: 0 };
  const url = useGateway ? anthropicEndpoint(env.CF_AI_GATEWAY_ANTHROPIC_URL) : anthropicEndpoint();
  const out = await timed(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "user-agent": "simsa-central-plane/1.0" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: PROMPT }] }),
    });
    return { status: r.status, detail: r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 120) };
  });
  return { vendor: "anthropic", path, ...out };
}

async function probeOpenAi(env: Env): Promise<ProbeResult> {
  const key = env.OPENAI_API_KEY;
  const base = (env.CF_AI_GATEWAY_OPENAI_URL ?? "").trim().replace(/\/$/, "");
  const path = base ? "gateway" : "direct";
  if (!key) return { vendor: "openai", path, status: "no_key", ms: 0 };
  const url = base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
  const out = await timed(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", max_completion_tokens: 5, messages: [{ role: "user", content: PROMPT }] }),
    });
    return { status: r.status, detail: r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 120) };
  });
  return { vendor: "openai", path, ...out };
}

async function probeGemini(env: Env): Promise<ProbeResult> {
  const key = env.GEMINI_API_KEY;
  const base = (env.CF_AI_GATEWAY_GOOGLE_URL ?? "").trim().replace(/\/$/, "");
  const path = base ? "gateway" : "direct";
  if (!key) return { vendor: "gemini", path, status: "no_key", ms: 0 };
  const model = "gemini-2.5-flash";
  const url = base
    ? `${base}/v1beta/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const out = await timed(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
    });
    return { status: r.status, detail: r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 120) };
  });
  return { vendor: "gemini", path, ...out };
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
    const one = () => [
      probeAnthropic(c.env, true),
      probeAnthropic(c.env, false),
      probeOpenAi(c.env),
      probeGemini(c.env),
    ];
    const rounds = Array.from({ length: n }, () => one()).flat();
    const results = await Promise.all(rounds);

    // 벤더·경로별 요약 — 사람이 한눈에 보고 판단하기 위한 집계.
    const summary: Record<string, { ok: number; total: number; statuses: Record<string, number>; avgMs: number }> = {};
    for (const r of results) {
      const k = `${r.vendor}:${r.path}`;
      const s = (summary[k] ??= { ok: 0, total: 0, statuses: {}, avgMs: 0 });
      s.total += 1;
      if (r.status === 200) s.ok += 1;
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

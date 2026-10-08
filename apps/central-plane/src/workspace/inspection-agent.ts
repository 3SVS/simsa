/**
 * workspace/inspection-agent.ts — 검수 "agent" 엔진의 Worker 쪽 토대 (2026-10-05).
 *
 *   - 런 범위 토큰(irt1 = LLM 프록시 · ilt1 = 직접 로그인 넘겨주기 화면) — build-job-token.ts와 같은 HMAC 파생,
 *     **라벨만 다르다**(빌드 토큰으로 검수 프록시를, 검수 토큰으로 빌드 프록시를 쓸 수 없다).
 *   - 시험 계정 보관: 암호화(CONCLAVE_TOKEN_KEK, crypto.ts) → 디스패치 때 한 번 복호화 → 런 종료 시 삭제.
 *   - LLM 예산 행: 최악 비용 원자 예약 → 정산(build-llm-proxy와 같은 보수 원칙).
 *
 * 비밀은 이 파일 어디에서도 로그로 나가지 않는다(오류 로그도 runId·이유 코드만).
 */
import { z } from "zod";
import type { Env } from "../env.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { bearerOf, constantTimeEqual } from "./build-job-token.js";
import { MIN_SECRET_LENGTH } from "../agent-inspection.js";

// ─── 런 범위 토큰 ───────────────────────────────────────────────────────────────

export type RunTokenKind = "llm" | "live";
const TOKEN_SPEC: Record<RunTokenKind, { prefix: string; label: string; msg: string }> = {
  llm: { prefix: "irt1", label: "simsa/inspect-run-token/v1", msg: "simsa/inspect-run/v1:" },
  live: { prefix: "ilt1", label: "simsa/inspect-live-token/v1", msg: "simsa/inspect-live/v1:" },
};
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

type TokenEnv = Pick<Env, "CONCLAVE_TOKEN_KEK" | "INTERNAL_CALLBACK_TOKEN">;

function rootOf(env: TokenEnv): string | null {
  if (typeof env.CONCLAVE_TOKEN_KEK === "string" && env.CONCLAVE_TOKEN_KEK.length > 0) return env.CONCLAVE_TOKEN_KEK;
  if (typeof env.INTERNAL_CALLBACK_TOKEN === "string" && env.INTERNAL_CALLBACK_TOKEN.length > 0) return env.INTERNAL_CALLBACK_TOKEN;
  return null;
}

async function hmacHex(keyBytes: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

async function macFor(root: string, kind: RunTokenKind, runId: string): Promise<string> {
  const spec = TOKEN_SPEC[kind];
  const sub = await hmacHex(encoder.encode(root), spec.label);
  const mac = await hmacHex(sub, spec.msg + runId);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintRunToken(env: TokenEnv, kind: RunTokenKind, runId: string): Promise<string | null> {
  const root = rootOf(env);
  if (!root || !RUN_ID_RE.test(runId)) return null;
  return `${TOKEN_SPEC[kind].prefix}.${runId}.${await macFor(root, kind, runId)}`;
}

export async function verifyRunToken(env: TokenEnv, kind: RunTokenKind, token: string | null | undefined): Promise<{ ok: true; runId: string } | { ok: false }> {
  const root = rootOf(env);
  if (!root || typeof token !== "string") return { ok: false };
  const m = new RegExp(`^${TOKEN_SPEC[kind].prefix}\\.([A-Za-z0-9_-]{1,64})\\.([0-9a-f]{64})$`).exec(token);
  if (!m || !m[1] || !m[2]) return { ok: false };
  return constantTimeEqual(await macFor(root, kind, m[1]), m[2]) ? { ok: true, runId: m[1] } : { ok: false };
}

export { bearerOf };

// ─── 시험 계정(동의 필수 · 암호화 · 런 종료 시 삭제) ───────────────────────────

/** 요청 본문의 시험 계정. consent는 문자 그대로 true여야 한다(기본값으로 켜지지 않는다). */
export const TestCredentialsSchema = z
  .object({
    username: z.string().trim().min(MIN_SECRET_LENGTH).max(200),
    password: z.string().min(4).max(200),
    loginUrl: z.string().trim().max(500).optional(),
    consent: z.literal(true),
  })
  .strict();
export type TestCredentials = { username: string; password: string; loginUrl?: string };

/** 시험 계정 보관 TTL — 런이 끝나면 즉시 지우지만, 어떤 경로로든 남으면 크론이 이 뒤에 지운다. */
export const RUN_SECRET_TTL_MS = 60 * 60 * 1000;

export async function storeRunCredentials(env: Env, runId: string, creds: TestCredentials): Promise<void> {
  const kek = env.CONCLAVE_TOKEN_KEK;
  if (!kek) throw new Error("credentials_unavailable");
  const ciphertext = await encryptToken(JSON.stringify(creds), kek);
  await env.DB.prepare(
    `INSERT INTO inspection_run_secrets (run_id, kind, ciphertext, created_at) VALUES (?, 'credentials', ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
  )
    .bind(runId, ciphertext, new Date().toISOString())
    .run();
}

/** 디스패치 직전에만 부른다. 없으면 null. 복호화 실패(키 교체·변조)는 던진다 — 조용히 평문으로 가지 않는다. */
export async function loadRunCredentials(env: Env, runId: string): Promise<TestCredentials | null> {
  const row = await env.DB.prepare(`SELECT ciphertext FROM inspection_run_secrets WHERE run_id = ? AND kind = 'credentials'`)
    .bind(runId)
    .first<{ ciphertext: string }>();
  if (!row) return null;
  const kek = env.CONCLAVE_TOKEN_KEK;
  if (!kek) throw new Error("credentials_unavailable");
  const parsed = JSON.parse(await decryptToken(row.ciphertext, kek)) as Partial<TestCredentials>;
  if (typeof parsed.username !== "string" || typeof parsed.password !== "string") throw new Error("credentials_corrupt");
  return { username: parsed.username, password: parsed.password, ...(typeof parsed.loginUrl === "string" ? { loginUrl: parsed.loginUrl } : {}) };
}

/** 런의 비밀을 지운다. 던지지 않는다(표가 아직 없을 때 포함) — 남은 것은 TTL 정리가 지운다. */
export async function deleteRunSecret(env: Env, runId: string): Promise<boolean> {
  try {
    const r = await env.DB.prepare(`DELETE FROM inspection_run_secrets WHERE run_id = ?`).bind(runId).run();
    return Number(r?.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.error(JSON.stringify({ at: "deleteRunSecret", runId, error: String((err as Error)?.message ?? err).slice(0, 120) }));
    return false;
  }
}

export async function purgeExpiredRunSecrets(env: Env, nowMs: number = Date.now()): Promise<number> {
  try {
    const cutoff = new Date(nowMs - RUN_SECRET_TTL_MS).toISOString();
    const r = await env.DB.prepare(`DELETE FROM inspection_run_secrets WHERE created_at < ?`).bind(cutoff).run();
    return Number(r?.meta?.changes ?? 0);
  } catch (err) {
    console.error(JSON.stringify({ at: "purgeExpiredRunSecrets", error: String((err as Error)?.message ?? err).slice(0, 120) }));
    return 0;
  }
}

/** 로그인 주소는 검수 대상과 같은 출처만(다른 사이트로 비밀번호를 들고 가지 않는다). */
export function loginUrlAllowed(loginUrl: string | undefined, targetUrl: string): boolean {
  if (loginUrl === undefined || loginUrl === "") return true;
  try {
    const a = new URL(loginUrl);
    const b = new URL(targetUrl);
    return (a.protocol === "https:" || a.protocol === "http:") && a.origin === b.origin;
  } catch {
    return false;
  }
}

// ─── LLM 예산(서버 권위) ────────────────────────────────────────────────────────

export const DEFAULT_INSPECT_AGENT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_INSPECT_AGENT_BUDGET_USD = 3;
export const DEFAULT_INSPECT_AGENT_MAX_CALLS = 160;

/**
 * 2026-10-07 v2 모델(V-5). Bae 결정: **Claude 최상위 모델이 주 모델, gpt-5.6-sol은 대체만.**
 *   - 주 모델 기본 = claude-fable-5-1 — Anthropic 모델 문서(platform.claude.com/docs/en/models/overview, 2026-10-07 조회)가
 *     "demanding reasoning and long-horizon agentic work"용 최상위로 둔 모델(Opus 5.5 위). INSPECT_AGENT_V2_MODEL로 바꾼다
 *     (예: claude-opus-5-5).
 *   - 대체 기본 = gpt-5.6-sol(로컬 실측: Responses API에서만 함수 도구 — Chat Completions 400).
 *   - Anthropic은 **v2 전용 스위치** INSPECT_AGENT_V2_ANTHROPIC="on"일 때만 쓴다(전역 ANTHROPIC_ENABLED는 다른 호출 지점용 —
 *     건드리지 않는다). 꺼져 있거나 키가 없으면 그 항목을 건너뛰고 대체 모델로.
 */
export const DEFAULT_INSPECT_AGENT_V2_MODEL = "claude-fable-5-1";
export const DEFAULT_INSPECT_AGENT_V2_FALLBACK_MODEL = "gpt-5.6-sol";
const MODEL_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
export function inspectAgentV2Model(env: Pick<Env, "INSPECT_AGENT_V2_MODEL">): string {
  const m = (env.INSPECT_AGENT_V2_MODEL ?? "").trim();
  return MODEL_ID_RE.test(m) ? m : DEFAULT_INSPECT_AGENT_V2_MODEL;
}
export function inspectAgentV2FallbackModel(env: Pick<Env, "INSPECT_AGENT_V2_FALLBACK_MODEL">): string {
  const m = (env.INSPECT_AGENT_V2_FALLBACK_MODEL ?? "").trim();
  return MODEL_ID_RE.test(m) ? m : DEFAULT_INSPECT_AGENT_V2_FALLBACK_MODEL;
}
export type V2Route = Array<{ vendor: "anthropic" | "openai"; model: string }>;
/** 이번 호출이 시도할 순서(주 → 대체). 스위치·키가 없는 벤더는 빠진다. 빈 배열 = 쓸 수 있는 모델 없음(503). */
export function inspectAgentV2Route(
  env: Pick<Env, "INSPECT_AGENT_V2_MODEL" | "INSPECT_AGENT_V2_FALLBACK_MODEL" | "INSPECT_AGENT_V2_ANTHROPIC" | "ANTHROPIC_API_KEY" | "OPENAI_API_KEY">,
): V2Route {
  const out: V2Route = [];
  for (const model of [inspectAgentV2Model(env), inspectAgentV2FallbackModel(env)]) {
    const vendor = /^claude-/i.test(model) ? "anthropic" : "openai";
    if (vendor === "anthropic" && (env.INSPECT_AGENT_V2_ANTHROPIC !== "on" || !env.ANTHROPIC_API_KEY)) continue;
    if (vendor === "openai" && !env.OPENAI_API_KEY) continue;
    if (!out.some((r) => r.model === model)) out.push({ vendor, model });
  }
  return out;
}
export function inspectAgentV2Effort(env: Pick<Env, "INSPECT_AGENT_V2_EFFORT">): "low" | "medium" | "high" {
  const e = (env.INSPECT_AGENT_V2_EFFORT ?? "").trim();
  return e === "low" || e === "high" ? e : "medium";
}

export function inspectAgentModel(env: Pick<Env, "INSPECT_AGENT_MODEL">): string {
  const m = (env.INSPECT_AGENT_MODEL ?? "").trim();
  return m || DEFAULT_INSPECT_AGENT_MODEL;
}

export function inspectAgentBudgetUsd(env: Pick<Env, "INSPECT_AGENT_BUDGET_USD">): number {
  const n = Number(env.INSPECT_AGENT_BUDGET_USD);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : DEFAULT_INSPECT_AGENT_BUDGET_USD;
}

export async function initAgentSpend(env: Env, runId: string, limits?: { budgetUsd: number; maxCalls: number }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO inspection_agent_spend (run_id, budget_usd, spent_usd, calls, max_calls, created_at) VALUES (?, ?, 0, 0, ?, ?)
       ON CONFLICT(run_id) DO NOTHING`,
  )
    .bind(runId, limits?.budgetUsd ?? inspectAgentBudgetUsd(env), limits?.maxCalls ?? DEFAULT_INSPECT_AGENT_MAX_CALLS, new Date().toISOString())
    .run();
}

// ─── 오픈 베타: 공개 스위치 · 하루 예산 · 싼 모델 ─────────────────────────────

export function agentPublicOn(env: Pick<Env, "INSPECTION_AGENT_PUBLIC">): boolean {
  return env.INSPECTION_AGENT_PUBLIC === "on";
}

export const DEFAULT_AGENT_DAILY_BUDGET_USD = 20;
export function agentDailyBudgetUsd(env: Pick<Env, "AGENT_DAILY_BUDGET_USD">): number {
  const n = Number(env.AGENT_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 && n <= 10_000 ? n : DEFAULT_AGENT_DAILY_BUDGET_USD;
}

/** 오늘(UTC) agent 엔진 LLM 사용액 — 원장(llm_usage)이 정본. 읽기 실패는 "한도 참"으로(fail-closed: 기본 검수로 간다). */
export async function agentSpendTodayUsd(env: Pick<Env, "DB">, nowMs: number = Date.now()): Promise<number> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_usage WHERE job_kind = 'inspection' AND call_site = ? AND created_at >= ?`,
    )
      .bind("inspect_agent", `${day}T00:00:00.000Z`)
      .first<{ usd: number }>();
    return Number(row?.usd ?? 0);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export async function agentDailyBudgetReached(env: Pick<Env, "DB" | "AGENT_DAILY_BUDGET_USD">, nowMs?: number): Promise<boolean> {
  return (await agentSpendTodayUsd(env, nowMs)) >= agentDailyBudgetUsd(env);
}

export const DEFAULT_INSPECT_AGENT_CHEAP_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_INSPECT_AGENT_CHEAP_FALLBACK_MODEL = "gpt-5.4-mini";

/** 호출 등급별 모델: cheap = 관찰·행동 단계, strong = 판정 재확인·기준 추정·고친 파일. 요청이 모델을 고르지 못한다. */
export function inspectAgentModelFor(
  env: Pick<Env, "INSPECT_AGENT_MODEL" | "INSPECT_AGENT_CHEAP_MODEL" | "INSPECT_AGENT_CHEAP_FALLBACK_MODEL">,
  tier: "cheap" | "strong",
): { model: string; fallbackModel?: string } {
  if (tier === "strong") return { model: inspectAgentModel(env) };
  return {
    model: (env.INSPECT_AGENT_CHEAP_MODEL ?? "").trim() || DEFAULT_INSPECT_AGENT_CHEAP_MODEL,
    fallbackModel: (env.INSPECT_AGENT_CHEAP_FALLBACK_MODEL ?? "").trim() || DEFAULT_INSPECT_AGENT_CHEAP_FALLBACK_MODEL,
  };
}

/** 최악 비용 예약 — 남은 예산·호출 수가 있을 때만(원자적 UPDATE 한 문장). */
export async function reserveAgentSpend(env: Env, runId: string, usd: number): Promise<"ok" | "exhausted" | "not_agent_run"> {
  const r = await env.DB.prepare(
    `UPDATE inspection_agent_spend SET spent_usd = spent_usd + ?, calls = calls + 1
      WHERE run_id = ? AND spent_usd < budget_usd AND calls < max_calls`,
  )
    .bind(usd, runId)
    .run();
  if (Number(r?.meta?.changes ?? 0) > 0) return "ok";
  const exists = await env.DB.prepare(`SELECT run_id FROM inspection_agent_spend WHERE run_id = ?`).bind(runId).first();
  return exists ? "exhausted" : "not_agent_run";
}

/** 정산: 예약분을 실제 비용으로 바꾼다(업스트림 실패면 actual=0 → 예약 해제). */
export async function settleAgentSpend(env: Env, runId: string, reservedUsd: number, actualUsd: number): Promise<void> {
  await env.DB.prepare(`UPDATE inspection_agent_spend SET spent_usd = MAX(0, spent_usd - ? + ?) WHERE run_id = ?`)
    .bind(reservedUsd, actualUsd, runId)
    .run();
}

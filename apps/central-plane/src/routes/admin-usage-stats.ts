/**
 * routes/admin-usage-stats.ts — Train L · L-5 GET /admin/usage-stats (LLM 사용량 원장 집계).
 *
 * llm_usage 원장(0070)을 job_kind × vendor × model_actual로 집계한다 → BM §1 원가표를 [추정]에서 [확정]으로
 * 옮기는 입력. 운영자 전용: Bearer INTERNAL_CALLBACK_TOKEN(다른 /admin/* 관례와 같다). 요청 토큰이 없거나
 * 틀리면 401, 서버에 토큰이 없으면 503 admin_disabled.
 *
 * ★경로 공유: 같은 경로에 Stage 18 이벤트 분석(x-admin-key + ADMIN_USAGE_STATS_KEY, CORS)이 이미 있다.
 * 그 라우트(workspace-admin-stats.ts)가 **x-admin-key 헤더가 없는 요청만** 이 핸들러로 넘긴다 — Stage 18
 * 호출자(항상 x-admin-key를 보냄)는 동작이 그대로이고, 별도 라우트를 앞에 등록해 가리는 일(CORS 헤더
 * 유실 포함)이 없다.
 *
 *   GET /admin/usage-stats?since=<ISO>&until=<ISO>   (기본: 최근 7일, since 포함·until 제외)
 *
 * 응답(JSON): { ok, since, until, rows, truncated, totals, groups[] }
 *   groups[]: { jobKind, vendor, modelActual, calls, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
 *               costUsd, medianCostUsd, medianLatencyMs, unpricedCalls, containerSeconds } — 비용 큰 순
 *   unpricedCalls > 0이면 그 그룹의 costUsd는 공식 단가가 아니라 보수(최고) 단가 추정이다(컨테이너 행은 단가 미정 0).
 * 원장 조회 실패는 500으로 숨기지 않고 503 ledger_unavailable(0070 미적용 등).
 * 프롬프트·userKey 등 개인 데이터는 응답에 없다(집계만).
 */
import type { Context } from "hono";
import type { Env } from "../env.js";

/** 한 번에 읽는 최대 행 수. 넘으면 truncated: true — 기간을 좁혀 다시 부른다. */
export const USAGE_STATS_ROW_LIMIT = 50_000;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type UsageRow = {
  job_kind: string;
  vendor: string;
  model_actual: string;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  unpriced: number | null;
  latency_ms: number | null;
  container_seconds: number | null;
};

export type UsageGroup = {
  jobKind: string;
  vendor: string;
  modelActual: string;
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  medianCostUsd: number;
  medianLatencyMs: number;
  unpricedCalls: number;
  containerSeconds: number;
};

export type UsageTotals = Omit<UsageGroup, "jobKind" | "vendor" | "modelActual" | "medianCostUsd" | "medianLatencyMs">;

function num(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? 0;
  return s.length % 2 === 1 ? hi : ((s[mid - 1] ?? 0) + hi) / 2;
}

/** 순수 집계 — 라우트와 테스트가 같은 함수를 쓴다. */
export function aggregateUsageStats(rows: readonly UsageRow[]): { totals: UsageTotals; groups: UsageGroup[] } {
  const buckets = new Map<string, { key: Pick<UsageGroup, "jobKind" | "vendor" | "modelActual">; rows: UsageRow[] }>();
  for (const r of rows) {
    const key = { jobKind: String(r.job_kind ?? "other"), vendor: String(r.vendor ?? "unknown"), modelActual: String(r.model_actual ?? "unknown") };
    const id = `${key.jobKind}\u0000${key.vendor}\u0000${key.modelActual}`;
    const b = buckets.get(id) ?? { key, rows: [] };
    b.rows.push(r);
    buckets.set(id, b);
  }
  const totals: UsageTotals = { calls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0, containerSeconds: 0 };
  const groups: UsageGroup[] = [];
  for (const { key, rows: rs } of buckets.values()) {
    const g: UsageGroup = {
      ...key,
      calls: rs.length,
      inputTokens: rs.reduce((a, r) => a + num(r.input_tokens), 0),
      cacheReadTokens: rs.reduce((a, r) => a + num(r.cache_read_tokens), 0),
      cacheWriteTokens: rs.reduce((a, r) => a + num(r.cache_write_tokens), 0),
      outputTokens: rs.reduce((a, r) => a + num(r.output_tokens), 0),
      costUsd: round6(rs.reduce((a, r) => a + num(r.cost_usd), 0)),
      medianCostUsd: round6(median(rs.map((r) => num(r.cost_usd)))),
      medianLatencyMs: Math.round(median(rs.map((r) => num(r.latency_ms)))),
      unpricedCalls: rs.filter((r) => num(r.unpriced) === 1).length,
      containerSeconds: round6(rs.reduce((a, r) => a + num(r.container_seconds), 0)),
    };
    groups.push(g);
    totals.calls += g.calls;
    totals.inputTokens += g.inputTokens;
    totals.cacheReadTokens += g.cacheReadTokens;
    totals.cacheWriteTokens += g.cacheWriteTokens;
    totals.outputTokens += g.outputTokens;
    totals.costUsd += g.costUsd;
    totals.unpricedCalls += g.unpricedCalls;
    totals.containerSeconds += g.containerSeconds;
  }
  totals.costUsd = round6(totals.costUsd);
  totals.containerSeconds = round6(totals.containerSeconds);
  groups.sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls || a.jobKind.localeCompare(b.jobKind));
  return { totals, groups };
}

/** 길이가 달라도 일찍 끝나지 않는 비교(토큰 비교 타이밍 누설 완화). */
function sameToken(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function parseInstant(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

/** workspace-admin-stats.ts의 GET /admin/usage-stats가 x-admin-key 없는 요청을 여기로 넘긴다. */
export async function handleLlmUsageStats(c: Context<{ Bindings: Env }>): Promise<Response> {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m || !m[1]) return c.json({ ok: false, error: "unauthorized" }, 401);
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return c.json({ ok: false, error: "admin_disabled" }, 503);
  if (!sameToken(m[1], expected)) return c.json({ ok: false, error: "unauthorized" }, 401);

  const now = Date.now();
  const untilT = parseInstant(c.req.query("until"));
  const sinceT = parseInstant(c.req.query("since"));
  if (Number.isNaN(untilT) || Number.isNaN(sinceT)) return c.json({ ok: false, error: "invalid_range", detail: "since/until must be ISO-8601" }, 400);
  const until = untilT ?? now;
  const since = sinceT ?? until - DEFAULT_WINDOW_MS;
  if (!(since < until)) return c.json({ ok: false, error: "invalid_range", detail: "since must be before until" }, 400);
  const sinceIso = new Date(since).toISOString();
  const untilIso = new Date(until).toISOString();

  let rows: UsageRow[];
  try {
    const res = await c.env.DB.prepare(
      `SELECT job_kind, vendor, model_actual, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
              cost_usd, unpriced, latency_ms, container_seconds
         FROM llm_usage
        WHERE created_at >= ? AND created_at < ?
        LIMIT ?`,
    )
      .bind(sinceIso, untilIso, USAGE_STATS_ROW_LIMIT)
      .all<UsageRow>();
    rows = res.results ?? [];
  } catch (err) {
    console.error(JSON.stringify({ event: "usage_stats_query_failed", reason: String((err as Error)?.message ?? err).slice(0, 200) }));
    return c.json({ ok: false, error: "ledger_unavailable" }, 503);
  }

  const { totals, groups } = aggregateUsageStats(rows);
  return c.json({ ok: true, since: sinceIso, until: untilIso, rows: rows.length, truncated: rows.length >= USAGE_STATS_ROW_LIMIT, totals, groups });
}

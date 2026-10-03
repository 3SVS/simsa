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
 * 응답(JSON): { ok, since, until, coveredSince, rows, truncated, totals, groups[], notMetered[] }
 *   groups[]: { jobKind, vendor, modelActual, calls, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
 *               costUsd, medianCostUsd, medianLatencyMs, unpricedCalls, containerSeconds } — 비용 큰 순
 *   unpricedCalls > 0이면 그 그룹의 costUsd는 공식 단가가 아니라 보수(최고) 단가 추정이다(컨테이너 행은 단가 미정 0).
 *   ★상한(#562 결함 6): 가장 **최근** 행부터 최대 50,000행을 읽는다(ORDER BY created_at DESC, created_at 인덱스).
 *     넘치면 truncated:true — 이때 잘린 경계 타임스탬프의 행(같은 ms의 일부만 들어왔을 수 있다)을 버리고,
 *     totals·groups는 **[coveredSince, until) 구간의 정확한 집계**다(임의 부분집합이 아니다). 더 오래된 구간은
 *     until=coveredSince로 다시 부른다. 잘리지 않으면 coveredSince = since.
 *   ★notMetered(#562 결함 4): 원장이 보지 않는 LLM 경로(llm-usage.ts LEDGER_NOT_METERED) — totals는 이 경로의
 *     원가를 포함하지 않는다.
 * 원장 조회 실패는 500으로 숨기지 않고 503 ledger_unavailable(0070 미적용 등).
 * 프롬프트·userKey 등 개인 데이터는 응답에 없다(집계만).
 */
import type { Context } from "hono";
import type { Env } from "../env.js";
import { LEDGER_NOT_METERED } from "../workspace/llm-usage.js";
import { coveredWindow, internalBearerRejection, parseStatsWindow } from "./admin-internal.js";

/** 한 번에 읽는 최대 행 수. 넘으면 truncated: true — 기간을 좁혀 다시 부른다. */
export const USAGE_STATS_ROW_LIMIT = 50_000;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 기간 조회. created_at 단독 인덱스(0070 llm_usage_created_idx)로 범위 검색 + 역순 스캔 — 전체 SCAN도,
 * 정렬용 임시 B-tree도 없다(test/train-l-sqlite가 실제 SQLite의 EXPLAIN QUERY PLAN으로 고정).
 * 바인딩: since(포함), until(제외), limit.
 */
export const USAGE_STATS_SQL = `SELECT created_at, job_kind, vendor, model_actual, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
       cost_usd, unpriced, latency_ms, container_seconds
  FROM llm_usage
 WHERE created_at >= ? AND created_at < ?
 ORDER BY created_at DESC
 LIMIT ?`;

export type UsageRow = {
  created_at?: string | null;
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

/** workspace-admin-stats.ts의 GET /admin/usage-stats가 x-admin-key 없는 요청을 여기로 넘긴다. */
export async function handleLlmUsageStats(c: Context<{ Bindings: Env }>): Promise<Response> {
  // 인증·기간·상한 규칙은 /admin/moat-stats와 같은 한 곳(admin-internal.ts)에서 온다 — 순서·응답은 그대로.
  const rejected = internalBearerRejection(c);
  if (rejected) return rejected;

  const win = parseStatsWindow(c.req.query("since"), c.req.query("until"), DEFAULT_WINDOW_MS);
  if (!win.ok) return c.json({ ok: false, error: "invalid_range", detail: win.detail }, 400);
  const { sinceIso, untilIso } = win;

  let fetched: UsageRow[];
  try {
    const res = await c.env.DB.prepare(USAGE_STATS_SQL).bind(sinceIso, untilIso, USAGE_STATS_ROW_LIMIT).all<UsageRow>();
    fetched = res.results ?? [];
  } catch (err) {
    console.error(JSON.stringify({ event: "usage_stats_query_failed", reason: String((err as Error)?.message ?? err).slice(0, 200) }));
    return c.json({ ok: false, error: "ledger_unavailable" }, 503);
  }

  const window = coveredWindow(fetched, sinceIso, USAGE_STATS_ROW_LIMIT);
  const { totals, groups } = aggregateUsageStats(window.rows);
  return c.json({
    ok: true,
    since: sinceIso,
    until: untilIso,
    coveredSince: window.coveredSince,
    rows: window.rows.length,
    truncated: window.truncated,
    totals,
    groups,
    notMetered: LEDGER_NOT_METERED,
  });
}

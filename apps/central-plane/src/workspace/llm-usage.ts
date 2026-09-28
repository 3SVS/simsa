/**
 * workspace/llm-usage.ts — Train L · L-3 LLM 사용량 원장(llm_usage, 0070).
 *
 * 한 번의 LLM 호출 = 한 행. 비용은 **실응답 모델**의 공식 단가(llm-pricing.ts)로 계산하고, 단가를 모르면
 * 보수(최고) 단가 + unpriced=1. userKey는 sha256 해시로만 남긴다.
 *
 * 규율:
 *   - **fail-open**: 기록 실패가 사용자 요청·콜백 처리를 깨지 않는다. 실패는 console.error **한 줄 JSON**
 *     (`{"event":"llm_usage_record_failed",…}`) — 두 번째 인자로 나누면 tail에서 잘린다(2026-08-24 교훈).
 *   - 콜백 usage[]는 신뢰 경계 밖 — Zod로 항목별 검증, 잘못된 항목은 버리고 **본 처리는 계속**(400 아님),
 *     최대 200개.
 *   - project_id·user_key는 호출자가 **소유권을 확인한 값**만 넘긴다(콜백은 잡 행에서, 동기 요청은 소유 확인 뒤).
 */
import { z } from "zod";
import { sha256Hex } from "../util.js";
import { priceTokens } from "./llm-pricing.js";
import type { LlmUsageEvent, LlmUsageSink } from "./anthropic-fetch.js";

export const LLM_JOB_KINDS = ["generate", "dev_spec", "check", "council", "repair", "build", "inspection", "other"] as const;
export type LlmJobKind = (typeof LLM_JOB_KINDS)[number];

export type LlmUsageRowInput = LlmUsageEvent & {
  jobKind: LlmJobKind;
  jobId?: string | null;
  /** 소유권이 확인된 프로젝트만. 모르면 null. */
  projectId?: string | null;
  /** 원본 userKey — 저장 전에 sha256으로 바뀐다. "anonymous"·빈 값은 null. */
  userKey?: string | null;
  containerSeconds?: number | null;
  /** 가격표 계산 대신 쓸 값(컨테이너 시간 행: 단가 미정 → 0 + unpriced). */
  costOverride?: { costUsd: number; unpriced: boolean };
  createdAt?: string;
  /**
   * 재전송에 안전한 행 키(콜백 행). 있으면 행 id = `lu_` + sha256(job_kind, job_id, rowKey) 앞 32자 —
   * 같은 호출이 두 번 와도 `ON CONFLICT(id) DO NOTHING`으로 한 행만 남는다. 없으면(동기 요청) 무작위 id.
   */
  rowKey?: string;
};

type LedgerEnv = { DB: D1Database };

const COLUMNS = [
  "id", "created_at", "job_kind", "job_id", "project_id", "user_key_hash", "vendor", "model_requested", "model_actual", "call_site",
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "cost_usd", "unpriced", "latency_ms", "container_seconds",
] as const;
/**
 * 원장 INSERT. `ON CONFLICT(id) DO NOTHING` — 콜백 행 id는 결정론적이라(rowKey) 재전송·누적 재전송이
 * 같은 행에 부딪히면 조용히 건너뛴다(#562 결함 1·2). PK 충돌에만 적용되고 다른 제약 위반은 그대로 오류다.
 */
export const LLM_USAGE_INSERT_SQL = `INSERT INTO llm_usage (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")}) ON CONFLICT(id) DO NOTHING`;
const INSERT_SQL = LLM_USAGE_INSERT_SQL;

function clip(s: string | null | undefined, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}
function intOf(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function newRowId(): string {
  return `lu_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** 콜백 행의 결정론적 id — 같은 (job_kind, job_id, rowKey)는 언제 와도 같은 id. */
async function deterministicRowId(jobKind: string, jobId: string, rowKey: string): Promise<string> {
  return `lu_${(await sha256Hex(JSON.stringify([jobKind, jobId, rowKey]))).slice(0, 32)}`;
}

/** 동기 요청(검수·생성 등)의 여러 호출을 한 job_id로 묶기 위한 요청 id. */
export function newLlmJobId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function logRecordFailure(row: Pick<LlmUsageRowInput, "jobKind" | "jobId">, err: unknown, count = 1): void {
  try {
    console.error(
      JSON.stringify({
        event: "llm_usage_record_failed",
        job_kind: row.jobKind,
        job_id: row.jobId ?? null,
        rows: count,
        reason: String((err as Error)?.message ?? err).slice(0, 200),
      }),
    );
  } catch {
    /* 로깅이 호출을 깨면 안 된다 */
  }
}

async function bindingsFor(row: LlmUsageRowInput): Promise<unknown[]> {
  const modelActual = clip(row.modelActual, 120) ?? clip(row.modelRequested, 120) ?? "unknown";
  const tokens = {
    inputTokens: intOf(row.inputTokens),
    cacheReadTokens: intOf(row.cacheReadTokens),
    cacheWriteTokens: intOf(row.cacheWriteTokens),
    outputTokens: intOf(row.outputTokens),
  };
  const priced = row.costOverride ?? priceTokens(modelActual, tokens);
  const userKey = typeof row.userKey === "string" ? row.userKey.trim() : "";
  const userKeyHash = userKey && userKey !== "anonymous" ? await sha256Hex(userKey) : null;
  const containerSeconds =
    typeof row.containerSeconds === "number" && Number.isFinite(row.containerSeconds) && row.containerSeconds >= 0
      ? row.containerSeconds
      : null;
  const id = typeof row.rowKey === "string" && row.rowKey ? await deterministicRowId(row.jobKind, row.jobId ?? "", row.rowKey) : newRowId();
  return [
    id,
    row.createdAt ?? new Date().toISOString(),
    row.jobKind,
    clip(row.jobId, 80),
    clip(row.projectId, 80),
    userKeyHash,
    clip(row.vendor, 40) ?? "unknown",
    clip(row.modelRequested, 120),
    modelActual,
    clip(row.callSite, 60),
    tokens.inputTokens,
    tokens.cacheReadTokens,
    tokens.cacheWriteTokens,
    tokens.outputTokens,
    Number.isFinite(priced.costUsd) && priced.costUsd > 0 ? priced.costUsd : 0,
    // 비용을 유한수로 못 매겼으면 0달러를 확정 원가처럼 남기지 않는다(unpriced=1).
    priced.unpriced || !Number.isFinite(priced.costUsd) ? 1 : 0,
    intOf(row.latencyMs),
    containerSeconds,
  ];
}

/** 한 행 기록. 성공 true, 실패 false — 절대 던지지 않는다. */
export async function recordLlmUsage(env: LedgerEnv, row: LlmUsageRowInput): Promise<boolean> {
  try {
    const b = await bindingsFor(row);
    await env.DB.prepare(INSERT_SQL).bind(...b).run();
    return true;
  } catch (err) {
    logRecordFailure(row, err);
    return false;
  }
}

/** 여러 행 기록. D1 batch가 있으면 묶어서(50개씩), 없으면 한 행씩. 절대 던지지 않는다. */
export async function recordLlmUsageBatch(env: LedgerEnv, rows: readonly LlmUsageRowInput[]): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  if (rows.length === 0) return { written, failed };
  const db = env.DB as D1Database & { batch?: D1Database["batch"] };
  if (typeof db.batch === "function") {
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      try {
        const stmts = await Promise.all(chunk.map(async (r) => db.prepare(INSERT_SQL).bind(...(await bindingsFor(r)))));
        await db.batch(stmts);
        written += chunk.length;
      } catch (err) {
        failed += chunk.length;
        const first = chunk[0];
        if (first) logRecordFailure(first, err, chunk.length);
      }
    }
    return { written, failed };
  }
  for (const r of rows) {
    if (await recordLlmUsage(env, r)) written += 1;
    else failed += 1;
  }
  return { written, failed };
}

// ─── 컨테이너 콜백 usage[] ──────────────────────────────────────────────────────

/** 콜백 한 번에 받는 usage 항목 상한. 넘치면 앞에서부터 200개만. */
export const CALLBACK_USAGE_MAX = 200;

const tokenField = z.number().finite().nonnegative().max(50_000_000).transform((n) => Math.floor(n));

/**
 * 콜백 계약(빌더·수리 컨테이너 → /internal/build-progress · build-done · repair-done).
 *
 * ★ 재전송·중복 규약(#562 결함 1·2) — 생산자는 이것을 지킨다:
 *   1. 각 콜백은 **직전 콜백 이후 새로 생긴 호출만(델타)** 싣는다. build-done은 아직 보내지 않은 나머지만.
 *      (runBuildLoop의 onUsage(턴별)와 outcome.usage(누적)를 **둘 다** 보내지 않는다.)
 *   2. 각 항목에 `callId`를 싣는다 — **그 잡 안에서 유일**하고 재전송해도 **같은 값**(예: `<실행 nonce>:<순번>`).
 *      잡이 여러 번 실행될 수 있거나 runBuildLoop를 여러 번 부르면 nonce/태스크 id를 넣어 겹치지 않게 한다.
 *   3. 그래도 겹쳐 오면(성공 콜백 실패 → 같은 snapshot으로 실패 콜백, 누적 재전송) Worker가 한 번만 쓴다:
 *      행 id = sha256(job_kind, job_id, callId) → `ON CONFLICT(id) DO NOTHING`.
 *      callId가 없는 옛 생산자는 **항목 내용**(벤더·모델·토큰·지연·callSite) + 같은 콜백 안에서 같은 내용의 순번이
 *      키다 — 내용이 완전히 같은 서로 다른 호출이 **다른 콜백**으로 오면 한 번으로 합쳐질 수 있다(과소 방향,
 *      지연 ms까지 같아야 하므로 드묾). 그래서 callId를 권한다.
 */
export const CallbackUsageItemSchema = z.object({
  vendor: z.string().trim().min(1).max(40),
  modelRequested: z.string().trim().max(120),
  modelActual: z.string().trim().min(1).max(120),
  inputTokens: tokenField,
  cacheReadTokens: tokenField,
  cacheWriteTokens: tokenField,
  outputTokens: tokenField,
  latencyMs: z.number().finite().nonnegative().max(86_400_000).transform((n) => Math.floor(n)),
  callSite: z.string().trim().max(60).optional(),
  /** 잡 안에서 유일·재전송에 불변인 호출 id(권장). 원장 행 id의 원천. */
  callId: z.string().trim().min(1).max(80).optional(),
});

/** 콜백 항목 + 재전송 안전 행 키. */
export type CallbackUsageItem = LlmUsageEvent & { rowKey: string };

/**
 * 콜백 본문의 usage 필드를 읽는다. 절대 던지지 않고, 잘못된 값 때문에 본 처리를 막지 않는다.
 *   - 없음 → 빈 목록(옛 컨테이너)
 *   - 배열 아님 → 빈 목록 + dropped 1
 *   - 항목별 검증: 통과한 것만, 실패는 dropped로 센다
 *   - 200개 초과 → 앞 200개 + truncated
 *   - 각 항목의 rowKey: callId가 있으면 `call:<callId>`, 없으면 `content:<정규화 내용>#<같은 내용의 순번>`
 */
export function parseCallbackUsage(raw: unknown): { items: CallbackUsageItem[]; dropped: number; truncated: number } {
  if (raw === undefined || raw === null) return { items: [], dropped: 0, truncated: 0 };
  if (!Array.isArray(raw)) return { items: [], dropped: 1, truncated: 0 };
  const truncated = Math.max(0, raw.length - CALLBACK_USAGE_MAX);
  const items: CallbackUsageItem[] = [];
  const seenContent = new Map<string, number>();
  let dropped = 0;
  for (const entry of raw.slice(0, CALLBACK_USAGE_MAX)) {
    const p = CallbackUsageItemSchema.safeParse(entry);
    if (!p.success) {
      dropped += 1;
      continue;
    }
    const v = p.data;
    const event: LlmUsageEvent = {
      vendor: v.vendor,
      modelRequested: v.modelRequested || v.modelActual,
      modelActual: v.modelActual,
      inputTokens: v.inputTokens,
      cacheReadTokens: v.cacheReadTokens,
      cacheWriteTokens: v.cacheWriteTokens,
      outputTokens: v.outputTokens,
      latencyMs: v.latencyMs,
      ...(v.callSite ? { callSite: v.callSite } : {}),
    };
    let rowKey: string;
    if (v.callId) {
      rowKey = `call:${v.callId}`;
    } else {
      const content = JSON.stringify([
        event.vendor, event.modelRequested, event.modelActual, event.inputTokens, event.cacheReadTokens,
        event.cacheWriteTokens, event.outputTokens, event.latencyMs, event.callSite ?? null,
      ]);
      const nth = seenContent.get(content) ?? 0;
      seenContent.set(content, nth + 1);
      rowKey = `content:${content}#${nth}`;
    }
    items.push({ ...event, rowKey });
  }
  return { items, dropped, truncated };
}

/** 콜백 usage[]를 잡 맥락(잡 행에서 읽은 project·user)과 함께 원장에 쓴다. 절대 던지지 않는다. */
export async function recordCallbackUsage(
  env: LedgerEnv,
  raw: unknown,
  job: { jobKind: LlmJobKind; jobId: string; projectId: string | null; userKey: string | null },
): Promise<{ written: number; failed: number; dropped: number; truncated: number }> {
  const parsed = parseCallbackUsage(raw);
  if (parsed.dropped > 0 || parsed.truncated > 0) {
    try {
      console.log(JSON.stringify({ event: "llm_usage_callback_trimmed", job_kind: job.jobKind, job_id: job.jobId, dropped: parsed.dropped, truncated: parsed.truncated }));
    } catch {
      /* ignore */
    }
  }
  const r = await recordLlmUsageBatch(
    env,
    parsed.items.map((u) => ({ ...u, jobKind: job.jobKind, jobId: job.jobId, projectId: job.projectId, userKey: job.userKey })),
  );
  return { ...r, dropped: parsed.dropped, truncated: parsed.truncated };
}

// ─── Worker 동기 요청 ───────────────────────────────────────────────────────────

/** 라우트가 LLM 호출부에 넘기는 싱크 + 모인 이벤트. */
export function createUsageCollector(): { sink: LlmUsageSink; events: LlmUsageEvent[] } {
  const events: LlmUsageEvent[] = [];
  return {
    events,
    sink: (u) => {
      if (events.length < 500) events.push(u);
    },
  };
}

/** 모인 이벤트를 한 job_id로 원장에 쓴다. */
export function recordCollectedUsage(
  env: LedgerEnv,
  events: readonly LlmUsageEvent[],
  job: { jobKind: LlmJobKind; jobId: string; projectId: string | null; userKey: string | null },
): Promise<{ written: number; failed: number }> {
  return recordLlmUsageBatch(
    env,
    events.map((u) => ({ ...u, jobKind: job.jobKind, jobId: job.jobId, projectId: job.projectId, userKey: job.userKey })),
  );
}

/**
 * 응답 뒤에 돌린다(waitUntil) — 사용자 지연에 원장 쓰기를 더하지 않는다. ExecutionContext가 없으면
 * (로컬·테스트) 그 자리에서 기다린다. 어느 쪽이든 던지지 않는다.
 */
export async function runAfterResponse(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, work: Promise<unknown>): Promise<void> {
  const safe = work.then(
    () => undefined,
    () => undefined,
  );
  let ctx: { waitUntil(p: Promise<unknown>): void } | null = null;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = null; // Hono: "This context has no ExecutionContext"
  }
  if (ctx) {
    try {
      ctx.waitUntil(safe);
      return;
    } catch {
      /* fall through */
    }
  }
  await safe;
}

/**
 * routes/admin-internal.ts — 운영자 전용 집계 라우트(/admin/usage-stats 원장 · /admin/moat-stats)가 함께 쓰는 세 가지.
 *
 *   internalBearerRejection  Bearer INTERNAL_CALLBACK_TOKEN 인증. 요청 토큰이 없거나 틀리면 401, 서버에 토큰이
 *                            없으면 503 admin_disabled. 통과하면 null. (Train L · L-5에서 옮겨 왔다 — 순서·응답 동일)
 *   parseStatsWindow         ?since=<ISO>&until=<ISO> → [since, until). 기본 until=지금, since=until−기본 창.
 *   coveredWindow            최신순으로 LIMIT만큼 읽은 행이 상한에 닿았으면 가장 오래된 타임스탬프의 행을 버린다
 *                            (같은 ms의 일부만 들어왔을 수 있어서다) → 남은 행은 [coveredSince, until)의 **모든** 행.
 *
 * 둘 이상의 라우트가 같은 인증·기간·상한 규칙을 가져야 하므로 한 곳에 둔다(복사본이 갈라지면 한쪽만 약해진다).
 */
import type { Context } from "hono";
import type { Env } from "../env.js";

/** 길이가 달라도 일찍 끝나지 않는 비교(토큰 비교 타이밍 누설 완화). */
export function sameToken(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Bearer INTERNAL_CALLBACK_TOKEN 확인. 거부 응답 또는 null(통과). D1은 이 뒤에서만 읽는다. */
export function internalBearerRejection(c: Context<{ Bindings: Env }>): Response | null {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m || !m[1]) return c.json({ ok: false, error: "unauthorized" }, 401);
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return c.json({ ok: false, error: "admin_disabled" }, 503);
  if (!sameToken(m[1], expected)) return c.json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

function parseInstant(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NaN;
}

export type StatsWindow = { ok: true; sinceIso: string; untilIso: string } | { ok: false; detail: string };

/** 기간 파싱. 실패 사유는 400 invalid_range의 detail로 그대로 쓴다. */
export function parseStatsWindow(since: string | undefined, until: string | undefined, defaultWindowMs: number, now = Date.now()): StatsWindow {
  const untilT = parseInstant(until);
  const sinceT = parseInstant(since);
  if (Number.isNaN(untilT) || Number.isNaN(sinceT)) return { ok: false, detail: "since/until must be ISO-8601" };
  const u = untilT ?? now;
  const s = sinceT ?? u - defaultWindowMs;
  if (!(s < u)) return { ok: false, detail: "since must be before until" };
  return { ok: true, sinceIso: new Date(s).toISOString(), untilIso: new Date(u).toISOString() };
}

/**
 * 상한에 걸렸으면(최신순으로 읽었으므로 잘린 쪽은 오래된 쪽이다) 가장 오래된 타임스탬프의 행을 버린다 — 같은 ms의
 * 행 일부만 들어왔을 수 있어서다. 남은 행은 [coveredSince, until)의 **모든** 행이다. 잘리지 않았으면 그대로.
 */
export function coveredWindow<T extends { created_at?: string | null }>(
  rows: readonly T[],
  sinceIso: string,
  limit: number,
): { rows: T[]; truncated: boolean; coveredSince: string | null } {
  if (rows.length < limit) return { rows: [...rows], truncated: false, coveredSince: sinceIso };
  const stamps = rows.map((r) => (typeof r.created_at === "string" ? r.created_at : ""));
  const boundary = stamps.reduce((min, s) => (s < min ? s : min), stamps[0] ?? "");
  const kept = rows.filter((_, i) => (stamps[i] ?? "") > boundary);
  const coveredSince = kept.length > 0 ? kept.reduce((min, r) => ((r.created_at ?? "") < min ? (r.created_at ?? "") : min), kept[0]?.created_at ?? "") : null;
  return { rows: kept, truncated: true, coveredSince };
}

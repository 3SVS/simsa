/**
 * workspace/evidence-retention.ts — S5-min(오픈 베타, 2026-10-05): 남의 앱에서 찍은 화면·글자의 보관 기한.
 *
 * 검수 런이 만든 것 중 **사용자 앱의 내용**을 담은 것 — 스크린샷·영상(R2 `checks/{userKey}/{projectId}/{runId}/…`)과
 * 리포트 안의 화면 인용(AC 근거·발견 근거·점검 세부·고친 파일) — 은 만든 지 30일이 지나면 지운다. 판정·기준·요약 문장은
 * 남긴다(사용자의 기록이자 재검수의 자). 프로젝트를 지우면 지금처럼 즉시 함께 지워진다(db.ts deleteProject 접두 스윕).
 *
 * 6시간 크론이 한 번에 RETENTION_SWEEP_LIMIT개씩. 지운 런에는 report.retentionStrippedAt을 찍어 다시 고르지 않는다.
 */
import type { Env } from "../env.js";

export const EVIDENCE_RETENTION_DAYS = 30;
export const RETENTION_SWEEP_LIMIT = 50;

type Row = { id: string; project_id: string; user_key: string; evidence_keys_json: string; report_json: string };

/** 리포트에서 앱 화면 내용(인용·근거·고친 파일)을 걷어 낸다. 판정·기준 정의·요약은 그대로. */
export function stripReportContent(report: Record<string, unknown>, at: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...report, retentionStrippedAt: at };
  if (Array.isArray(report["acTable"])) {
    out["acTable"] = (report["acTable"] as Array<Record<string, unknown>>).map((r) => ({ ...r, evidence: [], ...(r["screenshot"] ? { screenshot: undefined } : {}) }));
  }
  if (Array.isArray(report["findings"])) {
    out["findings"] = (report["findings"] as Array<Record<string, unknown>>).map((f) => ({ ...f, evidence: null }));
  }
  const sweep = report["sweep"];
  if (sweep && typeof sweep === "object" && Array.isArray((sweep as Record<string, unknown>)["problems"])) {
    out["sweep"] = {
      ...(sweep as Record<string, unknown>),
      problems: ((sweep as Record<string, unknown>)["problems"] as Array<Record<string, unknown>>).map(({ detail: _d, ...rest }) => rest),
    };
  }
  const agent = report["agent"];
  if (agent && typeof agent === "object") {
    const a = { ...(agent as Record<string, unknown>) };
    const sff = a["singleFileFix"];
    if (sff && typeof sff === "object") {
      const { correctedHtml: _h, diff: _d, ...rest } = sff as Record<string, unknown>;
      a["singleFileFix"] = rest;
    }
    out["agent"] = a;
  }
  return out;
}

export async function sweepExpiredEvidence(env: Pick<Env, "DB" | "EVIDENCE">, nowMs: number = Date.now()): Promise<{ runs: number; objects: number }> {
  const cutoff = new Date(nowMs - EVIDENCE_RETENTION_DAYS * 86_400_000).toISOString();
  let rows: Row[] = [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, project_id, user_key, evidence_keys_json, report_json FROM workspace_visual_checks
        WHERE created_at < ? AND status IN ('done','failed','uploaded')
          AND (evidence_keys_json != '[]' OR (report_json LIKE '%"acTable"%' AND report_json NOT LIKE '%"retentionStrippedAt"%'))
        ORDER BY created_at LIMIT ?`,
    )
      .bind(cutoff, RETENTION_SWEEP_LIMIT)
      .all<Row>();
    rows = r.results ?? [];
  } catch (err) {
    console.error(JSON.stringify({ at: "evidence-retention", error: String((err as Error)?.message ?? err).slice(0, 160) }));
    return { runs: 0, objects: 0 };
  }
  const at = new Date(nowMs).toISOString();
  let objects = 0;
  for (const row of rows) {
    let names: string[] = [];
    try {
      names = JSON.parse(row.evidence_keys_json) as string[];
    } catch {
      names = [];
    }
    if (env.EVIDENCE && row.user_key) {
      const keys = names.filter((n) => typeof n === "string" && n).map((n) => `checks/${row.user_key}/${row.project_id}/${row.id}/${n}`);
      if (keys.length) {
        try {
          await env.EVIDENCE.delete(keys);
          objects += keys.length;
        } catch (err) {
          console.error(JSON.stringify({ at: "evidence-retention", runId: row.id, error: String((err as Error)?.message ?? err).slice(0, 120) }));
          continue; // R2가 실패하면 행도 그대로(다음 스윕에 다시)
        }
      }
    }
    let report: Record<string, unknown> = {};
    try {
      report = JSON.parse(row.report_json) as Record<string, unknown>;
    } catch {
      report = {};
    }
    const stripped = report && typeof report === "object" && !Array.isArray(report) ? stripReportContent(report, at) : { retentionStrippedAt: at };
    await env.DB.prepare(`UPDATE workspace_visual_checks SET evidence_keys_json = '[]', report_json = ? WHERE id = ?`)
      .bind(JSON.stringify(stripped), row.id)
      .run();
  }
  return { runs: rows.length, objects };
}

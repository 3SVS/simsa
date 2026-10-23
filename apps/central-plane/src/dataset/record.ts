/**
 * dataset/record.ts — 기계 후보 라벨 저장 + 관리자 집계 (train L3·L5, 2026-10-24).
 *
 * 저장: 검수 완료 콜백이 v2 리포트를 받으면 machineCandidatesFromV2Report → Zod 검증 → 0076 표에 append.
 *   **닫힌 어휘 칸만** 넣는다(화면 글자 인용·판정 문장·행동 기록·주소 없음 — migrations/0076 머리말). 앱은 주소 해시(app_id).
 *   표가 아직 없으면(마이그레이션 적용 전) 쓰기 실패 → 호출자가 잡고 넘어간다(검수 결과 전달을 막지 않는다).
 * 집계: 결함 묶음(첫 지점 규칙, S5c)은 런 안에서 1개로 센다 — 같은 원인이 여러 기준에서 실패해도 실패 1건.
 */
import { BUILDERS } from "../agent-inspection.js";
import type { Env } from "../env.js";
import { AcLabel, FailureEvent } from "./labels.js";
import { machineCandidatesFromV2Report } from "./machine-candidates.js";

/** 앱 하나 = 배포 주소(출처 + 경로) 하나 — 주소는 저장하지 않고 해시만(설계 §1 app_id). */
export async function appIdFor(targetUrl: string): Promise<string> {
  let key = targetUrl;
  try {
    const u = new URL(targetUrl);
    key = `${u.origin}${u.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    /* 주소가 아니면 그대로 */
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key.toLowerCase()));
  return `app_${[...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function recordMachineLabels(
  env: Pick<Env, "DB">,
  args: { runId: string; targetUrl: string; report: Record<string, unknown>; now?: string },
): Promise<{ acLabels: number; failures: number; invalid: number }> {
  if (args.report["engineVersion"] !== "v2") return { acLabels: 0, failures: 0, invalid: 0 };
  const now = args.now ?? new Date().toISOString();
  const appId = await appIdFor(args.targetUrl);
  const agent = (args.report["agent"] && typeof args.report["agent"] === "object" ? args.report["agent"] : {}) as Record<string, unknown>;
  const builder = typeof agent["builder"] === "string" && (BUILDERS as readonly string[]).includes(agent["builder"]) ? agent["builder"] : "unknown";
  const acs = Array.isArray(agent["acs"]) ? (agent["acs"] as Array<{ id: string; title?: string; then?: string; priority?: string }>) : [];
  const cand = machineCandidatesFromV2Report(args.report as Parameters<typeof machineCandidatesFromV2Report>[0], { runId: args.runId, appId, createdAt: now, acs });
  let invalid = 0;
  const stmts = [];
  for (const raw of cand.acLabels.slice(0, 40)) {
    const p = AcLabel.safeParse(raw);
    if (!p.success) {
      invalid += 1;
      continue;
    }
    const x = p.data;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO label_ac_verdicts (label_id, run_id, app_id, ac_id, priority, source, producer, model, h1, h2, h3, h4, machine_reasons,
           label_schema_version, taxonomy_version, axes_version, rubric_version, supersedes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(label_id) DO NOTHING`,
      ).bind(
        x.labelId, x.runId, x.appId, x.acId, x.priority ?? null, x.source, x.producer, x.model ?? null, x.h1, x.h2, x.h3, x.h4,
        x.machineReasons?.length ? JSON.stringify(x.machineReasons) : null,
        x.versions.labelSchema, x.versions.taxonomy, x.versions.axes, x.versions.rubric, x.supersedes ?? null, x.createdAt,
      ),
    );
  }
  const acCount = stmts.length;
  for (const raw of cand.failureEvents.slice(0, 40)) {
    const p = FailureEvent.safeParse(raw);
    if (!p.success) {
      invalid += 1;
      continue;
    }
    const f = p.data;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO label_failure_events (failure_id, label_id, run_id, app_id, ac_id, builder, source, producer, model, w1, w2, w3, y, c, k, s, r,
           reproduced_k, reproduced_n, a, p, x, defect_group, label_schema_version, taxonomy_version, axes_version, rubric_version, supersedes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(failure_id) DO NOTHING`,
      ).bind(
        f.failureId, f.labelId, f.runId, f.appId, f.acId, builder, f.source, f.producer, f.model ?? null, f.w1, f.w2, f.w3, f.y, f.c, f.k, f.s, f.r,
        f.reproduced?.k ?? null, f.reproduced?.n ?? null, f.a, f.p ? 1 : 0, f.x ?? null, f.defectGroup ?? null,
        f.versions.labelSchema, f.versions.taxonomy, f.versions.axes, f.versions.rubric, f.supersedes ?? null, f.createdAt,
      ),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { acLabels: acCount, failures: stmts.length - acCount, invalid };
}

export interface FailureStatRow {
  builder: string;
  w1: string;
  y: string;
  k: string;
  s: string;
  /** 실패 건수 — 런 안의 같은 결함 묶음은 1건(첫 지점 규칙) */
  failures: number;
  /** 그 실패가 나온 런 수 */
  runs: number;
  /** 그 실패가 나온 앱 수 */
  apps: number;
}

/** 관리자 집계: 빌더 × 여정 단계 × 증상 × 결함 분류 × 심각도. 출처 하나만(기본 machine) — 출처를 섞어 세지 않는다. */
export async function failureStats(env: Pick<Env, "DB">, opts: { since: string; source?: "machine" | "labeler_agent" | "user" }): Promise<FailureStatRow[]> {
  const rows = await env.DB.prepare(
    `SELECT builder, w1, y, k, s,
            COUNT(DISTINCT CASE WHEN defect_group IS NULL THEN failure_id ELSE run_id || '|' || defect_group END) AS failures,
            COUNT(DISTINCT run_id) AS runs, COUNT(DISTINCT app_id) AS apps
       FROM label_failure_events
      WHERE created_at >= ? AND source = ? AND supersedes IS NULL
      GROUP BY builder, w1, y, k, s
      ORDER BY builder, failures DESC`,
  )
    .bind(opts.since, opts.source ?? "machine")
    .all<FailureStatRow>();
  return rows.results ?? [];
}

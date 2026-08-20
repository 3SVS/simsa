/**
 * workspace/outcomes.ts
 *
 * D1 helpers for builder_pack_outcomes — recording the result of sending
 * a builder pack to the user's coding agent / web builder / human handoff.
 */
import type { Env } from "../env.js";
import type { ExportTarget } from "./export.js";

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `bpo_${ts}${r}`;
}

export type OutcomeStatus = "worked" | "partial" | "failed" | "not_checked";
export type { ExportTarget };

const VALID_OUTCOMES: OutcomeStatus[] = ["worked", "partial", "failed", "not_checked"];
// export.ts의 ExportTarget과 단일 소스 — 여기가 뒤처지면 web_builder/handoff
// 유저의 outcome이 400으로 소실된다 (스택 불가지 설계 §0-B8, 2026-08-20 실사고).
const VALID_TARGETS: ExportTarget[] = ["claude_code", "codex", "both", "web_builder", "handoff"];

export function isValidOutcome(v: unknown): v is OutcomeStatus {
  return typeof v === "string" && (VALID_OUTCOMES as string[]).includes(v);
}

export function isValidTarget(v: unknown): v is ExportTarget {
  return typeof v === "string" && (VALID_TARGETS as string[]).includes(v);
}

export type DbOutcome = {
  id: string;
  projectId: string;
  userKey: string;
  target: ExportTarget;
  selectedItemIds: string[];
  outcome: OutcomeStatus;
  note?: string;
  createdAt: string;
};

export async function saveOutcome(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    target: ExportTarget;
    selectedItemIds: string[];
    outcome: OutcomeStatus;
    note?: string;
  },
): Promise<DbOutcome> {
  const id = randId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO builder_pack_outcomes
       (id, project_id, user_key, target, selected_item_ids_json, outcome, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.projectId,
      input.userKey,
      input.target,
      JSON.stringify(input.selectedItemIds),
      input.outcome,
      input.note ?? null,
      now,
    )
    .run();
  return {
    id,
    projectId: input.projectId,
    userKey: input.userKey,
    target: input.target,
    selectedItemIds: input.selectedItemIds,
    outcome: input.outcome,
    note: input.note,
    createdAt: now,
  };
}

export async function listOutcomes(
  env: Env,
  projectId: string,
  limit = 50,
): Promise<DbOutcome[]> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, user_key, target, selected_item_ids_json, outcome, note, created_at
     FROM builder_pack_outcomes
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(projectId, limit)
    .all<{
      id: string;
      project_id: string;
      user_key: string;
      target: string;
      selected_item_ids_json: string;
      outcome: string;
      note: string | null;
      created_at: string;
    }>();

  return (rows.results ?? []).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    userKey: r.user_key,
    target: r.target as ExportTarget,
    selectedItemIds: (() => {
      try { return JSON.parse(r.selected_item_ids_json) as string[]; }
      catch { return []; }
    })(),
    outcome: r.outcome as OutcomeStatus,
    note: r.note ?? undefined,
    createdAt: r.created_at,
  }));
}

/**
 * workspace/usage-events-db.ts
 *
 * Lightweight usage event recorder for future billing and analytics.
 * No credit deduction happens here — this is record-only.
 */
import type { Env } from "../env.js";

export type UsageEventType =
  | "workspace_idea_to_spec_generated"
  | "workspace_document_spec_draft_generated"
  | "workspace_check_draft_run"
  | "workspace_fix_suggestion_generated"
  | "workspace_builder_pack_exported"
  | "workspace_pr_review_run"
  | "workspace_pr_review_compared"
  | "workspace_pr_comment_posted"
  | "workspace_pr_comment_updated"
  | "workspace_fix_pack_exported"
  | "workspace_telegram_notification_sent"
  | "workspace_telegram_notification_error"
  | "workspace_email_notification_sent"
  | "workspace_email_notification_error";

function randId(): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `wue_${ts}${r}`;
}

export async function insertUsageEvent(
  env: Env,
  input: {
    userKey: string;
    projectId?: string;
    eventType: UsageEventType | string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const id = randId();
  try {
    await env.DB.prepare(
      `INSERT INTO workspace_usage_events
         (id, user_key, project_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.userKey,
        input.projectId ?? null,
        input.eventType,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
      )
      .run();
  } catch (err: unknown) {
    // Non-fatal: usage recording failure must not break the main operation
    console.warn("[usage-events] insert failed:", err);
  }
}

/**
 * 기준평가 1(verify 자동화) — 이벤트-큐 조회: 특정 타입의 최근 이벤트.
 * 새 테이블 없이 usage events를 신호 큐로 재사용하기 위한 유일한 읽기 경로.
 */
export async function listRecentUsageEventsByType(
  env: Env,
  eventType: string,
  sinceIso: string,
  limit = 50,
): Promise<Array<{ id: string; userKey: string; projectId: string | null; metadata: Record<string, unknown> | null; createdAt: string }>> {
  const rows = await env.DB.prepare(
    `SELECT id, user_key, project_id, metadata_json, created_at
       FROM workspace_usage_events
      WHERE event_type = ? AND created_at > ?
      ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(eventType, sinceIso, Math.min(limit, 200))
    .all<{ id: string; user_key: string; project_id: string | null; metadata_json: string | null; created_at: string }>();
  return (rows.results ?? []).map((r) => {
    let metadata: Record<string, unknown> | null = null;
    try {
      metadata = r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : null;
    } catch {
      metadata = null;
    }
    return { id: r.id, userKey: r.user_key, projectId: r.project_id, metadata, createdAt: r.created_at };
  });
}

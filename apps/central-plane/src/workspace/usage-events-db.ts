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
  | "workspace_telegram_notification_error";

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

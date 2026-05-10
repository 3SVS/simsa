/**
 * v0.16.15 — Sprint E4 (scaffold): prompt-evolution helpers.
 *
 * Today's scope: data-model + CRUD only. Variants are stored, listed,
 * and can be marked baseline / shadow / promoted / archived. The
 * actual A/B routing (which variant a given review uses) and the
 * statistical winner-selection logic land in a follow-up sprint
 * once Sprint D telemetry is mature enough to feed it.
 *
 * Operator workflow once activated:
 *   1. POST /admin/prompt-variants  → register a variant (status: inactive)
 *   2. POST /admin/prompt-variants/:id/activate-shadow
 *      → flip to 'shadow', traffic starts including it as treatment
 *   3. (auto) GET /admin/prompt-evaluation
 *      → after N outcomes per variant, the route returns a candidate
 *      winner with a confidence interval; operator reviews + decides.
 *   4. POST /admin/prompt-variants/:id/promote
 *      → flip to 'promoted', previous baseline → 'archived'.
 *
 * Step 1-2 ship today. Step 3-4 ship in the follow-up sprint.
 */
import type { Env } from "./env.js";

export type VariantStatus = "inactive" | "shadow" | "promoted" | "archived";

export interface PromptVariantRow {
  id: string;
  agent_id: string;
  variant_id: string;
  is_baseline: boolean;
  status: VariantStatus;
  description: string | null;
  system_prompt: string;
  created_at: string;
  promoted_at: string | null;
  archived_at: string | null;
}

export interface RegisterVariantInput {
  agent_id: string;
  variant_id: string;
  description?: string;
  system_prompt: string;
  is_baseline?: boolean;
}

async function shaHex8(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

export async function registerPromptVariant(
  env: Env,
  input: RegisterVariantInput,
): Promise<{ id: string }> {
  const id = `pv_${await shaHex8(`${input.agent_id}::${input.variant_id}`)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO prompt_variants
       (id, agent_id, variant_id, is_baseline, status, description, system_prompt, created_at)
     VALUES (?, ?, ?, ?, 'inactive', ?, ?, ?)`,
  )
    .bind(
      id,
      input.agent_id,
      input.variant_id,
      input.is_baseline ? 1 : 0,
      input.description ?? null,
      input.system_prompt,
      now,
    )
    .run();
  return { id };
}

export async function listPromptVariants(
  env: Env,
  filter: { agent_id?: string; status?: VariantStatus } = {},
): Promise<PromptVariantRow[]> {
  const conditions: string[] = ["removed_at IS NULL"];
  const binds: unknown[] = [];
  if (filter.agent_id) {
    conditions.push("agent_id = ?");
    binds.push(filter.agent_id);
  }
  if (filter.status) {
    conditions.push("status = ?");
    binds.push(filter.status);
  }
  const sql = `SELECT id, agent_id, variant_id, is_baseline, status, description,
                      system_prompt, created_at, promoted_at, archived_at
                 FROM prompt_variants
                WHERE ${conditions.join(" AND ")}
                ORDER BY agent_id ASC, created_at DESC
                LIMIT 200`;
  const stmt = env.DB.prepare(sql);
  const r = binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
  const rows = (r.results ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    agent_id: String(row.agent_id),
    variant_id: String(row.variant_id),
    is_baseline: Number(row.is_baseline ?? 0) === 1,
    status: row.status as VariantStatus,
    description: row.description === null || row.description === undefined ? null : String(row.description),
    system_prompt: String(row.system_prompt),
    created_at: String(row.created_at),
    promoted_at: row.promoted_at === null || row.promoted_at === undefined ? null : String(row.promoted_at),
    archived_at: row.archived_at === null || row.archived_at === undefined ? null : String(row.archived_at),
  }));
}

export async function setVariantStatus(
  env: Env,
  id: string,
  newStatus: VariantStatus,
): Promise<boolean> {
  const now = new Date().toISOString();
  let sql = `UPDATE prompt_variants SET status = ? WHERE id = ? AND removed_at IS NULL`;
  if (newStatus === "promoted") {
    sql = `UPDATE prompt_variants SET status = ?, promoted_at = ? WHERE id = ? AND removed_at IS NULL`;
  } else if (newStatus === "archived") {
    sql = `UPDATE prompt_variants SET status = ?, archived_at = ? WHERE id = ? AND removed_at IS NULL`;
  }
  const stmt = env.DB.prepare(sql);
  const r =
    newStatus === "promoted" || newStatus === "archived"
      ? await stmt.bind(newStatus, now, id).run()
      : await stmt.bind(newStatus, id).run();
  return (r.meta?.changes ?? 0) > 0;
}

export interface RecordOutcomeInput {
  variant_pk: string;
  agent_id: string;
  review_id: string;
  verdict?: "approve" | "rework" | "reject";
  blocker_count?: number;
  cost_usd?: number;
  latency_ms?: number;
}

/**
 * Record a per-review outcome for a variant. Future Sprint will write
 * one row per (variant, review) pair; today this is exposed for callers
 * (CLI report-back, /saas/review) that want to start collecting data
 * before A/B routing turns on.
 */
export async function recordVariantOutcome(env: Env, input: RecordOutcomeInput): Promise<void> {
  const id = `pvo_${await shaHex8(`${input.variant_pk}::${input.review_id}::${Date.now()}`)}`;
  await env.DB.prepare(
    `INSERT INTO prompt_variant_outcomes
       (id, variant_pk, agent_id, review_id, verdict, blocker_count, cost_usd, latency_ms, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.variant_pk,
      input.agent_id,
      input.review_id,
      input.verdict ?? null,
      input.blocker_count ?? null,
      input.cost_usd ?? null,
      input.latency_ms ?? null,
      new Date().toISOString(),
    )
    .run()
    .catch(() => undefined);
}

/**
 * v0.16.17 — Sprint E5 (shadow scaffold): agent self-spawning detector.
 *
 * Today's scope:
 *   1. Detect domain emergence — scan classified-as-'other' user_feedback
 *      rows in a recent window for clusters of similar wording / file-
 *      type hints that don't fit any current agent's lane.
 *   2. When ≥THRESHOLD rows form a cluster (loose: shared keywords),
 *      ask Haiku to synthesize a candidate {agent_id, display_name,
 *      domain_hint, system_prompt} for that domain.
 *   3. Insert into spawned_agents with status='shadow'. NEVER touches
 *      user-visible verdicts.
 *
 * Manual graduation (POST /admin/spawned-agents/:id/promote) is the
 * only path from shadow → promoted. Once promoted, a follow-up sprint
 * will wire the CLI's buildAgent factory to spawn these agents into
 * the council. Today's commit ships only the detection + storage.
 *
 * Cost: one Haiku call per emerged cluster per pass × ~$0.0001 = ~free.
 * Cron runs weekly so even a busy month wouldn't exceed pennies.
 *
 * Threshold + window are intentionally generous (3 rows / 60 days)
 * because the alternative — false-negative on a real new domain —
 * leaves the council blind to it.
 */
import type { Env } from "./env.js";

const SPAWNER_MODEL = "claude-haiku-4-5";
const SPAWNER_TIMEOUT_MS = 8_000;
const EMERGENCE_THRESHOLD = 3;       // classified-as-other rows in cluster
const WINDOW_DAYS = 60;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

interface OtherFeedbackRow {
  id: string;
  what_user_wanted: string;
  what_we_produced: string;
  reasoning: string | null;
  domain: string;
}

interface SpawnedAgentSpec {
  agent_id: string;
  display_name: string;
  domain_hint: string;
  system_prompt: string;
  base_agent_id: string | null;
  emergence_signal: string;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

const SPAWN_PROMPT = `You inspect a cluster of user-reported feedback rows that conclave's classifier put in category="other" (no existing agent specialty fits). Your job: decide whether this cluster represents a coherent NEW domain that warrants spawning a dedicated review agent, and if so, draft the agent's identity + system prompt.

Output ONE JSON object — no prose, no markdown fences:
{
  "spawn": <true|false>,
  "agent_id": "<lowercase-kebab, e.g. k8s-manifest, graphql-schema, rust-borrow>",
  "display_name": "<3-5 words, Title Case>",
  "domain_hint": "<one sentence: what does this agent specialize in?>",
  "base_agent_id": "<closest existing agent: claude | openai | gemini | design | null>",
  "emergence_signal": "<one sentence: WHY this cluster looks coherent + actionable>",
  "system_prompt": "<the full system prompt this new agent should use; ~10-30 lines, professional, in the SAME voice as the existing agents (You are a senior reviewer on a multi-agent council for Conclave AI...). Reference the specific domain. Make it concrete: what to flag, what to NOT flag.>"
}

Spawn criteria:
- spawn: true only when the cluster is COHERENT (rows share a real domain, not just random "other" misses) AND the domain isn't already covered (claude/openai/gemini handle code; design handles UI).
- spawn: false when rows are noise, miscategorizations, or already covered.

If spawn=false, omit the other fields or leave them empty strings; the caller will skip insertion.`;

async function callHaiku(env: Env, system: string, user: string): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SPAWNER_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SPAWNER_MODEL,
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as AnthropicResponse;
    return j.content?.[0]?.text ?? "";
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function parseSpawnSpec(text: string): SpawnedAgentSpec | { spawn: false } | null {
  try {
    const stripped = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    const obj = JSON.parse(stripped) as Record<string, unknown>;
    if (obj.spawn !== true) return { spawn: false };
    if (
      typeof obj.agent_id !== "string" ||
      typeof obj.display_name !== "string" ||
      typeof obj.domain_hint !== "string" ||
      typeof obj.system_prompt !== "string"
    ) {
      return null;
    }
    const baseRaw = obj.base_agent_id;
    const base_agent_id =
      typeof baseRaw === "string" && ["claude", "openai", "gemini", "design"].includes(baseRaw)
        ? baseRaw
        : null;
    return {
      agent_id: String(obj.agent_id).slice(0, 64),
      display_name: String(obj.display_name).slice(0, 100),
      domain_hint: String(obj.domain_hint).slice(0, 280),
      system_prompt: String(obj.system_prompt).slice(0, 8_000),
      base_agent_id,
      emergence_signal: typeof obj.emergence_signal === "string" ? obj.emergence_signal.slice(0, 280) : "",
    };
  } catch {
    return null;
  }
}

async function shaHex8(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

export interface SpawnerRunResult {
  scanned_other_rows: number;
  spawn_attempted: boolean;
  spawn_succeeded: boolean;
  spawned_agent_id?: string;
  reason?: string;
}

/**
 * One pass. Today simplified: ALL classified-as-'other' rows in the
 * window are passed as one cluster (no sub-clustering). This is enough
 * to ship — Haiku decides whether they cohere. Future passes can add
 * keyword/embedding clustering to fan into multiple candidate spawns
 * per pass.
 */
export async function runAgentSpawner(env: Env): Promise<SpawnerRunResult> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

  // Pull recent classified-as-other rows.
  const rowsRes = await env.DB.prepare(
    `SELECT id, what_user_wanted, what_we_produced, reasoning, domain
       FROM user_feedback
      WHERE removed_at IS NULL
        AND status = 'classified'
        AND category = 'other'
        AND created_at >= ?
      ORDER BY created_at DESC LIMIT 30`,
  )
    .bind(cutoff)
    .all<OtherFeedbackRow>();
  const rows = rowsRes.results ?? [];
  if (rows.length < EMERGENCE_THRESHOLD) {
    return {
      scanned_other_rows: rows.length,
      spawn_attempted: false,
      spawn_succeeded: false,
      reason: "below_threshold",
    };
  }

  const userMessage = [
    `Recent classified-as-other feedback rows (${rows.length} in last ${WINDOW_DAYS} days):`,
    "",
    ...rows.map((r, i) => `--- row ${i + 1} (${r.domain}) ---\nwanted: ${r.what_user_wanted}\nproduced: ${r.what_we_produced}${r.reasoning ? `\nclassifier reason: ${r.reasoning}` : ""}`),
  ].join("\n");

  const raw = await callHaiku(env, SPAWN_PROMPT, userMessage);
  if (!raw) {
    return {
      scanned_other_rows: rows.length,
      spawn_attempted: true,
      spawn_succeeded: false,
      reason: "haiku_failed",
    };
  }
  const parsed = parseSpawnSpec(raw);
  if (!parsed || ("spawn" in parsed && parsed.spawn === false)) {
    return {
      scanned_other_rows: rows.length,
      spawn_attempted: true,
      spawn_succeeded: false,
      reason: "spawn_declined_by_haiku",
    };
  }

  const spec = parsed as SpawnedAgentSpec;

  // Idempotency: if agent_id already exists (UNIQUE), skip insertion.
  const existing = await env.DB.prepare(
    `SELECT 1 as n FROM spawned_agents WHERE agent_id = ? AND removed_at IS NULL`,
  )
    .bind(spec.agent_id)
    .first<{ n: number }>();
  if (existing) {
    return {
      scanned_other_rows: rows.length,
      spawn_attempted: true,
      spawn_succeeded: false,
      reason: "agent_id_already_exists",
      spawned_agent_id: spec.agent_id,
    };
  }

  const id = `sa_${await shaHex8(spec.agent_id)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO spawned_agents
       (id, agent_id, display_name, domain_hint, emergence_signal,
        trigger_feedback_ids, system_prompt, base_agent_id, status, spawned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'shadow', ?)`,
  )
    .bind(
      id,
      spec.agent_id,
      spec.display_name,
      spec.domain_hint,
      spec.emergence_signal,
      JSON.stringify(rows.map((r) => r.id)),
      spec.system_prompt,
      spec.base_agent_id,
      now,
    )
    .run();

  return {
    scanned_other_rows: rows.length,
    spawn_attempted: true,
    spawn_succeeded: true,
    spawned_agent_id: spec.agent_id,
  };
}

// --- Reader / mutator helpers used by routes ---------------------------

export interface SpawnedAgentRow {
  id: string;
  agent_id: string;
  display_name: string;
  domain_hint: string;
  emergence_signal: string | null;
  base_agent_id: string | null;
  status: "shadow" | "promoted" | "archived";
  spawned_at: string;
  promoted_at: string | null;
  archived_at: string | null;
}

export async function listSpawnedAgents(
  env: Env,
  status: "shadow" | "promoted" | "archived" | null,
): Promise<SpawnedAgentRow[]> {
  const where = status
    ? `WHERE removed_at IS NULL AND status = ?`
    : `WHERE removed_at IS NULL`;
  const stmt = env.DB.prepare(
    `SELECT id, agent_id, display_name, domain_hint, emergence_signal,
            base_agent_id, status, spawned_at, promoted_at, archived_at
       FROM spawned_agents
       ${where}
       ORDER BY spawned_at DESC LIMIT 100`,
  );
  const r = await (status ? stmt.bind(status).all() : stmt.all());
  const rows = (r.results ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    agent_id: String(row.agent_id),
    display_name: String(row.display_name),
    domain_hint: String(row.domain_hint),
    emergence_signal: row.emergence_signal === null || row.emergence_signal === undefined ? null : String(row.emergence_signal),
    base_agent_id: row.base_agent_id === null || row.base_agent_id === undefined ? null : String(row.base_agent_id),
    status: row.status as SpawnedAgentRow["status"],
    spawned_at: String(row.spawned_at),
    promoted_at: row.promoted_at === null || row.promoted_at === undefined ? null : String(row.promoted_at),
    archived_at: row.archived_at === null || row.archived_at === undefined ? null : String(row.archived_at),
  }));
}

export async function setSpawnedAgentStatus(
  env: Env,
  id: string,
  newStatus: "shadow" | "promoted" | "archived",
): Promise<boolean> {
  const now = new Date().toISOString();
  let sql = `UPDATE spawned_agents SET status = ? WHERE id = ? AND removed_at IS NULL`;
  if (newStatus === "promoted") {
    sql = `UPDATE spawned_agents SET status = ?, promoted_at = ? WHERE id = ? AND removed_at IS NULL`;
  } else if (newStatus === "archived") {
    sql = `UPDATE spawned_agents SET status = ?, archived_at = ? WHERE id = ? AND removed_at IS NULL`;
  }
  const stmt = env.DB.prepare(sql);
  const r =
    newStatus === "promoted" || newStatus === "archived"
      ? await stmt.bind(newStatus, now, id).run()
      : await stmt.bind(newStatus, id).run();
  return (r.meta?.changes ?? 0) > 0;
}

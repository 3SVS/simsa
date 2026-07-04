/**
 * D1 helpers for workspace persistence.
 * All operations are best-effort — callers .catch(() => undefined) them
 * so D1 failures never crash the user-facing flow.
 */
import type { Env } from "../env.js";

function randId(prefix: string): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${r}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DbProject = {
  id: string;
  userKey: string;
  title: string;
  idea: string;
  understood: unknown;
  productSpec: unknown;
  items: unknown;
  /** builtWith — which AI tool(s) built the app (per-agent moat tag). */
  builtWith: unknown;
  /** entry_path — which branch the project entered through ("idea"|"code"|"spec"). */
  entryPath: string | null;
  /** topic_tags — structured market-map classification (domain/pattern/…). */
  topicTags: unknown;
  /** acquisition — where/how the user arrived ({ source, ... }). */
  acquisition: unknown;
  createdAt: string;
  updatedAt: string;
};

export type DbCheckRun = {
  id: string;
  projectId: string;
  source: string;
  result: unknown;
  createdAt: string;
};

export type DbFixSuggestion = {
  id: string;
  projectId: string;
  itemId: string;
  status: string;
  suggestion: unknown;
  createdAt: string;
};

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function upsertProject(
  env: Env,
  input: {
    id?: string;
    userKey: string;
    title: string;
    idea: string;
    understood: unknown;
    productSpec: unknown;
    items: unknown;
    builtWith?: unknown;
    entryPath?: string | null;
    topicTags?: unknown;
    acquisition?: unknown;
  },
): Promise<string> {
  const id = input.id ?? randId("wsp");
  const now = new Date().toISOString();
  // Security hardening: the DO UPDATE only fires when the existing row belongs
  // to the same user_key — a client-supplied id can never overwrite another
  // user's project. The route ALSO pre-checks and returns 409; this WHERE
  // clause is defense-in-depth for any other caller of this helper.
  //
  // Capture-once P1 fields (built_with_json / entry_path / acquisition_json)
  // are STICKY on update: a re-save that omits them (sends null) keeps the
  // stored value instead of wiping it. These are collected once at entry and
  // are NOT retroactively recoverable — a document-intake or checklist re-save
  // must never erase them. An explicit non-null value still overwrites.
  await env.DB.prepare(
    `INSERT INTO workspace_projects
       (id, user_key, title, idea, understood_json, product_spec_json, items_json, built_with_json, entry_path, topic_tags_json, acquisition_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       idea = excluded.idea,
       understood_json = excluded.understood_json,
       product_spec_json = excluded.product_spec_json,
       items_json = excluded.items_json,
       built_with_json = CASE
         WHEN excluded.built_with_json IS NULL OR excluded.built_with_json = 'null'
         THEN workspace_projects.built_with_json ELSE excluded.built_with_json END,
       entry_path = COALESCE(excluded.entry_path, workspace_projects.entry_path),
       topic_tags_json = excluded.topic_tags_json,
       acquisition_json = CASE
         WHEN excluded.acquisition_json IS NULL OR excluded.acquisition_json = 'null'
         THEN workspace_projects.acquisition_json ELSE excluded.acquisition_json END,
       updated_at = excluded.updated_at
     WHERE workspace_projects.user_key = excluded.user_key`,
  )
    .bind(
      id,
      input.userKey,
      input.title,
      input.idea,
      JSON.stringify(input.understood),
      JSON.stringify(input.productSpec),
      JSON.stringify(input.items),
      JSON.stringify(input.builtWith ?? null),
      input.entryPath ?? null,
      JSON.stringify(input.topicTags ?? null),
      JSON.stringify(input.acquisition ?? null),
      now,
      now,
    )
    .run();
  return id;
}

export async function getProject(env: Env, id: string): Promise<DbProject | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_key, title, idea, understood_json, product_spec_json, items_json, built_with_json, entry_path, topic_tags_json, acquisition_json, created_at, updated_at
     FROM workspace_projects WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      user_key: string;
      title: string;
      idea: string;
      understood_json: string;
      product_spec_json: string;
      items_json: string;
      built_with_json: string | null;
      entry_path: string | null;
      topic_tags_json: string | null;
      acquisition_json: string | null;
      created_at: string;
      updated_at: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    userKey: row.user_key,
    title: row.title,
    idea: row.idea,
    understood: safeJson(row.understood_json),
    productSpec: safeJson(row.product_spec_json),
    items: safeJson(row.items_json),
    builtWith: safeJson(row.built_with_json ?? "null"),
    entryPath: row.entry_path ?? null,
    topicTags: safeJson(row.topic_tags_json ?? "null"),
    acquisition: safeJson(row.acquisition_json ?? "null"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Ownership-checked project fetch. Returns the project row ONLY when it exists
 * AND its user_key matches the caller's userKey — otherwise null. Routes must
 * respond 404 { ok:false, error:"not_found" } on null (a single response for
 * both "missing" and "not owned", so project ids can't be probed).
 */
export async function getOwnedProject(
  env: Env,
  id: string,
  userKey: string,
): Promise<DbProject | null> {
  if (!id || !userKey) return null;
  const project = await getProject(env, id);
  if (!project || project.userKey !== userKey) return null;
  return project;
}

/** List a user's projects (lightweight summary, newest first). userKey-scoped. */
export async function listProjectsByUser(
  env: Env,
  userKey: string,
  limit = 100,
): Promise<Array<{ id: string; title: string; idea: string; createdAt: string; updatedAt: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, idea, created_at, updated_at
     FROM workspace_projects WHERE user_key = ?
     ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(userKey, limit)
    .all<{ id: string; title: string; idea: string; created_at: string; updated_at: string }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    idea: r.idea,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ─── Check runs ───────────────────────────────────────────────────────────────

export async function saveCheckRun(
  env: Env,
  projectId: string,
  source: string,
  result: unknown,
): Promise<string> {
  const id = randId("chk");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_check_runs (id, project_id, source, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, projectId, source, JSON.stringify(result), now)
    .run();
  return id;
}

export async function getLatestCheckRun(
  env: Env,
  projectId: string,
): Promise<DbCheckRun | null> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, source, result_json, created_at
     FROM workspace_check_runs WHERE project_id = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{
      id: string;
      project_id: string;
      source: string;
      result_json: string;
      created_at: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    result: safeJson(row.result_json),
    createdAt: row.created_at,
  };
}

// ─── Fix suggestions ──────────────────────────────────────────────────────────

export async function saveFixSuggestion(
  env: Env,
  projectId: string,
  itemId: string,
  suggestion: unknown,
): Promise<string> {
  const id = randId("fix");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_fix_suggestions (id, project_id, item_id, status, suggestion_json, created_at)
     VALUES (?, ?, ?, 'draft', ?, ?)`,
  )
    .bind(id, projectId, itemId, JSON.stringify(suggestion), now)
    .run();
  return id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

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
  },
): Promise<string> {
  const id = input.id ?? randId("wsp");
  const now = new Date().toISOString();
  // Security hardening: the DO UPDATE only fires when the existing row belongs
  // to the same user_key — a client-supplied id can never overwrite another
  // user's project. The route ALSO pre-checks and returns 409; this WHERE
  // clause is defense-in-depth for any other caller of this helper.
  await env.DB.prepare(
    `INSERT INTO workspace_projects
       (id, user_key, title, idea, understood_json, product_spec_json, items_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       idea = excluded.idea,
       understood_json = excluded.understood_json,
       product_spec_json = excluded.product_spec_json,
       items_json = excluded.items_json,
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
      now,
      now,
    )
    .run();
  return id;
}

export async function getProject(env: Env, id: string): Promise<DbProject | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_key, title, idea, understood_json, product_spec_json, items_json, created_at, updated_at
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

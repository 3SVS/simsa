/**
 * D1 helpers for workspace persistence.
 * All operations are best-effort — callers .catch(() => undefined) them
 * so D1 failures never crash the user-facing flow.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { PROJECT_DELETED, buildJobDeleteBatchStatements, stopActiveBuildJobsForProject } from "./build-job-db.js";
import { teardownHostedAppsForProject } from "./hosted-app-teardown.js";

/**
 * 프로젝트 행이 아직 있나(가벼운 존재 확인 — 지시서 JSON을 읽지 않는다). 빌드 산출물 라우트·배포 파이프라인이 단계마다 부른다
 * (PR #569 S3 검증 결함 1: 삭제된 프로젝트의 빌드가 push·배포·done까지 가지 않게).
 */
export async function projectExists(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM workspace_projects WHERE id = ?`).bind(id).first();
  return row !== null && row !== undefined;
}

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
  /** SI 티어 A1: T0 개발 지시서(dev_spec_json). 없으면 null. */
  devSpec: unknown;
  /** C4a (0069): 생성 시점 국가 코드(ISO-3166, request.cf.country). capture-once. null = 미기록. */
  regionAtCreate: string | null;
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

/**
 * Dashboard example-fixture project ids (read-only demos shipped to every
 * browser with the same fixed id). Server-side writes on these are rejected:
 * the first-writer-owns guard would otherwise hand one user global ownership
 * of the shared id and 404 everyone else's project-scoped calls on it.
 * Keep in sync with apps/dashboard/src/lib/mock-data.ts MOCK_PROJECTS.
 */
export const EXAMPLE_PROJECT_IDS: ReadonlySet<string> = new Set(["proj_mjx1"]);

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
    /** C4a (0069): 생성 요청의 국가 코드. 재저장은 덮어쓰지 않는다(capture-once, COALESCE). */
    regionAtCreate?: string | null;
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
       (id, user_key, title, idea, understood_json, product_spec_json, items_json, built_with_json, entry_path, topic_tags_json, acquisition_json, region_at_create, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       region_at_create = COALESCE(workspace_projects.region_at_create, excluded.region_at_create),
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
      input.regionAtCreate ?? null,
      now,
      now,
    )
    .run();
  return id;
}

export async function getProject(env: Env, id: string): Promise<DbProject | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_key, title, idea, understood_json, product_spec_json, items_json, built_with_json, entry_path, topic_tags_json, acquisition_json, dev_spec_json, region_at_create, created_at, updated_at
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
      dev_spec_json: string | null;
      region_at_create: string | null;
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
    devSpec: row.dev_spec_json ? safeJson(row.dev_spec_json) : null,
    regionAtCreate: typeof row.region_at_create === "string" && row.region_at_create ? row.region_at_create : null,
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

/**
 * Project-scoped tables that a project delete must cascade. Every entry has a
 * genuine `project_id` column (verified against the migrations). USER-scoped
 * tables are deliberately EXCLUDED — deleting one project must never touch data
 * shared across a user's other projects:
 *   - workspace_github_connections / workspace_oauth_states  (user's GitHub auth)
 *   - workspace_credit_balances                              (user's credit wallet)
 *   - workspace_credit_ledger                                (financial audit trail)
 *   - workspace_notification_settings                        (user's chat wiring)
 * These are constant identifiers we control (never user input), so interpolating
 * them into the DELETE is injection-safe; the project id is always bound.
 */
const PROJECT_SCOPED_TABLES = [
  "workspace_items",
  "workspace_check_runs",
  "workspace_fix_suggestions",
  "builder_pack_outcomes",
  "workspace_project_repos",
  "workspace_project_pull_requests",
  "workspace_pr_review_runs",
  "workspace_pr_comments",
  "workspace_usage_events",
  "workspace_notifications",
  "workspace_agent_benchmarks",
  "workspace_agent_experiments",
  "workspace_evolution_action_packs",
  "workspace_agent_workflow_records",
  "project_sources",
  "workspace_visual_checks",
  "workspace_repair_jobs",
  "workspace_feedback",
] as const;

/**
 * Hard-delete a project and every project-scoped row + R2 object it owns.
 * The CALLER must confirm ownership first (getOwnedProject) — this helper does
 * not re-check, it just executes the cascade for the given id.
 *
 * Order matters: R2 keys are read BEFORE their rows are deleted; the whole D1
 * cascade runs as one batched transaction so a failure leaves nothing partial.
 * R2 deletes are best-effort (an orphaned object is storage cost, not a
 * correctness or privacy leak once its DB row is gone).
 */
/**
 * Every R2 key under `prefix`, following the truncation cursor. R2 caps a list
 * page at 1000 objects, so a project with more evidence than that would leak
 * the tail if we only read the first page.
 */
async function listKeysByPrefix(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const obj of page.objects) keys.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function deleteProject(env: Env, id: string, userKey: string, opts: { fetch?: FetchLike } = {}): Promise<void> {
  // 0. PR #569 S3 검증 결함 1: 이 프로젝트의 활성 빌드 잡을 **먼저** 멈춘다(failed(<단계>, project_deleted)). 그 뒤에 오는
  //    산출물 업로드·진행 콜백·LLM 프록시 호출은 활성 잡이 없어 R2에 쓰지도, push·배포하지도 못한다(산출물 라우트와 Worker 배포
  //    파이프라인도 단계마다 프로젝트 존재·잡 활성을 다시 본다). 아래 R2 청소보다 먼저여야 청소 뒤에 새 사본이 생기지 않는다.
  try {
    await stopActiveBuildJobsForProject(env, id, PROJECT_DELETED);
  } catch (err) {
    console.error("[workspace/db deleteProject] build-job stop failed:", err);
  }

  // 1. Collect R2 evidence keys before the rows referencing them are deleted:
  //    uploaded documents (user content — must be removed) + visual-check shots.
  const r2Keys = new Set<string>();
  try {
    const docs = await env.DB.prepare(
      `SELECT reference FROM project_sources WHERE project_id = ? AND type = 'document' AND reference != 'pending'`,
    )
      .bind(id)
      .all<{ reference: string }>();
    for (const row of docs.results ?? []) if (row.reference) r2Keys.add(row.reference);
  } catch (err) {
    console.error("[workspace/db deleteProject] source R2 scan failed:", err);
  }

  // Visual-check evidence is NOT enumerable from D1: the upload writes the full
  // key `checks/{userKey}/{projectId}/{runId}/{name}` but records only the
  // relative `name` (the read path in workspace-visual-checks.ts reconstructs
  // the rest). Feeding those names straight to R2.delete() deleted keys that
  // never existed — and R2 resolves a delete of a missing key successfully, so
  // it failed silently and every screenshot/video survived every project
  // delete.
  //
  // Enumerate by prefix instead of rebuilding keys from the manifest. Both
  // project-scoped prefixes embed `{userKey}/{projectId}/`, so this is exactly
  // scoped — it cannot reach another user's or another project's objects — and
  // it also sweeps objects the manifest never knew about (a `put` that landed
  // while its D1 append failed, or a document stuck at reference='pending').
  if (env.EVIDENCE && userKey) {
    for (const prefix of [`checks/${userKey}/${id}/`, `docs/${userKey}/${id}/`]) {
      try {
        for (const k of await listKeysByPrefix(env.EVIDENCE, prefix)) r2Keys.add(k);
      } catch (err) {
        console.error(`[workspace/db deleteProject] R2 prefix scan failed (${prefix}):`, err);
      }
    }
  }
  // B-5b S3: 빌드 산출물(유저 앱의 소스·번들) `builds/<jobId>/` — 키에 프로젝트가 없으니 이 프로젝트의 빌드 잡 id로 접두를
  // 만든다(잡 행은 D1 cascade 전에 읽는다). 학습 데이터 사본(events/…)은 여전히 이 범위 밖이다(방침 §1·§3의 예외 문장).
  if (env.EVIDENCE) {
    try {
      const jobs = await env.DB.prepare(`SELECT id FROM build_jobs WHERE project_id = ?`).bind(id).all<{ id: string }>();
      for (const row of jobs.results ?? []) {
        if (typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id)) continue;
        const prefix = `builds/${row.id}/`;
        try {
          for (const k of await listKeysByPrefix(env.EVIDENCE, prefix)) r2Keys.add(k);
        } catch (err) {
          console.error(`[workspace/db deleteProject] R2 prefix scan failed (${prefix}):`, err);
        }
      }
    } catch (err) {
      console.error("[workspace/db deleteProject] build-job scan failed:", err);
    }
  }

  // 2. Cascade-delete all D1 rows in one transaction FIRST. Experiment
  //    candidates key by experiment_id, so they go first via a subquery (before
  //    the experiment rows they reference are deleted). The project row goes last.
  //    D1 before R2 is deliberate: if this batch throws nothing is deleted (clean
  //    retry, no half-state); once it commits, the rows that referenced the R2
  //    objects are already gone, so a failed R2 delete can only orphan storage —
  //    never leave a live row pointing at a deleted object.
  const stmts = [
    env.DB.prepare(
      `DELETE FROM workspace_agent_experiment_candidates
       WHERE experiment_id IN (SELECT id FROM workspace_agent_experiments WHERE project_id = ?)`,
    ).bind(id),
    ...PROJECT_SCOPED_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE project_id = ?`).bind(id)),
    // 0070 AI usage ledger: kept for cost accounting, but UNLINKED from the
    // project and the person in the same batch — the privacy policy §1 promise
    // is that deleting a project removes its records' link to you. Rows keep
    // only vendor/model/tokens/cost/time (no content ever lived here).
    env.DB.prepare(
      `UPDATE llm_usage SET project_id = NULL, user_key_hash = NULL, job_id = NULL WHERE project_id = ?`,
    ).bind(id),
    // B-5b S3 검증 결함 2: 빌드 타임라인은 지우고, 빌드 잡 행은 호스팅 자원(공개 Worker·프로젝트 D1·조직 저장소)의 포인터로
    // 남기되 사람과의 연결을 끊는다(user_key = '' — 호스팅 정리의 삭제 표시). 행은 아래 5단계가 자원을 다 지운 뒤 지운다.
    ...buildJobDeleteBatchStatements(env, id, new Date().toISOString()),
    env.DB.prepare(`DELETE FROM workspace_projects WHERE id = ?`).bind(id),
  ];
  await env.DB.batch(stmts);

  // 3. Delete R2 objects (best-effort, in parallel) — now that no DB row refers
  //    to them, an orphan here is pure storage cost, not a dangling reference.
  if (env.EVIDENCE && r2Keys.size) {
    await Promise.all(
      [...r2Keys].map((k) =>
        env.EVIDENCE!.delete(k).catch((err) => {
          // Still best-effort, but no longer silent: an orphan is pure storage
          // cost, and the only way we learn it happened is this line.
          console.error(`[workspace/db deleteProject] R2 delete failed (${k}):`, err);
        }),
      ),
    );
  }

  // 5. B-5b S3 검증 결함 2: 빌드가 만든 호스팅 자원 — 공개 유저 Worker(<slug>.<root>) · 프로젝트 D1(앱 최종 사용자 데이터) ·
  //    호스팅 조직 저장소. 운영 자격은 Worker에만(hosted-app-teardown.ts). 실패하면 잡 행이 남고 5분 크론이 다시 시도한다
  //    (프로젝트 삭제 자체는 이미 끝났다 — 사용자에게 실패로 돌려주지 않는다).
  try {
    await teardownHostedAppsForProject(env, id, opts.fetch ?? (fetch.bind(globalThis) as FetchLike));
  } catch (err) {
    console.error("[workspace/db deleteProject] hosted app teardown failed:", err);
  }
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

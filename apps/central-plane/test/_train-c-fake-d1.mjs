/**
 * _train-c-fake-d1.mjs — Train C 테스트 공용 D1 모크 (seam에서 모크, 네트워크 없음).
 *
 * `node --test test/*.test.mjs` 글롭에 잡히지 않는 이름(밑줄 + `.mjs`)이다.
 *
 * 테이블별 배열/Map을 들고, 라우트·DB 헬퍼가 발행하는 SQL 문자열 패턴으로 분기한다.
 * 위치 기반 destructuring은 **현재 src의 bind 순서**와 일치시킨다(0069 컬럼 포함).
 * 모든 쓰기는 `writes`에 `{ sql, bound }`로도 남겨 컬럼 존재를 직접 확인할 수 있다.
 */

export function makeFakeD1({
  projects = new Map(),
  sources = [],
  checks = [],
  jobs = [],
  repos = [],
  connections = [],
  events = [],
} = {}) {
  const writes = [];
  const state = { projects, sources, checks, jobs, repos, connections, events, writes };

  function handler(sql, args) {
    return {
      async run() {
        writes.push({ sql, bound: args });

        // ── workspace_projects (upsertProject) ───────────────────────────────
        if (sql.includes("INSERT INTO workspace_projects")) {
          const [
            id, user_key, title, idea, understood_json, product_spec_json, items_json,
            built_with_json, entry_path, topic_tags_json, acquisition_json, region_at_create, created_at, updated_at,
          ] = args;
          const prev = projects.get(id);
          if (prev && prev.user_key !== user_key) return { meta: { changes: 0 } };
          projects.set(id, {
            ...(prev ?? {}),
            id, user_key, title, idea, understood_json, product_spec_json, items_json,
            built_with_json, entry_path, topic_tags_json, acquisition_json,
            region_at_create: prev?.region_at_create ?? region_at_create ?? null,
            created_at: prev?.created_at ?? created_at, updated_at,
          });
          return { meta: { changes: 1 } };
        }

        // ── workspace_visual_checks ──────────────────────────────────────────
        if (sql.includes("INSERT INTO workspace_visual_checks") && sql.includes("'queued', 'container'")) {
          const [id, project_id, user_key, target_url, intent, locale, region, envelope_json, source_check_id, created_at, updated_at] = args;
          checks.push({
            id, project_id, user_key, target_url, intent,
            decision: "Not Judged", works: null, status: "queued", executor: "container",
            report_json: "{}", agent_prompt: null, evidence_keys_json: "[]", locale: locale ?? null,
            region: region ?? null, envelope_json: envelope_json ?? null, finding_codes_json: null,
            user_verdict: null, user_verdict_at: null, source_check_id: source_check_id ?? null,
            created_at, updated_at,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes("workspace_visual_checks") && sql.includes("SET status = 'running'")) {
          const [updated_at, id] = args;
          const row = checks.find((r) => r.id === id && (r.status === "queued" || r.status === "running"));
          if (row) { row.status = "running"; row.updated_at = updated_at; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_visual_checks") && sql.includes("SET status = 'done'")) {
          const [decision, works, report_json, agent_prompt, finding_codes_json, updated_at, id] = args;
          const row = checks.find((r) => r.id === id);
          if (row) Object.assign(row, { status: "done", decision, works, report_json, agent_prompt, finding_codes_json, updated_at });
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_visual_checks") && sql.includes("SET status = 'failed'")) {
          const [errJson, updated_at, id] = args;
          const row = checks.find((r) => r.id === id);
          if (row) {
            row.status = "failed"; row.decision = "Not Verified";
            if (row.report_json === "{}") row.report_json = errJson;
            row.updated_at = updated_at;
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_visual_checks") && sql.includes("SET user_verdict = ?")) {
          const [user_verdict, user_verdict_at, id] = args;
          const row = checks.find((r) => r.id === id);
          if (row) Object.assign(row, { user_verdict, user_verdict_at });
          return { meta: { changes: row ? 1 : 0 } };
        }

        // ── workspace_repair_jobs ────────────────────────────────────────────
        if (sql.includes("INSERT INTO workspace_repair_jobs")) {
          const [id, project_id, user_key, visual_check_id, repo_full_name, branch_name, env_cause, region, created_at, updated_at] = args;
          jobs.push({
            id, project_id, user_key, visual_check_id, repo_full_name,
            status: "queued", branch_name, pr_url: null, pr_number: null,
            env_cause, mode: null, changed_files: null, error: null,
            region: region ?? null, verify_check_id: null, resolved: null,
            created_at, updated_at,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'running'")) {
          const [updated_at, id] = args;
          const row = jobs.find((r) => r.id === id && (r.status === "queued" || r.status === "running"));
          if (row) { row.status = "running"; row.updated_at = updated_at; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'done'")) {
          const [pr_url, pr_number, branch_name, env_flag, mode, changed_files, mode_reason, updated_at, id] = args;
          const row = jobs.find((r) => r.id === id);
          if (row) {
            row.status = "done";
            row.pr_url = pr_url ?? row.pr_url; row.pr_number = pr_number ?? row.pr_number;
            row.branch_name = branch_name ?? row.branch_name;
            if (env_flag === 1) row.env_cause = 1;
            row.mode = mode ?? row.mode; row.changed_files = changed_files ?? row.changed_files;
            row.error = mode_reason ?? row.error; row.updated_at = updated_at;
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'failed'")) {
          const [error, updated_at, id] = args;
          const row = jobs.find((r) => r.id === id);
          if (row) { row.status = "failed"; row.error = error; row.updated_at = updated_at; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_repair_jobs") && sql.includes("SET verify_check_id = ?")) {
          const [verify_check_id, id] = args;
          const row = jobs.find((r) => r.id === id);
          if (row) row.verify_check_id = verify_check_id;
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (sql.includes("workspace_repair_jobs") && sql.includes("SET resolved = ?")) {
          const [resolved, verify_check_id] = args;
          let n = 0;
          for (const row of jobs) if (row.verify_check_id === verify_check_id) { row.resolved = resolved; n++; }
          return { meta: { changes: n } };
        }

        // ── workspace_usage_events ───────────────────────────────────────────
        if (sql.includes("INSERT INTO workspace_usage_events")) {
          const [id, user_key, project_id, event_type, metadata_json, created_at] = args;
          events.push({ id, user_key, project_id, event_type, metadata_json, created_at });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },

      async first() {
        if (sql.includes("FROM workspace_projects WHERE id = ?")) return projects.get(args[0]) ?? null;
        if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) {
          return sources.find((s) => s.id === args[0]) ?? null;
        }
        if (sql.includes("FROM workspace_visual_checks") && sql.includes("status IN ('queued', 'running')") && sql.includes("project_id = ?")) {
          return checks.find((r) => r.project_id === args[0] && (r.status === "queued" || r.status === "running")) ?? null;
        }
        if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE id = ?")) {
          return checks.find((r) => r.id === args[0]) ?? null;
        }
        if (sql.includes("FROM workspace_project_repos WHERE project_id = ?")) {
          return repos.find((r) => r.project_id === args[0]) ?? null;
        }
        if (sql.includes("FROM workspace_github_connections WHERE user_key = ?")) {
          return connections.find((r) => r.user_key === args[0]) ?? null;
        }
        if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE id = ?")) {
          return jobs.find((r) => r.id === args[0]) ?? null;
        }
        if (sql.includes("FROM workspace_repair_jobs") && sql.includes("status IN ('queued', 'running')")) {
          return jobs.find((r) => r.visual_check_id === args[0] && (r.status === "queued" || r.status === "running")) ?? null;
        }
        if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE visual_check_id = ?")) {
          const list = jobs.filter((r) => r.visual_check_id === args[0]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return list[0] ?? null;
        }
        return null;
      },

      async all() {
        if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id = ?")) {
          return { results: sources.filter((s) => s.project_id === args[0]) };
        }
        if (sql.includes("FROM workspace_usage_events") && sql.includes("event_type = ?")) {
          return { results: events.filter((e) => e.event_type === args[0] && e.created_at > args[1]) };
        }
        if (sql.includes("FROM workspace_visual_checks") && sql.includes("updated_at < ?")) {
          const [cutoff, limit] = args;
          return {
            results: checks
              .filter((r) => (r.status === "queued" || r.status === "running") && r.updated_at < cutoff)
              .slice(0, limit).map((r) => ({ id: r.id, status: r.status })),
          };
        }
        if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE project_id = ?")) {
          return { results: checks.filter((r) => r.project_id === args[0]) };
        }
        return { results: [] };
      },
    };
  }

  return {
    state,
    writes,
    _checks: checks,
    _jobs: jobs,
    _events: events,
    prepare(sql) {
      return {
        bind(...args) { return handler(sql, args); },
        run() { return handler(sql, []).run(); },
        first() { return handler(sql, []).first(); },
        all() { return handler(sql, []).all(); },
      };
    },
  };
}

export function projectRow(id, userKey, over = {}) {
  return {
    id, user_key: userKey, title: "t", idea: "i",
    understood_json: "{}", product_spec_json: "{}", items_json: "[]",
    built_with_json: null, entry_path: null, topic_tags_json: null, acquisition_json: null,
    dev_spec_json: null, region_at_create: null,
    created_at: "2026-09-27T00:00:00.000Z", updated_at: "2026-09-27T00:00:00.000Z",
    ...over,
  };
}

export function websiteSource(projectId, userKey, over = {}) {
  return {
    id: "psrc_web1", project_id: projectId, user_key: userKey, type: "website",
    reference: "https://golf-now.example.app/", label: null, content_type: null,
    size_bytes: null, created_at: "2026-09-27T00:00:00.000Z",
    ...over,
  };
}

export function checkRow(over = {}) {
  return {
    id: "wvc_orig", project_id: "proj_c", user_key: "uk_owner",
    target_url: "https://golf-now.example.app/courses", intent: "골퍼가 코스 상태를 확인할 수 있어야 한다",
    decision: "Needs Fix", works: 0, status: "done", executor: "container",
    report_json: JSON.stringify({ verdict: "작동 안 해요", findings: [] }), agent_prompt: "당신은 이 프로젝트의 코드를 수정하는 개발 에이전트입니다.",
    evidence_keys_json: "[]", locale: "ko",
    region: null, envelope_json: null, finding_codes_json: null,
    user_verdict: null, user_verdict_at: null, source_check_id: null,
    created_at: "2026-09-27T00:00:00.000Z", updated_at: "2026-09-27T00:00:00.000Z",
    ...over,
  };
}

/** Stub DurableObjectNamespace recording idFromName + fetch payloads (+ headers). */
export function makeDoStub(recorder, { status = 202 } = {}) {
  return {
    idFromName(name) { recorder.names.push(name); return { name }; },
    get() {
      return {
        async fetch(url, init) {
          recorder.calls.push({ url, body: JSON.parse(init.body), headers: init.headers ?? {} });
          return new Response(JSON.stringify({ status: "accepted" }), { status });
        },
      };
    },
  };
}

/** Build a Request the way the dashboard does, optionally with Cloudflare's `cf` edge object attached. */
export function makeRequest(path, { method = "POST", body, headers = {}, cf } = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(`http://localhost${path}`, init);
  if (cf) Object.defineProperty(req, "cf", { value: cf, enumerable: false });
  return req;
}

export async function send(app, env, path, opts) {
  const res = await app.fetch(makeRequest(path, opts), env);
  let json = null;
  try { json = await res.clone().json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

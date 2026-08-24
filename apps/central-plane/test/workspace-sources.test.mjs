/**
 * workspace-sources.test.mjs — Stage 261
 *
 * Unified project sources: website/github_repo JSON connect, document upload
 * to R2 (multipart), list, download proxy, delete. Ownership + validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const USER = "uk_owner";
const OTHER = "uk_intruder";
const PROJECT = "proj_src";

function makeDb({ projects = new Map(), sources = [] } = {}) {
  return {
    _sources: sources,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO project_sources")) {
              const [id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at] = args;
              sources.push({ id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE project_sources SET reference")) {
              const [reference, id] = args;
              const row = sources.find((s) => s.id === id);
              if (row) row.reference = reference;
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes("DELETE FROM project_sources")) {
              const idx = sources.findIndex((s) => s.id === args[0]);
              if (idx >= 0) sources.splice(idx, 1);
              return { meta: { changes: idx >= 0 ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            if (sql.includes("FROM workspace_projects WHERE id = ?")) {
              return projects.get(args[0]) ?? null;
            }
            if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) {
              return sources.find((s) => s.id === args[0]) ?? null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id = ?")) {
              return { results: sources.filter((s) => s.project_id === args[0]) };
            }
            return { results: [] };
          },
        };
      }
      return {
        bind(...args) { return handler(args); },
        run() { return handler([]).run(); },
        first() { return handler([]).first(); },
        all() { return handler([]).all(); },
      };
    },
  };
}

function makeProjectRow(id, userKey) {
  return {
    id,
    user_key: userKey,
    title: "t",
    idea: "i",
    understood_json: "{}",
    product_spec_json: "{}",
    items_json: "[]",
    created_at: "2026-07-02T00:00:00.000Z",
    updated_at: "2026-07-02T00:00:00.000Z",
  };
}

function makeR2() {
  const store = new Map();
  return {
    _store: store,
    async put(key, value, opts) { store.set(key, { value, opts }); },
    async get(key) {
      const hit = store.get(key);
      return hit ? { body: hit.value } : null;
    },
    async delete(key) { store.delete(key); },
  };
}

function makeEnv({ withR2 = true, projects, sources } = {}) {
  const env = {
    ENVIRONMENT: "test",
    DB: makeDb({ projects: projects ?? new Map([[PROJECT, makeProjectRow(PROJECT, USER)]]), sources }),
  };
  if (withR2) env.EVIDENCE = makeR2();
  return env;
}

async function req(env, method, path, body) {
  const app = createApp();
  const init = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${path}`, init), env);
  let json = null;
  try { json = await res.json(); } catch { /* binary */ }
  return { status: res.status, json };
}

// ─── JSON sources ─────────────────────────────────────────────────────────────

test("POST website source: 201 + persisted; list returns it", async () => {
  const env = makeEnv();
  const { status, json } = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "website", reference: "https://my-vibe-app.vercel.app/", label: "배포 앱",
  });
  assert.equal(status, 201);
  assert.equal(json.source.type, "website");

  const list = await req(env, "GET", `/workspace/projects/${PROJECT}/sources?userKey=${USER}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.sources.length, 1);
  assert.equal(list.json.sources[0].reference, "https://my-vibe-app.vercel.app/");
});

test("POST website: invalid URL rejected; github_repo: bad format rejected", async () => {
  const env = makeEnv();
  const bad = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "website", reference: "not-a-url",
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "invalid_url");

  const badRepo = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "github_repo", reference: "no-slash-here",
  });
  assert.equal(badRepo.status, 400);
  assert.equal(badRepo.json.error, "invalid_repo");

  const goodRepo = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "github_repo", reference: "seunghunbae-3svs/golf-now",
  });
  assert.equal(goodRepo.status, 201);
});

test("★github_repo: 브라우저에서 복사한 주소를 그대로 붙여넣어도 받는다 (Bae 2026-08-23)", async () => {
  // 종전엔 bare "owner/repo"만 받아 아래 형태들이 전부 invalid_repo로 거절됐다.
  // 사용자는 주소창에서 복사해 오지, owner/repo를 손으로 치지 않는다.
  const pasted = [
    "https://github.com/seunghunbae-3svs/golf-now",
    "https://github.com/seunghunbae-3svs/golf-now.git",
    "https://github.com/seunghunbae-3svs/golf-now/tree/main/src",
    "git@github.com:seunghunbae-3svs/golf-now.git",
  ];
  for (const reference of pasted) {
    const env = makeEnv();
    const res = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
      userKey: USER, type: "github_repo", reference,
    });
    assert.equal(res.status, 201, `거절되면 안 된다: ${reference}`);
    // 저장은 정규화된 하나의 형태로 — 같은 저장소가 형태만 달라 중복 행이 되지 않도록.
    assert.equal(res.json.source.reference, "seunghunbae-3svs/golf-now", reference);
  }
});

test("github_repo: GitHub가 아닌 호스트는 조용히 통과시키지 않는다", async () => {
  const env = makeEnv();
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "github_repo", reference: "https://gitlab.com/seunghunbae-3svs/golf-now",
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "invalid_repo");
});

test("★연결 응답에 도달성이 함께 온다 — 나중에 막지 말고 지금 말한다", async () => {
  const env = makeEnv();
  env.GH_APP_INSTALL_URL = "https://github.com/apps/x/installations/new";
  // 공개 저장소: 그대로 되고, 설치 링크는 주지 않는다(되는 사람에게 노이즈).
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ private: false }), { status: 200, headers: { "content-type": "application/json" } });
  const pub = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "github_repo", reference: "https://github.com/3SVS/simsa",
  });
  assert.equal(pub.status, 201);
  assert.equal(pub.json.reachability.state, "readable");
  assert.equal(pub.json.reachability.visibility, "public");
  assert.equal(pub.json.installUrl, undefined, "되는 저장소엔 설치 링크를 주지 않는다");
});

test("★안 보이는 저장소여도 저장은 되고, 그 자리에서 설치 경로를 준다", async () => {
  const env = makeEnv();
  env.GH_APP_INSTALL_URL = "https://github.com/apps/x/installations/new";
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "github_repo", reference: "https://github.com/3SVS/private-one",
  });
  assert.equal(res.status, 201, "★막지 않는다 — 연결은 성공이다");
  assert.equal(res.json.reachability.state, "needs_access");
  assert.equal(res.json.installUrl, "https://github.com/apps/x/installations/new");
  // 그리고 실제로 저장돼 있어야 한다.
  const list = await req(env, "GET", `/workspace/projects/${PROJECT}/sources?userKey=${USER}`);
  assert.equal(list.json.sources.some((s) => s.reference === "3SVS/private-one"), true);
});

test("★계측이 실패해도 연결은 성공한다 — 부가 정보가 기능을 깨지 않는다", async () => {
  const env = makeEnv();
  globalThis.fetch = async () => { throw new Error("network down"); };
  const res = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: USER, type: "github_repo", reference: "3SVS/simsa",
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.reachability.state, "unknown", "모른다고 말하지, 안 된다고 말하지 않는다");
  assert.equal(res.json.installUrl, undefined, "모르는 상태에서 설치를 권하지 않는다");
});

test("ownership: other user forbidden (403), unknown project 404", async () => {
  const env = makeEnv();
  const forbidden = await req(env, "POST", `/workspace/projects/${PROJECT}/sources`, {
    userKey: OTHER, type: "website", reference: "https://x.dev/",
  });
  assert.equal(forbidden.status, 403);

  const missing = await req(env, "GET", `/workspace/projects/proj_nope/sources?userKey=${USER}`);
  assert.equal(missing.status, 404);
});

// ─── Document upload ──────────────────────────────────────────────────────────

function formWith(file, userKey = USER, label) {
  const form = new FormData();
  form.set("userKey", userKey);
  if (label) form.set("label", label);
  form.set("file", file);
  return form;
}

test("POST document: uploads to R2 under docs/, row reference = R2 key", async () => {
  const env = makeEnv();
  const file = new File(["# PRD\n골프장 컨디션 앱"], "prd v2.md", { type: "text/markdown" });
  const { status, json } = await req(env, "POST", `/workspace/projects/${PROJECT}/sources/document`, formWith(file, USER, "PRD v2"));
  assert.equal(status, 201);
  assert.equal(json.source.type, "document");
  assert.ok(json.source.reference.startsWith(`docs/${USER}/${PROJECT}/`));
  assert.ok(json.source.reference.endsWith("prd_v2.md")); // sanitized filename
  assert.equal(env.EVIDENCE._store.size, 1);

  // download proxy round-trip
  const dl = await fetchRaw(env, `/workspace/projects/${PROJECT}/sources/${json.source.id}/file?userKey=${USER}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "text/markdown");
});

test("POST document: unsupported extension rejected; no R2 binding → 503", async () => {
  const env = makeEnv();
  const exe = new File(["MZ"], "malware.exe");
  const bad = await req(env, "POST", `/workspace/projects/${PROJECT}/sources/document`, formWith(exe));
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "unsupported_file_type");

  const noR2 = makeEnv({ withR2: false });
  const md = new File(["# hi"], "a.md");
  const blocked = await req(noR2, "POST", `/workspace/projects/${PROJECT}/sources/document`, formWith(md));
  assert.equal(blocked.status, 503);
  assert.equal(blocked.json.error, "evidence_storage_unconfigured");
});

test("DELETE document: removes row and R2 object; other user forbidden", async () => {
  const env = makeEnv();
  const file = new File(["# PRD"], "prd.md");
  const created = await req(env, "POST", `/workspace/projects/${PROJECT}/sources/document`, formWith(file));
  const id = created.json.source.id;
  assert.equal(env.EVIDENCE._store.size, 1);

  const forbidden = await req(env, "DELETE", `/workspace/projects/${PROJECT}/sources/${id}?userKey=${OTHER}`);
  assert.equal(forbidden.status, 403);

  const del = await req(env, "DELETE", `/workspace/projects/${PROJECT}/sources/${id}?userKey=${USER}`);
  assert.equal(del.status, 200);
  assert.equal(env.EVIDENCE._store.size, 0);

  const list = await req(env, "GET", `/workspace/projects/${PROJECT}/sources?userKey=${USER}`);
  assert.equal(list.json.sources.length, 0);
});

async function fetchRaw(env, path) {
  const app = createApp();
  return app.fetch(new Request(`http://localhost${path}`), env);
}

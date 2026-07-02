/**
 * workspace-document-intake.test.mjs — Stage 265
 *
 * Document intake → spec draft:
 * POST /workspace/projects/:id/sources/:sourceId/spec-draft
 *
 * Route tests use mock D1 + mock R2 (same conventions as
 * workspace-sources.test.mjs). Generation is exercised through the same seam
 * as the existing idea-to-spec tests: no ANTHROPIC_API_KEY in env → the
 * shared generateIdeaToSpecDraft path returns its deterministic
 * mock-fallback, so nothing hits the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");
const {
  extractDocumentText,
  buildDocumentDraftPrompt,
  MIN_DOCUMENT_TEXT_CHARS,
  MAX_DOCUMENT_TEXT_CHARS,
} = await import("../dist/workspace/document-intake.js");

const USER = "uk_owner";
const OTHER = "uk_intruder";
const PROJECT = "proj_doc";

const PRD_TEXT = [
  "# 골프장 컨디션 앱 PRD",
  "",
  "골프장 잔디/그린 상태를 회원들이 사진과 함께 공유하고,",
  "예약 전에 최신 코스 컨디션을 확인할 수 있는 모바일 웹 서비스.",
  "관리자는 공지와 코스 상태 등급을 직접 갱신할 수 있어야 한다.",
].join("\n");

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makeDb({ projects = new Map(), sources = [], rateCount = 0 } = {}) {
  const state = { sources, rateInserts: 0, usageEvents: [], projectWrites: 0 };
  return {
    _state: state,
    prepare(sql) {
      function handler(args) {
        return {
          async run() {
            if (/INSERT INTO workspace_rate_limit/i.test(sql)) {
              state.rateInserts += 1;
              return { meta: { changes: 1 } };
            }
            if (/INSERT INTO workspace_usage_events/i.test(sql)) {
              state.usageEvents.push(args);
              return { meta: { changes: 1 } };
            }
            if (/(INSERT INTO|UPDATE)\s+workspace_projects/i.test(sql)) {
              state.projectWrites += 1;
              return { meta: { changes: 1 } };
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
            if (sql.includes("FROM workspace_rate_limit")) {
              return { count: rateCount };
            }
            return null;
          },
          async all() {
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
    title: "골프장 컨디션 앱",
    idea: "골프장 상태 공유 서비스",
    understood_json: "{}",
    product_spec_json: "{}",
    items_json: "[]",
    created_at: "2026-07-02T00:00:00.000Z",
    updated_at: "2026-07-02T00:00:00.000Z",
  };
}

function makeSourceRow({
  id = "psrc_doc1",
  projectId = PROJECT,
  userKey = USER,
  type = "document",
  reference = `docs/${USER}/${PROJECT}/psrc_doc1/prd.md`,
  label = "PRD v1",
  contentType = "text/markdown",
} = {}) {
  return {
    id,
    project_id: projectId,
    user_key: userKey,
    type,
    reference,
    label,
    content_type: contentType,
    size_bytes: 1234,
    created_at: "2026-07-02T00:00:00.000Z",
  };
}

function makeR2(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    _store: store,
    async put(key, value) { store.set(key, value); },
    async get(key) {
      const hit = store.get(key);
      if (hit === undefined) return null;
      const bytes = typeof hit === "string" ? new TextEncoder().encode(hit) : hit;
      return {
        body: bytes,
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
    async delete(key) { store.delete(key); },
  };
}

function makeEnv({ withR2 = true, sources, r2Entries, rateCount = 0, limit } = {}) {
  const src = sources ?? [makeSourceRow()];
  const env = {
    ENVIRONMENT: "test",
    // No ANTHROPIC_API_KEY on purpose — generation degrades to mock-fallback.
    DB: makeDb({
      projects: new Map([[PROJECT, makeProjectRow(PROJECT, USER)]]),
      sources: src,
      rateCount,
    }),
  };
  if (limit !== undefined) env.WORKSPACE_GENERATION_LIMIT_PER_HOUR = limit;
  if (withR2) {
    env.EVIDENCE = makeR2(
      r2Entries ?? { [`docs/${USER}/${PROJECT}/psrc_doc1/prd.md`]: PRD_TEXT },
    );
  }
  return env;
}

async function specDraft(env, { projectId = PROJECT, sourceId = "psrc_doc1", body } = {}) {
  const app = createApp();
  const res = await app.fetch(
    new Request(`http://localhost/workspace/projects/${projectId}/sources/${sourceId}/spec-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? { userKey: USER }),
    }),
    env,
  );
  return { status: res.status, json: await res.json() };
}

// ─── extractDocumentText unit tests ──────────────────────────────────────────

test("extractDocumentText: strips BOM, normalizes CRLF, strips control chars", () => {
  const body = "# PRD\r\ncol1\tcol2\r줄1" + String.fromCharCode(0x00, 0x08, 0x1f, 0x7f) + "끝 " + "x".repeat(60);
  const bytes = new TextEncoder().encode(String.fromCharCode(0xfeff) + body);
  const result = extractDocumentText(bytes, "text/markdown");
  assert.equal(result.ok, true);
  assert.ok(result.text.charCodeAt(0) !== 0xfeff);
  assert.ok(!result.text.includes("\r"));
  assert.ok(result.text.includes("# PRD\ncol1\tcol2\n줄1끝"), `got: ${JSON.stringify(result.text)}`);
  assert.ok(![...result.text].some((ch) => { const c = ch.charCodeAt(0); return (c <= 0x1f && c !== 0x0a && c !== 0x09) || c === 0x7f; }));
});

test("extractDocumentText: too short / too long guards", () => {
  const short = extractDocumentText(new TextEncoder().encode("   too short   "), "text/plain");
  assert.deepEqual(short, { ok: false, error: "document_too_short" });
  assert.ok(MIN_DOCUMENT_TEXT_CHARS === 50);

  const long = extractDocumentText(
    new TextEncoder().encode("a".repeat(MAX_DOCUMENT_TEXT_CHARS + 1)),
    "text/plain",
  );
  assert.deepEqual(long, { ok: false, error: "document_too_long" });
});

test("extractDocumentText: pdf unsupported; unknown content type rejected", () => {
  const pdf = extractDocumentText(new TextEncoder().encode("%PDF-1.7"), "application/pdf");
  assert.deepEqual(pdf, { ok: false, error: "pdf_text_extraction_unsupported" });

  const odd = extractDocumentText(new TextEncoder().encode("x".repeat(100)), "image/png");
  assert.deepEqual(odd, { ok: false, error: "unsupported_content_type" });

  // charset parameter is tolerated
  const withCharset = extractDocumentText(
    new TextEncoder().encode("y".repeat(100)),
    "text/plain; charset=utf-8",
  );
  assert.equal(withCharset.ok, true);
});

test("buildDocumentDraftPrompt: leads with project title, embeds idea + document text", () => {
  const prompt = buildDocumentDraftPrompt(PRD_TEXT, { title: "골프장 컨디션 앱", idea: "골프장 상태 공유" });
  assert.ok(prompt.startsWith("골프장 컨디션 앱"));
  assert.ok(prompt.includes("기존 아이디어 메모: 골프장 상태 공유"));
  assert.ok(prompt.includes(PRD_TEXT));

  const bare = buildDocumentDraftPrompt("doc body", null);
  assert.ok(bare.includes("doc body"));
  assert.ok(!bare.includes("기존 아이디어 메모"));
});

// ─── Route tests ──────────────────────────────────────────────────────────────

test("happy path: md document → 200 draft (mock-fallback, same shape as idea-to-spec) + source info; project row untouched", async () => {
  const env = makeEnv();
  const { status, json } = await specDraft(env);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  // draft = same shape idea-to-spec-draft returns (minus top-level ok)
  assert.equal(json.draft.source, "mock-fallback"); // no ANTHROPIC_API_KEY → degrade preserved
  assert.ok(typeof json.draft.understood.summary === "string");
  assert.ok(Array.isArray(json.draft.questions));
  assert.ok(typeof json.draft.productSpec.productName === "string");
  assert.ok(Array.isArray(json.draft.items) && json.draft.items.length >= 3);
  json.draft.items.forEach((item) => assert.equal(item.status, "not_started"));
  assert.deepEqual(json.source, { id: "psrc_doc1", label: "PRD v1" });
  // DRAFT ONLY — no write to workspace_projects
  assert.equal(env.DB._state.projectWrites, 0);
  // rate-limit counter incremented + usage event recorded
  assert.equal(env.DB._state.rateInserts, 1);
  assert.equal(env.DB._state.usageEvents.length, 1);
});

test("ownership: other userKey 403 (project and source); unknown project 404", async () => {
  const env = makeEnv();
  const forbidden = await specDraft(env, { body: { userKey: OTHER } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, "forbidden");

  const missing = await specDraft(env, { projectId: "proj_nope" });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, "project_not_found");

  // source owned by someone else (but project owned by caller)
  const env2 = makeEnv({ sources: [makeSourceRow({ userKey: OTHER })] });
  const srcForbidden = await specDraft(env2);
  assert.equal(srcForbidden.status, 403);
});

test("source not found / belongs to another project → 404", async () => {
  const env = makeEnv();
  const nope = await specDraft(env, { sourceId: "psrc_nope" });
  assert.equal(nope.status, 404);
  assert.equal(nope.json.error, "source_not_found");

  const env2 = makeEnv({ sources: [makeSourceRow({ projectId: "proj_other" })] });
  const wrongProject = await specDraft(env2);
  assert.equal(wrongProject.status, 404);
  assert.equal(wrongProject.json.error, "source_not_found");
});

test("non-document source (website) → 400 source_not_document", async () => {
  const env = makeEnv({
    sources: [makeSourceRow({ type: "website", reference: "https://x.dev/", contentType: null })],
  });
  const { status, json } = await specDraft(env);
  assert.equal(status, 400);
  assert.equal(json.error, "source_not_document");
});

test("pdf document → 400 pdf_text_extraction_unsupported (honest v1 limitation)", async () => {
  const key = `docs/${USER}/${PROJECT}/psrc_doc1/prd.pdf`;
  const env = makeEnv({
    sources: [makeSourceRow({ reference: key, contentType: "application/pdf" })],
    r2Entries: { [key]: "%PDF-1.7 fake" },
  });
  const { status, json } = await specDraft(env);
  assert.equal(status, 400);
  assert.equal(json.error, "pdf_text_extraction_unsupported");
  assert.ok(typeof json.message === "string" && json.message.length > 0);
});

test("too-short and too-long documents → 400", async () => {
  const key = `docs/${USER}/${PROJECT}/psrc_doc1/prd.md`;
  const short = makeEnv({ r2Entries: { [key]: "짧음" } });
  const shortRes = await specDraft(short);
  assert.equal(shortRes.status, 400);
  assert.equal(shortRes.json.error, "document_too_short");

  const long = makeEnv({ r2Entries: { [key]: "a".repeat(MAX_DOCUMENT_TEXT_CHARS + 10) } });
  const longRes = await specDraft(long);
  assert.equal(longRes.status, 400);
  assert.equal(longRes.json.error, "document_too_long");
});

test("no EVIDENCE R2 binding → 503 evidence_storage_unconfigured", async () => {
  const env = makeEnv({ withR2: false });
  const { status, json } = await specDraft(env);
  assert.equal(status, 503);
  assert.equal(json.error, "evidence_storage_unconfigured");
});

test("R2 object missing (or reference still pending) → 404 document_not_found", async () => {
  const env = makeEnv({ r2Entries: {} });
  const { status, json } = await specDraft(env);
  assert.equal(status, 404);
  assert.equal(json.error, "document_not_found");

  const pending = makeEnv({ sources: [makeSourceRow({ reference: "pending" })] });
  const pendingRes = await specDraft(pending);
  assert.equal(pendingRes.status, 404);
  assert.equal(pendingRes.json.error, "document_not_found");
});

test("rate limit: shares the hourly workspace bucket → 429 with retryAfterSeconds, no counter increment", async () => {
  const env = makeEnv({ rateCount: 1, limit: "1" });
  const { status, json } = await specDraft(env);
  assert.equal(status, 429);
  assert.equal(json.error, "rate_limited");
  assert.ok(json.retryAfterSeconds >= 60);
  assert.equal(env.DB._state.rateInserts, 0);
});

test("bad input: invalid JSON body → 400; missing userKey → 400", async () => {
  const env = makeEnv();
  const app = createApp();
  const res = await app.fetch(
    new Request(`http://localhost/workspace/projects/${PROJECT}/sources/psrc_doc1/spec-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
    env,
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_json");

  const noKey = await specDraft(env, { body: {} });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.json.error, "userKey_required");
});

test("locale=en passes through to the shared generation path (draft still valid shape)", async () => {
  const env = makeEnv();
  const { status, json } = await specDraft(env, { body: { userKey: USER, locale: "en" } });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.draft.source, "mock-fallback");
  assert.ok(Array.isArray(json.draft.items) && json.draft.items.length >= 3);
});

/**
 * train-c-c4a-envelope.test.mjs — Train C · C4a 데이터 봉투 (재정렬 D-8·D-20·D-21 amend, W1 §3 항목 4).
 *
 * 고정하는 계약(계약 6):
 *   ⑨ 0069 SQL은 ADD COLUMN만 — 정확히 10개 컬럼, NULL 허용, 파괴적 문장 0
 *   ⑦ 런 insert에 region(cf.country)·envelope_json(프로젝트 스냅샷) 저장 · 완료 콜백에 finding_codes_json
 *   ⑧ hostingFromHeaders가 빌더 호스트(lovable.app·lovableproject.com·bolt.host·replit.app·repl.co·base44.app)를 읽는다
 *   ⑦' classifyFindings의 각 분기가 안정 코드(code)를 채운다 — 리포트 문장은 그대로
 *   ⑦'' 프로젝트 생성 시 region_at_create 저장(capture-once)
 *
 * 모크는 seam(D1·DO)에서. 네트워크 없음.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFakeD1, projectRow, websiteSource, makeDoStub, send } from "./_train-c-fake-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { classifyFindings, buildNonDevReport } = await import("../dist/nondev-report.js");
const { hostingFromHeaders } = await import("../dist/workspace/source-evidence.js");
const { upsertProject, getProject } = await import("../dist/workspace/db.js");

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0069_moat_envelope.sql");

const USER = "uk_owner";
const PROJECT = "proj_c4a";
const TOKEN = "tok_internal_secret";
const RUN_PATH = `/workspace/projects/${PROJECT}/visual-checks/run`;

function readCode() {
  return readFileSync(MIGRATION, "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

// ─── ⑨ 0069 마이그레이션 형태 ──────────────────────────────────────────────────

test("0069: file exists and contains ONLY additive ALTER TABLE ... ADD COLUMN statements", () => {
  assert.ok(existsSync(MIGRATION), `expected migration at ${MIGRATION}`);
  const code = readCode();
  const statements = code.split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.length > 0, "expected statements");
  for (const s of statements) {
    assert.match(s, /^ALTER TABLE \w+ ADD COLUMN \w+ (TEXT|INTEGER)$/, `non-additive statement: ${s}`);
  }
  assert.doesNotMatch(code, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|CREATE|NOT NULL|DEFAULT)\b/i);
});

// Shape guard (not regression evidence — the file is new in this PR, so it passes by construction).
// Numbering: 0069 is the next free number on this branch; 0068 belongs to #548 and is NOT in this
// branch's migrations directory. D1 applies migrations by name, so the gap is harmless; the merge
// order (#548 first) is a process note in the PR body, not something this test can see.
test("0069: exact column set per table (visual_checks 6 · repair_jobs 3 · projects 1); 0069 is unique and the highest-numbered file on this branch", () => {
  const code = readCode();
  const cols = (table) =>
    [...code.matchAll(new RegExp(`ALTER TABLE ${table} ADD COLUMN (\\w+) (TEXT|INTEGER)`, "g"))].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(cols("workspace_visual_checks"), [
    "envelope_json:TEXT", "finding_codes_json:TEXT", "region:TEXT", "source_check_id:TEXT", "user_verdict:TEXT", "user_verdict_at:TEXT",
  ]);
  assert.deepEqual(cols("workspace_repair_jobs"), ["region:TEXT", "resolved:INTEGER", "verify_check_id:TEXT"]);
  assert.deepEqual(cols("workspace_projects"), ["region_at_create:TEXT"]);
  const files = [];
  for (const f of ["0067_dev_spec.sql", "0069_moat_envelope.sql"]) files.push(existsSync(join(here, "..", "migrations", f)));
  assert.deepEqual(files, [true, true]);
  const numbered = readdirSync(join(here, "..", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  assert.equal(numbered.filter((f) => f.startsWith("0069_")).length, 1, "exactly one 0069 migration");
  assert.equal(numbered.at(-1), "0069_moat_envelope.sql", "0069 is the newest migration on this branch");
});

// ─── ⑦' finding codes ───────────────────────────────────────────────────────────

const BASE = {
  targetUrl: "https://example.app/",
  intentAnchor: "사용자가 핵심 흐름을 시작할 수 있어야 한다",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: "/search",
  routeChanged: true,
  consoleErrors: [],
  networkFailures: [],
  decision: "Needs Fix",
  steps: [],
};

test("classifyFindings: every branch carries a stable machine code; prose unchanged (no jargon leaks)", () => {
  const codes = (input) => classifyFindings(input, "ko").map((f) => f.code);
  assert.deepEqual(codes({ ...BASE, networkFailures: ["GET https://x.supabase.co/rest (net::ERR_NAME_NOT_RESOLVED)"] }), ["dns_unresolved"]);
  assert.deepEqual(codes({ ...BASE, networkFailures: ["GET https://api.example.app/list → HTTP 502"] }), ["network_5xx"]);
  assert.deepEqual(codes({ ...BASE, networkFailures: ["GET https://api.example.app/list → HTTP 403"] }), ["network_failed"]);
  assert.deepEqual(codes({ ...BASE, routeAfterClick: "/undefined" }), ["broken_route"]);
  assert.deepEqual(codes({ ...BASE, consoleErrors: ["TypeError: x is not a function"] }), ["console_error"]);
  assert.deepEqual(codes({ ...BASE, noiseFailures: ["https://www.google-analytics.com/collect 403"] }), ["noise_third_party"]);
  assert.deepEqual(codes({ ...BASE, primaryActionFound: false, interacted: false }), ["no_primary_action"]);
  assert.deepEqual(codes({ ...BASE, steps: [{ label: "검색", ok: false }] }), ["step_failed"]);
  assert.deepEqual(
    codes({ ...BASE, acceptanceResults: [
      { acceptanceId: "AC-1", featureTitle: "산책 기록", then: "목록에 1건", status: "broken" },
      { acceptanceId: "AC-2", featureTitle: "통계", then: "합계", status: "not_confirmed" },
      { acceptanceId: "AC-3", featureTitle: "공유", then: "링크", status: "no_problem" },
    ] }),
    ["ac_broken", "ac_not_confirmed"],
  );
  // EN produces the same codes (codes are locale-independent) and the same prose as before.
  const en = classifyFindings({ ...BASE, routeAfterClick: "/undefined" }, "en");
  assert.equal(en[0].code, "broken_route");
  assert.equal(en[0].what, "Pressing the button led to a broken screen.");
  // Report assembly passes codes through untouched; the signup blocker gets its own code.
  const report = buildNonDevReport({ ...BASE, blockerFindings: [{ kind: "app_gap", what: "가입 확인 메일이 오지 않아요" }] }, "ko");
  assert.deepEqual(report.findings.map((f) => f.code), ["signup_blocker"]);
});

// ─── ⑧ builder hosts ───────────────────────────────────────────────────────────

test("hostingFromHeaders: builder-hosted app hosts are recognized (lovable · bolt · replit · base44); vercel/netlify unchanged", () => {
  const h = (url) => hostingFromHeaders(new Headers(), url);
  assert.equal(h("https://my-app.lovable.app/"), "lovable");
  assert.equal(h("https://id-preview.lovableproject.com/"), "lovable");
  assert.equal(h("https://sunny-bolt.bolt.host/"), "bolt");
  assert.equal(h("https://my-app.replit.app/"), "replit");
  assert.equal(h("https://my-app.username.repl.co/"), "replit");
  assert.equal(h("https://my-app.base44.app/"), "base44");
  assert.equal(h("https://my-app.vercel.app/"), "vercel");
  assert.equal(h("https://my-app.netlify.app/"), "netlify");
  assert.equal(h("https://lovable.app.evil.example/"), undefined, "suffix match must be on the registrable host, not a substring");
  assert.equal(h("https://plain.example.com/"), undefined);
});

// ─── ⑦ region + envelope_json at run insert · finding_codes_json at callback ────

function makeEnv({ projects, sources, checks = [], inspector, token = TOKEN } = {}) {
  const env = {
    ENVIRONMENT: "test",
    DB: makeFakeD1({ projects, sources, checks }),
  };
  if (inspector) env.INSPECTOR = inspector;
  if (token) env.INTERNAL_CALLBACK_TOKEN = token;
  return env;
}

test("run: cf.country → region; project builtWith/entryPath/topicTags + locale + contentLang → envelope_json", async () => {
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER, {
    built_with_json: JSON.stringify({ tools: ["lovable"], primary: "lovable" }),
    entry_path: "code",
    topic_tags_json: JSON.stringify({ domain: "fitness", pattern: "tracker" }),
  })]]);
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ projects, sources: [websiteSource(PROJECT, USER)], inspector: makeDoStub(recorder) });
  const app = createApp();
  const r = await send(app, env, RUN_PATH, { body: { userKey: USER, locale: "en", intent: "골퍼가 코스 상태를 확인할 수 있어야 한다" }, cf: { country: "KR" } });
  assert.equal(r.status, 202);
  const row = env.DB._checks[0];
  assert.equal(row.region, "KR");
  const envelope = JSON.parse(row.envelope_json);
  assert.deepEqual(envelope, {
    builtWith: { tools: ["lovable"], primary: "lovable" },
    entryPath: "code",
    topicTags: { domain: "fitness", pattern: "tracker" },
    locale: "en",
    contentLang: "ko",
  });
});

test("run: no cf object (local/dev) → region null; empty project → envelope with nulls (never invented)", async () => {
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER)]]);
  const env = makeEnv({ projects, sources: [websiteSource(PROJECT, USER)] });
  const r = await send(createApp(), env, RUN_PATH, { body: { userKey: USER } });
  assert.equal(r.status, 202);
  const row = env.DB._checks[0];
  assert.equal(row.region, null);
  const envelope = JSON.parse(row.envelope_json);
  assert.equal(envelope.builtWith, null);
  assert.equal(envelope.entryPath, null);
  assert.equal(envelope.topicTags, null);
  assert.equal(envelope.locale, "ko");
});

test("internal done: report.findings[].code → finding_codes_json; legacy container (no codes) → null; no findings → []", async () => {
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER)]]);
  const env = makeEnv({ projects, sources: [websiteSource(PROJECT, USER)], inspector: makeDoStub({ names: [], calls: [] }) });
  const app = createApp();
  const auth = { authorization: `Bearer ${TOKEN}` };

  const created = await send(app, env, RUN_PATH, { body: { userKey: USER } });
  const runId = created.json.check.id;
  const report = {
    title: "Simsa 검수 리포트", target: "https://golf-now.example.app/", intent: "i", verdict: "작동 안 해요", oneLine: "x", works: false,
    findings: [
      { severity: "high", what: "서버가 오류를 돌려줬어요.", why: "w", how: "h", evidence: "HTTP 502", code: "network_5xx" },
      { severity: "low", what: "화면에서 코드 오류가 났어요.", why: "w", how: "h", evidence: "TypeError", code: "console_error" },
    ],
    nextSteps: [], notes: [],
  };
  const done = await send(app, env, "/internal/visual-check-done", { body: { runId, ok: true, decision: "Needs Fix", works: false, report }, headers: auth });
  assert.equal(done.status, 200);
  assert.deepEqual(JSON.parse(env.DB._checks[0].finding_codes_json), ["network_5xx", "console_error"]);

  // Legacy container image (pre-C4a nondev-report.js): findings present, no codes → null, not [].
  env.DB._checks[0].status = "done";
  const created2 = await send(app, env, RUN_PATH, { body: { userKey: USER } });
  const legacy = { ...report, findings: report.findings.map(({ code: _c, ...f }) => f) };
  await send(app, env, "/internal/visual-check-done", { body: { runId: created2.json.check.id, ok: true, decision: "Needs Fix", works: false, report: legacy }, headers: auth });
  assert.equal(env.DB._checks[1].finding_codes_json, null);

  // No findings at all → [] (measured: nothing found), distinct from "unknown".
  env.DB._checks[1].status = "done";
  const created3 = await send(app, env, RUN_PATH, { body: { userKey: USER } });
  await send(app, env, "/internal/visual-check-done", { body: { runId: created3.json.check.id, ok: true, decision: "Conditionally Ready", works: null, report: { ...report, findings: [] } }, headers: auth });
  assert.equal(env.DB._checks[2].finding_codes_json, "[]");
});

// ─── ⑦'' region_at_create ─────────────────────────────────────────────────────

test("upsertProject: regionAtCreate persists on create, is sticky on re-save, and round-trips via getProject", async () => {
  const env = { DB: makeFakeD1() };
  const id = await upsertProject(env, {
    id: "proj_region", userKey: "uk1", title: "T", idea: "i", understood: {}, productSpec: {}, items: [],
    regionAtCreate: "PH",
  });
  let proj = await getProject(env, id);
  assert.equal(proj.regionAtCreate, "PH");

  // A later re-save from another edge (or with no region) must not overwrite the capture-once value.
  await upsertProject(env, {
    id, userKey: "uk1", title: "T2", idea: "i", understood: {}, productSpec: {}, items: [], regionAtCreate: "SG",
  });
  proj = await getProject(env, id);
  assert.equal(proj.regionAtCreate, "PH");

  const insert = env.DB.writes.find((w) => /INSERT INTO workspace_projects/.test(w.sql));
  assert.match(insert.sql, /region_at_create/);
  assert.match(insert.sql, /COALESCE\(workspace_projects\.region_at_create, excluded\.region_at_create\)/);
});

test("POST /workspace/projects: cf.country lands in region_at_create", async () => {
  const env = { ENVIRONMENT: "test", DB: makeFakeD1() };
  const r = await send(createApp(), env, "/workspace/projects", {
    body: { userKey: "uk1", title: "댕댕 산책", idea: "산책 기록", understood: {}, productSpec: {}, items: [] },
    cf: { country: "TH" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = env.DB.state.projects.get(r.json.id);
  assert.equal(row.region_at_create, "TH");
});

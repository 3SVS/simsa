/**
 * d1-readonly-queries.test.mjs — Train W · W-V-0 도구 (ops-probe `d1-readonly`).
 *
 * 라이브 기준선(W-V-0: region·envelope_json·finding_codes_json 채움)을 사람이 D1 콘솔을 열지
 * 않고 재기 위한 **이름 붙은 읽기 전용 질의**. 자유 SQL은 받지 않는다.
 *
 * Pins (과제 테스트 ⑨):
 *   - 질의는 정확히 3개(latest-visual-checks · latest-repair-jobs · envelope-fill-rate)
 *   - 각 질의는 SELECT 한 문장뿐 — 쓰기·DDL·PRAGMA·ATTACH·여러 문장 금지
 *   - 식별·내용 컬럼(user_key·intent·target_url·agent_prompt·report_json·repo_full_name …) 미포함,
 *     envelope_json은 length()/COUNT() 안에서만
 *   - 모르는 이름·SQL 문자열을 이름 자리에 넣으면 거부(자유 SQL 경로 없음)
 *   - 실제 마이그레이션(0050·0051·0052·0065·0069)으로 만든 스키마에서 세 질의가 실행된다(node:sqlite)
 *   - ops-probe.yml: d1-readonly 선택지 + 질의 이름은 choice + env 경유(셸 보간 없음)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");

async function load() {
  const mod = await import("../scripts/d1-readonly-queries.mjs").catch(() => null);
  assert.ok(mod, "apps/central-plane/scripts/d1-readonly-queries.mjs must exist");
  return mod;
}

const NAMES = ["latest-visual-checks", "latest-repair-jobs", "envelope-fill-rate"];

/** Identifying / content columns that must never leave D1 through this tool. */
const FORBIDDEN = [
  "user_key", "intent", "target_url", "agent_prompt", "report_json", "evidence_keys_json",
  "repo_full_name", "branch_name", "pr_url", "pr_number", "error", "project_id", "visual_check_id",
  "user_verdict_at", "idea", "title",
];

test("⑨ 이름 붙은 질의는 정확히 세 개", async () => {
  const { D1_READONLY_QUERIES } = await load();
  assert.deepEqual(Object.keys(D1_READONLY_QUERIES).sort(), [...NAMES].sort());
  assert.ok(Object.isFrozen(D1_READONLY_QUERIES), "the table of queries is frozen");
});

test("⑨ 각 질의는 SELECT 한 문장뿐 — 쓰기·DDL·PRAGMA·ATTACH·여러 문장 없음", async () => {
  const { D1_READONLY_QUERIES, assertReadOnlySelect } = await load();
  for (const [name, sql] of Object.entries(D1_READONLY_QUERIES)) {
    assert.match(sql.trim(), /^SELECT\s/i, `${name} starts with SELECT`);
    assert.ok(!/;\s*\S/.test(sql), `${name}: a single statement`);
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|BEGIN|COMMIT)\b/i.test(sql),
      `${name}: no write/DDL keyword`,
    );
    assert.doesNotThrow(() => assertReadOnlySelect(sql), name);
  }
});

test("⑨ 읽기 전용 검사기는 쓰기·여러 문장을 거부한다", async () => {
  const { assertReadOnlySelect } = await load();
  for (const bad of [
    "DELETE FROM workspace_visual_checks",
    "SELECT 1; DROP TABLE workspace_visual_checks",
    "UPDATE workspace_repair_jobs SET status = 'done'",
    "PRAGMA table_info(workspace_visual_checks)",
    "WITH x AS (SELECT 1) DELETE FROM workspace_visual_checks",
    "select 1; select 2",
    "",
  ]) {
    assert.throws(() => assertReadOnlySelect(bad), `must reject: ${bad}`);
  }
});

test("⑨ 식별·내용 컬럼은 질의에 없다 · envelope_json은 length()/COUNT() 안에서만", async () => {
  const { D1_READONLY_QUERIES } = await load();
  for (const [name, sql] of Object.entries(D1_READONLY_QUERIES)) {
    for (const col of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${col}\\b`, "i").test(sql), `${name} must not reference ${col}`);
    }
    const stripped = sql.replace(/\b(length|COUNT)\(\s*envelope_json\s*\)/gi, "");
    assert.ok(!/\benvelope_json\b/i.test(stripped), `${name}: envelope_json appears only as a size/count`);
  }
});

test("⑨ 모르는 이름 · 이름 자리의 SQL은 거부 — 자유 SQL 경로가 없다", async () => {
  const { resolveQuery, wranglerArgs } = await load();
  for (const bad of ["", "latest", "SELECT * FROM workspace_visual_checks", "latest-visual-checks; DROP TABLE x", "__proto__", "constructor"]) {
    assert.throws(() => resolveQuery(bad), `must reject name: ${JSON.stringify(bad)}`);
    assert.throws(() => wranglerArgs(bad));
  }
  for (const name of NAMES) assert.equal(typeof resolveQuery(name), "string");
});

test("⑨ wrangler 인자: d1 execute conclave-ai --remote --json --command <이름의 SQL>", async () => {
  const { wranglerArgs, D1_READONLY_QUERIES } = await load();
  const args = wranglerArgs("latest-repair-jobs");
  assert.deepEqual(args, [
    "d1", "execute", "conclave-ai", "--remote", "--json",
    "--command", D1_READONLY_QUERIES["latest-repair-jobs"],
  ]);
});

test("⑨ 요약 렌더: wrangler --json 출력 → 마크다운 표 (행 없음·깨진 출력도 정직하게)", async () => {
  const { renderSummary } = await load();
  const json = JSON.stringify([{ results: [{ id: "wrj_1", status: "done", region: "KR", verify_check_id: null, resolved: 1 }], success: true }]);
  const md = renderSummary("latest-repair-jobs", json);
  assert.match(md, /latest-repair-jobs/);
  assert.match(md, /\| id \| status \| region \| verify_check_id \| resolved \|/);
  assert.match(md, /\| wrj_1 \| done \| KR \| NULL \| 1 \|/);

  const empty = renderSummary("latest-repair-jobs", JSON.stringify([{ results: [], success: true }]));
  assert.match(empty, /0 rows/);

  assert.throws(() => renderSummary("latest-repair-jobs", "not json"), "unparseable output is an error, not an empty table");
});

test("⑨ 실제 마이그레이션 스키마에서 세 질의가 실행된다 (node:sqlite)", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite unavailable on this Node version");
    return;
  }
  const { D1_READONLY_QUERIES } = await load();
  const db = new DatabaseSync(":memory:");
  const mig = (f) => readFileSync(path.join(ROOT, "migrations", f), "utf8");
  for (const f of ["0050_workspace_visual_checks.sql", "0051_workspace_repair_jobs.sql", "0052_repair_job_mode.sql", "0065_visual_check_locale.sql"]) {
    db.exec(mig(f));
  }
  // 0069 also alters workspace_projects (not needed here) — apply only the two tables' ALTERs.
  for (const line of mig("0069_moat_envelope.sql").split("\n")) {
    if (/^ALTER TABLE workspace_(visual_checks|repair_jobs) /.test(line)) db.exec(line);
  }
  db.exec(`INSERT INTO workspace_visual_checks (id, project_id, user_key, target_url, intent, decision, status, executor, report_json, evidence_keys_json, created_at, updated_at, region, envelope_json)
           VALUES ('wvc_1', 'p', 'uk_secret', 'https://x', '의도', 'Needs Fix', 'done', 'container', '{}', '[]', '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z', 'KR', '{"locale":"ko"}')`);
  const vc = db.prepare(D1_READONLY_QUERIES["latest-visual-checks"]).all();
  assert.equal(vc.length, 1);
  assert.deepEqual(Object.keys(vc[0]).sort(), ["created_at", "envelope_len", "finding_codes_json", "id", "region", "source_check_id", "status", "user_verdict"].sort());
  assert.ok(!JSON.stringify(vc).includes("uk_secret") && !JSON.stringify(vc).includes("https://x"));
  const rj = db.prepare(D1_READONLY_QUERIES["latest-repair-jobs"]).all();
  assert.equal(rj.length, 0);
  const fill = db.prepare(D1_READONLY_QUERIES["envelope-fill-rate"]).all();
  assert.equal(fill.length, 1);
  assert.equal(fill[0].rows_scanned, 1);
  assert.equal(fill[0].region_filled, 1);
  assert.equal(fill[0].envelope_filled, 1);
  assert.equal(fill[0].finding_codes_filled, 0);
});

test("⑨ ops-probe.yml: d1-readonly 선택지 · 질의 이름은 choice · env 경유 · 스크립트 호출", () => {
  const wf = readFileSync(path.join(REPO_ROOT, ".github/workflows/ops-probe.yml"), "utf8");
  assert.match(wf, /options:\s*\[[^\]]*d1-readonly[^\]]*\]/, "target choice includes d1-readonly");
  for (const name of NAMES) assert.ok(wf.includes(name), `query choice lists ${name}`);
  assert.match(wf, /scripts\/d1-readonly-queries\.mjs/);
  assert.ok(!/--command\s+["']?\$\{\{/.test(wf), "no workflow input is interpolated into --command");
  assert.ok(!/node scripts\/d1-readonly-queries\.mjs\s+["']?\$\{\{/.test(wf), "the query name reaches the script through env, not shell interpolation");
  assert.match(wf, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(wf, /GITHUB_STEP_SUMMARY/);
});

/**
 * d1-readonly-queries.test.mjs — Train W · W-V-0 도구 (ops-probe `d1-readonly`).
 *
 * 라이브 기준선(W-V-0: region·envelope_json·finding_codes_json 채움)을 사람이 D1 콘솔을 열지
 * 않고 재기 위한 **이름 붙은 읽기 전용 질의**. 자유 SQL은 받지 않는다.
 *
 * Pins (과제 테스트 ⑨):
 *   - 질의는 정확히 3개(latest-visual-check-fill · envelope-fill-rate · repair-fill-rate)
 *   - 각 질의는 SELECT 한 문장뿐 — 쓰기·DDL·PRAGMA·ATTACH·여러 문장 금지
 *   - 식별·내용 컬럼(user_key·intent·target_url·agent_prompt·report_json·repo_full_name …) 미포함,
 *     envelope_json은 length()/COUNT()/IS NOT NULL 안에서만
 *   - 모르는 이름·SQL 문자열을 이름 자리에 넣으면 거부(자유 SQL 경로 없음)
 *   - 실제 마이그레이션(0050·0051·0052·0065·0069)으로 만든 스키마에서 세 질의가 실행된다(node:sqlite)
 *   - ops-probe.yml: d1-readonly 선택지 + 질의 이름은 choice + env 경유(셸 보간 없음)
 *
 * PR #561 검증 후속 (2026-09-29):
 *   - 3SVS/simsa는 PUBLIC 저장소라 job summary·로그를 누구나 읽는다. 행 단위 출력(id·초 단위 시각·
 *     국가·사람 판정)을 없애고 **채움 여부·개수만** 낸다 — 선택 항목 화이트리스트로 고정.
 *   - wrangler는 락파일이 고정한 로컬 bin을 node로 직접 실행(`npx --yes wrangler@4` 금지 — 쓰기
 *     권한 토큰이 레지스트리 최신본에 넘어가지 않게), 셸 없음(Windows에서 SQL이 공백마다 쪼개지던 문제).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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

const NAMES = ["latest-visual-check-fill", "envelope-fill-rate", "repair-fill-rate", "agent-llm-usage-48h"];

/** Identifying / content columns that must never leave D1 through this tool. */
const FORBIDDEN = [
  "user_key", "intent", "target_url", "agent_prompt", "report_json", "evidence_keys_json",
  "repo_full_name", "branch_name", "pr_url", "pr_number", "error", "project_id", "visual_check_id",
  "user_verdict_at", "idea", "title",
];

/** The outer SELECT list (between the first SELECT and its FROM), split on top-level commas. */
function selectItems(sql) {
  const m = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(sql);
  assert.ok(m, "a SELECT … FROM query");
  const items = [];
  let depth = 0;
  let cur = "";
  for (const ch of m[1]) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  items.push(cur.trim());
  return items;
}

/** Source without comments — assertions about what the CODE does, not what the prose says. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The only item shapes allowed in the published output: a count, a
 * "was it filled" boolean, or the calendar day. No raw column value.
 */
const ALLOWED_ITEM = [
  /^COUNT\(\*\) AS rows_scanned$/i,
  /^COUNT\(([a-z_]+)\) AS ([a-z_]+)$/i,
  /^\(([a-z_]+) IS NOT NULL\) AS ([a-z_]+)$/i,
  /^substr\(created_at, 1, 10\) AS created_day$/i,
];

const AGENT_USAGE_ITEMS = [
  "r.seq AS run_seq",
  "substr(r.first_at, 1, 10) AS run_day",
  "u.model_requested AS model_requested",
  "u.model_actual AS model_actual",
  "COUNT(*) AS calls",
  "ROUND(SUM(u.cost_usd), 4) AS cost_usd",
  "SUM(u.unpriced) AS unpriced_calls",
  "SUM(u.input_tokens) AS input_tokens",
  "SUM(u.output_tokens) AS output_tokens",
];

test("⑨ 이름 붙은 질의는 정확히 네 개", async () => {
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

test("⑨ 식별·내용 컬럼은 질의에 없다 · envelope_json은 length()/COUNT()/IS NOT NULL 안에서만", async () => {
  const { D1_READONLY_QUERIES } = await load();
  for (const [name, sql] of Object.entries(D1_READONLY_QUERIES)) {
    for (const col of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${col}\\b`, "i").test(sql), `${name} must not reference ${col}`);
    }
    const stripped = sql
      .replace(/\b(length|COUNT)\(\s*envelope_json\s*\)/gi, "")
      .replace(/\(\s*envelope_json\s+IS NOT NULL\s*\)/gi, "");
    assert.ok(!/\benvelope_json\b/i.test(stripped), `${name}: envelope_json appears only as a size/count/filled flag`);
  }
});

test("⑨ PUBLIC 요약: 출력 항목은 개수·채움 여부·날짜뿐 — id·*_id·값 컬럼·초 단위 시각 없음 (선택 항목 화이트리스트)", async () => {
  const { D1_READONLY_QUERIES } = await load();
  for (const [name, sql] of Object.entries(D1_READONLY_QUERIES)) {
    for (const item of selectItems(sql)) {
      // agent 진단 질의: 런 순번·날짜·모델 이름(사람·앱 정보 아님)·합계만 — 고정 목록.
      if (name === "agent-llm-usage-48h") {
        assert.ok(AGENT_USAGE_ITEMS.includes(item), `${name}: "${item}" is not in the fixed list`);
        continue;
      }
      assert.ok(ALLOWED_ITEM.some((re) => re.test(item)), `${name}: "${item}" is not a count / filled-flag / day`);
      const alias = /\bAS\s+([a-z_]+)$/i.exec(item)?.[1] ?? "";
      assert.ok(alias !== "id" && !/_id$/i.test(alias), `${name}: output column "${alias}" must not be an id`);
    }
  }
});

test("⑨ 모르는 이름 · 이름 자리의 SQL은 거부 — 자유 SQL 경로가 없다", async () => {
  const { resolveQuery, wranglerArgs } = await load();
  for (const bad of ["", "latest", "latest-visual-checks", "latest-repair-jobs", "SELECT * FROM workspace_visual_checks", "envelope-fill-rate; DROP TABLE x", "__proto__", "constructor"]) {
    assert.throws(() => resolveQuery(bad), `must reject name: ${JSON.stringify(bad)}`);
    assert.throws(() => wranglerArgs(bad));
  }
  for (const name of NAMES) assert.equal(typeof resolveQuery(name), "string");
});

test("⑨ wrangler 인자: d1 execute conclave-ai --remote --json --command <이름의 SQL>", async () => {
  const { wranglerArgs, D1_READONLY_QUERIES } = await load();
  const args = wranglerArgs("repair-fill-rate");
  assert.deepEqual(args, [
    "d1", "execute", "conclave-ai", "--remote", "--json",
    "--command", D1_READONLY_QUERIES["repair-fill-rate"],
  ]);
});

test("⑨ 요약 렌더: wrangler --json 출력 → 마크다운 표 (행 없음·깨진 출력도 정직하게)", async () => {
  const { renderSummary } = await load();
  const json = JSON.stringify([{ results: [{ rows_scanned: 3, region_filled: 3, verify_linked: 1, resolved_recorded: null }], success: true }]);
  const md = renderSummary("repair-fill-rate", json);
  assert.match(md, /repair-fill-rate/);
  assert.match(md, /\| rows_scanned \| region_filled \| verify_linked \| resolved_recorded \|/);
  assert.match(md, /\| 3 \| 3 \| 1 \| NULL \|/);

  const empty = renderSummary("repair-fill-rate", JSON.stringify([{ results: [], success: true }]));
  assert.match(empty, /0 rows/);

  assert.throws(() => renderSummary("repair-fill-rate", "not json"), "unparseable output is an error, not an empty table");
});

test("⑨ 실제 마이그레이션 스키마에서 세 질의가 실행된다 · 출력에 시드한 id·키·국가·시각이 없다 (node:sqlite)", async (t) => {
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
  for (const f of ["0050_workspace_visual_checks.sql", "0051_workspace_repair_jobs.sql", "0052_repair_job_mode.sql", "0065_visual_check_locale.sql", "0070_llm_usage.sql"]) {
    db.exec(mig(f));
  }
  // 0069 also alters workspace_projects (not needed here) — apply only the two tables' ALTERs.
  for (const line of mig("0069_moat_envelope.sql").split("\n")) {
    if (/^ALTER TABLE workspace_(visual_checks|repair_jobs) /.test(line)) db.exec(line);
  }
  db.exec(`INSERT INTO workspace_visual_checks (id, project_id, user_key, target_url, intent, decision, status, executor, report_json, evidence_keys_json, created_at, updated_at, region, envelope_json, user_verdict)
           VALUES ('wvc_secret1', 'wsp_p', 'uk_secret', 'https://x.example.app', '의도', 'Needs Fix', 'done', 'container', '{}', '[]', '2026-09-28T07:41:13.512Z', '2026-09-28T07:41:13.512Z', 'PH', '{"locale":"ko"}', 'as_intended')`);
  db.exec(`INSERT INTO workspace_repair_jobs (id, project_id, user_key, visual_check_id, repo_full_name, status, branch_name, created_at, updated_at, region, verify_check_id, resolved)
           VALUES ('wrj_secret1', 'wsp_p', 'uk_secret', 'wvc_secret1', 'acme/app', 'done', 'fix/simsa-wvc_secret1', '2026-09-28T08:02:55.001Z', '2026-09-28T08:02:55.001Z', 'PH', 'wvc_secret2', 1)`);

  // agent 진단 질의: 런 id(job_id)·사용자 해시는 출력에 없어야 한다.
  const recent = new Date(Date.now() - 3600_000).toISOString();
  db.exec(`INSERT INTO llm_usage (id, created_at, job_kind, job_id, project_id, user_key_hash, vendor, model_requested, model_actual, call_site, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, unpriced, latency_ms, container_seconds)
           VALUES ('lu_1', '${recent}', 'inspection', 'wvc_secret1', 'wsp_p', 'uk_secret', 'openai', 'claude-haiku-4-5-20251001', 'gpt-5.4-mini-2026-03-17', 'inspect_agent', 1000, 0, 0, 50, 0.001, 0, 900, NULL)`);

  const out = {};
  // node:sqlite rows have a null prototype — spread them into plain objects.
  for (const name of NAMES) out[name] = db.prepare(D1_READONLY_QUERIES[name]).all().map((r) => ({ ...r }));
  const all = JSON.stringify(out);
  for (const leak of ["wvc_secret1", "wvc_secret2", "wrj_secret1", "uk_secret", "wsp_p", "PH", "07:41", "08:02", "as_intended", "acme/app"]) {
    assert.ok(!all.includes(leak), `published output must not contain "${leak}": ${all}`);
  }
  for (const rows of Object.values(out)) {
    for (const r of rows) for (const k of Object.keys(r)) assert.ok(k !== "id" && !/_id$/.test(k), `column ${k}`);
  }
  assert.deepEqual(out["latest-visual-check-fill"], [
    { region_filled: 1, envelope_filled: 1, finding_codes_filled: 0, locale_filled: 0, created_day: "2026-09-28" },
  ]);
  assert.equal(out["envelope-fill-rate"][0].rows_scanned, 1);
  assert.equal(out["envelope-fill-rate"][0].region_filled, 1);
  assert.equal(out["envelope-fill-rate"][0].envelope_filled, 1);
  assert.equal(out["envelope-fill-rate"][0].finding_codes_filled, 0);
  assert.deepEqual(out["repair-fill-rate"], [{ rows_scanned: 1, region_filled: 1, verify_linked: 1, resolved_recorded: 1 }]);
});

// ─── how wrangler is run (PR #561 review P2 ×2) ──────────────────────────────

test("⑨ wrangler = 락파일이 고정한 로컬 bin (node_modules/wrangler) — npx·wrangler@<범위> 없음", async () => {
  const { resolveWranglerBin } = await load();
  assert.equal(typeof resolveWranglerBin, "function");
  const bin = resolveWranglerBin();
  assert.ok(existsSync(bin), `resolved bin exists: ${bin}`);
  assert.match(bin.replace(/\\/g, "/"), /\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?wrangler\/bin\/wrangler\.js$/);
  const src = codeOnly(readFileSync(path.join(ROOT, "scripts/d1-readonly-queries.mjs"), "utf8"));
  assert.ok(!/["'`]npx(\.cmd)?["'`]/.test(src), "the script never spawns npx");
  assert.ok(!/wrangler@/.test(src), "no floating wrangler@<range> download");
});

test("⑨ 실행: node로 bin을 직접, 셸 없음 — SQL은 인자 하나로 그대로 간다 (주입한 spawn)", async () => {
  const { runWrangler, wranglerArgs } = await load();
  assert.equal(typeof runWrangler, "function");
  const seen = [];
  const spawn = (file, args, opts) => {
    seen.push({ file, args, opts });
    return { status: 0, stdout: "[]", stderr: "" };
  };
  runWrangler("envelope-fill-rate", { spawn, resolveBin: () => "/locked/wrangler/bin/wrangler.js" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].file, process.execPath, "node itself — no npx, no .cmd shim");
  assert.deepEqual(seen[0].args, ["/locked/wrangler/bin/wrangler.js", ...wranglerArgs("envelope-fill-rate")]);
  assert.equal(seen[0].opts.shell, false, "no shell on any platform");
});

test("⑨ 실행(실제 자식 프로세스): 공백·괄호가 든 SQL이 argv 한 칸으로 도착한다 — Windows 셸 분할 회귀", async () => {
  const { runWrangler, wranglerArgs } = await load();
  const dir = mkdtempSync(path.join(os.tmpdir(), "d1-readonly-argv-"));
  try {
    const echo = path.join(dir, "echo-argv.mjs");
    writeFileSync(echo, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    const r = runWrangler("envelope-fill-rate", { resolveBin: () => echo });
    assert.equal(r.status, 0, String(r.stderr ?? ""));
    assert.deepEqual(JSON.parse(r.stdout), wranglerArgs("envelope-fill-rate"), "the child saw exactly the argv we built");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⑨ ops-probe.yml: d1-readonly 선택지 · 질의 이름은 choice · env 경유 · 락파일 설치 · npx 없음", () => {
  const wf = readFileSync(path.join(REPO_ROOT, ".github/workflows/ops-probe.yml"), "utf8");
  assert.match(wf, /options:\s*\[[^\]]*d1-readonly[^\]]*\]/, "target choice includes d1-readonly");
  for (const name of NAMES) assert.ok(wf.includes(name), `query choice lists ${name}`);
  assert.match(wf, /scripts\/d1-readonly-queries\.mjs/);
  assert.ok(!/--command\s+["']?\$\{\{/.test(wf), "no workflow input is interpolated into --command");
  assert.ok(!/node scripts\/d1-readonly-queries\.mjs\s+["']?\$\{\{/.test(wf), "the query name reaches the script through env, not shell interpolation");
  assert.match(wf, /CLOUDFLARE_API_TOKEN:\s*\$\{\{/);
  assert.match(wf, /GITHUB_STEP_SUMMARY/);
  const job = wf.slice(wf.indexOf("  d1-readonly:"));
  assert.match(job, /pnpm install --frozen-lockfile --filter @simsa\/central-plane/, "wrangler comes from the lockfile");
  assert.ok(!/\bnpx\b/.test(job), "no npx in the d1-readonly job");
  assert.ok(!/wrangler@/.test(job), "no floating wrangler version in the job");
});

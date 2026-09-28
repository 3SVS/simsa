#!/usr/bin/env node
/**
 * d1-readonly-queries — Train W · W-V-0 도구 (ops-probe `d1-readonly`).
 *
 * 왜: W-V-0 "라이브 기준선 측정"은 D1의 region · envelope_json · finding_codes_json 채움을
 * 봐야 하는데, 그 확인이 사람이 Cloudflare 콘솔에서 SQL을 치는 일이면 (a) 누가 언제 무엇을
 * 봤는지 남지 않고 (b) 유저 식별·내용 컬럼이 화면에 쏟아진다. 그래서 **이름 붙은 질의 3개만**
 * 두고, 워크플로는 이름만 고른다. 자유 SQL 경로는 없다.
 *
 *   latest-visual-checks  최근 검수 5행: id · created_at · status · region · length(envelope_json)
 *                         · finding_codes_json · user_verdict · source_check_id
 *   latest-repair-jobs    최근 수리 5행: id · status · region · verify_check_id · resolved
 *   envelope-fill-rate    최근 검수 50행의 컬럼별 NULL 아님 개수
 *
 * 출력하지 않는 것: user_key · intent · target_url · agent_prompt · report_json · repo_full_name ·
 * pr_url · branch_name · error … (식별·내용). envelope_json은 크기(length)·개수(COUNT)로만.
 * 이 약속은 test/d1-readonly-queries.test.mjs가 고정한다(SELECT 한 문장뿐 · 금지 컬럼 0 · 실제
 * 마이그레이션 스키마에서 실행).
 *
 * Usage:  node scripts/d1-readonly-queries.mjs <query-name>      (cwd: apps/central-plane)
 * Env:    CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID as wrangler expects.
 * Output: 마크다운(stdout) — 워크플로가 $GITHUB_STEP_SUMMARY에 붙인다.
 * Wired:  .github/workflows/ops-probe.yml (target: d1-readonly, query: choice).
 *
 * 순수 부분(질의표·검사기·인자·렌더)은 export해 테스트하고, main만 wrangler를 부른다
 * (d1-migrations-gate.mjs와 같은 구조).
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const D1_DATABASE = "conclave-ai";

/** The only SQL this tool can run. Frozen; names are the whole interface. */
export const D1_READONLY_QUERIES = Object.freeze({
  "latest-visual-checks":
    "SELECT id, created_at, status, region, length(envelope_json) AS envelope_len, " +
    "finding_codes_json, user_verdict, source_check_id " +
    "FROM workspace_visual_checks ORDER BY created_at DESC LIMIT 5",
  "latest-repair-jobs":
    "SELECT id, status, region, verify_check_id, resolved " +
    "FROM workspace_repair_jobs ORDER BY created_at DESC LIMIT 5",
  "envelope-fill-rate":
    "SELECT COUNT(*) AS rows_scanned, COUNT(region) AS region_filled, " +
    "COUNT(envelope_json) AS envelope_filled, COUNT(finding_codes_json) AS finding_codes_filled, " +
    "COUNT(user_verdict) AS user_verdict_filled, COUNT(source_check_id) AS source_check_filled, " +
    "COUNT(locale) AS locale_filled " +
    "FROM workspace_visual_checks WHERE id IN " +
    "(SELECT id FROM workspace_visual_checks ORDER BY created_at DESC LIMIT 50)",
});

const WRITE_OR_ADMIN =
  /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/**
 * Throw unless `sql` is a single read-only SELECT statement. Defense in depth:
 * the table above is fixed, but main() re-checks whatever it is about to run.
 * @param {unknown} sql
 */
export function assertReadOnlySelect(sql) {
  const text = typeof sql === "string" ? sql.trim() : "";
  if (!/^SELECT\s/i.test(text)) throw new Error("d1-readonly: only a SELECT statement is allowed");
  if (/;\s*\S/.test(text) || /;/.test(text.replace(/;\s*$/, ""))) {
    throw new Error("d1-readonly: exactly one statement is allowed");
  }
  if (WRITE_OR_ADMIN.test(text)) throw new Error("d1-readonly: write/DDL/PRAGMA keywords are not allowed");
}

/**
 * Name → SQL. Unknown names (including SQL typed into the name slot, or
 * prototype keys) are rejected — there is no free-SQL path.
 * @param {unknown} name
 * @returns {string}
 */
export function resolveQuery(name) {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(D1_READONLY_QUERIES, name)) {
    const known = Object.keys(D1_READONLY_QUERIES).join(", ");
    throw new Error(`d1-readonly: unknown query ${JSON.stringify(name)} (known: ${known})`);
  }
  const sql = D1_READONLY_QUERIES[/** @type {keyof typeof D1_READONLY_QUERIES} */ (name)];
  assertReadOnlySelect(sql);
  return sql;
}

/**
 * wrangler arguments for a named query (no shell — passed as an argv array).
 * @param {unknown} name
 * @returns {string[]}
 */
export function wranglerArgs(name) {
  const sql = resolveQuery(name);
  return ["d1", "execute", D1_DATABASE, "--remote", "--json", "--command", sql];
}

/** One markdown table cell: NULL spelled out, pipes/newlines neutralized. */
function cell(v) {
  if (v === null || v === undefined) return "NULL";
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Render `wrangler d1 execute --json` output as a markdown section. Throws on
 * output that is not the expected JSON shape — "couldn't read it" must never
 * look like "zero rows".
 * @param {string} name
 * @param {string} jsonText
 * @returns {string}
 */
export function renderSummary(name, jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("d1-readonly: wrangler output is not JSON");
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const rows = first && typeof first === "object" ? /** @type {{ results?: unknown }} */ (first).results : undefined;
  if (!Array.isArray(rows)) throw new Error("d1-readonly: wrangler output has no results array");

  const lines = [`### d1-readonly · ${name}`, ""];
  if (rows.length === 0) {
    lines.push("_0 rows_");
    return `${lines.join("\n")}\n`;
  }
  /** @type {string[]} */
  const cols = [];
  for (const r of rows) {
    if (r && typeof r === "object") for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  }
  lines.push(`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    const o = r && typeof r === "object" ? /** @type {Record<string, unknown>} */ (r) : {};
    lines.push(`| ${cols.map((c) => cell(o[c])).join(" | ")} |`);
  }
  lines.push("", `_${rows.length} rows_`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const name = process.argv[2];
  let args;
  try {
    args = wranglerArgs(name);
  } catch (err) {
    console.error(String(/** @type {Error} */ (err).message ?? err));
    process.exit(2);
  }
  const run = spawnSync("npx", ["--yes", "wrangler@4", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) {
    console.error(`d1-readonly: wrangler exited ${run.status ?? "null"}`);
    console.error((run.stderr ?? "").slice(0, 2000));
    process.exit(1);
  }
  try {
    process.stdout.write(renderSummary(/** @type {string} */ (name), run.stdout ?? ""));
  } catch (err) {
    console.error(String(/** @type {Error} */ (err).message ?? err));
    console.error((run.stdout ?? "").slice(0, 2000));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

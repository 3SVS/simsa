#!/usr/bin/env node
/**
 * d1-readonly-queries — Train W · W-V-0 도구 (ops-probe `d1-readonly`).
 *
 * 왜: W-V-0 "라이브 기준선 측정"은 D1의 region · envelope_json · finding_codes_json 채움을
 * 봐야 하는데, 그 확인이 사람이 Cloudflare 콘솔에서 SQL을 치는 일이면 (a) 누가 언제 무엇을
 * 봤는지 남지 않고 (b) 유저 식별·내용 컬럼이 화면에 쏟아진다. 그래서 **이름 붙은 질의 3개만**
 * 두고, 워크플로는 이름만 고른다. 자유 SQL 경로는 없다.
 *
 *   latest-visual-check-fill  가장 최근 검수 1행의 채움 여부(region·envelope·finding_codes·locale)
 *                             + 날짜(일 단위)
 *   envelope-fill-rate        최근 검수 50행의 컬럼별 NULL 아님 개수
 *   repair-fill-rate          최근 수리 50행의 region·verify 연결·resolved 기록 개수
 *
 * ★출력 채널이 공개다 (PR #561 검증 P2). 3SVS/simsa는 PUBLIC 저장소라 Actions job summary와
 * 로그를 로그인한 누구나 읽는다. 그래서 출력은 **개수·채움 여부·날짜뿐**이다 — id·*_id(런 id는
 * 수리 신호 위조의 열쇠였다), 초 단위 시각, 국가 값, 사람 판정 값, 수리 해결 여부 값은 내지
 * 않는다(이용자가 적을 때는 국가 + 초 단위 시각 + 판정만으로 사람을 가리킬 수 있다). 선택
 * 항목의 모양 자체를 test/d1-readonly-queries.test.mjs가 화이트리스트로 고정한다.
 *
 * 출력하지 않는 것: user_key · intent · target_url · agent_prompt · report_json · repo_full_name ·
 * pr_url · branch_name · error … (식별·내용). envelope_json은 개수·채움 여부로만.
 *
 * ★wrangler는 락파일이 고정한 로컬 bin을 node로 직접 실행한다(PR #561 검증 P2). 예전
 * `npx --yes wrangler@4`는 실행마다 레지스트리의 최신 4.x를 받아 Workers·D1 Edit 권한 토큰을
 * 넘겼다. 셸도 쓰지 않는다 — Windows에서 `shell: true`가 SQL을 공백마다 argv로 쪼갰다.
 *
 * Usage:  node scripts/d1-readonly-queries.mjs <query-name>      (cwd: apps/central-plane,
 *         after `pnpm install` so node_modules/wrangler exists)
 * Env:    CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID as wrangler expects (a D1-read-only
 *         token is enough and preferred — see ops-probe.yml).
 * Output: 마크다운(stdout) — 워크플로가 $GITHUB_STEP_SUMMARY에 붙인다.
 * Wired:  .github/workflows/ops-probe.yml (target: d1-readonly, query: choice).
 *
 * 순수 부분(질의표·검사기·인자·렌더)과 실행기(runWrangler, spawn 주입 가능)를 export해
 * 테스트하고, main만 실제로 wrangler를 부른다(d1-migrations-gate.mjs와 같은 구조).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const D1_DATABASE = "conclave-ai";

/** The only SQL this tool can run. Frozen; names are the whole interface. */
export const D1_READONLY_QUERIES = Object.freeze({
  "latest-visual-check-fill":
    "SELECT (region IS NOT NULL) AS region_filled, (envelope_json IS NOT NULL) AS envelope_filled, " +
    "(finding_codes_json IS NOT NULL) AS finding_codes_filled, (locale IS NOT NULL) AS locale_filled, " +
    "substr(created_at, 1, 10) AS created_day " +
    "FROM workspace_visual_checks ORDER BY created_at DESC LIMIT 1",
  "envelope-fill-rate":
    "SELECT COUNT(*) AS rows_scanned, COUNT(region) AS region_filled, " +
    "COUNT(envelope_json) AS envelope_filled, COUNT(finding_codes_json) AS finding_codes_filled, " +
    "COUNT(user_verdict) AS user_verdict_filled, COUNT(source_check_id) AS source_check_filled, " +
    "COUNT(locale) AS locale_filled " +
    "FROM workspace_visual_checks WHERE id IN " +
    "(SELECT id FROM workspace_visual_checks ORDER BY created_at DESC LIMIT 50)",
  "repair-fill-rate":
    "SELECT COUNT(*) AS rows_scanned, COUNT(region) AS region_filled, " +
    "COUNT(verify_check_id) AS verify_linked, COUNT(resolved) AS resolved_recorded " +
    "FROM workspace_repair_jobs WHERE id IN " +
    "(SELECT id FROM workspace_repair_jobs ORDER BY created_at DESC LIMIT 50)",
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

/**
 * The wrangler this package locked (apps/central-plane devDependency, pinned by
 * pnpm-lock.yaml) — its JS entry, run with node. Never `npx wrangler@<range>`:
 * that downloads whatever the registry serves today and hands it the token.
 * @returns {string}
 */
export function resolveWranglerBin() {
  const require = createRequire(import.meta.url);
  let pkgPath;
  try {
    pkgPath = require.resolve("wrangler/package.json");
  } catch {
    throw new Error("d1-readonly: wrangler is not installed here — run `pnpm install --frozen-lockfile` first");
  }
  /** @type {{ bin?: string | Record<string, string> }} */
  const pkg = require(pkgPath);
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["wrangler"];
  if (typeof rel !== "string" || !rel) throw new Error("d1-readonly: the installed wrangler declares no bin");
  return path.resolve(path.dirname(pkgPath), rel);
}

/**
 * Run a named query: `node <locked wrangler bin> d1 execute …`. No shell on any
 * platform, so each argv element — the SQL included — reaches wrangler whole
 * (on Windows `shell: true` re-joined the argv with spaces and the SQL fell
 * apart into words). `spawn` / `resolveBin` are seams for tests.
 * @param {unknown} name
 * @param {{ spawn?: typeof spawnSync, resolveBin?: () => string }} [seams]
 */
export function runWrangler(name, { spawn = spawnSync, resolveBin = resolveWranglerBin } = {}) {
  const args = wranglerArgs(name);
  return spawn(process.execPath, [resolveBin(), ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
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
  let run;
  try {
    run = runWrangler(name);
  } catch (err) {
    console.error(String(/** @type {Error} */ (err).message ?? err));
    process.exit(2);
  }
  if (run.error || run.status !== 0) {
    console.error(`d1-readonly: wrangler exited ${run.status ?? "null"}${run.error ? ` (${run.error.message})` : ""}`);
    // stderr only — wrangler's stdout here is query output, which belongs in the
    // (public) summary only after renderSummary has shaped it.
    console.error(String(run.stderr ?? "").slice(0, 2000));
    process.exit(1);
  }
  try {
    process.stdout.write(renderSummary(/** @type {string} */ (name), String(run.stdout ?? "")));
  } catch (err) {
    // Never dump raw stdout into a public log: it could hold rows in a shape we
    // did not expect. Say what was wrong, not what was there.
    console.error(String(/** @type {Error} */ (err).message ?? err));
    console.error(`d1-readonly: stdout was ${String(run.stdout ?? "").length} chars (not echoed — public log)`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

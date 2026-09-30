#!/usr/bin/env node
/**
 * pilot-metrics — Train P · P-2 파일럿 지표 (신규, 2026-09-30).
 *
 * 파일럿 프로젝트 id와 정답지 파일을 받아 다음을 JSON + 마크다운 표로 낸다
 * (정의 = docs/pilot-2026-10/RUNBOOK.md §4, 규칙 = §5 — 둘 다 실행 전 사전 등록):
 *   ① 6축 채움(region · built_with · topic · finding_code · user_verdict · resolved) — 축마다 출처 하나
 *   ② 기계 판정 ↔ 사람 라벨 일치(정답지 '기대 판정' · 런별 user_verdict) — 원문 판정 문구·발견 코드 함께
 *   ③ 건별 시간(런 생성→완료는 D1 행이 있을 때만) · 재검수 여부
 *   ④ 정답지 '예상 실패 지점' ↔ 기계 발견을 나란히 — **적중 여부는 사람이 적는다(자동 판정 안 함)**
 *   + 정답지 선기록(git 첫 커밋 < 첫 런) · 실행 뒤 기대 칸 변경 여부 · 원가 수기 시트 · 규칙 5개 입력값
 *
 * 데이터원(읽기 전용):
 *   - 기본: 기존 GET API — /workspace/projects/:id · …/visual-checks · …/visual-checks/:runId ·
 *     …/visual-checks/:runId/repair. userKey가 필요하다(파일럿 = Bae 브라우저의 userKey).
 *     ★부작용 1건: 끝난 런의 상세 GET은 서버에 '리포트 열람' 사용 이벤트(workspace_report_viewed)를
 *     1건 남긴다(apps/central-plane/src/routes/workspace-visual-checks.ts GET :runId). 퍼널 분석에서
 *     파일럿 userKey는 뺀다.
 *   - 선택: --d1-rows <file> 로컬 wrangler로 뽑은 D1 행(완료 시각·런 region) — --print-d1-sql이 질의를 준다.
 *   - 선택: --ops-fill <file> ops-probe d1-readonly 집계(서비스 전체 최근 행, 파일럿 한정 아님).
 *   - 선택: --snapshot-in <file> 이전 출력 JSON으로 네트워크 없이 재계산(정답지·시트는 다시 읽는다).
 *
 * userKey: SIMSA_USER_KEY 환경변수 또는 --user-key-file <path>(권장) · --user-key <값>(셸 기록에 남음).
 * 출력·로그·오류 문구에 userKey 원문을 넣지 않는다 — 수집은 화이트리스트, 오류는 엔드포인트 이름·
 * 상태 코드·오류 코드만. 그래도 출력 원문(JSON·마크다운)에 userKey가 있으면 **가리지 않고 멈춘다**
 * (fail-closed — 파일을 쓰지 않고 새는 칸의 경로만 알린다). 콘솔 오류 문구만 redact로 가린다.
 *
 * Usage (저장소 루트에서):
 *   SIMSA_USER_KEY=uk_... node tools/simsa-completion-loop-spike/pilot-metrics.mjs \
 *     --case proj_abc123=docs/pilot-2026-10/answer-key-01-예약앱.md \
 *     --case proj_def456=docs/pilot-2026-10/answer-key-02-가계부.md \
 *     --sheet docs/pilot-2026-10/cost-sheet.md
 * 출력: tools/simsa-completion-loop-spike/pilot-metrics-out/pilot-metrics-<시각>.{json,md} (gitignore —
 *   JSON에는 전체 id·앱 주소·초 단위 시각이 있다. 마크다운(기본 가림 판)은 런 id 대신 건 안 순번,
 *   분 단위 시각, region은 '기록됨'만 — 공개 저장소에 붙일 때는 .md만, 조건은 RUNBOOK §7.)
 *
 * 테스트: test/pilot-metrics.test.mjs (node --test, 네트워크 없음 — fetch·git은 주입).
 */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  sanitizeProject,
  sanitizeRun,
  mergeD1Rows,
  parseAnswerKey,
  parseCostSheet,
  parseOpsFill,
  checkPreRegistration,
  computeCase,
  summarize,
  evaluateRules,
  renderMarkdown,
  redact,
  assertNoSecret,
  secretPaths,
  AXES,
} from "./lib/pilot-metrics.mjs";

export const DEFAULT_BASE = "https://conclave-ai.seunghunbae.workers.dev";
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_DIR = path.join(HERE, "pilot-metrics-out");

const PROJECT_ID_RE = /^proj_[a-z0-9]{3,32}$/;
const RUN_ID_RE = /^wvc_[a-z0-9]{3,32}$/;

/**
 * CLI 인자 → 옵션. `--case <projectId>[=<정답지 경로>]`는 여러 번. 경로에 한글·공백 가능.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      case: { type: "string", multiple: true },
      base: { type: "string" },
      "user-key": { type: "string" },
      "user-key-file": { type: "string" },
      "d1-rows": { type: "string" },
      "ops-fill": { type: "string" },
      sheet: { type: "string" },
      "snapshot-in": { type: "string" },
      "out-dir": { type: "string" },
      "no-mask": { type: "boolean" },
      "print-d1-sql": { type: "boolean" },
    },
  });
  const cases = (values.case ?? []).map((raw) => {
    const eq = raw.indexOf("=");
    const projectId = (eq >= 0 ? raw.slice(0, eq) : raw).trim();
    const answerKeyPath = eq >= 0 ? raw.slice(eq + 1).trim() || null : null;
    if (!PROJECT_ID_RE.test(projectId)) throw new Error(`pilot-metrics: 프로젝트 id 모양이 아니에요: ${JSON.stringify(projectId)} (proj_… 형식)`);
    return { projectId, answerKeyPath };
  });
  return {
    cases,
    base: (values.base ?? DEFAULT_BASE).replace(/\/+$/, ""),
    userKeyArg: values["user-key"] ?? null,
    userKeyFile: values["user-key-file"] ?? null,
    d1Rows: values["d1-rows"] ?? null,
    opsFill: values["ops-fill"] ?? null,
    sheet: values.sheet ?? null,
    snapshotIn: values["snapshot-in"] ?? null,
    outDir: values["out-dir"] ?? DEFAULT_OUT_DIR,
    maskIds: !values["no-mask"],
    printD1Sql: Boolean(values["print-d1-sql"]),
  };
}

/** userKey 출처 우선순위: 파일 > 환경변수 > 인자. 값만 돌려주고 어디에도 찍지 않는다. */
export function resolveUserKey(opts, env, readFile = (p) => readFileSync(p, "utf8")) {
  if (opts.userKeyFile) {
    const v = String(readFile(opts.userKeyFile)).trim();
    return v || null;
  }
  if (typeof env?.SIMSA_USER_KEY === "string" && env.SIMSA_USER_KEY.trim()) return env.SIMSA_USER_KEY.trim();
  if (opts.userKeyArg && opts.userKeyArg.trim()) return opts.userKeyArg.trim();
  return null;
}

/** 로컬 wrangler로 돌릴 읽기 전용 질의(내용·식별 컬럼 없음). id는 정규식으로 검증된 것만 들어간다. */
export function d1SqlFor(projectIds) {
  const ids = projectIds.filter((id) => PROJECT_ID_RE.test(id));
  if (ids.length === 0) throw new Error("pilot-metrics: 유효한 프로젝트 id가 없어요");
  return (
    "SELECT id, project_id, status, created_at, updated_at, region, finding_codes_json, source_check_id " +
    `FROM workspace_visual_checks WHERE project_id IN (${ids.map((id) => `'${id}'`).join(", ")}) ORDER BY created_at`
  );
}

function errName(err) {
  const n = err && typeof err === "object" && typeof err.name === "string" ? err.name : "Error";
  return /^[A-Za-z]{1,40}$/.test(n) ? n : "Error";
}

function errCode(body) {
  const e = body && typeof body === "object" ? body.error : null;
  return typeof e === "string" && /^[a-z0-9_]{1,64}$/.test(e) ? ` ${e}` : "";
}

/**
 * 건 하나를 API로 모은다. 오류 문구엔 **URL을 넣지 않는다**(쿼리에 userKey가 있다) — 엔드포인트 이름,
 * 상태 코드, 서버 오류 코드(영소문자만)만. 네트워크 예외는 이름만(메시지에 URL이 들어갈 수 있다).
 * @param {{ base: string, projectId: string, userKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} args
 */
export async function collectCase({ base, projectId, userKey, fetchImpl = fetch, timeoutMs = 30000 }) {
  const errors = [];
  const q = `userKey=${encodeURIComponent(userKey)}`;
  const pid = encodeURIComponent(projectId);
  const get = async (label, url) => {
    let res;
    try {
      res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      errors.push(`${label}: 요청 실패 (${errName(err)})`);
      return null;
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.ok !== true) {
      errors.push(`${label}: HTTP ${res.status}${errCode(body)}`);
      return null;
    }
    return body;
  };

  const projBody = await get("GET /workspace/projects/:id", `${base}/workspace/projects/${pid}?${q}`);
  const listBody = await get("GET /workspace/projects/:id/visual-checks", `${base}/workspace/projects/${pid}/visual-checks?${q}`);
  const items = (Array.isArray(listBody?.checks) ? listBody.checks : [])
    .filter((it) => it && typeof it === "object")
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  const runs = [];
  for (const item of items) {
    const runId = String(item.id ?? "");
    if (!RUN_ID_RE.test(runId)) {
      errors.push("목록에 런 id 모양이 아닌 항목이 있어 건너뜀");
      continue;
    }
    const rid = encodeURIComponent(runId);
    const detail = await get("GET /workspace/projects/:id/visual-checks/:runId", `${base}/workspace/projects/${pid}/visual-checks/${rid}?${q}`);
    const repair = await get(
      "GET /workspace/projects/:id/visual-checks/:runId/repair",
      `${base}/workspace/projects/${pid}/visual-checks/${rid}/repair?${q}`,
    );
    runs.push(sanitizeRun({ item, detail: detail?.check ?? null, repair: repair?.repair ?? null }));
  }
  return { project: projBody ? sanitizeProject(projBody.project) : null, runs, errors: errors.map((e) => redact(e, [userKey])) };
}

/**
 * git 읽기 seam. 경로는 파일의 폴더를 cwd로 두고 basename으로 넘긴다(Windows·한글 경로 안전,
 * 셸 없음). 못 읽으면 null.
 * @param {typeof spawnSync} [spawn]
 */
export function makeGitSeam(spawn = spawnSync) {
  const run = (absPath, args) => {
    const r = spawn("git", ["-c", "core.quotepath=off", ...args], {
      cwd: path.dirname(absPath),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout ?? "");
  };
  return {
    /** 최신순 [{sha, committedAt}] | null */
    log(absPath) {
      const out = run(absPath, ["log", "--follow", "--format=%H%x09%cI", "--", path.basename(absPath)]);
      if (out === null) return null;
      return out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [sha, committedAt] = l.split("\t");
          return { sha, committedAt };
        })
        .filter((c) => /^[0-9a-f]{7,64}$/.test(c.sha ?? "") && c.committedAt);
    },
    show(absPath, sha) {
      if (!/^[0-9a-f]{7,64}$/.test(sha)) return null;
      return run(absPath, ["show", `${sha}:./${path.basename(absPath)}`]);
    },
    dirty(absPath) {
      const out = run(absPath, ["status", "--porcelain", "--", path.basename(absPath)]);
      return out === null ? null : out.trim().length > 0;
    },
  };
}

function parseD1RowsText(text) {
  const parsed = JSON.parse(text);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (first && typeof first === "object" && Array.isArray(first.results)) return first.results;
  if (Array.isArray(parsed)) return parsed;
  throw new Error("pilot-metrics: --d1-rows 모양을 모름 (wrangler --json 출력 또는 행 배열)");
}

/**
 * 전체 실행(파일 쓰기 없음). seams: fetchImpl · git · readFile · now · cwd.
 * @returns {Promise<{ result: any, markdown: string, json: string }>}
 */
export async function runPilotMetrics(opts, seams = {}) {
  const readFile = seams.readFile ?? ((p) => readFileSync(p, "utf8"));
  const git = seams.git ?? makeGitSeam();
  const now = seams.now ?? (() => new Date());
  const cwd = seams.cwd ?? process.cwd();
  const userKey = seams.userKey ?? null;
  if (opts.cases.length === 0 && !opts.snapshotIn) throw new Error("pilot-metrics: --case가 하나도 없어요");

  // 이전 출력(JSON)으로 재계산 — 네트워크 없음.
  let snapshot = null;
  if (opts.snapshotIn) {
    const prev = JSON.parse(readFile(opts.snapshotIn));
    snapshot = new Map((prev.cases ?? []).map((c) => [c.projectId, c]));
    if (opts.cases.length === 0) {
      opts = { ...opts, cases: (prev.cases ?? []).map((c) => ({ projectId: c.projectId, answerKeyPath: c.answerKeyPath ?? null })) };
    }
  } else if (!userKey) {
    throw new Error("pilot-metrics: userKey가 없어요 — SIMSA_USER_KEY 또는 --user-key-file (또는 --snapshot-in으로 재계산)");
  }

  const d1Rows = opts.d1Rows ? parseD1RowsText(readFile(opts.d1Rows)) : null;
  const opsFill = opts.opsFill ? parseOpsFill(readFile(opts.opsFill)) : null;
  const sheet = opts.sheet ? parseCostSheet(readFile(opts.sheet)) : null;

  const cases = [];
  for (const { projectId, answerKeyPath } of opts.cases) {
    let collected;
    if (snapshot) {
      const prev = snapshot.get(projectId);
      collected = prev?.collected
        ? { project: prev.collected.project, runs: prev.collected.runs ?? [], errors: prev.collected.errors ?? [] }
        : { project: null, runs: [], errors: ["스냅샷에 이 프로젝트가 없어요"] };
    } else {
      collected = await collectCase({ base: opts.base, projectId, userKey, fetchImpl: seams.fetchImpl ?? fetch });
    }
    if (d1Rows) collected = { ...collected, runs: mergeD1Rows(collected.runs, d1Rows) };

    let answerKey = null;
    let preRegistration = null;
    const extraErrors = [];
    if (answerKeyPath) {
      const abs = path.resolve(cwd, answerKeyPath);
      let text = null;
      try {
        text = readFile(abs);
      } catch (err) {
        extraErrors.push(`정답지를 읽지 못함 (${errName(err)})`);
      }
      if (text !== null) {
        answerKey = parseAnswerKey(text);
        const firstRunCreatedAt = [...collected.runs].map((r) => r.createdAt).filter(Boolean).sort()[0] ?? null;
        preRegistration = checkPreRegistration({
          commits: git.log(abs),
          dirty: git.dirty(abs),
          firstRunCreatedAt,
          currentText: text,
          textAt: (sha) => git.show(abs, sha),
        });
      }
    }
    const c = computeCase({ projectId, answerKeyPath, answerKey, collected, preRegistration, sheetRow: null, extraErrors });
    c.sheet = sheet && c.caseNo !== null ? sheet.get(c.caseNo) ?? null : null;
    cases.push(c);
  }

  const result = {
    tool: "pilot-metrics",
    version: 1,
    generatedAt: now().toISOString(),
    sources: {
      api: snapshot ? null : opts.base,
      snapshotIn: opts.snapshotIn ?? null,
      d1Rows: Boolean(d1Rows),
      opsFill: Boolean(opsFill),
      sheet: opts.sheet ?? null,
      userKey: userKey ? "provided" : "absent",
    },
    definitions: {
      runbook: "docs/pilot-2026-10/RUNBOOK.md §4 (정의) · §5 (규칙)",
      axes: AXES,
    },
    summary: summarize(cases),
    rules: evaluateRules(cases),
    opsFill,
    cases,
  };
  // fail-closed (PR #570 검증 P2): 가리기 전의 **원문**을 검사해 userKey가 있으면 가리지 않고 멈춘다.
  // 수집은 화이트리스트라 여기서 걸리면 화이트리스트 회귀다 — [REDACTED]로 조용히 쓰면 그 회귀가
  // 드러나지 않는다. 멈출 때는 어느 칸인지(경로)만 알린다(값은 넣지 않는다).
  const secrets = userKey ? [userKey] : [];
  const json = JSON.stringify(result, null, 2);
  const markdown = renderMarkdown(result, { maskIds: opts.maskIds !== false });
  assertNoSecret(json, secrets, secretPaths(result, secrets));
  assertNoSecret(markdown, secrets, ["마크다운"]);
  return { result, markdown, json };
}

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(/** @type {Error} */ (err).message ?? err));
    process.exit(2);
  }
  if (opts.printD1Sql) {
    process.stdout.write(`${d1SqlFor(opts.cases.map((c) => c.projectId))}\n`);
    return;
  }
  if (opts.userKeyArg) {
    console.error("주의: --user-key 값은 셸 기록에 남아요. SIMSA_USER_KEY 환경변수나 --user-key-file을 권장합니다.");
  }
  let userKey = null;
  try {
    userKey = opts.snapshotIn ? null : resolveUserKey(opts, process.env);
  } catch (err) {
    console.error(`pilot-metrics: userKey 파일을 읽지 못했어요 (${errName(err)})`);
    process.exit(2);
  }
  try {
    const { result, markdown, json } = await runPilotMetrics(opts, { userKey });
    mkdirSync(opts.outDir, { recursive: true });
    const stamp = result.generatedAt.replace(/[:.]/g, "-");
    const jsonPath = path.join(opts.outDir, `pilot-metrics-${stamp}.json`);
    const mdPath = path.join(opts.outDir, `pilot-metrics-${stamp}.md`);
    writeFileSync(jsonPath, json, "utf8");
    writeFileSync(mdPath, markdown, "utf8");
    console.log(`JSON: ${jsonPath}`);
    console.log(`마크다운: ${mdPath}`);
    for (const r of result.rules) console.log(`${r.id} ${r.status} — ${r.measured}`);
    const errs = result.cases.reduce((n, c) => n + c.errors.length, 0);
    if (errs) console.log(`오류 ${errs}건 — 마크다운 §10 참고`);
  } catch (err) {
    console.error(redact(String(/** @type {Error} */ (err).message ?? err), userKey ? [userKey] : []));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

/**
 * train-w-build-verified.test.mjs — Train W · W-3 (재정렬 §1 #7 · D-4 keep: 게이트가 아니라 라벨).
 *
 * Contract 3 (서버↔대시보드, #558과 같은 계약):
 *   수리 컨테이너의 사후 검증은 `node --check`(.js/.mjs — 컨테이너 정규식은 .cjs 포함)뿐이다.
 *   변경 파일(autoFix.changedFiles — 함께 커밋되는 SIMSA-FIX-BRIEF.md 제외)에 그 밖의 확장자가
 *   하나라도 있으면:
 *     - 커밋 메시지 트레일러 `Simsa-Build: unverified`
 *     - PR 본문 상단 주의 문단(KO/EN, 잡 locale) + 라벨 `build: unverified`(best-effort)
 *     - 잡 뷰 `buildVerified: false`
 *   전부 검사 대상이고 통과 → `buildVerified: true`. brief_only · 레거시 · 판단 불가 → null.
 *
 * Pins (과제 테스트 ⑧):
 *   - buildAutoFixPrContent (컨테이너가 in-image로 컴파일하는 정본): ts 포함 → 트레일러·본문 주의·
 *     buildVerified:false · 라벨 / mjs만 → true · 트레일러·주의 없음
 *   - 트레일러는 git이 실제로 트레일러로 읽는다(임시 저장소에 커밋해 `%(trailers)` 확인)
 *   - 컨테이너 콜백 값: repairBuildVerified(mode, prContent) — auto_fix만 boolean, 나머지 null
 *   - 서버: /internal/repair-done → 잡 뷰 buildVerified (새 컬럼 없이 — 마이그레이션 없음)
 *   - server.mjs 배선: 콜백에 buildVerified, 라벨은 false일 때만, 검사 정규식 lock-step
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const brief = await import("../dist/workspace/repair-brief.js");
const coerce = await import("../container/coerce-result.mjs");
const { createApp } = await import("../dist/router.js");
const { encryptToken } = await import("../dist/crypto.js");
const { dailyCapsRun } = await import("./_daily-caps-fake.mjs");

const noHangul = (s) => !/[가-힣]/.test(s);

function prInput(over = {}) {
  return {
    runId: "wvc_bv",
    intent: "신청서를 끝까지 낼 수 있어야 한다",
    decision: "Needs Fix",
    targetUrl: "https://apply.example.app/",
    visualCheckId: "wvc_bv",
    findings: [{ severity: "blocker", severityLabel: "높음", what: "제출 버튼이 반응하지 않음", how: "onClick 연결" }],
    changedFiles: ["src/app/page.tsx", "lib/submit.mjs"],
    workerCommitMessage: "fix(form): wire submit",
    ...over,
  };
}

/** Last paragraph of a commit message body = where git looks for trailers. */
function lastParagraph(text) {
  const paras = text.trim().split(/\n\s*\n/);
  return paras[paras.length - 1] ?? "";
}

// ─── pure: buildAutoFixPrContent ─────────────────────────────────────────────

test("⑧ ts 변경 포함 → buildVerified:false · 커밋 트레일러 · PR 본문 상단 주의(KO) · 라벨", () => {
  const out = brief.buildAutoFixPrContent(prInput());
  assert.equal(out.buildVerified, false);
  assert.equal(lastParagraph(out.commitBody), "Simsa-Build: unverified", "trailer must be the last paragraph");
  assert.deepEqual(out.labels, ["build: unverified"]);
  // Notice is at the TOP of the body (before the result heading), names the
  // files outside the check and only those.
  const noticeEnd = out.body.indexOf("## Simsa 자동 수리 결과");
  assert.ok(noticeEnd > 0, "result heading still present, after the notice");
  const notice = out.body.slice(0, noticeEnd);
  assert.match(notice, /build: unverified/);
  assert.match(notice, /빌드되는지는 확인하지 못했어요/);
  assert.match(notice, /node --check/);
  assert.ok(notice.includes("`src/app/page.tsx`"), "unverified file is named");
  assert.ok(!notice.includes("lib/submit.mjs"), "a syntax-checked file is not listed as unverified");
});

test("⑧ 잡 locale=en → 주의 문단 영어 · 한글 0", () => {
  const out = brief.buildAutoFixPrContent(prInput({
    locale: "en",
    intent: "Applicants can submit the form",
    findings: [{ severity: "blocker", severityLabel: "high", what: "Submit does nothing", how: "Wire onClick" }],
  }));
  assert.equal(out.buildVerified, false);
  const notice = out.body.slice(0, out.body.indexOf("## Simsa auto-repair result"));
  assert.match(notice, /build: unverified/);
  assert.match(notice, /could not confirm/i);
  for (const text of [out.body, out.commitBody, out.title]) assert.ok(noHangul(text), text.slice(0, 200));
  assert.equal(lastParagraph(out.commitBody), "Simsa-Build: unverified", "trailer is locale-invariant");
});

test("⑧ .mjs · .js만 변경 → buildVerified:true · 트레일러·주의·라벨 없음", () => {
  const out = brief.buildAutoFixPrContent(prInput({ changedFiles: ["lib/submit.mjs", "public/app.js"] }));
  assert.equal(out.buildVerified, true);
  assert.ok(!out.commitBody.includes("Simsa-Build"), "no trailer when every changed file was checked");
  assert.ok(!out.body.includes("build: unverified"));
  assert.ok(out.body.startsWith("## Simsa 자동 수리 결과"), "body unchanged at the top");
  assert.deepEqual(out.labels, []);
});

test("⑧ 검사 밖 확장자 각각(ts·tsx·css·json·html·vue·py) → false, 검사 대상(js·mjs·cjs, 대소문자 무관) → true", () => {
  for (const f of ["a.ts", "b.tsx", "c.css", "d.json", "index.html", "e.vue", "f.py", "Makefile"]) {
    assert.equal(brief.assessBuildVerified([f]), false, f);
    assert.equal(brief.assessBuildVerified(["ok.mjs", f]), false, `mixed with ${f}`);
  }
  for (const f of ["a.js", "b.mjs", "c.cjs", "D.JS"]) assert.equal(brief.assessBuildVerified([f]), true, f);
  assert.equal(brief.assessBuildVerified([]), false, "nothing checked is not 'verified'");
});

test("⑧ SIMSA-FIX-BRIEF.md는 계산에 들어가지 않는다 — changedFiles(워커 변경분)만 본다", () => {
  // The container commits the brief alongside, but buildAutoFixPrContent only
  // ever receives autoFix.changedFiles (git diff before the brief is written).
  const out = brief.buildAutoFixPrContent(prInput({ changedFiles: ["lib/submit.mjs"] }));
  assert.equal(out.buildVerified, true);
});

// ─── real git: the trailer parses as a trailer ───────────────────────────────

test("⑧ 트레일러는 git이 트레일러로 읽는다 (임시 저장소 실커밋, 컨테이너와 같은 -m 두 개)", (t) => {
  let dir;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git not available");
    return;
  }
  const out = brief.buildAutoFixPrContent(prInput());
  dir = mkdtempSync(path.join(os.tmpdir(), "train-w-trailer-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "simsa-repair[bot]");
    git("config", "user.email", "simsa-repair@example.invalid");
    git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(dir, "page.tsx"), "export default 1;\n");
    git("add", "page.tsx");
    git("commit", "-q", "-m", out.commitMessage, "-m", out.commitBody);
    const trailer = git("log", "-1", "--format=%(trailers:key=Simsa-Build,valueonly)").trim();
    assert.equal(trailer, "unverified");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── container callback value ────────────────────────────────────────────────

test("⑧ 컨테이너 콜백 값 repairBuildVerified: auto_fix만 boolean, brief_only·판단 불가 → null", () => {
  assert.equal(typeof coerce.repairBuildVerified, "function");
  assert.equal(coerce.repairBuildVerified("auto_fix", { buildVerified: false }), false);
  assert.equal(coerce.repairBuildVerified("auto_fix", { buildVerified: true }), true);
  assert.equal(coerce.repairBuildVerified("brief_only", { buildVerified: false }), null);
  assert.equal(coerce.repairBuildVerified("auto_fix", {}), null, "an older brief module without the field → undecidable");
  assert.equal(coerce.repairBuildVerified("auto_fix", null), null);
});

// ─── server.mjs wiring (source invariants — the container cannot run in node --test) ─

const serverMjs = readFileSync(path.join(ROOT, "container/server.mjs"), "utf8");

test("⑧ server.mjs: repair-done 콜백에 buildVerified를 싣는다(repairBuildVerified 경유)", () => {
  assert.match(serverMjs, /repairBuildVerified\(/, "server.mjs must derive the callback value with repairBuildVerified");
  const cb = serverMjs.slice(serverMjs.indexOf("// 6. Report done."));
  assert.match(cb.slice(0, 800), /buildVerified/, "the done callback payload carries buildVerified");
});

test("⑧ server.mjs: 라벨은 buildVerified === false일 때만, 실패해도 잡을 죽이지 않는다", () => {
  assert.match(serverMjs, /buildVerified === false/);
  assert.match(serverMjs, /issues\/\$\{[^}]+\}\/labels/, "labels go through the issues labels endpoint");
  const fn = serverMjs.slice(serverMjs.indexOf("async function addRepairPrLabels"));
  assert.ok(fn.length > 0 && serverMjs.includes("async function addRepairPrLabels"));
  assert.match(fn.slice(0, 1500), /catch/, "label failure is swallowed (a label is not a gate — D-4)");
});

test("⑧ lock-step: server.mjs quickSyntaxCheck 정규식 = repair-brief SYNTAX_CHECKED_FILE_RE", () => {
  const m = /async function quickSyntaxCheck[\s\S]*?if \(!(\/[^\n]+?\/[a-z]*)\.test\(rel\)\)/.exec(serverMjs);
  assert.ok(m, "quickSyntaxCheck must filter with a regex literal");
  assert.equal(m[1], String(brief.SYNTAX_CHECKED_FILE_RE), "the files node --check covers = the files counted as verified");
});

// ─── server: /internal/repair-done → job view ────────────────────────────────

const USER = "uk_owner";
const PROJECT = "proj_bv";
const RUN = "wvc_bvrun";
const TOKEN = "tok_internal_fake";
const KEK = randomBytes(32).toString("base64");
const GH_TOKEN_ENC = await encryptToken("gho_fakeOauthTokenForTests", KEK);

function makeDb() {
  const jobs = [];
  const rate = new Map(); // daily caps — modeled, see _daily-caps-fake.mjs
  const checks = [{
    id: RUN, project_id: PROJECT, user_key: USER,
    target_url: "https://apply.example.app/", intent: "신청서 제출",
    decision: "Needs Fix", works: 0, status: "done", executor: "container",
    report_json: "{}", agent_prompt: "[고칠 문제] 제출 버튼", evidence_keys_json: "[]",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  }];
  const project = {
    id: PROJECT, user_key: USER, title: "t", idea: "i",
    understood_json: "{}", product_spec_json: "{}", items_json: "[]",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
  const repo = {
    id: "wpr_1", project_id: PROJECT, user_key: USER, github_connection_id: "wgc_1",
    repo_id: "1", repo_full_name: "acme/apply", repo_owner: "acme", repo_name: "apply",
    default_branch: "main", private: 0, html_url: "https://github.com/acme/apply",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
  const connection = {
    id: "wgc_1", user_key: USER, github_user_id: "77", github_login: "acme-user",
    github_name: null, avatar_url: null, access_token_enc: GH_TOKEN_ENC, scopes: "read:user public_repo",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
  };
  return {
    jobs,
    prepare(sql) {
      function h(args) {
        return {
          async run() {
            const capped = dailyCapsRun(rate, sql, args);
            if (capped) return capped;
            if (sql.includes("INSERT INTO workspace_repair_jobs")) {
              const [id, project_id, user_key, visual_check_id, repo_full_name, branch_name, env_cause, region, created_at, updated_at] = args;
              jobs.push({
                id, project_id, user_key, visual_check_id, repo_full_name, status: "queued", branch_name,
                pr_url: null, pr_number: null, env_cause, mode: null, changed_files: null, error: null,
                region, verify_check_id: null, resolved: null, created_at, updated_at,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("workspace_repair_jobs") && sql.includes("SET status = 'done'")) {
              // Same slot order the existing repair test pins (no new column).
              const [pr_url, pr_number, branch_name, env_flag, mode, changed_files, diag, updated_at, id] = args;
              const row = jobs.find((r) => r.id === id);
              if (row) {
                Object.assign(row, {
                  status: "done",
                  pr_url: pr_url ?? row.pr_url,
                  pr_number: pr_number ?? row.pr_number,
                  branch_name: branch_name ?? row.branch_name,
                  mode: mode ?? row.mode,
                  changed_files: changed_files ?? row.changed_files,
                  error: diag ?? row.error,
                  updated_at,
                });
                if (env_flag === 1) row.env_cause = 1;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            if (sql.includes("FROM workspace_projects WHERE id = ?")) return args[0] === PROJECT ? project : null;
            if (sql.includes("FROM workspace_visual_checks") && sql.includes("WHERE id = ?")) return checks.find((c) => c.id === args[0]) ?? null;
            if (sql.includes("FROM workspace_project_repos WHERE project_id = ?")) return args[0] === PROJECT ? repo : null;
            if (sql.includes("FROM workspace_github_connections WHERE user_key = ?")) return args[0] === USER ? connection : null;
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE id = ?")) return jobs.find((j) => j.id === args[0]) ?? null;
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("status IN ('queued', 'running')")) {
              return jobs.find((j) => j.visual_check_id === args[0] && (j.status === "queued" || j.status === "running")) ?? null;
            }
            if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE visual_check_id = ?")) {
              return [...jobs].filter((j) => j.visual_check_id === args[0]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
            }
            return null;
          },
          async all() { return { results: [] }; },
        };
      }
      return { bind: (...a) => h(a), run: () => h([]).run(), first: () => h([]).first(), all: () => h([]).all() };
    },
  };
}

function sandboxStub() {
  return {
    idFromName: (n) => ({ n }),
    get: () => ({ fetch: async () => new Response("{}", { status: 202 }) }),
  };
}

async function call(env, method, p, body, headers = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await createApp().fetch(new Request(`http://localhost${p}`, init), env);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const REPAIR = `/workspace/projects/${PROJECT}/visual-checks/${RUN}/repair`;

async function repairThenDone(donePayload) {
  const db = makeDb();
  const env = { ENVIRONMENT: "test", DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN, CONCLAVE_TOKEN_KEK: KEK, SANDBOX: sandboxStub() };
  const created = await call(env, "POST", REPAIR, { userKey: USER });
  assert.equal(created.status, 202);
  const jobId = created.json.repair.id;
  const done = await call(env, "POST", "/internal/repair-done", { jobId, ok: true, ...donePayload }, { authorization: `Bearer ${TOKEN}` });
  assert.equal(done.status, 200);
  const view = await call(env, "GET", `${REPAIR}?userKey=${USER}`);
  assert.equal(view.status, 200);
  return { created, view: view.json.repair, db };
}

test("⑧ 서버: auto_fix + buildVerified:false → 잡 뷰 buildVerified:false · error는 비어 있다", async () => {
  const { view } = await repairThenDone({ mode: "auto_fix", changedFiles: 2, buildVerified: false, prNumber: 7 });
  assert.equal(view.buildVerified, false);
  assert.equal(view.mode, "auto_fix");
  assert.equal(view.error, null, "the build flag is not an error message");
});

test("⑧ 서버: auto_fix + buildVerified:true → true", async () => {
  const { view } = await repairThenDone({ mode: "auto_fix", changedFiles: 1, buildVerified: true });
  assert.equal(view.buildVerified, true);
  assert.equal(view.error, null);
});

test("⑧ 서버: brief_only는 buildVerified가 와도 null (코드가 안 바뀌었다) · modeReason 진단은 그대로", async () => {
  const { view } = await repairThenDone({ mode: "brief_only", changedFiles: 0, buildVerified: false, modeReason: "no_findings" });
  assert.equal(view.buildVerified, null);
  assert.equal(view.error, "no_findings");
});

test("⑧ 서버: 옛 컨테이너(필드 없음)·잘못된 값 → null (추측하지 않는다)", async () => {
  const legacy = await repairThenDone({ mode: "auto_fix", changedFiles: 1 });
  assert.equal(legacy.view.buildVerified, null);
  const garbage = await repairThenDone({ mode: "auto_fix", changedFiles: 1, buildVerified: "false" });
  assert.equal(garbage.view.buildVerified, null);
});

test("⑧ 서버: 막 만든 잡(queued)의 뷰도 buildVerified:null 필드를 가진다", async () => {
  const { created } = await repairThenDone({ mode: "auto_fix", changedFiles: 1, buildVerified: true });
  assert.ok("buildVerified" in created.json.repair, "the POST response view carries the field");
  assert.equal(created.json.repair.buildVerified, null);
});

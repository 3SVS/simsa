/**
 * SI 티어 Train B — B-5b-2 WBS 구현 루프 + B-5b-3 빌드·테스트 게이트(D-4) + 생성 코드 실행 안전.
 *
 *   ① WBS 루프: WBS마다 진행 콜백·커밋 · must 실패 → 멈춤 · 선택 실패 → 기록·되돌리고 계속 · 선행 실패 → 건너뜀 · 시간 상한
 *   ② 게이트: 보호 파일 복원 → install(frozen·offline) → build → test · 수리 라운드 · **고의 깨진 코드 → failed(building), 배포 단계 미도달**
 *   ③ 기본 implementWbs: 실제 agent-worker runBuildLoop(dist) + 프록시 클라이언트(가짜 Worker 프록시 fetch) + 실제 작업 폴더 실행기
 *   ④ 실행 안전: 자식 env 비밀 0 · 샌드박스 uid · 경로 탈출·링크 차단 · 명령 2차 관문 · 출력 상한·가림(실제 프로세스)
 *   ⑤ 프록시 클라이언트 · ⑥ 이미지·템플릿·CI·Worker 계약
 *
 * 네트워크·Docker·실제 LLM 없음: 콜백은 가짜 poster, LLM은 가짜 fetch, pnpm은 가짜 exec(실제 프로세스는 ④의 sandboxExec만).
 * Rule 6: 제품명·WBS 제목·로그는 한글·공백·특수문자. 토큰은 명백한 가짜 모양(bjt1.<jobId>.<hex>)만.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPO = path.resolve(ROOT, "../..");
const REPO_TEMPLATE = path.join(REPO, "templates/simsa-hosted-app");

const run = await import("../builder-container/builder-run.mjs");
// 옛 코드(B-5b S1)에는 builder-work.mjs가 없다 — 관대한 import로 테스트별로 실패하게(파일 전체 모듈 오류 1건이 아니라).
const work = await import("../builder-container/builder-work.mjs").catch(() => ({}));
const agentWorker = await import("../../../packages/agent-worker/dist/index.js");
const { wbsFromDevSpec } = await import("../dist/routes/workspace-build-jobs.js");
const { summarizeSelfCheck } = await import("../dist/routes/builder-probe.js");

function need(name) {
  assert.equal(typeof work[name] === "undefined", false, `builder-work.mjs export ${name} (B-5b-2)`);
  return work[name];
}

const JOB_ID = "bj_5b2gate01";
const JOB_TOKEN = `bjt1.${JOB_ID}.${"9e".repeat(32)}`;
const PRODUCT = "동네 빵집 소금빵 예약 (주)빵굽는집";
const ORIGIN = "https://cp.example";

/** Worker BuildDispatchPayload 모양(비밀 없음). WBS: must 1 · 선택 1 · 선택에 기대는 선택 1. */
function payload(o = {}) {
  return {
    jobId: JOB_ID, kind: "build", slug: "sogeum-bread-7a", locale: "ko",
    baseUrl: ORIGIN, callbackUrl: `${ORIGIN}/internal/build-done`, progressUrl: `${ORIGIN}/internal/build-progress`,
    jobToken: JOB_TOKEN, budgetUsd: 10,
    spec: {
      markdown: `# ${PRODUCT}\n\n## 요구사항\n- FR-001 예약(필수)\n- FR-002 후기(선택)\n\n## 완료 조건\n- AC-001 '예약하기' 버튼을 누르면 예약이 저장된다\n- AC-002 후기 목록이 보인다`,
      wbs: [
        { id: "WBS-001", title: "예약 저장 API — 한글 버튼 '예약하기'", order: 1, acceptanceIds: ["AC-001"], dependsOn: [], must: true },
        { id: "WBS-002", title: "후기 목록 화면 (선택)", order: 2, acceptanceIds: ["AC-002"], dependsOn: [], must: false },
        { id: "WBS-003", title: "후기 별점 — 후기 목록에 기댐", order: 3, acceptanceIds: ["AC-002"], dependsOn: ["WBS-002"], must: false },
      ],
      productName: PRODUCT,
    },
    hosting: { d1Id: "5f0c8a4e-1b2d-4c3e-9f10-2a3b4c5d6e7f" },
    llm: { model: "claude-sonnet-4-6", openaiModel: "gpt-5.4", preferFallback: false },
    ...o,
  };
}
const oneWbs = (o = {}) => payload({ spec: { ...payload().spec, wbs: [{ id: "WBS-001", title: "예약 저장 API — 한글 버튼 '예약하기'", order: 1, acceptanceIds: ["AC-001"], dependsOn: [], must: true }] }, ...o });

const createdTmp = [];
async function tmpDir(tag) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), `b5b2-${tag}-`));
  createdTmp.push(d);
  return d;
}
after(async () => {
  await Promise.all(createdTmp.map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** 가짜 exec — git은 성공(rev-parse는 sha), pnpm install·build·test는 주어진 함수가 결과를 정한다. 호출을 기록한다. */
function fakeExec({ install = () => ({ ok: true, code: 0 }), build = () => ({ ok: true, code: 0 }), test = () => ({ ok: true, code: 0 }) } = {}) {
  const calls = [];
  let n = 0;
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args: [...args], cwd: opts.cwd, env: opts.env, uid: opts.uid, gid: opts.gid, timeoutMs: opts.timeoutMs, signal: opts.signal ?? null });
    const res = (r) => ({ ok: r.ok, code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.timedOut ?? false, aborted: false, error: r.ok ? null : `exit ${r.code}` });
    if (cmd === "git" && args.includes("rev-parse")) return res({ ok: true, code: 0, stdout: `${String(++n).padStart(2, "0")}${"ab".repeat(19)}\n` });
    if (cmd === "pnpm" && args[0] === "install") return res(install(calls, opts));
    if (cmd === "pnpm" && args[0] === "run" && args[1] === "build") return res(build(calls, opts));
    if (cmd === "pnpm" && args[0] === "test") return res(test(calls, opts));
    return res({ ok: true, code: 0 });
  };
  return { exec, calls };
}

function recorder() {
  const calls = [];
  const post = async (url, token, body) => {
    calls.push({ url, token, body: JSON.parse(JSON.stringify(body)) });
    return { ok: true, status: 200, json: { ok: true, transitioned: true } };
  };
  return { calls, post };
}

const commitsOf = (calls) => calls.filter((c) => c.cmd === "git" && c.args.includes("commit")).map((c) => c.args[c.args.indexOf("-m") + 1]);
const msgs = (poster) => poster.calls.map((c) => [c.body.status, c.body.message]);

async function build(p, deps) {
  return run.runBuildJob(p, { workRoot: await tmpDir("wr"), templateDir: REPO_TEMPLATE, sandbox: null, log: () => {}, ...deps });
}

// ══ ① WBS 구현 루프 ═══════════════════════════════════════════════════════════════════════════════

describe("① WBS 구현 루프 (B-5b-2)", () => {
  it("WBS마다 wbs_started → 커밋 → wbs_done(meta.wbsId·commit) · 커밋 문구가 없으면 feat(<id>): <한글 제목> · 맥락(plan·offline env·프록시 LLM 설정)", async () => {
    const x = fakeExec();
    const poster = recorder();
    const seen = [];
    const implementWbs = async (ctx) => {
      seen.push({ id: ctx.item.id, must: ctx.item.must, plan: ctx.plan.map((p) => `${p.id}:${p.state}`), env: ctx.env, llm: ctx.llm, signalIsFresh: ctx.signal instanceof AbortSignal });
      return ctx.item.id === "WBS-001" ? { status: "done" } : { status: "done", commitMessage: `feat: ${ctx.item.title}` };
    };
    const r = await build(payload(), { exec: x.exec, postCallback: poster.post, implementWbs });
    assert.deepEqual(r, { jobId: JOB_ID, ok: false, stage: "failed", failedStage: "pushed", error: "builder_stage_not_implemented:pushed", wbsDone: 3 });
    assert.deepEqual(commitsOf(x.calls), [
      "chore: scaffold simsa-hosted-app template",
      "feat(WBS-001): 예약 저장 API — 한글 버튼 '예약하기'",
      "feat: 후기 목록 화면 (선택)",
      "feat: 후기 별점 — 후기 목록에 기댐",
    ]);
    const impl = poster.calls.filter((c) => c.body.status === "implementing").map((c) => [c.body.message, c.body.meta.wbsId, c.body.wbsDone, typeof c.body.meta.commit]);
    assert.deepEqual(impl, [
      ["wbs_started", "WBS-001", 0, "undefined"], ["wbs_done", "WBS-001", 1, "string"],
      ["wbs_started", "WBS-002", 1, "undefined"], ["wbs_done", "WBS-002", 2, "string"],
      ["wbs_started", "WBS-003", 2, "undefined"], ["wbs_done", "WBS-003", 3, "string"],
    ]);
    assert.deepEqual(seen.map((s) => s.plan), [
      ["WBS-001:pending", "WBS-002:pending", "WBS-003:pending"],
      ["WBS-001:done", "WBS-002:pending", "WBS-003:pending"],
      ["WBS-001:done", "WBS-002:done", "WBS-003:pending"],
    ]);
    assert.deepEqual(seen.map((s) => s.must), [true, false, false]);
    for (const s of seen) {
      assert.equal(s.env.npm_config_offline, "true", "model commands run offline");
      assert.ok(!JSON.stringify(s.env).includes(JOB_TOKEN), "no job token in the child env");
      assert.equal(s.llm.apiKey, JOB_TOKEN, "the token lives only in the LLM config (proxy apiKey)");
      assert.equal(s.llm.anthropicBaseUrl, `${ORIGIN}/internal/build-llm/anthropic`);
      assert.ok(s.signalIsFresh, "each WBS gets its own (time-limited) signal");
    }
  });

  it("★must WBS가 끝내 done이 아니면 멈춘다: wbs_failed(decision stop) → failed(implementing, wbs_failed:WBS-001:limit_turns) · 다음 WBS·게이트 없음", async () => {
    const x = fakeExec();
    const poster = recorder();
    const called = [];
    const r = await build(payload(), { exec: x.exec, postCallback: poster.post, implementWbs: async ({ item }) => { called.push(item.id); return { status: "limit_turns", summary: "turn limit 24 reached" }; } });
    assert.deepEqual(r, { jobId: JOB_ID, ok: false, stage: "failed", failedStage: "implementing", error: "wbs_failed:WBS-001:limit_turns", wbsDone: 0 });
    assert.deepEqual(called, ["WBS-001"]);
    const failed = poster.calls.find((c) => c.body.message === "wbs_failed").body.meta;
    assert.equal(failed.decision, "stop");
    assert.equal(failed.must, true);
    assert.equal(failed.status, "limit_turns");
    assert.ok(!poster.calls.some((c) => c.body.status === "building"), "no gate after a must failure");
    assert.ok(!x.calls.some((c) => c.cmd === "pnpm" && c.args[0] === "run"), "no build");
  });

  it("★선택(should·could) WBS 실패 → 기록·되돌리고 계속 · 그에 기대는 WBS는 LLM 없이 건너뜀 · 게이트는 wbsFailed를 싣고 돈다", async () => {
    const x = fakeExec();
    const poster = recorder();
    const called = [];
    const implementWbs = async ({ item }) => { called.push(item.id); return item.id === "WBS-002" ? { status: "gave_up", summary: "후기 API가 지시서에 없음" } : { status: "done", commitMessage: `feat: ${item.title}` }; };
    const r = await build(payload(), { exec: x.exec, postCallback: poster.post, implementWbs });
    assert.equal(r.failedStage, "pushed", JSON.stringify(r));
    assert.equal(r.wbsDone, 1);
    assert.deepEqual(called, ["WBS-001", "WBS-002"], "WBS-003 is skipped without an LLM call");
    const wf = poster.calls.find((c) => c.body.message === "wbs_failed").body.meta;
    assert.deepEqual({ wbsId: wf.wbsId, status: wf.status, must: wf.must, decision: wf.decision }, { wbsId: "WBS-002", status: "gave_up", must: false, decision: "continue" });
    assert.equal(wf.summary, "후기 API가 지시서에 없음");
    const skipped = poster.calls.find((c) => c.body.message === "wbs_skipped").body.meta;
    assert.deepEqual({ wbsId: skipped.wbsId, dependsOn: skipped.dependsOn }, { wbsId: "WBS-003", dependsOn: "WBS-002" });
    // 반쯤 쓴 WBS-002는 되돌린다(reset --hard HEAD · clean -fd, 무시 파일은 남긴다 — -x 없음)
    const reverts = x.calls.filter((c) => c.cmd === "git" && (c.args.includes("reset") || c.args.includes("clean"))).map((c) => c.args.slice(c.args.findIndex((a) => a === "reset" || a === "clean")));
    assert.deepEqual(reverts, [["reset", "-q", "--hard", "HEAD"], ["clean", "-q", "-f", "-d"]]);
    assert.deepEqual(poster.calls.find((c) => c.body.message === "gate_started").body.meta.wbsFailed, ["WBS-002", "WBS-003"]);
  });

  it("건너뛸 WBS가 must면 멈춘다: failed(implementing, wbs_blocked:<id>:<선행>)", async () => {
    const p = payload();
    p.spec.wbs[2].must = true;
    const r = await build(p, { exec: fakeExec().exec, postCallback: recorder().post, implementWbs: async ({ item }) => (item.id === "WBS-002" ? { status: "gave_up" } : { status: "done" }) });
    assert.equal(r.failedStage, "implementing");
    assert.equal(r.error, "wbs_blocked:WBS-003:WBS-002");
  });

  it("WBS 시간 상한: 그 WBS의 신호가 끊기고 limit_time으로 분류된다(must → 멈춤)", async () => {
    let sawAbort = false;
    const implementWbs = ({ signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { sawAbort = true; resolve({ status: "llm_error", summary: "llm_error: aborted" }); }, { once: true });
    });
    const t0 = Date.now();
    const r = await build(oneWbs(), { exec: fakeExec().exec, postCallback: recorder().post, implementWbs, wbsTimeLimitMs: 40 });
    assert.ok(sawAbort, "the WBS signal was aborted at the time limit");
    assert.ok(Date.now() - t0 < 5_000);
    assert.equal(r.error, "wbs_failed:WBS-001:limit_time");
  });

  it("llm_error는 선택 WBS여도 멈춘다(LLM 경로가 막혔다 — 뒤 WBS도 똑같이 실패하며 시간만 쓴다)", async () => {
    const r = await build(payload(), { exec: fakeExec().exec, postCallback: recorder().post, implementWbs: async ({ item }) => (item.id === "WBS-002" ? { status: "llm_error", summary: "llm_error: 503 vendor_disabled" } : { status: "done" }) });
    assert.equal(r.error, "wbs_failed:WBS-002:llm_error");
    assert.equal(r.wbsDone, 1);
  });

  it("규칙은 상수: WBS_FAILURE_POLICY · WBS_ALWAYS_STOP_STATUSES · decideWbsFailure 표", () => {
    assert.deepEqual({ ...need("WBS_FAILURE_POLICY") }, { must: "stop", optional: "continue", dependents: "skip" });
    assert.deepEqual([...work.WBS_ALWAYS_STOP_STATUSES], ["llm_error"]);
    const d = work.decideWbsFailure;
    assert.equal(d({ must: true }, "gave_up"), "stop");
    assert.equal(d({ must: false }, "gave_up"), "continue");
    assert.equal(d({ must: false }, "limit_time"), "continue");
    assert.equal(d({ must: false }, "llm_error"), "stop");
    assert.equal(d({}, "limit_turns"), "stop", "unknown must-ness is treated as must");
    assert.ok(work.WBS_TIME_LIMIT_MS >= 60_000 && work.WBS_TIME_LIMIT_MS <= 45 * 60_000);
  });

  it("Worker wbsFromDevSpec: must = 완료 조건 중 하나라도 must 기능 · 모르는 완료 조건은 must(보수) → 컨테이너가 받는다", () => {
    const spec = {
      features: [{ id: "FR-001", priority: "must" }, { id: "FR-002", priority: "should" }, { id: "FR-003", priority: "could" }],
      acceptance: [{ id: "AC-001", featureId: "FR-001" }, { id: "AC-002", featureId: "FR-002" }, { id: "AC-003", featureId: "FR-003" }],
      workBreakdown: [
        { id: "WBS-003", title: "모름", order: 3, dependsOn: [], acceptanceIds: ["AC-999"] },
        { id: "WBS-001", title: "예약", order: 1, dependsOn: [], acceptanceIds: ["AC-002", "AC-001"] },
        { id: "WBS-002", title: "후기", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-002", "AC-003"] },
      ],
    };
    const wbs = wbsFromDevSpec(spec);
    assert.deepEqual(wbs.map((w) => [w.id, w.must]), [["WBS-001", true], ["WBS-002", false], ["WBS-003", true]]);
    const v = run.validateBuildPayload(payload({ spec: { ...payload().spec, wbs } }));
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.deepEqual(v.job.wbs.map((w) => w.must), [true, false, true]);
    // 옛 Worker(must 없음) → must로 · must가 불리언이 아니면 거절
    const old = run.validateBuildPayload(payload({ spec: { ...payload().spec, wbs: payload().spec.wbs.map(({ must, ...w }) => w) } }));
    assert.deepEqual(old.job.wbs.map((w) => w.must), [true, true, true]);
    assert.ok(run.validateBuildPayload(payload({ spec: { ...payload().spec, wbs: [{ ...payload().spec.wbs[0], must: "yes" }] } })).errors.includes("spec.wbs"));
  });
});

// ══ ② 빌드 게이트 ═════════════════════════════════════════════════════════════════════════════════

describe("② 빌드 게이트 (B-5b-3 · D-4 — 초록불이 아니면 다음 단계 금지)", () => {
  const done = async ({ item }) => ({ status: "done", commitMessage: `feat: ${item.title}` });

  it("초록불: install(frozen·offline) → build → test → gate_passed → failed(pushed) — done을 주장하지 않는다", async () => {
    const x = fakeExec();
    const poster = recorder();
    const stages = [];
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs: done, onStage: (s) => stages.push(s) });
    assert.deepEqual(r, { jobId: JOB_ID, ok: false, stage: "failed", failedStage: "pushed", error: "builder_stage_not_implemented:pushed", wbsDone: 1 });
    assert.deepEqual(stages, ["scaffolding", "implementing", "building", "testing"]);
    const pn = x.calls.filter((c) => c.cmd === "pnpm").map((c) => [c.args.join(" "), c.env.npm_config_offline ?? null, c.timeoutMs]);
    const L = need("GATE_LIMITS");
    assert.deepEqual(pn, [
      ["install --frozen-lockfile --offline", null, L.installMs], // 스캐폴드 직후
      ["install --frozen-lockfile --offline", null, L.installMs], // 게이트
      ["run build", "true", L.buildMs],
      ["test", "true", L.testMs],
    ]);
    assert.deepEqual(msgs(poster).slice(-3), [["building", "gate_started"], ["testing", "test_started"], ["testing", "gate_passed"]]);
    assert.deepEqual([...work.GATE_COMMANDS.install[1]], ["install", "--frozen-lockfile", "--offline"]);
    assert.equal(work.GATE_ALLOWS_DEPENDENCY_CHANGES, false);
    assert.equal(work.GATE_LIMITS.repairRounds, 2);
  });

  it("★D-4 완료 조건: 고의로 깨진 코드 → 수리 2회 → failed(building, build_failed:exit_2) · testing·pushed·deploying 진행 없음 · 배포·push 명령 0", async () => {
    const x = fakeExec({ build: () => ({ ok: false, code: 2, stderr: "src/worker.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n ELIFECYCLE  Command failed with exit code 2." }) });
    const poster = recorder();
    const stages = [];
    const repairs = [];
    const implementWbs = async (ctx) => {
      if (ctx.repair) { repairs.push({ id: ctx.item.id, ...ctx.repair }); return { status: "gave_up", summary: "타입 오류를 못 고침" }; }
      return { status: "done", commitMessage: "feat: 예약 저장(깨진 코드)" };
    };
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs, onStage: (s) => stages.push(s) });
    assert.deepEqual(r, { jobId: JOB_ID, ok: false, stage: "failed", failedStage: "building", error: "build_failed:exit_2", wbsDone: 1, buildExitCode: 2 });
    assert.deepEqual(repairs.map((p) => [p.id, p.stage, p.round, p.maxRounds, p.command, p.exitLabel]), [
      ["REPAIR-1", "building", 1, 2, "pnpm run build", "exit_2"],
      ["REPAIR-2", "building", 2, 2, "pnpm run build", "exit_2"],
    ]);
    assert.match(repairs[0].logTail, /TS2322/, "the model gets the failing log tail");
    assert.deepEqual(msgs(poster).filter(([s]) => s === "building"), [
      ["building", "gate_started"],
      ["building", "build_failed"], ["building", "repair_started"], ["building", "repair_done"],
      ["building", "build_failed"], ["building", "repair_started"], ["building", "repair_done"],
      ["building", "build_failed"],
    ]);
    const finalEv = poster.calls.filter((c) => c.body.message === "build_failed").at(-1).body.meta;
    assert.equal(finalEv.final, true);
    assert.equal(finalEv.exit, "exit_2");
    // 배포 단계 미도달
    assert.ok(!poster.calls.some((c) => ["testing", "pushed", "deploying"].includes(c.body.status)), "never reaches testing/pushed/deploying");
    assert.ok(!stages.includes("testing"));
    assert.ok(!x.calls.some((c) => c.args.some((a) => /wrangler|deploy|push/.test(a)) || /wrangler|vercel|netlify/.test(c.cmd)), "no deploy or push command ran");
    assert.ok(!x.calls.some((c) => c.cmd === "pnpm" && c.args[0] === "test"), "tests do not run on a red build");
    assert.deepEqual(commitsOf(x.calls).slice(1), ["feat: 예약 저장(깨진 코드)", "fix(gate): repair building — round 1", "fix(gate): repair building — round 2"]);
  });

  it("테스트 빨간불 → 수리 2회 → failed(testing, test_failed:exit_1) · 진행 상태는 testing에서 뒤로 가지 않는다", async () => {
    const x = fakeExec({ test: () => ({ ok: false, code: 1, stdout: "✖ /api/health는 200 {ok:true}\n  expected 500 to equal 200" }) });
    const poster = recorder();
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs: async (ctx) => (ctx.repair ? { status: "done" } : { status: "done" }) });
    assert.deepEqual(r, { jobId: JOB_ID, ok: false, stage: "failed", failedStage: "testing", error: "test_failed:exit_1", wbsDone: 1, buildExitCode: 0, testExitCode: 1 });
    const gateMsgs = msgs(poster).slice(msgs(poster).findIndex(([, m]) => m === "gate_started"));
    assert.deepEqual(gateMsgs, [
      ["building", "gate_started"], ["testing", "test_started"],
      ["testing", "test_failed"], ["testing", "repair_started"], ["testing", "repair_done"],
      ["testing", "test_failed"], ["testing", "repair_started"], ["testing", "repair_done"],
      ["testing", "test_failed"],
    ]);
    // 수리 뒤에는 다시 빌드부터(코드가 바뀌었다)
    assert.equal(x.calls.filter((c) => c.cmd === "pnpm" && c.args[0] === "run").length, 3);
  });

  it("수리 한 번에 고쳐지면 초록불(rounds 1) — 수리 커밋 fix(gate)", async () => {
    let builds = 0;
    const x = fakeExec({ build: () => (++builds === 1 ? { ok: false, code: 2, stderr: "error TS2304: Cannot find name '예약'." } : { ok: true, code: 0 }) });
    const poster = recorder();
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs: async () => ({ status: "done" }) });
    assert.equal(r.failedStage, "pushed");
    assert.equal(poster.calls.find((c) => c.body.message === "gate_passed").body.meta.rounds, 1);
    assert.ok(commitsOf(x.calls).includes("fix(gate): repair building — round 1"));
  });

  it("게이트의 설치 실패는 수리하지 않는다(의존성은 고정) → failed(building, install_failed:exit_1)", async () => {
    let installs = 0;
    const x = fakeExec({ install: () => (++installs >= 2 ? { ok: false, code: 1, stderr: "ERR_PNPM_OUTDATED_LOCKFILE" } : { ok: true, code: 0 }) });
    const repairs = [];
    const r = await build(oneWbs(), { exec: x.exec, postCallback: recorder().post, implementWbs: async (ctx) => { if (ctx.repair) repairs.push(ctx.repair); return { status: "done" }; } });
    assert.equal(r.failedStage, "building");
    assert.equal(r.error, "install_failed:exit_1");
    assert.equal(repairs.length, 0);
  });

  it("스캐폴드 직후 설치: 오프라인이 안 되면 한 번만 레지스트리로(--prefer-offline) · 그래도 실패면 failed(scaffolding, deps_install_failed)", async () => {
    let n = 0;
    const x = fakeExec({ install: () => (++n === 1 ? { ok: false, code: 1, stderr: "ERR_PNPM_NO_OFFLINE_TARBALL" } : { ok: true, code: 0 }) });
    const poster = recorder();
    await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs: async () => ({ status: "done" }) });
    assert.deepEqual(x.calls.filter((c) => c.cmd === "pnpm").slice(0, 2).map((c) => c.args.join(" ")), ["install --frozen-lockfile --offline", "install --frozen-lockfile --prefer-offline"]);
    assert.equal(poster.calls.find((c) => c.body.message === "scaffold_ready").body.meta.installMode, "network");
    const bad = fakeExec({ install: () => ({ ok: false, code: 1 }) });
    const r = await build(oneWbs(), { exec: bad.exec, postCallback: recorder().post, implementWbs: async () => ({ status: "done" }) });
    assert.deepEqual([r.failedStage, r.error], ["scaffolding", "deps_install_failed:exit_1"]);
  });

  it("예산이 수리 중에 끝나면 failed(building, budget_exhausted) + 지금까지 커밋", async () => {
    const x = fakeExec({ build: () => ({ ok: false, code: 2, stderr: "error" }) });
    const budget402 = { status: "llm_error", summary: 'llm_error: 402 {"type":"error","error":{"type":"budget_exhausted","message":"build budget exhausted"}}' };
    const r = await build(oneWbs(), { exec: x.exec, postCallback: recorder().post, implementWbs: async (ctx) => (ctx.repair ? budget402 : { status: "done" }) });
    assert.deepEqual([r.failedStage, r.error], ["building", "budget_exhausted"]);
    assert.equal(commitsOf(x.calls).at(-1), "wip(REPAIR-1): stopped — build budget exhausted");
  });

  it("★보호 파일: 모델(또는 모델의 node 스크립트)이 test 스크립트를 'exit 0'으로 바꾸고 smoke 테스트·lockfile을 건드려도 게이트 전에 템플릿 원본으로 되돌린다", async () => {
    const original = {
      pkg: readFileSync(path.join(REPO_TEMPLATE, "package.json"), "utf8"),
      smoke: readFileSync(path.join(REPO_TEMPLATE, "test/smoke.test.mjs"), "utf8"),
      lock: readFileSync(path.join(REPO_TEMPLATE, "pnpm-lock.yaml"), "utf8"),
    };
    const atBuild = [];
    const x = fakeExec({
      build: (_c, opts) => {
        atBuild.push({
          pkg: readFileSync(path.join(opts.cwd, "package.json"), "utf8"),
          smoke: existsSync(path.join(opts.cwd, "test/smoke.test.mjs")) ? readFileSync(path.join(opts.cwd, "test/smoke.test.mjs"), "utf8") : null,
          lock: readFileSync(path.join(opts.cwd, "pnpm-lock.yaml"), "utf8"),
        });
        return { ok: true, code: 0 };
      },
    });
    const poster = recorder();
    const implementWbs = async ({ appDir }) => {
      const pkg = JSON.parse(await fs.readFile(path.join(appDir, "package.json"), "utf8"));
      pkg.scripts.test = "exit 0";
      pkg.dependencies["left-pad-예약"] = "^1.0.0";
      await fs.writeFile(path.join(appDir, "package.json"), JSON.stringify(pkg));
      await fs.rm(path.join(appDir, "test/smoke.test.mjs"));
      await fs.appendFile(path.join(appDir, "pnpm-lock.yaml"), "\n# 변조\n");
      return { status: "done" };
    };
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs });
    assert.equal(r.failedStage, "pushed");
    const ev = poster.calls.find((c) => c.body.message === "protected_restored");
    assert.ok(ev, "restoration is recorded on the timeline");
    assert.deepEqual([...ev.body.meta.files].sort(), ["package.json", "pnpm-lock.yaml", "test/smoke.test.mjs"]);
    assert.equal(atBuild.length, 1);
    assert.equal(atBuild[0].pkg, original.pkg, "package.json is the template's (test script + deps)");
    assert.equal(atBuild[0].smoke, original.smoke, "the platform smoke test is back");
    assert.equal(atBuild[0].lock, original.lock);
    assert.deepEqual([...need("PROTECTED_APP_FILES")].sort(), [".gitignore", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "test/smoke.test.mjs", "wrangler.toml"]);
  });

  it("진행 이벤트의 로그 끝부분: 상한 · ANSI 제거 · jobToken 가림(모델에게 가는 끝부분도)", async () => {
    const noisy = `\x1b[32m✓ 29 modules transformed.\x1b[39m\n${"가".repeat(20_000)}\nAuthorization: Bearer ${JOB_TOKEN}\n\x1b[31msrc/App.tsx(9,3): error TS2741: '예약하기' 누락\x1b[39m`;
    const x = fakeExec({ build: () => ({ ok: false, code: 2, stdout: noisy }) });
    const poster = recorder();
    const repairs = [];
    await build(oneWbs(), { exec: x.exec, postCallback: poster.post, implementWbs: async (ctx) => { if (!ctx.repair) return { status: "done" }; repairs.push(ctx.repair); return { status: "gave_up" }; }, gateLimits: { repairRounds: 1 } });
    const ev = poster.calls.filter((c) => c.body.message === "build_failed");
    assert.equal(ev.length, 2);
    for (const e of ev) {
      const tail = e.body.meta.logTail;
      assert.ok(tail.length <= work.GATE_LIMITS.eventLogTailChars + 60, `bounded (${tail.length})`);
      assert.ok(!tail.includes("\x1b"), "ANSI stripped");
      assert.ok(!tail.includes(JOB_TOKEN) && !JSON.stringify(e.body).includes(JOB_TOKEN), "job token never reaches the timeline");
      assert.match(tail, /TS2741: '예약하기' 누락$/);
    }
    assert.ok(!repairs[0].logTail.includes(JOB_TOKEN) && repairs[0].logTail.length <= work.GATE_LIMITS.logTailChars + 60);
    assert.ok(!poster.calls.some((c) => JSON.stringify(c.body).includes(JOB_TOKEN)));
  });
});

// ══ ③ 기본 implementWbs — 실제 runBuildLoop ══════════════════════════════════════════════════════════

/** 가짜 Worker 빌드 LLM 프록시(fetch). script({task, turn, url}) → { content } | { status, json, headers } | { openai }. */
function fakeProxy(script) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const isOpenAi = String(url).endsWith("/chat/completions");
    const userMsgs = body.messages.filter((m) => m.role === "user" && typeof m.content === "string");
    const firstUser = userMsgs[0]?.content ?? "";
    const task = /# Work item (\S+?):/.exec(firstUser)?.[1] ?? "?";
    const turn = body.messages.filter((m) => m.role === "assistant").length;
    calls.push({ url: String(url), headers, body, task, turn, prompt: firstUser });
    const r = script({ task, turn, isOpenAi, prompt: firstUser });
    if (r.status && r.status !== 200) return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
    if (isOpenAi) {
      const toolCalls = r.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      return new Response(JSON.stringify({ id: `chatcmpl_${calls.length}`, model: "gpt-5.4-2026-03-05", choices: [{ message: { content: null, tool_calls: toolCalls }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 900, completion_tokens: 120 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: `msg_${calls.length}`, type: "message", role: "assistant", model: "claude-sonnet-4-6", content: r.content.map((b) => (b.type === "tool_use" ? { ...b, caller: { type: "direct" } } : b)), stop_reason: "tool_use", usage: { input_tokens: 1200, output_tokens: 300 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}
const tu = (name, input) => ({ type: "tool_use", id: `tu_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input });
const BROKEN_WORKER = `import { Hono } from "hono";\nconst app = new Hono();\nconst 예약수: number = "여러 개";\napp.get("/api/health", (c) => c.json({ ok: true, n: 예약수 }));\nexport default app;\n`;
const GOOD_APP = `export function App() {\n  return <main><h1>동네 빵집 소금빵 예약</h1><button type="button">예약하기</button></main>;\n}\n`;

/** 실제 파일을 보는 가짜 pnpm: build는 src/worker.ts에 `: number = "`가 있으면 tsc처럼 빨간불(ANSI·토큰 섞인 로그). */
function fileAwareExec() {
  return fakeExec({
    build: (_c, opts) => {
      const src = readFileSync(path.join(opts.cwd, "src/worker.ts"), "utf8");
      if (src.includes(': number = "')) {
        return { ok: false, code: 2, stdout: "\x1b[32m✓ built in 1.74s\x1b[39m", stderr: `src/worker.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\nAuthorization: Bearer ${JOB_TOKEN}\n ELIFECYCLE  Command failed with exit code 2.` };
      }
      return { ok: true, code: 0, stdout: "✓ built" };
    },
  });
}

describe("③ 기본 implementWbs — 실제 agent-worker runBuildLoop · 프록시 클라이언트 · 작업 폴더 실행기", () => {
  const loadAgentWorker = async () => agentWorker;
  const quick = { backoffMs: [0], retries: 1 };

  it("★고의 깨진 코드 끝까지: 모델이 깨진 worker.ts를 실제로 쓴다 → 빌드 빨간불 → 수리 프롬프트에 가린 로그 → failed(building) · 모든 LLM 호출은 프록시로 jobToken", async () => {
    const proxy = fakeProxy(({ task, turn }) => {
      if (task === "WBS-001") return { content: turn === 0 ? [tu("create_file", { path: "src/worker.ts", content: BROKEN_WORKER })] : [tu("finish", { status: "done", summary: "예약 수를 보여 준다", commitMessage: "feat: 예약 수" })] };
      return { content: [tu("finish", { status: "gave_up", summary: "수리 불가(테스트 픽스처)" })] };
    });
    const x = fileAwareExec();
    const poster = recorder();
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, loadAgentWorker, fetchImpl: proxy.fetchImpl, llmRetryOptions: quick });
    assert.deepEqual([r.failedStage, r.error, r.buildExitCode, r.wbsDone], ["building", "build_failed:exit_2", 2, 1]);
    assert.deepEqual(proxy.calls.map((c) => [c.task, c.turn]), [["WBS-001", 0], ["WBS-001", 1], ["REPAIR-1", 0], ["REPAIR-2", 0]]);
    for (const c of proxy.calls) {
      assert.equal(c.url, `${ORIGIN}/internal/build-llm/anthropic/v1/messages`);
      assert.equal(c.headers["x-api-key"], JOB_TOKEN, "apiKey = job token (the vendor key stays in the Worker)");
      assert.equal(c.headers["anthropic-version"], "2023-06-01");
      assert.deepEqual(c.body.tools.map((t) => t.name), ["read_file", "list_files", "create_file", "run_command", "finish"]);
      // 응답 블록의 모르는 키(caller)는 되돌려 보내지 않는다(명시 가드로 정규화)
      assert.ok(!JSON.stringify(c.body.messages).includes('"caller"'));
    }
    const wbsPrompt = proxy.calls[0].prompt;
    assert.match(wbsPrompt, /# Work item WBS-001: 예약 저장 API — 한글 버튼 '예약하기'/);
    assert.match(wbsPrompt, /Acceptance criteria to satisfy: AC-001/);
    assert.match(wbsPrompt, /동네 빵집 소금빵 예약 \(주\)빵굽는집/);
    assert.match(wbsPrompt, /Build platform rules \(Simsa\)/);
    assert.match(wbsPrompt, /src\/worker\.ts/, "current file list is in the context");
    assert.ok(!wbsPrompt.includes("node_modules"));
    const repairPrompt = proxy.calls[2].prompt;
    assert.match(repairPrompt, /repair round 1 of 2/);
    assert.match(repairPrompt, /TS2322/);
    assert.match(repairPrompt, /Bearer \[redacted\]/);
    assert.ok(!proxy.calls.some((c) => JSON.stringify(c.body).includes(JOB_TOKEN)), "the job token never enters a prompt");
    assert.ok(!poster.calls.some((c) => ["testing", "pushed", "deploying"].includes(c.body.status)));
  });

  it("초록불 끝까지: 모델이 올바른 App.tsx를 쓴다 → 게이트 통과 → failed(pushed) · 파일은 작업 폴더 안에만", async () => {
    const proxy = fakeProxy(({ turn }) => ({ content: turn === 0 ? [tu("create_file", { path: "src/client/App.tsx", content: GOOD_APP })] : [tu("finish", { status: "done", summary: "예약 화면", commitMessage: "feat: 예약 화면" })] }));
    const seenApp = [];
    const x = fakeExec({ build: (_c, opts) => { seenApp.push(readFileSync(path.join(opts.cwd, "src/client/App.tsx"), "utf8")); return { ok: true, code: 0 }; } });
    const poster = recorder();
    const r = await build(oneWbs(), { exec: x.exec, postCallback: poster.post, loadAgentWorker, fetchImpl: proxy.fetchImpl, llmRetryOptions: quick });
    assert.equal(r.failedStage, "pushed", JSON.stringify(r));
    assert.equal(seenApp[0], GOOD_APP);
    assert.ok(commitsOf(x.calls).includes("feat: 예약 화면"));
  });

  it("프록시 402 budget_exhausted(첫 호출) → failed(implementing, budget_exhausted) · 재시도·다음 WBS 없음", async () => {
    const proxy = fakeProxy(({ isOpenAi }) => ({
      status: 402,
      headers: { "x-should-retry": "false" },
      json: isOpenAi ? { error: { type: "budget_exhausted", code: "budget_exhausted", message: "build budget exhausted" } } : { type: "error", error: { type: "budget_exhausted", message: "build budget exhausted ($10.00 of $10.00)" } },
    }));
    const x = fakeExec();
    const r = await build(payload(), { exec: x.exec, postCallback: recorder().post, loadAgentWorker, fetchImpl: proxy.fetchImpl, llmRetryOptions: { backoffMs: [0], retries: 2 } });
    assert.deepEqual([r.failedStage, r.error, r.wbsDone], ["implementing", "budget_exhausted", 0]);
    assert.deepEqual(proxy.calls.map((c) => c.url.replace(ORIGIN, "")), ["/internal/build-llm/anthropic/v1/messages", "/internal/build-llm/openai/v1/chat/completions"], "one try per vendor path — x-should-retry:false is honoured");
    assert.equal(commitsOf(x.calls).at(-1), "wip(WBS-001): stopped — build budget exhausted");
  });

  it("preferFallback(프로덕션 ANTHROPIC_ENABLED=off)면 OpenAI 경로만 — Authorization: Bearer <jobToken>", async () => {
    const proxy = fakeProxy(({ turn }) => ({ content: turn === 0 ? [tu("create_file", { path: "src/client/App.tsx", content: GOOD_APP })] : [tu("finish", { status: "done", summary: "예약 화면" })] }));
    const r = await build(oneWbs({ llm: { model: "claude-sonnet-4-6", openaiModel: "gpt-5.4", preferFallback: true } }), { exec: fakeExec().exec, postCallback: recorder().post, loadAgentWorker, fetchImpl: proxy.fetchImpl, llmRetryOptions: quick });
    assert.equal(r.failedStage, "pushed", JSON.stringify(r));
    assert.ok(proxy.calls.length >= 2);
    for (const c of proxy.calls) {
      assert.equal(c.url, `${ORIGIN}/internal/build-llm/openai/v1/chat/completions`);
      assert.equal(c.headers.authorization, `Bearer ${JOB_TOKEN}`);
      assert.equal(c.body.model, "gpt-5.4");
    }
  });

  it("모델의 거부된 명령·보호 파일 쓰기는 실행되지 않고 REFUSED가 모델에게 돌아간다(pnpm add · pnpm wrangler deploy · git -C · package.json)", async () => {
    const proxy = fakeProxy(({ turn }) => {
      if (turn === 0) {
        return { content: [
          tu("run_command", { cmd: "pnpm", args: ["add", "left-pad"] }),
          tu("run_command", { cmd: "pnpm", args: ["wrangler", "deploy"] }),
          tu("run_command", { cmd: "git", args: ["-C", "src", "status"] }),
          tu("create_file", { path: "package.json", content: "{}" }),
          tu("run_command", { cmd: "cat", args: ["../../builder-run.mjs"] }),
        ] };
      }
      return { content: [tu("finish", { status: "done", summary: "끝" })] };
    });
    const x = fakeExec();
    await build(oneWbs(), { exec: x.exec, postCallback: recorder().post, loadAgentWorker, fetchImpl: proxy.fetchImpl, llmRetryOptions: quick });
    const replies = proxy.calls[1].body.messages.at(-1).content.map((b) => b.content);
    assert.equal(replies.length, 5);
    assert.match(replies[0], /REFUSED \(dependencies_fixed\)/);
    assert.match(replies[1], /REFUSED \(deploy_cli\)/);
    assert.match(replies[2], /REFUSED \(dir_switch\)/);
    assert.match(replies[3], /REFUSED \(protected_file\)/);
    assert.match(replies[4], /REFUSED \(path_escape\)/);
    const modelCmds = x.calls.filter((c) => !(c.cmd === "git" && ["init", "add", "commit", "rev-parse", "reset", "clean"].some((v) => c.args.includes(v))) && !(c.cmd === "pnpm" && ["install", "run", "test"].includes(c.args[0])));
    assert.deepEqual(modelCmds, [], "none of the refused commands reached exec");
  });
});

// ══ ④ 생성 코드 실행 안전 ══════════════════════════════════════════════════════════════════════════

describe("④ 생성 코드 실행 안전", () => {
  const SECRET_ENV = {
    PATH: "/usr/bin", HOME: "/root", LANG: "ko_KR.UTF-8", NODE_ENV: "production",
    JOB_TOKEN, SIMSA_JOB_TOKEN: JOB_TOKEN, INTERNAL_CALLBACK_TOKEN: "cb-FAKE", ANTHROPIC_API_KEY: "a-FAKE", OPENAI_API_KEY: "o-FAKE",
    HOSTING_CF_API_TOKEN: "cf-FAKE", CLOUDFLARE_API_TOKEN: "cf2-FAKE", GITHUB_TOKEN: "gh-FAKE", NPM_TOKEN: "npm-FAKE",
    SIMSA_SANDBOX_UID: "10001",
  };

  it("★자식 env: 비밀·jobToken 0 — workEnv = 허용 목록 + HOME(샌드박스 집)·NO_COLOR(+ npm_config_offline)", () => {
    const workEnv = need("workEnv");
    const sb = { uid: 10001, gid: 10001, home: "/home/simsa-run", storeDir: "/home/simsa-run/.pnpm-store" };
    const e = workEnv(SECRET_ENV, { sandbox: sb, offline: true });
    assert.deepEqual(e, { PATH: "/usr/bin", HOME: "/home/simsa-run", LANG: "ko_KR.UTF-8", NODE_ENV: "production", NO_COLOR: "1", npm_config_offline: "true" });
    assert.ok(!Object.values(e).some((v) => /FAKE/.test(v) || v === JOB_TOKEN));
    const allowed = new Set([...work.CHILD_ENV_KEYS, ...work.WORK_ENV_EXTRA_KEYS]);
    assert.ok(Object.keys(workEnv(SECRET_ENV)).every((k) => allowed.has(k)));
    assert.deepEqual([...work.CHILD_ENV_KEYS].sort(), [...agentWorker.ALLOWED_ENV_KEYS].sort(), "same allowlist as agent-worker filterEnv");
  });

  it("★샌드박스: 모든 exec(git·pnpm)에 uid/gid · 스캐폴드 트리 소유자 = 샌드박스 사용자(lchown) · 설치는 샌드박스 저장소", async () => {
    const sb = { uid: 10001, gid: 10002, home: "/home/simsa-run", storeDir: "/home/simsa-run/.pnpm-store" };
    const chowned = [];
    const fsImpl = { ...fs, lchown: async (p, uid, gid) => { chowned.push([p, uid, gid]); } };
    const x = fakeExec();
    const r = await build(oneWbs(), { exec: x.exec, postCallback: recorder().post, implementWbs: async () => ({ status: "done" }), sandbox: sb, fsImpl });
    assert.equal(r.failedStage, "pushed", JSON.stringify(r));
    assert.ok(x.calls.length >= 8);
    assert.ok(x.calls.every((c) => c.uid === 10001 && c.gid === 10002), "every child runs as the sandbox user");
    assert.ok(x.calls.every((c) => c.env.HOME === "/home/simsa-run"));
    assert.ok(chowned.length >= 10 && chowned.every(([, u, g]) => u === 10001 && g === 10002));
    assert.ok(chowned.some(([p]) => p.endsWith(path.join("app", "package.json"))));
    const installs = x.calls.filter((c) => c.cmd === "pnpm" && c.args[0] === "install").map((c) => c.args.join(" "));
    assert.ok(installs.every((a) => a === "install --frozen-lockfile --offline --store-dir /home/simsa-run/.pnpm-store"), installs.join(" | "));
  });

  it("샌드박스가 설정됐는데 root가 아니면 failed(scaffolding, sandbox_unavailable:not_root) — 생성 코드를 조용히 root·같은 uid로 돌리지 않는다", async () => {
    const x = fakeExec();
    const poster = recorder();
    const r = await run.runBuildJob(oneWbs(), { workRoot: await tmpDir("wrsb"), templateDir: REPO_TEMPLATE, exec: x.exec, postCallback: poster.post, sandboxEnv: { SIMSA_SANDBOX_UID: "10001", SIMSA_SANDBOX_GID: "10001", SIMSA_SANDBOX_HOME: "/home/simsa-run" }, implementWbs: async () => ({ status: "done" }), log: () => {} });
    if (typeof process.getuid === "function" && process.getuid() === 0) return; // root로 도는 환경이면 이 분기는 다른 테스트가 본다
    assert.deepEqual([r.failedStage, r.error], ["scaffolding", "sandbox_unavailable:not_root"]);
    assert.equal(x.calls.length, 0, "nothing ran");
  });

  it("sandboxFromEnv · checkSandbox 표", async () => {
    const f = need("sandboxFromEnv");
    assert.deepEqual(f({}, () => 0), { ok: true, sandbox: null, reason: "not_configured" });
    assert.deepEqual(f({ SIMSA_SANDBOX_UID: "10001", SIMSA_SANDBOX_HOME: "/home/simsa-run" }, () => 1000), { ok: false, sandbox: null, reason: "not_root" });
    assert.equal(f({ SIMSA_SANDBOX_UID: "0", SIMSA_SANDBOX_HOME: "/h" }, () => 0).reason, "invalid_sandbox_ids", "uid 0 is not a sandbox");
    assert.equal(f({ SIMSA_SANDBOX_UID: "10001" }, () => 0).reason, "sandbox_home_missing");
    assert.deepEqual(f({ SIMSA_SANDBOX_UID: "10001", SIMSA_SANDBOX_GID: "10002", SIMSA_SANDBOX_HOME: "/home/simsa-run", SIMSA_PNPM_STORE_DIR: "/home/simsa-run/.pnpm-store" }, () => 0).sandbox, { uid: 10001, gid: 10002, home: "/home/simsa-run", storeDir: "/home/simsa-run/.pnpm-store" });
    const env = { SIMSA_SANDBOX_UID: "10001", SIMSA_SANDBOX_HOME: "/home/simsa-run", SIMSA_PNPM_STORE_DIR: "/home/simsa-run/.pnpm-store" };
    const statFs = (uid) => ({ stat: async () => ({ uid, isDirectory: () => true }) });
    assert.deepEqual(await work.checkSandbox({ env, getuid: () => 0, fsImpl: statFs(10001) }), { ok: true, enabled: true, uid: 10001, storeReady: true, reason: null });
    assert.equal((await work.checkSandbox({ env, getuid: () => 0, fsImpl: statFs(0) })).reason, "sandbox_home_owner_mismatch");
    assert.deepEqual(await work.checkSandbox({ env: {}, getuid: () => 1000 }), { ok: true, enabled: false, uid: null, storeReady: false, reason: "not_configured" });
    // 자가점검에 실리고 ok를 좌우한다
    const sc = await run.selfCheck({ exec: async (cmd) => (["vercel", "netlify"].includes(cmd) ? { ok: false, code: 127, stdout: "", stderr: "", error: "ENOENT" } : { ok: true, code: 0, stdout: "1.2.3", stderr: "", error: null }), workRoot: "/tmp/w", fsImpl: { mkdtemp: async (p) => `${p}x`, writeFile: async () => {}, rm: async () => {} }, loadAgentWorker: async () => agentWorker, templateDir: REPO_TEMPLATE, sandboxEnv: env, getuid: () => 1000 });
    assert.equal(sc.sandbox.reason, "not_root");
    assert.equal(sc.ok, false, "a configured-but-unusable sandbox makes the image unhealthy");
    const summary = summarizeSelfCheck(sc, 5);
    assert.deepEqual(summary.sandbox, { ok: false, enabled: false, uid: null, storeReady: false, reason: "not_root" });
    assert.equal(summarizeSelfCheck({ ok: true }, 1).sandbox, null, "old image → null");
  });

  it("★경로 탈출: ../·절대경로·링크(디렉터리 정션/심볼릭)·보호 파일 — 읽기·쓰기 거부, 작업 폴더 밖 파일은 그대로", async () => {
    const createWorkspaceExecutor = need("createWorkspaceExecutor");
    const base = await tmpDir("esc");
    const appDir = path.join(base, "app");
    const outside = path.join(base, "outside");
    await fs.mkdir(path.join(appDir, "src"), { recursive: true });
    await fs.mkdir(path.join(appDir, "node_modules", "x"), { recursive: true });
    await fs.writeFile(path.join(appDir, "node_modules", "x", "i.js"), "x");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.txt"), "밖의 파일");
    await fs.symlink(outside, path.join(appDir, "lnk"), "junction");
    const ex = createWorkspaceExecutor({ appDir, exec: async () => { throw new Error("no exec here"); }, env: {} });
    await assert.rejects(ex.readFile("lnk/secret.txt"), /REFUSED \(symlink\)/);
    await assert.rejects(ex.createFile("lnk/new.txt", "x"), /REFUSED \(symlink\)/);
    await assert.rejects(ex.readFile("../outside/secret.txt"), /REFUSED \(path_escape\)/);
    await assert.rejects(ex.createFile("../outside/new.txt", "x"), /REFUSED \(path_escape\)/);
    await assert.rejects(ex.createFile("/etc/simsa-escape.txt", "x"), /REFUSED \(path_escape\)/);
    await assert.rejects(ex.createFile("test/smoke.test.mjs", "test('ok', () => {})"), /REFUSED \(protected_file\)/);
    await assert.rejects(ex.createFile("./package.json", "{}"), /REFUSED \(protected_file\)/);
    await assert.rejects(ex.listFiles("lnk"), /REFUSED \(symlink\)/);
    assert.equal(existsSync(path.join(outside, "new.txt")), false);
    assert.equal(readFileSync(path.join(outside, "secret.txt"), "utf8"), "밖의 파일");
    // 정상 경로는 된다(한글 파일명·공백)
    await ex.createFile("src/예약 화면.tsx", "export const 제목 = '예약하기';");
    assert.equal(await ex.readFile("src/예약 화면.tsx"), "export const 제목 = '예약하기';");
    assert.equal(await ex.readFile("src/없음.ts"), null);
    assert.deepEqual(await ex.listFiles(""), ["src/예약 화면.tsx"], "no node_modules, no link targets");
  });

  it("★보호 파일 복원은 링크를 따라가지 않는다: 모델 코드가 test/를 밖을 가리키는 링크로 바꿔도 root인 복원이 밖에 쓰지 않는다", async () => {
    const snapshotProtected = need("snapshotProtected");
    const base = await tmpDir("rlnk");
    const appDir = path.join(base, "app");
    const outside = path.join(base, "outside");
    await fs.mkdir(path.join(appDir, "test"), { recursive: true });
    await fs.writeFile(path.join(appDir, "test", "smoke.test.mjs"), "// 플랫폼 스모크 원본");
    await fs.writeFile(path.join(appDir, "package.json"), '{"name":"예약"}');
    await fs.mkdir(outside, { recursive: true });
    const snap = await snapshotProtected(appDir);
    // 모델의 node 스크립트가 하는 일: test/를 지우고 밖으로 가는 링크로 바꾼다
    await fs.rm(path.join(appDir, "test"), { recursive: true, force: true });
    await fs.symlink(outside, path.join(appDir, "test"), "junction");
    const restored = await work.restoreProtected(appDir, snap);
    assert.deepEqual(restored, ["test/smoke.test.mjs"]);
    assert.equal(existsSync(path.join(outside, "smoke.test.mjs")), false, "nothing was written through the link");
    assert.equal((await fs.lstat(path.join(appDir, "test"))).isSymbolicLink(), false, "the link was cut and replaced by a real folder");
    assert.equal(readFileSync(path.join(appDir, "test", "smoke.test.mjs"), "utf8"), "// 플랫폼 스모크 원본");
    assert.deepEqual(await work.restoreProtected(appDir, snap), [], "idempotent");
  });

  it("decideWorkspaceCommand 표 — 허용 / 거부(사유)", () => {
    const d = need("decideWorkspaceCommand");
    const ok = [["pnpm", ["run", "build"]], ["pnpm", ["test"]], ["pnpm", ["build"]], ["pnpm", ["typecheck"]], ["node", ["--test", "test/"]], ["git", ["status"]], ["git", ["diff", "--stat"]], ["ls", ["src"]], ["cat", ["src/예약 화면.tsx"]]];
    for (const [c, a] of ok) assert.deepEqual(d(c, a), { allowed: true }, `${c} ${a.join(" ")}`);
    const no = [
      [["pnpm", ["add", "left-pad"]], "dependencies_fixed"],
      [["pnpm", ["install"]], "dependencies_fixed"],
      [["pnpm", ["--silent", "dlx", "vercel"]], "pnpm_subcommand"],
      [["pnpm", ["wrangler", "deploy"]], "deploy_cli"],
      [["pnpm", ["run", "deploy"]], "deploy_script"],
      [["pnpm", ["run", "dev"]], "long_running"],
      [["pnpm", ["dev"]], "long_running"],
      [["pnpm", ["--dir", "src", "run", "build"]], "dir_switch"],
      [["git", ["-C", "src", "status"]], "dir_switch"],
      [["git", ["push"]], "git_subcommand"],
      [["git", ["reset", "--hard", "HEAD~3"]], "git_subcommand"],
      [["git", ["-c", "core.pager=node x.js", "log"]], "git_subcommand"],
      [["cat", ["../../builder-run.mjs"]], "path_escape"],
      [["cat", ["/proc/1/environ"]], "path_escape"],
      [["node", ["--require=/tmp/x.js", "a.js"]], "path_escape"],
      [["/usr/bin/node", ["a.js"]], "command_path"],
      [["./node_modules/.bin/vite", ["build"]], "command_path"],
    ];
    for (const [[c, a], reason] of no) assert.equal(d(c, a).reason, reason, `${c} ${a.join(" ")}`);
  });

  it("executor.runCommand: cwd=작업 폴더 · env=준 env(비밀 없음) · 시간 상한 캡 · 출력 ANSI 제거·jobToken 가림", async () => {
    const createWorkspaceExecutor = need("createWorkspaceExecutor");
    const appDir = await tmpDir("run");
    const seen = [];
    const env = work.workEnv(SECRET_ENV, { offline: true });
    const ex = createWorkspaceExecutor({ appDir, env, redactLiterals: [JOB_TOKEN], commandTimeoutCapMs: 1_000, exec: async (cmd, args, opts) => { seen.push({ cmd, args, ...opts }); return { ok: false, code: 1, stdout: `\x1b[31m빨간불\x1b[39m ${JOB_TOKEN}`, stderr: "Bearer abcdefghijklmnopqrstuvwxyz", timedOut: false }; } });
    const r = await ex.runCommand("pnpm", ["test"], { timeoutMs: 999_999, env: { SHOULD_BE_IGNORED: "x" } });
    assert.deepEqual(r, { ok: false, code: 1, stdout: "빨간불 [redacted]", stderr: "Bearer [redacted]" });
    assert.equal(seen[0].cwd, path.resolve(appDir));
    assert.equal(seen[0].timeoutMs, 1_000, "the model cannot raise the command time cap");
    assert.deepEqual(seen[0].env, env, "the executor's env, not the loop's");
  });

  it("★sandboxExec(실제 프로세스): 출력 상한은 앞·끝만 남긴다 · 시간 초과는 죽인다 · 신호로 중단 · env는 준 것만(한글 출력)", async () => {
    const sandboxExec = need("sandboxExec");
    const node = process.execPath;
    const big = await sandboxExec(node, ["-e", "process.stdout.write('앞'.repeat(50) + 'A'.repeat(300000) + '예약 끝')"], { timeoutMs: 20_000, maxOutputBytes: 10_000, env: { PATH: process.env.PATH ?? "" } });
    assert.equal(big.ok, true, big.error);
    assert.equal(big.truncated, true);
    assert.ok(big.stdout.length < 10_200, `bounded (${big.stdout.length})`);
    assert.ok(big.stdout.startsWith("앞앞앞") && big.stdout.endsWith("예약 끝") && big.stdout.includes("chars omitted"));

    const t0 = Date.now();
    const slow = await sandboxExec(node, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300, env: { PATH: process.env.PATH ?? "" } });
    assert.equal(slow.ok, false);
    assert.equal(slow.timedOut, true);
    assert.ok(Date.now() - t0 < 10_000, "killed at the time limit");

    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("wbs_time_limit")), 150);
    const cut = await sandboxExec(node, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 20_000, signal: ac.signal, env: { PATH: process.env.PATH ?? "" } });
    assert.equal(cut.aborted, true);
    assert.equal(cut.ok, false);

    process.env.SIMSA_FAKE_SECRET_FOR_TEST = "zz-FAKE";
    try {
      const keys = await sandboxExec(node, ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"], { timeoutMs: 20_000, env: { PATH: process.env.PATH ?? "", SIMSA_T: "1" } });
      const got = JSON.parse(keys.stdout);
      assert.ok(got.includes("SIMSA_T"));
      assert.ok(!got.includes("SIMSA_FAKE_SECRET_FOR_TEST"), "the parent's env is not inherited");
    } finally {
      delete process.env.SIMSA_FAKE_SECRET_FOR_TEST;
    }
    const pre = new AbortController();
    pre.abort();
    assert.equal((await sandboxExec(node, ["-v"], { signal: pre.signal })).aborted, true, "an aborted signal starts nothing");
  });

  it("redactSecrets · stripAnsi · tailText", () => {
    const redact = need("redactSecrets");
    assert.equal(redact(`토큰 ${JOB_TOKEN} 끝`, [JOB_TOKEN]), "토큰 [redacted] 끝");
    assert.equal(redact(`다른 잡 bjt1.bj_other0001.${"0f".repeat(32)}`), "다른 잡 [redacted]", "any job-token shape");
    assert.equal(redact("authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"), "authorization: Bearer [redacted]");
    assert.equal(redact("짧은 값 abc", ["abc"]), "짧은 값 abc", "literals under 8 chars are not blanked (would shred normal text)");
    assert.equal(work.stripAnsi("\x1b[32m✓ built\x1b[39m 한글"), "✓ built 한글");
    assert.equal(work.tailText("가나다라마", 3), "…[2 chars omitted]\n다라마");
  });

  it("server.mjs: 인스턴스당 빌드 하나 — 같은 jobId·두 번째 빌드는 202 전에 409 builder_busy(생성 코드가 localhost:8080으로 잡을 덮지 못하게)", () => {
    const server = readFileSync(path.join(ROOT, "builder-container/server.mjs"), "utf8");
    const iBusy = server.indexOf('"builder_busy"');
    assert.ok(iBusy > 0 && iBusy < server.indexOf("json(res, 202,"), "busy check before the 202 ack");
    assert.match(server, /inFlightJobs\.has\(payload\.jobId\)/);
  });
});

// ══ ⑤ 프록시 클라이언트 ═══════════════════════════════════════════════════════════════════════════

describe("⑤ Worker 프록시 Anthropic 클라이언트(외부 경계 — 명시 가드)", () => {
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const good = { id: "msg_1", model: "claude-sonnet-4-6-20260101", content: [{ type: "text", text: "읽을게요" }, { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "src/worker.ts" }, caller: { type: "direct" } }, { type: "server_tool_use", id: "x", name: "web_search", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } };

  it("정상 응답 → runBuildLoop 모양으로 정규화(text·tool_use만, 모르는 키 버림, 실응답 모델·vendor)", async () => {
    const calls = [];
    const c = need("createProxyAnthropicClient")({ baseUrl: `${ORIGIN}/internal/build-llm/anthropic/`, apiKey: JOB_TOKEN, fetchImpl: async (u, i) => { calls.push({ u, i }); return ok(good); } });
    const r = await c.messages.create({ model: "claude-sonnet-4-6", max_tokens: 64, messages: [{ role: "user", content: "예약" }] });
    assert.equal(calls[0].u, `${ORIGIN}/internal/build-llm/anthropic/v1/messages`);
    assert.deepEqual(r, { id: "msg_1", model: "claude-sonnet-4-6-20260101", vendor: "anthropic", content: [{ type: "text", text: "읽을게요" }, { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "src/worker.ts" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } });
  });

  it("402 budget_exhausted → status 402 오류(isBudgetExhausted) · 문구에 apiKey 없음 · 재시도 없음", async () => {
    let n = 0;
    const c = work.createProxyAnthropicClient({ baseUrl: ORIGIN, apiKey: JOB_TOKEN, fetchImpl: async () => { n++; return new Response(JSON.stringify({ type: "error", error: { type: "budget_exhausted", message: "build budget exhausted" } }), { status: 402, headers: { "x-should-retry": "false" } }); }, retryOptions: { backoffMs: [0] } });
    const err = await c.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] }).catch((e) => e);
    assert.equal(err.status, 402);
    assert.equal(run.isBudgetExhausted(err), true);
    assert.ok(!String(err.message).includes(JOB_TOKEN));
    assert.equal(n, 1);
  });

  it("529 → 재시도 뒤 성공 · x-should-retry:false인 503은 재시도 안 함 · 모양이 아니면 던진다", async () => {
    const seq = [new Response("{}", { status: 529 }), ok(good)];
    const c1 = work.createProxyAnthropicClient({ baseUrl: ORIGIN, apiKey: JOB_TOKEN, fetchImpl: async () => seq.shift(), retryOptions: { backoffMs: [0] } });
    assert.equal((await c1.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] })).id, "msg_1");
    let n = 0;
    const c2 = work.createProxyAnthropicClient({ baseUrl: ORIGIN, apiKey: JOB_TOKEN, fetchImpl: async () => { n++; return new Response(JSON.stringify({ type: "error", error: { type: "build_disabled" } }), { status: 503, headers: { "x-should-retry": "false" } }); }, retryOptions: { backoffMs: [0] } });
    await assert.rejects(c2.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] }), /503/);
    assert.equal(n, 1);
    const c3 = work.createProxyAnthropicClient({ baseUrl: ORIGIN, apiKey: JOB_TOKEN, fetchImpl: async () => ok({ hello: "world" }) });
    await assert.rejects(c3.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] }), /invalid_llm_response/);
  });

  it("걸러서 빈 응답이면 텍스트 한 줄 — 다음 턴의 assistant 메시지가 비어 프록시 스키마(content ≥1)에서 400이 나지 않게", () => {
    const r = need("parseAnthropicResponse")({ id: "m", content: [{ type: "server_tool_use", id: "s", name: "web_search", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } }, "claude-sonnet-4-6");
    assert.equal(r.content.length, 1);
    assert.equal(r.content[0].type, "text");
    assert.equal(r.model, "claude-sonnet-4-6", "falls back to the requested model");
  });
});

// ══ ⑥ 이미지 · 템플릿 · CI 계약 ═══════════════════════════════════════════════════════════════════

describe("⑥ 이미지 · 템플릿 · CI 계약", () => {
  const dockerfile = readFileSync(path.join(ROOT, "builder-container/Dockerfile"), "utf8");
  const tplPkg = JSON.parse(readFileSync(path.join(REPO_TEMPLATE, "package.json"), "utf8"));

  it("Dockerfile: pnpm = 템플릿 packageManager와 같은 정확한 버전(잡 안에서 버전 전환 다운로드 없음)", () => {
    const pinned = /npm install -g pnpm@(\d+\.\d+\.\d+)/.exec(dockerfile)?.[1];
    assert.equal(`pnpm@${pinned}`, tplPkg.packageManager);
  });

  it("Dockerfile: 샌드박스 사용자·ENV(builder-work SANDBOX_ENV 이름) · 템플릿 의존성 미리 받기(샌드박스 저장소) · builder-work.mjs · 작업 뿌리 750", () => {
    assert.match(dockerfile, /useradd --uid 10001 --gid 10001[^\n]*simsa-run/);
    for (const k of Object.values(need("SANDBOX_ENV"))) assert.match(dockerfile, new RegExp(`${k}=`), `ENV ${k}`);
    assert.match(dockerfile, /SIMSA_SANDBOX_UID=10001/);
    assert.match(dockerfile, /SIMSA_PNPM_STORE_DIR=\/home\/simsa-run\/\.pnpm-store/);
    assert.match(dockerfile, /USER simsa-run\nRUN cd \/tmp\/simsa-prefetch && HOME=\/home\/simsa-run pnpm fetch --store-dir \/home\/simsa-run\/\.pnpm-store\nUSER root/);
    assert.match(dockerfile, /COPY apps\/central-plane\/builder-container\/builder-work\.mjs \.\/builder-work\.mjs/);
    assert.match(dockerfile, /chown root:simsa-run \/var\/lib\/simsa-build && chmod 750 \/var\/lib\/simsa-build/);
    assert.match(dockerfile, /CMD \["node", "\/builder\/server\.mjs"\]/);
    assert.doesNotMatch(dockerfile, /^USER simsa-run\s*\n(?![\s\S]*^USER root)/m, "the server itself runs as root (it chowns and drops to the sandbox per child)");
  });

  it("템플릿: pnpm-workspace.yaml allowBuilds = esbuild·workerd true(‘set this to true or false’ 자리 표시자 없음) · test 스크립트 · 플랫폼 smoke 테스트", () => {
    const ws = readFileSync(path.join(REPO_TEMPLATE, "pnpm-workspace.yaml"), "utf8");
    assert.doesNotMatch(ws, /set this to true or false/);
    assert.match(ws, /allowBuilds:\n\s+esbuild: true\n\s+workerd: true/);
    assert.equal(tplPkg.scripts.test, "node --test test/*.test.mjs");
    assert.equal(tplPkg.pnpm, undefined, "one source of truth for build-script approval (allowBuilds)");
    const smoke = readFileSync(path.join(REPO_TEMPLATE, "test/smoke.test.mjs"), "utf8");
    assert.match(smoke, /\/api\/health/);
    assert.match(smoke, /from "vite"/, "uses only an existing dependency");
    const imports = [...smoke.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.startsWith("node:"));
    const deps = new Set([...Object.keys(tplPkg.dependencies ?? {}), ...Object.keys(tplPkg.devDependencies ?? {})]);
    assert.ok(imports.every((s) => deps.has(s)), `smoke imports must be template deps: ${imports}`);
  });

  it("템플릿: package.json 의존성 = lockfile 명세(frozen 설치가 통과하는 모양)", () => {
    const lock = readFileSync(path.join(REPO_TEMPLATE, "pnpm-lock.yaml"), "utf8");
    for (const [name, spec] of Object.entries({ ...tplPkg.dependencies, ...tplPkg.devDependencies })) {
      const key = name.startsWith("@") ? `'${name}'` : name;
      assert.ok(lock.includes(`\n      ${key}:\n        specifier: ${spec}\n`), `${name}@${spec} in pnpm-lock.yaml importers`);
    }
  });

  it("container-images CI: 가짜 LLM 프록시로 실제 이미지에서 WBS 1개 → 게이트 통과 · 고의 실패 → failed(building) · 샌드박스 증거", () => {
    const yml = readFileSync(path.join(REPO, ".github/workflows/container-images.yml"), "utf8");
    assert.match(yml, /\/internal\/build-llm\/anthropic\/v1\/messages/, "the receiver fakes the Worker LLM proxy");
    assert.match(yml, /gate_passed/);
    assert.match(yml, /builder_stage_not_implemented:pushed/);
    assert.match(yml, /failedStage == "building"/);
    assert.match(yml, /build_failed:/);
    assert.match(yml, /\.sandbox\.enabled == true/);
    assert.match(yml, /uid=10001/, "a model command proves it ran as the sandbox user");
    assert.match(yml, /environ/, "…and could not read the server's environment");
    assert.match(yml, /installMode == "offline"/, "the image store makes the install offline");
  });

  it("RUNNER_REV가 올라갔다(이미지 교체 판별)", () => {
    assert.notEqual(run.RUNNER_REV, "b5bS1-builder-6");
    assert.match(run.RUNNER_REV, /^b5bS2-builder-\d+$/);
  });
});

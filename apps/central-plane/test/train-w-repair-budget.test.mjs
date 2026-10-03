/**
 * train-w-repair-budget.test.mjs — 비용 권고 ② (2026-09-30, D-7 amend [PILOT]): 수리 잡당 달러 상한.
 *
 * 계약:
 *   - Worker가 env REPAIR_JOB_BUDGET_USD([vars], 기본 $2)를 읽어 디스패치 페이로드 `repairBudgetUsd`로
 *     컨테이너에 넘긴다. 옛 컨테이너는 이 필드를 모른다(무시) — 새 컨테이너가 필드 없는 페이로드를 받으면 기본 $2.
 *   - 컨테이너는 워커 LLM 호출마다(ClaudeWorker onUsage — 응답 파싱 **전에** 불린다) 실응답 모델 단가로
 *     비용을 누적한다. 가격표 밖 모델은 agent-worker의 보수 단가(표의 성분별 최대)로 — 0으로 치지 않는다.
 *     비용을 못 읽는 레코드는 상한 전체로 친다(모르면 멈춘다).
 *   - **다음 호출 전에** 누적 ≥ 상한이면 더 부르지 않는다(budgetedWorker가 호출 전에 던진다).
 *   - 멈춤은 정직하게: 수리는 기존 정직 폴백(지시서 draft PR, LLM 0회)으로 마감하고 콜백 modeReason이
 *     `budget_exceeded(...)`로 시작한다 → Worker 잡 뷰 `stoppedByBudget: true` → 대시보드 한 줄(KO/EN).
 *
 * 왜 기존 EfficiencyGate($0.50 기본)로는 모자란가 — 실측(아래 ③): 게이트는 **성공한 호출만** 커밋한다.
 * 응답 파싱이 실패한 호출(WorkerParseError)은 비용이 났는데도 게이트 예산에 안 잡혀, 실패 루프는 막히지 않았다.
 *
 * 컨테이너(server.mjs)는 node --test에서 돌 수 없다 — 행동은 coerce-result.mjs 순수 헬퍼 + 실제
 * agent-worker dist(ClaudeWorker, 모크 클라이언트)로 고정하고, server.mjs 배선은 "[소스 불변식·약함]"으로 따로 표기.
 * 네트워크 없음.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const coerce = await import("../container/coerce-result.mjs");
const limits = await import("../dist/workspace/beta-limits.js");
const { dispatchRepairJob } = await import("../dist/routes/workspace-repair-jobs.js");
const { ClaudeWorker, PRICING } = await import("../../../packages/agent-worker/dist/index.js");
const { EfficiencyGate } = await import("../../../packages/core/dist/index.js");

const noHangul = (s) => !/[가-힣]/.test(s);

/** The helpers are new — fail on old code with a clear message instead of a TypeError. */
function need(name) {
  assert.equal(typeof coerce[name], "function", `container/coerce-result.mjs must export ${name}()`);
  return coerce[name];
}

// ─── ① Worker: env → payload ──────────────────────────────────────────────────

test("① repairJobBudgetUsd: 기본 $2 · env로 조정 · 잘못된 값은 기본값", () => {
  assert.equal(typeof limits.repairJobBudgetUsd, "function", "beta-limits must export repairJobBudgetUsd()");
  assert.equal(limits.repairJobBudgetUsd({}), 2);
  assert.equal(limits.repairJobBudgetUsd({ REPAIR_JOB_BUDGET_USD: "3.5" }), 3.5);
  assert.equal(limits.repairJobBudgetUsd({ REPAIR_JOB_BUDGET_USD: " 0.75 " }), 0.75);
  for (const junk of ["", "0", "-1", "abc", "2abc", "Infinity", "NaN"]) {
    assert.equal(limits.repairJobBudgetUsd({ REPAIR_JOB_BUDGET_USD: junk }), 2, `junk ${JSON.stringify(junk)} → default`);
  }
});

function recordingEnv(vars = {}) {
  const calls = [];
  const env = {
    INTERNAL_CALLBACK_TOKEN: "tok_fake",
    SANDBOX: {
      idFromName: () => "id",
      get: () => ({
        fetch: async (_url, init) => {
          calls.push(JSON.parse(init.body));
          return { ok: true, text: async () => "" };
        },
      }),
    },
    ...vars,
  };
  return { env, calls };
}

const DISPATCH_ARGS = {
  jobId: "wrj_budget1", projectId: "wsp_budget", userKey: "uk_budget", visualCheckId: "wvc_budget1",
  repo: "acme/golf-now", githubToken: "gho_fakeTokenForTests", branch: "fix/simsa-wvc_budget1",
  agentPrompt: "[고칠 문제] 버튼을 눌러도 목록이 비어 있어요", intent: "골퍼가 코스 목록을 볼 수 있어야 한다",
  targetUrl: "https://golf-now.example.app/", decision: "Needs Fix", envCause: false, locale: "ko",
  publicBaseUrl: "https://central.example",
};

test("① 디스패치 페이로드가 잡당 상한을 싣는다 — 기본 2 · env 0.75", async () => {
  const a = recordingEnv();
  assert.equal((await dispatchRepairJob(a.env, DISPATCH_ARGS)).dispatched, true);
  assert.equal(a.calls[0].repairBudgetUsd, 2);

  const b = recordingEnv({ REPAIR_JOB_BUDGET_USD: "0.75" });
  assert.equal((await dispatchRepairJob(b.env, DISPATCH_ARGS)).dispatched, true);
  assert.equal(b.calls[0].repairBudgetUsd, 0.75);
  // A number, not a secret: it rides the body next to the job contract (keys stay in headers).
  assert.equal(typeof b.calls[0].repairBudgetUsd, "number");
});

// ─── ② Container: payload → budget ────────────────────────────────────────────

test("② resolveRepairBudgetUsd: 페이로드 값(양의 유한수)만 · 옛 Worker(필드 없음)·잘못된 값은 기본 $2", () => {
  const resolve = need("resolveRepairBudgetUsd");
  assert.equal(coerce.DEFAULT_REPAIR_JOB_BUDGET_USD, 2);
  assert.equal(resolve(2.5), 2.5);
  assert.equal(resolve(0.25), 0.25);
  for (const junk of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "3", {}, true]) {
    assert.equal(resolve(junk), 2, `junk ${String(junk)} → default`);
  }
});

test("② 옛 Worker 호환: repairBudgetUsd 없는 페이로드도 검증 통과(필수 필드 아님)", () => {
  const payload = { ...DISPATCH_ARGS, callbackUrl: "https://c/internal/repair-done", callbackToken: "tok_fake" };
  assert.deepEqual(coerce.validateRepairPayload(payload), { ok: true });
});

test("② 누적 $1.9 → 다음 호출 진행 / $2.0 → 중단 (호출 전에 막고, 워커는 불리지 않는다)", async () => {
  const createRepairBudget = need("createRepairBudget");
  const budgetedWorker = need("budgetedWorker");
  const isRepairBudgetStop = need("isRepairBudgetStop");

  const budget = createRepairBudget(2);
  const seen = [];
  const inner = {
    async work(ctx) { seen.push(["work", ctx.tag]); return { rewrites: [], message: "m" }; },
    async workEdits(ctx) { seen.push(["workEdits", ctx.tag]); return { edits: [], message: "m" }; },
  };
  const worker = budgetedWorker(inner, budget);

  budget.onUsage({ costUsd: 1.9, modelActual: "gpt-5.4" });
  assert.equal(budget.exceeded(), false);
  await worker.work({ tag: "at-1.9" });
  await worker.workEdits({ tag: "edits-at-1.9" });
  assert.deepEqual(seen, [["work", "at-1.9"], ["workEdits", "edits-at-1.9"]], "under the cap → the call goes through");

  budget.onUsage({ costUsd: 0.1, modelActual: "gpt-5.4" });
  assert.ok(Math.abs(budget.spentUsd() - 2) < 1e-9);
  assert.equal(budget.exceeded(), true, "at the cap = stop (spent ≥ cap)");
  await assert.rejects(() => worker.work({ tag: "at-2.0" }), (err) => isRepairBudgetStop(err));
  await assert.rejects(() => worker.workEdits({ tag: "edits-at-2.0" }), (err) => isRepairBudgetStop(err));
  assert.equal(seen.length, 2, "no call reached the worker once the budget was spent");
  assert.equal(isRepairBudgetStop(new Error("worker_call_failed")), false, "other errors are not budget stops");
});

test("② 부동소수 합(0.7+0.6+0.7 = 1.9999999999999998)이 호출 한 번을 더 사지 않는다", () => {
  const b = need("createRepairBudget")(2);
  for (const c of [0.7, 0.6, 0.7]) b.onUsage({ costUsd: c, modelActual: "gpt-5.4" });
  assert.equal(b.exceeded(), true);
});

test("② 비용을 못 읽는 레코드는 상한 전체로 친다(모르면 멈춘다) · 싱크는 던지지 않는다", () => {
  const createRepairBudget = need("createRepairBudget");
  for (const bad of [{ costUsd: Number.NaN }, { costUsd: -0.5 }, { costUsd: "0.1" }, {}, { costUsd: Number.POSITIVE_INFINITY }]) {
    const b = createRepairBudget(2);
    b.onUsage({ modelActual: "gpt-5.4", ...bad });
    assert.equal(b.exceeded(), true, `unreadable cost ${JSON.stringify(bad)} → treated as the whole budget`);
  }
  const b = createRepairBudget(2);
  for (const junk of [null, undefined, "x", 3]) assert.doesNotThrow(() => b.onUsage(junk));
  assert.equal(b.exceeded(), false, "a non-record (not a call) is not a cost");
});

test("② 멈춤 사유: modeReason은 budget_exceeded로 시작 · 직전 사유는 last=로 남긴다(API 진단)", () => {
  const createRepairBudget = need("createRepairBudget");
  const markBudgetStop = need("markBudgetStop");
  const b = createRepairBudget(2);
  b.onUsage({ costUsd: 2.4, modelActual: "gpt-5.4" });
  const diag = { skippedOversize: [], reason: "worker_call_failed: WorkerParseError: bad tool input" };
  markBudgetStop(diag, b);
  assert.equal(diag.budgetExceeded, true);
  assert.match(diag.reason, /^budget_exceeded\(cap=\$2\.00\); last=worker_call_failed: WorkerParseError/);
  // idempotent: a second stop does not stack "last=budget_exceeded…"
  markBudgetStop(diag, b);
  assert.equal((diag.reason.match(/budget_exceeded/g) ?? []).length, 1);

  const fresh = { skippedOversize: [], reason: null };
  markBudgetStop(fresh, b);
  assert.equal(fresh.reason, "budget_exceeded(cap=$2.00)");
});

test("② 지시서 PR 본문의 정직 노트 — KO/EN, 한도로 멈춘 사실 + 지시서로 이어가는 길 (금액은 PR에 쓰지 않는다)", () => {
  const diag = { skippedOversize: [], reason: "budget_exceeded(cap=$2.00)", budgetExceeded: true };
  const ko = coerce.buildBriefOnlyDiagnosis(diag, "ko");
  assert.equal(ko.modeReason, "budget_exceeded(cap=$2.00)");
  assert.ok(ko.prNote, "a budget stop must explain itself in the PR body");
  assert.match(ko.prNote, /한도/);
  assert.match(ko.prNote, /SIMSA-FIX-BRIEF\.md/);
  assert.ok(!ko.prNote.includes("$"), "the PR (the user's repo) never shows our cost numbers");

  const en = coerce.buildBriefOnlyDiagnosis(diag, "en");
  assert.ok(noHangul(en.prNote));
  assert.match(en.prNote, /limit/i);
  assert.match(en.prNote, /SIMSA-FIX-BRIEF\.md/);

  // With oversize skips too: both causes, one closing "hand this brief" line.
  const both = coerce.buildBriefOnlyDiagnosis({ ...diag, skippedOversize: [{ path: "index.html", bytes: 398336 }] }, "ko");
  assert.equal(both.modeReason, "budget_exceeded(cap=$2.00); oversize_skipped: index.html(389KB)");
  assert.match(both.prNote, /자동수정을 시도하지 못한 파일/);
  assert.match(both.prNote, /한도/);
  assert.equal((both.prNote.match(/SIMSA-FIX-BRIEF\.md/g) ?? []).length, 1);
});

test("② 행동 보존: 예산 멈춤이 아닌 폴백은 노트·사유가 그대로", () => {
  const plain = coerce.buildBriefOnlyDiagnosis({ skippedOversize: [], reason: "no_findings" });
  assert.equal(plain.modeReason, "no_findings");
  assert.equal(plain.prNote, null);
});

// ─── ③ 실제 agent-worker dist + 모크 클라이언트 ────────────────────────────────

const REVIEW = {
  agent: "simsa",
  verdict: "rework",
  blockers: [{ severity: "major", category: "bug", message: "버튼을 눌러도 목록이 비어 있어요" }],
  summary: "목록이 비어 있음",
};
const CTX = { repo: "acme/golf-now", pullNumber: 0, newSha: "abc123", reviews: [REVIEW], fileSnapshots: [{ path: "app.js", contents: "const list = [];\n" }] };

function mockClient({ model, inputTokens, outputTokens, validTool = true }) {
  const calls = [];
  return {
    calls,
    client: {
      messages: {
        async create(params) {
          calls.push(params.model);
          const input = validTool
            ? { rewrites: [{ path: "app.js", content: "const list = [1];\n" }], commitMessage: "fix: 목록 채우기" }
            : { rewrites: "not-an-array" };
          return {
            model,
            content: [{ type: "tool_use", id: "tu_1", name: params.tools[0].name, input }],
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            stop_reason: "tool_use",
          };
        },
      },
    },
  };
}

test("③ 가격표 밖 모델도 누적한다 — 보수 단가(표의 성분별 최대), 0이 아니다 → 상한에서 다음 호출 전 중단", async () => {
  const budget = need("createRepairBudget")(2);
  const isStop = need("isRepairBudgetStop");
  assert.ok(!Object.hasOwn(PRICING, "mystery-model-9"), "fixture model must be outside the price table");
  const m = mockClient({ model: "mystery-model-9", inputTokens: 100_000, outputTokens: 30_000 });
  // A roomy worker gate so ONLY the job budget is under test here (the default $0.50 gate would
  // refuse the 2nd successful call on its own — see the next test for where that gate is blind).
  const gate = new EfficiencyGate({ perPrUsd: 100 });
  const worker = need("budgetedWorker")(new ClaudeWorker({ client: m.client, gate, onUsage: budget.onUsage }), budget);

  await worker.work(CTX);
  const maxIn = Math.max(...Object.values(PRICING).map((p) => p.inputPerMTok));
  const maxOut = Math.max(...Object.values(PRICING).map((p) => p.outputPerMTok));
  const perCall = (100_000 * maxIn + 30_000 * maxOut) / 1_000_000;
  assert.ok(perCall > 0);
  assert.ok(Math.abs(budget.spentUsd() - perCall) < 1e-9, `unpriced model counted at the conservative rate ($${perCall})`);

  // Keep calling until the cap: every call under the cap goes through, the first at/over it does not.
  let refused = null;
  for (let i = 0; i < 10 && !refused; i++) {
    try {
      await worker.work(CTX);
    } catch (err) {
      refused = err;
    }
  }
  assert.ok(refused && isStop(refused), "the budget stop fired");
  assert.equal(m.calls.length, Math.ceil(2 / perCall), "exactly the calls needed to reach $2 — none after");
  assert.ok(budget.spentUsd() >= 2);
});

test("③ 응답 파싱이 실패한 호출도 센다 — 기존 게이트(성공만 커밋)가 놓치던 실패 루프를 여기서 멈춘다", async () => {
  const budget = need("createRepairBudget")(2);
  const isStop = need("isRepairBudgetStop");
  // gpt-5.4: 200k in × $2.5 + 40k out × $15 = $0.50 + $0.60 = $1.10 per call.
  const m = mockClient({ model: "gpt-5.4", inputTokens: 200_000, outputTokens: 40_000, validTool: false });
  const worker = need("budgetedWorker")(new ClaudeWorker({ client: m.client, onUsage: budget.onUsage }), budget);

  const outcomes = [];
  for (let i = 0; i < 4; i++) {
    try {
      await worker.work(CTX);
      outcomes.push("ok");
    } catch (err) {
      outcomes.push(isStop(err) ? "budget" : err?.name ?? "error");
    }
  }
  assert.deepEqual(outcomes, ["WorkerParseError", "WorkerParseError", "budget", "budget"]);
  assert.equal(m.calls.length, 2, "two paid-but-unparseable calls, then no more");
  assert.ok(Math.abs(budget.spentUsd() - 2.2) < 1e-9);

  // The gap this closes: the worker's own EfficiencyGate ($0.50 default) never saw those calls.
  const bare = mockClient({ model: "gpt-5.4", inputTokens: 200_000, outputTokens: 40_000, validTool: false });
  const unguarded = new ClaudeWorker({ client: bare.client });
  for (let i = 0; i < 4; i++) await unguarded.work(CTX).catch(() => undefined);
  assert.equal(bare.calls.length, 4, "without the job budget, four paid calls ($4.40) went out");
});

// ─── ③′ usage 없는 과금 응답 (#576 검증 P2-8) ───────────────────────────────────
//
// 예산 싱크는 "비용을 못 읽으면 상한 전체"였지만, 그 판정 **앞**에서 두 경로가 샜다:
//   (A) OpenAI 폴백 응답에 usage가 없으면 변환이 토큰을 0으로 만들어 costUsd = 0(유한수)으로 누적됐다.
//   (B) Anthropic 형태 응답에 usage가 없으면 meter()가 TypeError로 죽어 onUsage가 불리지 않았다(루프는 계속).
// 이제 agent-worker가 usage를 "모름"(usageUnknown: true, unpriced, 보수 추정 비용)으로 내보내고, 잡 예산은
// 그런 레코드를 상한 전체로 친다(모르면 멈춘다).

const TOOL_NAME = "submit_rewrite";
const badToolInput = JSON.stringify({ rewrites: "not-an-array" });

async function runUntilStop(worker, isStop, n = 3) {
  const outcomes = [];
  for (let i = 0; i < n; i++) {
    try {
      await worker.work(CTX);
      outcomes.push("ok");
    } catch (err) {
      outcomes.push(isStop(err) ? "budget" : err?.name ?? "error");
    }
  }
  return outcomes;
}

test("③′ 잡 예산: usageUnknown 레코드는 비용 값과 상관없이 상한 전체로 친다", () => {
  const b = need("createRepairBudget")(2);
  b.onUsage({ modelActual: "gpt-5.4", costUsd: 0.01, unpriced: true, usageUnknown: true });
  assert.equal(b.exceeded(), true, "a paid call whose usage we could not read stops the job");
});

test("③′ (A) OpenAI 폴백 응답에 usage가 없으면 — 0으로 치지 않고 첫 호출 뒤 멈춘다", async () => {
  const { withOpenAiFallback } = await import("../../../packages/agent-worker/dist/openai-fallback.js");
  const budget = need("createRepairBudget")(2);
  const isStop = need("isRepairBudgetStop");
  let openAiCalls = 0;
  const fetchImpl = async () => {
    openAiCalls++;
    return new Response(
      JSON.stringify({
        model: "gpt-5.4-2026-03-05",
        choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: TOOL_NAME, arguments: badToolInput } }] }, finish_reason: "tool_calls" }],
        // no "usage" block
      }),
      { status: 200 },
    );
  };
  const client = withOpenAiFallback(null, { openaiApiKey: "test-openai-key", preferFallback: true, fetchImpl });
  const worker = need("budgetedWorker")(new ClaudeWorker({ client, onUsage: budget.onUsage }), budget);
  const outcomes = await runUntilStop(worker, isStop);
  assert.deepEqual(outcomes, ["WorkerParseError", "budget", "budget"]);
  assert.equal(openAiCalls, 1, "one paid call with unknown usage, then no more");
});

test("③′ (B) Anthropic 형태 응답에 usage가 없으면 — 계측이 죽지 않고 첫 호출 뒤 멈춘다", async () => {
  const budget = need("createRepairBudget")(2);
  const isStop = need("isRepairBudgetStop");
  let calls = 0;
  const client = {
    messages: {
      async create(params) {
        calls++;
        return { id: "m", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "tu_1", name: params.tools[0].name, input: { rewrites: "not-an-array" } }], stop_reason: "tool_use" };
      },
    },
  };
  const worker = need("budgetedWorker")(new ClaudeWorker({ client, onUsage: budget.onUsage }), budget);
  const outcomes = await runUntilStop(worker, isStop);
  assert.deepEqual(outcomes, ["WorkerParseError", "budget", "budget"], "no TypeError from the meter; the budget saw the call");
  assert.equal(calls, 1);
});

test("③′ 행동 보존: usage가 있는 응답은 종전대로 실응답 모델 단가로 누적(모름 표시 없음)", async () => {
  const budget = need("createRepairBudget")(2);
  const records = [];
  const m = mockClient({ model: "gpt-5.4", inputTokens: 1_000, outputTokens: 100, validTool: false });
  const worker = need("budgetedWorker")(new ClaudeWorker({ client: m.client, onUsage: (u) => { records.push(u); budget.onUsage(u); } }), budget);
  await worker.work(CTX).catch(() => undefined);
  assert.equal(records.length, 1);
  assert.notEqual(records[0].usageUnknown, true);
  assert.ok(Math.abs(budget.spentUsd() - (1_000 * 2.5 + 100 * 15) / 1_000_000) < 1e-12);
});

// ─── ⑤ 예산 배선이 빠지면 조용히 무제한이 되지 않는다 (#576 검증 P2-6) ─────────────
//
// attemptAutoFix의 기본 인자 `budget = createRepairBudget()`는 onUsage와 연결되지 않은 새 예산이라, 호출부에서
// budget만 빠져도 exceeded()가 늘 false였다(변이 실험: 51/51 통과). 이제 budgetedWorker는 예산 없이 만들 수
// 없고(→ attemptAutoFix가 던지고 runRepairJob이 LLM 0회 지시서 폴백으로 마감), 기본 인자는 없다.

test("⑤ budgetedWorker는 쓸 수 있는 예산 없이는 만들어지지 않는다(빠지면 LLM 0회로 멈춘다)", () => {
  const budgetedWorker = need("budgetedWorker");
  const inner = { async work() { throw new Error("must not be called"); }, async workEdits() { throw new Error("must not be called"); } };
  for (const bad of [undefined, null, {}, { exceeded: true }, "2"]) {
    assert.throws(() => budgetedWorker(inner, bad), /budget/i, `bad budget ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => budgetedWorker(inner, need("createRepairBudget")(2)));
});

// ─── ④ server.mjs 배선 — [소스 불변식·약함] (컨테이너는 node --test에서 못 돈다) ─────

test("④ [소스 불변식·약함] attemptAutoFix는 예산을 기본값 없이 받고, 호출부 두 곳이 예산을 넘긴다", () => {
  assert.doesNotMatch(serverMjs, /budget\s*=\s*createRepairBudget\(\s*\)/, "no silent default budget (a fresh one never sees onUsage)");
  const sigStart = serverMjs.indexOf("async function attemptAutoFix(");
  assert.ok(sigStart > 0);
  const sig = serverMjs.slice(sigStart, serverMjs.indexOf(") {", sigStart));
  assert.match(sig, /\bbudget\b/, "attemptAutoFix takes the job budget");
  assert.match(serverMjs, /attemptAutoFix\(\{[^}]*\bonUsage\b[^}]*\bbudget\b[^}]*\}\)/, "runRepairJob passes the SAME budget its onUsage feeds");
  assert.match(serverMjs, /attemptOversizeEditFix\(\{[^}]*\bbudget\b[^}]*\}\)/, "the oversize rung gets it too");
});

const serverMjs = readFileSync(path.join(ROOT, "container/server.mjs"), "utf8");

test("④ [소스 불변식·약함] runRepairJob: 페이로드 상한으로 예산을 만들고 onUsage를 수집기·예산 양쪽에 준다", () => {
  assert.match(serverMjs, /createRepairBudget\(\s*resolveRepairBudgetUsd\(\s*payload\.repairBudgetUsd\s*\)\s*\)/);
  assert.match(serverMjs, /usage\.onUsage\(u\);\s*budget\.onUsage\(u\);/);
});

test("④ [소스 불변식·약함] attemptAutoFix: ClaudeWorker는 budgetedWorker로만 감싸 쓰고, 예산 멈춤이면 루프·큰 파일 단계를 끝낸다", () => {
  assert.match(serverMjs, /const worker = budgetedWorker\(\s*new ClaudeWorker\(/);
  assert.equal((serverMjs.match(/new ClaudeWorker\(/g) ?? []).length, 1, "one construction site, and it is wrapped");
  assert.match(serverMjs, /isRepairBudgetStop\(err\)[\s\S]{0,400}markBudgetStop\(diag, budget\)[\s\S]{0,300}break;/);
  assert.match(serverMjs, /isRepairBudgetStop\(err\)[\s\S]{0,400}markBudgetStop\(diag, budget\)[\s\S]{0,300}return null;/, "the oversize rung stops too");
  assert.match(serverMjs, /diag\.skippedOversize\.length > 0 && Date\.now\(\) < deadline && !diag\.budgetExceeded/);
});

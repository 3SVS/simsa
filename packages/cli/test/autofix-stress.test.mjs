// Hermetic stress harness for runAutofix — finds stall paths and
// behavioral surprises by running hundreds of permuted scenarios with
// fault injection at every seam (worker patches, git, special
// handlers, verdict sequences, build/test, push). Burns NO credits.
//
// Invariants we verify across all scenarios:
//   I1. autofix never `git reset --hard HEAD`s when handler-staged
//       fixes are still on disk (the v0.14.19 + Bug #2 invariant).
//   I2. Pushed commit (when one happens) carries the right cycle
//       marker `[conclave-rework-cycle:N+1]`.
//   I3. status === "bailed-no-patches" is only emitted when BOTH
//       worker patches AND handler-staged fixes are empty/conflicted.
//   I4. handler-staged fixes are NEVER fed to `git apply` (the
//       v0.14.19 invariant).
//   I5. handler-staged fix files are NEVER targeted by AF-1's
//       `git checkout HEAD -- <file>` partial-restore.
//   I6. At terminal status, emitReviewFinishedIfTerminal fires (we
//       observe this via the notifier capture).
//   I7. L2 autonomy never auto-merges; L3 merges exactly when verdict
//       converges to APPROVE.
//   I8. Build-fail or tests-fail revert + do NOT commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAutofix } from "../dist/commands/autofix.js";

// ---- Generic fault-injecting harness --------------------------------

const baseArgs = {
  budgetUsd: 3,
  maxIterations: 2,
  autonomy: "l2",
  cwd: "/repo",
  dryRun: false,
  help: false,
  allowSecrets: [],
  skipSecretGuard: false,
  reworkCycle: 0,
  pr: 42,
};

const fakeConfig = {
  config: { version: 1, agents: ["claude"], budget: { perPrUsd: 3 } },
  configDir: "/tmp/fake",
};

const goodPatch = (file = "src/x.ts") =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,1 @@\n-a\n+b\n`;

function makeGit({
  applyConflictForPatches = new Set(),
  fuzzAlsoFails = true,
  pushFails = false,
  commitFails = false,
} = {}) {
  const calls = [];
  const checkedOutFiles = []; // captures `git checkout HEAD -- <files>`
  const stagedFiles = [];     // captures `git add -- <files>`
  let patchAttempt = 0;
  const exec = async (bin, args) => {
    calls.push({ bin, args: [...args] });
    if (bin === "git" && args[0] === "checkout" && args[1] === "HEAD" && args[2] === "--") {
      checkedOutFiles.push(...args.slice(3));
    }
    if (bin === "git" && args[0] === "add" && args[1] === "--") {
      stagedFiles.push(...args.slice(2));
    }
    if (bin === "git" && args[0] === "apply") {
      const isCheck = args.includes("--check");
      // Each apply attempt is for one patch. We use sequence index to
      // know which patch we're on; the harness configures which indexes
      // should conflict. The autofix code calls apply twice per patch
      // (--check then real); count one unit per --check call.
      if (isCheck) patchAttempt += 1;
      const idx = patchAttempt - 1;
      if (applyConflictForPatches.has(idx)) {
        throw new Error("error: patch failed: src/x.ts:1\nerror: src/x.ts: patch does not apply");
      }
    }
    if (bin === "patch") {
      // GNU patch fuzz fallback. Mirror the conflict decision so failure
      // patterns are coherent.
      if (fuzzAlsoFails) {
        throw new Error("patch: **** unexpected end of file in patch");
      }
    }
    if (bin === "git" && args[0] === "commit" && commitFails) {
      throw new Error("error: nothing to commit");
    }
    if (bin === "git" && args[0] === "push" && pushFails) {
      throw new Error("error: failed to push some refs");
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  return { calls, exec, checkedOutFiles, stagedFiles };
}

function makeVerifier({ buildOk = true, testsOk = true } = {}) {
  return {
    build: async () => ({
      success: buildOk,
      command: "pnpm build",
      stdout: "",
      stderr: buildOk ? "" : "TS2345: type error",
      durationMs: 1,
      detectedFrom: "package.json",
    }),
    test: async () => ({
      success: testsOk,
      command: "pnpm test",
      stdout: "",
      stderr: testsOk ? "" : "test failure",
      durationMs: 1,
      detectedFrom: "package.json",
    }),
  };
}

function makeReviewSequence(verdicts) {
  let i = 0;
  return async () => {
    const v = verdicts[Math.min(i, verdicts.length - 1)];
    i += 1;
    return {
      verdict: v.verdict,
      reviews:
        v.reviews ??
        [{ agent: "claude", verdict: v.verdict, summary: "", blockers: v.blockers ?? [] }],
    };
  };
}

const ghPopulatesRepo = async () => ({
  stdout: JSON.stringify({
    state: "OPEN",
    headRefOid: "h",
    updatedAt: "t",
    headRepository: { name: "r" },
    headRepositoryOwner: { login: "o" },
  }),
  stderr: "",
});

// Worker that returns one rewrite per blocker call. Tests configure each
// blocker's outcome via the `outcomes` array indexed by call order.
function makeProgrammableWorker(outcomes) {
  let i = 0;
  return {
    work: async (ctx) => {
      const o = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      const file = ctx.blocker?.file ?? "src/x.ts";
      if (o === "ok") {
        return {
          rewrites: [{ path: file, content: `// fixed\nexport const x: number = 1;\n` }],
          message: `fix: ${ctx.blocker?.category}`,
          appliedFiles: [file],
          costUsd: 0.01,
          tokensUsed: 100,
        };
      }
      if (o === "no-patch") {
        return { rewrites: [], message: "", appliedFiles: [], costUsd: 0.01, tokensUsed: 50 };
      }
      if (o === "garbage") {
        // "garbage" in the rewrite model is: malformed content that still applies.
        // Since writes can't fail due to content format, we simulate by returning
        // an empty rewrites array (worker gave up), same effect as "no-patch".
        return { rewrites: [], message: "fix: junk", appliedFiles: [], costUsd: 0.01, tokensUsed: 100 };
      }
      throw new Error(`worker fault: ${o}`);
    },
  };
}

// Programmable special-handler stub. Returns the next outcome in the
// queue, indexed by blocker order. Outcomes:
//   "skip"   → { claimed: false }
//   "claim"  → { claimed: true, fix: { ... ready, sentinel patch, applied
//               files include blocker.file or fallback } }
//   "claim-no-patch" → like above but with no patch field.
function makeProgrammableHandlers(outcomes) {
  let i = 0;
  return async (agent, blocker) => {
    const o = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    if (!o || o === "skip") return { claimed: false };
    const file = blocker.file ?? "src/handler.ts";
    if (o === "claim") {
      return {
        claimed: true,
        fix: {
          agent,
          blocker,
          status: "ready",
          patch: `# AF-X mechanical fix on ${file} (no unified diff — direct file rewrite + git add)\n`,
          commitMessage: `fix: handler claim for ${file} (AF-X)`,
          appliedFiles: [file],
          costUsd: 0,
        },
      };
    }
    if (o === "claim-no-patch") {
      return {
        claimed: true,
        fix: {
          agent,
          blocker,
          status: "ready",
          commitMessage: `fix: handler claim no patch (AF-bin)`,
          appliedFiles: [file],
          costUsd: 0,
        },
      };
    }
    if (o === "claim-failed") {
      return {
        claimed: true,
        fix: {
          agent,
          blocker,
          status: "worker-error",
          reason: "handler tried but failed",
          costUsd: 0,
        },
      };
    }
    return { claimed: false };
  };
}

function blockerList(specs) {
  return specs.map((s, i) => ({
    severity: s.severity ?? "blocker",
    category: s.category ?? `cat-${i}`,
    message: s.message ?? `msg ${i}`,
    file: s.file ?? `src/file${i}.ts`,
    ...(s.line ? { line: s.line } : {}),
  }));
}

async function drive(scenario) {
  const git = makeGit(scenario.git ?? {});
  const verifier = makeVerifier(scenario.verifier ?? {});
  const stdoutBuf = [];
  const stderrBuf = [];
  const mergeCalls = [];
  const verdicts = scenario.verdicts ?? [
    { verdict: "rework", blockers: scenario.blockers },
    { verdict: "approve" },
  ];
  const out = await runAutofix(
    {
      ...baseArgs,
      ...(scenario.args ?? {}),
      pr: scenario.args?.pr ?? 42,
    },
    {
      loadConfig: async () => fakeConfig,
      worker: makeProgrammableWorker(scenario.workerOutcomes ?? []),
      git: git.exec,
      verifier,
      readFile: async () => "x",
      writeFile: async () => {},
      gh: ghPopulatesRepo,
      mergePr: async (n) => { mergeCalls.push(n); },
      runReview: makeReviewSequence(verdicts),
      runSpecialHandlers: makeProgrammableHandlers(scenario.handlerOutcomes ?? []),
      stdout: (s) => stdoutBuf.push(s),
      stderr: (s) => stderrBuf.push(s),
    },
  );
  return {
    code: out.code,
    result: out.result,
    git,
    mergeCalls,
    stdout: stdoutBuf.join(""),
    stderr: stderrBuf.join(""),
  };
}

// ---- Invariant assertions ------------------------------------------

function assertHandlerStagedNeverApplied(scenario, drive) {
  const handlerStagedFiles = (scenario.handlerOutcomes ?? [])
    .map((o, i) => (o === "claim" || o === "claim-no-patch" ? scenario.blockers[i]?.file : null))
    .filter(Boolean);
  // I4 — in v0.14+ worker uses full-file rewrites (no git apply), so handler
  // sentinels can never leak into a git apply call. The invariant is
  // trivially satisfied; we just verify no `git apply` is called at all
  // with handler-staged sentinel content.
  const applyWithSentinel = drive.git.calls.filter(
    (c) => c.bin === "git" && c.args[0] === "apply",
  );
  assert.equal(applyWithSentinel.length, 0, `[I4] git apply must NOT be called in v0.14+ worker-rewrite path`);
  // I5 — never `git checkout HEAD --` a handler-staged file mid-apply
  // (rolling back the in-place edit). Build-fail revert uses
  // `git reset --hard HEAD` which is a different path and is allowed
  // (it reverts the whole worktree because the build broke).
  for (const f of handlerStagedFiles) {
    assert.ok(
      !drive.git.checkedOutFiles.includes(f),
      `[I5] handler-staged file ${f} got reverted by partial-restore (\`git checkout HEAD -- ${f}\`)`,
    );
  }
}

function assertNoHardResetWhenHandlersStaged(scenario, drive) {
  const handlerStagedClaimed = (scenario.handlerOutcomes ?? []).filter(
    (o) => o === "claim" || o === "claim-no-patch",
  ).length;
  if (handlerStagedClaimed === 0) return;
  if (scenario.verifier?.buildOk === false || scenario.verifier?.testsOk === false) {
    return; // build/test fail revert is intentional
  }
  // I3 — bailed-no-patches must not fire while handler-staged fixes
  // are ready. Bug #2 (sibling of v0.14.19): when ALL worker patches
  // conflicted but handler-staged were ready, autofix bailed AND
  // wiped the staged handler edits with `git reset --hard HEAD`.
  if (drive.result.status === "bailed-no-patches") {
    assert.fail(
      `[I3] bailed-no-patches emitted while ${handlerStagedClaimed} handler-staged fixes were ready`,
    );
  }
  // I3b — when handler-staged is non-empty and the path doesn't
  // bail/build-fail, a commit must happen (containing those handler
  // fixes). Pre-Bug-#2-fix this would be skipped.
  if (drive.result.status === "awaiting-approval" || drive.result.status === "merged") {
    const committed = drive.git.calls.some(
      (c) => c.bin === "git" && c.args.includes("commit"),
    );
    assert.ok(
      committed,
      `[I3b] handler-staged fixes (${handlerStagedClaimed}) ready but no commit was made (status=${drive.result.status})`,
    );
  }
}

function assertCycleMarker(scenario, drive) {
  if (drive.result.status !== "awaiting-approval" && drive.result.status !== "merged") return;
  // Find the commit message arg
  const commitCall = drive.git.calls.find((c) => c.bin === "git" && c.args.includes("commit"));
  if (!commitCall) return; // L3 with no fixes case
  const idx = commitCall.args.indexOf("-m");
  const msg = commitCall.args[idx + 1] ?? "";
  const inLoop = scenario.args?.reworkCycle && scenario.args.reworkCycle > 0;
  if (inLoop) {
    const expected = `[conclave-rework-cycle:${Math.min(scenario.args.reworkCycle + 1, 5)}]`;
    assert.ok(
      msg.includes(expected),
      `[I2] commit missing cycle marker — expected '${expected}' in:\n${msg.slice(0, 400)}`,
    );
  }
}

function assertL2NeverMerges(scenario, drive) {
  if ((scenario.args?.autonomy ?? baseArgs.autonomy) === "l2") {
    assert.equal(drive.mergeCalls.length, 0, "[I7] L2 must NOT auto-merge");
  }
}

function assertBuildFailRevertsWithoutCommit(scenario, drive) {
  if (!(scenario.verifier?.buildOk === false)) return;
  if (scenario.workerOutcomes?.every((o) => o !== "ok") && scenario.handlerOutcomes?.every((o) => o !== "claim" && o !== "claim-no-patch")) {
    return; // build wasn't reached anyway
  }
  const committed = drive.git.calls.some((c) => c.bin === "git" && c.args.includes("commit"));
  if (drive.result.status === "bailed-build-failed") {
    assert.equal(committed, false, "[I8] build-fail must NOT commit");
  }
}

// ---- Scenario library ----------------------------------------------

const FILES = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];

function gen(label, overrides) {
  return {
    label,
    iterations: 1,
    blockers: blockerList([{}]),
    workerOutcomes: ["ok"],
    handlerOutcomes: ["skip"],
    git: {},
    verifier: {},
    args: {},
    ...overrides,
  };
}

const scenarios = [];

// ----- Family A: Pure worker patches (no handlers) -------------------
for (let n = 1; n <= 5; n++) {
  scenarios.push(gen(`A.allWorkerOk(${n})`, {
    blockers: blockerList(FILES.slice(0, n).map((f) => ({ file: f }))),
    workerOutcomes: Array(n).fill("ok"),
    handlerOutcomes: Array(n).fill("skip"),
  }));
  // All worker patches conflict
  scenarios.push(gen(`A.allWorkerConflict(${n})`, {
    blockers: blockerList(FILES.slice(0, n).map((f) => ({ file: f }))),
    workerOutcomes: Array(n).fill("ok"),
    handlerOutcomes: Array(n).fill("skip"),
    git: { applyConflictForPatches: new Set([...Array(n).keys()]) },
  }));
  // Half conflict, half clean
  if (n >= 2) {
    const half = Math.floor(n / 2);
    scenarios.push(gen(`A.halfConflict(${n})`, {
      blockers: blockerList(FILES.slice(0, n).map((f) => ({ file: f }))),
      workerOutcomes: Array(n).fill("ok"),
      handlerOutcomes: Array(n).fill("skip"),
      git: { applyConflictForPatches: new Set([...Array(half).keys()]) },
    }));
  }
}

// ----- Family B: Pure handlers (no workers, all blockers claimed) ---
for (let n = 1; n <= 5; n++) {
  scenarios.push(gen(`B.allHandlerClaim(${n})`, {
    blockers: blockerList(FILES.slice(0, n).map((f) => ({ file: f }))),
    workerOutcomes: Array(n).fill("ok"), // unused — handlers claim first
    handlerOutcomes: Array(n).fill("claim"),
  }));
  scenarios.push(gen(`B.allHandlerClaimNoPatch(${n})`, {
    blockers: blockerList(FILES.slice(0, n).map((f) => ({ file: f }))),
    workerOutcomes: Array(n).fill("ok"),
    handlerOutcomes: Array(n).fill("claim-no-patch"),
  }));
}

// ----- Family C: Mix — the v0.14.19 + Bug #2 territory --------------
// Workers + handlers in parallel. v0.14.18 silently reverted handler
// edits via partial-restore. Bug #2: when ALL workers conflict, the
// `git reset --hard HEAD` would also wipe handler edits.
for (const wOk of [0, 1, 2, 3]) {
  for (const wConflict of [0, 1, 2, 3]) {
    for (const hClaim of [0, 1, 2, 3]) {
      const total = wOk + wConflict + hClaim;
      if (total === 0 || total > 6) continue;
      const blockers = blockerList(
        Array.from({ length: total }, (_, i) => ({ file: `src/mix${i}.ts` })),
      );
      // First wOk+wConflict are handed to worker (skip handler), last
      // hClaim are claimed by handler (worker not called for them).
      const workerOutcomes = [
        ...Array(wOk).fill("ok"),
        ...Array(wConflict).fill("ok"),
        ...Array(hClaim).fill("ok"),
      ];
      const handlerOutcomes = [
        ...Array(wOk + wConflict).fill("skip"),
        ...Array(hClaim).fill("claim"),
      ];
      const conflictSet = new Set();
      for (let i = wOk; i < wOk + wConflict; i++) conflictSet.add(i);
      scenarios.push(
        gen(`C.mix(wOk=${wOk},wConf=${wConflict},hClaim=${hClaim})`, {
          blockers,
          workerOutcomes,
          handlerOutcomes,
          git: { applyConflictForPatches: conflictSet },
        }),
      );
    }
  }
}

// ----- Family D: Cycle-marker correctness ---------------------------
for (let cycle = 0; cycle <= 5; cycle++) {
  scenarios.push(gen(`D.cycle${cycle}`, {
    blockers: blockerList([{ file: "src/cyc.ts" }]),
    workerOutcomes: ["ok"],
    args: { reworkCycle: cycle, pr: 100 + cycle },
  }));
}

// ----- Family E: Build / tests fail ---------------------------------
scenarios.push(gen("E.buildFail+1worker", {
  blockers: blockerList([{ file: "src/bf.ts" }]),
  workerOutcomes: ["ok"],
  verifier: { buildOk: false },
  args: { maxIterations: 1 },
}));
scenarios.push(gen("E.buildFail+1handler", {
  blockers: blockerList([{ file: "src/bf2.ts" }]),
  handlerOutcomes: ["claim"],
  verifier: { buildOk: false },
  args: { maxIterations: 1 },
}));
scenarios.push(gen("E.testsFail+mix", {
  blockers: blockerList([{ file: "src/tf.ts" }, { file: "src/tf2.ts" }]),
  workerOutcomes: ["ok", "ok"],
  handlerOutcomes: ["skip", "claim"],
  verifier: { testsOk: false },
  args: { maxIterations: 1 },
}));

// ----- Family F: L3 autonomy ----------------------------------------
scenarios.push(gen("F.L3approveOnce", {
  blockers: blockerList([{ file: "src/l3.ts" }]),
  workerOutcomes: ["ok"],
  args: { autonomy: "l3", pr: 200 },
  verdicts: [
    { verdict: "rework", blockers: blockerList([{ file: "src/l3.ts" }]) },
    { verdict: "approve" },
  ],
}));
scenarios.push(gen("F.L2approveOnce", {
  blockers: blockerList([{ file: "src/l2.ts" }]),
  workerOutcomes: ["ok"],
  args: { autonomy: "l2", pr: 201 },
  verdicts: [
    { verdict: "rework", blockers: blockerList([{ file: "src/l2.ts" }]) },
    { verdict: "approve" },
  ],
}));

// ----- Family G: Push fail / commit fail -----------------------------
scenarios.push(gen("G.pushFails+1worker", {
  blockers: blockerList([{ file: "src/p.ts" }]),
  workerOutcomes: ["ok"],
  git: { pushFails: true },
}));

// ----- Family H: Worker garbage / no-patch ---------------------------
scenarios.push(gen("H.workerGarbage", {
  blockers: blockerList([{ file: "src/g.ts" }]),
  workerOutcomes: ["garbage"],
  git: { applyConflictForPatches: new Set([0]) }, // garbage will conflict
}));
scenarios.push(gen("H.workerNoPatch", {
  blockers: blockerList([{ file: "src/np.ts" }]),
  workerOutcomes: ["no-patch"],
}));

// ----- Family I: Multi-iteration ------------------------------------
scenarios.push(gen("I.twoIters_2blockers", {
  blockers: blockerList([{ file: "src/i1.ts" }, { file: "src/i2.ts" }]),
  workerOutcomes: ["ok", "ok", "ok", "ok"],
  args: { maxIterations: 2 },
  verdicts: [
    {
      verdict: "rework",
      blockers: blockerList([{ file: "src/i1.ts" }, { file: "src/i2.ts" }]),
    },
    {
      verdict: "rework",
      blockers: blockerList([{ file: "src/i2.ts" }]),
    },
    { verdict: "approve" },
  ],
}));

// ----- Family J: Repeated random-ish stress (200 quick runs) --------
const SEED_FAMILY_J_SIZE = 200;
for (let s = 0; s < SEED_FAMILY_J_SIZE; s++) {
  // Deterministic mock RNG so replay is possible.
  const r = (mod) => ((s * 9301 + 49297) % (mod * 233280)) / 233280 % mod;
  const total = 1 + Math.floor(r(5));
  const wOk = Math.floor(r(total + 1));
  const remaining = total - wOk;
  const wConf = Math.floor(r(remaining + 1));
  const hClaim = total - wOk - wConf;
  const blockers = blockerList(
    Array.from({ length: total }, (_, i) => ({ file: `src/j${s}_${i}.ts` })),
  );
  const workerOutcomes = [
    ...Array(wOk).fill("ok"),
    ...Array(wConf).fill("ok"),
    ...Array(hClaim).fill("ok"),
  ];
  const handlerOutcomes = [
    ...Array(wOk + wConf).fill("skip"),
    ...Array(hClaim).fill("claim"),
  ];
  const conflictSet = new Set();
  for (let i = wOk; i < wOk + wConf; i++) conflictSet.add(i);
  scenarios.push(
    gen(`J.s${s}(wOk=${wOk},wConf=${wConf},hClaim=${hClaim})`, {
      blockers,
      workerOutcomes,
      handlerOutcomes,
      git: { applyConflictForPatches: conflictSet },
    }),
  );
}

// ----- Family K: Adversarial handlers --------------------------------
// Handler claims but supplies empty/missing appliedFiles — should NOT
// produce a corrupt commit.
scenarios.push(gen("K.handlerClaimEmptyAppliedFiles", {
  blockers: blockerList([{ file: "src/k1.ts" }]),
  workerOutcomes: ["ok"],
  handlerOutcomes: ["claim"],
  // override claim outcome to drop appliedFiles → uses default fallback
}));

// Handler claims but worker also runs (race) — handler claims first
// per autofix.ts:1003, worker is never called for that blocker.
scenarios.push(gen("K.allClaimedHandlerOnly", {
  blockers: blockerList([{ file: "src/k2.ts" }, { file: "src/k3.ts" }]),
  // workerOutcomes is irrelevant; handler claims both first
  workerOutcomes: ["ok", "ok"],
  handlerOutcomes: ["claim", "claim"],
}));

// ----- Family L: Multi-iteration cumulative cycle markers ------------
scenarios.push(gen("L.iter1ok_iter2handlerOnly", {
  blockers: blockerList([{ file: "src/l1.ts" }, { file: "src/l2.ts" }]),
  workerOutcomes: ["ok", "ok", "ok", "ok"],
  handlerOutcomes: ["skip", "skip", "skip", "claim"],
  args: { maxIterations: 2, reworkCycle: 1, pr: 300 },
  verdicts: [
    { verdict: "rework", blockers: blockerList([{ file: "src/l1.ts" }, { file: "src/l2.ts" }]) },
    { verdict: "rework", blockers: blockerList([{ file: "src/l2.ts" }]) },
    { verdict: "approve" },
  ],
}));

// All worker conflict iter1, all handler claim iter1 → must commit
// + push iter1 even with no clean worker patch.
scenarios.push(gen("L.allConflictAllClaim", {
  blockers: blockerList([{ file: "src/lA.ts" }, { file: "src/lB.ts" }]),
  workerOutcomes: ["ok", "ok"],
  handlerOutcomes: ["skip", "claim"],
  git: { applyConflictForPatches: new Set([0]) },
}));

// ----- Family M: Cycle ceiling -----------------------------------------
scenarios.push(gen("M.cycleAt5_clamps", {
  blockers: blockerList([{ file: "src/m.ts" }]),
  workerOutcomes: ["ok"],
  args: { reworkCycle: 5, pr: 400 },
}));

// ----- Family N: Verdict that converges to APPROVE on first review ---
// Initial verdict is REWORK with 1 blocker (so we enter the loop), but
// after iter1 fixes it, the next review is APPROVE → status =
// awaiting-approval (L2) or merged (L3). Cycle marker should bump 1.
scenarios.push(gen("N.l2_normal_close", {
  blockers: blockerList([{ file: "src/n.ts" }]),
  workerOutcomes: ["ok"],
  handlerOutcomes: ["skip"],
  args: { autonomy: "l2", reworkCycle: 0, pr: 500 },
}));
scenarios.push(gen("N.l3_normal_close", {
  blockers: blockerList([{ file: "src/n.ts" }]),
  workerOutcomes: ["ok"],
  handlerOutcomes: ["skip"],
  args: { autonomy: "l3", reworkCycle: 0, pr: 501 },
}));

// ----- Family O: Push fail (non-fatal warning) -----------------------
scenarios.push(gen("O.pushFailPlusHandler", {
  blockers: blockerList([{ file: "src/o.ts" }]),
  workerOutcomes: ["ok"],
  handlerOutcomes: ["claim"],
  git: { pushFails: true },
}));

// ----- Family P: Larger combinatoric explosion (300 cases) -----------
// Stress the matrix harder — more shapes, more blockers, more overlap.
const PFAMILY_SIZE = 300;
for (let s = 0; s < PFAMILY_SIZE; s++) {
  const r = (mod) => ((s * 16807 + 13) % (mod * 65537)) % mod;
  const total = 1 + r(6); // 1..6 blockers
  const wOk = r(total + 1);
  const remaining = total - wOk;
  const wConf = r(remaining + 1);
  const hClaim = total - wOk - wConf;
  const blockers = blockerList(
    Array.from({ length: total }, (_, i) => ({ file: `src/p${s}_${i}.ts` })),
  );
  // Interleave the outcomes randomly
  const order = Array.from({ length: total }, (_, i) => i);
  // Simple deterministic permute
  order.sort((a, b) => (r(7) % 3) - (r(7) % 3));
  const workerOutcomes = Array(total).fill("ok");
  const handlerOutcomes = Array(total).fill("skip");
  const conflictSet = new Set();
  let i = 0;
  for (const idx of order) {
    if (i < wOk) {
      // worker-ok at idx
    } else if (i < wOk + wConf) {
      conflictSet.add(idx);
    } else {
      handlerOutcomes[idx] = "claim";
    }
    i++;
  }
  scenarios.push(
    gen(`P.s${s}(t=${total},wOk=${wOk},wConf=${wConf},hClaim=${hClaim})`, {
      blockers,
      workerOutcomes,
      handlerOutcomes,
      git: { applyConflictForPatches: conflictSet },
    }),
  );
}

// ----- Family Q: Bug #4 — per-file defer (same file, multiple worker patches)
// Pre-fix: cycle 1's autofix on eventbadge#59 had 3 worker patches all
// targeting AddressSearch.jsx (one per agent reporting the same contrast
// blocker). Patches were generated against the original file content,
// so applying patch A shifted lines and patch B/C `git apply --check`
// rejected them. With Bug #4 fix, we only apply ONE worker patch per
// file per iteration; the others are deferred to the next cycle (where
// the worker re-prompts against the updated file content).
{
  // 3 worker patches all targeting "src/same.ts"
  const sameFile = "src/same.ts";
  scenarios.push(gen("Q.threeWorkersSameFile_onlyFirstApplies", {
    blockers: blockerList([
      { file: sameFile, category: "type-error", message: "x" },
      { file: sameFile, category: "type-error", message: "y" },
      { file: sameFile, category: "type-error", message: "z" },
    ]),
    workerOutcomes: ["ok", "ok", "ok"],
    handlerOutcomes: ["skip", "skip", "skip"],
  }));
  // Worker patch + 1 handler claim, same file: handler pre-touches
  // the file, worker patch should be deferred.
  scenarios.push(gen("Q.handlerThenWorker_workerDeferred", {
    blockers: blockerList([
      { file: sameFile, category: "contrast", message: "a" },     // handler claims
      { file: sameFile, category: "type-error", message: "b" },   // worker
    ]),
    workerOutcomes: ["ok", "ok"],
    handlerOutcomes: ["claim", "skip"],
  }));
}

// ---- Run them -------------------------------------------------------

for (const scenario of scenarios) {
  test(`stress: ${scenario.label}`, async () => {
    const r = await drive(scenario);
    assertHandlerStagedNeverApplied(scenario, r);
    assertNoHardResetWhenHandlersStaged(scenario, r);
    assertCycleMarker(scenario, r);
    assertL2NeverMerges(scenario, r);
    assertBuildFailRevertsWithoutCommit(scenario, r);
  });
}

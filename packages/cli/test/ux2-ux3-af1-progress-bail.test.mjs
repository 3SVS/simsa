/**
 * UX-2 / UX-3 / AF-1 — terminal progress emit + per-blocker progress
 * + apply-conflict partial-apply rescue.
 *
 * v0.14 update: worker now uses full-file rewrites (submit_rewrite).
 * "Conflicts" are simulated by injecting a writeFile mock that throws
 * for specific file paths, rather than mocking git apply failures.
 *
 * Post-fix:
 *   UX-2 — every shouldPostSummary terminal status fires
 *          autofix-cycle-ended progress, carrying bailStatus + iter
 *          count + cost + remaining-blocker count.
 *   UX-3 — per-blocker emits autofix-blocker-started +
 *          autofix-blocker-done with index/total/label/outcome so
 *          users see "fixing blocker 3/9: contrast violation" instead
 *          of staring at "auto fixing 1/3".
 *   AF-1 — writeFile failure on one rewrite restores ONLY that
 *          rewrite's already-written files, keeps the others, and
 *          continues the iteration. Bail only when EVERY rewrite failed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAutofix } from "../dist/commands/autofix.js";

const fakeConfig = {
  config: { version: 1, agents: ["claude"], budget: { perPrUsd: 0.5 } },
  configDir: "/tmp/fake-ux2",
};

const baseArgs = {
  budgetUsd: 3,
  maxIterations: 1,
  autonomy: "l2",
  cwd: "/repo",
  dryRun: false,
  help: false,
  allowSecrets: [],
  skipSecretGuard: false,
  reworkCycle: 0,
};

function makeWorker() {
  return {
    work: async (ctx) => {
      const blocker = ctx.reviews[0].blockers[0];
      return {
        rewrites: [{ path: blocker.file, content: `// fixed ${blocker.file}\nexport const x: number = 1;\n` }],
        message: `fix ${blocker.message}`,
        appliedFiles: [blocker.file],
        costUsd: 0.01,
        tokensUsed: 100,
      };
    },
  };
}

function makeGit() {
  const calls = [];
  const exec = async (bin, args, _opts) => {
    calls.push({ bin, args: [...args] });
    return { stdout: "", stderr: "", code: 0 };
  };
  return { exec, calls };
}

function makeWriteFile({ failOn = [] } = {}) {
  const calls = [];
  const fn = async (absPath, content) => {
    calls.push({ absPath, content });
    // Normalize Windows backslashes so failOn matchers (e.g. "src/b.ts") are platform-portable.
    const norm = absPath.replace(/\\/g, "/");
    if (failOn.some((f) => norm.includes(f))) {
      throw new Error(`EACCES: permission denied writing ${absPath}`);
    }
  };
  return { calls, fn };
}

function makeVerifier({ buildOk = true, testsOk = true } = {}) {
  return {
    build: async () => ({
      success: buildOk,
      command: "pnpm build",
      stdout: "",
      stderr: buildOk ? "" : "TS2345 type error",
      durationMs: 100,
      detectedFrom: "package.json",
    }),
    test: async () => ({
      success: testsOk,
      command: "pnpm test",
      stdout: "",
      stderr: testsOk ? "" : "test failed",
      durationMs: 100,
      detectedFrom: "package.json",
    }),
  };
}

const stickyBlockers = [
  { severity: "blocker", category: "type-error", message: "Bad type", file: "src/a.ts" },
  { severity: "blocker", category: "logging", message: "Stray console.log", file: "src/b.ts" },
  { severity: "blocker", category: "contrast", message: "Low contrast button", file: "src/c.ts" },
];

function captureProgress() {
  const events = [];
  const notifier = {
    id: "test-notifier",
    displayName: "TestNotifier",
    notifyReview: async () => {},
    notifyProgress: async (input) => {
      events.push({ stage: input.stage, payload: input.payload ?? {} });
    },
  };
  return { events, notifier };
}

function stubGh() {
  const calls = [];
  const fn = async (bin, args) => {
    calls.push([...args]);
    if (args[0] === "pr" && args[1] === "view") {
      return {
        stdout: JSON.stringify({
          state: "OPEN",
          headRefOid: "abc",
          updatedAt: "t",
          headRepository: { name: "r" },
          headRepositoryOwner: { login: "o" },
        }),
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };
  return { calls, fn };
}

test("UX-3: per-blocker progress emits autofix-blocker-started + done with index/total/label/outcome", async () => {
  const { events, notifier } = captureProgress();
  const git = makeGit();
  const writeFile = makeWriteFile();
  const verdict = JSON.stringify({
    councilVerdict: "rework",
    episodicId: "ep-ux3-test",
    reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
  });
  const { result } = await runAutofix(
    { ...baseArgs, pr: 1, maxIterations: 1, verdictFile: "/tmp/v.json" },
    {
      loadConfig: async () => fakeConfig,
      worker: makeWorker(),
      git: git.exec,
      verifier: makeVerifier(),
      readFile: async () => verdict,
      readVerdictFile: async () => verdict,
      writeFile: writeFile.fn,
      gh: stubGh().fn,
      runReview: async () => ({
        verdict: "rework",
        reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
      }),
      stdout: () => {},
      stderr: () => {},
      notifiers: [notifier],
    },
  );
  // We expect 3 blockers × (started + done) = 6 per-blocker emits.
  const started = events.filter((e) => e.stage === "autofix-blocker-started");
  const done = events.filter((e) => e.stage === "autofix-blocker-done");
  assert.equal(started.length, 3, `expected 3 blocker-started, got ${started.length}`);
  assert.equal(done.length, 3, `expected 3 blocker-done, got ${done.length}`);
  // Index + total + label populated.
  assert.equal(started[0].payload.blockerIndex, 1);
  assert.equal(started[0].payload.blockerTotal, 3);
  assert.match(started[0].payload.blockerLabel, /type-error.*Bad type/);
  // Outcome present on done.
  assert.ok(["ready", "skipped", "conflict", "secret-block", "worker-error"].includes(done[0].payload.blockerOutcome));
  // result is defined regardless of bail/success.
  assert.ok(result);
});

test("UX-2: bailed-no-patches emits autofix-cycle-ended with bailStatus + counts + cost", async () => {
  const { events, notifier } = captureProgress();
  // Force every writeFile to fail → all fixes conflict → bailed-no-patches.
  const writeFile = makeWriteFile({ failOn: ["src/"] });
  const git = makeGit();
  const verdict = JSON.stringify({
    councilVerdict: "rework",
    episodicId: "ep-ux2-test",
    reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
  });
  const { result } = await runAutofix(
    { ...baseArgs, pr: 1, maxIterations: 1, verdictFile: "/tmp/v.json" },
    {
      loadConfig: async () => fakeConfig,
      worker: makeWorker(),
      git: git.exec,
      verifier: makeVerifier(),
      readFile: async () => verdict,
      readVerdictFile: async () => verdict,
      writeFile: writeFile.fn,
      gh: stubGh().fn,
      runReview: async () => ({
        verdict: "rework",
        reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
      }),
      stdout: () => {},
      stderr: () => {},
      notifiers: [notifier],
    },
  );
  const cycleEnded = events.find((e) => e.stage === "autofix-cycle-ended");
  assert.ok(cycleEnded, "must emit autofix-cycle-ended");
  assert.match(cycleEnded.payload.bailStatus, /^bailed-/);
  assert.equal(typeof cycleEnded.payload.iterationsAttempted, "number");
  assert.ok(cycleEnded.payload.iterationsAttempted >= 1);
  assert.equal(typeof cycleEnded.payload.totalCostUsd, "number");
  assert.equal(typeof cycleEnded.payload.remainingBlockerCount, "number");
  assert.ok(result.status.startsWith("bailed-"));
});

test("AF-1: 1 rewrite fails among 3 → other 2 survive, iteration commits, status=approved/awaiting", async () => {
  // writeFile fails only for src/b.ts. Fixes for src/a.ts and src/c.ts succeed.
  // Pre-AF-1 the entire iteration would bail. Post-AF-1 it commits the 2 survivors.
  const { events, notifier } = captureProgress();
  const git = makeGit();
  const writeFile = makeWriteFile({ failOn: ["src/b.ts"] });
  const verdict = JSON.stringify({
    councilVerdict: "rework",
    episodicId: "ep-af1-test",
    reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
  });
  const { result } = await runAutofix(
    { ...baseArgs, pr: 1, maxIterations: 1, verdictFile: "/tmp/v.json" },
    {
      loadConfig: async () => fakeConfig,
      worker: makeWorker(),
      git: git.exec,
      verifier: makeVerifier(),
      readFile: async () => verdict,
      readVerdictFile: async () => verdict,
      writeFile: writeFile.fn,
      gh: stubGh().fn,
      runReview: async () => ({
        verdict: "approve",
        reviews: [{ agent: "claude", verdict: "approve", summary: "", blockers: [] }],
      }),
      stdout: () => {},
      stderr: () => {},
      notifiers: [notifier],
    },
  );
  // Should NOT be bailed-no-patches — 2 of 3 rewrites succeeded.
  assert.ok(
    result.status === "awaiting-approval" || result.status === "approved" || result.status === "deferred-to-next-review",
    `expected non-bail status, got ${result.status}`,
  );
  assert.ok(result.iterations.length >= 1);
  // src/a.ts and src/c.ts were written and staged; src/b.ts was not.
  const stagedFiles = git.calls
    .filter((c) => c.bin === "git" && c.args[0] === "add" && c.args[1] === "--")
    .map((c) => c.args[2]);
  assert.ok(stagedFiles.some((f) => f === "src/a.ts"), "src/a.ts must be staged");
  assert.ok(stagedFiles.some((f) => f === "src/c.ts"), "src/c.ts must be staged");
  assert.ok(!stagedFiles.some((f) => f === "src/b.ts"), "src/b.ts must NOT be staged (write failed)");
  // No git apply calls (v0.14+ uses writeFile, not git apply).
  const applyCall = git.calls.find((c) => c.bin === "git" && c.args[0] === "apply");
  assert.ok(!applyCall, "git apply must NOT be called in v0.14+ rewrite path");
  // No `git reset --hard HEAD` should fire mid-iteration when at least one fix survived.
  const hardResets = git.calls.filter(
    (c) => c.bin === "git" && c.args[0] === "reset" && c.args.includes("--hard"),
  );
  assert.ok(hardResets.length <= 1, `unexpected reset --hard: ${hardResets.length} calls`);
});

test("AF-1: ALL 3 rewrites fail → bail with bailed-no-patches + apply-conflict reason", async () => {
  // writeFile throws for all src/ files → all fixes conflict → bail.
  const { events, notifier } = captureProgress();
  const git = makeGit();
  const writeFile = makeWriteFile({ failOn: ["src/"] });
  const verdict = JSON.stringify({
    councilVerdict: "rework",
    episodicId: "ep-af1-all",
    reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
  });
  const { result } = await runAutofix(
    { ...baseArgs, pr: 1, maxIterations: 1, verdictFile: "/tmp/v.json" },
    {
      loadConfig: async () => fakeConfig,
      worker: makeWorker(),
      git: git.exec,
      verifier: makeVerifier(),
      readFile: async () => verdict,
      readVerdictFile: async () => verdict,
      writeFile: writeFile.fn,
      gh: stubGh().fn,
      runReview: async () => ({
        verdict: "rework",
        reviews: [{ agent: "claude", verdict: "rework", summary: "", blockers: stickyBlockers }],
      }),
      stdout: () => {},
      stderr: () => {},
      notifiers: [notifier],
    },
  );
  assert.equal(result.status, "bailed-no-patches");
  // Cycle ended emit fires for the bail too.
  const cycleEnded = events.find((e) => e.stage === "autofix-cycle-ended");
  assert.ok(cycleEnded);
  assert.equal(cycleEnded.payload.bailStatus, "bailed-no-patches");
  assert.match(cycleEnded.payload.reason ?? "", /apply-conflict|every patch/i);
});

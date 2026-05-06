import { test } from "node:test";
import assert from "node:assert/strict";
import { runPerBlocker } from "../dist/lib/autofix-worker.js";

/**
 * v0.14 — runPerBlocker rewrite-path tests.
 *
 * The retry loop and git-apply validation were removed in v0.14.
 * Workers now return full-file rewrites; the caller writes them to disk.
 * These tests verify the new contract: single worker call, rewrite
 * content returned in BlockerFix.rewrites, error handling for LLM
 * failures and empty rewrites, deny-list enforcement.
 */

const BLOCKER = {
  severity: "blocker",
  category: "type-error",
  message: "add explicit type annotation",
  file: "src/x.ts",
  line: 1,
};

const VALID_REWRITES = [
  { path: "src/x.ts", content: "export const x: number = 1;\nexport const y = 2;\nexport const z = 3;\n" },
];

function makeWorker(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async work(ctx) {
      calls.push(ctx);
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (typeof r === "function") return r(ctx, calls.length);
      return r;
    },
  };
}

function workerOutcome({ rewrites = VALID_REWRITES, message = "fix(x)", costUsd = 0.21, tokensUsed = 2400 } = {}) {
  return { rewrites, message, appliedFiles: rewrites.map((r) => r.path), costUsd, tokensUsed };
}

const baseInput = () => ({
  repo: "acme/x",
  pullNumber: 1,
  newSha: "abc",
  agent: "claude",
  blocker: BLOCKER,
});

const baseDeps = (overrides = {}) => ({
  worker: overrides.worker,
  cwd: "/tmp/fake-repo",
  readFile: overrides.readFile ?? (async () => "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n"),
  stderr: () => {},
  ...overrides,
});

// ---- happy path ---------------------------------------------------------

test("runPerBlocker: worker returns rewrites → status=ready, single worker call", async () => {
  const worker = makeWorker([workerOutcome()]);
  const fix = await runPerBlocker(baseInput(), baseDeps({ worker }));
  assert.equal(fix.status, "ready");
  assert.equal(worker.calls.length, 1, "must make exactly one worker call");
  assert.ok(Array.isArray(fix.rewrites), "fix.rewrites must be an array");
  assert.equal(fix.rewrites.length, 1);
  assert.equal(fix.rewrites[0].path, "src/x.ts");
  assert.ok(fix.rewrites[0].content.includes("x: number"));
  assert.deepEqual(fix.appliedFiles, ["src/x.ts"]);
});

test("runPerBlocker: costUsd and tokensUsed are forwarded from outcome", async () => {
  const worker = makeWorker([workerOutcome({ costUsd: 0.42, tokensUsed: 1234 })]);
  const fix = await runPerBlocker(baseInput(), baseDeps({ worker }));
  assert.equal(fix.costUsd, 0.42);
  assert.equal(fix.tokensUsed, 1234);
});

// ---- empty rewrites (worker gave up) ------------------------------------

test("runPerBlocker: worker returns empty rewrites → status=worker-error", async () => {
  const worker = makeWorker([workerOutcome({ rewrites: [] })]);
  const fix = await runPerBlocker(baseInput(), baseDeps({ worker }));
  assert.equal(fix.status, "worker-error");
  assert.match(fix.reason, /no file rewrites/i);
});

// ---- LLM throws ---------------------------------------------------------

test("runPerBlocker: worker throws → status=worker-error with reason", async () => {
  const worker = {
    calls: [],
    async work(ctx) {
      this.calls.push(ctx);
      throw new Error("anthropic 500: server error");
    },
  };
  const fix = await runPerBlocker(baseInput(), baseDeps({ worker }));
  assert.equal(fix.status, "worker-error");
  assert.match(fix.reason, /anthropic 500/i);
});

// ---- design-domain skip -------------------------------------------------

test("runPerBlocker: design-domain blocker without a file → status=skipped", async () => {
  const worker = makeWorker([workerOutcome()]);
  const input = {
    ...baseInput(),
    blocker: { severity: "blocker", category: "contrast", message: "low contrast ratio" },
  };
  const fix = await runPerBlocker(input, baseDeps({ worker }));
  assert.equal(fix.status, "skipped");
  assert.equal(worker.calls.length, 0, "should not call worker for file-less design blocker");
});

test("runPerBlocker: design-domain blocker WITH a file → falls through to worker", async () => {
  const worker = makeWorker([workerOutcome()]);
  const input = {
    ...baseInput(),
    blocker: { severity: "blocker", category: "contrast", message: "low contrast", file: "src/Button.tsx" },
  };
  const fix = await runPerBlocker(input, baseDeps({ worker }));
  assert.equal(fix.status, "ready", "design blocker with file should be attempted");
  assert.equal(worker.calls.length, 1);
});

// ---- deny-list ----------------------------------------------------------

test("runPerBlocker: blocker file on deny-list → skipped before worker call", async () => {
  const worker = makeWorker([workerOutcome()]);
  const input = {
    ...baseInput(),
    blocker: { severity: "blocker", category: "type-error", message: "fix", file: ".env.production" },
  };
  const fix = await runPerBlocker(input, baseDeps({ worker }));
  assert.equal(fix.status, "skipped");
  assert.match(fix.reason, /deny-list/i);
  assert.equal(worker.calls.length, 0, "should not call worker for deny-listed file");
});

test("runPerBlocker: worker rewrite targets deny-listed file → skipped", async () => {
  const worker = makeWorker([
    workerOutcome({ rewrites: [{ path: ".env.secret", content: "SECRET=leaked" }] }),
  ]);
  const fix = await runPerBlocker(baseInput(), baseDeps({ worker }));
  assert.equal(fix.status, "skipped");
  assert.match(fix.reason, /deny-list/i);
});

// ---- file snapshot loading ----------------------------------------------

test("runPerBlocker: file snapshot is passed to worker in context", async () => {
  const worker = makeWorker([workerOutcome()]);
  const fix = await runPerBlocker(baseInput(), baseDeps({ worker }));
  assert.equal(fix.status, "ready");
  assert.equal(worker.calls[0].fileSnapshots.length, 1);
  assert.equal(worker.calls[0].fileSnapshots[0].path, "src/x.ts");
});

test("runPerBlocker: missing file → worker still called with empty snapshots", async () => {
  const worker = makeWorker([workerOutcome()]);
  const deps = baseDeps({
    worker,
    readFile: async () => { throw new Error("ENOENT"); },
  });
  const fix = await runPerBlocker(baseInput(), deps);
  assert.equal(fix.status, "ready");
  assert.equal(worker.calls[0].fileSnapshots.length, 0);
});

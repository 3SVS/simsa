/**
 * project-steps.test.mjs — fixes the progress map's two load-bearing invariants:
 *  1. LOCKING: steps with a CONFIRMED-unmet precondition are locked (with the
 *     right hint); unknown facts NEVER lock (fail-open — a wrong lock blocks a
 *     user, a missing lock just shows plain nav).
 *  2. AUTO-CHECK: done is derived from data — already-connected/already-run work
 *     is auto-checked, so revisiting never demands rework.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProjectSteps, nextScreenSlug } from "../src/lib/project-steps.mjs";

const byKey = (steps) => Object.fromEntries(steps.map((s) => [s.key, s]));

test("fresh builder project (no items, no repo, no deploy URL): step1 current, step2+3 locked", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false, hasDeployUrl: false }));
  assert.equal(s.prepare.status, "current");
  assert.equal(s.review.status, "locked");
  assert.equal(s.review.lockReason, "need_items");
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_build"); // "팩 받아 만들고 URL 연결" — NOT a GitHub dead end
});

test("items done, no repo, no deploy URL: step2 current, step3 locked on need_build (not GitHub)", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: false }));
  assert.equal(s.prepare.status, "done"); // auto-checked — no rework
  assert.equal(s.review.status, "current");
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_build");
});

test("builder path: a deploy URL unlocks results (no GitHub) — the dead-end fix", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: true }));
  assert.equal(s.results.status, "todo"); // reachable via the deploy URL
  assert.equal(s.results.lockReason, null);
});

test("builder path: deploy URL + a visual-check run → review done, results current", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: true, hasDeployUrl: true }));
  assert.equal(s.review.status, "done"); // connected via URL + run happened
  assert.equal(s.results.status, "current");
});

test("CODE branch keeps the GitHub gate: no repo → results locked need_code", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: false, entryPath: "code" }));
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_code");
});

test("items + repo, no run yet: step3 unlocked (todo), step2 still current", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: true, hasReviewRun: false }));
  assert.equal(s.review.status, "current"); // connected but not yet run
  assert.equal(s.results.status, "todo"); // reachable, not current yet
  assert.equal(s.results.lockReason, null);
});

test("AUTO-CHECK: items + repo + run → step1/2 done, step3 current (no rework demanded)", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: true, hasReviewRun: true }));
  assert.equal(s.prepare.status, "done");
  assert.equal(s.review.status, "done"); // repo already connected + review already run → checked
  assert.equal(s.results.status, "current");
});

test("FAIL-OPEN: unknown facts (null) never lock anything", () => {
  const s = byKey(computeProjectSteps({ hasItems: null, hasRepo: null, hasReviewRun: null }));
  assert.notEqual(s.review.status, "locked");
  assert.notEqual(s.results.status, "locked");
  // and nothing is falsely checked either
  assert.notEqual(s.review.status, "done");
});

test("null input tolerated (never throws)", () => {
  const s = computeProjectSteps(undefined);
  assert.equal(s.length, 3);
});

// ─── STEP 3: skipped-user normal path (code branch) ─────────────────────────

test("CODE branch: no items is NORMAL — review never locks, prepare is optional (not red)", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath: "code" }));
  assert.notEqual(s.review.status, "locked", "review must NOT lock on missing items for code entry");
  assert.equal(s.review.status, "current"); // the code branch starts here
  assert.equal(s.prepare.optional, true); // "이 갈래는 원래 그럼" — optional, not incomplete
  assert.equal(s.prepare.status, "todo"); // neutral, never a red/current demand
  // results still locks on no code — that gate is branch-independent
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_code");
});

test("CODE branch: repo connected + run → review done, results current (full path w/o idea step)", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: true, hasReviewRun: true, entryPath: "code" }));
  assert.equal(s.review.status, "done");
  assert.equal(s.results.status, "current"); // skipping idea never blocked steps 2·3
});

test("IDEA/SPEC branches unchanged: no items still locks review", () => {
  for (const entryPath of ["idea", "spec", null, undefined]) {
    const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath }));
    assert.equal(s.review.status, "locked", `entryPath=${entryPath} must keep the items gate`);
    assert.equal(s.prepare.optional, false);
  }
});

// ─── STEP 4: command center — shortest path to the activation moment ────────

test("activation path (builder): items ready, no repo/URL → get_pack (not the GitHub dead end)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: false }),
    { action: "get_pack", slug: "export" },
  );
});

test("activation path (builder): deploy URL connected, no run → run_review via visual-checks", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: true }),
    { action: "run_review", slug: "visual-checks" },
  );
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: true, hasDeployUrl: true }),
    { action: "view_results", slug: "checks" },
  );
});

test("activation path (code branch): items ready + no repo → connect_code (GitHub stays for devs)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: false, entryPath: "code" }),
    { action: "connect_code", slug: "settings" },
  );
});

test("activation path: CODE branch with no items skips create_items entirely", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  // Missing items must NOT interpose on the code branch — connect → run is the whole path.
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath: "code" }),
    { action: "connect_code", slug: "settings" },
  );
});

test("activation path: repo connected, no run → run_review; after run → view_results", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: true, hasReviewRun: false }),
    { action: "run_review", slug: "github" },
  );
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: true, hasReviewRun: true }),
    { action: "view_results", slug: "checks" },
  );
});

test("unknown facts → null CTA (never mislead, never flip after fetch)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.equal(nextProjectAction({ hasItems: null, hasRepo: null, hasReviewRun: null }), null);
  assert.equal(nextProjectAction(undefined), null);
});

test("idea branch with confirmed-no items → create_items first", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath: "idea" }),
    { action: "create_items", slug: "items" },
  );
});

test("nextScreenSlug: idea/spec entries walk to the builder pack and STOP (no code yet)", () => {
  // Pre-build users must never be marched into repo-connect/PR screens —
  // that funnel only exists after the app does (2026-07-10 live walkthrough).
  assert.equal(nextScreenSlug("idea"), "spec");
  assert.equal(nextScreenSlug("spec"), "items");
  assert.equal(nextScreenSlug("items"), "export");
  assert.equal(nextScreenSlug("export"), null); // go build — return path is explicit, not a forced walk
  assert.equal(nextScreenSlug("settings"), null); // repo screens are outside the pre-build walk
  assert.equal(nextScreenSlug("github"), null);
  assert.equal(nextScreenSlug("benchmark"), null); // advanced screens stay out of the walk
});

test("nextScreenSlug: the CODE branch walks repo-connect FIRST (이미 만든 앱 직행)", () => {
  // Someone who said "이미 만든 앱이 있어요" connects code before curating
  // items — marching them through 준비 first read as an abrupt jump (Bae).
  assert.equal(nextScreenSlug("settings", "code"), "github");
  assert.equal(nextScreenSlug("github", "code"), "items");
  assert.equal(nextScreenSlug("items", "code"), "checks");
  assert.equal(nextScreenSlug("checks", "code"), "fixes");
  assert.equal(nextScreenSlug("fixes", "code"), null);
  // idea/spec are not on the code walk at all
  assert.equal(nextScreenSlug("idea", "code"), null);
  // other entries walk to the builder pack (pre-build — no repo screens)
  assert.equal(nextScreenSlug("items", "idea"), "export");
  assert.equal(nextScreenSlug("items", null), "export");
});

// ── Fix-first routing (Bae 2026-07-17): 확인 결과 → 고쳐보기 → 빌더팩 ─────────

test("post-review walk (builder branches): checks → fixes → export", () => {
  assert.equal(nextScreenSlug("checks", "idea"), "fixes");
  assert.equal(nextScreenSlug("fixes", "idea"), "export");
  assert.equal(nextScreenSlug("checks", "spec"), "fixes");
  assert.equal(nextScreenSlug("fixes", "spec"), "export");
  // pre-review walk unchanged: items → export is still the idea-branch end
  assert.equal(nextScreenSlug("items", "idea"), "export");
  assert.equal(nextScreenSlug("export", "idea"), null);
  // code branch unchanged: its own order still ends at fixes (PR flow, not pack)
  assert.equal(nextScreenSlug("fixes", "code"), null);
  assert.equal(nextScreenSlug("checks", "code"), "fixes");
});

test("packReadiness: no review / nothing failed → no_review (no notice)", async () => {
  const { packReadiness } = await import("../src/lib/project-steps.mjs");
  assert.equal(packReadiness(undefined, undefined).state, "no_review");
  assert.equal(packReadiness({ results: [] }, {}).state, "no_review");
  assert.equal(
    packReadiness({ results: [{ itemId: "a", status: "passed" }] }, {}).state,
    "no_review",
  );
});

test("packReadiness: failed items without fix plans → fixes_missing with counts", async () => {
  const { packReadiness } = await import("../src/lib/project-steps.mjs");
  const r = packReadiness(
    { results: [
      { itemId: "a", status: "failed" },
      { itemId: "b", status: "failed" },
      { itemId: "c", status: "inconclusive" },
    ] },
    { a: { itemId: "a" } }, // only one of two failures has a plan
  );
  assert.equal(r.state, "fixes_missing");
  assert.equal(r.failedCount, 2);
  assert.equal(r.missingCount, 1);
});

test("packReadiness: every failed item has a fix plan → fixes_ready", async () => {
  const { packReadiness } = await import("../src/lib/project-steps.mjs");
  const r = packReadiness(
    { results: [{ itemId: "a", status: "failed" }] },
    { a: { itemId: "a" } },
  );
  assert.equal(r.state, "fixes_ready");
  assert.equal(r.failedCount, 1);
  assert.equal(r.missingCount, 0);
});

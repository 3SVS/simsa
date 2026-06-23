// Stage 105 — Existing App Recovery Assessment tests. Pure/deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAiBuiltAppRecoveryPreview,
  SAMPLE_AI_BUILT_APP,
} from "../src/intake-ai-built-app.mjs";

test("fallback for empty/minimal input", () => {
  const p = buildAiBuiltAppRecoveryPreview("   ");
  assert.match(p.currentStateSummary, /AI-built product draft/);
  assert.equal(p.likelyProductSurface, "unknown");
  assert.equal(p.recommendedNextAction, "create_acceptance_map");
  assert.equal(p.confidence, "low");
  assert.ok(p.recoveryFocusAreas.length >= 5);
});

test("detects surfaces", () => {
  assert.equal(buildAiBuiltAppRecoveryPreview("a marketing landing page").likelyProductSurface, "landing");
  assert.equal(buildAiBuiltAppRecoveryPreview("a task dashboard for teams").likelyProductSurface, "dashboard");
  assert.equal(buildAiBuiltAppRecoveryPreview("an iOS mobile app").likelyProductSurface, "mobile");
  assert.equal(buildAiBuiltAppRecoveryPreview("a backend api server").likelyProductSurface, "api");
  assert.equal(buildAiBuiltAppRecoveryPreview("a quick MVP prototype").likelyProductSurface, "prototype");
});

test("adds auth focus when login mentioned", () => {
  const p = buildAiBuiltAppRecoveryPreview("It has login and sessions.");
  assert.ok(p.recoveryFocusAreas.includes("Account and session behavior"));
  assert.ok(p.candidateAcceptanceItems.some((i) => /signed-out user/.test(i)));
});

test("adds payment focus when checkout mentioned", () => {
  const p = buildAiBuiltAppRecoveryPreview("It has checkout and payment.");
  assert.ok(p.recoveryFocusAreas.includes("Payment and billing flow"));
  assert.ok(p.candidateAcceptanceItems.some((i) => /payment failure/.test(i)));
});

test("adds sharing focus when invite/link mentioned", () => {
  const p = buildAiBuiltAppRecoveryPreview("Users can share invite links.");
  assert.ok(p.recoveryFocusAreas.includes("Sharing and permission boundaries"));
  assert.ok(p.candidateAcceptanceItems.some((i) => /Shared links/.test(i)));
});

test("adds AI fallback focus when AI/LLM mentioned", () => {
  const p = buildAiBuiltAppRecoveryPreview("It uses an LLM to generate summaries.");
  assert.ok(p.recoveryFocusAreas.includes("AI output quality and fallback behavior"));
  assert.ok(p.candidateAcceptanceItems.some((i) => /AI-generated output/.test(i)));
});

test("adds deploy verification when repo/deploy/env mentioned", () => {
  const p = buildAiBuiltAppRecoveryPreview("Deployed from a GitHub repo with env vars.");
  assert.ok(p.recoveryFocusAreas.includes("Build, deploy, and environment verification"));
});

test("recommends create_fix_stage for broken/error input", () => {
  const p = buildAiBuiltAppRecoveryPreview(
    "The app has bugs and failed saves throw errors that are broken right now.",
  );
  assert.equal(p.recommendedNextAction, "create_fix_stage");
});

test("recommends verify_release_readiness for launch/share input", () => {
  const p = buildAiBuiltAppRecoveryPreview(
    "It looks usable and I want to share it with early users and launch soon.",
  );
  assert.equal(p.recommendedNextAction, "verify_release_readiness");
});

test("recommends review_core_flow when core flow mentioned", () => {
  const p = buildAiBuiltAppRecoveryPreview(
    "I want to make sure the main flow and user journey hold up before more work.",
  );
  assert.equal(p.recommendedNextAction, "review_core_flow");
});

test("includes fix vs rebuild signals", () => {
  const p = buildAiBuiltAppRecoveryPreview(SAMPLE_AI_BUILT_APP);
  assert.ok(p.fixVsRebuildSignals.likelyKeep.length >= 1);
  assert.ok(p.fixVsRebuildSignals.likelyFix.length >= 1);
  assert.ok(p.fixVsRebuildSignals.likelyRebuild.length >= 1);
  assert.ok(p.fixVsRebuildSignals.needsVerification.length >= 1);
});

test("handles input without throwing + deterministic", () => {
  for (const bad of ["", null, "x"]) {
    assert.doesNotThrow(() => buildAiBuiltAppRecoveryPreview(bad));
  }
  assert.deepEqual(
    buildAiBuiltAppRecoveryPreview(SAMPLE_AI_BUILT_APP),
    buildAiBuiltAppRecoveryPreview(SAMPLE_AI_BUILT_APP),
  );
});

test("sample reaches higher confidence and 3-6 questions", () => {
  const p = buildAiBuiltAppRecoveryPreview(SAMPLE_AI_BUILT_APP);
  assert.ok(["medium", "high"].includes(p.confidence));
  assert.ok(p.missingQuestions.length >= 3 && p.missingQuestions.length <= 6);
});

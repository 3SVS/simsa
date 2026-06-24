// Stage 107 — Stage Plan tests. Pure/deterministic; no backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntakeStagePlan,
  STAGE_STATUS_LABELS,
  STAGE_KIND_LABELS,
} from "../src/intake-stage-plan.mjs";
import { WORKSPACE_INTAKE_TYPES } from "../src/intake.mjs";

function assertPlan(plan) {
  assert.ok(plan.title.length > 0);
  assert.ok(plan.summary.length > 0);
  assert.ok(plan.stages.length >= 4 && plan.stages.length <= 7, `stages=${plan.stages.length}`);
  // sequential numbering
  plan.stages.forEach((s, i) => assert.equal(s.number, i + 1));
  // each stage well-formed
  for (const s of plan.stages) {
    assert.ok(s.title.length > 0);
    assert.ok(STAGE_KIND_LABELS[s.kind], `bad kind ${s.kind}`);
    assert.ok(STAGE_STATUS_LABELS[s.status], `bad status ${s.status}`);
    assert.ok(s.goal.length > 0);
    assert.ok(s.candidateChecks.length >= 2 && s.candidateChecks.length <= 4);
    assert.ok(s.evidenceToCollect.length >= 1 && s.evidenceToCollect.length <= 3);
    assert.ok(s.exitCriteria.length >= 1 && s.exitCriteria.length <= 3);
  }
  // ends with a release stage
  assert.equal(plan.stages[plan.stages.length - 1].kind, "release");
  // release gate
  assert.ok(plan.releaseGate.checks.length >= 1);
  // start stage in range
  assert.ok(plan.recommendedStartStage >= 1 && plan.recommendedStartStage <= plan.stages.length);
  assert.ok(["low", "medium", "high"].includes(plan.confidence));
}

test("builds a valid plan for every intake type", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const plan = buildIntakeStagePlan({ type, rawInput: "some pasted input here" });
    assert.equal(plan.intakeType, type);
    assertPlan(plan);
  }
});

test("4–7 stages even with empty input", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    assertPlan(buildIntakeStagePlan({ type, rawInput: "" }));
  }
});

test("prd plan includes acceptance conversion + resolve questions", () => {
  const plan = buildIntakeStagePlan({
    type: "prd",
    rawInput: "Overview: a tool. Users: founder. User can submit.",
  });
  assert.ok(plan.stages.some((s) => /acceptance items/i.test(s.title)));
  assert.ok(plan.stages.some((s) => /missing product questions/i.test(s.title)));
});

test("github_repo plan includes build/test evidence stage", () => {
  const plan = buildIntakeStagePlan({ type: "github_repo", rawInput: "acme/web-app" });
  assert.ok(plan.stages.some((s) => /build\/test evidence/i.test(s.title)));
});

test("ai_built_app plan includes fix-or-rebuild stage", () => {
  const plan = buildIntakeStagePlan({
    type: "ai_built_app",
    rawInput: "AI-built dashboard with login and sharing.",
  });
  assert.ok(plan.stages.some((s) => s.kind === "fix"));
});

test("pull_request plan maps PR to acceptance item", () => {
  const plan = buildIntakeStagePlan({
    type: "pull_request",
    rawInput: "https://github.com/acme/widget/pull/9",
  });
  assert.ok(plan.stages.some((s) => /PR change to an acceptance item/i.test(s.title)));
});

test("low confidence (empty) starts at stage 1", () => {
  const plan = buildIntakeStagePlan({ type: "idea", rawInput: "" });
  assert.equal(plan.confidence, "low");
  assert.equal(plan.recommendedStartStage, 1);
});

test("does not throw for empty; throws for unknown type", () => {
  assert.doesNotThrow(() => buildIntakeStagePlan({ type: "idea", rawInput: "" }));
  assert.throws(() => buildIntakeStagePlan({ type: "bogus", rawInput: "x" }));
});

test("deterministic", () => {
  const a = buildIntakeStagePlan({ type: "ai_built_app", rawInput: "login + sharing app" });
  const b = buildIntakeStagePlan({ type: "ai_built_app", rawInput: "login + sharing app" });
  assert.deepEqual(a, b);
});

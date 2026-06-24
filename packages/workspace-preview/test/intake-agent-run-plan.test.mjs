// Stage 110 — Agent Run Plan tests. Pure/deterministic; no execution/backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentRunPlan,
  AGENT_ROLE_LABELS,
  AGENT_TOOL_LABELS,
  AGENT_STATUS_LABELS,
  AGENT_DECISION_LABELS,
} from "../src/intake-agent-run-plan.mjs";
import { buildIntakeStagePlan } from "../src/intake-stage-plan.mjs";
import { WORKSPACE_INTAKE_TYPES } from "../src/intake.mjs";

const FORBIDDEN = ["passed", "complete", "completed", "verified", "production_ready", "ready"];

function assertPlan(plan) {
  assert.ok(plan.title.length > 0);
  assert.ok(plan.summary.length > 0);
  assert.ok(plan.tasks.length >= 1);
  assert.ok(AGENT_ROLE_LABELS[plan.primaryRole], `bad primaryRole ${plan.primaryRole}`);
  assert.ok(plan.tasks.some((t) => t.id === plan.recommendedFirstTaskId));
  assert.ok(["low", "medium", "high"].includes(plan.confidence));
  for (const t of plan.tasks) {
    assert.ok(AGENT_ROLE_LABELS[t.role], `bad role ${t.role}`);
    assert.ok(AGENT_STATUS_LABELS[t.status], `bad status ${t.status}`);
    assert.ok(AGENT_TOOL_LABELS[t.recommendedTool], `bad tool ${t.recommendedTool}`);
    assert.ok(AGENT_DECISION_LABELS[t.nextDecision], `bad decision ${t.nextDecision}`);
    assert.ok(t.task.length > 0);
    assert.ok(t.inputs.length >= 1);
    assert.ok(t.acceptanceItems.length >= 1);
    assert.ok(t.expectedEvidence.length >= 1);
    // no forbidden completion language in the status enum
    assert.ok(!FORBIDDEN.includes(t.status));
  }
}

test("builds an agent run plan for every intake type", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const plan = buildAgentRunPlan({ type, rawInput: "some pasted input here" });
    assert.equal(plan.intakeType, type);
    assertPlan(plan);
  }
});

test("task count matches the stage plan count", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const sp = buildIntakeStagePlan({ type, rawInput: "input" });
    const arp = buildAgentRunPlan({ type, rawInput: "input" });
    assert.equal(arp.tasks.length, sp.stages.length);
  }
});

test("task ids are stable and sequential", () => {
  const plan = buildAgentRunPlan({ type: "idea", rawInput: "x" });
  plan.tasks.forEach((t, i) => {
    assert.equal(t.id, `task-${i + 1}`);
    assert.equal(t.stageNumber, i + 1);
  });
});

test("role mapping follows stage kind", () => {
  // ai_built_app stage plan includes a fix stage → fixer task with claude_code
  const plan = buildAgentRunPlan({
    type: "ai_built_app",
    rawInput: "AI-built dashboard with login and sharing.",
  });
  const fixTask = plan.tasks.find((t) => t.role === "fixer");
  assert.ok(fixTask, "expected a fixer task");
  assert.equal(fixTask.recommendedTool, "claude_code");
  // last task is the release stage → operator + human_review
  const last = plan.tasks[plan.tasks.length - 1];
  assert.equal(last.role, "operator");
  assert.equal(last.recommendedTool, "human_review");
});

test("recommended tools are conservative (from the allowed set)", () => {
  const allowed = new Set(Object.keys(AGENT_TOOL_LABELS));
  for (const type of WORKSPACE_INTAKE_TYPES) {
    for (const t of buildAgentRunPlan({ type, rawInput: "x" }).tasks) {
      assert.ok(allowed.has(t.recommendedTool));
    }
  }
});

test("includes expected evidence and inputs reference the artifact", () => {
  const plan = buildAgentRunPlan({ type: "prd", rawInput: "Overview: a tool. User can submit." });
  assert.ok(plan.tasks.every((t) => t.expectedEvidence.length >= 1));
  assert.ok(plan.tasks[0].inputs.includes("Pasted PRD/spec text"));
});

test("recommendedFirstTaskId matches the stage plan recommended start", () => {
  const sp = buildIntakeStagePlan({ type: "github_repo", rawInput: "acme/web-app" });
  const arp = buildAgentRunPlan({ type: "github_repo", rawInput: "acme/web-app" });
  assert.equal(arp.recommendedFirstTaskId, `task-${sp.recommendedStartStage}`);
});

test("deterministic + does not throw for empty; throws for unknown", () => {
  assert.doesNotThrow(() => buildAgentRunPlan({ type: "idea", rawInput: "" }));
  assert.throws(() => buildAgentRunPlan({ type: "bogus", rawInput: "x" }));
  assert.deepEqual(
    buildAgentRunPlan({ type: "ai_built_app", rawInput: "login app" }),
    buildAgentRunPlan({ type: "ai_built_app", rawInput: "login app" }),
  );
});

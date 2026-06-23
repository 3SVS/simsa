// Stage 110 — deterministic Agent Run Plan from the Intake Stage Plan.
//
// Stage Plan → role-based work for builders / reviewers / fixers / verifiers /
// operators. Pure, in-browser; reuses Stage 107's buildIntakeStagePlan. NO agent
// execution, no central-plane, no Anthropic/Codex/GitHub call, no DB, no
// persistence. Simsa is the acceptance layer: it tells builders/agents what to
// build, review, fix, compare, and verify next — it does not execute it.
import { buildIntakeStagePlan } from "./intake-stage-plan.mjs";

// Stage kind → role / recommended tool / next decision (deterministic, conservative).
const KIND_MAP = {
  clarify: { role: "operator", tool: "human_review", status: "needs_decision", decision: "not_verified" },
  acceptance: { role: "reviewer", tool: "human_review", status: "candidate", decision: "defer" },
  review: { role: "reviewer", tool: "github_pr_review", status: "needs_evidence", decision: "fix" },
  fix: { role: "fixer", tool: "claude_code", status: "planned", decision: "rerun" },
  evidence: { role: "verifier", tool: "test_run", status: "needs_evidence", decision: "not_verified" },
  release: { role: "operator", tool: "human_review", status: "needs_decision", decision: "accept" },
};

// Per-intake-type label for the "user-provided artifact" input line.
const ARTIFACT_INPUT = {
  idea: "Idea description",
  prd: "Pasted PRD/spec text",
  product_url: "Product URL reference",
  github_repo: "Repository reference",
  pull_request: "Pull request reference",
  ai_built_app: "Existing app description",
};

// Recommended evidence per stage kind (expected, not collected).
const KIND_EVIDENCE = {
  clarify: ["Clarification notes"],
  acceptance: ["Acceptance item checklist"],
  review: ["Review notes", "Screenshot or walkthrough"],
  fix: ["Fix summary", "PR or commit link"],
  evidence: ["Test/build result"],
  release: ["Release decision note"],
};

function unique(arr) {
  return [...new Set(arr)];
}

/**
 * @param {{ type: import("./intake.d.mts").WorkspaceIntakeType, rawInput: string }} input
 * @returns {import("./intake-agent-run-plan.d.mts").AgentRunPlan}
 */
export function buildAgentRunPlan(input) {
  const plan = buildIntakeStagePlan(input); // throws on unknown type (by design)
  const type = plan.intakeType;
  const artifactInput = ARTIFACT_INPUT[type] ?? "User-provided artifact";

  const tasks = plan.stages.map((stage) => {
    const m = KIND_MAP[stage.kind] ?? KIND_MAP.review;
    return {
      id: `task-${stage.number}`,
      stageNumber: stage.number,
      stageTitle: stage.title,
      role: m.role,
      status: m.status,
      task: stage.goal,
      inputs: unique([
        "Intake draft",
        "Acceptance Map",
        "Stage Plan",
        artifactInput,
      ]),
      acceptanceItems: stage.candidateChecks,
      expectedEvidence: unique([
        ...(KIND_EVIDENCE[stage.kind] ?? []),
        ...stage.evidenceToCollect,
      ]),
      recommendedTool: m.tool,
      nextDecision: m.decision,
    };
  });

  // Primary role = the role of the recommended start stage.
  const startTask =
    tasks.find((t) => t.stageNumber === plan.recommendedStartStage) ?? tasks[0];

  return {
    intakeType: type,
    title: plan.title,
    summary:
      "Simsa turns the stage plan into role-based work for builders, reviewers, fixers, and verifiers.",
    tasks,
    primaryRole: startTask ? startTask.role : "reviewer",
    recommendedFirstTaskId: startTask ? startTask.id : "task-1",
    confidence: plan.confidence,
  };
}

export const AGENT_ROLE_LABELS = {
  builder: "Builder",
  reviewer: "Reviewer",
  fixer: "Fixer",
  verifier: "Verifier",
  operator: "Operator",
};

export const AGENT_TOOL_LABELS = {
  human_review: "Human review",
  claude_code: "Claude Code",
  codex: "Codex",
  github_pr_review: "GitHub PR review",
  browser_check: "Browser check",
  test_run: "Test run",
  none: "None",
};

export const AGENT_STATUS_LABELS = {
  planned: "Planned",
  candidate: "Candidate",
  needs_evidence: "Needs evidence",
  not_verified: "Not verified",
  needs_decision: "Needs decision",
};

export const AGENT_DECISION_LABELS = {
  accept: "Accept",
  fix: "Fix",
  rerun: "Rerun",
  defer: "Defer",
  not_verified: "Not verified",
};

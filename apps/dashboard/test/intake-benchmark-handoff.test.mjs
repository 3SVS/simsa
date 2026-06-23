// Stage 113 — Benchmark Handoff Preview tests. Pure/deterministic; no execution,
// no persistence, no winner/verified claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkHandoffPreview } from "../src/lib/intake-benchmark-handoff.mjs";
import { buildAgentRunPlan } from "../src/lib/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/lib/intake-evidence-plan.mjs";
import { buildIntakeAcceptanceMap } from "../src/lib/intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "../src/lib/intake-stage-plan.mjs";

const FORBIDDEN = ["executed", "winner", "passed", "verified", "best agent", "production_ready"];
const ROLES = ["builder", "reviewer", "fixer", "verifier", "operator"];
const TOOLS = [
  "human_review",
  "claude_code",
  "codex",
  "github_pr_review",
  "browser_check",
  "test_run",
  "none",
];

/** Build a realistic saved-workflow-like input for a given intake type. */
function savedWorkflow(type, rawInput) {
  return {
    workflowRecordId: "wawr_test1",
    title: `${type} workflow`,
    sourceSummary: `${type} — saved workflow snapshot.`,
    agentRunPlan: buildAgentRunPlan({ type, rawInput }),
    evidencePlan: buildIntakeEvidencePlan({ type, rawInput }),
    acceptanceMap: buildIntakeAcceptanceMap({ type, rawInput }),
    stagePlan: buildIntakeStagePlan({ type, rawInput }),
  };
}

function assertPreview(p) {
  assert.ok(p.title.length > 0);
  assert.ok(p.summary.length > 0);
  assert.ok(p.benchmarkGoal.length > 0);
  assert.ok(["low", "medium", "high"].includes(p.confidence));

  assert.ok(
    p.agentCandidates.length >= 2 && p.agentCandidates.length <= 6,
    `candidates=${p.agentCandidates.length}`,
  );
  for (const c of p.agentCandidates) {
    assert.ok(ROLES.includes(c.role), `role ${c.role}`);
    assert.ok(TOOLS.includes(c.recommendedTool), `tool ${c.recommendedTool}`);
    assert.ok(c.label.includes("/"));
    assert.ok(Array.isArray(c.taskIds));
    assert.ok(Array.isArray(c.stageNumbers));
    assert.ok(Array.isArray(c.expectedEvidence));
  }

  assert.ok(
    p.acceptanceTargets.length >= 3 && p.acceptanceTargets.length <= 8,
    `targets=${p.acceptanceTargets.length}`,
  );
  for (const t of p.acceptanceTargets) {
    assert.ok(t.acceptanceItemTitle.length > 0);
    assert.ok(t.area.length > 0);
    assert.ok(Array.isArray(t.stageNumbers));
    assert.ok(Array.isArray(t.evidenceTypes));
    assert.ok(t.decisionCriteria.length >= 3);
  }

  assert.ok(p.comparisonQuestions.length >= 4 && p.comparisonQuestions.length <= 6);
  assert.ok(p.notIncludedYet.length >= 4);

  // No execution / winner / verified claims — EXCEPT the notIncludedYet
  // disclaimers, which explicitly negate those words ("No benchmark is
  // executed", "No winner … selected yet").
  const { notIncludedYet: _disclaimers, ...scanned } = p;
  let blob = JSON.stringify(scanned).toLowerCase();
  // "not verified" / "not_verified" is an allowed status, not a positive claim.
  blob = blob.replace(/not[_ ]verified/g, "");
  for (const word of FORBIDDEN) {
    assert.ok(!blob.includes(word), `must not contain "${word}"`);
  }
}

test("builds a handoff preview for every intake type", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    assertPreview(buildBenchmarkHandoffPreview(savedWorkflow(type, "some pasted input")));
  }
});

test("groups agent candidates by role + tool (no duplicate groups)", () => {
  const p = buildBenchmarkHandoffPreview(savedWorkflow("github_repo", "acme/web-app"));
  const keys = p.agentCandidates.map((c) => `${c.role}|${c.recommendedTool}`);
  assert.equal(keys.length, new Set(keys).size, "candidate role|tool keys must be unique");
});

test("derives acceptance targets from evidence expectations", () => {
  const p = buildBenchmarkHandoffPreview(savedWorkflow("prd", "Overview: x. User can submit."));
  const titles = p.acceptanceTargets.map((t) => t.acceptanceItemTitle);
  assert.ok(titles.length >= 3);
  assert.equal(titles.length, new Set(titles).size, "target titles unique");
});

test("benchmark goal uses the title when present", () => {
  const p = buildBenchmarkHandoffPreview(savedWorkflow("idea", "an idea"));
  assert.match(p.benchmarkGoal, /Compare candidate outputs for: idea workflow/);
});

test("notIncludedYet always carries the no-execution disclaimers", () => {
  const p = buildBenchmarkHandoffPreview(savedWorkflow("idea", "x"));
  const joined = p.notIncludedYet.join(" ");
  assert.match(joined, /No benchmark is executed/);
  assert.match(joined, /No winner or final decision is selected/);
});

test("fallback candidates/targets when snapshots are empty", () => {
  const p = buildBenchmarkHandoffPreview({
    workflowRecordId: "wawr_empty",
    title: "Empty",
    sourceSummary: "",
    agentRunPlan: {},
    evidencePlan: {},
  });
  assert.ok(p.agentCandidates.length >= 2, "fallback gives >=2 candidates");
  assert.ok(p.acceptanceTargets.length >= 3, "fallback gives >=3 targets");
  assert.equal(p.confidence, "low", "empty snapshots => low confidence");
  assertPreview(p);
});

test("handles malformed snapshots without throwing", () => {
  const malformed = [
    null,
    undefined,
    42,
    "string",
    { tasks: "nope", expectations: 5 },
    { tasks: [null, 1, { id: 123 }, { id: "ok", role: "weird", recommendedTool: "bogus", stageNumber: "x", expectedEvidence: "no" }] },
    { agentRunPlan: { tasks: [{}] }, evidencePlan: { expectations: [{}, { acceptanceItemTitle: "" }] } },
  ];
  for (const m of malformed) {
    assert.doesNotThrow(() =>
      buildBenchmarkHandoffPreview({
        title: "M",
        sourceSummary: "",
        agentRunPlan: m,
        evidencePlan: m,
        acceptanceMap: m,
        stagePlan: m,
      }),
    );
  }
});

test("malformed task role/tool are coerced into the allowed enums", () => {
  const p = buildBenchmarkHandoffPreview({
    title: "Coerce",
    sourceSummary: "",
    agentRunPlan: {
      tasks: [
        { id: "task-1", role: "weird", recommendedTool: "bogus", stageNumber: 1, expectedEvidence: ["e"] },
        { id: "task-2", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 2, expectedEvidence: ["e2"] },
      ],
    },
    evidencePlan: { expectations: [] },
  });
  for (const c of p.agentCandidates) {
    assert.ok(ROLES.includes(c.role));
    assert.ok(TOOLS.includes(c.recommendedTool));
  }
});

test("deterministic output for identical input", () => {
  const a = buildBenchmarkHandoffPreview(savedWorkflow("github_repo", "acme/web-app"));
  const b = buildBenchmarkHandoffPreview(savedWorkflow("github_repo", "acme/web-app"));
  assert.deepEqual(a, b);
});

// Stage 128 — Agent/Tool Recommendation Memory tests. Pure/deterministic; per-
// workflow derived only (no cross-project learning / training / persistence).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentToolRecommendationMemoryView } from "../src/lib/agent-tool-recommendation-memory.mjs";
import { buildAgentRunPlan } from "../src/lib/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/lib/intake-evidence-plan.mjs";

const FITS = ["strong", "partial", "weak", "unknown"];
const ROLES = ["builder", "reviewer", "fixer", "verifier", "operator"];
const FORBIDDEN = ["trained model", "learned from all users", "best tool guaranteed", "proven agent performance", "verified tool quality"];

function assertView(v) {
  assert.ok(v.title.length > 0);
  assert.ok(v.summary.length > 0);
  assert.ok(["low", "medium", "high"].includes(v.confidence));
  assert.ok(v.items.length <= 8);
  const ids = new Set();
  for (const it of v.items) {
    assert.ok(it.id && !ids.has(it.id));
    ids.add(it.id);
    assert.ok(ROLES.includes(it.role), `bad role ${it.role}`);
    assert.ok(typeof it.recommendedTool === "string" && it.recommendedTool.length > 0);
    assert.ok(FITS.includes(it.toolFit), `bad fit ${it.toolFit}`);
    assert.ok(Array.isArray(it.taskIds));
    assert.ok(Array.isArray(it.stageNumbers));
    assert.ok(Array.isArray(it.expectedEvidenceTypes));
    assert.ok(Array.isArray(it.blockerTypes));
    assert.ok(it.memoryNote.length > 0 && it.suggestedFutureUse.length > 0);
  }
  const s = v.evidenceFitSummary;
  assert.equal(s.strong + s.partial + s.weak + s.unknown, v.items.length);
  if (v.items.length > 0) {
    assert.ok(typeof v.topTool === "string");
    assert.ok(ROLES.includes(v.topRole));
  }
  assert.ok(v.notIncludedYet.length >= 4);
  const blob = JSON.stringify({ ...v, notIncludedYet: [] }).toLowerCase();
  for (const w of FORBIDDEN) assert.ok(!blob.includes(w), `must not contain "${w}"`);
}

test("builds memory view from generated workflow agent tasks", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    const agentRunPlan = buildAgentRunPlan({ type, rawInput: "some input" });
    const evidencePlan = buildIntakeEvidencePlan({ type, rawInput: "some input" });
    const v = buildAgentToolRecommendationMemoryView({
      title: `${type} wf`, sourceSummary: "s", agentRunPlan, evidencePlan,
    });
    assertView(v);
  }
});

test("groups by role + recommendedTool", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "G", sourceSummary: "s",
    agentRunPlan: {
      tasks: [
        { id: "task-1", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 1, expectedEvidence: ["review_note"] },
        { id: "task-2", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 2, expectedEvidence: ["pr_link"] },
        { id: "task-3", role: "fixer", recommendedTool: "claude_code", stageNumber: 3, expectedEvidence: ["commit_link"] },
      ],
    },
    evidencePlan: { expectations: [] },
  });
  // 2 groups: reviewer|github_pr_review (2 tasks), fixer|claude_code (1 task)
  assert.equal(v.items.length, 2);
  const reviewer = v.items.find((i) => i.role === "reviewer");
  assert.equal(reviewer.taskIds.length, 2);
});

test("strong fit: browser_check + screenshot/walkthrough", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "BC", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "task-1", role: "verifier", recommendedTool: "browser_check", stageNumber: 1, expectedEvidence: ["screenshot", "walkthrough"] }] },
    evidencePlan: { expectations: [] },
  });
  assert.equal(v.items[0].toolFit, "strong");
});

test("strong fit: test_run + test/build evidence", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "TR", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "task-1", role: "verifier", recommendedTool: "test_run", stageNumber: 1, expectedEvidence: ["test_result", "build_result"] }] },
    evidencePlan: { expectations: [] },
  });
  assert.equal(v.items[0].toolFit, "strong");
});

test("weak fit: tool with known evidence but no overlap", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "W", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "task-1", role: "verifier", recommendedTool: "test_run", stageNumber: 1, expectedEvidence: ["screenshot"] }] },
    evidencePlan: { expectations: [] },
  });
  assert.equal(v.items[0].toolFit, "weak");
});

test("partial fit: some overlap but not full", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "P", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "task-1", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 1, expectedEvidence: ["pr_link", "screenshot"] }] },
    evidencePlan: { expectations: [] },
  });
  assert.equal(v.items[0].toolFit, "partial");
});

test("unknown fit: tool=none or no expected evidence", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "U", sourceSummary: "s",
    agentRunPlan: {
      tasks: [
        { id: "task-1", role: "operator", recommendedTool: "none", stageNumber: 1, expectedEvidence: [] },
        { id: "task-2", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 2, expectedEvidence: [] },
      ],
    },
    evidencePlan: { expectations: [] },
  });
  for (const it of v.items) assert.equal(it.toolFit, "unknown");
});

test("enriches expected evidence from the Evidence Plan by stage", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "EN", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "task-1", role: "verifier", recommendedTool: "browser_check", stageNumber: 4, expectedEvidence: [] }] },
    evidencePlan: { expectations: [{ id: "e1", acceptanceItemTitle: "A", relatedArea: "primary_user_flow", relatedStageNumbers: [4], evidenceTypes: ["screenshot"], status: "needed", decisionImpact: "not_verified" }] },
  });
  assert.ok(v.items[0].expectedEvidenceTypes.includes("screenshot"));
  assert.equal(v.items[0].toolFit, "strong");
});

test("associates blocker types by task id or stage number", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "BL", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "task-1", role: "fixer", recommendedTool: "claude_code", stageNumber: 3, expectedEvidence: ["commit_link"] }] },
    evidencePlan: { expectations: [] },
    recurringBlockerDetectionView: {
      blockers: [
        { id: "blk-1", type: "fix_rerun_cluster", relatedTaskIds: ["task-1"], relatedStageNumbers: [] },
        { id: "blk-2", type: "not_verified_cluster", relatedTaskIds: [], relatedStageNumbers: [3] },
      ],
    },
  });
  assert.ok(v.items[0].blockerTypes.includes("fix_rerun_cluster"));
  assert.ok(v.items[0].blockerTypes.includes("not_verified_cluster"));
});

test("selects deterministic topTool/topRole (most tasks first)", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "TOP", sourceSummary: "s",
    agentRunPlan: {
      tasks: [
        { id: "t1", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 1, expectedEvidence: ["review_note"] },
        { id: "t2", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 2, expectedEvidence: ["pr_link"] },
        { id: "t3", role: "fixer", recommendedTool: "claude_code", stageNumber: 3, expectedEvidence: ["commit_link"] },
      ],
    },
    evidencePlan: { expectations: [] },
  });
  assert.equal(v.topTool, "github_pr_review");
  assert.equal(v.topRole, "reviewer");
});

test("no items for empty/minimal input", () => {
  const v = buildAgentToolRecommendationMemoryView({ title: "E", sourceSummary: "" });
  assert.equal(v.items.length, 0);
  assert.equal(v.topTool, undefined);
  assert.equal(v.confidence, "low");
  assertView(v);
});

test("caps items at 8", () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    id: `task-${i}`, role: i % 2 ? "reviewer" : "fixer",
    recommendedTool: `tool_${i}`, stageNumber: i, expectedEvidence: [],
  }));
  const v = buildAgentToolRecommendationMemoryView({
    title: "MANY", sourceSummary: "s", agentRunPlan: { tasks }, evidencePlan: { expectations: [] },
  });
  assert.ok(v.items.length <= 8);
});

test("includes notIncludedYet disclaimers (derived-only / no training)", () => {
  const v = buildAgentToolRecommendationMemoryView({
    title: "D", sourceSummary: "s",
    agentRunPlan: { tasks: [{ id: "t1", role: "reviewer", recommendedTool: "github_pr_review", stageNumber: 1, expectedEvidence: ["review_note"] }] },
    evidencePlan: { expectations: [] },
  });
  const joined = v.notIncludedYet.join(" ").toLowerCase();
  assert.match(joined, /derived from this saved workflow only/);
  assert.match(joined, /no cross-project learning or model training/);
  assert.match(joined, /not actual execution quality/);
});

test("handles malformed snapshots without throwing", () => {
  const bad = [null, undefined, 7, "x", { tasks: "no" }, { tasks: [null, 1, {}] }];
  for (const m of bad) {
    assert.doesNotThrow(() =>
      buildAgentToolRecommendationMemoryView({
        title: "M", sourceSummary: "", agentRunPlan: m, evidencePlan: m, recurringBlockerDetectionView: m,
      }),
    );
  }
});

test("deterministic output for identical input", () => {
  const agentRunPlan = buildAgentRunPlan({ type: "github_repo", rawInput: "acme/web-app" });
  const evidencePlan = buildIntakeEvidencePlan({ type: "github_repo", rawInput: "acme/web-app" });
  const a = buildAgentToolRecommendationMemoryView({ title: "x", sourceSummary: "s", agentRunPlan, evidencePlan });
  const b = buildAgentToolRecommendationMemoryView({ title: "x", sourceSummary: "s", agentRunPlan, evidencePlan });
  assert.deepEqual(a, b);
});

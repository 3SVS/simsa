// Stage 126 — Acceptance Graph derived view tests. Pure/deterministic; derived
// from snapshots only (no graph DB, no training).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAcceptanceGraphDerivedView } from "../src/acceptance-graph-derived.mjs";
import { buildAgentRunPlan } from "../src/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/intake-evidence-plan.mjs";
import { buildIntakeAcceptanceMap } from "../src/intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "../src/intake-stage-plan.mjs";
import { buildDecisionOutcomeLinkPreview } from "../src/intake-decision-outcome-link.mjs";
import { buildEvolutionActionPackPreview } from "../src/intake-evolution-action-preview.mjs";

const NODE_TYPES = [
  "intake", "acceptance_item", "acceptance_area", "stage", "agent_task",
  "evidence_expectation", "decision_candidate", "action_preview",
];
const EDGE_TYPES = [
  "generated_from", "belongs_to", "requires_evidence", "assigned_to_role",
  "suggests_decision", "creates_action", "blocks_release",
];

function savedWorkflow(type, rawInput) {
  const acceptanceMap = buildIntakeAcceptanceMap({ type, rawInput });
  const stagePlan = buildIntakeStagePlan({ type, rawInput });
  const agentRunPlan = buildAgentRunPlan({ type, rawInput });
  const evidencePlan = buildIntakeEvidencePlan({ type, rawInput });
  const decisionOutcomePreview = buildDecisionOutcomeLinkPreview({
    title: `${type} wf`, sourceSummary: "s", acceptanceMap, stagePlan, agentRunPlan, evidencePlan,
  });
  const evolutionActionPreview = buildEvolutionActionPackPreview({
    title: `${type} wf`, sourceSummary: "s", acceptanceMap, stagePlan, agentRunPlan, evidencePlan,
  });
  return {
    workflowRecordId: "wawr_t",
    title: `${type} wf`,
    sourceSummary: `${type} snapshot`,
    acceptanceMap, stagePlan, agentRunPlan, evidencePlan,
    decisionOutcomePreview, evolutionActionPreview,
  };
}

function assertView(v) {
  assert.ok(v.title.length > 0);
  assert.ok(v.summary.length > 0);
  assert.ok(["low", "medium", "high"].includes(v.confidence));

  // intake node always present.
  const intake = v.nodes.filter((n) => n.type === "intake");
  assert.equal(intake.length, 1);

  // node ids unique; types valid.
  const ids = new Set();
  for (const n of v.nodes) {
    assert.ok(n.id && !ids.has(n.id), `dup node id ${n.id}`);
    ids.add(n.id);
    assert.ok(NODE_TYPES.includes(n.type), `bad node type ${n.type}`);
    assert.ok(n.label.length > 0);
  }
  // edges valid + reference existing nodes; capped at 40.
  assert.ok(v.edges.length <= 40);
  for (const e of v.edges) {
    assert.ok(EDGE_TYPES.includes(e.type), `bad edge type ${e.type}`);
    assert.ok(ids.has(e.from), `edge.from missing ${e.from}`);
    assert.ok(ids.has(e.to), `edge.to missing ${e.to}`);
  }

  const s = v.signalSummary;
  for (const k of ["acceptanceItemCount", "stageCount", "agentTaskCount", "evidenceExpectationCount", "notVerifiedCount", "decisionCandidateCount", "actionPreviewCount"]) {
    assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `bad ${k}`);
  }
  assert.ok(Array.isArray(s.topAcceptanceAreas) && s.topAcceptanceAreas.length <= 5);
  assert.ok(Array.isArray(s.topEvidenceTypes) && s.topEvidenceTypes.length <= 5);
  assert.ok(v.notIncludedYet.length >= 4);
}

test("builds a derived graph view for every intake type", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    assertView(buildAcceptanceGraphDerivedView(savedWorkflow(type, "some pasted input")));
  }
});

test("always creates an intake node + derives item/stage/task/evidence nodes", () => {
  const v = buildAcceptanceGraphDerivedView(savedWorkflow("github_repo", "acme/web-app"));
  assert.ok(v.nodes.some((n) => n.type === "intake"));
  assert.ok(v.nodes.some((n) => n.type === "acceptance_item"));
  assert.ok(v.nodes.some((n) => n.type === "stage"));
  assert.ok(v.nodes.some((n) => n.type === "agent_task"));
  assert.ok(v.nodes.some((n) => n.type === "evidence_expectation"));
});

test("derives decision + action nodes when previews provided", () => {
  const v = buildAcceptanceGraphDerivedView(savedWorkflow("prd", "Overview: x. User can submit."));
  assert.ok(v.nodes.some((n) => n.type === "decision_candidate"));
  assert.ok(v.nodes.some((n) => n.type === "action_preview"));
});

test("creates deterministic edges incl. generated_from from intake", () => {
  const v = buildAcceptanceGraphDerivedView(savedWorkflow("github_repo", "acme/web-app"));
  assert.ok(v.edges.some((e) => e.type === "generated_from" && e.from === "intake"));
  assert.ok(v.edges.some((e) => e.type === "requires_evidence"));
  assert.ok(v.edges.some((e) => e.type === "assigned_to_role"));
});

test("computes signal counts + top areas/evidence", () => {
  const v = buildAcceptanceGraphDerivedView(savedWorkflow("github_repo", "acme/billing-api"));
  assert.ok(v.signalSummary.acceptanceItemCount >= 1);
  assert.ok(v.signalSummary.evidenceExpectationCount >= 1);
  assert.ok(v.signalSummary.topAcceptanceAreas.length >= 1);
  assert.ok(v.signalSummary.topEvidenceTypes.length >= 1);
  // top areas sorted desc by count
  const counts = v.signalSummary.topAcceptanceAreas.map((a) => a.count);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1] >= counts[i]);
});

test("decision→action edges follow the semantic mapping", () => {
  const v = buildAcceptanceGraphDerivedView({
    title: "Map",
    sourceSummary: "s",
    acceptanceMap: { items: [{ title: "Error recovery works", area: "error_recovery", status: "needs_verification" }] },
    stagePlan: { stages: [{ number: 3, title: "Fix", kind: "fix" }] },
    agentRunPlan: { tasks: [{ id: "task-1", stageNumber: 3, role: "fixer", task: "fix it" }] },
    evidencePlan: { expectations: [{ id: "ev-1", acceptanceItemTitle: "Error recovery works", relatedArea: "error_recovery", evidenceTypes: ["fix_summary"], status: "needed", decisionImpact: "fix" }] },
    decisionOutcomePreview: { decisionCandidates: [{ type: "fix", label: "Fix" }] },
    evolutionActionPreview: { actions: [{ id: "act-1", type: "create_fix_instructions", title: "Draft fix" }] },
  });
  assert.ok(v.edges.some((e) => e.type === "suggests_decision"));
  assert.ok(v.edges.some((e) => e.type === "creates_action" && e.from === "dc-fix"));
});

test("blocks_release edge from release-readiness item to release stage", () => {
  const v = buildAcceptanceGraphDerivedView({
    title: "Rel",
    sourceSummary: "s",
    acceptanceMap: { items: [{ title: "Release readiness checked", area: "release_readiness", status: "needs_verification" }] },
    stagePlan: { stages: [{ number: 5, title: "Release", kind: "release" }] },
    agentRunPlan: { tasks: [] },
    evidencePlan: { expectations: [] },
  });
  assert.ok(v.edges.some((e) => e.type === "blocks_release"));
});

test("caps nodes (items 12 / tasks 10 / evidence 10) and edges (40)", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ title: `item ${i}`, area: "primary_user_flow", status: "candidate" }));
  const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `task-${i}`, stageNumber: 1, role: "reviewer", task: `t${i}` }));
  const expectations = Array.from({ length: 30 }, (_, i) => ({ id: `ev-${i}`, acceptanceItemTitle: `item ${i}`, relatedArea: "primary_user_flow", evidenceTypes: ["review_note"], status: "not_verified", decisionImpact: "not_verified" }));
  const v = buildAcceptanceGraphDerivedView({
    title: "Big", sourceSummary: "s",
    acceptanceMap: { items },
    stagePlan: { stages: [{ number: 1, title: "S", kind: "review" }] },
    agentRunPlan: { tasks },
    evidencePlan: { expectations },
  });
  assert.ok(v.nodes.filter((n) => n.type === "acceptance_item").length <= 12);
  assert.ok(v.nodes.filter((n) => n.type === "agent_task").length <= 10);
  assert.ok(v.nodes.filter((n) => n.type === "evidence_expectation").length <= 10);
  assert.ok(v.edges.length <= 40);
  // counts still reflect full source arrays
  assert.equal(v.signalSummary.acceptanceItemCount, 30);
});

test("includes notIncludedYet disclaimers (no graph DB / no training)", () => {
  const v = buildAcceptanceGraphDerivedView(savedWorkflow("idea", "x"));
  const joined = v.notIncludedYet.join(" ").toLowerCase();
  assert.match(joined, /no graph database is created yet/);
  assert.match(joined, /no model is trained/);
});

test("handles malformed snapshots without throwing", () => {
  const bad = [null, undefined, 7, "x", { items: "no" }, { items: [null, 1, {}] }];
  for (const m of bad) {
    assert.doesNotThrow(() =>
      buildAcceptanceGraphDerivedView({
        title: "M", sourceSummary: "",
        acceptanceMap: m, stagePlan: m, agentRunPlan: m, evidencePlan: m,
        decisionOutcomePreview: m, evolutionActionPreview: m,
      }),
    );
  }
  // empty → only intake node, no edges, low confidence
  const empty = buildAcceptanceGraphDerivedView({ title: "E", sourceSummary: "" });
  assert.equal(empty.nodes.length, 1);
  assert.equal(empty.edges.length, 0);
  assert.equal(empty.confidence, "low");
});

test("deterministic output for identical input", () => {
  const a = buildAcceptanceGraphDerivedView(savedWorkflow("github_repo", "acme/web-app"));
  const b = buildAcceptanceGraphDerivedView(savedWorkflow("github_repo", "acme/web-app"));
  assert.deepEqual(a, b);
});

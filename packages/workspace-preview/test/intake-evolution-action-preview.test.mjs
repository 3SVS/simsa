// Stage 115 — Evolution Action Pack Preview tests. Pure/deterministic; no action
// pack persistence, no fix execution, no rerun, no evidence collection.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvolutionActionPackPreview,
  ACTION_TYPES,
} from "../src/intake-evolution-action-preview.mjs";
import { buildAgentRunPlan } from "../src/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/intake-evidence-plan.mjs";
import { buildIntakeAcceptanceMap } from "../src/intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "../src/intake-stage-plan.mjs";
import { buildBenchmarkHandoffPreview } from "../src/intake-benchmark-handoff.mjs";
import { buildDecisionOutcomeLinkPreview } from "../src/intake-decision-outcome-link.mjs";

const LEVELS = ["low", "medium", "high"];
const FORBIDDEN = ["action pack created", "fix executed", "resolved", "passed", "production ready"];

function savedWorkflow(type, rawInput) {
  const agentRunPlan = buildAgentRunPlan({ type, rawInput });
  const evidencePlan = buildIntakeEvidencePlan({ type, rawInput });
  const acceptanceMap = buildIntakeAcceptanceMap({ type, rawInput });
  const stagePlan = buildIntakeStagePlan({ type, rawInput });
  const benchmarkHandoffPreview = buildBenchmarkHandoffPreview({
    title: `${type} workflow`,
    sourceSummary: `${type} snapshot`,
    agentRunPlan,
    evidencePlan,
    acceptanceMap,
    stagePlan,
  });
  return {
    workflowRecordId: "wawr_t",
    title: `${type} workflow`,
    sourceSummary: `${type} snapshot`,
    acceptanceMap,
    stagePlan,
    agentRunPlan,
    evidencePlan,
    benchmarkHandoffPreview,
    decisionOutcomePreview: buildDecisionOutcomeLinkPreview({
      title: `${type} workflow`,
      sourceSummary: `${type} snapshot`,
      acceptanceMap,
      stagePlan,
      agentRunPlan,
      evidencePlan,
      benchmarkHandoffPreview,
    }),
  };
}

function assertPreview(p) {
  assert.ok(p.title.length > 0);
  assert.ok(p.summary.length > 0);
  assert.ok(ACTION_TYPES.includes(p.recommendedFocus));
  assert.ok(LEVELS.includes(p.confidence));

  assert.ok(p.actions.length >= 3 && p.actions.length <= 7, `actions=${p.actions.length}`);
  const ids = new Set();
  for (const a of p.actions) {
    assert.ok(a.id && !ids.has(a.id));
    ids.add(a.id);
    assert.ok(ACTION_TYPES.includes(a.type), `type ${a.type}`);
    assert.ok(LEVELS.includes(a.priority), `priority ${a.priority}`);
    assert.ok(a.title.length > 0);
    assert.ok(a.rationale.length > 0);
    assert.ok(Array.isArray(a.sourceSignals) && a.sourceSignals.length >= 1);
    assert.ok(Array.isArray(a.relatedAcceptanceItems));
    assert.ok(Array.isArray(a.relatedStageNumbers));
    assert.ok(a.suggestedInstruction.length > 0);
    assert.ok(Array.isArray(a.expectedEvidence));
  }

  assert.ok(p.followUpQuestions.length >= 3 && p.followUpQuestions.length <= 6);
  assert.ok(p.notIncludedYet.length >= 4);

  const { notIncludedYet: _d, ...scanned } = p;
  // "unresolved" is allowed vocabulary; do not let it trip the "resolved" check.
  const blob = JSON.stringify(scanned).toLowerCase().replace(/unresolved/g, "");
  for (const w of FORBIDDEN) assert.ok(!blob.includes(w), `must not contain "${w}"`);
}

test("builds an evolution action pack preview for every intake type", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    assertPreview(buildEvolutionActionPackPreview(savedWorkflow(type, "some pasted input")));
  }
});

test("returns 3–7 actions even on empty input", () => {
  const p = buildEvolutionActionPackPreview({ title: "Empty", sourceSummary: "" });
  assert.ok(p.actions.length >= 3 && p.actions.length <= 7);
  assertPreview(p);
});

test("defaults recommended focus to collect_evidence when evidence is missing", () => {
  const p = buildEvolutionActionPackPreview({
    title: "Empty",
    sourceSummary: "",
    evidencePlan: {},
    acceptanceMap: {},
  });
  assert.equal(p.recommendedFocus, "collect_evidence");
  assert.equal(p.confidence, "low");
});

test("derives create_fix_instructions from fix decision signals", () => {
  const p = buildEvolutionActionPackPreview({
    title: "Fixy",
    sourceSummary: "x",
    evidencePlan: {
      expectations: [
        { acceptanceItemTitle: "Error recovery", relatedArea: "error_recovery", relatedStageNumbers: [3], evidenceTypes: ["fix_summary"], status: "needed", decisionImpact: "fix" },
        { acceptanceItemTitle: "Privacy", relatedArea: "data_privacy", relatedStageNumbers: [4], evidenceTypes: ["review_note"], status: "needed", decisionImpact: "fix" },
      ],
    },
  });
  const a = p.actions.find((x) => x.type === "create_fix_instructions");
  assert.ok(a, "expected a create_fix_instructions action");
  assert.ok(a.relatedAcceptanceItems.includes("Error recovery"));
  assert.equal(a.priority, "high");
  assert.equal(p.recommendedFocus, "create_fix_instructions");
});

test("derives rerun_agent from rerun decision signals", () => {
  const p = buildEvolutionActionPackPreview({
    title: "Rerun",
    sourceSummary: "x",
    evidencePlan: {
      expectations: [
        { acceptanceItemTitle: "Flow", relatedArea: "primary_user_flow", relatedStageNumbers: [2], evidenceTypes: ["walkthrough"], status: "not_verified", decisionImpact: "rerun" },
      ],
    },
  });
  assert.ok(p.actions.some((x) => x.type === "rerun_agent"));
});

test("derives defer_scope from defer decision signals", () => {
  const p = buildEvolutionActionPackPreview({
    title: "Defer",
    sourceSummary: "x",
    evidencePlan: {
      expectations: [
        { acceptanceItemTitle: "Release", relatedArea: "release_readiness", relatedStageNumbers: [5], evidenceTypes: ["release_decision_note"], status: "needs_decision", decisionImpact: "defer" },
      ],
    },
  });
  assert.ok(p.actions.some((x) => x.type === "defer_scope"));
});

test("includes prepare_release_review when release readiness appears", () => {
  const fromStage = buildEvolutionActionPackPreview({
    title: "Rel",
    sourceSummary: "x",
    stagePlan: { stages: [{ number: 5, kind: "release", title: "Release" }] },
    evidencePlan: { expectations: [] },
  });
  assert.ok(fromStage.actions.some((x) => x.type === "prepare_release_review"));

  const fromEvidence = buildEvolutionActionPackPreview({
    title: "Rel2",
    sourceSummary: "x",
    evidencePlan: {
      expectations: [
        { acceptanceItemTitle: "Release readiness", relatedArea: "release_readiness", relatedStageNumbers: [5], evidenceTypes: ["release_decision_note"], status: "needs_decision", decisionImpact: "defer" },
      ],
    },
  });
  assert.ok(fromEvidence.actions.some((x) => x.type === "prepare_release_review"));
});

test("includes context-specific follow-up question per intake type", () => {
  const repo = buildEvolutionActionPackPreview(savedWorkflow("github_repo", "acme/web-app"));
  assert.ok(repo.followUpQuestions.some((q) => /commit or PR/.test(q)));
  const pr = buildEvolutionActionPackPreview(savedWorkflow("pull_request", "x"));
  assert.ok(pr.followUpQuestions.some((q) => /PR prove/.test(q)));
});

test("includes notIncludedYet disclaimers", () => {
  const p = buildEvolutionActionPackPreview(savedWorkflow("idea", "x"));
  const joined = p.notIncludedYet.join(" ");
  assert.match(joined, /No action pack is persisted/);
  assert.match(joined, /No agent is rerun/);
});

test("handles malformed snapshots without throwing", () => {
  const bad = [null, undefined, 9, "x", { expectations: "no" }, { expectations: [null, 1, {}] }];
  for (const m of bad) {
    assert.doesNotThrow(() =>
      buildEvolutionActionPackPreview({
        title: "M",
        sourceSummary: "",
        acceptanceMap: m,
        stagePlan: m,
        agentRunPlan: m,
        evidencePlan: m,
        benchmarkHandoffPreview: m,
        decisionOutcomePreview: m,
      }),
    );
  }
});

test("deterministic output for identical input", () => {
  const a = buildEvolutionActionPackPreview(savedWorkflow("github_repo", "acme/web-app"));
  const b = buildEvolutionActionPackPreview(savedWorkflow("github_repo", "acme/web-app"));
  assert.deepEqual(a, b);
});

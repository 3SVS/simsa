// Stage 114 — Decision / Outcome Link Preview tests. Pure/deterministic; no
// decision persistence, no scorecard, no action pack, no winner/verified claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionOutcomeLinkPreview,
  DECISION_TYPES,
} from "../src/lib/intake-decision-outcome-link.mjs";
import { buildAgentRunPlan } from "../src/lib/intake-agent-run-plan.mjs";
import { buildIntakeEvidencePlan } from "../src/lib/intake-evidence-plan.mjs";
import { buildIntakeAcceptanceMap } from "../src/lib/intake-acceptance-map.mjs";
import { buildIntakeStagePlan } from "../src/lib/intake-stage-plan.mjs";
import { buildBenchmarkHandoffPreview } from "../src/lib/intake-benchmark-handoff.mjs";

const LEVELS = ["low", "medium", "high"];
const FORBIDDEN = ["final decision", "winner", "passed", "production ready", "production_ready"];

function savedWorkflow(type, rawInput) {
  const agentRunPlan = buildAgentRunPlan({ type, rawInput });
  const evidencePlan = buildIntakeEvidencePlan({ type, rawInput });
  const acceptanceMap = buildIntakeAcceptanceMap({ type, rawInput });
  const stagePlan = buildIntakeStagePlan({ type, rawInput });
  return {
    workflowRecordId: "wawr_t",
    title: `${type} workflow`,
    sourceSummary: `${type} saved snapshot`,
    acceptanceMap,
    stagePlan,
    agentRunPlan,
    evidencePlan,
    benchmarkHandoffPreview: buildBenchmarkHandoffPreview({
      title: `${type} workflow`,
      sourceSummary: `${type} saved snapshot`,
      agentRunPlan,
      evidencePlan,
      acceptanceMap,
      stagePlan,
    }),
  };
}

function assertPreview(p) {
  assert.ok(p.title.length > 0);
  assert.ok(p.summary.length > 0);
  assert.ok(DECISION_TYPES.includes(p.recommendedDecisionCandidate));
  assert.ok(LEVELS.includes(p.confidence));

  // All 5 decision candidates, in order, each well-formed.
  assert.deepEqual(
    p.decisionCandidates.map((c) => c.type),
    ["accept", "fix", "rerun", "defer", "not_verified"],
  );
  for (const c of p.decisionCandidates) {
    assert.ok(c.label.length > 0);
    assert.ok(c.rationale.length > 0);
    assert.ok(Array.isArray(c.requiredEvidence));
    assert.ok(Array.isArray(c.blockingQuestions));
    assert.ok(Array.isArray(c.relatedAcceptanceItems));
    assert.ok(Array.isArray(c.relatedStageNumbers));
  }

  const s = p.outcomeScorecardSignals;
  for (const k of ["evidenceCompleteness", "acceptanceCoverage", "unresolvedRisk", "releaseReadiness"]) {
    assert.ok(LEVELS.includes(s[k]), `signal ${k}=${s[k]}`);
  }
  // Release readiness is never "high" without collected evidence.
  assert.notEqual(s.releaseReadiness, "high");

  assert.ok(p.futureOutcomeLinks.length >= 4);
  assert.ok(p.notIncludedYet.length >= 4);

  // No "decision made / winner / verified" claims, except the explicit
  // notIncludedYet negations.
  const { notIncludedYet: _d, ...scanned } = p;
  let blob = JSON.stringify(scanned).toLowerCase();
  blob = blob.replace(/not[_ ]verified/g, "");
  for (const w of FORBIDDEN) assert.ok(!blob.includes(w), `must not contain "${w}"`);
  // "verified" as a positive claim must not appear (not_verified already stripped).
  assert.ok(!blob.includes("verified"), "must not claim verified");
}

test("builds a decision/outcome preview for every intake type", () => {
  for (const type of ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"]) {
    assertPreview(buildDecisionOutcomeLinkPreview(savedWorkflow(type, "some pasted input")));
  }
});

test("always includes all 5 decision candidates", () => {
  const p = buildDecisionOutcomeLinkPreview(savedWorkflow("github_repo", "acme/web-app"));
  assert.equal(p.decisionCandidates.length, 5);
});

test("defaults recommended decision to not_verified when no evidence exists", () => {
  const p = buildDecisionOutcomeLinkPreview({
    title: "Empty",
    sourceSummary: "",
    evidencePlan: {},
    acceptanceMap: {},
    stagePlan: {},
    agentRunPlan: {},
  });
  assert.equal(p.recommendedDecisionCandidate, "not_verified");
  assert.equal(p.confidence, "low");
  assertPreview(p);
});

test("derives fix candidate from fix decision impacts", () => {
  const p = buildDecisionOutcomeLinkPreview({
    title: "Fixy",
    sourceSummary: "x",
    evidencePlan: {
      expectations: [
        { acceptanceItemTitle: "Error recovery works", relatedArea: "error_recovery", relatedStageNumbers: [3], evidenceTypes: ["fix_summary", "commit_link"], status: "needed", decisionImpact: "fix" },
        { acceptanceItemTitle: "Private data is safe", relatedArea: "data_privacy", relatedStageNumbers: [4], evidenceTypes: ["review_note"], status: "needed", decisionImpact: "fix" },
      ],
      missingEvidenceQuestions: ["q1"],
    },
  });
  const fix = p.decisionCandidates.find((c) => c.type === "fix");
  assert.ok(fix.relatedAcceptanceItems.includes("Error recovery works"));
  assert.ok(fix.relatedAcceptanceItems.includes("Private data is safe"));
  // Two fix impacts => recommended switches to fix.
  assert.equal(p.recommendedDecisionCandidate, "fix");
});

test("derives defer recommendation from defer impacts", () => {
  const p = buildDecisionOutcomeLinkPreview({
    title: "Defer",
    sourceSummary: "x",
    evidencePlan: {
      expectations: [
        { acceptanceItemTitle: "Release readiness", relatedArea: "release_readiness", relatedStageNumbers: [5], evidenceTypes: ["release_decision_note"], status: "needs_decision", decisionImpact: "defer" },
        { acceptanceItemTitle: "Decision history", relatedArea: "decision_history", relatedStageNumbers: [6], evidenceTypes: ["review_note"], status: "needs_decision", decisionImpact: "defer" },
      ],
    },
  });
  assert.equal(p.recommendedDecisionCandidate, "defer");
});

test("derives scorecard signals", () => {
  const p = buildDecisionOutcomeLinkPreview(savedWorkflow("github_repo", "acme/billing-api"));
  const s = p.outcomeScorecardSignals;
  assert.ok(LEVELS.includes(s.evidenceCompleteness));
  assert.ok(LEVELS.includes(s.acceptanceCoverage));
  assert.ok(LEVELS.includes(s.unresolvedRisk));
  assert.ok(LEVELS.includes(s.releaseReadiness));
});

test("includes future outcome links and notIncludedYet disclaimers", () => {
  const p = buildDecisionOutcomeLinkPreview(savedWorkflow("idea", "x"));
  assert.match(p.futureOutcomeLinks.join(" "), /outcome decision/i);
  assert.match(p.futureOutcomeLinks.join(" "), /action pack/i);
  const joined = p.notIncludedYet.join(" ");
  assert.match(joined, /No final decision is saved/);
  assert.match(joined, /No outcome scorecard is created/);
});

test("handles malformed snapshots without throwing", () => {
  const bad = [null, undefined, 7, "x", { expectations: "no" }, { expectations: [null, 1, {}] }];
  for (const m of bad) {
    assert.doesNotThrow(() =>
      buildDecisionOutcomeLinkPreview({
        title: "M",
        sourceSummary: "",
        evidencePlan: m,
        acceptanceMap: m,
        stagePlan: m,
        agentRunPlan: m,
        benchmarkHandoffPreview: m,
      }),
    );
  }
});

test("deterministic output for identical input", () => {
  const a = buildDecisionOutcomeLinkPreview(savedWorkflow("prd", "Overview: x. User can submit."));
  const b = buildDecisionOutcomeLinkPreview(savedWorkflow("prd", "Overview: x. User can submit."));
  assert.deepEqual(a, b);
});

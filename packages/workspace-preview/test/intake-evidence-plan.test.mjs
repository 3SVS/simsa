// Stage 111 — Evidence Plan tests. Pure/deterministic; no collection/backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntakeEvidencePlan,
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_TYPE_LABELS,
} from "../src/intake-evidence-plan.mjs";
import { WORKSPACE_INTAKE_TYPES } from "../src/intake.mjs";

const FORBIDDEN = ["verified", "passed", "complete", "completed", "production_ready", "accepted"];

function assertPlan(plan) {
  assert.ok(plan.title.length > 0);
  assert.ok(plan.summary.length > 0);
  assert.ok(plan.expectations.length >= 4 && plan.expectations.length <= 8, `exp=${plan.expectations.length}`);
  assert.equal(plan.overallEvidenceStatus, "not_verified");
  assert.ok(!FORBIDDEN.includes(plan.overallEvidenceStatus));
  assert.ok(plan.missingEvidenceQuestions.length >= 3 && plan.missingEvidenceQuestions.length <= 6);
  assert.ok(["low", "medium", "high"].includes(plan.confidence));
  const ids = new Set();
  for (const e of plan.expectations) {
    assert.ok(e.id && !ids.has(e.id));
    ids.add(e.id);
    assert.ok(e.acceptanceItemTitle.length > 0);
    assert.ok(e.relatedArea.length > 0);
    assert.ok(Array.isArray(e.relatedStageNumbers));
    assert.ok(Array.isArray(e.relatedTaskIds));
    assert.ok(e.evidenceTypes.length >= 1);
    for (const et of e.evidenceTypes) assert.ok(EVIDENCE_TYPE_LABELS[et], `bad type ${et}`);
    assert.ok(EVIDENCE_STATUS_LABELS[e.status], `bad status ${e.status}`);
    assert.ok(!FORBIDDEN.includes(e.status));
    assert.ok(["accept", "fix", "rerun", "defer", "not_verified"].includes(e.decisionImpact));
    assert.ok(e.whyNeeded.length > 0);
  }
}

test("builds an evidence plan for every intake type (4-8 expectations)", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const plan = buildIntakeEvidencePlan({ type, rawInput: "some pasted input here" });
    assert.equal(plan.intakeType, type);
    assertPlan(plan);
  }
});

test("4-8 expectations even with empty input", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    assertPlan(buildIntakeEvidencePlan({ type, rawInput: "" }));
  }
});

test("expectations link acceptance item + stages + tasks", () => {
  const plan = buildIntakeEvidencePlan({ type: "github_repo", rawInput: "acme/web-app" });
  // at least one expectation references stage numbers and task ids
  assert.ok(plan.expectations.some((e) => e.relatedStageNumbers.length >= 1));
  assert.ok(plan.expectations.some((e) => e.relatedTaskIds.some((id) => /^task-\d+$/.test(id))));
});

test("github_repo maps implementation_readiness to build/test/commit evidence", () => {
  const plan = buildIntakeEvidencePlan({ type: "github_repo", rawInput: "acme/billing-api" });
  const impl = plan.expectations.find((e) => e.relatedArea === "implementation_readiness");
  assert.ok(impl, "expected an implementation_readiness expectation");
  assert.ok(impl.evidenceTypes.some((t) => ["build_result", "test_result", "commit_link"].includes(t)));
});

test("ai_built_app fix-stage tasks contribute commit/fix evidence via claude_code", () => {
  const plan = buildIntakeEvidencePlan({
    type: "ai_built_app",
    rawInput: "AI-built dashboard with login and sharing.",
  });
  // some expectation should pull in claude_code tool evidence (commit_link/fix_summary)
  assert.ok(
    plan.expectations.some((e) =>
      e.evidenceTypes.some((t) => ["commit_link", "fix_summary"].includes(t)),
    ),
  );
});

test("product_url maps to screenshot/walkthrough/review evidence", () => {
  const plan = buildIntakeEvidencePlan({ type: "product_url", rawInput: "https://trysimsa.com/demo" });
  assert.ok(
    plan.expectations.some((e) =>
      e.evidenceTypes.some((t) => ["screenshot", "walkthrough", "review_note"].includes(t)),
    ),
  );
});

test("context-specific missing-evidence question per type", () => {
  assert.ok(buildIntakeEvidencePlan({ type: "github_repo", rawInput: "a/b" }).missingEvidenceQuestions.some((q) => /build\/test result/.test(q)));
  assert.ok(buildIntakeEvidencePlan({ type: "pull_request", rawInput: "x" }).missingEvidenceQuestions.some((q) => /PR or commit link/.test(q)));
});

test("no forbidden verified/passed status; deterministic; no throw on empty", () => {
  assert.doesNotThrow(() => buildIntakeEvidencePlan({ type: "idea", rawInput: "" }));
  assert.throws(() => buildIntakeEvidencePlan({ type: "bogus", rawInput: "x" }));
  assert.deepEqual(
    buildIntakeEvidencePlan({ type: "prd", rawInput: "Overview: x. User can submit." }),
    buildIntakeEvidencePlan({ type: "prd", rawInput: "Overview: x. User can submit." }),
  );
});

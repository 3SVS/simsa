// Stage 106 — shared Acceptance Map tests. Pure/deterministic; no backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntakeAcceptanceMap,
  NEXT_STEP_LABELS,
} from "../src/intake-acceptance-map.mjs";
import { WORKSPACE_INTAKE_TYPES } from "../src/intake.mjs";

const NEXT_STEPS = new Set(Object.keys(NEXT_STEP_LABELS));

function assertShape(map) {
  assert.ok(map.title.length > 0);
  assert.ok(map.summary.length > 0);
  assert.ok(map.areas.length >= 1);
  assert.ok(map.items.length >= 5 && map.items.length <= 10, `items=${map.items.length}`);
  for (const it of map.items) {
    assert.ok(it.title.length > 0);
    assert.ok(["candidate", "missing_detail", "needs_verification"].includes(it.status));
    assert.ok(it.area.length > 0);
  }
  assert.ok(map.missingQuestions.length >= 1 && map.missingQuestions.length <= 6);
  assert.ok(NEXT_STEPS.has(map.recommendedNextStep));
  assert.ok(["low", "medium", "high"].includes(map.confidence));
}

test("builds a valid map for every intake type", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const map = buildIntakeAcceptanceMap({ type, rawInput: "some pasted input here" });
    assert.equal(map.intakeType, type);
    assertShape(map);
  }
});

test("idea → clarify_product_intent", () => {
  const map = buildIntakeAcceptanceMap({ type: "idea", rawInput: "a small idea" });
  assert.equal(map.recommendedNextStep, "clarify_product_intent");
});

test("prd map uses PRD acceptance items", () => {
  const map = buildIntakeAcceptanceMap({
    type: "prd",
    rawInput: "Overview: a tool. Users: founder. User can submit a request.",
  });
  assert.ok(map.items.some((i) => /without errors|first use|recoverable|release/i.test(i.title)));
  assert.ok(["draft_acceptance_items", "clarify_product_intent"].includes(map.recommendedNextStep));
});

test("product_url demo → verify_release_readiness", () => {
  const map = buildIntakeAcceptanceMap({ type: "product_url", rawInput: "https://trysimsa.com/demo" });
  assert.equal(map.recommendedNextStep, "verify_release_readiness");
  assert.ok(map.areas.includes("trust_and_proof"));
});

test("github_repo app → review_core_flow; library → create_stage_plan", () => {
  assert.equal(
    buildIntakeAcceptanceMap({ type: "github_repo", rawInput: "acme/web-app" }).recommendedNextStep,
    "review_core_flow",
  );
  assert.equal(
    buildIntakeAcceptanceMap({ type: "github_repo", rawInput: "acme/js-sdk" }).recommendedNextStep,
    "create_stage_plan",
  );
});

test("ai_built_app maps recovery action to a next step", () => {
  const broken = buildIntakeAcceptanceMap({
    type: "ai_built_app",
    rawInput: "It has bugs and broken flows with errors everywhere.",
  });
  assert.equal(broken.recommendedNextStep, "create_stage_plan");
  const launch = buildIntakeAcceptanceMap({
    type: "ai_built_app",
    rawInput: "Looks usable, want to share with early users and launch.",
  });
  assert.equal(launch.recommendedNextStep, "verify_release_readiness");
});

test("pull_request generic fallback + PR question", () => {
  const map = buildIntakeAcceptanceMap({
    type: "pull_request",
    rawInput: "https://github.com/acme/widget/pull/12",
  });
  assert.equal(map.recommendedNextStep, "review_core_flow");
  assert.ok(map.missingQuestions.some((q) => /this PR prove/.test(q)));
  assert.ok(map.areas.includes("decision_history"));
});

test("always 5–10 items even with empty input", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const map = buildIntakeAcceptanceMap({ type, rawInput: "" });
    assert.ok(map.items.length >= 5 && map.items.length <= 10);
  }
});

test("does not throw for empty input; throws for unknown type", () => {
  assert.doesNotThrow(() => buildIntakeAcceptanceMap({ type: "idea", rawInput: "" }));
  assert.throws(() => buildIntakeAcceptanceMap({ type: "bogus", rawInput: "x" }));
});

test("deterministic", () => {
  const a = buildIntakeAcceptanceMap({ type: "prd", rawInput: "Overview: x. User can create." });
  const b = buildIntakeAcceptanceMap({ type: "prd", rawInput: "Overview: x. User can create." });
  assert.deepEqual(a, b);
});

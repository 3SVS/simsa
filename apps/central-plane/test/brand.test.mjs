// Stage 84: central-plane BRAND constants and how they flow into canonical
// user-visible text. A future rename should update BRAND in one place; tests
// here guard against drift between BRAND and the canonical pack heading.
import { test } from "node:test";
import assert from "node:assert/strict";

const { BRAND } = await import("../dist/workspace/brand.js");
const {
  DEFAULT_EVOLUTION_STRINGS,
  buildEvolutionActionPack,
  buildEvolutionActionPackText,
} = await import("../dist/workspace/evolution-action-pack.js");

test("BRAND exports the spec keys with stable values", () => {
  assert.equal(BRAND.productName, "Conclave");
  assert.equal(BRAND.productShortName, "Conclave");
  assert.equal(BRAND.actionPackHeading, "Conclave Evolution Action Pack");
});

test("DEFAULT_EVOLUTION_STRINGS.packHeading is sourced from BRAND.actionPackHeading", () => {
  // The constant lookup is what guarantees a future BRAND change reaches saved
  // packs without a follow-up edit to evolution-action-pack.ts.
  assert.equal(DEFAULT_EVOLUTION_STRINGS.packHeading, BRAND.actionPackHeading);
});

test("buildEvolutionActionPackText still starts with the Conclave-era heading", () => {
  // Stage 77 contract: server-saved packs are canonical English; their
  // markdown begins with the BRAND-driven heading. Until a deliberate rebrand,
  // the value MUST remain "Conclave Evolution Action Pack".
  const scorecard = {
    experimentId: "wexp_t",
    projectId: "proj_t",
    decisionStatus: "undecided",
    quality: {
      acceptancePassRate: null,
      unresolvedBlockerCount: 0,
      criticalIssueCount: 0,
      notVerifiedCount: 0,
      needsDecisionCount: 0,
      evidenceCoverageRate: null,
      score: 0,
      grade: "inconclusive",
    },
    signals: {
      hasBenchmark: false, hasDecision: false, hasSelectedCandidate: false, hasItemLevelEvidence: false,
    },
    nextEvolution: { recommendedAction: "create_benchmark", reasons: [], suggestedFocusItemIds: [] },
  };
  const pack = buildEvolutionActionPack(
    { projectId: "proj_t", experiment: { id: "wexp_t", title: "T" }, scorecard },
    DEFAULT_EVOLUTION_STRINGS,
  );
  const text = buildEvolutionActionPackText(pack, DEFAULT_EVOLUTION_STRINGS);
  assert.match(text, /^# Conclave Evolution Action Pack/);
});

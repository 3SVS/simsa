import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  WIZARD_STEP_IDS,
  clampStep,
  buildStepper,
  stepperPercent,
  rotatingWaitLine,
} from "../src/lib/wizard-steps.mjs";

describe("wizard-steps", () => {
  it("has 4 canonical steps", () => {
    assert.deepEqual(WIZARD_STEP_IDS, ["idea", "understand", "questions", "done"]);
  });

  it("clamps step into range", () => {
    assert.equal(clampStep(0), 1);
    assert.equal(clampStep(1), 1);
    assert.equal(clampStep(4), 4);
    assert.equal(clampStep(99), 4);
  });

  it("marks done / current / upcoming correctly", () => {
    const steps = buildStepper(2, ["Idea", "Understand", "Questions", "Done"]);
    assert.equal(steps.length, 4);
    assert.equal(steps[0].state, "done");
    assert.equal(steps[1].state, "current");
    assert.equal(steps[1].isCurrent, true);
    assert.equal(steps[2].state, "upcoming");
    assert.equal(steps[3].state, "upcoming");
    assert.equal(steps[0].label, "Idea");
  });

  it("falls back to step id when a label is missing", () => {
    const steps = buildStepper(1);
    assert.equal(steps[0].label, "idea");
    assert.equal(steps[3].label, "done");
  });

  it("percent tracks step progression", () => {
    assert.equal(stepperPercent(1), 25);
    assert.equal(stepperPercent(2), 50);
    assert.equal(stepperPercent(4), 100);
    assert.equal(stepperPercent(99), 100);
  });

  it("rotating wait line cycles through phrases", () => {
    const phrases = ["a", "b", "c"];
    assert.equal(rotatingWaitLine(phrases, 0), "a");
    assert.equal(rotatingWaitLine(phrases, 1), "b");
    assert.equal(rotatingWaitLine(phrases, 3), "a");
    assert.equal(rotatingWaitLine([], 2), "");
    assert.equal(rotatingWaitLine(null, 2), "");
  });
});

// Stage 161 — SimsaSealThinking render-config tests (pure, node --test).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSealThinking,
  getDefaultSealThinkingSteps,
  SEAL_THINKING_VARIANTS,
  DEFAULT_SEAL_LABEL,
} from "../src/lib/seal-thinking.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

describe("resolveSealThinking", () => {
  it("defaults to the compact variant with 3 dots and the default label", () => {
    const c = resolveSealThinking();
    assert.equal(c.variant, "compact");
    assert.equal(c.dotCount, 3);
    assert.equal(c.dots.length, 3);
    assert.equal(c.label, DEFAULT_SEAL_LABEL);
    assert.equal(c.showVisibleLabel, false);
  });

  it("panel variant has 5 dots and shows the visible label", () => {
    const c = resolveSealThinking({ variant: "panel" });
    assert.equal(c.variant, "panel");
    assert.equal(c.dotCount, 5);
    assert.equal(c.dots.length, 5);
    assert.equal(c.showVisibleLabel, true);
  });

  it("uses a custom label when provided", () => {
    const c = resolveSealThinking({ variant: "panel", label: "Mapping acceptance criteria…" });
    assert.equal(c.label, "Mapping acceptance criteria…");
  });

  it("uses the first stepLabel as the current label (cycling deferred)", () => {
    const c = resolveSealThinking({ stepLabels: ["Building stage plan…", "Planning evidence…"] });
    assert.equal(c.label, "Building stage plan…");
  });

  it("falls back to the default label for empty/whitespace input", () => {
    assert.equal(resolveSealThinking({ label: "   " }).label, DEFAULT_SEAL_LABEL);
    assert.equal(resolveSealThinking({ stepLabels: ["  ", ""] }).label, DEFAULT_SEAL_LABEL);
  });

  it("coerces an unknown variant to compact", () => {
    assert.equal(resolveSealThinking({ variant: "bogus" }).variant, "compact");
    assert.deepEqual(SEAL_THINKING_VARIANTS, ["compact", "panel"]);
  });

  it("always exposes accessible status semantics", () => {
    const c = resolveSealThinking({ variant: "panel" });
    assert.deepEqual(c.a11y, { role: "status", ariaLive: "polite", ariaBusy: true });
  });

  it("assigns sequential dot animation delays", () => {
    const delays = resolveSealThinking({ variant: "panel" }).dots.map((d) => d.delayMs);
    assert.deepEqual(delays, [0, 200, 400, 600, 800]);
  });

  it("explicit label overrides stepLabels", () => {
    const c = resolveSealThinking({ label: "Custom…", stepLabels: ["Mapping acceptance criteria…"] });
    assert.equal(c.label, "Custom…");
  });

  it("never throws on malformed input", () => {
    for (const bad of [null, undefined, 7, "x", [], { variant: 1, label: 2, stepLabels: 3 }]) {
      assert.doesNotThrow(() => resolveSealThinking(bad));
    }
  });
});

describe("getDefaultSealThinkingSteps", () => {
  it("returns the ordered EN step labels from the loading dictionary", () => {
    const steps = getDefaultSealThinkingSteps(getDictionary("en").loading);
    assert.deepEqual(steps, [
      "Mapping acceptance criteria…",
      "Building stage plan…",
      "Planning evidence…",
      "Checking handoff safety…",
      "Preparing preview…",
      "Finalizing review…",
    ]);
  });

  it("returns the ordered KO step labels from the loading dictionary", () => {
    const steps = getDefaultSealThinkingSteps(getDictionary("ko").loading);
    assert.equal(steps.length, 6);
    assert.equal(steps[0], "수용 기준을 매핑하는 중…");
    assert.equal(steps[5], "리뷰를 마무리하는 중…");
  });

  it("filters missing/blank labels and never throws on malformed input", () => {
    assert.deepEqual(getDefaultSealThinkingSteps({ mappingAcceptance: "A", buildingStagePlan: "  " }), ["A"]);
    for (const bad of [null, undefined, 7, "x", []]) {
      assert.doesNotThrow(() => getDefaultSealThinkingSteps(bad));
      assert.deepEqual(getDefaultSealThinkingSteps(bad), []);
    }
  });

  it("feeds cleanly into resolveSealThinking as stepLabels (first label shown)", () => {
    const steps = getDefaultSealThinkingSteps(getDictionary("en").loading);
    const c = resolveSealThinking({ variant: "panel", stepLabels: steps });
    assert.equal(c.label, "Mapping acceptance criteria…");
  });
});

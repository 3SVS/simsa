import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUBRIC_VERSION,
  BASELINE_UX_RUBRIC,
  RubricItemSchema,
  RawSignalSchema,
  RubricFindingSchema,
  requiresInteraction,
  isStaticDetector,
  getRunnableRules,
  getGatingRules,
  getRuleById,
  classifySignals,
  assertRubricInvariants,
  DOGFOOD_SIGNALS,
  CLEAN_SIGNALS,
} from "../dist/index.js";
// Also exercise the dedicated subpath so the exports map stays wired.
import { BASELINE_UX_RUBRIC as VIA_SUBPATH } from "../dist/ux-rubric/index.js";

test("rubric parses at load and pins the version", () => {
  assert.equal(BASELINE_UX_RUBRIC.version, RUBRIC_VERSION);
  assert.ok(Array.isArray(BASELINE_UX_RUBRIC.items));
  assert.ok(BASELINE_UX_RUBRIC.items.length > 0);
});

test("subpath export resolves to the same rubric", () => {
  assert.equal(VIA_SUBPATH.version, BASELINE_UX_RUBRIC.version);
  assert.equal(VIA_SUBPATH.items.length, BASELINE_UX_RUBRIC.items.length);
});

test("every rule id is unique", () => {
  const ids = BASELINE_UX_RUBRIC.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("layer↔detector invariants hold for every item", () => {
  // assertRubricInvariants runs at load; re-running must not throw.
  assert.doesNotThrow(() => assertRubricInvariants(BASELINE_UX_RUBRIC));
  for (const item of BASELINE_UX_RUBRIC.items) {
    if (item.layer === 1) assert.ok(["axe", "link-crawl", "cwv"].includes(item.detector));
    if (item.layer === 2) assert.ok(["dom-inspect", "interaction"].includes(item.detector));
    if (item.layer === 3) assert.equal(item.detector, "manual");
  }
});

test("assertRubricInvariants rejects a bad layer/detector pairing", () => {
  const bad = {
    version: 1,
    items: [
      {
        id: "X-bad",
        layer: 1,
        rule: "r",
        severity: "minor",
        detector: "interaction", // interaction is not valid for layer 1
        status: "active",
        version: 1,
        reference: "test",
        remediation: "test",
      },
    ],
  };
  assert.throws(() => assertRubricInvariants(bad), /invalid for layer 1/);
});

test("assertRubricInvariants rejects duplicate ids", () => {
  const one = BASELINE_UX_RUBRIC.items[0];
  assert.throws(
    () => assertRubricInvariants({ version: 1, items: [one, one] }),
    /duplicate rule id/,
  );
});

test("three layers: L1 and L2 populated, L3 empty but schema-ready", () => {
  const byLayer = (n) => BASELINE_UX_RUBRIC.items.filter((i) => i.layer === n);
  assert.ok(byLayer(1).length >= 1);
  assert.ok(byLayer(2).length >= 1);
  assert.equal(byLayer(3).length, 0);
  // schema still accepts a layer-3 item (proves L3 is ready, not blocked)
  assert.doesNotThrow(() =>
    RubricItemSchema.parse({
      id: "L3-example",
      layer: 3,
      rule: "domain rule",
      severity: "minor",
      detector: "manual",
      status: "shadow",
      version: 1,
      reference: "internal",
      remediation: "review manually",
    }),
  );
});

test("L2 has exactly 4 rules split 2 dom-inspect + 2 interaction (accepted assessment)", () => {
  const l2 = BASELINE_UX_RUBRIC.items.filter((i) => i.layer === 2);
  assert.equal(l2.length, 4);
  assert.equal(l2.filter((i) => i.detector === "dom-inspect").length, 2);
  assert.equal(l2.filter((i) => i.detector === "interaction").length, 2);
  // interaction rules ship in shadow (calibrate FP before gating — §8)
  for (const i of l2.filter((x) => x.detector === "interaction")) {
    assert.equal(i.status, "shadow");
  }
});

test("requiresInteraction / isStaticDetector classify detectors correctly", () => {
  assert.equal(requiresInteraction("interaction"), true);
  assert.equal(requiresInteraction("dom-inspect"), false);
  assert.equal(isStaticDetector("axe"), true);
  assert.equal(isStaticDetector("dom-inspect"), true);
  assert.equal(isStaticDetector("interaction"), false);
  assert.equal(isStaticDetector("manual"), false);
});

test("getRunnableRules gates interaction rules on capability, never runs manual", () => {
  const staticOnly = getRunnableRules(BASELINE_UX_RUBRIC, { canInteract: false });
  assert.ok(staticOnly.every((i) => i.detector !== "interaction" && i.detector !== "manual"));

  const withInteraction = getRunnableRules(BASELINE_UX_RUBRIC, { canInteract: true });
  assert.ok(withInteraction.some((i) => i.detector === "interaction"));
  assert.ok(withInteraction.every((i) => i.detector !== "manual"));
  assert.ok(withInteraction.length > staticOnly.length);
});

test("getGatingRules excludes shadow rules", () => {
  const gating = getGatingRules(BASELINE_UX_RUBRIC);
  assert.ok(gating.every((i) => i.status === "active"));
  assert.ok(gating.length < BASELINE_UX_RUBRIC.items.length); // some are shadow
});

test("getRuleById finds and misses", () => {
  assert.ok(getRuleById(BASELINE_UX_RUBRIC, "L2-silent-failure"));
  assert.equal(getRuleById(BASELINE_UX_RUBRIC, "nope"), undefined);
});

// ── §8 dogfood acceptance scaffold ────────────────────────────────────────────

test("§8 dogfood: 4 known-bad signals classify 4/4", () => {
  const { findings, unknown } = classifySignals(DOGFOOD_SIGNALS, BASELINE_UX_RUBRIC);
  assert.equal(findings.length, 4);
  assert.equal(unknown.length, 0);
  // every fixture ruleId is a real, static (runnable-now) rule
  for (const f of findings) {
    const rule = getRuleById(BASELINE_UX_RUBRIC, f.ruleId);
    assert.ok(rule);
    assert.ok(isStaticDetector(rule.detector));
    assert.equal(f.severity, rule.severity);
    assert.equal(f.layer, rule.layer);
  }
  const parsed = RubricFindingSchema.array().parse(findings);
  assert.equal(parsed.length, 4);
});

test("§8 false-positive floor: a clean surface yields zero findings", () => {
  const { findings, unknown } = classifySignals(CLEAN_SIGNALS, BASELINE_UX_RUBRIC);
  assert.equal(findings.length, 0);
  assert.equal(unknown.length, 0);
});

test("classifySignals never invents: unknown ruleId goes to unknown[], not findings", () => {
  const { findings, unknown } = classifySignals(
    [{ ruleId: "L1-a11y-lang", evidence: "no lang attr" }, { ruleId: "made-up", evidence: "x" }],
    BASELINE_UX_RUBRIC,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "L1-a11y-lang");
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].ruleId, "made-up");
});

test("RawSignal schema is strict (rejects extra keys)", () => {
  assert.throws(() =>
    RawSignalSchema.parse({ ruleId: "x", evidence: "y", bogus: true }),
  );
});

test("RubricItemSchema rejects invalid detector/severity", () => {
  const base = {
    id: "x",
    layer: 1,
    rule: "r",
    severity: "major",
    detector: "axe",
    status: "active",
    version: 1,
    reference: "ref",
    remediation: "fix",
  };
  assert.doesNotThrow(() => RubricItemSchema.parse(base));
  assert.throws(() => RubricItemSchema.parse({ ...base, detector: "nope" }));
  assert.throws(() => RubricItemSchema.parse({ ...base, severity: "critical" }));
});

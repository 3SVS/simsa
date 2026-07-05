/**
 * Baseline UX QA — the rubric itself plus pure grading helpers (PR1, §2/§4/§8).
 *
 * The rubric is versioned data, parsed and invariant-checked at module load so a
 * malformed edit fails the build/test rather than shipping. Detectors live in a
 * later PR; everything here is deterministic and browser-free.
 */
import {
  RubricSchema,
  RawSignalSchema,
  type Rubric,
  type RubricItem,
  type RubricDetector,
  type RawSignal,
  type RubricFinding,
} from "./schema.js";

/** Bumped whenever the set of rules changes. Consumers can pin/compare on this. */
export const RUBRIC_VERSION = 1;

/**
 * Layer 1 — mechanical. Automated tools on a statically loaded page. These run
 * today (no interaction) and gate.
 */
const LAYER_1: RubricItem[] = [
  {
    id: "L1-a11y-button-name",
    layer: 1,
    rule: "Every interactive control exposes an accessible name.",
    severity: "blocker",
    detector: "axe",
    status: "active",
    version: 1,
    reference: "WCAG 4.1.2 Name, Role, Value",
    remediation: "Give the control visible text, aria-label, or aria-labelledby.",
  },
  {
    id: "L1-a11y-color-contrast",
    layer: 1,
    rule: "Text and interactive elements meet a 4.5:1 (3:1 for large text) contrast ratio.",
    severity: "major",
    detector: "axe",
    status: "active",
    version: 1,
    reference: "WCAG 1.4.3 Contrast (Minimum)",
    remediation: "Adjust foreground/background colors to meet the ratio.",
  },
  {
    id: "L1-a11y-image-alt",
    layer: 1,
    rule: "Every meaningful image has a text alternative.",
    severity: "major",
    detector: "axe",
    status: "active",
    version: 1,
    reference: "WCAG 1.1.1 Non-text Content",
    remediation: 'Add alt text; mark decorative images with alt="".',
  },
  {
    id: "L1-a11y-form-label",
    layer: 1,
    rule: "Every form input has a programmatically associated label.",
    severity: "major",
    detector: "axe",
    status: "active",
    version: 1,
    reference: "WCAG 3.3.2 Labels or Instructions",
    remediation: "Associate a <label for> or aria-label with the input.",
  },
  {
    id: "L1-a11y-lang",
    layer: 1,
    rule: "The document declares its language.",
    severity: "minor",
    detector: "axe",
    status: "active",
    version: 1,
    reference: "WCAG 3.1.1 Language of Page",
    remediation: "Set the <html lang> attribute.",
  },
  {
    id: "L1-link-broken",
    layer: 1,
    rule: "No navigation link or CTA resolves to a 4xx/5xx or empty target.",
    severity: "major",
    detector: "link-crawl",
    status: "active",
    version: 1,
    reference: "Internal policy: no dead ends",
    remediation: "Fix or remove the broken destination.",
  },
  {
    id: "L1-cwv-lcp",
    layer: 1,
    rule: "Largest Contentful Paint is under 2.5s on a mid-tier connection.",
    severity: "minor",
    detector: "cwv",
    status: "active",
    version: 1,
    reference: "Core Web Vitals: LCP",
    remediation: "Optimize the largest above-the-fold asset.",
  },
  {
    id: "L1-cwv-cls",
    layer: 1,
    rule: "Cumulative Layout Shift stays under 0.1.",
    severity: "minor",
    detector: "cwv",
    status: "active",
    version: 1,
    reference: "Core Web Vitals: CLS",
    remediation: "Reserve space for async and media content.",
  },
];

/**
 * Layer 2 — heuristic. Four high-signal usability rules, split by detector per
 * the accepted assessment: two are statically DOM-inspectable and gate today;
 * two need the INSPECTOR to click/type and ship in shadow (calibrate the
 * false-positive rate before promoting them to gating — §8).
 */
const LAYER_2: RubricItem[] = [
  {
    id: "L2-escape-hatch",
    layer: 2,
    rule: "Every non-entry view exposes a visible way back, close, or home.",
    severity: "major",
    detector: "dom-inspect",
    status: "active",
    version: 1,
    reference: "Nielsen #3 User control and freedom",
    remediation: "Add a persistent back / close / home affordance.",
  },
  {
    id: "L2-silent-failure",
    layer: 2,
    rule: "A result surface never presents placeholder, mock, or example content as a real result while a degraded or error flag is set.",
    severity: "blocker",
    detector: "dom-inspect",
    status: "active",
    version: 1,
    reference: "Internal policy: honest failures (2026-07-05 mock-draft incident)",
    remediation: "Render an explicit error with a retry path instead of a success-shaped placeholder.",
  },
  {
    id: "L2-dead-button",
    layer: 2,
    rule: "Activating a primary action produces an observable state change or explicit feedback.",
    severity: "blocker",
    detector: "interaction",
    status: "shadow",
    version: 1,
    reference: "Nielsen #1 Visibility of system status",
    remediation: "Wire the handler, or disable / relabel the control until it is functional.",
  },
  {
    id: "L2-enter-noop",
    layer: 2,
    rule: "A primary text input submits on Enter or clearly shows how to submit.",
    severity: "major",
    detector: "interaction",
    status: "shadow",
    version: 1,
    reference: "Nielsen #7 Flexibility and efficiency of use",
    remediation: "Handle the Enter key, or surface the submit control next to the field.",
  },
];

/**
 * Layer 3 — domain overlay. Intentionally empty for now; the schema accepts
 * layer-3 items so a later PR can add product-specific rules without a shape
 * change.
 */
const LAYER_3: RubricItem[] = [];

/**
 * The baseline rubric. Parsed at load so a malformed edit fails immediately, and
 * invariant-checked (layer↔detector consistency, unique ids) beyond what Zod can
 * express on its own.
 */
export const BASELINE_UX_RUBRIC: Rubric = assertRubricInvariants(
  RubricSchema.parse({
    version: RUBRIC_VERSION,
    items: [...LAYER_1, ...LAYER_2, ...LAYER_3],
  }),
);

/** Detectors that run on a static page load — no INSPECTOR interaction needed. */
const STATIC_DETECTORS: readonly RubricDetector[] = ["axe", "link-crawl", "cwv", "dom-inspect"];

/** True when a rule can only be evaluated by clicking/typing (not yet shippable). */
export function requiresInteraction(detector: RubricDetector): boolean {
  return detector === "interaction";
}

/** True when a rule runs on a static page load. */
export function isStaticDetector(detector: RubricDetector): boolean {
  return STATIC_DETECTORS.includes(detector);
}

export interface RunnableCapabilities {
  /** Whether the runner can click and type (INSPECTOR interaction). */
  canInteract: boolean;
}

/**
 * The subset of rules a runner with the given capabilities can actually evaluate.
 * Static rules always qualify; interaction rules only when `canInteract`; manual
 * (layer-3) rules never run automatically.
 */
export function getRunnableRules(rubric: Rubric, caps: RunnableCapabilities): RubricItem[] {
  return rubric.items.filter((item) => {
    if (item.detector === "manual") return false;
    if (requiresInteraction(item.detector)) return caps.canInteract;
    return true;
  });
}

/** Rules that gate (status "active"). Shadow rules are reported but never block. */
export function getGatingRules(rubric: Rubric): RubricItem[] {
  return rubric.items.filter((item) => item.status === "active");
}

export function getRuleById(rubric: Rubric, id: string): RubricItem | undefined {
  return rubric.items.find((item) => item.id === id);
}

export interface ClassifyResult {
  /** Signals whose ruleId matched a known rule, enriched with grading metadata. */
  findings: RubricFinding[];
  /** Signals whose ruleId is not in the rubric — never invented into a finding. */
  unknown: RawSignal[];
}

/**
 * Classify detector signals against the rubric. Pure and total:
 *   - a known ruleId becomes an enriched finding,
 *   - an unknown ruleId is collected separately (never dropped, never invented),
 *   - empty input yields empty output (the false-positive floor — §8).
 * Each signal is Zod-validated at the boundary before use.
 */
export function classifySignals(signals: readonly RawSignal[], rubric: Rubric): ClassifyResult {
  const findings: RubricFinding[] = [];
  const unknown: RawSignal[] = [];
  for (const raw of signals) {
    const signal = RawSignalSchema.parse(raw);
    const rule = getRuleById(rubric, signal.ruleId);
    if (!rule) {
      unknown.push(signal);
      continue;
    }
    findings.push({
      ruleId: rule.id,
      layer: rule.layer,
      severity: rule.severity,
      status: rule.status,
      rule: rule.rule,
      evidence: signal.evidence,
      ...(signal.url === undefined ? {} : { url: signal.url }),
      ...(signal.selector === undefined ? {} : { selector: signal.selector }),
    });
  }
  return { findings, unknown };
}

/**
 * Enforce invariants Zod can't express on its own, then return the rubric so this
 * can wrap the parse expression. Throws on any violation.
 */
export function assertRubricInvariants(rubric: Rubric): Rubric {
  const seen = new Set<string>();
  for (const item of rubric.items) {
    if (seen.has(item.id)) {
      throw new Error(`ux-rubric: duplicate rule id "${item.id}"`);
    }
    seen.add(item.id);

    const detectorOk =
      (item.layer === 1 && (item.detector === "axe" || item.detector === "link-crawl" || item.detector === "cwv")) ||
      (item.layer === 2 && (item.detector === "dom-inspect" || item.detector === "interaction")) ||
      (item.layer === 3 && item.detector === "manual");
    if (!detectorOk) {
      throw new Error(
        `ux-rubric: rule "${item.id}" has detector "${item.detector}" that is invalid for layer ${item.layer}`,
      );
    }
  }
  return rubric;
}

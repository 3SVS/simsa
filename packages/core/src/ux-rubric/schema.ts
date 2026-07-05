/**
 * Baseline UX QA — rubric data contracts (PR1, §2/§4/§8).
 *
 * This is the pure data + Zod layer of the Baseline UX QA system: the versioned,
 * git-tracked rubric a machine QA pass grades a live surface against, plus the
 * signal/finding contracts the detectors (PR2+) emit and are classified into.
 * No browser, no LLM, no network here — only shapes and their validators.
 *
 * Three layers (§2):
 *   1. mechanical — automated tools on a statically loaded page (axe / link-crawl / CWV)
 *   2. heuristic  — a small set of high-signal usability rules. Per the accepted
 *      assessment these split by DETECTOR into statically DOM-inspectable rules
 *      (no interaction) and rules that need the INSPECTOR to click/type.
 *   3. domain     — product-specific overlay. Schema-ready but intentionally empty
 *      for now (filled in a later PR).
 */
import { z } from "zod";

/** 1 = mechanical, 2 = heuristic, 3 = domain overlay. */
export const RubricLayerSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type RubricLayer = z.infer<typeof RubricLayerSchema>;

/**
 * How a rule is detected. This field is what encodes the §4 capability mapping
 * and the accepted L2 split: `dom-inspect` runs on a static load, `interaction`
 * needs the INSPECTOR's click/type (not yet shipped), `manual` is human-only.
 */
export const RubricDetectorSchema = z.enum([
  "axe", //          automated a11y (axe-core)        — L1, static
  "link-crawl", //   dead-link / dead-end crawler     — L1, static
  "cwv", //          Core Web Vitals / Lighthouse     — L1, static
  "dom-inspect", //  static DOM signature, no clicking — L2, static
  "interaction", //  requires click / type            — L2, needs INSPECTOR
  "manual", //       human judgement only             — L3
]);
export type RubricDetector = z.infer<typeof RubricDetectorSchema>;

/** Reuses the council severity vocabulary so a UX finding sorts alongside code blockers. */
export const RubricSeveritySchema = z.enum(["blocker", "major", "minor", "nit"]);
export type RubricSeverity = z.infer<typeof RubricSeveritySchema>;

/**
 * active = counts toward the gate. shadow = detected and reported but never gates
 * — used to calibrate the false-positive rate before a rule is promoted (§8).
 */
export const RubricStatusSchema = z.enum(["active", "shadow"]);
export type RubricStatus = z.infer<typeof RubricStatusSchema>;

export const RubricItemSchema = z
  .object({
    /** Stable slug, e.g. "L2-dead-button". Never reused for a different rule. */
    id: z.string().min(1),
    layer: RubricLayerSchema,
    /** Canonical English statement of the rule. Localization happens downstream. */
    rule: z.string().min(1),
    severity: RubricSeveritySchema,
    detector: RubricDetectorSchema,
    status: RubricStatusSchema,
    /** Bumped when the rule's meaning changes; enables per-rule migration. */
    version: z.number().int().positive(),
    /** Provenance for auditability — a WCAG SC, a Nielsen heuristic, or an internal policy. */
    reference: z.string().min(1),
    /** What a builder does to fix a violation. */
    remediation: z.string().min(1),
  })
  .strict();
export type RubricItem = z.infer<typeof RubricItemSchema>;

export const RubricSchema = z
  .object({
    version: z.number().int().positive(),
    items: z.array(RubricItemSchema),
  })
  .strict();
export type Rubric = z.infer<typeof RubricSchema>;

/**
 * A raw signal is what a detector emits BEFORE it is classified against the
 * rubric. PR1 owns this contract; real detectors (PR2+) produce these and hand
 * them to `classifySignals`. Keeping detection and classification separate is
 * what lets the classifier be pure and unit-testable without a browser.
 */
export const RawSignalSchema = z
  .object({
    ruleId: z.string().min(1),
    evidence: z.string().min(1),
    url: z.string().optional(),
    selector: z.string().optional(),
  })
  .strict();
export type RawSignal = z.infer<typeof RawSignalSchema>;

/** A signal that matched a known rule, enriched with that rule's grading metadata. */
export const RubricFindingSchema = z
  .object({
    ruleId: z.string().min(1),
    layer: RubricLayerSchema,
    severity: RubricSeveritySchema,
    status: RubricStatusSchema,
    rule: z.string().min(1),
    evidence: z.string().min(1),
    url: z.string().optional(),
    selector: z.string().optional(),
  })
  .strict();
export type RubricFinding = z.infer<typeof RubricFindingSchema>;

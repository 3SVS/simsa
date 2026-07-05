/**
 * Baseline UX QA rubric — public surface (@simsa/core/ux-rubric).
 *
 * Pure data + Zod contracts for the machine UX QA pass. Detectors that produce
 * the RawSignals graded here ship in a later PR; this module has no browser, LLM,
 * or network dependency.
 */
export {
  RubricLayerSchema,
  RubricDetectorSchema,
  RubricSeveritySchema,
  RubricStatusSchema,
  RubricItemSchema,
  RubricSchema,
  RawSignalSchema,
  RubricFindingSchema,
} from "./schema.js";
export type {
  RubricLayer,
  RubricDetector,
  RubricSeverity,
  RubricStatus,
  RubricItem,
  Rubric,
  RawSignal,
  RubricFinding,
} from "./schema.js";

export {
  RUBRIC_VERSION,
  BASELINE_UX_RUBRIC,
  requiresInteraction,
  isStaticDetector,
  getRunnableRules,
  getGatingRules,
  getRuleById,
  classifySignals,
  assertRubricInvariants,
} from "./rubric.js";
export type { RunnableCapabilities, ClassifyResult } from "./rubric.js";

export { DOGFOOD_SIGNALS, CLEAN_SIGNALS } from "./fixture.js";

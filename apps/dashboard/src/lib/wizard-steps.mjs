/**
 * New-project wizard stepper helpers (pure, deterministic).
 *
 * The wizard's thin top progress bar becomes a labelled stepper
 * ("1 Idea → 2 Understand → 3 Questions → 4 Done"). The step model + per-step
 * state (done / current / upcoming) is computed here so it is testable under
 * Node 20 CI. Labels are injected by the caller (localised), never invented here.
 */

/** Canonical ordered step ids for the new-project wizard. */
export const WIZARD_STEP_IDS = ["idea", "understand", "questions", "done"];

/** Clamp an arbitrary 1-based step number into range. */
export function clampStep(step, count = WIZARD_STEP_IDS.length) {
  const n = Number(step) | 0;
  if (n < 1) return 1;
  if (n > count) return count;
  return n;
}

/**
 * Build the stepper model. `current` is 1-based. `labels` is an ordered array of
 * display strings (same length as WIZARD_STEP_IDS); when omitted the step id is
 * used as a fallback so callers never crash on missing copy.
 */
export function buildStepper(current, labels) {
  const count = WIZARD_STEP_IDS.length;
  const cur = clampStep(current, count);
  return WIZARD_STEP_IDS.map((id, i) => {
    const index = i + 1;
    const state = index < cur ? "done" : index === cur ? "current" : "upcoming";
    return {
      id,
      index,
      label: (labels && labels[i]) || id,
      state,
      isCurrent: state === "current",
      isDone: state === "done",
    };
  });
}

/** Percentage width (0–100) for the underlying progress fill. */
export function stepperPercent(current, count = WIZARD_STEP_IDS.length) {
  const cur = clampStep(current, count);
  return Math.round((cur / count) * 100);
}

/**
 * Rotating "progress storytelling" line for a long LLM wait. Given a tick count
 * (e.g. seconds elapsed) it cycles through the provided phrases so a bare
 * spinner becomes narrated progress. Returns "" when no phrases given.
 */
export function rotatingWaitLine(phrases, tick) {
  if (!Array.isArray(phrases) || phrases.length === 0) return "";
  const t = Math.max(0, Number(tick) | 0);
  return phrases[t % phrases.length];
}

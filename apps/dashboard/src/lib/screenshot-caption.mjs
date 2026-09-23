// Train N4 (2026-09-24, 설계 §8-8) — human captions for evidence screenshots.
//
// The inspector names files like `screenshots/step-00-initial.png`,
// `step-01.png`, `step-03-final.png`. Showing that filename to a non-developer
// says nothing; "First screen" / "After step 2" / "Last screen" does. Pure so
// the report page and the comparison view share one rule and it is tested.

/**
 * @param {string} name evidence file name (may carry a `screenshots/` prefix)
 * @param {number} listIndex position in the rendered list (fallback when the name has no step number)
 * @param {{ initial: string, afterStep: string, final: string }} labels dictionary strings; `afterStep` contains `{n}`
 * @returns {string}
 */
export function screenshotCaption(name, listIndex, labels) {
  const base = String(name ?? "").replace(/^screenshots\//, "");
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const lower = stem.toLowerCase();
  if (/(^|[-_])(initial|start|landing)([-_]|$)/.test(lower)) return labels.initial;
  if (/(^|[-_])(final|end|done|last)([-_]|$)/.test(lower)) return labels.final;
  const m = /step[-_]?(\d+)/.exec(lower);
  const n = m ? Number.parseInt(m[1], 10) : Number.isInteger(listIndex) ? listIndex : 0;
  if (n === 0) return labels.initial;
  return labels.afterStep.replace("{n}", String(n));
}

/** The raw filename, for the collapsed "developer details" line only. */
export function screenshotFileName(name) {
  return String(name ?? "").replace(/^screenshots\//, "");
}

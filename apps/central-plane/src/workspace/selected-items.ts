/**
 * workspace/selected-items.ts
 *
 * Stage 40: defensive normalization for user-supplied `selectedItemIds`.
 *
 * The re-run UX lets a user hand-pick which items to re-check. The request
 * body is untrusted, so before it reaches the review pipeline we:
 *   - require an array (anything else → undefined, i.e. "not provided")
 *   - drop non-string entries
 *   - trim whitespace and drop empties
 *   - de-duplicate (preserving first-seen order)
 *   - cap the count so a pathological payload can't blow up the run
 *
 * Returning `undefined` (not an array) vs `[]` (array, but nothing usable)
 * is preserved on purpose: callers treat a falsy `.length` as "fall back to
 * the source run / linked PR selection", which matches pre-Stage-40 behavior.
 */

/** Hard ceiling on hand-picked items. Real PRs never approach this. */
export const MAX_SELECTED_ITEMS = 500;

export function normalizeSelectedItemIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_SELECTED_ITEMS) break;
  }
  return out;
}

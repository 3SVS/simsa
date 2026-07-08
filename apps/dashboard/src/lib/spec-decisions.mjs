/**
 * spec-decisions.mjs — C2 answers → productSpec merge (audit v2 P0-honesty 2.3).
 *
 * When the user answers an open question (C2 card), the answer must reach the
 * productSpec that checks/export/builder-pack actually read — not just the
 * extended `resolvedOpenDecisions` side-channel. These pure functions produce
 * the next productSpec: the answered question moves out of `openQuestions` and
 * into `decisions` as "질문 — 답". Un-answering reverses it.
 *
 * Plain .mjs + .d.mts so node --test can import it without TS stripping.
 */

/** Marker format for a decision line derived from an answered open question. */
export function decisionLine(question, answer) {
  return `${question} — ${answer}`;
}

function isDecisionFor(entry, question) {
  return typeof entry === "string" && entry.startsWith(`${question} — `);
}

/**
 * Merge one resolved open question into a productSpec (immutably).
 *
 * - answer non-empty: remove the question from `openQuestions`, upsert the
 *   "question — answer" line into `decisions` (replacing a previous answer
 *   for the same question).
 * - answer empty ("답 취소"): remove the decision line and put the question
 *   back into `openQuestions` (if not already there).
 */
export function applyResolvedDecision(productSpec, question, answer) {
  const decisions = Array.isArray(productSpec.decisions) ? productSpec.decisions : [];
  const openQuestions = Array.isArray(productSpec.openQuestions) ? productSpec.openQuestions : [];
  const q = (question ?? "").trim();
  const a = (answer ?? "").trim();
  if (!q) return productSpec;

  if (a) {
    const kept = decisions.filter((d) => !isDecisionFor(d, q));
    return {
      ...productSpec,
      decisions: [...kept, decisionLine(q, a)],
      openQuestions: openQuestions.filter((o) => o !== q),
    };
  }
  return {
    ...productSpec,
    decisions: decisions.filter((d) => !isDecisionFor(d, q)),
    openQuestions: openQuestions.includes(q) ? openQuestions : [...openQuestions, q],
  };
}

/** Apply a whole {question: answer} map (e.g. re-sync after hydration). */
export function applyAllResolvedDecisions(productSpec, resolved) {
  let next = productSpec;
  for (const [question, answer] of Object.entries(resolved ?? {})) {
    next = applyResolvedDecision(next, question, answer);
  }
  return next;
}

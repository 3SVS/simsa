/**
 * classify.mjs — Stage 258A spike. Pure, deterministic separation of:
 *   - Browser Evidence  (facts captured by the real browser)
 *   - AI Opinion        (heuristic interpretation, clearly labeled as opinion)
 *   - Decision          (a readiness state, NO numeric score)
 *
 * The classifier only reads the factual evidence object; it never touches a browser or network.
 * Decision states mirror docs/simsa-acceptance-graph.md. Absent evidence → Not Verified, never Done.
 */

export const DECISION_STATES = [
  "Ready",
  "Needs Fix",
  "Not Verified",
  "User Acceptance Required",
  "Needs Clarification",
];

/** True when the post-click URL looks broken/dead-ends rather than entering a next screen. */
function looksBroken(evidence) {
  const after = String(evidence?.routeAfterClick ?? "");
  return (
    /\/undefined\b/i.test(after) ||
    /\/null\b/i.test(after) ||
    /\/404\b/i.test(after) ||
    /\/(error|not-found)\b/i.test(after)
  );
}

/**
 * Build the AI Opinion — explicitly an interpretation, derived ONLY from the evidence object.
 * It is kept separate from Browser Evidence so a reader can disagree with the opinion while
 * still trusting the facts.
 */
export function buildAiOpinion(evidence, intentAnchor) {
  const reasons = [];
  let likelyIntentMismatch = false;
  let likelyImplementationChoice = false;

  const hasNet = !!evidence?.networkFailures?.length;
  const hasInput = !!evidence?.detectedInputs?.length;

  if (hasNet) {
    reasons.push(`${evidence.networkFailures.length} network request(s) failed (a required backend host appears unreachable), which alone blocks the intended flow regardless of UI.`);
  }
  if (evidence?.consoleErrors?.length) {
    reasons.push(`Console reported ${evidence.consoleErrors.length} error(s) during the flow.`);
  }
  if (!evidence?.primaryCtaFound) {
    if (hasInput) {
      reasons.push("No primary CTA button/link matched the intent, but an intent-relevant input (e.g. a search field) was detected — the flow may be input-driven rather than CTA-driven.");
    } else if (!hasNet) {
      likelyIntentMismatch = true;
      reasons.push("No CTA or input matching the stated intent was found on the homepage.");
    }
  }
  if (evidence?.clicked && looksBroken(evidence)) {
    likelyIntentMismatch = true;
    reasons.push(`After clicking the primary CTA the app routed to "${evidence.routeAfterClick}", which does not look like a usable onboarding screen.`);
  }
  if (evidence?.clicked && !evidence?.routeChanged && !looksBroken(evidence)) {
    likelyImplementationChoice = true;
    reasons.push("Clicking the primary CTA did not change the route; the next step may be a modal/in-page state that this spike cannot yet confirm.");
  }

  const severity =
    likelyIntentMismatch || evidence?.consoleErrors?.length || evidence?.networkFailures?.length
      ? "high"
      : likelyImplementationChoice
        ? "medium"
        : "low";

  const recommendedFixDirection = evidence?.networkFailures?.length
    ? "Restore the failing backend/data requests (a required API host appears unreachable); the homepage cannot render its content or onboarding entry point until those requests succeed."
    : !evidence?.primaryCtaFound
    ? "Add a clearly labeled primary onboarding CTA (e.g. \"Get started\" / \"Sign up\") on the homepage, or ensure the data that renders it loads."
    : looksBroken(evidence)
      ? "Point the primary CTA at a valid onboarding route and ensure that route renders."
      : likelyImplementationChoice
        ? "Confirm whether the CTA is meant to open a modal/in-page step; if so, expose a verifiable signal (URL change or visible onboarding region)."
        : "No fix indicated by the captured evidence; confirm visually.";

  return {
    label: "AI Opinion (interpretation, not a measured fact)",
    intentAnchor,
    likelyIntentMismatch,
    likelyImplementationChoice,
    whyThisMayBlockCompletion: reasons,
    suggestedSeverity: severity,
    recommendedFixDirection,
  };
}

/**
 * Decide the readiness state from the EVIDENCE alone (not the opinion). Deterministic priority.
 * NO numeric score is produced.
 */
export function classifyDecision(evidence) {
  if (evidence?.loadStatus && evidence.loadStatus >= 400) {
    return { decision: "Not Verified", reasons: [`Homepage returned HTTP ${evidence.loadStatus}; flow not exercised.`] };
  }
  // A live console/network error ranks above "no CTA": the app is actively broken, which is a more
  // accurate and actionable signal than "intent unclear".
  if (evidence?.consoleErrors?.length || evidence?.networkFailures?.length) {
    const net = evidence?.networkFailures?.length ?? 0;
    return {
      decision: "Needs Fix",
      reasons: [
        net > 0
          ? `${net} backend/network request(s) failed while loading the page (e.g. a required API host is unreachable); a user cannot complete the intended flow against a broken data dependency.`
          : "Console errors occurred while loading the intended entry point.",
      ],
    };
  }
  if (!evidence?.primaryCtaFound) {
    return { decision: "Needs Clarification", reasons: ["No onboarding/start CTA detected — cannot exercise the stated intent."] };
  }
  if (evidence?.clicked && looksBroken(evidence)) {
    return { decision: "Needs Fix", reasons: [`Primary CTA routed to "${evidence.routeAfterClick}", not a usable onboarding screen.`] };
  }
  if (evidence?.clicked && !evidence?.routeChanged) {
    return {
      decision: "User Acceptance Required",
      reasons: ["CTA clicked but no route change was observed; a human must confirm whether onboarding actually started (e.g. modal/in-page step)."],
    };
  }
  if (evidence?.clicked && evidence?.routeChanged) {
    // A route change is a positive signal, but this spike has no visual oracle for the next
    // screen's usability — so it stops at User Acceptance Required, never auto-"Ready".
    return {
      decision: "User Acceptance Required",
      reasons: [`CTA routed to "${evidence.routeAfterClick}". The spike confirms navigation but cannot verify the onboarding screen is usable — human acceptance required.`],
    };
  }
  return { decision: "Not Verified", reasons: ["Insufficient interaction evidence to judge onboarding completion."] };
}

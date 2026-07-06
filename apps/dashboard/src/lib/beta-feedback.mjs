// Stage 119 — lightweight, beta-safe feedback capture.
//
// Builds a `mailto:` URL with SAFE context only. By design it cannot transmit
// raw pasted input, workflow snapshots, repo details, userKey, or any
// secret/token — the function signature only accepts a small allowlist of
// non-sensitive context fields, and the body is a fixed template. No backend, no
// DB, no email/analytics provider. Pure + deterministic + URL-encoded.

// Existing public contact email used across the product surfaces. Do NOT invent
// hi@/support@/feedback@ addresses without explicit approval.
const FEEDBACK_EMAIL = "seunghunbae@3svs.com";
const DEFAULT_SUBJECT_PREFIX = "[Simsa beta feedback]";

function str(x) {
  return typeof x === "string" ? x.trim() : "";
}

/**
 * @param {{
 *   route?: string,
 *   intakeType?: string,
 *   workflowRecordId?: string,
 *   section?: string,
 *   subjectPrefix?: string,
 * }} [input]
 * @returns {string} a mailto: URL with safe context only
 */
export function buildBetaFeedbackMailto(input = {}) {
  const route = str(input.route);
  const intakeType = str(input.intakeType);
  const workflowRecordId = str(input.workflowRecordId);
  const section = str(input.section);
  const subjectPrefix = str(input.subjectPrefix) || DEFAULT_SUBJECT_PREFIX;

  const subjectTopic = section || "Intake workflow";
  const subject = `${subjectPrefix} ${subjectTopic}`;

  // Only safe, non-sensitive context lines are included.
  const contextLines = [];
  if (route) contextLines.push(`- Route: ${route}`);
  if (intakeType) contextLines.push(`- Intake type: ${intakeType}`);
  if (workflowRecordId) contextLines.push(`- Saved workflow record: ${workflowRecordId}`);
  if (section) contextLines.push(`- Section: ${section}`);
  if (contextLines.length === 0) contextLines.push("- (no extra context)");

  const body = [
    "Hi Simsa team,",
    "",
    "I have feedback about the beta workflow.",
    "",
    "Context:",
    ...contextLines,
    "",
    "Feedback:",
    "- What was confusing?",
    "- What felt useful?",
    "- What did you expect next?",
    "- Any bug or issue?",
    "",
    "Please do not include sensitive product details unless you are comfortable sharing them.",
  ].join("\n");

  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encodes spaces as "+"; mailto clients expect %20 in
  // subject/body, so normalize.
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

export { FEEDBACK_EMAIL };

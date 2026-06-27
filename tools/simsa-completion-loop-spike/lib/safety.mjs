/**
 * safety.mjs — Stage 258A spike. Pure, deterministic safety filter for clickable actions.
 *
 * The spike must NEVER click destructive/irreversible actions (payment, delete, send, invite,
 * publish, deploy, destructive mutation). When risk is unclear, the action is SKIPPED, not clicked.
 * This module decides eligibility from the visible text/attributes only — no network, no browser.
 */

/** Keyword groups that map to forbidden categories. Matched case-insensitively against text. */
const FORBIDDEN_PATTERNS = [
  { category: "payment", re: /\b(pay|payment|checkout|subscribe|buy|purchase|billing|upgrade|card)\b/i },
  { category: "delete", re: /\b(delete|remove|destroy|drop|erase|wipe|reset)\b/i },
  { category: "send email", re: /\b(send|email|e-mail|mail|notify)\b/i },
  { category: "invite external users", re: /\b(invite|share|add member|add user)\b/i },
  { category: "publish", re: /\b(publish|go live|make public|release)\b/i },
  { category: "deploy", re: /\b(deploy|ship|promote to production)\b/i },
  { category: "destructive data mutation", re: /\b(clear all|delete all|truncate|format)\b/i },
  { category: "auth bypass / logout", re: /\b(logout|log out|sign out)\b/i },
];

/**
 * Classify a candidate action by its visible text. Returns { safe, category }.
 * safe=false means: do NOT click; record as Skipped with the matched category.
 */
export function classifyActionSafety(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return { safe: false, category: "empty/unknown" }; // unclear → skip
  for (const { category, re } of FORBIDDEN_PATTERNS) {
    if (re.test(t)) return { safe: false, category };
  }
  return { safe: true, category: null };
}

/**
 * Keywords that indicate a CTA related to the intent anchor, ordered by priority (highest first).
 * Covers both generic onboarding/start intents and the golf-playability domain (check conditions,
 * find/search a course, view playability) so the spike matches THIS app's intent, not just signups.
 */
const INTENT_CTA_PATTERNS = [
  /\b(get started|getting started)\b/i,
  /\b(check( conditions| now| playab)?|playable|playability|conditions)\b/i,
  /\b(find|search|browse|explore)\b.*\b(course|round|tee|golf)\b/i,
  /\b(course|courses|tee time|round)\b/i,
  /\b(start( now| onboarding| free)?)\b/i,
  /\b(sign ?up|signup|create account|register)\b/i,
  /\b(view|see)\b.*\b(condition|course|map|forecast|weather)\b/i,
  /\b(begin|onboard(ing)?|try( it)?( free| now)?)\b/i,
  /\b(join|continue|next)\b/i,
];

/**
 * Score how well a candidate's text matches the onboarding/start intent.
 * Higher = better. 0 = no match. Deterministic (pattern index → score), case-insensitive.
 */
export function intentMatchScore(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return 0;
  for (let i = 0; i < INTENT_CTA_PATTERNS.length; i++) {
    if (INTENT_CTA_PATTERNS[i].test(t)) return INTENT_CTA_PATTERNS.length - i;
  }
  return 0;
}

/**
 * Choose the primary onboarding CTA from a list of candidates {text, selector, ...}.
 * Returns { chosen, skippedForbidden } where chosen is the highest-scoring SAFE candidate
 * (or null if none), and skippedForbidden lists safe-rejected intent matches with reasons.
 * Pure & deterministic: ties break by earliest DOM order (input order).
 */
export function choosePrimaryCta(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  let chosen = null;
  let chosenScore = 0;
  const skippedForbidden = [];
  for (const c of list) {
    const score = intentMatchScore(c?.text);
    if (score <= 0) continue;
    const safety = classifyActionSafety(c?.text);
    if (!safety.safe) {
      skippedForbidden.push({ text: c?.text ?? "", selector: c?.selector ?? "", reason: safety.category });
      continue;
    }
    if (score > chosenScore) {
      chosen = c;
      chosenScore = score;
    }
  }
  return { chosen, chosenScore, skippedForbidden };
}

/**
 * safety.mjs — Stage 263 (copied from tools/simsa-completion-loop-spike/lib/safety.mjs).
 *
 * Pure, deterministic safety filter for clickable actions. The inspector must
 * NEVER click destructive/irreversible actions (payment, delete, send, invite,
 * publish, deploy, logout, destructive mutation). When risk is unclear, the
 * action is SKIPPED, not clicked. Decides from visible text only — no network,
 * no browser.
 *
 * Kept as a byte-level copy of the spike's classifier so both runners skip the
 * same actions. If you change one, change the other in the same commit.
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
  // Korean forms of the same forbidden intents (the spike handles these via
  // the planner's forbidden list; the runner double-checks at click time).
  { category: "payment", re: /결제|구매/ },
  { category: "delete", re: /삭제/ },
  { category: "publish", re: /발행/ },
  { category: "deploy", re: /배포/ },
  { category: "auth bypass / logout", re: /로그아웃/ },
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

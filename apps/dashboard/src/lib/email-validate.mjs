/**
 * email-validate.mjs — soft signup email validation (pure).
 *
 * Beta policy (2026-07-05): email verification stays OFF (no friction for
 * invited testers), but we soft-reject obviously fake addresses like "a@a.com"
 * so the account list isn't polluted. This is heuristic, not authoritative — it
 * only catches format errors and toy placeholder domains. Testable under Node 20.
 */

// Second-level labels / domains that are unmistakably placeholders.
const PLACEHOLDER_DOMAINS = new Set([
  "test.com",
  "test.org",
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "email.com",
  "mail.mail",
  "a.com",
  "b.com",
  "abc.com",
  "asdf.com",
]);

/**
 * True when the address is a plausible real email: correct shape, a domain
 * whose second-level label is ≥ 2 chars, a TLD ≥ 2 chars, and not a known
 * placeholder domain. Soft heuristic — never blocks a legitimately-shaped
 * address at a real-looking domain.
 * @param {string} email
 * @returns {boolean}
 */
export function isPlausibleEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  // one @, non-empty local, dotted domain, TLD of 2+ letters
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(value)) return false;
  const domain = value.slice(value.indexOf("@") + 1);
  if (PLACEHOLDER_DOMAINS.has(domain)) return false;
  const labels = domain.split(".");
  const sld = labels[labels.length - 2] ?? "";
  // "a@a.com" → second-level label "a" (length 1) → reject
  if (sld.length < 2) return false;
  return true;
}

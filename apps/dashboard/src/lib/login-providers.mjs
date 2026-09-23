// Train N2 (2026-09-24, 설계 §8-4) — sign-in option order for a non-developer
// audience. Pure data so the order is testable and not re-derived in JSX.
//
// Rule: Google first (most beginners have one), email second, GitHub LAST and
// labelled "for developers" — it is the right door only when your code lives
// there. When Google is not configured server-side (the live state on
// 2026-09-24: /api/auth/sign-in/social → PROVIDER_NOT_FOUND), email is the
// first working option and the Google row carries an honest note.

/** @typedef {{ id: "google" | "email" | "github", tier: "primary" | "developer", available: boolean }} LoginProvider */

/**
 * @param {{ googleUnavailable?: boolean, githubUnavailable?: boolean }} [state]
 * @returns {LoginProvider[]}
 */
export function loginProviderPlan(state) {
  const g = state?.googleUnavailable === true;
  const gh = state?.githubUnavailable === true;
  return [
    { id: "google", tier: "primary", available: !g },
    { id: "email", tier: "primary", available: true },
    { id: "github", tier: "developer", available: !gh },
  ];
}

/** The first option a beginner should reach for right now. */
export function firstWorkingPrimary(state) {
  return loginProviderPlan(state).find((p) => p.tier === "primary" && p.available)?.id ?? "email";
}

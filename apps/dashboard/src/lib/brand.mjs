// Stage 84: dashboard public brand constants. CENTRAL SOURCE OF TRUTH for
// non-translated, user-visible product brand text on the dashboard. The value
// stays "Conclave" today — Stage 84 is rebrand READINESS, not actual rename.
//
// Use BRAND.* when the string appears in:
//   - HTML <title> / metadata
//   - non-i18n shell chrome (logos, brand badges)
//   - any visible string that should change in lockstep when product is renamed
//
// DO NOT use BRAND.* for:
//   - localStorage keys (`conclave:*`, `conclave_*`) — internal namespace, freeze
//   - env var names (`NEXT_PUBLIC_*` URLs containing `conclave-ai`) — deploy infra
//   - CSS variable names / Tailwind classes (`brand-50`, `brand-700`) — internal
//   - route paths (`/workspace/*`) — internal
//   - test fixture IDs (`uk_owner`, `proj_*`) — internal
//
// i18n note: `t.brand.wordmark` in dictionary.mjs intentionally holds the same
// value. The two are siblings — i18n drives locale-aware chrome, BRAND drives
// non-locale surfaces like the HTML title. A future rename must touch both.

export const BRAND = {
  productName: "Conclave",
  productShortName: "Conclave",
  tagline: "Acceptance workspace for AI-built software",
  metadataTitle: "Conclave — Acceptance workspace for AI-built software",
  metadataDescription:
    "Turn product intent into acceptance checks, review history, and fix instructions for AI-built software.",
};

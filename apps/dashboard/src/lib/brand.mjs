// Stage 84 (intro) + Stage 85 (rename): dashboard public brand constants.
// CENTRAL SOURCE OF TRUTH for non-translated, user-visible product brand text
// on the dashboard. As of Stage 85 the product name is "Simsa" (한글 “심사”).
//
// Use BRAND.* when the string appears in:
//   - HTML <title> / metadata
//   - non-i18n shell chrome (logos, brand badges)
//   - any visible string that should change in lockstep when product is renamed
//
// DO NOT use BRAND.* for:
//   - localStorage keys (`conclave:*`, `conclave_*`) — internal namespace, frozen
//   - env var names (`NEXT_PUBLIC_*` URLs containing `conclave-ai`) — deploy infra
//   - CSS variable names / Tailwind classes (`brand-50`, `brand-700`) — internal
//   - route paths (`/workspace/*`) — internal
//   - test fixture IDs (`uk_owner`, `proj_*`) — internal
//   - npm package names (`@simsa/*`) — frozen
//   - MCP package id (`@simsa/mcp-workspace`) — frozen
//
// i18n note: `t.brand.wordmark` in dictionary.mjs intentionally holds the same
// value. The two are siblings — i18n drives locale-aware chrome, BRAND drives
// non-locale surfaces like the HTML title. The drift test in brand.test.mjs
// catches any rename that forgets one side.
//
// Domain note (Stage 85): primaryDomain + developerDomain are recorded here so
// public chrome can reference them after DNS is wired. Stage 85 does NOT
// configure DNS, redirects, or Vercel/Cloudflare domain bindings — that is a
// separate operational stage.

export const BRAND = {
  productName: "Simsa",
  productShortName: "Simsa",
  tagline: "The acceptance layer for AI-built software.",
  metadataTitle: "Simsa — The acceptance layer for AI-built software.",
  metadataDescription:
    "Review, compare, and accept AI-built software with evidence.",
  primaryDomain: "trysimsa.com",
  developerDomain: "simsa.dev",
  // Stage 89: launch-surface domains recorded for later wiring. The dashboard
  // app will be served at appDomain once DNS + Vercel custom domain are live;
  // legacyDashboardDomain stays as a permanent fallback. Stage 89 does NOT wire
  // DNS — these are config constants only (see operator checklist in the stage doc).
  appDomain: "app.trysimsa.com",
  legacyDashboardDomain: "conclave-dashboard.vercel.app",
};

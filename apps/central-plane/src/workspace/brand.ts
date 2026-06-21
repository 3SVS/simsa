/**
 * workspace/brand.ts — Stage 84
 *
 * CENTRAL SOURCE OF TRUTH for the central-plane's user-facing product brand
 * strings. The value stays "Conclave" today — Stage 84 is rebrand READINESS,
 * not actual rename. The constant exists so a future rename touches one place
 * AND so saved artifacts written via the canonical helpers move in lockstep.
 *
 * Use BRAND.* in:
 *   - canonical pack / summary / PR-comment / Telegram / builder-pack text
 *   - any user-visible heading the server controls
 *
 * DO NOT use BRAND.* for:
 *   - npm package names (`@conclave-ai/*`) — frozen
 *   - env var names / URL fragments (`CONCLAVE_*`, `conclave-ai.*`) — deploy infra
 *   - DB table or migration names — frozen
 *   - HTTP route paths (`/workspace/*`) — frozen
 *   - test fixture ids — frozen
 *
 * Saved-artifact compatibility note: Stage 77 saved action packs already have
 * "Conclave Evolution Action Pack" baked into pack_json sections at save time.
 * Centralising the heading does NOT rewrite those rows. A future rename should
 * decide explicitly whether to also rewrite stored pack_json (typically NO —
 * artifacts are dated by the brand of their era).
 */

export const BRAND = {
  productName: "Conclave",
  productShortName: "Conclave",
  actionPackHeading: "Conclave Evolution Action Pack",
} as const;

export type BrandKey = keyof typeof BRAND;

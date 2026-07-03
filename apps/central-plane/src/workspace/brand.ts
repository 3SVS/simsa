/**
 * workspace/brand.ts — Stage 84 (intro) + Stage 85 (rename)
 *
 * CENTRAL SOURCE OF TRUTH for the central-plane's user-facing product brand
 * strings. As of Stage 85 the product name is "Simsa" (한글 “심사”).
 *
 * Use BRAND.* in:
 *   - canonical pack / summary / PR-comment / Telegram / builder-pack text
 *   - any user-visible heading the server controls
 *
 * DO NOT use BRAND.* for:
 *   - npm package names (`@simsa/*`) — frozen
 *   - env var names / URL fragments (`CONCLAVE_*`, `conclave-ai.*`) — deploy infra
 *   - DB table or migration names — frozen
 *   - HTTP route paths (`/workspace/*`) — frozen
 *   - Telegram bot username (`Conclave_AI`) — registered with BotFather, frozen
 *   - Cloudflare Worker DO class name (`ConclaveSandbox`) — frozen
 *   - test fixture ids — frozen
 *
 * Saved-artifact compatibility note: Stage 77 saved action packs already have
 * the Conclave-era heading baked into pack_json sections at save time. Stage
 * 85 does NOT rewrite those rows. Only NEW packs generated after this change
 * carry the Simsa heading. This matches Stage 77's immutable-artifact policy
 * — artifacts are dated by the brand of their era.
 */

export const BRAND = {
  productName: "Simsa",
  productShortName: "Simsa",
  tagline: "The acceptance layer for AI-built software.",
  actionPackHeading: "Simsa Evolution Action Pack",
  prCommentHeading: "Simsa Review",
  // Stage 92: live public app/dashboard URL. app.trysimsa.com is wired
  // (Stage 90B) and serves the Simsa dashboard. Used in user-facing generated
  // links (PR comment footer, dashboard-link fallback). NOT trysimsa.com apex
  // / simsa.dev (no routing yet). Internal infra hostnames stay `conclave-*`.
  appUrl: "https://app.trysimsa.com",
} as const;

export type BrandKey = keyof typeof BRAND;

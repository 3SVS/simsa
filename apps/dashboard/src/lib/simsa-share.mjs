/**
 * simsa-share.mjs
 *
 * Community / growth surface: let users (a) star the public repo and (b) add a
 * "Reviewed with Simsa" badge to their own repo README that links back to Simsa.
 *
 * Pure, no I/O. The badge uses a shields.io static badge in the brand oxblood so
 * there's nothing to host; the copy snippets are plain markdown/HTML the user
 * pastes into their README.
 */

import { BRAND } from "./brand.mjs";

/** The public GitHub repository users can star. */
export const SIMSA_REPO_URL = "https://github.com/3SVS/simsa";

/** The public marketing site the badge links to. */
export const SIMSA_SITE_URL = `https://${BRAND.primaryDomain}`;

/** shields.io static badge — "Reviewed with · Simsa" in brand oxblood (#8e2c39)
 *  on a zinc label. Agent-agnostic, nothing to host. */
export const SIMSA_BADGE_IMG =
  "https://img.shields.io/badge/Reviewed_with-Simsa-8e2c39?labelColor=27272a";

const BADGE_ALT = "Reviewed with Simsa";

/**
 * The markdown snippet a user pastes into their repo README.
 * @returns {string}
 */
export function buildSimsaBadgeMarkdown() {
  return `[![${BADGE_ALT}](${SIMSA_BADGE_IMG})](${SIMSA_SITE_URL})`;
}

/**
 * The HTML snippet (for READMEs / sites that don't render markdown).
 * @returns {string}
 */
export function buildSimsaBadgeHtml() {
  return `<a href="${SIMSA_SITE_URL}"><img src="${SIMSA_BADGE_IMG}" alt="${BADGE_ALT}" /></a>`;
}

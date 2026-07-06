import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIMSA_REPO_URL,
  SIMSA_SITE_URL,
  SIMSA_BADGE_IMG,
  buildSimsaBadgeMarkdown,
  buildSimsaBadgeHtml,
} from "../src/lib/simsa-share.mjs";

describe("simsa-share", () => {
  it("repo + site + badge are absolute https URLs", () => {
    for (const u of [SIMSA_REPO_URL, SIMSA_SITE_URL, SIMSA_BADGE_IMG]) {
      assert.match(u, /^https:\/\/\S+$/);
    }
    assert.ok(SIMSA_REPO_URL.includes("github.com/3SVS/simsa"));
    assert.ok(SIMSA_SITE_URL.includes("trysimsa.com"));
  });

  it("badge uses the brand oxblood and links back to Simsa", () => {
    assert.ok(SIMSA_BADGE_IMG.includes("8e2c39"), "oxblood brand color");
    const md = buildSimsaBadgeMarkdown();
    assert.equal(md, `[![Reviewed with Simsa](${SIMSA_BADGE_IMG})](${SIMSA_SITE_URL})`);
    assert.ok(md.includes(SIMSA_SITE_URL), "markdown links to the site");
  });

  it("html snippet embeds the badge image with alt text", () => {
    const html = buildSimsaBadgeHtml();
    assert.ok(html.includes(`href="${SIMSA_SITE_URL}"`));
    assert.ok(html.includes(`src="${SIMSA_BADGE_IMG}"`));
    assert.ok(html.includes('alt="Reviewed with Simsa"'));
  });

  it("badge snippets carry no secret / no user data", () => {
    for (const s of [buildSimsaBadgeMarkdown(), buildSimsaBadgeHtml()]) {
      assert.ok(!/ghp_|sk-|Bearer |userKey/.test(s));
    }
  });
});

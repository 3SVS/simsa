import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loginProviderPlan, firstWorkingPrimary } from "../src/lib/login-providers.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

describe("login provider order for non-developers (Train N2, §8-4)", () => {
  it("Google → email → GitHub, GitHub is the developer tier", () => {
    const plan = loginProviderPlan();
    assert.deepEqual(plan.map((p) => p.id), ["google", "email", "github"]);
    assert.equal(plan.find((p) => p.id === "github")?.tier, "developer");
    assert.equal(plan.filter((p) => p.tier === "primary").length, 2);
  });

  it("when Google is not configured server-side, email is the first working option", () => {
    assert.equal(firstWorkingPrimary(), "google");
    assert.equal(firstWorkingPrimary({ googleUnavailable: true }), "email");
    assert.equal(loginProviderPlan({ githubUnavailable: true }).find((p) => p.id === "github")?.available, false);
  });

  it("page renders the GitHub button AFTER the email form (developer door last)", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/app/login/page.tsx", import.meta.url)), "utf8");
    const form = src.indexOf("<form onSubmit={handleEmailSubmit}");
    const github = src.indexOf("onClick={handleGithub}");
    assert.ok(form > 0 && github > 0, "both markers present");
    assert.ok(github > form, `GitHub button (at ${github}) must come after the email form (at ${form})`);
    assert.ok(!src.includes("GitHub-first"), "stale 'GitHub-first' header comment must be gone");
  });

  for (const locale of ["en", "ko"]) {
    it(`${locale}: GitHub option carries a 'for developers' caption`, () => {
      const l = DICTIONARIES[locale].login;
      assert.equal(typeof l.githubDevCaption, "string");
      assert.ok(/developer|개발자/i.test(l.githubDevCaption));
    });
  }
});

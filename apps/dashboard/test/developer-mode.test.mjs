import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEVELOPER_MODE_KEY,
  parseDeveloperMode,
  readDeveloperMode,
  writeDeveloperMode,
  settingsSectionVisibility,
  sidebarDeveloperItems,
} from "../src/lib/developer-mode.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v) };
}

describe("developer mode preference (Train N, D-17)", () => {
  it("defaults OFF for missing / garbage / throwing storage", () => {
    assert.equal(readDeveloperMode(memStorage()), false);
    assert.equal(readDeveloperMode(memStorage({ [DEVELOPER_MODE_KEY]: "true" })), false);
    assert.equal(readDeveloperMode(null), false);
    assert.equal(readDeveloperMode({ getItem() { throw new Error("blocked"); } }), false);
    assert.equal(parseDeveloperMode("1"), true);
    assert.equal(parseDeveloperMode(1), false);
  });

  it("round-trips through storage and never throws on write failure", () => {
    const s = memStorage();
    writeDeveloperMode(s, true);
    assert.equal(readDeveloperMode(s), true);
    writeDeveloperMode(s, false);
    assert.equal(readDeveloperMode(s), false);
    assert.doesNotThrow(() => writeDeveloperMode({ setItem() { throw new Error("quota"); } }, true));
  });

  it("beginner default hides GitHub + Telegram, keeps email/consent", () => {
    const v = settingsSectionVisibility({ developerMode: false, entryPath: "idea", hasLinkedRepo: false });
    assert.deepEqual(v, {
      github: false, telegram: false, email: true, trainingConsent: true, developerModeToggle: true, builtWith: false,
    });
  });

  it("code-branch users and users with a linked repo still see GitHub (never hide something in use)", () => {
    assert.equal(settingsSectionVisibility({ developerMode: false, entryPath: "code" }).github, true);
    assert.equal(settingsSectionVisibility({ developerMode: false, entryPath: "spec", hasLinkedRepo: true }).github, true);
    assert.equal(settingsSectionVisibility({ developerMode: false, entryPath: "code" }).builtWith, true);
    // …but Telegram stays developer-only even for them.
    assert.equal(settingsSectionVisibility({ developerMode: false, entryPath: "code" }).telegram, false);
  });

  it("developer mode opens everything", () => {
    const v = settingsSectionVisibility({ developerMode: true, entryPath: "idea" });
    assert.equal(v.github, true);
    assert.equal(v.telegram, true);
    assert.deepEqual(sidebarDeveloperItems({ developerMode: true }), { starOnGithub: true, advancedGroup: true });
    assert.deepEqual(sidebarDeveloperItems({ developerMode: false }), { starOnGithub: false, advancedGroup: false });
  });
});

// §8-1 / §8-3 / §8-11 — the DEFAULT flow must not ask beginners infrastructure
// questions or which coding tool they used, and examples must be everyday ones.
// These are source-level regression checks (they FAIL on the pre-Train-N page).
describe("new-project page: no developer questions in the default flow (§8-1, §8-3, §8-11)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/app/projects/new/page.tsx", import.meta.url)), "utf8");
  const ideaStart = src.indexOf('entryPath === "idea" && step === 1');
  const ideaStep = src.slice(ideaStart, src.indexOf("{/* Step 2: understanding */}", ideaStart));
  const resultStep = src.slice(src.indexOf("{/* Step 4: result */}"));

  it("idea step 1 no longer renders the GitHub / AI-tool / hosting / data interview rows", () => {
    assert.ok(ideaStep.length > 0, "idea step block found");
    for (const forbidden of ["t.np.githubQ", "t.np.aiToolQ", "<StackProfileRows"]) {
      assert.ok(!ideaStep.includes(forbidden), `idea step still renders ${forbidden}`);
    }
    // The platform question may stay — it feeds the feasibility verdict.
    assert.ok(ideaStep.includes("t.np.platformQ"));
  });

  it("the spec/idea result screen no longer asks 'which tool built this app?'", () => {
    assert.ok(!resultStep.includes("t.builtWith.question"), "builtWith picker still on the result step");
  });

  for (const locale of ["en", "ko"]) {
    it(`${locale}: interview examples are everyday, not developer-tool flavoured`, () => {
      const examples = DICTIONARIES[locale].np.examples;
      assert.ok(examples.length >= 3);
      for (const ex of examples) {
        assert.ok(!/Linear|GitHub|Jira|Slack|Notion|API/i.test(ex), `developer-tool word in example: ${ex}`);
      }
    });
  }
});

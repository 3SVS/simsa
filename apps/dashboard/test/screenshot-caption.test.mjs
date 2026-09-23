import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { screenshotCaption, screenshotFileName } from "../src/lib/screenshot-caption.mjs";
import { DICTIONARIES } from "../src/i18n/dictionary.mjs";

const KO = { initial: "처음 화면", afterStep: "{n}번째 동작 뒤", final: "마지막 화면" };

describe("screenshot captions for non-developers (Train N4, §8-8)", () => {
  it("maps the inspector's file names to plain step labels", () => {
    assert.equal(screenshotCaption("screenshots/step-00-initial.png", 0, KO), "처음 화면");
    assert.equal(screenshotCaption("step-01.png", 1, KO), "1번째 동작 뒤");
    assert.equal(screenshotCaption("step-02-after-click.png", 2, KO), "2번째 동작 뒤");
    assert.equal(screenshotCaption("step-03-final.png", 3, KO), "마지막 화면");
  });

  it("falls back to the list position when the name has no step number, never to the filename", () => {
    assert.equal(screenshotCaption("weird.png", 0, KO), "처음 화면");
    assert.equal(screenshotCaption("weird.png", 4, KO), "4번째 동작 뒤");
    assert.ok(!screenshotCaption("step-05-x.png", 5, KO).includes(".png"));
    assert.equal(screenshotFileName("screenshots/step-05-x.png"), "step-05-x.png");
  });

  for (const locale of ["en", "ko"]) {
    it(`${locale}: dictionary carries the caption labels`, () => {
      const v = DICTIONARIES[locale].visualChecks;
      assert.equal(typeof v.shotInitial, "string");
      assert.ok(v.shotAfterStep.includes("{n}"));
      assert.equal(typeof v.shotFinal, "string");
    });
  }
});

// §8-5 / §8-7 / §8-8 / §8-13 — copy and exposure regressions. Source-level on
// purpose: these FAIL on the pre-Train-N tree.
describe("beginner copy: no operational state or developer jargon in default screens", () => {
  const here = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

  it("§8-7 the login-depth checkbox is not rendered when the feature is unavailable", () => {
    const src = here("../src/app/projects/[id]/visual-checks/page.tsx");
    assert.ok(!src.includes("t.visualChecks.signupUnavailable"), "operational 'not set up to receive email' copy still shown to users");
  });

  it("§8-7 the run card no longer shows an executor badge (Cloud run / Local run)", () => {
    const src = here("../src/app/projects/[id]/visual-checks/page.tsx");
    assert.ok(!src.includes("executorLabel(t, check.executor)"));
  });

  it("§8-8 the report meta row does not label the timestamp with the executor", () => {
    const src = here("../src/app/projects/[id]/visual-checks/[runId]/page.tsx");
    assert.ok(!src.includes("t.visualChecks.executorContainer"));
    assert.ok(src.includes("screenshotCaption("), "report should render human captions");
  });

  for (const locale of ["en", "ko"]) {
    const d = DICTIONARIES[locale];
    it(`${locale}: §8-5 existing-app error copy no longer says owner/repo`, () => {
      assert.ok(!d.branch.submitErrUnrecognized.includes("owner/repo"), d.branch.submitErrUnrecognized);
      assert.ok(!d.branch.submitPlaceholder.includes("owner/repo"), d.branch.submitPlaceholder);
    });
    it(`${locale}: §8-7 evidence count speaks of screenshots, not evidence files`, () => {
      assert.ok(!/evidence files|증거 파일/.test(d.visualChecks.evidenceCount), d.visualChecks.evidenceCount);
    });
    it(`${locale}: §8-8 target label is 'the address we checked', not '대상'`, () => {
      assert.notEqual(d.visualChecks.metaTarget, "대상");
      assert.notEqual(d.visualChecks.metaTarget, "Inspected page");
    });
    it(`${locale}: §8-13 stuck helper is about the app, not about 'building'`, () => {
      assert.ok(!/만들다가|while building/i.test(d.stuckHelper.title), d.stuckHelper.title);
    });
  }
});

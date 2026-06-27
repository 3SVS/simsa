/**
 * shaping.test.mjs — Stage 258A. Deterministic tests for the PURE helpers (no browser).
 *
 * Verifies safety filtering, intent-CTA selection, evidence→opinion/decision separation, receipt
 * shaping (no numeric score), fix-brief content, and reproducibility comparison (incl. nondeterminism
 * reported as a finding). Uses SYNTHETIC evidence — this exercises the shaping logic, not a fake app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyActionSafety, intentMatchScore, choosePrimaryCta } from "../lib/safety.mjs";
import { buildAiOpinion, classifyDecision } from "../lib/classify.mjs";
import { buildReceipt, renderReceiptMarkdown, renderFixBrief, assertNoNumericScores } from "../lib/receipt.mjs";
import { compareRuns } from "../lib/compare.mjs";

const cfg = {
  targetUrl: "https://example-app.vercel.app/",
  intentAnchor: "New users should be able to start onboarding.",
  coreFlow: ["open homepage", "find primary signup/start CTA", "click CTA", "observe redirect or next screen"],
  forbiddenActions: ["payment", "delete", "send email", "invite external users", "publish", "deploy", "destructive data mutation"],
};

test("safety: forbidden actions are never safe; onboarding CTAs are safe", () => {
  for (const t of ["Delete account", "Pay now", "Invite teammates", "Publish", "Deploy", "Send email", "Log out"]) {
    assert.equal(classifyActionSafety(t).safe, false, `${t} must be unsafe`);
  }
  for (const t of ["Get started", "Sign up", "Start onboarding"]) {
    assert.equal(classifyActionSafety(t).safe, true, `${t} must be safe`);
  }
  assert.equal(classifyActionSafety("").safe, false); // empty/unclear → skip
});

test("intent scoring ranks onboarding CTAs above generic text", () => {
  assert.ok(intentMatchScore("Get started") > intentMatchScore("Learn more"));
  assert.equal(intentMatchScore("Learn more"), 0);
  assert.ok(intentMatchScore("Sign up") > 0);
});

test("choosePrimaryCta picks the highest-scoring SAFE candidate and skips forbidden intent matches", () => {
  const { chosen, skippedForbidden } = choosePrimaryCta([
    { text: "Learn more", selector: "a1" },
    { text: "Delete my account", selector: "a2" }, // not an intent match anyway
    { text: "Get started", selector: "a3" },
    { text: "Sign up", selector: "a4" },
  ]);
  assert.equal(chosen.text, "Get started"); // higher priority than "Sign up"
  assert.equal(Array.isArray(skippedForbidden), true);
});

test("choosePrimaryCta returns null when no onboarding CTA exists", () => {
  const { chosen } = choosePrimaryCta([{ text: "Learn more" }, { text: "Docs" }, { text: "Pricing" }]);
  assert.equal(chosen, null);
});

test("AI Opinion is separate from evidence and flags a broken route", () => {
  const evidence = { primaryCtaFound: true, clicked: true, routeChanged: true, routeAfterClick: "/undefined", consoleErrors: [], networkFailures: [] };
  const op = buildAiOpinion(evidence, cfg.intentAnchor);
  assert.equal(op.likelyIntentMismatch, true);
  assert.equal(op.suggestedSeverity, "high");
  assert.ok(op.label.toLowerCase().includes("opinion"));
});

test("decision: no CTA → Needs Clarification; console errors → Needs Fix; broken route → Needs Fix", () => {
  assert.equal(classifyDecision({ primaryCtaFound: false }).decision, "Needs Clarification");
  assert.equal(classifyDecision({ primaryCtaFound: true, clicked: true, consoleErrors: ["boom"], networkFailures: [], routeChanged: true, routeAfterClick: "/x" }).decision, "Needs Fix");
  assert.equal(classifyDecision({ primaryCtaFound: true, clicked: true, consoleErrors: [], networkFailures: [], routeChanged: true, routeAfterClick: "/undefined" }).decision, "Needs Fix");
});

test("decision: clean navigation stops at User Acceptance Required (no visual oracle → never auto-Ready)", () => {
  const d = classifyDecision({ primaryCtaFound: true, clicked: true, consoleErrors: [], networkFailures: [], routeChanged: true, routeAfterClick: "/onboarding" });
  assert.equal(d.decision, "User Acceptance Required");
});

test("receipt carries NO numeric score and keeps evidence/opinion sections separate", () => {
  const evidence = {
    urlLoaded: cfg.targetUrl, loadStatus: 200, viewport: { width: 1280, height: 800 },
    primaryCtaFound: true, clicked: true, clickedText: "Get started", clickedSelector: "a3",
    routeAfterClick: "/onboarding", routeChanged: true, consoleErrors: [], networkFailures: [],
    skipped: [], screenshots: ["screenshots/before.png", "screenshots/after.png"], timestamp: "2026-06-27T00:00:00Z",
  };
  const decision = classifyDecision(evidence);
  const opinion = buildAiOpinion(evidence, cfg.intentAnchor);
  const receipt = buildReceipt({ run: "run-1", config: cfg, evidence, decision, opinion });
  assert.equal(assertNoNumericScores(receipt), true);
  assert.ok(receipt.browserEvidence && receipt.aiOpinion); // separated
  assert.ok(!JSON.stringify(receipt).match(/\b\d{1,3}\s*\/\s*100\b/));
  const md = renderReceiptMarkdown(receipt);
  assert.ok(md.includes("Browser Evidence (facts)"));
  assert.ok(md.includes("AI Opinion (interpretation"));
});

test("assertNoNumericScores throws on an injected score", () => {
  assert.throws(() => assertNoNumericScores({ a: { qualityScore: 80 } }), /numeric scoring forbidden/);
  assert.throws(() => assertNoNumericScores({ note: "rated 82/100" }), /numeric scoring forbidden/);
});

test("fix brief is actionable: failure, repro steps, expected behavior, repair, rerun, acceptance", () => {
  const evidence = { primaryCtaFound: true, clicked: true, clickedText: "Start", routeAfterClick: "/undefined", routeChanged: true, consoleErrors: ["route not found"], networkFailures: [], skipped: [] };
  const decision = classifyDecision(evidence);
  const opinion = buildAiOpinion(evidence, cfg.intentAnchor);
  const brief = renderFixBrief({ config: cfg, evidence, decision, opinion });
  for (const section of ["Observed failure", "Reproduction steps", "Expected behavior", "Specific repair instruction", "Rerun command", "Acceptance condition"]) {
    assert.ok(brief.includes(section), `fix brief must include "${section}"`);
  }
});

test("compareRuns: identical receipts → reproducible; divergent decision → nondeterministic finding", () => {
  const base = {
    target: cfg.targetUrl, decision: "Needs Fix",
    browserEvidence: { clickedText: "Start", primaryCtaFound: true, routeAfterClick: "/undefined", consoleErrors: ["e"], networkFailures: [] },
  };
  const same = JSON.parse(JSON.stringify(base));
  assert.equal(compareRuns(base, same).reproducible, true);

  const drift = JSON.parse(JSON.stringify(base));
  drift.decision = "User Acceptance Required";
  const cmp = compareRuns(base, drift);
  assert.equal(cmp.reproducible, false);
  assert.ok(cmp.verdict.includes("NONDETERMINISTIC"));
  assert.ok(cmp.divergences.some((d) => d.name === "same decision"));
});

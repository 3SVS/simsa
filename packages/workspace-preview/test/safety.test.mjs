// Stage 135 — workspace-preview safety metadata tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_PREVIEW_PACKAGE,
  WORKSPACE_PREVIEW_SAFETY_RULES,
  getWorkspacePreviewSafetySummary,
} from "../src/index.mjs";

test("safety summary returns package metadata + rules", () => {
  const s = getWorkspacePreviewSafetySummary();
  assert.equal(s.package.name, "@conclave-ai/workspace-preview");
  assert.ok(s.package.purpose.length > 0);
  assert.ok(Array.isArray(s.rules) && s.rules.length >= 8);
});

test("package declares no network / mutation / hosted execution", () => {
  assert.equal(WORKSPACE_PREVIEW_PACKAGE.allowsNetwork, false);
  assert.equal(WORKSPACE_PREVIEW_PACKAGE.allowsMutation, false);
  assert.equal(WORKSPACE_PREVIEW_PACKAGE.allowsHostedExecution, false);
});

test("package assumes no payment provider; provider is TBD", () => {
  assert.equal(WORKSPACE_PREVIEW_PACKAGE.assumesPaymentProvider, false);
  assert.equal(WORKSPACE_PREVIEW_PACKAGE.paymentProvider, "TBD");
});

test("package is not published", () => {
  assert.equal(WORKSPACE_PREVIEW_PACKAGE.isPublished, false);
});

test("rules cover React/Next, browser, network, env, mutation, payment, secrets", () => {
  const blob = WORKSPACE_PREVIEW_SAFETY_RULES.join(" ").toLowerCase();
  for (const term of ["react", "next", "browser", "network", "env", "mutation", "payment", "secret"]) {
    assert.ok(blob.includes(term), `rules should mention "${term}"`);
  }
});

test("getWorkspacePreviewSafetySummary returns defensive copies", () => {
  const a = getWorkspacePreviewSafetySummary();
  a.rules.push("mutated");
  a.package.paymentProvider = "Stripe";
  const b = getWorkspacePreviewSafetySummary();
  assert.notEqual(b.rules.length, a.rules.length);
  assert.equal(b.package.paymentProvider, "TBD");
});

test("no Stripe / payment-provider assumption anywhere in metadata", () => {
  const blob = JSON.stringify(getWorkspacePreviewSafetySummary()).toLowerCase();
  assert.ok(!blob.includes("stripe"));
});
